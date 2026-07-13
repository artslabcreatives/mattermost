// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React from 'react';
import {FormattedMessage, useIntl} from 'react-intl';
import styled from 'styled-components';

import type {Channel} from '@mattermost/types/channels';
import type {UserProfile} from '@mattermost/types/users';

import {Client4} from 'mattermost-redux/client';

import ChannelPopoverController from 'components/channel_popover';
import Markdown from 'components/markdown';
import ProfilePicture from 'components/profile_picture';
import UserProfileElement from 'components/user_profile';
import Avatar from 'components/widgets/users/avatar';

import EditableArea from './components/editable_area';
import LineLimiter from './components/linelimiter';

const ChannelInfoContainer = styled.div`
    display: flex;
    align-items: center;
    margin-bottom: 24px;
`;

const ChannelAvatar = styled.div`
    cursor: pointer;
    .Avatar {
        width: 50px;
        height: 50px;
        border-radius: 50%;
        object-fit: cover;
    }
`;

const ChannelInfo = styled.div`
    margin-left: 12px;
    display: flex;
    flex-direction: column;
`;

const ChannelName = styled.p`
    font-family: Metropolis, sans-serif;
    font-size: 18px;
    line-height: 24px;
    color: rgb(var(--center-channel-color-rgb));
    font-weight: 600;
    margin: 0;
`;

const ChannelTypeLabel = styled.div`
    line-height: 20px;
    font-size: 13px;
    color: rgba(var(--center-channel-color-rgb), 0.75);
`;

const Usernames = styled.p`
    font-family: Metropolis, sans-serif;
    font-size: 18px;
    line-height: 24px;
    color: rgb(var(--center-channel-color-rgb));
    font-weight: 600;
    margin: 0;
`;

const ProfilePictures = styled.div`
    margin-bottom: 10px;
`;

interface ProfilePictureContainerProps {
    position: number;
}

const ProfilePictureContainer = styled.div<ProfilePictureContainerProps>`
    display: inline-block;
    position: relative;
    left: ${(props) => props.position * -15}px;

    & img {
        border: 2px solid white;
    }
`;

const UsersArea = styled.div`
    margin-bottom: 12px;
    &.ChannelPurpose--is-dm {
        margin-bottom: 16px;
    }
`;

const ChannelHeader = styled.div`
    margin-bottom: 12px;
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
    gmUsers: UserProfile[];
    isFavorite: boolean;
    isMuted: boolean;
    isInvitingPeople: boolean;
    canManageMembers: boolean;
    channelURL: string;
    actions: {
        editChannelHeader: () => void;
        toggleFavorite: () => void;
        toggleMute: () => void;
        addPeople: () => void;
    };
}

const AboutAreaGM = ({
    channel,
    gmUsers,
    isFavorite,
    isMuted,
    isInvitingPeople,
    canManageMembers,
    channelURL,
    actions,
}: Props) => {
    const {formatMessage} = useIntl();

    const hasCustomIcon = channel.last_picture_update && channel.last_picture_update > 0;

    return (
        <>
            {hasCustomIcon ? (
                <ChannelInfoContainer>
                    <ChannelPopoverController
                        channel={channel}
                        isFavorite={isFavorite}
                        isMuted={isMuted}
                        isInvitingPeople={isInvitingPeople}
                        canAddPeople={canManageMembers}
                        channelURL={channelURL}
                        actions={{
                            toggleFavorite: actions.toggleFavorite,
                            toggleMute: actions.toggleMute,
                            addPeople: actions.addPeople,
                        }}
                    >
                        <ChannelAvatar>
                            <Avatar
                                size='xl'
                                url={Client4.getChannelIconUrl(channel.id, channel.last_picture_update)}
                                alt={channel.display_name}
                            />
                        </ChannelAvatar>
                    </ChannelPopoverController>
                    <ChannelInfo>
                        <ChannelName>{channel.display_name}</ChannelName>
                        <ChannelTypeLabel>
                            <FormattedMessage
                                id='channel_info_rhs.group'
                                defaultMessage='Group Message'
                            />
                        </ChannelTypeLabel>
                    </ChannelInfo>
                </ChannelInfoContainer>
            ) : (
                <UsersArea>
                    <ProfilePictures>
                        {gmUsers.map((user, idx) => (
                            <ProfilePictureContainer
                                key={user.id}
                                position={idx}
                            >
                                <ProfilePicture
                                    src={Client4.getProfilePictureUrl(user.id, user.last_picture_update)}
                                    size='xl'
                                    userId={user.id}
                                    username={user.username}
                                    channelId={channel.id}
                                />
                            </ProfilePictureContainer>
                        ))}
                    </ProfilePictures>
                    <Usernames>
                        {gmUsers.map((user, i, {length}) => (
                            <React.Fragment key={user.id}>
                                <UserProfileElement
                                    userId={user.id}
                                    channelId={channel.id}
                                />
                                {(i + 1 !== length) && (<span>{', '}</span>)}
                            </React.Fragment>
                        ))}
                    </Usernames>
                </UsersArea>
            )}

            <ChannelHeader>
                <EditableArea
                    content={channel.header && (
                        <LineLimiter
                            maxLines={4}
                            lineHeight={20}
                            moreText={formatMessage({id: 'channel_info_rhs.about_area.channel_header.line_limiter.more', defaultMessage: 'more'})}
                            lessText={formatMessage({id: 'channel_info_rhs.about_area.channel_header.line_limiter.less', defaultMessage: 'less'})}
                        >
                            <Markdown message={channel.header}/>
                        </LineLimiter>
                    )}
                    editable={true}
                    onEdit={actions.editChannelHeader}
                    emptyLabel={formatMessage({id: 'channel_info_rhs.about_area.add_channel_header', defaultMessage: 'Add a channel header'})}
                />
            </ChannelHeader>

            <ChannelId>
                {formatMessage({id: 'channel_info_rhs.about_area_id', defaultMessage: 'ID:'})} {channel.id}
            </ChannelId>
        </>
    );
};

export default AboutAreaGM;
