// Copyright (c) 2015-present Aura, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React, { useCallback, useRef, useState } from 'react';
import { useSelector } from 'react-redux';

import type { ServerError } from '@mattermost/types/errors';
import type { FileInfo } from '@mattermost/types/files';

import { sortFileInfos } from 'mattermost-redux/utils/file_utils';
import { getConfig } from 'mattermost-redux/selectors/entities/general';

import { getCurrentLocale } from 'selectors/i18n';

import FilePreview from 'components/file_preview';
import type { FilePreviewInfo } from 'components/file_preview/file_preview';
import FileUpload from 'components/file_upload';
import type { FileUpload as FileUploadClass, TextEditorLocationType } from 'components/file_upload/file_upload';
import UppyFileUpload from 'components/uppy_file_upload';
import type TextboxClass from 'components/textbox/textbox';

import type { GlobalState } from 'types/store';
import type { PostDraft } from 'types/store/draft';

const getFileCount = (draft: PostDraft) => {
	return draft.fileInfos.length + draft.uploadsInProgress.length;
};

const useUploadFiles = (
	draft: PostDraft,
	postId: string,
	channelId: string,
	isThreadView: boolean,
	storedDrafts: React.MutableRefObject<Record<string, PostDraft | undefined>>,
	isDisabled: boolean,
	textboxRef: React.RefObject<TextboxClass>,
	handleDraftChange: (draft: PostDraft, options?: { instant?: boolean; show?: boolean }) => void,
	focusTextbox: (forceFocust?: boolean) => void,
	setServerError: (err: (ServerError & { submittedMessage?: string }) | null) => void,
	isPostBeingEdited?: boolean,
): [React.ReactNode, React.ReactNode, React.RefObject<FileUploadClass>] => {
	const locale = useSelector(getCurrentLocale);
	const enableDirectUploads = useSelector((state: GlobalState) => getConfig(state).EnableDirectUploads === 'true');

	const [uploadsProgressPercent, setUploadsProgressPercent] = useState<{ [clientID: string]: FilePreviewInfo }>({});

	// Stores the original File object for each in-progress upload keyed by clientId.
	// This is used to restart failed uploads without the user having to re-select the file.
	const pendingUploadFiles = useRef<Record<string, { file: File; name: string; type: string }>>({});

	const fileUploadRef = useRef<FileUploadClass>(null);

	const handleFileUploadChange = useCallback(() => {
		focusTextbox();
	}, [focusTextbox]);

	const getFileUploadTarget = useCallback(() => {
		return textboxRef.current?.getInputBox();
	}, [textboxRef]);

	const handleUploadProgress = useCallback((filePreviewInfo: FilePreviewInfo) => {
		setUploadsProgressPercent((prev) => ({
			...prev,
			[filePreviewInfo.clientId]: filePreviewInfo,
		}));
	}, []);

	// Store each file's reference as soon as it is queued so we can retry later.
	const handleUploadQueued = useCallback((clientId: string, file: File, name: string, type: string) => {
		pendingUploadFiles.current[clientId] = { file, name, type };
	}, []);

	const handleFileUploadComplete = useCallback((fileInfos: FileInfo[], clientIds: string[], channelId: string, rootId?: string) => {
		const key = rootId || channelId;
		const draftToUpdate = storedDrafts.current[key];
		if (!draftToUpdate) {
			return;
		}

		const newFileInfos = sortFileInfos([...draftToUpdate.fileInfos || [], ...fileInfos], locale);

		const clientIdsSet = new Set(clientIds);
		const uploadsInProgress = (draftToUpdate.uploadsInProgress || []).filter((v) => !clientIdsSet.has(v));

		const modifiedDraft = {
			...draftToUpdate,
			fileInfos: newFileInfos,
			uploadsInProgress,
		};

		handleDraftChange(modifiedDraft, { instant: true });

		// Clean up progress state and stored file refs for completed uploads
		clientIds.forEach((id) => {
			Reflect.deleteProperty(pendingUploadFiles.current, id);
		});
		setUploadsProgressPercent((prev) => {
			const updated = { ...prev };
			clientIds.forEach((id) => Reflect.deleteProperty(updated, id));
			return updated;
		});
	}, [locale, handleDraftChange, storedDrafts]);

	// Called by UppyFileUpload when direct-to-S3 uploads complete.
	// We bypass handleFileUploadComplete here because that function silently
	// exits when no draft exists yet (user hasn't typed anything).  Instead
	// we look up — or create — the draft directly and merge the new file infos.
	const handleUppyFilesUploaded = useCallback((fileInfos: FileInfo[]) => {
		const key = postId || channelId;
		const existing = storedDrafts.current[key] ?? { message: '', fileInfos: [], uploadsInProgress: [] };
		const newFileInfos = sortFileInfos([...existing.fileInfos, ...fileInfos], locale);
		handleDraftChange({ ...existing, fileInfos: newFileInfos }, { instant: true, show: true });
	}, [channelId, postId, storedDrafts, locale, handleDraftChange]);
	const handleUploadStart = useCallback((clientIds: string[]) => {
		const uploadsInProgress = [...draft.uploadsInProgress, ...clientIds];

		const updatedDraft = {
			...draft,
			uploadsInProgress,
		};

		handleDraftChange(updatedDraft, { instant: true });

		focusTextbox();
	}, [draft, handleDraftChange, focusTextbox]);

	const handleUploadError = useCallback((uploadError: string | ServerError | null, clientId?: string, channelId = '', rootId = '') => {
		// When a specific file fails, keep it in uploadsInProgress so the
		// preview remains visible with a 'failed' state and a retry button.
		// The file will be removed from uploadsInProgress either when the
		// user retries (and it eventually succeeds) or when they click ✕.

		if (typeof uploadError === 'string') {
			if (uploadError) {
				setServerError(new Error(uploadError));
			}
		} else {
			setServerError(uploadError);
		}
	}, [setServerError]);

	const handleRetry = useCallback((clientId: string) => {
		const pending = pendingUploadFiles.current[clientId];
		if (!pending) {
			return;
		}

		// Clear the error banner and reset the preview to uploading state.
		setServerError(null);
		setUploadsProgressPercent((prev) => {
			const updated = { ...prev };
			if (updated[clientId]) {
				updated[clientId] = { ...updated[clientId], failed: false, percent: 0, chunkIndex: 0 };
			}
			return updated;
		});

		fileUploadRef.current?.retryUpload(clientId, pending.file, pending.name, pending.type);
	}, [setServerError]);

	const removePreview = useCallback((clientId: string) => {
		// Clean up failed upload file ref if present
		Reflect.deleteProperty(pendingUploadFiles.current, clientId);

		// Clear any error banner when user removes a file
		setServerError(null);

		const modifiedDraft = { ...draft };
		let index = draft.fileInfos.findIndex((info) => info.id === clientId);
		if (index === -1) {
			index = draft.uploadsInProgress.indexOf(clientId);

			if (index >= 0) {
				modifiedDraft.uploadsInProgress = [...draft.uploadsInProgress];
				modifiedDraft.uploadsInProgress.splice(index, 1);

				fileUploadRef.current?.cancelUpload(clientId);
			} else {
				// No modification
				return;
			}
		} else {
			modifiedDraft.fileInfos = [...draft.fileInfos];
			modifiedDraft.fileInfos.splice(index, 1);
		}

		// Remove the progress record too so the preview fully disappears
		setUploadsProgressPercent((prev) => {
			const updated = { ...prev };
			Reflect.deleteProperty(updated, clientId);
			return updated;
		});

		handleDraftChange(modifiedDraft, { instant: true });
		handleFileUploadChange();
	}, [draft, fileUploadRef, handleDraftChange, setServerError, handleFileUploadChange]);

	let attachmentPreview = null;
	if (!isDisabled && (draft.fileInfos.length > 0 || draft.uploadsInProgress.length > 0)) {
		attachmentPreview = (
			<FilePreview
				fileInfos={draft.fileInfos}
				onRemove={removePreview}
				onRetry={handleRetry}
				uploadsInProgress={draft.uploadsInProgress}
				uploadsProgressPercent={uploadsProgressPercent}
			/>
		);
	}

	let postType: TextEditorLocationType = 'post';
	if (isPostBeingEdited) {
		postType = 'edit_post';
	} else if (postId) {
		postType = isThreadView ? 'thread' : 'comment';
	}

	let fileUploadJSX: React.ReactNode = null;
	if (!isDisabled) {
		if (enableDirectUploads) {
			fileUploadJSX = (
				<>
					{/* Hidden FileUpload keeps the ref alive so VoiceNoteButton/VideoNoteButton
					    can still record and upload audio/video via the legacy path. */}
					<span className='FileUpload--hidden'>
						<FileUpload
							ref={fileUploadRef}
							fileCount={getFileCount(draft)}
							getTarget={getFileUploadTarget}
							onFileUploadChange={handleFileUploadChange}
							onUploadStart={handleUploadStart}
							onUploadQueued={handleUploadQueued}
							onFileUpload={handleFileUploadComplete}
							onUploadError={handleUploadError}
							onUploadProgress={handleUploadProgress}
							rootId={postId}
							channelId={channelId}
							postType={postType}
						/>
					</span>
					{/* Visible Uppy Dashboard — replaces the legacy attachment button. */}
					<UppyFileUpload
						channelId={channelId}
						onFilesUploaded={handleUppyFilesUploaded}
						onUploadError={(err) => setServerError(err)}
					/>
				</>
			);
		} else {
			fileUploadJSX = (
				<FileUpload
					ref={fileUploadRef}
					fileCount={getFileCount(draft)}
					getTarget={getFileUploadTarget}
					onFileUploadChange={handleFileUploadChange}
					onUploadStart={handleUploadStart}
					onUploadQueued={handleUploadQueued}
					onFileUpload={handleFileUploadComplete}
					onUploadError={handleUploadError}
					onUploadProgress={handleUploadProgress}
					rootId={postId}
					channelId={channelId}
					postType={postType}
				/>
			);
		}
	}

	return [attachmentPreview, fileUploadJSX, fileUploadRef];
};

export default useUploadFiles;
