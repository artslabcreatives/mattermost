// Copyright (c) 2015-present Aura, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React from 'react';
import { useSelector } from 'react-redux';

import type { UserProfile } from '@mattermost/types/users';

import { getStatusForUserId } from 'mattermost-redux/selectors/entities/users';

import Avatar from 'components/widgets/users/avatar';

import { imageURLForUser } from 'utils/utils';

import type { GlobalState } from 'types/store';

type Props = {
	user: UserProfile;
	onClick?: (userId: string) => void;
};

export default function PeopleSearchResultItem({ user, onClick }: Props) {
	const status = useSelector((state: GlobalState) => getStatusForUserId(state, user.id));
	const avatarUrl = imageURLForUser(user.id, user.last_picture_update);
	const displayName = [user.first_name, user.last_name].filter(Boolean).join(' ') || user.username;

	const handleClick = () => {
		onClick?.(user.id);
	};

	return (
		<div
			className='people-search-result__item'
			onClick={handleClick}
			tabIndex={0}
			role='button'
			onKeyDown={(e) => {
				if (e.key === 'Enter' || e.key === ' ') {
					handleClick();
				}
			}}
		>
			<div className='people-search-result__avatar'>
				<span className={`status-wrapper status-wrapper--${status ?? 'offline'}`}>
					<Avatar
						username={user.username}
						size='md'
						url={avatarUrl}
					/>
					<span className={`status status--${status ?? 'offline'}`} />
				</span>
			</div>
			<div className='people-search-result__info'>
				<span className='people-search-result__display-name'>{displayName}</span>
				<span className='people-search-result__username'>{'@'}{user.username}</span>
			</div>
		</div>
	);
}
