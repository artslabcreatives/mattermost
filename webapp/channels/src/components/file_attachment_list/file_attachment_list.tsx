// Copyright (c) 2015-present Aura, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React, { useMemo } from 'react';

import { sortFileInfos } from 'mattermost-redux/utils/file_utils';

import FileAttachment from 'components/file_attachment';
import FilePreviewModal from 'components/file_preview_modal';
import MultiImageView from 'components/multi_image_view/multi_image_view';
import SingleImageView from 'components/single_image_view';

import { FileTypes, ModalIdentifiers } from 'utils/constants';
import { getFileType } from 'utils/utils';

import type { OwnProps, PropsFromRedux } from './index';

type Props = OwnProps & PropsFromRedux;

export default function FileAttachmentList(props: Props) {
	const handleImageClick = (indexClicked: number) => {
		props.actions.openModal({
			modalId: ModalIdentifiers.FILE_PREVIEW_MODAL,
			dialogType: FilePreviewModal,
			dialogProps: {
				postId: props.post.id,
				fileInfos: props.fileInfos,
				startIndex: indexClicked,
			},
		});
	};

	const {
		compactDisplay,
		enableSVGs,
		fileInfos,
		fileCount,
		locale,
		isInPermalink,
	} = props;

	const sortedFileInfos = useMemo(() => sortFileInfos(fileInfos ? [...fileInfos] : [], locale), [fileInfos, locale]);

	if (fileInfos.length === 0) {
		return null;
	}

	// ── Single image: full-width inline preview ──────────────────────────
	if (fileInfos && fileInfos.length === 1 && !fileInfos[0].archived) {
		const fileType = getFileType(fileInfos[0].extension);

		if (fileType === FileTypes.IMAGE || (fileType === FileTypes.SVG && enableSVGs)) {
			return (
				<SingleImageView
					fileInfo={fileInfos[0]}
					isEmbedVisible={props.isEmbedVisible}
					postId={props.post.id}
					compactDisplay={compactDisplay}
					isInPermalink={isInPermalink}
					disableActions={props.disableActions}
				/>
			);
		}
	} else if (fileCount === 1 && props.isEmbedVisible && !fileInfos?.[0]) {
		return (
			<div style={style.minHeightPlaceholder} />
		);
	}

	// ── Multiple images only: photo grid ─────────────────────────────────
	// When every non-archived attachment is an image (or SVG), show them in
	// an inline photo grid instead of the compact attachment list.
	const nonArchivedInfos = sortedFileInfos.filter((fi) => !fi.archived);
	const allImages =
		nonArchivedInfos.length > 1 &&
		nonArchivedInfos.every((fi) => {
			const ft = getFileType(fi.extension);
			return ft === FileTypes.IMAGE || (ft === FileTypes.SVG && enableSVGs);
		});

	if (allImages && !compactDisplay) {
		return (
			<MultiImageView
				fileInfos={sortedFileInfos}
				onImageClick={handleImageClick}
			/>
		);
	}

	// ── Mixed or non-image attachments: standard list ─────────────────────
	const postFiles = [];
	if (sortedFileInfos && sortedFileInfos.length > 0) {
		for (let i = 0; i < sortedFileInfos.length; i++) {
			const fileInfo = sortedFileInfos[i];
			const isDeleted = fileInfo.delete_at > 0;
			postFiles.push(
				<FileAttachment
					key={fileInfo.id}
					fileInfo={sortedFileInfos[i]}
					index={i}
					handleImageClick={handleImageClick}
					compactDisplay={compactDisplay}
					handleFileDropdownOpened={props.handleFileDropdownOpened}
					preventDownload={props.disableDownload}
					disableActions={props.disableActions}
					disableThumbnail={isDeleted}
					disablePreview={isDeleted}
					overrideGenerateFileDownloadUrl={props.overrideGenerateFileDownloadUrl}
				/>,
			);
		}
	} else if (fileCount > 0) {
		for (let i = 0; i < fileCount; i++) {
			// Add a placeholder to avoid pop-in once we get the file infos for this post
			postFiles.push(
				<div
					key={`fileCount-${i}`}
					className='post-image__column post-image__column--placeholder'
				/>,
			);
		}
	}

	return (
		<div
			data-testid='fileAttachmentList'
			className='post-image__columns clearfix'
		>
			{postFiles}
		</div>
	);
}

const style = {
	minHeightPlaceholder: { minHeight: '385px' },
};
