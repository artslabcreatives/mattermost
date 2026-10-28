// Copyright (c) 2015-present Aura, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React from 'react';
import {FormattedMessage, useIntl} from 'react-intl';
import styled from 'styled-components';

import type {Channel} from '@mattermost/types/channels';

import {Client4} from 'mattermost-redux/client';

import ChannelInfoAttributes from 'components/channel_attributes/channel_info_attributes';
import ChannelPopoverController from 'components/channel_popover';
import CopyButton from 'components/copy_button';
import Markdown from 'components/markdown';
import Avatar from 'components/widgets/users/avatar';

import Constants from 'utils/constants';

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

const FallbackAvatar = styled.div`
    width: 50px;
    height: 50px;
    border-radius: 50%;
    background: rgba(var(--center-channel-color-rgb), 0.08);
    color: rgba(var(--center-channel-color-rgb), 0.72);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: background 0.15s ease;
    &:hover {
        background: rgba(var(--center-channel-color-rgb), 0.12);
    }

    & i {
        font-size: 24px;
    }
`;

const ChannelInfo = styled.div`
    margin-left: 12px;
    display: flex;
    flex-direction: column;
    min-width: 0;
`;

const ChannelTypeLabel = styled.div`
    line-height: 20px;
    font-size: 13px;
    color: rgba(var(--center-channel-color-rgb), 0.75);
`;

const ChannelName = styled.div`
    font-size: 20px;
    font-family: Metropolis, sans-serif;
    font-weight: 600;
    letter-spacing: -0.01em;
`;

const ChannelId = styled.div`
    padding: 4px 0;
    margin-bottom: 8px;
    font-size: 11px;
    line-height: 16px;
    letter-spacing: 0.02em;
    color: rgba(var(--center-channel-color-rgb), 0.75);
    &:not(:last-child) {
        margin-bottom: 0px;
    }
    .post-code__clipboard {
        opacity: 0;
    }
    &:hover .post-code__clipboard {
        opacity: 1;
    }
`;

const ChannelPurpose = styled.div`
    margin-bottom: 12px;
    &.ChannelPurpose--is-dm {
        margin-bottom: 16px;
    }
`;

const ChannelDescriptionHeading = styled.div`
    color: rgba(var(--center-channel-color-rgb), 0.75);
    font-size: 11px;
    font-style: normal;
    font-weight: 600;
    line-height: 16px;
    letter-spacing: 0.11px;
    text-transform: uppercase;
    padding: 6px 0;
`;

const ChannelHeader = styled.div`
    margin-bottom: 12px;
`;

const SmallCopyButton = styled(CopyButton)`
    i {
        font-size: 14px;
        margin-left: 4px;
        color: rgba(var(--center-channel-color-rgb), 0.64);

        &:hover {
            color: rgba(var(--center-channel-color-rgb), 0.88);
        }
    }
`;

interface Props {
    channel: Channel;
    canEditChannelProperties: boolean;
    isFavorite: boolean;
    isMuted: boolean;
    isInvitingPeople: boolean;
    canManageMembers: boolean;
    channelURL: string;
    actions: {
        editChannelName: () => void;
        editChannelPurpose: () => void;
        editChannelHeader: () => void;
        toggleFavorite: () => void;
        toggleMute: () => void;
        addPeople: () => void;
    };
}

const AboutAreaChannel = ({
    channel,
    canEditChannelProperties,
    isFavorite,
    isMuted,
    isInvitingPeople,
    canManageMembers,
    channelURL,
    actions,
}: Props) => {
    const {formatMessage} = useIntl();

    return (
        <>
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
                        {channel.last_picture_update && channel.last_picture_update > 0 ? (
                            <Avatar
                                size='xl'
                                url={Client4.getChannelIconUrl(channel.id, channel.last_picture_update)}
                                alt={channel.display_name}
                            />
                        ) : (
                            <FallbackAvatar>
                                <i className={channel.type === Constants.PRIVATE_CHANNEL ? 'icon icon-lock-outline' : 'icon icon-globe'}/>
                            </FallbackAvatar>
                        )}
                    </ChannelAvatar>
                </ChannelPopoverController>
                <ChannelInfo>
                    <ChannelName>
                        <EditableArea
                            editable={canEditChannelProperties}
                            content={<div>{channel.display_name}</div>}
                            onEdit={actions.editChannelName}
                            editTooltip={formatMessage({id: 'channel_info_rhs.about_area.edit_channel_name', defaultMessage: 'Rename channel'})}
                            emptyLabel={formatMessage({id: 'channel_info_rhs.about_area.edit_channel_name', defaultMessage: 'Rename channel'})}
                        />
                    </ChannelName>
                    <ChannelTypeLabel>
                        {channel.type === Constants.PRIVATE_CHANNEL ? (
                            <FormattedMessage
                                id='channel_info_rhs.private'
                                defaultMessage='Private Channel'
                            />
                        ) : (
                            <FormattedMessage
                                id='channel_info_rhs.public'
                                defaultMessage='Public Channel'
                            />
                        )}
                    </ChannelTypeLabel>
                </ChannelInfo>
            </ChannelInfoContainer>

            <ChannelInfoAttributes channelId={channel.id}/>

            {(channel.purpose || canEditChannelProperties) && (
                <ChannelPurpose>
                    <ChannelDescriptionHeading>
                        {formatMessage({id: 'channel_info_rhs.about_area.channel_purpose.heading', defaultMessage: 'Channel Purpose'})}
                    </ChannelDescriptionHeading>
                    <EditableArea
                        editable={canEditChannelProperties}
                        content={channel.purpose && (
                            <LineLimiter
                                maxLines={4}
                                lineHeight={20}
                                moreText={formatMessage({id: 'channel_info_rhs.about_area.channel_purpose.line_limiter.more', defaultMessage: 'more'})}
                                lessText={formatMessage({id: 'channel_info_rhs.about_area.channel_purpose.line_limiter.less', defaultMessage: 'less'})}
                            >
                                <Markdown message={channel.purpose}/>
                            </LineLimiter>
                        )}
                        onEdit={actions.editChannelPurpose}
                        editTooltip={formatMessage({id: 'channel_info_rhs.about_area.edit_channel_purpose', defaultMessage: 'Edit channel purpose'})}
                        emptyLabel={formatMessage({id: 'channel_info_rhs.about_area.add_channel_purpose', defaultMessage: 'Add a channel purpose'})}
                    />
                </ChannelPurpose>
            )}

            {(channel.header || canEditChannelProperties) && (
                <ChannelHeader>
                    <ChannelDescriptionHeading>
                        {formatMessage({id: 'channel_info_rhs.about_area.channel_header.heading', defaultMessage: 'Channel Header'})}
                    </ChannelDescriptionHeading>
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
                        editable={canEditChannelProperties}
                        onEdit={actions.editChannelHeader}
                        editTooltip={formatMessage({id: 'channel_info_rhs.about_area.edit_channel_header', defaultMessage: 'Edit channel header'})}
                        emptyLabel={formatMessage({id: 'channel_info_rhs.about_area.add_channel_header', defaultMessage: 'Add a channel header'})}
                    />
                </ChannelHeader>
            )}

            <ChannelId>
                {formatMessage({id: 'channel_info_rhs.about_area_handle', defaultMessage: 'Channel handle:'})} {channel.name}
                <SmallCopyButton
                    content={channel.name}
                    isForText={true}
                />
            </ChannelId>
            <ChannelId>
                {formatMessage({id: 'channel_info_rhs.about_area_id', defaultMessage: 'ID:'})} {channel.id}
                <SmallCopyButton
                    content={channel.id}
                    isForText={true}
                />
            </ChannelId>

        </>
    );
};

export default AboutAreaChannel;
