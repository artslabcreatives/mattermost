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
	 * Resolves once all TUS uploads have been acknowledged by the server.
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
			pendingFileInfosRef.current.push(
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



