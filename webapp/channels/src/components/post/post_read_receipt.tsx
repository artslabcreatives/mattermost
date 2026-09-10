// Copyright (c) 2015-present Aura, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React, { useEffect, useState, useCallback } from 'react';
import { useIntl } from 'react-intl';
import { useDispatch } from 'react-redux';

import type { Post, PostSeenReceipts } from '@mattermost/types/posts';

import { openModal } from 'actions/views/modals';
import { fetchPostSeenReceipts } from 'actions/views/post_seen';

import WithTooltip from 'components/with_tooltip';
import MessageInfoModal, { DoubleCheckIcon, SingleCheckIcon } from 'components/message_info_modal';

import { ModalIdentifiers } from 'utils/constants';

type Props = {
	post: Post;
};

export default function PostReadReceipt({ post }: Props) {
	const { formatMessage } = useIntl();
	const dispatch = useDispatch();

	const [receipts, setReceipts] = useState<PostSeenReceipts | null>(null);

	useEffect(() => {
		let isMounted = true;
		async function load() {
			const res = await dispatch(fetchPostSeenReceipts(post.id));
			if (isMounted && res.data) {
				setReceipts(res.data);
			}
		}
		load();
		return () => {
			isMounted = false;
		};
	}, [post.id, dispatch]);

	const handleClick = useCallback((e: React.MouseEvent) => {
		e.preventDefault();
		e.stopPropagation();
		dispatch(openModal({
			modalId: ModalIdentifiers.MESSAGE_INFO_MODAL,
			dialogType: MessageInfoModal,
			dialogProps: { post },
		}));
	}, [dispatch, post]);

	const hasReaders = Boolean(receipts && receipts.read_by.length > 0);
	const readCount = receipts ? receipts.read_by.length : 0;

	const tooltipTitle = hasReaders ?
		formatMessage(
			{
				id: 'post.read_receipt.tooltip.read_by',
				defaultMessage: 'Seen by {count, plural, one {# member} other {# members}} • Click for info',
			},
			{ count: readCount },
		) :
		formatMessage({
			id: 'post.read_receipt.tooltip.delivered',
			defaultMessage: 'Delivered • Click for info',
		});

	return (
		<WithTooltip title={tooltipTitle}>
			<button
				type='button'
				className='style--none post-read-receipt-btn'
				onClick={handleClick}
				style={{
					display: 'inline-flex',
					alignItems: 'center',
					padding: '2px 4px',
					borderRadius: '4px',
					cursor: 'pointer',
					opacity: 0.9,
					marginLeft: '4px',
					background: 'transparent',
					border: 'none',
				}}
				aria-label={tooltipTitle}
			>
				{hasReaders ? (
					<DoubleCheckIcon size={16} color='#34B7F1' />
				) : (
					<SingleCheckIcon size={16} color='rgba(var(--center-channel-color-rgb), 0.45)' />
				)}
			</button>
		</WithTooltip>
	);
}
