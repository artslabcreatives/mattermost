// Copyright (c) 2015-present Aura, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React, { useCallback } from 'react';
import { useIntl } from 'react-intl';
import { useDispatch } from 'react-redux';

import { VideoOutlineIcon } from '@mattermost/compass-icons/components';

import { openModal } from 'actions/views/modals';

import type { FileUpload as FileUploadClass } from 'components/file_upload/file_upload';
import WithTooltip from 'components/with_tooltip';

import { ModalIdentifiers } from 'utils/constants';

import { IconContainer } from '../formatting_bar/formatting_icon';

import VideoNoteModal from './video_note_modal';

import './video_note_modal.scss';

type Props = {
	fileUploadRef: React.RefObject<FileUploadClass>;
	disabled?: boolean;
};

const VideoNoteButton = ({ fileUploadRef, disabled }: Props) => {
	const { formatMessage } = useIntl();
	const dispatch = useDispatch();

	const handleVideoRecorded = useCallback((file: File) => {
		fileUploadRef.current?.uploadFiles([file]);
	}, [fileUploadRef]);

	const handleClick = useCallback((e: React.MouseEvent) => {
		e.preventDefault();
		e.stopPropagation();

		dispatch(openModal({
			modalId: ModalIdentifiers.VIDEO_NOTE_MODAL,
			dialogType: VideoNoteModal,
			dialogProps: {
				onVideoRecorded: handleVideoRecorded,
			},
		}));
	}, [dispatch, handleVideoRecorded]);

	const label = formatMessage({ id: 'video_note.button.label', defaultMessage: 'Record video note' });

	return (
		<WithTooltip title={label}>
			<IconContainer
				id='videoNoteButton'
				className='videoNoteButton'
				disabled={disabled}
				onClick={handleClick}
				aria-label={label}
				type='button'
			>
				<VideoOutlineIcon
					size={18}
					color='currentColor'
				/>
			</IconContainer>
		</WithTooltip>
	);
};

export default VideoNoteButton;
