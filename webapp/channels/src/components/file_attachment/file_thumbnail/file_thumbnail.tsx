// Copyright (c) 2015-present Aura, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React, { memo } from 'react';

import type { FileInfo } from '@mattermost/types/files';

import { getFileThumbnailUrl, getFileUrl } from 'mattermost-redux/utils/file_utils';

import type { FilePreviewInfo } from 'components/file_preview/file_preview';

import Constants, { FileTypes } from 'utils/constants';
import { getFileTypeFromMime } from 'utils/file_utils';
import {
	getFileType,
	getIconClassName,
	isGIFImage,
} from 'utils/utils';

type FilePreviewInfoLimited = Pick<FilePreviewInfo, 'clientId' | 'name' | 'percent' | 'type'>;

type Props = {
	enableSVGs: boolean;
	fileInfo: FileInfo | FilePreviewInfo | FilePreviewInfoLimited;
	disablePreview?: boolean;
};

const FileThumbnail = ({
	fileInfo,
	enableSVGs,
	disablePreview,
}: Props) => {
	const { id, extension, has_preview_image: hasPreviewImage, width = 0, height = 0 } = (fileInfo as FileInfo);
	const mimeType = (fileInfo as FileInfo).mime_type || (fileInfo as FilePreviewInfo | FilePreviewInfoLimited).type;

	let type = FileTypes.OTHER;
	if (extension) {
		type = getFileType(extension);
	} else if (mimeType) {
		type = getFileTypeFromMime(mimeType);
	}

	if (id && !disablePreview) {
		if (type === FileTypes.IMAGE) {
			let className = 'post-image';

			if (width < Constants.THUMBNAIL_WIDTH && height < Constants.THUMBNAIL_HEIGHT) {
				className += ' small';
			} else {
				className += ' normal';
			}

			let thumbnailUrl = getFileThumbnailUrl(id);
			if (extension && isGIFImage(extension) && !hasPreviewImage) {
				thumbnailUrl = getFileUrl(id);
			}

			return (
				<div
					className={className}
					style={{
						backgroundImage: `url(${thumbnailUrl})`,
						backgroundSize: 'cover',
					}}
				/>
			);
		} else if (extension === FileTypes.SVG && enableSVGs) {
			return (
				<img
					alt={'file thumbnail image'}
					className='post-image normal'
					src={getFileUrl(id)}
				/>
			);
		} else if (type === FileTypes.VIDEO) {
			return (
				<div style={{ position: 'relative', width: '100%', height: '100%' }}>
					<video
						className='post-image normal'
						src={getFileUrl(id)}
						preload='metadata'
						style={{ objectFit: 'cover', width: '100%', height: '100%' }}
					/>
					<div style={{
						position: 'absolute',
						top: '50%',
						left: '50%',
						transform: 'translate(-50%, -50%)',
						backgroundColor: 'rgba(0, 0, 0, 0.6)',
						borderRadius: '4px',
						width: '24px',
						height: '24px',
						display: 'flex',
						alignItems: 'center',
						justifyContent: 'center',
						pointerEvents: 'none',
					}}>
						<svg width='12' height='12' viewBox='0 0 24 24' fill='none' xmlns='http://www.w3.org/2000/svg'>
							<path d='M8 5V19L19 12L8 5Z' fill='white' />
						</svg>
					</div>
				</div>
			);
		}
	}

	return <div className={'file-icon ' + getIconClassName(type)} />;
};

export default memo(FileThumbnail);
