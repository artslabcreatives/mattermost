// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {useIntl} from 'react-intl';

import Uppy from '@uppy/core';
import type {UppyFile} from '@uppy/utils';
import type {FileProgressStarted} from '@uppy/utils';
import DashboardModal from '@uppy/react/dashboard-modal';
import XHRUpload from '@uppy/xhr-upload';

import '@uppy/core/dist/style.min.css';
import '@uppy/dashboard/dist/style.min.css';

import {PaperclipIcon} from '@mattermost/compass-icons/components';
import type {FileInfo} from '@mattermost/types/files';
import type {ServerError} from '@mattermost/types/errors';

import {Client4} from 'mattermost-redux/client';

import KeyboardShortcutSequence, {KEYBOARD_SHORTCUTS} from 'components/keyboard_shortcuts/keyboard_shortcuts_sequence';
import type {FilePreviewInfo} from 'components/file_preview/file_preview';
import WithTooltip from 'components/with_tooltip';

import Constants from 'utils/constants';
import {generateId} from 'utils/utils';

// Milliseconds to wait after a successful upload before removing the file from
// the Uppy dashboard, giving the user time to see the "complete" status.
const UPPY_FILE_REMOVAL_DELAY_MS = 1500;

// Custom meta fields sent alongside each file to Mattermost's files API
type MattermostMeta = {
    channel_id?: string;
    client_ids?: string;
    clientId?: string;
    [key: string]: unknown;
};

// Response body from Mattermost's POST /api/v4/files endpoint
type MattermostBody = {
    file_infos?: FileInfo[];
    client_ids?: string[];
    [key: string]: unknown;
};

export type UseUppyDirectUploadProps = {
    channelId: string;
    rootId: string;
    fileCount: number;
    onUploadStart: (clientIds: string[], channelId: string) => void;
    onFileUpload: (fileInfos: FileInfo[], clientIds: string[], channelId: string, rootId: string) => void;
    onUploadError: (err: string | ServerError | null, clientId?: string, channelId?: string, rootId?: string) => void;
    onUploadProgress: (filePreviewInfo: FilePreviewInfo) => void;
};

const useUppyDirectUpload = ({
    channelId,
    rootId,
    fileCount,
    onUploadStart,
    onFileUpload,
    onUploadError,
    onUploadProgress,
}: UseUppyDirectUploadProps): React.ReactNode => {
    const intl = useIntl();
    const [isDashboardOpen, setIsDashboardOpen] = useState(false);

    // Use refs to avoid stale closures inside Uppy event callbacks
    const channelIdRef = useRef(channelId);
    const rootIdRef = useRef(rootId);
    const onUploadStartRef = useRef(onUploadStart);
    const onFileUploadRef = useRef(onFileUpload);
    const onUploadErrorRef = useRef(onUploadError);
    const onUploadProgressRef = useRef(onUploadProgress);

    useEffect(() => { channelIdRef.current = channelId; }, [channelId]);
    useEffect(() => { rootIdRef.current = rootId; }, [rootId]);
    useEffect(() => { onUploadStartRef.current = onUploadStart; }, [onUploadStart]);
    useEffect(() => { onFileUploadRef.current = onFileUpload; }, [onFileUpload]);
    useEffect(() => { onUploadErrorRef.current = onUploadError; }, [onUploadError]);
    useEffect(() => { onUploadProgressRef.current = onUploadProgress; }, [onUploadProgress]);

    const uppy = useMemo(() => {
        // Create a single Uppy instance for the lifetime of this editor component.
        // An empty deps array is intentional: recreating Uppy would cancel in-progress
        // uploads and destroy the dashboard state. The XHR headers function closes over
        // channelIdRef (a stable ref) so auth tokens are always fresh without recreating.
        return new Uppy<MattermostMeta, MattermostBody>({
            autoProceed: false,
            restrictions: {
                maxNumberOfFiles: Constants.MAX_UPLOAD_FILES,
            },
        }).use(XHRUpload<MattermostMeta, MattermostBody>, {
            endpoint: Client4.getFilesRoute(),
            method: 'POST',
            formData: true,
            fieldName: 'files',
            bundle: false,

            // Include only our custom meta fields in the multipart form data
            allowedMetaFields: ['channel_id', 'client_ids'],

            // Dynamically compute auth headers for each upload request
            headers: () => {
                const options = Client4.getOptions({method: 'POST'}) as {headers?: Record<string, string>};
                const headers: Record<string, string> = {Accept: 'application/json'};
                if (options.headers) {
                    for (const key of Object.keys(options.headers)) {
                        const val = options.headers[key];
                        if (val) {
                            headers[key] = val;
                        }
                    }
                }
                return headers;
            },
        });
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        // Assign a Mattermost client ID to each file when it is added to Uppy
        const onFileAdded = (file: UppyFile<MattermostMeta, MattermostBody>) => {
            const clientId = generateId();
            uppy.setFileMeta(file.id, {
                channel_id: channelIdRef.current,
                client_ids: clientId,
                clientId, // internal tracking reference
            });
        };

        // Notify Mattermost that uploads have begun so the draft is updated
        const handleUpload = (_uploadID: string, files: Array<UppyFile<MattermostMeta, MattermostBody>>) => {
            const clientIds = files.
                map((f) => f.meta?.clientId).
                filter((id): id is string => Boolean(id));
            onUploadStartRef.current(clientIds, channelIdRef.current);
        };

        // Forward upload progress to Mattermost's preview component
        const handleProgress = (
            file: UppyFile<MattermostMeta, MattermostBody> | undefined,
            progress: FileProgressStarted,
        ) => {
            if (!file) {
                return;
            }
            const clientId = file.meta?.clientId;
            if (!clientId) {
                return;
            }
            const bytesTotal = progress.bytesTotal ?? 0;
            const percent = bytesTotal > 0 ? Math.floor((progress.bytesUploaded / bytesTotal) * 100) : 0;
            onUploadProgressRef.current({
                clientId,
                name: file.name,
                percent,
                type: file.type ?? '',
            } as FilePreviewInfo);
        };

        // Parse Mattermost's response and notify the draft of completed uploads
        const handleUploadSuccess = (
            file: UppyFile<MattermostMeta, MattermostBody> | undefined,
            response: NonNullable<UppyFile<MattermostMeta, MattermostBody>['response']>,
        ) => {
            if (!file || !response?.body) {
                return;
            }
            const clientId = file.meta?.clientId;
            if (!clientId) {
                return;
            }
            const {file_infos: fileInfos, client_ids: clientIds} = response.body;
            if (fileInfos && clientIds) {
                onFileUploadRef.current(fileInfos, clientIds, channelIdRef.current, rootIdRef.current);
            }

            // Remove the file from Uppy dashboard after upload so the list stays clean
            setTimeout(() => {
                try {
                    uppy.removeFile(file.id);
                } catch {
                    // File may already be removed; ignore
                }
            }, UPPY_FILE_REMOVAL_DELAY_MS);
        };

        // Propagate upload errors to the editor's server error state
        const handleUploadError = (
            file: UppyFile<MattermostMeta, MattermostBody> | undefined,
            error: {name: string; message: string; details?: string},
        ) => {
            const clientId = file?.meta?.clientId;
            onUploadErrorRef.current(
                error?.message ?? null,
                clientId,
                channelIdRef.current,
                rootIdRef.current,
            );
        };

        uppy.on('file-added', onFileAdded);
        uppy.on('upload', handleUpload);
        uppy.on('upload-progress', handleProgress);
        uppy.on('upload-success', handleUploadSuccess);
        uppy.on('upload-error', handleUploadError);

        return () => {
            uppy.off('file-added', onFileAdded);
            uppy.off('upload', handleUpload);
            uppy.off('upload-progress', handleProgress);
            uppy.off('upload-success', handleUploadSuccess);
            uppy.off('upload-error', handleUploadError);
        };
    }, [uppy]);

    useEffect(() => {
        return () => uppy.destroy();
    }, [uppy]);

    const openDashboard = useCallback(() => {
        setIsDashboardOpen(true);
    }, []);

    const closeDashboard = useCallback(() => {
        setIsDashboardOpen(false);
    }, []);

    const uploadsRemaining = Constants.MAX_UPLOAD_FILES - fileCount;
    const buttonAriaLabel = intl.formatMessage({id: 'accessibility.button.attachment', defaultMessage: 'attachment'});
    const iconAriaLabel = intl.formatMessage({id: 'generic_icons.attach', defaultMessage: 'Attachment Icon'});

    return (
        <>
            <WithTooltip
                title={
                    <KeyboardShortcutSequence
                        shortcut={KEYBOARD_SHORTCUTS.filesUpload}
                        hoistDescription={true}
                        isInsideTooltip={true}
                    />
                }
            >
                <button
                    type='button'
                    id='fileUploadButton'
                    aria-label={buttonAriaLabel}
                    className={`style--none AdvancedTextEditor__action-button${uploadsRemaining <= 0 ? ' disabled' : ''}`}
                    onClick={openDashboard}
                    disabled={uploadsRemaining <= 0}
                >
                    <PaperclipIcon
                        size={18}
                        color='currentColor'
                        aria-label={iconAriaLabel}
                    />
                </button>
            </WithTooltip>
            <DashboardModal
                uppy={uppy}
                open={isDashboardOpen}
                onRequestClose={closeDashboard}
                proudlyDisplayPoweredByUppy={false}
                hideProgressDetails={false}
                closeAfterFinish={false}
                closeModalOnClickOutside={true}
                theme='auto'
            />
        </>
    );
};

export default useUppyDirectUpload;
