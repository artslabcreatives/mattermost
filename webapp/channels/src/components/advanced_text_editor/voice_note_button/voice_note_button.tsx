// Copyright (c) 2015-present Aura, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import classNames from 'classnames';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useIntl } from 'react-intl';

import { MicrophoneOutlineIcon, RecordCircleOutlineIcon } from '@mattermost/compass-icons/components';

import type { FileUpload as FileUploadClass } from 'components/file_upload/file_upload';
import WithTooltip from 'components/with_tooltip';

import { IconContainer } from '../formatting_bar/formatting_icon';

import './voice_note_button.scss';

type Props = {
	fileUploadRef: React.RefObject<FileUploadClass>;
	disabled?: boolean;
};

const VoiceNoteButton = ({ fileUploadRef, disabled }: Props) => {
	const { formatMessage } = useIntl();
	const [isRecording, setIsRecording] = useState(false);
	const [seconds, setSeconds] = useState(0);
	const mediaRecorderRef = useRef<MediaRecorder | null>(null);
	const chunksRef = useRef<Blob[]>([]);
	const timerRef = useRef<NodeJS.Timeout | null>(null);

	useEffect(() => {
		return () => {
			if (timerRef.current) {
				clearInterval(timerRef.current);
			}
			if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
				mediaRecorderRef.current.stop();
			}
		};
	}, []);

	const startRecording = useCallback(async () => {
		try {
			const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
			chunksRef.current = [];

			const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/ogg';
			const recorder = new MediaRecorder(stream, { mimeType });

			recorder.ondataavailable = (e) => {
				if (e.data.size > 0) {
					chunksRef.current.push(e.data);
				}
			};

			recorder.onstop = () => {
				stream.getTracks().forEach((track) => track.stop());
				const blob = new Blob(chunksRef.current, { type: mimeType });
				const ext = mimeType.includes('webm') ? 'webm' : 'ogg';
				const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
				const file = new File([blob], `voice-note-${timestamp}.${ext}`, { type: mimeType });
				fileUploadRef.current?.uploadFiles([file]);
			};

			mediaRecorderRef.current = recorder;
			recorder.start();
			setIsRecording(true);
			setSeconds(0);

			timerRef.current = setInterval(() => {
				setSeconds((s) => s + 1);
			}, 1000);
		} catch {
			// User denied microphone permission or not available
		}
	}, [fileUploadRef]);

	const stopRecording = useCallback(() => {
		if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
			mediaRecorderRef.current.stop();
		}
		if (timerRef.current) {
			clearInterval(timerRef.current);
			timerRef.current = null;
		}
		setIsRecording(false);
		setSeconds(0);
	}, []);

	const handleClick = useCallback((e: React.MouseEvent) => {
		e.preventDefault();
		e.stopPropagation();
		if (isRecording) {
			stopRecording();
		} else {
			startRecording();
		}
	}, [isRecording, startRecording, stopRecording]);

	const formatTime = (s: number) => {
		const m = Math.floor(s / 60);
		const sec = s % 60;
		return `${m}:${sec < 10 ? '0' : ''}${sec}`;
	};

	const label = isRecording
		? formatMessage({ id: 'voice_note.stop', defaultMessage: 'Stop recording' })
		: formatMessage({ id: 'voice_note.record', defaultMessage: 'Record voice note' });

	return (
		<WithTooltip title={label}>
			<IconContainer
				id='voiceNoteButton'
				className={classNames('voiceNoteButton', { recording: isRecording })}
				disabled={disabled && !isRecording}
				onClick={handleClick}
				aria-label={label}
				type='button'
			>
				{isRecording ? (
					<span className='voiceNoteButton__recording'>
						<RecordCircleOutlineIcon
							size={18}
							color='var(--error-text)'
						/>
						<span className='voiceNoteButton__timer'>{formatTime(seconds)}</span>
					</span>
				) : (
					<MicrophoneOutlineIcon
						size={18}
						color='currentColor'
					/>
				)}
			</IconContainer>
		</WithTooltip>
	);
};

export default VoiceNoteButton;
