// Copyright (c) 2015-present Aura, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React, { useEffect, useState } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import { useDispatch } from 'react-redux';

import { GenericModal } from '@mattermost/components';
import type { Post, PostSeenReceipts } from '@mattermost/types/posts';

import { Client4 } from 'mattermost-redux/client';
import { fetchPostSeenReceipts } from 'actions/views/post_seen';

import Avatar from 'components/widgets/users/avatar';
import Timestamp from 'components/timestamp';
import LoadingSpinner from 'components/widgets/loading/loading_spinner';

import './message_info_modal.scss';

type Props = {
	post: Post;
	onExited?: () => void;
};

export const DoubleCheckIcon = ({ size = 15, color = '#38bdf8' }: { size?: number; color?: string }) => (
	<svg
		width={size}
		height={size}
		viewBox='0 0 24 24'
		fill='none'
		stroke={color}
		strokeWidth='2.3'
		strokeLinecap='round'
		strokeLinejoin='round'
		style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}
		aria-hidden='true'
	>
		<path d='M18 6L7 17l-5-5' />
		<path d='M22 10l-7.5 7.5-2-2' />
	</svg>
);

export const SingleCheckIcon = ({ size = 15, color = 'currentColor' }: { size?: number; color?: string }) => (
	<svg
		width={size}
		height={size}
		viewBox='0 0 24 24'
		fill='none'
		stroke={color}
		strokeWidth='2.3'
		strokeLinecap='round'
		strokeLinejoin='round'
		style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}
		aria-hidden='true'
	>
		<path d='M20 6L9 17l-5-5' />
	</svg>
);

const ClockIcon = () => (
	<svg
		width='12'
		height='12'
		viewBox='0 0 24 24'
		fill='none'
		stroke='currentColor'
		strokeWidth='2'
		strokeLinecap='round'
		strokeLinejoin='round'
		style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0, opacity: 0.7 }}
		aria-hidden='true'
	>
		<circle cx='12' cy='12' r='10' />
		<polyline points='12 6 12 12 16 14' />
	</svg>
);

const AttachmentIcon = () => (
	<svg
		width='15'
		height='15'
		viewBox='0 0 24 24'
		fill='none'
		stroke='currentColor'
		strokeWidth='2'
		strokeLinecap='round'
		strokeLinejoin='round'
		style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}
		aria-hidden='true'
	>
		<path d='M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48' />
	</svg>
);

export default function MessageInfoModal({ post, onExited }: Props) {
	const { formatDate, formatTime } = useIntl();
	const dispatch = useDispatch();

	const [loading, setLoading] = useState(true);
	const [receipts, setReceipts] = useState<PostSeenReceipts | null>(null);
	const [activeTab, setActiveTab] = useState<'read' | 'delivered'>('read');
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let isMounted = true;

		async function loadReceipts() {
			setLoading(true);
			const result = await dispatch(fetchPostSeenReceipts(post.id));
			if (!isMounted) {
				return;
			}
			setLoading(false);

			if (result.error) {
				setError(result.error.message || 'Failed to load read receipts');
			} else if (result.data) {
				setReceipts(result.data);
				if (result.data.read_by.length === 0 && result.data.delivered_to.length > 0) {
					setActiveTab('delivered');
				}
			}
		}

		loadReceipts();

		return () => {
			isMounted = false;
		};
	}, [post.id, dispatch]);

	const readCount = receipts?.read_by.length || 0;
	const deliveredCount = receipts?.delivered_to.length || 0;
	const attachmentCount = post.file_ids?.length || 0;
	const hasAttachments = attachmentCount > 0;

	const customHeader = (
		<div className='message-info-header'>
			<div className='message-info-header__icon-box'>
				<DoubleCheckIcon size={18} color='#38bdf8' />
			</div>
			<div className='message-info-header__titles'>
				<span className='message-info-header__title'>
					<FormattedMessage id='post.message_info.title' defaultMessage='Message Info' />
				</span>
				<span className='message-info-header__subtitle'>
					<FormattedMessage id='post.message_info.subtitle' defaultMessage='Seen & delivery receipts' />
				</span>
			</div>
		</div>
	);

	return (
		<GenericModal
			id='messageInfoModal'
			className='message-info-modal'
			modalHeaderText={customHeader}
			onExited={onExited}
		>
			<div className='message-info-modal__body'>
				{/* Message Preview Card */}
				<div className='message-info-modal__preview-card'>
					{post.message ? (
						<div className='message-info-modal__preview-text'>
							{post.message}
						</div>
					) : null}

					{hasAttachments && (
						<div className='message-info-modal__attachment-pill'>
							<AttachmentIcon />
							<span>
								<FormattedMessage
									id='post.message_info.files_attached'
									defaultMessage='{count, plural, one {# file attached} other {# files attached}}'
									values={{ count: attachmentCount }}
								/>
							</span>
						</div>
					)}

					<div className='message-info-modal__preview-meta'>
						<ClockIcon />
						<span>
							<FormattedMessage
								id='post.message_info.sent_at'
								defaultMessage='Sent {date} at {time}'
								values={{
									date: formatDate(post.create_at, { month: 'short', day: 'numeric', year: 'numeric' }),
									time: formatTime(post.create_at, { hour: 'numeric', minute: '2-digit' }),
								}}
							/>
						</span>
					</div>
				</div>

				{/* Segmented iOS / Telegram Style Tabs */}
				<div className='message-info-modal__segmented-control'>
					<button
						type='button'
						className={`message-info-modal__segment ${activeTab === 'read' ? 'message-info-modal__segment--active' : ''}`}
						onClick={() => setActiveTab('read')}
					>
						<DoubleCheckIcon size={16} color={activeTab === 'read' ? '#38bdf8' : 'rgba(var(--center-channel-color-rgb), 0.5)'} />
						<span>
							<FormattedMessage
								id='post.message_info.read_by'
								defaultMessage='Read by'
							/>
						</span>
						<span className={`message-info-modal__badge ${activeTab === 'read' ? 'message-info-modal__badge--read' : ''}`}>
							{readCount}
						</span>
					</button>

					<button
						type='button'
						className={`message-info-modal__segment ${activeTab === 'delivered' ? 'message-info-modal__segment--active' : ''}`}
						onClick={() => setActiveTab('delivered')}
					>
						<SingleCheckIcon size={16} color={activeTab === 'delivered' ? 'var(--center-channel-color)' : 'rgba(var(--center-channel-color-rgb), 0.5)'} />
						<span>
							<FormattedMessage
								id='post.message_info.delivered_to'
								defaultMessage='Delivered to'
							/>
						</span>
						<span className='message-info-modal__badge'>
							{deliveredCount}
						</span>
					</button>
				</div>

				{/* Content List */}
				{loading ? (
					<div className='message-info-modal__loading'>
						<LoadingSpinner />
					</div>
				) : error ? (
					<div className='message-info-modal__empty'>
						{error}
					</div>
				) : (
					<div className='message-info-modal__list'>
						{activeTab === 'read' && (
							readCount === 0 ? (
								<div className='message-info-modal__empty'>
									<div className='message-info-modal__empty-icon'>
										<SingleCheckIcon size={28} />
									</div>
									<p className='message-info-modal__empty-title'>
										<FormattedMessage
											id='post.message_info.no_readers'
											defaultMessage='Not read by anyone yet'
										/>
									</p>
									<p className='message-info-modal__empty-desc'>
										<FormattedMessage
											id='post.message_info.no_readers_desc'
											defaultMessage='When recipients open this channel, their read receipts will appear here.'
										/>
									</p>
								</div>
							) : (
								receipts?.read_by.map((item) => {
									const displayName = (item.first_name || item.last_name) ?
										`${item.first_name} ${item.last_name}`.trim() :
										(item.nickname || item.username);

									return (
										<div
											key={item.user_id}
											className='message-info-modal__user-row'
										>
											<div className='message-info-modal__user-info'>
												<div className='message-info-modal__avatar-wrap'>
													<Avatar
														size='md'
														url={Client4.getProfilePictureUrl(item.user_id, 0)}
														username={item.username}
													/>
												</div>
												<div className='message-info-modal__user-names'>
													<span className='message-info-modal__display-name'>{displayName}</span>
													<span className='message-info-modal__username'>@{item.username}</span>
												</div>
											</div>
											<div className='message-info-modal__status-pill message-info-modal__status-pill--read'>
												<DoubleCheckIcon size={14} color='#38bdf8' />
												<Timestamp value={item.viewed_at} />
											</div>
										</div>
									);
								})
							)
						)}

						{activeTab === 'delivered' && (
							deliveredCount === 0 ? (
								<div className='message-info-modal__empty'>
									<div className='message-info-modal__empty-icon' style={{ color: '#38bdf8' }}>
										<DoubleCheckIcon size={28} color='#38bdf8' />
									</div>
									<p className='message-info-modal__empty-title'>
										<FormattedMessage
											id='post.message_info.all_read'
											defaultMessage='All members have read this message!'
										/>
									</p>
									<p className='message-info-modal__empty-desc'>
										<FormattedMessage
											id='post.message_info.all_read_desc'
											defaultMessage='Every member in this conversation has opened and viewed the message.'
										/>
									</p>
								</div>
							) : (
								receipts?.delivered_to.map((item) => {
									const displayName = (item.first_name || item.last_name) ?
										`${item.first_name} ${item.last_name}`.trim() :
										(item.nickname || item.username);

									return (
										<div
											key={item.user_id}
											className='message-info-modal__user-row'
										>
											<div className='message-info-modal__user-info'>
												<div className='message-info-modal__avatar-wrap'>
													<Avatar
														size='md'
														url={Client4.getProfilePictureUrl(item.user_id, 0)}
														username={item.username}
													/>
												</div>
												<div className='message-info-modal__user-names'>
													<span className='message-info-modal__display-name'>{displayName}</span>
													<span className='message-info-modal__username'>@{item.username}</span>
												</div>
											</div>
											<div className='message-info-modal__status-pill message-info-modal__status-pill--delivered'>
												<SingleCheckIcon size={14} />
												<FormattedMessage
													id='post.message_info.status_delivered'
													defaultMessage='Delivered'
												/>
											</div>
										</div>
									);
								})
							)
						)}
					</div>
				)}
			</div>
		</GenericModal>
	);
}
