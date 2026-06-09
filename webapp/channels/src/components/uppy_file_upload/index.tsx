// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

/**
 * UppyFileUpload is the attachment (paperclip) button used when
 * EnableDirectUploads=true on the server.
 *
 * It deliberately renders NO Uppy Dashboard / popup. Clicking the paperclip
 * opens the browser's native file picker; selected (or pasted / drag-dropped)
 * files are handed to Uppy, which uploads them straight to S3 via presigned
 * PUT (@uppy/aws-s3). Progress and previews are shown by Mattermost's normal
 * attachment thumbnails above the message box — the parent composer wires
 * those up through onFilesAdded / onFilesUploaded.
 *
 *   Browse: native <input type="file"> behind the paperclip button
 *   Drop:   drag-and-drop anywhere on the page (via @uppy/drop-target)
 *   Paste:  Ctrl/Cmd+V of files in the composer
 *   Upload: direct browser → S3 via presigned PUT (@uppy/aws-s3)
 *   Recover: @uppy/golden-retriever persists state across page reloads
 */

import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from 'react';
import { useIntl } from 'react-intl';

import type { FileInfo } from '@mattermost/types/files';
import { PaperclipIcon } from '@mattermost/compass-icons/components';

import type Uppy from '@uppy/core';
import DropTarget from '@uppy/drop-target';

import WithTooltip from 'components/with_tooltip';
import KeyboardShortcutSequence, { KEYBOARD_SHORTCUTS } from 'components/keyboard_shortcuts/keyboard_shortcuts_sequence';

import { useUppyDirectUpload } from 'hooks/useUppyDirectUpload';
import { hasPlainText, createFileFromClipboardDataItem } from 'utils/paste';

import './uppy_file_upload.scss';

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
	 * Called when a file is removed from the Uppy instance.
	 * The id is the Uppy file id that was previously reported via onFilesAdded.
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
	const fileInputRef = useRef<HTMLInputElement>(null);
	const uppyRef = useRef<Uppy | null>(null);

	// Keep callback refs stable so the effect below doesn't need to re-run.
	const onFilesAddedRef = useRef(onFilesAdded);
	const onFilesRestoredRef = useRef(onFilesRestored);
	const onFileRemovedRef = useRef(onFileRemoved);
	const onUploadStartRef = useRef(onUploadStart);
	onFilesAddedRef.current = onFilesAdded;
	onFilesRestoredRef.current = onFilesRestored;
	onFileRemovedRef.current = onFileRemoved;
	onUploadStartRef.current = onUploadStart;

	useImperativeHandle(ref, () => ({
		removeFile: (uppyFileId: string) => {
			uppyRef.current?.removeFile(uppyFileId);
		},
	}), []);

	// Called by the hook once every upload batch has settled, with the
	// registered FileInfo records for the files that completed successfully.
	const handleComplete = useCallback((fileInfos: FileInfo[]) => {
		// Forward whatever the hook resolved to the composer/draft.
		onFilesUploaded(fileInfos);

		// Remove only the files that have actually finished (completed or
		// errored) so the Uppy queue (and its IndexedDB state) is cleaned up
		// without disturbing files still uploading in another batch.
		const uppy = uppyRef.current;
		uppy?.getFiles().forEach((file) => {
			if (file.progress?.uploadComplete || file.error) {
				uppy.removeFile(file.id);
			}
		});
	}, [onFilesUploaded]);

	const { uppy, uploading, progress } = useUppyDirectUpload({
		channelId,
		onComplete: handleComplete,
		onError: onUploadError,
	});

	// Keep the ref in sync so handleComplete / removeFile can reach the instance.
	uppyRef.current = uppy;

	// Wire Uppy events and the page-wide drop target. No Dashboard is mounted —
	// previews are rendered by the composer via the callbacks below.
	useEffect(() => {
		// DropTarget makes the whole page a drop zone; dropped files are added
		// to Uppy and uploaded straight away (the legacy FileUpload is mounted
		// with skipDragEvents, so this is the only active drop handler).
		uppy.use(DropTarget, { id: 'DropTarget', target: document.body });

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
			onUploadStartRef.current?.();
		});

		uppy.on('file-removed', (file) => {
			onFileRemovedRef.current?.(file.id);
		});
	}, []); // eslint-disable-line react-hooks/exhaustive-deps

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

			// Add all pasted files in a single addFiles() call so they form one
			// upload batch (one files-added event) instead of one batch per file.
			// addFiles() logs/notifies on restricted or duplicate files but does
			// not throw for valid ones, so a single bad file won't drop the rest.
			try {
				uppy.addFiles(files.map((file) => ({ name: file.name, type: file.type, data: file })));
			} catch {
				// addFiles aggregates non-restriction errors into a throw; the
				// valid files were still added, so there is nothing to recover.
			}
		}

		document.addEventListener('paste', onPaste);
		return () => document.removeEventListener('paste', onPaste);
	}, []);

	// Paperclip click → open the native file picker.
	const openFilePicker = useCallback(() => {
		if (disabled) {
			return;
		}
		fileInputRef.current?.click();
	}, [disabled]);

	// Native <input type="file"> change → hand the chosen files to Uppy.
	const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
		const input = e.target;
		const fileList = input.files;
		if (fileList && fileList.length > 0) {
			const uppy = uppyRef.current;
			if (uppy) {
				try {
					uppy.addFiles(Array.from(fileList).map((file) => ({ name: file.name, type: file.type, data: file })));
				} catch {
					// addFiles throws an aggregate error for restricted/duplicate
					// files; the valid ones were still queued.
				}
			}
		}

		// Reset so selecting the same file again still fires onChange.
		input.value = '';
	}, []);

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
					onClick={openFilePicker}
				>
					<PaperclipIcon
						size={18}
						color={'currentColor'}
						aria-label={label}
					/>
				</button>
			</WithTooltip>

			<input
				ref={fileInputRef}
				type='file'
				multiple={true}
				style={{display: 'none'}}
				onChange={handleInputChange}
				aria-hidden='true'
				tabIndex={-1}
			/>

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
						style={{width: `${progress}%`}}
					/>
				</div>
			)}
		</div>
	);
});

export default UppyFileUpload;
