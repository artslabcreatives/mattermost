// Copyright (c) 2015-present Aura, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useIntl } from 'react-intl';

import { GenericModal } from '@mattermost/components';
import { RecordCircleOutlineIcon, RecordSquareOutlineIcon } from '@mattermost/compass-icons/components';

import './video_note_modal.scss';

type Props = {
	onExited?: () => void;
	onVideoRecorded: (file: File) => void;
};

const VideoNoteModal = ({ onExited, onVideoRecorded }: Props) => {
	const { formatMessage } = useIntl();
	const [isRecording, setIsRecording] = useState(false);
	const [seconds, setSeconds] = useState(0);
	const [hasRecording, setHasRecording] = useState(false);
	const [permissionError, setPermissionError] = useState(false);

	const videoPreviewRef = useRef<HTMLVideoElement>(null);
	const mediaRecorderRef = useRef<MediaRecorder | null>(null);
	const streamRef = useRef<MediaStream | null>(null);
	const chunksRef = useRef<Blob[]>([]);
	const timerRef = useRef<NodeJS.Timeout | null>(null);
	const recordedBlobRef = useRef<Blob | null>(null);

	// Start camera preview on mount
	useEffect(() => {
		const startPreview = async () => {
			try {
				const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
				streamRef.current = stream;
				if (videoPreviewRef.current) {
					videoPreviewRef.current.srcObject = stream;
				}
			} catch {
				setPermissionError(true);
			}
		};

		startPreview();

		return () => {
			// Cleanup stream on unmount
			streamRef.current?.getTracks().forEach((t) => t.stop());
			if (timerRef.current) {
				clearInterval(timerRef.current);
			}
		};
	}, []);

	const startRecording = useCallback(() => {
		if (!streamRef.current) {
			return;
		}
		chunksRef.current = [];
		recordedBlobRef.current = null;
		setHasRecording(false);

		const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
			? 'video/webm;codecs=vp9,opus'
			: 'video/webm';

		const recorder = new MediaRecorder(streamRef.current, { mimeType });

		recorder.ondataavailable = (e) => {
			if (e.data.size > 0) {
				chunksRef.current.push(e.data);
			}
		};

		recorder.onstop = () => {
			const blob = new Blob(chunksRef.current, { type: 'video/webm' });
			recordedBlobRef.current = blob;
			setHasRecording(true);
		};

		mediaRecorderRef.current = recorder;
		recorder.start();
		setIsRecording(true);
		setSeconds(0);

		timerRef.current = setInterval(() => {
			setSeconds((s) => s + 1);
		}, 1000);
	}, []);

	const stopRecording = useCallback(() => {
		if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
			mediaRecorderRef.current.stop();
		}
		if (timerRef.current) {
			clearInterval(timerRef.current);
			timerRef.current = null;
		}
		setIsRecording(false);
	}, []);

	const handleSend = useCallback(() => {
		if (!recordedBlobRef.current) {
			return;
		}
		const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
		const file = new File([recordedBlobRef.current], `video-note-${timestamp}.webm`, { type: 'video/webm' });
		onVideoRecorded(file);
	}, [onVideoRecorded]);

	const formatTime = (s: number) => {
		const m = Math.floor(s / 60);
		const sec = s % 60;
		return `${m}:${sec < 10 ? '0' : ''}${sec}`;
	};

	return (
		<GenericModal
			className='a11y__modal video-note-modal'
			id='video-note-modal'
			show={true}
			compassDesign={true}
			modalHeaderText={formatMessage({ id: 'video_note.modal.title', defaultMessage: 'Record Video Note' })}
			confirmButtonText={hasRecording
				? formatMessage({ id: 'video_note.modal.send', defaultMessage: 'Send' })
				: formatMessage({ id: 'video_note.modal.send_disabled', defaultMessage: 'Send' })}
			cancelButtonText={formatMessage({ id: 'video_note.modal.cancel', defaultMessage: 'Cancel' })}
			isConfirmDisabled={!hasRecording}
			handleConfirm={handleSend}
			handleCancel={onExited}
			onExited={onExited}
		>
			<div className='video-note-modal__body'>
				{permissionError ? (
					<div className='video-note-modal__permission-error'>
						{formatMessage({
							id: 'video_note.modal.permission_error',
							defaultMessage: 'Camera or microphone permission was denied. Please allow access in your browser settings.',
						})}
					</div>
				) : (
					<>
						<div className='video-note-modal__preview-container'>
							<video
								ref={videoPreviewRef}
								className='video-note-modal__preview'
								autoPlay={true}
								muted={true}
								playsInline={true}
							/>
							{isRecording && (
								<div className='video-note-modal__recording-badge'>
									<RecordCircleOutlineIcon
										size={16}
										color='white'
									/>
									<span>{formatTime(seconds)}</span>
								</div>
							)}
						</div>
						<div className='video-note-modal__controls'>
							{!isRecording ? (
								<button
									className='btn btn-primary video-note-modal__record-btn'
									onClick={startRecording}
									type='button'
								>
									<RecordCircleOutlineIcon
										size={16}
										color='white'
									/>
									{hasRecording
										? formatMessage({ id: 'video_note.modal.re_record', defaultMessage: 'Re-record' })
										: formatMessage({ id: 'video_note.modal.start', defaultMessage: 'Start Recording' })}
								</button>
							) : (
								<button
									className='btn btn-danger video-note-modal__stop-btn'
									onClick={stopRecording}
									type='button'
								>
									<RecordSquareOutlineIcon
										size={16}
										color='white'
									/>
									{formatMessage({ id: 'video_note.modal.stop', defaultMessage: 'Stop Recording' })}
								</button>
							)}
						</div>
						{hasRecording && (
							<p className='video-note-modal__ready'>
								{formatMessage({ id: 'video_note.modal.ready', defaultMessage: 'Video note ready. Click Send to attach it to your message.' })}
							</p>
						)}
					</>
				)}
			</div>
		</GenericModal>
	);
};

export default VideoNoteModal;
