// Copyright (c) 2015-present Aura, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React from 'react';
import { ProgressBar } from 'react-bootstrap';
import { FormattedMessage } from 'react-intl';

import FilenameOverlay from 'components/file_attachment/filename_overlay';

import { getFileTypeFromMime } from 'utils/file_utils';
import * as Utils from 'utils/utils';

import type { FilePreviewInfo } from './file_preview';

type Props = {
	handleRemove: (id: string) => void;
	onRetry?: (clientId: string) => void;
	clientId: string;
	fileInfo: FilePreviewInfo;
}

export default class FileProgressPreview extends React.PureComponent<Props> {
	handleRemove = () => {
		this.props.handleRemove(this.props.clientId);
	};

	handleRetry = () => {
		this.props.onRetry?.(this.props.clientId);
	};

	render() {
		let percent = 0;
		let fileNameComponent;
		let previewImage;
		let progressBar;
		const { fileInfo, clientId } = this.props;

		if (fileInfo) {
			percent = fileInfo.percent ? fileInfo.percent : 0;
			const fileType = getFileTypeFromMime(fileInfo.type || '');
			previewImage = <div className={'file-icon ' + Utils.getIconClassName(fileType)} />;

			if (fileInfo.failed) {
				fileNameComponent = (
					<>
						<FilenameOverlay
							fileInfo={fileInfo}
							compactDisplay={false}
							canDownload={false}
						/>
						<span className='post-image__uploadingTxt post-image__uploadingTxt--failed'>
							<FormattedMessage
								id='file_upload.failed'
								defaultMessage='Upload failed'
							/>
						</span>
					</>
				);

				progressBar = this.props.onRetry ? (
					<button
						className='btn btn-sm btn-link post-image__retryBtn'
						onClick={this.handleRetry}
					>
						<i className='icon icon-refresh' />
						<FormattedMessage
							id='file_upload.try_again'
							defaultMessage='Try again'
						/>
					</button>
				) : null;
			} else {
				const percentTxt = ` (${percent.toFixed(0)}%)`;

				// Show chunk progress if available: "Chunk 3/10"
				let chunkInfo = null;
				if (fileInfo.chunkTotal && fileInfo.chunkTotal > 1 && !fileInfo.failed) {
					const current = fileInfo.chunkIndex != null ? fileInfo.chunkIndex + 1 : 1;
					chunkInfo = (
						<span className='post-image__chunkInfo'>
							<FormattedMessage
								id='file_upload.chunk_progress'
								defaultMessage='Part {current}/{total}'
								values={{ current, total: fileInfo.chunkTotal }}
							/>
						</span>
					);
				}

				fileNameComponent = (
					<>
						<FilenameOverlay
							fileInfo={fileInfo}
							compactDisplay={false}
							canDownload={false}
						/>
						<span className='post-image__uploadingTxt'>
							{percent === 100 ? (
								<FormattedMessage
									id='create_post.fileProcessing'
									defaultMessage='Processing...'
								/>
							) : (
								<>
									<FormattedMessage
										id='admin.plugin.uploading'
										defaultMessage='Uploading...'
									/>
									<span>{percentTxt}</span>
									{chunkInfo}
								</>
							)}
						</span>
					</>
				);

				if (percent) {
					progressBar = (
						<ProgressBar
							className='post-image__progressBar'
							now={percent}
							active={percent === 100}
						/>
					);
				}
			}
		}

		return (
			<div
				ref={clientId}
				key={clientId}
				className={`file-preview post-image__column${fileInfo?.failed ? ' post-image__column--failed' : ''}`}
				data-client-id={clientId}
			>
				<div className='post-image__thumbnail'>
					{previewImage}
				</div>
				<div className='post-image__details'>
					<div className='post-image__detail_wrapper'>
						<div className='post-image__detail'>
							{fileNameComponent}
						</div>
					</div>
					<div>
						<a
							className='file-preview__remove'
							onClick={this.handleRemove}
						>
							<i className='icon icon-close' />
						</a>
					</div>
					{progressBar}
				</div>
			</div>
		);
	}
}
