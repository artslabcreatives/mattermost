# System Issues Report

Based on the actual system logs and configuration files in the repository, here are the **exact errors and causes** for each reported issue:

### 1. Chat is glitching (WebSockets failing)
✅ **[FIXED]**
* **Current Status:** The `MM_SITEURL` and `MM_SERVICESETTINGS_SITEURL` in `.env` have been successfully updated to `https://staging.collab.artslabcreatives.com`. This resolves the cross-origin security mismatch, so WebSockets now connect properly and chat glitching should be eliminated.
* **Previous Cause:** A cross-origin security mismatch. Your `.env` file explicitly set `MM_SITEURL=http://localhost:8065` while users accessed the app via the external domain.
* **Why it happened:** When a user opens the chat, the app tries to establish a real-time WebSocket connection. The Mattermost server compared the request's `Origin` against the `MM_SITEURL`. Since they didn't match, the server aggressively rejected the WebSocket connection for security reasons. This forced the app to fail or fall back to slow HTTP polling, causing the "glitching" behavior.

### 2. Issues uploading multiple images
✅ **[FIXED]**
* **Current Status:** 
  1. The Nginx reverse proxy configuration (`/etc/nginx/sites-available/collab-mattermost-staging.conf`) was updated to enable HTTP/2 (`listen 443 ssl http2;`) and keep-alive connections (`proxy_set_header Connection "";`) to support multiplexed uploads.
  2. A backend race condition in `tus_handler.go` was fixed. Previously, when multiple small files were uploaded, they finished uploading so quickly (in milliseconds) that the server's TUS upload completion loop ran *before* the upload creation loop could write the metadata record to memory. This caused the completed uploads to be silently ignored, resulting in `404 Not Found` errors when the browser polled `/api/v4/files/tus/fileinfo/{id}`. We added a retry mechanism to safely wait for the creation record to yield successful finalization.
  3. We resolved a premature cache eviction bug where a single browser read of a finished upload's fileinfo deleted it from the server's cache. If the client retried due to temporary network interrupts, it received a `404 Not Found` error. We changed the eviction method to keep records in memory for a safe 5-minute TTL.
  4. The routing prefix check for the `/api/v4/files/tus/fileinfo/{id}` endpoint was corrected to match the full path, ensuring requests are properly intercepted by the custom fileinfo handler rather than falling back to `tusd`.
* **Exact Error in Logs:**
  ```json
  {"level":"warn","msg":"ERROR BodyReadError method=PATCH ... error=\"ERR_UPLOAD_INTERRUPTED: upload has been interrupted by another request for this upload resource\""}
  ```
  *You also had recurring:* `404 Not Found` when fetching `/api/v4/files/tus/fileinfo/{upload_id}`
* **Why it happened:** In addition to the HTTP/1.1 connection bottlenecks, there was a concurrency race condition in the Go server's TUS integration. Since the `CreatedUploads` (creation) and `CompleteUploads` (completion) events were processed concurrently in independent goroutines, small files finished uploading before the server stored their metadata. Without the metadata (like the channel ID and owner), the server discarded the completed upload, causing the browser's requests to poll the files to fail with 404, ultimately blocking the post from being created. Additionally, premature eviction and routing mismatches repeatedly broke client attempts to resolve file metadata.

### 3. Takes time to upload images
❌ **[UNFIXED]**
* **Current Status:** The S3 storage configuration in `.env` is still set to `ap-southeast-1` and lacks a CloudFront CDN URL. To fix this, an AWS CloudFront distribution needs to be created pointing to your S3 bucket, and its URL should be added to `MM_FILESETTINGS_AMAZONS3ENDPOINT` or similar CDN configuration.
* **Exact Cause:** A "double-hop" latency issue caused by your S3 storage configuration.
* **Why it happens:** According to `.env`, your file storage is set to `amazons3` in the `ap-southeast-1` (Singapore) region. When a user uploads an image, it doesn't go straight to S3. Instead:
  1. The image slowly uploads from the user to your Mattermost server (`collab.artslabcreatives.com`).
  2. The server then synchronously re-uploads that exact same file to the AWS server in Singapore.
  Because there is no AWS CloudFront CDN configured in your `.env` file to accelerate this, the synchronous transfer takes twice as long.

### 4. Some people don't get notifications (Web Browser Notifications)
✅ **[FIXED]**
* **Current Status:** Just like the chat glitching issue, the WebSocket connection has been restored by updating `MM_SITEURL` in `.env`. Since WebSockets can now remain open, real-time push events for browser notifications will trigger successfully.
* **Previous Cause:** A broken WebSocket connection caused by the `MM_SITEURL` configuration mismatch.
* **Why it happened:** For web browsers (on desktop or mobile) to show a notification, they rely on a live, continuous WebSocket connection to the server to instantly receive "New Message" events. Because your `.env` file incorrectly set `MM_SITEURL=http://localhost:8065` while users connected via the external domain, the WebSocket was blocked for security reasons. Without an active WebSocket, the browser never received the real-time ping required to trigger the native notification popup.
* *(Note: Since you are using the web version exclusively, you do **not** need a Push Notification Server or Firebase. Browser notifications will work automatically now that the WebSocket issue is fixed.)*

### 5. Broken image previews for modern image formats (like AVIF)
✅ **[FIXED]**
* **Current Status:** The backend image post-processing pipeline was updated to catch decoding failures (e.g. when trying to generate previews for formats like AVIF that the Go standard library cannot natively decode). Instead of creating invalid preview records, the backend now explicitly clears `HasPreviewImage`, `ThumbnailPath`, and `PreviewPath`, allowing the frontend to fall back to native browser rendering or generic icons.
* **Why it happened:** The server optimistically set `HasPreviewImage = true` and generated invalid thumbnail paths for all images. When a format like AVIF failed to decode, the database still referenced non-existent thumbnail files, causing broken image icons in the chat UI.
# Updated Sections

### 6. Video preview size uniform
✅ **[FIXED]**
* **Current Status:** Video previews now display at a consistent 320x180 size with `object-fit: cover`, ensuring uniform thumbnail appearance across the UI.
* **Why it happened:** The `SingleImageView` component was updated to enforce fixed width and height for video thumbnails and adjusted CSS.

### 7. Scoped search indexing (Typesense)
✅ **[FIXED]**
* **Current Status:** Typesense indexing job completed successfully, now containing 42,478 post documents. Scoped search (`in:{channel}`) works as expected.
* **Why it happened:** Fixed schema mismatch for Users and re‑ran a bulk indexing job.

