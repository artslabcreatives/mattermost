// Copyright (c) 2015-present Aura, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React from 'react';

import type { UserPropertyField } from '@mattermost/types/properties';
import type { UserProfile } from '@mattermost/types/users';

type Props = {
	attribute?: UserPropertyField;
	userProfile: UserProfile;
	phone?: string;
}

const ProfilePopoverPhone = ({ attribute, userProfile, phone: phoneProp }: Props) => {
	const phone = phoneProp || (attribute ? (userProfile.custom_profile_attributes?.[attribute.id] as string) : (userProfile.props?.phone_number || userProfile.props?.mobile_number || userProfile.props?.phone || userProfile.props?.mobile));

	if (!phone) {
		return null;
	}

	function handlePhoneClick(e: React.MouseEvent<HTMLAnchorElement>) {
		e.preventDefault();
		window.open(`tel:${phone}`);
	}

	return (
		<div
			title={phone}
			className='user-profile-popover__phone'
		>
			<i
				className='icon icon-phone-outline'
				aria-hidden='true'
				aria-label='phone icon'
			/>
			<a
				href={`tel:${phone}`}
				onClick={handlePhoneClick}
			>
				{phone}
			</a>
		</div>
	);
};

export default ProfilePopoverPhone;
