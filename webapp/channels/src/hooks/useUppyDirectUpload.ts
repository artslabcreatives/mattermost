// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

/**
 * useUppyDirectUpload provides an Uppy instance pre-configured for direct
 * browser → S3 uploads using presigned PUT URLs (the @uppy/aws-s3 plugin).
 *
 * When the `EnableDirectUploads` server config flag is true the webapp
 * replaces the legacy append-based upload path with this hook.
 *
 * Usage
 * -----
 * const { uppy, uploading, progress, startUpload } = useUppyDirectUpload({ channelId });
 *
 * Upload flow (per file):
 *   1. createDirectUploadSession() — the server returns a presigned PUT URL
 *      plus an upload_id / file_id / object_key for the pending object.
 *   2. The @uppy/aws-s3 plugin PUTs the file bytes directly to S3. The bytes
 *      never pass through the Mattermost server.
 *   3. completeDirectUploadSession() — the server verifies the object exists
 *      and registers a Mattermost FileInfo record, which is returned to the
 *      caller so the file behaves exactly as it did on the legacy path.
 *
 * The @uppy/golden-retriever plugin stores upload metadata in IndexedDB so
 * that in-progress uploads survive page refreshes and browser restarts.
 */

import { useEffect, useRef, useCallback, useState } from 'react';

import type { FileInfo } from '@mattermost/types/files';

import Uppy from '@uppy/core';
import AwsS3 from '@uppy/aws-s3';
import GoldenRetriever from '@uppy/golden-retriever';

import { Client4 } from 'mattermost-redux/client';
import Constants from 'utils/constants';

// ---------------------------------------------------------------------------
// Client-side image derivative generation
// ---------------------------------------------------------------------------
//
// The Mattermost server and the S3 bucket can live in different regions, so we
// never want the server to fetch an uploaded image back just to build its
// thumbnail/preview. Instead the browser — which already holds the bytes —
// generates those derivatives and PUTs them straight to S3 (browser → S3) using
// the presigned URLs returned by createDirectUploadSession. The sizing mirrors
// the server's own logic so results match legacy (server-side) uploads:
//   - thumbnail: longer side scaled to fit 120×100, aspect ratio preserved
//   - preview:   width capped at 1920, aspect ratio preserved
// PNG originals keep a lossless PNG derivative (matching the server's
// getFileExtFromMimeType rule); every other type becomes JPEG.

const THUMBNAIL_WIDTH = 120;
const THUMBNAIL_HEIGHT = 100;
const PREVIEW_MAX_WIDTH = 1920;
const JPEG_QUALITY = 0.9;

interface ImageDerivatives {
	width: number;
	height: number;
	thumbBlob: Blob;
	previewBlob: Blob;
}

// Only raster images the browser can reliably decode and re-encode with a
// <canvas>. SVGs have no raster preview on this path and animated GIFs would
// lose their animation, so both are left without a client preview.
function isProcessableImage(contentType: string): boolean {
	return contentType.startsWith('image/') &&
		contentType !== 'image/svg+xml' &&
		contentType !== 'image/gif';
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
	return new Promise((resolve, reject) => {
		canvas.toBlob(
			(blob) => (blob ? resolve(blob) : reject(new Error('canvas.toBlob returned null'))),
			type,
			quality,
		);
	});
}

async function renderToBlob(bitmap: ImageBitmap, w: number, h: number, type: string, quality?: number): Promise<Blob> {
	const canvas = document.createElement('canvas');
	canvas.width = w;
	canvas.height = h;
	const ctx = canvas.getContext('2d');
	if (!ctx) {
		throw new Error('failed to acquire 2d canvas context');
	}
	ctx.drawImage(bitmap, 0, 0, w, h);
	return canvasToBlob(canvas, type, quality);
}

async function generateImageDerivatives(fileData: Blob, contentType: string): Promise<ImageDerivatives> {
	const bitmap = await createImageBitmap(fileData);
	try {
		const width = bitmap.width;
		const height = bitmap.height;
		if (!width || !height) {
			throw new Error('image has zero dimensions');
		}

		const outType = contentType === 'image/png' ? 'image/png' : 'image/jpeg';
		const quality = outType === 'image/jpeg' ? JPEG_QUALITY : undefined;

		// Thumbnail — mirror server GenerateThumbnail: pin the longer side to the
		// target and let the other scale, preserving aspect ratio (no crop).
		let thumbW: number;
		let thumbH: number;
		if (width > height) {
			thumbW = THUMBNAIL_WIDTH;
			thumbH = Math.max(1, Math.round((height * THUMBNAIL_WIDTH) / width));
		} else {
			thumbH = THUMBNAIL_HEIGHT;
			thumbW = Math.max(1, Math.round((width * THUMBNAIL_HEIGHT) / height));
		}

		// Preview — mirror server GeneratePreview: cap width at 1920, never upscale.
		let previewW = width;
		let previewH = height;
		if (width > PREVIEW_MAX_WIDTH) {
			previewW = PREVIEW_MAX_WIDTH;
			previewH = Math.max(1, Math.round((height * PREVIEW_MAX_WIDTH) / width));
		}

		const thumbBlob = await renderToBlob(bitmap, thumbW, thumbH, outType, quality);
		const previewBlob = await renderToBlob(bitmap, previewW, previewH, outType, quality);

		return { width, height, thumbBlob, previewBlob };
	} finally {
		bitmap.close?.();
	}
}

async function putBlobToS3(url: string, blob: Blob): Promise<void> {
	const res = await fetch(url, {
		method: 'PUT',
		body: blob,
		headers: { 'Content-Type': blob.type || 'application/octet-stream' },
	});
	if (!res.ok) {
		throw new Error(`derivative PUT failed with status ${res.status}`);
	}
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UppyDirectUploadOptions {
	/** ID of the channel the files belong to. */
	channelId: string;

	/** Called once all pending uploads have finished. */
	onComplete?: (fileInfos: FileInfo[]) => void;

	/** Called if an error occurs during upload. */
	onError?: (error: Error) => void;

	/** Maximum number of files allowed in restrictions. */
	maxNumberOfFiles?: number;

	/** Callback when file upload limit is exceeded. */
	onUploadLimitExceeded?: () => void;
}

export interface UppyDirectUploadResult {
	/** The configured Uppy instance — pass to an <UppyDashboard> if desired. */
	uppy: Uppy;

	/** True while uploads are in progress. */
	uploading: boolean;

	/**
	 * Overall upload progress 0–100. Updated by Uppy's 'progress' event.
	 * 0 when idle.
	 */
	progress: number;

	/**
	 * Kick off the upload of all files currently staged in Uppy.
	 * Resolves once all S3 uploads have been acknowledged and their
	 * FileInfo records registered with the server.
	 */
	startUpload: () => Promise<FileInfo[]>;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useUppyDirectUpload(
	options: UppyDirectUploadOptions,
): UppyDirectUploadResult {
	// Store callbacks in refs so event handlers always see the latest values.
	const channelIdRef = useRef(options.channelId);
	const onCompleteRef = useRef(options.onComplete);
	const onErrorRef = useRef(options.onError);
	const onUploadLimitExceededRef = useRef(options.onUploadLimitExceeded);
	channelIdRef.current = options.channelId;
	onCompleteRef.current = options.onComplete;
	onErrorRef.current = options.onError;
	onUploadLimitExceededRef.current = options.onUploadLimitExceeded;

	// Uppy is mutable — keep it in a ref so it survives re-renders.
	const uppyRef = useRef<Uppy | null>(null);
	const uploadingRef = useRef(false);
	const [progress, setProgress] = useState(0);

	// Collect FileInfo promises keyed by Uppy file id. A Map (rather than an
	// array reset per batch) is required because files can be added in several
	// separate operations — paste, drag-drop, "add more", remote providers —
	// each of which produces its own upload batch with its own upload/complete
	// events. Keying by file id lets us accumulate results across overlapping
	// batches without ever discarding a finished file's FileInfo.
	const pendingFileInfosRef = useRef<Map<string, Promise<FileInfo | null>>>(new Map());

	if (!uppyRef.current) {
		const uppy = new Uppy({
			autoProceed: false,
			allowMultipleUploadBatches: true,
			restrictions: {
				maxNumberOfFiles: options.maxNumberOfFiles ?? Constants.MAX_UPLOAD_FILES,
			},
		});

		uppy.on('restriction-failed', (file, error) => {
			onUploadLimitExceededRef.current?.();
		});

		// Direct-to-S3 plugin – handles direct uploads to S3 using presigned PUT URLs.
		uppy.use(AwsS3, {
			shouldUseMultipart: false, // Use single PUT upload (supports up to 5 GB)
			getUploadParameters: async (file) => {
				const contentType = (file.meta?.filetype as string) || file.type || 'application/octet-stream';
				const data = await Client4.createDirectUploadSession({
					channel_id: channelIdRef.current,
					filename: (file.meta?.filename as string) || file.name || 'file',
					content_type: contentType,
				});

				// Store metadata on the file object to associate with upload-success
				file.meta = {
					...file.meta,
					upload_id: data.upload_id,
					file_id: data.file_id,
					object_key: data.object_key,
				};

				// For images, generate the thumbnail + preview in the browser and
				// PUT them directly to S3 before the original upload begins. Doing
				// this here (inside the awaited getUploadParameters) means the
				// original file's PUT — and therefore the whole batch's 'complete'
				// event — cannot fire until the derivatives are in place, so a post
				// is never sent referencing a preview that does not yet exist.
				//
				// If generation/upload fails we fall back to has_preview=false: the
				// image still uploads and displays, just without a stored preview,
				// rather than failing the upload or leaving a broken thumbnail.
				if (data.thumbnail_upload_url && data.preview_upload_url && isProcessableImage(contentType)) {
					try {
						const derived = await generateImageDerivatives(file.data as Blob, contentType);
						await Promise.all([
							putBlobToS3(data.thumbnail_upload_url, derived.thumbBlob),
							putBlobToS3(data.preview_upload_url, derived.previewBlob),
						]);
						file.meta = {
							...file.meta,
							img_width: derived.width,
							img_height: derived.height,
							has_preview: true,
						};
					} catch (err) {
						// eslint-disable-next-line no-console
						console.error('Direct upload: image derivative generation failed, uploading without preview:', err);
						file.meta = {
							...file.meta,
							has_preview: false,
						};
					}
				}

				return {
					method: 'PUT',
					url: data.upload_url,
					headers: {
						'Content-Type': file.type || 'application/octet-stream',
					},
				};
			},
		});

		// GoldenRetriever persists upload state (file blobs + metadata) in
		// IndexedDB so uploads survive page refreshes and network interruptions.
		uppy.use(GoldenRetriever, {
			serviceWorker: false, // serviceWorker requires an extra SW registration step
			indexedDB: {
				maxFileSize: 500 * 1024 * 1024, // 500 MiB per file
				maxTotalSize: 2 * 1024 * 1024 * 1024, // 2 GiB total
			},
		});

		// Attach channel_id and filename metadata whenever a file is added so
		// the backend can associate the upload with the right channel/user.
		// The upload itself is kicked off from the `files-added` handler below.
		uppy.on('file-added', (file) => {
			// Robustly determine the filename — file.name can be undefined,
			// empty, or the literal string "undefined" depending on how the
			// file was added (drag-drop, paste, DropTarget plugin, etc.).
			const rawName = file.name;
			const fileType = (file as { type?: string }).type ?? 'application/octet-stream';
			let safeName: string;
			if (rawName && rawName !== 'undefined' && rawName.trim() !== '') {
				safeName = rawName;
			} else {
				// Generate a descriptive fallback: "upload_<timestamp>.<ext>"
				const ext = fileType.split('/').pop() ?? 'bin';
				safeName = `upload_${Date.now()}.${ext}`;
			}
			uppy.setFileMeta(file.id, {
				channel_id: channelIdRef.current,
				filename: safeName,
				filetype: fileType,
			});
		});

		// Auto-start the upload once per add operation. Uppy fires `files-added`
		// (plural) a single time after all the `file-added` events for the same
		// batch, so the metadata above is already set for every file here.
		//
		// IMPORTANT: this used to be gated on `!uploadingRef.current` inside the
		// per-file `file-added` handler. That dropped files: any file added while
		// an earlier upload was still running (a second multi-select, a paste of
		// several files — which are added one-by-one — drag-drop while uploading,
		// remote providers, etc.) never triggered its own `upload()` call and was
		// left stranded in the `waiting` state, so it never reached the channel.
		//
		// `uppy.upload()` is safe to call repeatedly: internally it only picks up
		// files that have not started and are not already assigned to an upload
		// (see Uppy core `waitingFileIDs`), and `allowMultipleUploadBatches: true`
		// lets a new batch run alongside one already in flight. So we simply start
		// an upload for every add operation and let Uppy de-duplicate.
		uppy.on('files-added', () => {
			// If channelId is empty (e.g. a draft DM not yet created) defer until
			// the channel exists; the `upload` event below re-stamps channel_id.
			if (!channelIdRef.current) {
				return;
			}
			uppy.upload().catch((err) => {
				// Errors are surfaced via the 'upload-error' handler below.
				console.error('Auto-upload failed:', err);
			});
		});

		// Track overall upload progress (0-100).
		uppy.on('progress', (value: number) => {
			setProgress(value);
		});

		uppy.on('upload', () => {
			// Update all files with the latest channelId right before upload starts
			const currentChannelId = channelIdRef.current;
			if (currentChannelId) {
				uppy.getFiles().forEach((f) => {
					uppy.setFileMeta(f.id, {
						...f.meta,
						channel_id: currentChannelId,
					});
				});
			}
			
			uploadingRef.current = true;
			setProgress(0);

			// NOTE: do NOT clear pendingFileInfosRef here. With overlapping
			// batches this event can fire for batch N+1 while batch N's
			// completeDirectUploadSession() calls are still resolving; clearing
			// would drop those FileInfos and the files would silently vanish from
			// the composer. Entries are removed individually once delivered in the
			// 'complete' handler below.
		});

		// When each S3 upload completes, notify Mattermost to finalize and register the FileInfo.
		uppy.on('upload-success', (file) => {
			if (!file) {
				return;
			}
			const uploadId = file.meta?.upload_id as string;
			const fileId = file.meta?.file_id as string;
			const objectKey = file.meta?.object_key as string;
			const fileSize = file.size ?? 0;
			if (!uploadId || !fileId || !objectKey) {
				return;
			}
			pendingFileInfosRef.current.set(
				file.id,
				Client4.completeDirectUploadSession({
					upload_id: uploadId,
					file_id: fileId,
					object_key: objectKey,
					file_size: fileSize,
					width: (file.meta?.img_width as number) || 0,
					height: (file.meta?.img_height as number) || 0,
					has_preview: Boolean(file.meta?.has_preview),
				}).then((data) => {
					if (data.file_infos && data.file_infos.length > 0) {
						return data.file_infos[0] as FileInfo;
					}
					throw new Error('No FileInfo returned from complete direct upload');
				}).catch((err: unknown) => {
					onErrorRef.current?.(err instanceof Error ? err : new Error(String(err)));
					return null;
				}),
			);
		});

		uppy.on('complete', () => {
			setProgress(100);

			// `complete` fires once per upload batch, but files may still be
			// uploading in another batch that was started while this one ran
			// (or one that is queued behind it). If anything is still in flight
			// we must NOT deliver yet — and the parent must not clear the panel
			// or the still-uploading files would be wiped. A file is considered
			// settled once it has either completed or errored.
			const stillInFlight = uppy.getFiles().some(
				(f) => !f.progress?.uploadComplete && !f.error,
			);
			if (stillInFlight) {
				return;
			}

			uploadingRef.current = false;

			// Every batch has settled: deliver the union of all collected
			// FileInfos in one shot, then drain the map so the next round of
			// uploads starts clean.
			const entries = [...pendingFileInfosRef.current.values()];
			pendingFileInfosRef.current.clear();

			Promise.all(entries).then((infos) => {
				const valid = infos.filter((info): info is FileInfo => Boolean(info));
				onCompleteRef.current?.(valid);
			});
		});

		uppy.on('upload-error', (_file, error) => {
			uploadingRef.current = false;
			const err = error instanceof Error ? error : new Error(String(error));
			onErrorRef.current?.(err);
		});

		uppyRef.current = uppy;
	}

	// Update Uppy restrictions when maxNumberOfFiles changes.
	useEffect(() => {
		if (uppyRef.current && options.maxNumberOfFiles !== undefined) {
			(uppyRef.current as any).setOptions({
				restrictions: {
					...(uppyRef.current as any).opts.restrictions,
					maxNumberOfFiles: options.maxNumberOfFiles,
				},
			});
		}
	}, [options.maxNumberOfFiles]);

	// Cleanup Uppy on unmount.
	useEffect(() => {
		const instance = uppyRef.current;
		return () => {
			instance?.destroy();
		};
	}, []);

	const startUpload = useCallback(async (): Promise<FileInfo[]> => {
		const uppy = uppyRef.current!;
		uploadingRef.current = true;
		setProgress(0);

		const result = await uppy.upload();

		if (result.failed.length > 0 && result.successful.length === 0) {
			const firstFailure = result.failed[0];
			const err = new Error(
				`Upload failed for "${(firstFailure as { name?: string }).name ?? 'unknown'}": ${(firstFailure as { error?: string }).error ?? 'unknown error'}`,
			);
			throw err;
		}

		setProgress(100);

		// Await the FileInfo fetches for the files in this upload result.
		const ids = result.successful.map((f) => (f as { id: string }).id);
		const proms = ids
			.map((id) => pendingFileInfosRef.current.get(id))
			.filter((p): p is Promise<FileInfo | null> => Boolean(p));
		const infos = await Promise.all(proms);
		return infos.filter((info): info is FileInfo => Boolean(info));
	}, []);

	return {
		uppy: uppyRef.current!,
		uploading: uploadingRef.current,
		progress,
		startUpload,
	};
}



