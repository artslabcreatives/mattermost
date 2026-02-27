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
 */

import { useEffect, useRef, useCallback } from 'react';

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
    [key: string]: unknown;
}

export interface UppyDirectUploadOptions {
    /** ID of the channel the files belong to. */
    channelId: string;

    /** Called once all pending uploads have finished with the resulting FileInfo IDs. */
    onComplete?: (fileIds: string[]) => void;

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
     * Resolves with the registered FileInfo IDs.
     */
    startUpload: () => Promise<string[]>;
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
 */
interface DirectCompleteResponse {
    file_infos: Array<{ id: string }>;
}

export function useUppyDirectUpload(
    options: UppyDirectUploadOptions,
): UppyDirectUploadResult {
    const { channelId, onComplete, onError } = options;

    // Uppy is mutable — keep it in a ref so it survives re-renders.
    const uppyRef = useRef<Uppy | null>(null);
    const uploadingRef = useRef(false);

    if (!uppyRef.current) {
        uppyRef.current = new Uppy({
            autoProceed: false,
            restrictions: {
                // Allow up to 5 concurrent uploads per the spec.
                maxNumberOfFiles: 5,
            },
        });

        uppyRef.current.use(AwsS3, {
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
                            channel_id: channelId,
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
    }

    // Cleanup Uppy on unmount.
    useEffect(() => {
        const instance = uppyRef.current;
        return () => {
            instance?.destroy();
        };
    }, []);

    const startUpload = useCallback(async (): Promise<string[]> => {
        const uppy = uppyRef.current!;
        uploadingRef.current = true;

        try {
            const result = await uppy.upload();

            if (result.failed.length > 0) {
                const firstFailure = result.failed[0];
                const err = new Error(
                    `Upload failed for file "${(firstFailure as {name?: string}).name ?? 'unknown'}": ${(firstFailure as {error?: string}).error ?? 'unknown error'}`,
                );
                onError?.(err);
                throw err;
            }

            // For each successful file, call the "complete" endpoint so
            // Mattermost registers a FileInfo record.
            const fileIds: string[] = [];

            for (const file of result.successful) {
                const meta = (file as {meta?: DirectUploadMeta}).meta ?? {};
                const { upload_id: uploadId, file_id: fileId, object_key: objectKey } = meta;

                if (!uploadId || !fileId || !objectKey) {
                    // Should not happen — skip gracefully.
                    continue;
                }

                const complete = await Client4.doFetch<DirectCompleteResponse>(
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
                );

                const ids = complete.file_infos?.map((fi: {id: string}) => fi.id) ?? [];
                fileIds.push(...ids);
            }

            onComplete?.(fileIds);
            return fileIds;
        } finally {
            uploadingRef.current = false;
        }
        // Client4 is a stable module-level singleton and does not need to be
        // listed in the dependency array.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [channelId, onComplete, onError]);

    return {
        uppy: uppyRef.current,
        uploading: uploadingRef.current,
        startUpload,
    };
}

