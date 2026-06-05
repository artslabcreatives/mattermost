// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

/**
 * useUppyDirectUpload provides an Uppy instance pre-configured for
 * TUS resumable uploads via the Mattermost TUS endpoint at /api/v4/files/tus/.
 *
 * When the `EnableDirectUploads` server config flag is true the webapp
 * replaces the legacy append-based upload path with this hook.
 *
 * Usage
 * -----
 * const { uppy, uploading, progress, startUpload } = useUppyDirectUpload({ channelId });
 *
 * All files added to the Uppy instance are uploaded via TUS chunked protocol.
 * TUS provides built-in resumability: if a network interruption occurs the
 * upload resumes automatically from the last acknowledged byte, even after
 * an IP address change.
 *
 * The @uppy/golden-retriever plugin stores upload metadata in IndexedDB so
 * that in-progress uploads survive page refreshes and browser restarts.
 *
 * After each TUS upload the hook retrieves the Mattermost FileInfo record from
 * GET /api/v4/files/tus/fileinfo/{upload_id} (with retries) so callers
 * receive the full FileInfo as they did with the legacy upload path.
 */

import { useEffect, useRef, useCallback, useState } from 'react';

import type { FileInfo } from '@mattermost/types/files';

import Uppy from '@uppy/core';
import Tus from '@uppy/tus';
import GoldenRetriever from '@uppy/golden-retriever';

import { Client4 } from 'mattermost-redux/client';
import Constants from 'utils/constants';

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
	 * Resolves once all TUS uploads have been acknowledged by the server.
	 */
	startUpload: () => Promise<FileInfo[]>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract the TUS upload ID from a tusd upload URL.
 * e.g. "https://mm.example.com/api/v4/files/tus/abc123" → "abc123"
 */
function tusUploadIdFromUrl(uploadUrl: string): string {
	try {
		const url = new URL(uploadUrl, window.location.origin);
		const parts = url.pathname.split('/').filter(Boolean);
		return parts[parts.length - 1] ?? '';
	} catch {
		return '';
	}
}

/**
 * Poll GET /api/v4/files/tus/fileinfo/{upload_id} until the server has
 * finalised the upload and created the FileInfo record.
 *
 * The server processes the upload asynchronously so this function retries
 * up to maxRetries times with retryIntervalMs between each attempt.
 */
async function fetchTusFileInfo(uploadId: string, maxRetries = 20, retryIntervalMs = 1500): Promise<FileInfo> {
	for (let i = 0; i < maxRetries; i++) {
		const resp = await fetch(
			`${Client4.getUrl()}/api/v4/files/tus/fileinfo/${uploadId}`,
			Client4.getOptions({ method: 'get' }),
		)
			.then((r) => {
				if (!r.ok) {
					throw new Error('Not found');
				}
				return r.json() as Promise<FileInfo>;
			})
			.catch(() => null);

		if (resp) {
			return resp;
		}

		// Wait before retrying.
		await new Promise<void>((res) => setTimeout(res, retryIntervalMs));
	}
	throw new Error(`Timed out waiting for FileInfo for TUS upload ${uploadId}`);
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
	channelIdRef.current = options.channelId;
	onCompleteRef.current = options.onComplete;
	onErrorRef.current = options.onError;

	// Uppy is mutable — keep it in a ref so it survives re-renders.
	const uppyRef = useRef<Uppy | null>(null);
	const uploadingRef = useRef(false);
	const [progress, setProgress] = useState(0);

	// Collect FileInfo promises for all files in the current batch.
	const pendingFileInfosRef = useRef<Array<Promise<FileInfo>>>([]);

	if (!uppyRef.current) {
		const uppy = new Uppy({
			autoProceed: false,
			allowMultipleUploadBatches: true,
			restrictions: {
				maxNumberOfFiles: Constants.MAX_UPLOAD_FILES,
			},
		});

		// TUS plugin – handles chunked, resumable uploads.
		// The endpoint must match the tusd handler mounted in the Go backend.
		uppy.use(Tus, {
			endpoint: `${Client4.getUrl()}/api/v4/files/tus/`,
			// Pass the Mattermost session token as a Bearer header so the
			// backend's auth middleware can validate the request.
			headers: {
				Authorization: `Bearer ${Client4.getToken()}`,
			},
			// Retry with exponential back-off on transient network failures.
			retryDelays: [0, 1000, 3000, 5000],
			// 5 MiB chunks – a good default for most connections.
			chunkSize: 5 * 1024 * 1024,
			// Remove the fingerprint from IndexedDB once TUS confirms
			// the upload is complete, so the file won't reappear in the
			// Dashboard on the next page load.
			removeFingerprintOnSuccess: true,
			// Only pass metadata fields we actually set below.
			allowedMetaFields: ['channel_id', 'filename', 'filetype'],
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
		// Also automatically start the upload when a file is added (Slack-like behavior).
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

			// Auto-start upload if not already uploading and we have a channel_id.
			// If channelId is empty (e.g. a draft DM), we wait until the user creates the channel.
			if (!uploadingRef.current && channelIdRef.current) {
				uppy.upload().catch((err) => {
					// Errors are handled by uppy.on('upload-error') handler below
					console.error('Auto-upload failed:', err);
				});
			}
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
			pendingFileInfosRef.current = [];
			setProgress(0);
		});

		// When each individual file's TUS upload completes, kick off the
		// FileInfo retrieval from the server.
		uppy.on('upload-success', (file) => {
			if (!file) {
				return;
			}
			const uploadUrl = (file as { tus?: { uploadUrl?: string } }).tus?.uploadUrl ?? '';
			const uploadId = tusUploadIdFromUrl(uploadUrl);
			if (!uploadId) {
				return;
			}
			pendingFileInfosRef.current.push(
				fetchTusFileInfo(uploadId).catch((err: unknown) => {
					onErrorRef.current?.(err instanceof Error ? err : new Error(String(err)));
					return null as unknown as FileInfo;
				}),
			);
		});

		uppy.on('complete', () => {
			uploadingRef.current = false;
			setProgress(100);

			const proms = pendingFileInfosRef.current;
			pendingFileInfosRef.current = [];

			Promise.all(proms).then((infos) => {
				const valid = infos.filter(Boolean);
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
		pendingFileInfosRef.current = [];
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

		// Await all in-flight FileInfo fetches.
		const infos = await Promise.all(pendingFileInfosRef.current);
		return infos.filter(Boolean);
	}, []);

	return {
		uppy: uppyRef.current!,
		uploading: uploadingRef.current,
		progress,
		startUpload,
	};
}



