// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

/**
 * UppyFileUpload renders an Uppy Dashboard panel inside the post composer.
 *
 * When the user adds files (drag-and-drop, browse, or paste) and clicks
 * "Upload", files are sent directly to S3/DO Spaces via presigned URLs
 * (browser → S3, bypassing the Mattermost server) using the
 * useUppyDirectUpload hook.  The resulting FileInfo objects are forwarded to
 * the caller via onFilesUploaded so the draft can be updated normally.
 *
 * The component is only rendered when EnableDirectUploads=true on the server.
 */

import React, {useCallback, useEffect, useRef, useState} from 'react';
import {useIntl} from 'react-intl';

import type {FileInfo} from '@mattermost/types/files';
import {PaperclipIcon} from '@mattermost/compass-icons/components';

import type Uppy from '@uppy/core';
import Dashboard from '@uppy/dashboard';
import '@uppy/core/dist/style.min.css';
import '@uppy/dashboard/dist/style.min.css';

import WithTooltip from 'components/with_tooltip';
import KeyboardShortcutSequence, {KEYBOARD_SHORTCUTS} from 'components/keyboard_shortcuts/keyboard_shortcuts_sequence';

import {useUppyDirectUpload} from 'hooks/useUppyDirectUpload';

import './uppy_file_upload.scss';

export type Props = {
    channelId: string;
    disabled?: boolean;
    onFilesUploaded: (fileInfos: FileInfo[]) => void;
    onUploadStart?: () => void;
    onUploadError?: (err: Error) => void;
};

const UppyFileUpload = ({
    channelId,
    disabled,
    onFilesUploaded,
    onUploadStart,
    onUploadError,
}: Props) => {
    const {formatMessage} = useIntl();
    const [panelOpen, setPanelOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);
    const dashboardMountedRef = useRef(false);
    const uppyRef = useRef<Uppy | null>(null);

    const handleComplete = useCallback((fileInfos: FileInfo[]) => {
        if (fileInfos.length > 0) {
            onFilesUploaded(fileInfos);
        }
        // Reset Uppy file list so the next panel open starts fresh.
        uppyRef.current?.reset();
        setPanelOpen(false);
    }, [onFilesUploaded]);

    const {uppy} = useUppyDirectUpload({
        channelId,
        onComplete: handleComplete,
        onError: onUploadError,
    });

    // Keep the ref in sync so handleComplete can call reset() on the Uppy instance.
    uppyRef.current = uppy;

    // Mount the Uppy Dashboard into the container div once it is in the DOM.
    useEffect(() => {
        if (!panelOpen || !containerRef.current || dashboardMountedRef.current) {
            return;
        }
        dashboardMountedRef.current = true;

        uppy.use(Dashboard, {
            inline: true,
            target: containerRef.current,
            showProgressDetails: true,
            proudlyDisplayPoweredByUppy: false,
            theme: 'auto',
            width: '100%',
            height: 320,
        });
    }, [panelOpen, uppy]);

    const togglePanel = useCallback(() => {
        if (disabled) {
            return;
        }
        setPanelOpen((prev) => {
            if (!prev) {
                onUploadStart?.();
            }
            return !prev;
        });
    }, [disabled, onUploadStart]);

    const label = formatMessage({
        id: 'file_upload.upload_files',
        defaultMessage: 'Upload files',
    });

    return (
        <div className='UppyFileUpload'>
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
                    id='uppyFileUploadButton'
                    aria-label={label}
                    className='style--none'
                    disabled={disabled}
                    onClick={togglePanel}
                >
                    <PaperclipIcon
                        size={18}
                        color={'currentColor'}
                        aria-label={label}
                    />
                </button>
            </WithTooltip>
            {panelOpen && (
                <div
                    className='UppyFileUpload__panel'
                    ref={containerRef}
                />
            )}
        </div>
    );
};

export default UppyFileUpload;

