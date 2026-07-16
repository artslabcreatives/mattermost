// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

// Command backfill-thumbnails repairs images that were uploaded via the
// direct-to-S3 path before client-side derivative generation existed. Those
// FileInfo rows advertise HasPreviewImage=true and reference _thumb/_preview
// objects that were never created, and carry Width=Height=0, so the webapp
// renders a blank box.
//
// For each affected image it downloads the original from S3, regenerates the
// thumbnail and preview using the server's own imaging package (identical sizing
// to the live upload path), uploads them to the exact keys the FileInfo already
// references, and fills in Width/Height.
//
// It is a one-off maintenance tool driven entirely by environment variables so
// no secrets live in the repo:
//
//	DB_DSN         postgres connection string
//	S3_ENDPOINT    e.g. s3.ap-southeast-1.amazonaws.com
//	S3_REGION      e.g. ap-southeast-1
//	S3_BUCKET      bucket name
//	S3_ACCESS_KEY  access key id
//	S3_SECRET_KEY  secret access key
//	S3_SSL         "true" (default) or "false"
//	S3_PATH_PREFIX optional key prefix (default empty)
//
// Flags: -dry-run (report only), -limit N (cap rows processed), -verbose.
package main

import (
	"bytes"
	"context"
	"database/sql"
	"flag"
	"fmt"
	"image"
	"image/jpeg"
	"image/png"
	"log"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"

	_ "golang.org/x/image/webp"

	_ "github.com/lib/pq"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"

	"github.com/mattermost/mattermost/server/v8/channels/app/imaging"
)

const (
	thumbnailWidth  = 120
	thumbnailHeight = 100
	previewWidth    = 1920
	jpegQuality     = 90
)

type brokenImage struct {
	id            string
	name          string
	path          string
	thumbnailPath string
	previewPath   string
	mimeType      string
}

func mustEnv(key string) string {
	v := os.Getenv(key)
	if v == "" {
		log.Fatalf("required environment variable %s is not set", key)
	}
	return v
}

func main() {
	dryRun := flag.Bool("dry-run", false, "report what would change without writing anything")
	limit := flag.Int("limit", 0, "maximum number of images to process (0 = no limit)")
	verbose := flag.Bool("verbose", false, "log every processed file")
	concurrency := flag.Int("concurrency", 16, "number of images to process in parallel")
	flag.Parse()
	if *concurrency < 1 {
		*concurrency = 1
	}

	dsn := mustEnv("DB_DSN")
	s3Endpoint := mustEnv("S3_ENDPOINT")
	s3Region := mustEnv("S3_REGION")
	s3Bucket := mustEnv("S3_BUCKET")
	s3Key := mustEnv("S3_ACCESS_KEY")
	s3Secret := mustEnv("S3_SECRET_KEY")
	s3SSL := os.Getenv("S3_SSL") != "false"
	pathPrefix := os.Getenv("S3_PATH_PREFIX")

	ctx := context.Background()

	db, err := sql.Open("postgres", dsn)
	if err != nil {
		log.Fatalf("failed to open database: %v", err)
	}
	defer db.Close()
	if err := db.Ping(); err != nil {
		log.Fatalf("failed to connect to database: %v", err)
	}

	s3, err := minio.New(s3Endpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(s3Key, s3Secret, ""),
		Secure: s3SSL,
		Region: s3Region,
	})
	if err != nil {
		log.Fatalf("failed to create S3 client: %v", err)
	}

	decoder, err := imaging.NewDecoder(imaging.DecoderOptions{})
	if err != nil {
		log.Fatalf("failed to create image decoder: %v", err)
	}

	query := `
		SELECT id, name, path, thumbnailpath, previewpath, mimetype
		FROM fileinfo
		WHERE deleteat = 0
		  AND mimetype LIKE 'image/%'
		  AND mimetype <> 'image/svg+xml'
		  AND path <> ''
		  AND (width = 0 OR height = 0)
		ORDER BY createat DESC`
	if *limit > 0 {
		query += fmt.Sprintf("\n\t\tLIMIT %d", *limit)
	}

	rows, err := db.QueryContext(ctx, query)
	if err != nil {
		log.Fatalf("failed to query fileinfo: %v", err)
	}
	defer rows.Close()

	var targets []brokenImage
	for rows.Next() {
		var b brokenImage
		var thumb, preview sql.NullString
		if err := rows.Scan(&b.id, &b.name, &b.path, &thumb, &preview, &b.mimeType); err != nil {
			log.Fatalf("failed to scan row: %v", err)
		}
		b.thumbnailPath = thumb.String
		b.previewPath = preview.String
		targets = append(targets, b)
	}
	if err := rows.Err(); err != nil {
		log.Fatalf("row iteration error: %v", err)
	}

	total := len(targets)
	log.Printf("found %d image(s) to repair (dry-run=%v, concurrency=%d)", total, *dryRun, *concurrency)

	var (
		repaired int64
		failed   int64
		done     int64
	)

	jobs := make(chan brokenImage)
	var wg sync.WaitGroup
	for w := 0; w < *concurrency; w++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for b := range jobs {
				n := atomic.AddInt64(&done, 1)
				if err := process(ctx, s3, decoder, db, s3Bucket, pathPrefix, b, *dryRun, *verbose); err != nil {
					log.Printf("[%d/%d] FAILED %s (%s): %v", n, total, b.id, b.name, err)
					atomic.AddInt64(&failed, 1)
					continue
				}
				atomic.AddInt64(&repaired, 1)
				if *verbose || n%100 == 0 {
					log.Printf("[%d/%d] OK %s (%s)", n, total, b.id, b.name)
				}
			}
		}()
	}
	for _, b := range targets {
		jobs <- b
	}
	close(jobs)
	wg.Wait()

	log.Printf("done: repaired=%d failed=%d", repaired, failed)
	if failed > 0 {
		os.Exit(1)
	}
}

func process(ctx context.Context, s3 *minio.Client, decoder *imaging.Decoder, db *sql.DB, bucket, pathPrefix string, b brokenImage, dryRun, verbose bool) error {
	origKey := pathPrefix + b.path

	obj, err := s3.GetObject(ctx, bucket, origKey, minio.GetObjectOptions{})
	if err != nil {
		return fmt.Errorf("get original: %w", err)
	}
	defer obj.Close()

	img, _, err := decoder.Decode(obj)
	if err != nil {
		return fmt.Errorf("decode original %s: %w", origKey, err)
	}

	width := img.Bounds().Dx()
	height := img.Bounds().Dy()
	if width == 0 || height == 0 {
		return fmt.Errorf("decoded image has zero dimensions")
	}

	// Derive the derivative keys from the paths already stored on the FileInfo
	// so the objects land exactly where the client will request them. Fall back
	// to computing them if the columns were empty.
	thumbKey, previewKey := b.thumbnailPath, b.previewPath
	if thumbKey == "" || previewKey == "" {
		tk, pk := deriveKeys(b.path, b.name, b.mimeType)
		if thumbKey == "" {
			thumbKey = tk
		}
		if previewKey == "" {
			previewKey = pk
		}
	}

	if dryRun {
		log.Printf("DRY-RUN would repair %s (%s): %dx%d -> thumb=%s preview=%s",
			b.id, b.name, width, height, thumbKey, previewKey)
		return nil
	}

	thumbImg := imaging.GenerateThumbnail(img, thumbnailWidth, thumbnailHeight)
	previewImg := imaging.GeneratePreview(img, previewWidth)

	if err := uploadImage(ctx, s3, bucket, pathPrefix+thumbKey, thumbImg); err != nil {
		return fmt.Errorf("upload thumbnail: %w", err)
	}
	if err := uploadImage(ctx, s3, bucket, pathPrefix+previewKey, previewImg); err != nil {
		return fmt.Errorf("upload preview: %w", err)
	}

	now := time.Now().UnixMilli()
	res, err := db.ExecContext(ctx,
		`UPDATE fileinfo
		 SET width = $1, height = $2, haspreviewimage = true,
		     thumbnailpath = $3, previewpath = $4, updateat = $5
		 WHERE id = $6`,
		width, height, thumbKey, previewKey, now, b.id)
	if err != nil {
		return fmt.Errorf("update fileinfo: %w", err)
	}
	if n, _ := res.RowsAffected(); n != 1 {
		return fmt.Errorf("expected to update 1 row, updated %d", n)
	}
	return nil
}

func uploadImage(ctx context.Context, s3 *minio.Client, bucket, key string, img image.Image) error {
	var buf bytes.Buffer
	contentType := "image/jpeg"
	if strings.HasSuffix(strings.ToLower(key), ".png") {
		contentType = "image/png"
		if err := png.Encode(&buf, img); err != nil {
			return fmt.Errorf("png encode: %w", err)
		}
	} else {
		if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: jpegQuality}); err != nil {
			return fmt.Errorf("jpeg encode: %w", err)
		}
	}

	_, err := s3.PutObject(ctx, bucket, key, bytes.NewReader(buf.Bytes()), int64(buf.Len()),
		minio.PutObjectOptions{ContentType: contentType})
	return err
}

// deriveKeys mirrors the server's directUploadDerivativeKeys for rows whose
// derivative columns were empty.
func deriveKeys(objectPath, filename, mimeType string) (thumbKey, previewKey string) {
	base := filename
	if idx := strings.LastIndex(base, "."); idx > 0 {
		base = base[:idx]
	}
	prefix := strings.TrimSuffix(objectPath, filename)
	ext := "jpg"
	if mimeType == "image/png" {
		ext = "png"
	}
	return prefix + base + "_thumb." + ext, prefix + base + "_preview." + ext
}
