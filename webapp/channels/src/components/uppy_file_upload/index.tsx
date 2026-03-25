// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

/**
 * UppyFileUpload renders a full-featured Uppy Dashboard inside the post
 * composer.  It supports:
 *
 *   Local:   Browse, Webcam, Microphone, Screencast, Image Editor
 *   Remote:  Google Drive, Dropbox, OneDrive, Box, Unsplash, URL
 *   Drop:    Drag-and-drop anywhere on the page (via @uppy/drop-target)
 *   Upload:  TUS resumable upload through /api/v4/files/tus/
 *   Recover: @uppy/golden-retriever persists state across page reloads
 *
 * Rendered only when EnableDirectUploads=true on the server.
 */

import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { useIntl } from 'react-intl';

import type { FileInfo } from '@mattermost/types/files';
import { PaperclipIcon } from '@mattermost/compass-icons/components';

import type Uppy from '@uppy/core';
import Dashboard from '@uppy/dashboard';
import Webcam from '@uppy/webcam';
import Audio from '@uppy/audio';
import ScreenCapture from '@uppy/screen-capture';
import Url from '@uppy/url';
import GoogleDrive from '@uppy/google-drive';
import Dropbox from '@uppy/dropbox';
import OneDrive from '@uppy/onedrive';
import Box from '@uppy/box';
import Unsplash from '@uppy/unsplash';
import ImageEditor from '@uppy/image-editor';
import DropTarget from '@uppy/drop-target';

import '@uppy/core/css/style.min.css';
import '@uppy/dashboard/css/style.min.css';
import '@uppy/audio/dist/style.min.css';
import '@uppy/screen-capture/dist/style.min.css';
import '@uppy/image-editor/dist/style.min.css';
import '@uppy/url/dist/style.min.css';

import WithTooltip from 'components/with_tooltip';
import KeyboardShortcutSequence, { KEYBOARD_SHORTCUTS } from 'components/keyboard_shortcuts/keyboard_shortcuts_sequence';

import { useUppyDirectUpload } from 'hooks/useUppyDirectUpload';
import { hasPlainText, createFileFromClipboardDataItem } from 'utils/paste';

import './uppy_file_upload.scss';

// Public companion URL — nginx proxies /api/companion/ → companion:3020
const COMPANION_URL = `${window.location.origin}/api/companion`;

export type RestoredFileInfo = {
	id: string;
	name: string;
	type: string;
	size: number;
};

export type UppyFileUploadHandle = {
	/** Remove a file from the Uppy instance (e.g. when the user clicks ✕ in FilePreview). */
	removeFile: (uppyFileId: string) => void;
};

export type Props = {
	channelId: string;
	disabled?: boolean;
	onFilesUploaded: (fileInfos: FileInfo[]) => void;
	onFilesAdded?: (files: RestoredFileInfo[]) => void;
	/**
	 * Called once after GoldenRetriever restores previously interrupted uploads.
	 * Fires at most once per mount, batching all restored files together.
	 */
	onFilesRestored?: (files: RestoredFileInfo[]) => void;
	/**
	 * Called when the user removes a file from the Uppy Dashboard panel.
	 * The id is the Uppy file id that was previously reported via onFilesRestored.
	 */
	onFileRemoved?: (uppyFileId: string) => void;
	onUploadStart?: () => void;
	onUploadError?: (err: Error) => void;
};

const UppyFileUpload = forwardRef<UppyFileUploadHandle, Props>(function UppyFileUpload({
	channelId,
	disabled,
	onFilesUploaded,
	onFilesAdded,
	onFilesRestored,
	onFileRemoved,
	onUploadStart,
	onUploadError,
}, ref) {
	const { formatMessage } = useIntl();
	const [panelOpen, setPanelOpen] = useState(false);
	const containerRef = useRef<HTMLDivElement>(null);
	const wrapperRef = useRef<HTMLDivElement>(null);
	const uppyRef = useRef<Uppy | null>(null);

	// Keep callback refs stable so the effect below doesn't need to re-run.
	const onFilesAddedRef = useRef(onFilesAdded);
	const onFilesRestoredRef = useRef(onFilesRestored);
	const onFileRemovedRef = useRef(onFileRemoved);
	onFilesAddedRef.current = onFilesAdded;
	onFilesRestoredRef.current = onFilesRestored;
	onFileRemovedRef.current = onFileRemoved;

	useImperativeHandle(ref, () => ({
		removeFile: (uppyFileId: string) => {
			uppyRef.current?.removeFile(uppyFileId);
		},
	}), []);

	// TUS uploads complete asynchronously on the server side; the client only
	// knows that bytes were transmitted.  Notify the parent so it knows the
	// upload session is done (FileInfo will appear via WebSocket event).
	const handleComplete = useCallback((fileInfos: FileInfo[]) => {
		// Forward whatever the hook resolved (may be empty for TUS uploads).
		onFilesUploaded(fileInfos);
		// Clear the Uppy file list so the next panel open starts fresh.
		uppyRef.current?.clear();
		setPanelOpen(false);
	}, [onFilesUploaded]);

	const { uppy, uploading, progress } = useUppyDirectUpload({
		channelId,
		onComplete: handleComplete,
		onError: onUploadError,
	});

	// Keep the ref in sync so handleComplete can call clear() on the Uppy instance.
	uppyRef.current = uppy;

	// Mount the Uppy Dashboard once — the div is always in the DOM (shown/hidden
	// via CSS), so the Dashboard never needs to be torn down and re-created.
	useEffect(() => {
		if (!containerRef.current) {
			return;
		}

		uppy
			.use(Dashboard, {
				inline: true,
				target: containerRef.current,
				showProgressDetails: true,
				proudlyDisplayPoweredByUppy: false,
				theme: 'auto',
				width: '100%',
				height: 400,
				plugins: [
					'Webcam', 'Audio', 'ScreenCapture',
					'GoogleDrive', 'Dropbox', 'OneDrive', 'Box', 'Unsplash', 'Url',
					'ImageEditor',
				],
			})
			.use(Webcam, { id: 'Webcam', target: Dashboard })
			.use(Audio, { id: 'Audio', target: Dashboard })
			.use(ScreenCapture, { id: 'ScreenCapture', target: Dashboard })
			.use(GoogleDrive, { id: 'GoogleDrive', companionUrl: COMPANION_URL, target: Dashboard })
			.use(Dropbox, { id: 'Dropbox', companionUrl: COMPANION_URL, target: Dashboard })
			.use(OneDrive, { id: 'OneDrive', companionUrl: COMPANION_URL, target: Dashboard })
			.use(Box, { id: 'Box', companionUrl: COMPANION_URL, target: Dashboard })
			.use(Unsplash, { id: 'Unsplash', companionUrl: COMPANION_URL, target: Dashboard })
			.use(Url, { id: 'Url', companionUrl: COMPANION_URL, target: Dashboard })
			.use(ImageEditor, { id: 'ImageEditor', target: Dashboard })
			// DropTarget makes the whole page a drop zone.
			// Files dropped onto the chat area are added to Uppy and the
			// panel is opened automatically (see file-added handler below).
			.use(DropTarget, { id: 'DropTarget', target: document.body });

		// Batch-collect files that GoldenRetriever restores from IndexedDB and
		// notify the parent once after all are queued (setTimeout 0 lets all
		// file-added events fire before the callback runs).
		const restoredBatch: RestoredFileInfo[] = [];
		let restoredTimer: ReturnType<typeof setTimeout> | null = null;

		uppy.on('file-added', (file) => {
			const queuedFile = {
				id: file.id,
				name: file.name ?? '',
				type: file.type ?? '',
				size: file.size ?? 0,
			};

			if ((file as { isRestored?: boolean }).isRestored) {
				restoredBatch.push(queuedFile);
				if (restoredTimer !== null) {
					clearTimeout(restoredTimer);
				}
				restoredTimer = setTimeout(() => {
					restoredTimer = null;
					if (restoredBatch.length > 0) {
						onFilesRestoredRef.current?.([...restoredBatch]);
						restoredBatch.length = 0;
					}
				}, 0);
			} else {
				onFilesAddedRef.current?.([queuedFile]);
			}
			setPanelOpen(true);
			onUploadStart?.();
		});

		uppy.on('file-removed', (file) => {
			onFileRemovedRef.current?.(file.id);
		});
	}, []); // eslint-disable-line react-hooks/exhaustive-deps

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

	// Handle paste events: when the user pastes files from their file manager
	// (e.g. Ctrl+C on a file, then Ctrl+V in the composer) route them through
	// Uppy instead of the legacy FileUpload handler.
	useEffect(() => {
		function onPaste(e: ClipboardEvent) {
			if (!e.clipboardData || !e.clipboardData.items || hasPlainText(e.clipboardData)) {
				return;
			}

			const fileItems = Array.from(e.clipboardData.items).filter((item) => item.kind === 'file');
			if (fileItems.length === 0) {
				return;
			}

			const fileNamePrefix = 'Pasted File ';
			const files = fileItems
				.map((item) => createFileFromClipboardDataItem(item, fileNamePrefix))
				.filter((f): f is File => f !== null);

			if (files.length === 0) {
				return;
			}

			const uppy = uppyRef.current;
			if (!uppy) {
				return;
			}

			e.preventDefault();

			for (const file of files) {
				try {
					uppy.addFile({ name: file.name, type: file.type, data: file });
				} catch {
					// addFile throws if the file type is restricted or the file is a duplicate;
					// silently ignore so other paste-file adds can still proceed.
				}
			}
		}

		document.addEventListener('paste', onPaste);
		return () => document.removeEventListener('paste', onPaste);
	}, []);

	// Close the panel when the user clicks outside the component.
	useEffect(() => {
		if (!panelOpen) {
			return undefined;
		}
		const handleClickOutside = (e: MouseEvent) => {
			if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
				setPanelOpen(false);
			}
		};
		document.addEventListener('mousedown', handleClickOutside);
		return () => document.removeEventListener('mousedown', handleClickOutside);
	}, [panelOpen]);

	const label = formatMessage({
		id: 'file_upload.upload_files',
		defaultMessage: 'Upload files',
	});

	return (
		<div
			className='UppyFileUpload'
			ref={wrapperRef}
		>
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

			{/* Inline progress bar – shown only while an upload is active. */}
			{uploading && (
				<div
					className='UppyFileUpload__progress-bar'
					role='progressbar'
					aria-valuenow={progress}
					aria-valuemin={0}
					aria-valuemax={100}
					aria-label={formatMessage({
						id: 'file_upload.uploading',
						defaultMessage: 'Uploading…',
					})}
				>
					<div
						className='UppyFileUpload__progress-bar-fill'
						style={{ width: `${progress}%` }}
					/>
				</div>
			)}

			<div
				className={`UppyFileUpload__panel${panelOpen ? '' : ' UppyFileUpload__panel--hidden'}`}
				ref={containerRef}
			/>
		</div>
	);
});

export default UppyFileUpload;

