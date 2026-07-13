// Copyright (c) 2015-present Aura, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React from 'react';

import type { Channel, ChannelType } from '@mattermost/types/channels';
import { Client4 } from 'mattermost-redux/client';

import Avatar from 'components/widgets/users/avatar';
import Constants from 'utils/constants';

type Props = {
	channelType: ChannelType;
	channel?: Channel;
}

const SidebarBaseChannelIcon = ({
	channelType,
	channel,
}: Props) => {
	if (channel && channel.last_picture_update && channel.last_picture_update > 0) {
		const iconUrl = Client4.getChannelIconUrl(channel.id, channel.last_picture_update);
		return (
			<Avatar
				size='xs'
				url={iconUrl}
				alt={channel.display_name}
			/>
		);
	}

	if (channelType === Constants.OPEN_CHANNEL) {
		return (
			<i className='icon icon-globe' />
		);
	}
	if (channelType === Constants.PRIVATE_CHANNEL) {
		return (
			<i className='icon icon-lock-outline' />
		);
	}
	return null;
};

export default SidebarBaseChannelIcon;
