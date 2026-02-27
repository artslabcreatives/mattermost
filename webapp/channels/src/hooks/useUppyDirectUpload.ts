// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

/**
 * useUppyDirectUpload provides an Uppy instance pre-configured for
 * direct-to-S3 uploads via the Mattermost presigned-URL API.
 *
 * When the `EnableDirectUploads` server config flag is true the webapp
 * replaces the legacy append-based upload path with this hook.
 *
 * Usage
 * -----
 * const { uppy, uploading, startUpload } = useUppyDirectUpload({ channelId });
 *
 * All files added to the Uppy instance are PUT directly to S3/DO Spaces
 * using presigned URLs.  On success the FileInfo IDs are resolved so the
 * post composer can attach them as normal.
 *
 * The hook is event-driven: upload-success fires direct/complete for each
 * file, and the complete event calls onComplete.  This means both the Uppy
 * Dashboard's native "Upload" button and the programmatic startUpload()
 * function follow the same code path.
 */

import { useEffect, useRef, useCallback } from 'react';

import type { FileInfo } from '@mattermost/types/files';

import Uppy from '@uppy/core';
import AwsS3 from '@uppy/aws-s3';

import { Client4 } from 'mattermost-redux/client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Metadata stored on each Uppy file during the upload flow. */
interface DirectUploadMeta {
    upload_id?: string;
    file_id?: string;
    object_key?: string;
    direct_complete_done?: boolean;
    [key: string]: unknown;
}

export interface UppyDirectUploadOptions {
    /** ID of the channel the files belong to. */
    channelId: string;

    /** Called once all pending uploads have finished with the resulting FileInfo objects. */
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
     * Kick off the upload of all files currently staged in Uppy.
     * Resolves once all uploads and direct/complete calls have finished.
     */
    startUpload: () => Promise<FileInfo[]>;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Presigned-URL metadata returned by POST /api/v4/files/direct/session.
 */
interface PresignedSessionResponse {
    upload_id: string;
    file_id: string;
    upload_url: string;
    object_key: string;
}

/**
 * FileInfo-shaped payload returned by POST /api/v4/files/direct/complete.
 * Matches the FileUploadResponse model from the server.
 */
interface DirectCompleteResponse {
    file_infos: FileInfo[];
}

export function useUppyDirectUpload(
    options: UppyDirectUploadOptions,
): UppyDirectUploadResult {
    // Store callbacks in refs so event handlers always see the latest values.
    const channelIdRef = useRef(options.channelId);
    const onCompleteRef = useRef(options.onComplete);
    const onErrorRef = useRef(options.onError);
    useEffect(() => {
        channelIdRef.current = options.channelId;
        onCompleteRef.current = options.onComplete;
        onErrorRef.current = options.onError;
    });

    // Uppy is mutable — keep it in a ref so it survives re-renders.
    const uppyRef = useRef<Uppy | null>(null);
    const uploadingRef = useRef(false);

    // Track in-flight direct/complete promises so we can await them all before
    // calling onComplete.  This avoids a race where the Uppy 'complete' event
    // fires before the async doFetch calls have resolved.
    const pendingCompletionPromsRef = useRef<Array<Promise<FileInfo[]>>>([]);

    if (!uppyRef.current) {
        const uppy = new Uppy({
            autoProceed: false,
            restrictions: {
                // Maximum files per upload session (matches Mattermost server default).
                maxNumberOfFiles: 5,
            },
        });

        uppy.use(AwsS3, {
            // Force simple (non-multipart) PUT uploads for presigned URL flow.
            shouldUseMultipart: false,

            /**
             * Mattermost's presign endpoint acts as the signing service.
             * For each file Uppy calls this method to get a single presigned
             * PUT URL (simple / non-multipart upload).
             */
            async getUploadParameters(file) {
                const filename = (file as {name?: string}).name ?? 'upload';
                const contentType = (file as {type?: string}).type ?? 'application/octet-stream';

                // POST /api/v4/files/direct/session
                const res = await Client4.doFetch<PresignedSessionResponse>(
                    `${Client4.getFilesRoute()}/direct/session`,
                    {
                        method: 'post',
                        body: JSON.stringify({
                            channel_id: channelIdRef.current,
                            filename,
                            content_type: contentType,
                        }),
                    },
                );

                // Store the session metadata on the Uppy file so we can
                // reference it in the upload-success handler.
                const meta = file.meta as DirectUploadMeta;
                meta.upload_id = res.upload_id;
                meta.file_id = res.file_id;
                meta.object_key = res.object_key;

                return {
                    method: 'PUT' as const,
                    url: res.upload_url,
                    headers: {
                        'Content-Type': contentType,
                    },
                };
            },
        });

        // For each file that reaches S3 successfully, issue the Mattermost
        // direct/complete call.  Each call is stored as a Promise so the
        // 'complete' handler can await them all before notifying the caller.
        uppy.on('upload-success', (file) => {
            if (!file) {
                return;
            }
            const meta = (file.meta ?? {}) as DirectUploadMeta;
            const { upload_id: uploadId, file_id: fileId, object_key: objectKey } = meta;

            if (!uploadId || !fileId || !objectKey || meta.direct_complete_done) {
                return;
            }

            // Mark as done to avoid double-completion on retry.
            meta.direct_complete_done = true;

            const completionPromise = Client4.doFetch<DirectCompleteResponse>(
                `${Client4.getFilesRoute()}/direct/complete`,
                {
                    method: 'post',
                    body: JSON.stringify({
                        upload_id: uploadId,
                        file_id: fileId,
                        object_key: objectKey,
                        file_size: (file as {size?: number}).size ?? 0,
                    }),
                },
            ).then((complete) => complete.file_infos ?? [] as FileInfo[]).catch((err: unknown) => {
                onErrorRef.current?.(err instanceof Error ? err : new Error(String(err)));
                return [] as FileInfo[];
            });

            pendingCompletionPromsRef.current.push(completionPromise);
        });

        // Wait for all direct/complete calls to finish before calling onComplete.
        uppy.on('complete', (result) => {
            uploadingRef.current = false;

            if (result.failed.length > 0 && result.successful.length === 0) {
                const firstFailure = result.failed[0];
                const err = new Error(
                    `Upload failed for "${(firstFailure as {name?: string}).name ?? 'unknown'}": ${(firstFailure as {error?: string}).error ?? 'unknown error'}`,
                );
                onErrorRef.current?.(err);
                pendingCompletionPromsRef.current = [];
                return;
            }

            const proms = pendingCompletionPromsRef.current;
            pendingCompletionPromsRef.current = [];

            Promise.all(proms).then((allResults) => {
                const infos = allResults.flat();
                onCompleteRef.current?.(infos);
            });
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
        pendingCompletionPromsRef.current = [];

        const result = await uppy.upload();

        if (result.failed.length > 0 && result.successful.length === 0) {
            const firstFailure = result.failed[0];
            const err = new Error(
                `Upload failed for "${(firstFailure as {name?: string}).name ?? 'unknown'}": ${(firstFailure as {error?: string}).error ?? 'unknown error'}`,
            );
            throw err;
        }

        // Await all in-flight direct/complete calls before returning.
        const allResults = await Promise.all(pendingCompletionPromsRef.current);
        return allResults.flat();
    }, []);

    return {
        uppy: uppyRef.current!,
        uploading: uploadingRef.current,
        startUpload,
    };
}

