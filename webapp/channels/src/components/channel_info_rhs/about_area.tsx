// Copyright (c) 2015-present Aura, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React from 'react';
import styled from 'styled-components';

import type { Channel } from '@mattermost/types/channels';
import type { UserProfile } from '@mattermost/types/users';

import Constants from 'utils/constants';

import AboutAreaChannel from './about_area_channel';
import AboutAreaDM from './about_area_dm';
import AboutAreaGM from './about_area_gm';
import type { DMUser } from './channel_info_rhs';

const Container = styled.div`
    overflow-wrap: anywhere;
    padding: 24px;
    padding-bottom: 12px;

    font-size: 14px;
    line-height: 20px;

    & .status-wrapper {
        height: 50px;
    }

    & .text-empty {
        padding: 0px;
        background: transparent;
        border: 0px;
        color: rgba(var(--center-channel-color-rgb), 0.75);
    }
`;

interface Props {
	channel: Channel;
	dmUser?: DMUser;
	gmUsers?: UserProfile[];
	canEditChannelProperties: boolean;
	isFavorite: boolean;
	isMuted: boolean;
	isInvitingPeople: boolean;
	canManageMembers: boolean;
	channelURL: string;
	actions: {
		editChannelPurpose: () => void;
		editChannelHeader: () => void;
		toggleFavorite: () => void;
		toggleMute: () => void;
		addPeople: () => void;
	};
}

const AboutArea = ({
	channel,
	dmUser,
	gmUsers,
	canEditChannelProperties,
	isFavorite,
	isMuted,
	isInvitingPeople,
	canManageMembers,
	channelURL,
	actions,
}: Props) => {
	return (
		<Container>
			{channel.type === Constants.DM_CHANNEL && dmUser && (
				<AboutAreaDM
					channel={channel}
					dmUser={dmUser}
					actions={{ editChannelHeader: actions.editChannelHeader }}
				/>
			)}
			{channel.type === Constants.GM_CHANNEL && gmUsers && (
				<AboutAreaGM
					channel={channel}
					gmUsers={gmUsers!}
					isFavorite={isFavorite}
					isMuted={isMuted}
					isInvitingPeople={isInvitingPeople}
					canManageMembers={canManageMembers}
					channelURL={channelURL}
					actions={{
						editChannelHeader: actions.editChannelHeader,
						toggleFavorite: actions.toggleFavorite,
						toggleMute: actions.toggleMute,
						addPeople: actions.addPeople,
					}}
				/>
			)}
			{[Constants.OPEN_CHANNEL, Constants.PRIVATE_CHANNEL].includes(channel.type) && (
				<AboutAreaChannel
					channel={channel}
					canEditChannelProperties={canEditChannelProperties}
					isFavorite={isFavorite}
					isMuted={isMuted}
					isInvitingPeople={isInvitingPeople}
					canManageMembers={canManageMembers}
					channelURL={channelURL}
					actions={actions}
				/>
			)}
		</Container>
	);
};

export default AboutArea;
