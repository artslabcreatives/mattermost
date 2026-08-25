// Copyright (c) 2015-present Aura, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React from 'react';
import { useIntl } from 'react-intl';
import styled from 'styled-components';

import type { Channel } from '@mattermost/types/channels';

import { Client4 } from 'mattermost-redux/client';

import Markdown from 'components/markdown';
import ProfilePicture from 'components/profile_picture';
import BotTag from 'components/widgets/tag/bot_tag';
import GuestTag from 'components/widgets/tag/guest_tag';

import * as Utils from 'utils/utils';

import type { DMUser } from './channel_info_rhs';
import EditableArea from './components/editable_area';
import LineLimiter from './components/linelimiter';

const Username = styled.p`
    font-family: Metropolis, sans-serif;
    font-size: 18px;
    line-height: 24px;
    color: rgb(var(--center-channel-color-rgb));
    font-weight: 600;
    margin: 0;
`;

const ChannelHeader = styled.div`
    margin-bottom: 12px;
`;

const UserInfoContainer = styled.div`
    display: flex;
    align-items: center;
    margin-bottom: 12px;
`;

const UserAvatar = styled.div`
    .status {
        bottom: 0;
        right: 0;
        height: 18px;
        width: 18px;
        & svg {
            min-height: 14.4px;
        }
    }
`;

const UserInfo = styled.div`
    margin-left: 12px;
    display: flex;
    flex-direction: column;
`;

const UsernameContainer = styled.div`
    display: flex;
    gap: 8px
`;

const UserPosition = styled.div`
    line-height: 20px;

    p {
        margin-bottom: 0;
    }
`;

const UserContactInfo = styled.div`
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-bottom: 12px;
`;

const ContactItem = styled.div`
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    line-height: 20px;
    color: rgba(var(--center-channel-color-rgb), 0.75);

    i {
        font-size: 16px;
        color: rgba(var(--center-channel-color-rgb), 0.56);
        display: inline-flex;
        align-items: center;
        justify-content: center;
    }

    a {
        color: var(--link-color);
        text-decoration: none;
        word-break: break-all;

        &:hover {
            text-decoration: underline;
        }
    }
`;

const ChannelId = styled.div`
    margin-bottom: 12px;
    font-size: 11px;
    line-height: 16px;
    letter-spacing: 0.02em;
    color: rgba(var(--center-channel-color-rgb), 0.75);
`;

interface Props {
	channel: Channel;
	dmUser: DMUser;
	actions: {
		editChannelHeader: () => void;
	};
}

const AboutAreaDM = ({ channel, dmUser, actions }: Props) => {
	const { formatMessage } = useIntl();

	const email = dmUser.user.is_bot ? '' : Utils.getEmail(dmUser.user);
	const phoneNumber = dmUser.user.is_bot ? '' : (dmUser.user.props?.phone_number || dmUser.user.props?.mobile_number || dmUser.user.props?.phone || dmUser.user.props?.mobile || (dmUser.user.custom_profile_attributes && Object.values(dmUser.user.custom_profile_attributes).find((v) => typeof v === 'string' && v.trim().length > 0) as string) || '');

	return (
		<>
			<UserInfoContainer>
				<UserAvatar>
					<ProfilePicture
						src={Client4.getProfilePictureUrl(dmUser.user.id, dmUser.user.last_picture_update)}
						isBot={dmUser.user.is_bot}
						status={dmUser.status ? dmUser.status : undefined}
						username={dmUser.display_name}
						userId={dmUser.user.id}
						channelId={channel.id}
						size='xl'
					/>
				</UserAvatar>
				<UserInfo>
					<UsernameContainer>
						<Username>{dmUser.display_name}</Username>
						{dmUser.user.is_bot && <BotTag />}
						{dmUser.is_guest && <GuestTag />}
					</UsernameContainer>
					<UserPosition>
						<Markdown message={dmUser.user.is_bot ? dmUser.user.bot_description : dmUser.user.position} />
					</UserPosition>
				</UserInfo>
			</UserInfoContainer>

			{(email || phoneNumber) && !dmUser.user.is_bot && (
				<UserContactInfo>
					{email && (
						<ContactItem title={email}>
							<i
								className='icon icon-email-outline'
								aria-hidden='true'
							/>
							<a
								href={`mailto:${email}`}
								target='_blank'
								rel='noopener noreferrer'
							>
								{email}
							</a>
						</ContactItem>
					)}
					{phoneNumber && (
						<ContactItem title={phoneNumber}>
							<i
								className='icon icon-phone-outline'
								aria-hidden='true'
							/>
							<a href={`tel:${phoneNumber}`}>
								{phoneNumber}
							</a>
						</ContactItem>
					)}
				</UserContactInfo>
			)}

			{!dmUser.user.is_bot && (
				<ChannelHeader>
					<EditableArea
						content={channel.header && (
							<LineLimiter
								maxLines={4}
								lineHeight={20}
								moreText={formatMessage({ id: 'channel_info_rhs.about_area.channel_header.line_limiter.more', defaultMessage: 'more' })}
								lessText={formatMessage({ id: 'channel_info_rhs.about_area.channel_header.line_limiter.less', defaultMessage: 'less' })}
							>
								<Markdown message={channel.header} />
							</LineLimiter>
						)}
						editable={true}
						onEdit={actions.editChannelHeader}
						emptyLabel={formatMessage({ id: 'channel_info_rhs.about_area.add_channel_header', defaultMessage: 'Add a channel header' })}
					/>
				</ChannelHeader>
			)}

			<ChannelId>
				{formatMessage({ id: 'channel_info_rhs.about_area_id', defaultMessage: 'ID:' })} {channel.id}
			</ChannelId>
		</>
	);
};

export default AboutAreaDM;
