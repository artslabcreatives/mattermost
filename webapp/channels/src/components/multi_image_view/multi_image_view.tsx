// Copyright (c) 2015-present Aura, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

/**
 * MultiImageView renders 2–N image attachments as an inline photo grid.
 *
 * Layouts:
 *   2 images  – side by side  (1×2)
 *   3 images  – one large left, two stacked right  (1+2)
 *   4+ images – 2×2 tile grid; last tile shows "+N more" overlay when there
 *               are more than 4 images
 *
 * Clicking any tile opens the FilePreviewModal starting at that image.
 */
import classNames from 'classnames';
import React, { useCallback } from 'react';

import type { FileInfo } from '@mattermost/types/files';

import { getFileThumbnailUrl } from 'mattermost-redux/utils/file_utils';

import './multi_image_view.scss';

const MAX_VISIBLE = 4;

type Props = {
	fileInfos: FileInfo[];
	onImageClick: (index: number) => void;
};

function ImageTile({ fileInfo, index, onImageClick, extra }: {
	fileInfo: FileInfo;
	index: number;
	onImageClick: (i: number) => void;
	/** Content rendered on top of the thumbnail (e.g. "+3 more" badge). */
	extra?: React.ReactNode;
}) {
	const handleClick = useCallback((e: React.MouseEvent) => {
		e.preventDefault();
		onImageClick(index);
	}, [index, onImageClick]);

	const thumbnailUrl = getFileThumbnailUrl(fileInfo.id);

	return (
		<a
			href='#'
			className='multi-image-view__tile'
			onClick={handleClick}
			aria-label={fileInfo.name}
		>
			<div
				className='multi-image-view__thumb'
				style={{ backgroundImage: `url(${thumbnailUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' }}
			/>
			{extra && (
				<div className='multi-image-view__overlay'>
					{extra}
				</div>
			)}
		</a>
	);
}

export default function MultiImageView({ fileInfos, onImageClick }: Props) {
	const total = fileInfos.length;
	const shown = Math.min(total, MAX_VISIBLE);
	const overflow = total - MAX_VISIBLE;

	if (total < 2) {
		return null;
	}

	const tiles = fileInfos.slice(0, shown).map((fileInfo, i) => {
		const isLastVisible = i === shown - 1 && overflow > 0;
		return (
			<ImageTile
				key={fileInfo.id}
				fileInfo={fileInfo}
				index={i}
				onImageClick={onImageClick}
				extra={isLastVisible ? <span className='multi-image-view__more'>+{overflow}</span> : undefined}
			/>
		);
	});

	return (
		<div
			className={classNames('multi-image-view', {
				[`multi-image-view--${Math.min(total, MAX_VISIBLE)}`]: true,
			})}
		>
			{tiles}
		</div>
	);
}
