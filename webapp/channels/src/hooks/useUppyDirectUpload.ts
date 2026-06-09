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
	channelIdRef.current = options.channelId;
	onCompleteRef.current = options.onComplete;
	onErrorRef.current = options.onError;

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
				maxNumberOfFiles: Constants.MAX_UPLOAD_FILES,
			},
		});

		// Direct-to-S3 plugin – handles direct uploads to S3 using presigned PUT URLs.
		uppy.use(AwsS3, {
			shouldUseMultipart: false, // Use single PUT upload (supports up to 5 GB)
			getUploadParameters: async (file) => {
				const data = await Client4.createDirectUploadSession({
					channel_id: channelIdRef.current,
					filename: (file.meta?.filename as string) || file.name || 'file',
					content_type: (file.meta?.filetype as string) || file.type || 'application/octet-stream',
				});
				
				// Store metadata on the file object to associate with upload-success
				file.meta = {
					...file.meta,
					upload_id: data.upload_id,
					file_id: data.file_id,
					object_key: data.object_key,
				};

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



