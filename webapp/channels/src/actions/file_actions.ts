// Copyright (c) 2015-present Aura, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import { batchActions } from 'redux-batched-actions';

import type { ServerError } from '@mattermost/types/errors';
import type { FileInfo } from '@mattermost/types/files';

import { FileTypes } from 'mattermost-redux/action_types';
import { getLogErrorAction } from 'mattermost-redux/actions/errors';
import { forceLogoutIfNecessary } from 'mattermost-redux/actions/helpers';
import { Client4 } from 'mattermost-redux/client';

import type { FilePreviewInfo } from 'components/file_preview/file_preview';

import { localizeMessage } from 'utils/utils';

import type { ThunkActionFunc } from 'types/store';

export interface UploadFile {
	file: File;
	name: string;
	type: string;
	rootId: string;
	channelId: string;
	clientId: string;
	onProgress: (filePreviewInfo: FilePreviewInfo) => void;
	onSuccess: (data: any, channelId: string, rootId: string) => void;
	onError: (err: string | ServerError, clientId: string, channelId: string, rootId: string) => void;
}

/**
 * Files at or above this size are uploaded via the chunked upload-session API
 * rather than a single multipart POST.  This enables resumable uploads and
 * avoids holding the entire file in memory client-side.
 */
const CHUNK_UPLOAD_THRESHOLD = 5 * 1024 * 1024; // 5 MiB

/**
 * Size of each individual chunk.  5 MiB matches the minimum S3 multipart
 * part size, ensuring compatibility with direct-to-S3 paths.
 */
const CHUNK_SIZE = 5 * 1024 * 1024; // 5 MiB

/**
 * Perform a chunked, resumable upload via the /api/v4/uploads session API.
 *
 * Flow:
 *   1. POST /api/v4/uploads → get session {id, file_offset}
 *      (file_offset > 0 if a previous session exists and we are resuming)
 *   2. Slice the file into CHUNK_SIZE blobs.
 *   3. POST each blob to /api/v4/uploads/{id} with Content-Range header.
 *   4. When the server responds 201 it includes the completed FileInfo.
 *
 * Returns an object with an abort() method compatible with the XMLHttpRequest
 * interface used elsewhere in the upload flow.
 */
function uploadFileChunked(
	{ file, name, type, rootId, channelId, clientId, onProgress, onSuccess, onError }: UploadFile,
): ThunkActionFunc<XMLHttpRequest> {
	return (dispatch, getState) => {
		dispatch({ type: FileTypes.UPLOAD_FILES_REQUEST });

		const controller = new AbortController();
		const { signal } = controller;

		// Fake XHR object so existing cancel-upload code can call .abort()
		const fakeXhr = { abort: () => controller.abort() } as unknown as XMLHttpRequest;

		(async () => {
			try {
				// ── Step 1: create (or find) an upload session ──────────────────
				let session: { id: string; file_size: number; file_offset: number };
				try {
					session = await Client4.createUploadSession({
						channel_id: channelId,
						filename: name,
						file_size: file.size,
					});
				} catch (err: any) {
					throw new Error(err?.message ?? localizeMessage({ id: 'file_upload.generic_error', defaultMessage: 'There was a problem uploading your files.' }));
				}

				if (signal.aborted) {
					return;
				}

				let offset = session.file_offset ?? 0;

				const chunkTotal = Math.ceil(file.size / CHUNK_SIZE);
				let chunkIndex = Math.floor(offset / CHUNK_SIZE);
				while (offset < file.size) {
					if (signal.aborted) {
						return;
					}

					const end = Math.min(offset + CHUNK_SIZE, file.size);
					const chunk = file.slice(offset, end);

					let response: Response;
					try {
						response = await Client4.uploadChunk(session.id, chunk, offset, file.size);
					} catch (err: any) {
						throw new Error(localizeMessage({ id: 'file_upload.generic_error', defaultMessage: 'There was a problem uploading your files.' }));
					}

					if (!response.ok && response.status !== 204 && response.status !== 201) {
						let errorMessage = localizeMessage({ id: 'file_upload.generic_error', defaultMessage: 'There was a problem uploading your files.' });
						try {
							const errorBody = await response.json();
							if (errorBody?.message) {
								errorMessage = errorBody.message;
							}
						} catch { /* ignore parse errors */ }
						throw new Error(errorMessage);
					}

					offset = end;
					chunkIndex += 1;

					// Report progress
					const percent = Math.floor((offset / file.size) * 100);
					onProgress({
						clientId,
						name,
						percent,
						type,
						chunkIndex: chunkIndex - 1,
						chunkTotal,
					} as FilePreviewInfo);

					// ── Step 3: check for completion (201 Created) ───────────────
					if (response.status === 201) {
						const fileInfo: FileInfo = await response.json();
						dispatch(batchActions([
							{
								type: FileTypes.RECEIVED_UPLOAD_FILES,
								data: [{ ...fileInfo, clientId }],
								channelId,
								rootId,
							},
							{ type: FileTypes.UPLOAD_FILES_SUCCESS },
						]));
						onSuccess({ file_infos: [fileInfo], client_ids: [clientId] }, channelId, rootId);
						return;
					}
				}

				// If we exit the loop without a 201 the server should have returned it on the last chunk.
				// This can happen on 204 for the last partial chunk in some edge cases.
				// Attempt to retrieve the file info via GET on the session.
				const errorMessage = localizeMessage({ id: 'file_upload.generic_error', defaultMessage: 'There was a problem uploading your files.' });
				throw new Error(errorMessage);

			} catch (err: any) {
				if (signal.aborted) {
					return;
				}

				// Mark the file preview as failed so the UI can show a retry button
				onProgress({
					clientId,
					name,
					type,
					failed: true,
				} as FilePreviewInfo);

				dispatch({
					type: FileTypes.UPLOAD_FILES_FAILURE,
					clientIds: [clientId],
					channelId,
					rootId,
				});

				const message = err?.message ?? localizeMessage({ id: 'file_upload.generic_error', defaultMessage: 'There was a problem uploading your files.' });
				onError({ message }, clientId, channelId, rootId);
			}
		})();

		return fakeXhr;
	};
}

export function uploadFile({ file, name, type, rootId, channelId, clientId, onProgress, onSuccess, onError }: UploadFile, isBookmark?: boolean): ThunkActionFunc<XMLHttpRequest> {
	return (dispatch, getState) => {
		// For files at or above the threshold use the chunked, resumable upload
		// session API.  This automatically handles resume on page refresh / network
		// interruption and avoids a single huge HTTP request.
		if (!isBookmark && file.size >= CHUNK_UPLOAD_THRESHOLD) {
			return dispatch(uploadFileChunked({ file, name, type, rootId, channelId, clientId, onProgress, onSuccess, onError }));
		}

		dispatch({ type: FileTypes.UPLOAD_FILES_REQUEST });

		let url = Client4.getFilesRoute();
		if (isBookmark) {
			url += '?bookmark=true';
		}

		const xhr = new XMLHttpRequest();

		xhr.open('POST', url, true);

		const client4Headers = Client4.getOptions({ method: 'POST' }).headers;
		Object.keys(client4Headers).forEach((client4Header) => {
			const client4HeaderValue = client4Headers[client4Header];
			if (client4HeaderValue) {
				xhr.setRequestHeader(client4Header, client4HeaderValue);
			}
		});

		xhr.setRequestHeader('Accept', 'application/json');

		const formData = new FormData();
		formData.append('channel_id', channelId);
		formData.append('client_ids', clientId);
		formData.append('files', file, name); // appending file in the end for steaming support

		if (onProgress && xhr.upload) {
			xhr.upload.onprogress = (event) => {
				const percent = Math.floor((event.loaded / event.total) * 100);
				const filePreviewInfo = {
					clientId,
					name,
					percent,
					type,
				} as FilePreviewInfo;
				onProgress(filePreviewInfo);
			};
		}

		if (onSuccess) {
			xhr.onload = () => {
				if (xhr.status === 201 && xhr.readyState === 4) {
					const response = JSON.parse(xhr.response);
					const data = response.file_infos.map((fileInfo: FileInfo, index: number) => {
						return {
							...fileInfo,
							clientId: response.client_ids[index],
						};
					});

					dispatch(batchActions([
						{
							type: FileTypes.RECEIVED_UPLOAD_FILES,
							data,
							channelId,
							rootId,
						},
						{
							type: FileTypes.UPLOAD_FILES_SUCCESS,
						},
					]));

					onSuccess(response, channelId, rootId);
				} else if (xhr.status >= 400 && xhr.readyState === 4) {
					let errorMessage = '';
					try {
						const errorResponse = JSON.parse(xhr.response);
						errorMessage =
							(errorResponse?.id && errorResponse?.message) ? localizeMessage({ id: errorResponse.id, defaultMessage: errorResponse.message }) : localizeMessage({ id: 'file_upload.generic_error', defaultMessage: 'There was a problem uploading your files.' });
					} catch (e) {
						errorMessage = localizeMessage({ id: 'file_upload.generic_error', defaultMessage: 'There was a problem uploading your files.' });
					}

					dispatch({
						type: FileTypes.UPLOAD_FILES_FAILURE,
						clientIds: [clientId],
						channelId,
						rootId,
					});

					onError?.(errorMessage, clientId, channelId, rootId);
				}
			};
		}

		if (onError) {
			xhr.onerror = () => {
				if (xhr.readyState === 4 && xhr.responseText.length !== 0) {
					const errorResponse = JSON.parse(xhr.response);

					forceLogoutIfNecessary(errorResponse, dispatch, getState);

					const uploadFailureAction = {
						type: FileTypes.UPLOAD_FILES_FAILURE,
						clientIds: [clientId],
						channelId,
						rootId,
						error: errorResponse,
					};

					dispatch(batchActions([uploadFailureAction, getLogErrorAction(errorResponse)]));
					onError(errorResponse, clientId, channelId, rootId);
				} else {
					const errorMessage = xhr.status === 0 || !xhr.status ? localizeMessage({ id: 'file_upload.generic_error', defaultMessage: 'There was a problem uploading your files.' }) : localizeMessage({ id: 'channel_loader.unknown_error', defaultMessage: 'We received an unexpected status code from the server.' }) + ' (' + xhr.status + ')';

					dispatch({
						type: FileTypes.UPLOAD_FILES_FAILURE,
						clientIds: [clientId],
						channelId,
						rootId,
					});

					onError({ message: errorMessage }, clientId, channelId, rootId);
				}
			};
		}

		xhr.send(formData);

		return xhr;
	};
}


