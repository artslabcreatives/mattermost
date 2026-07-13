// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React from 'react';
import {FormattedMessage, useIntl} from 'react-intl';
import styled from 'styled-components';

import type {Channel} from '@mattermost/types/channels';

import {Client4} from 'mattermost-redux/client';

import useCopyText from 'components/common/hooks/useCopyText';
import Avatar from 'components/widgets/users/avatar';
import WithTooltip from 'components/with_tooltip';

import Constants from 'utils/constants';

import 'components/profile_popover/profile_popover.scss';

const FallbackAvatar = styled.div`
    width: 120px;
    height: 120px;
    border-radius: 50%;
    background: rgba(var(--center-channel-color-rgb), 0.08);
    color: rgba(var(--center-channel-color-rgb), 0.72);
    display: flex;
    align-items: center;
    justify-content: center;
    margin: 0 auto;

    & i {
        font-size: 56px;
    }
`;

interface Props {
    channel: Channel;
    isFavorite: boolean;
    isMuted: boolean;
    canAddPeople: boolean;
    channelURL?: string;
    actions: {
        toggleFavorite: () => void;
        toggleMute: () => void;
        addPeople?: () => void;
        hide: () => void;
    };
}

const ChannelPopover = ({
    channel,
    isFavorite,
    isMuted,
    canAddPeople,
    channelURL,
    actions,
}: Props) => {
    const {formatMessage} = useIntl();

    const copyLink = useCopyText({
        text: channelURL || '',
        successCopyTimeout: 1000,
    });

    // Favorite Button State
    const favoriteIcon = isFavorite ? 'icon-star' : 'icon-star-outline';
    const favoriteText = isFavorite ? formatMessage({id: 'channel_popover.favorited', defaultMessage: 'Favorited'}) : formatMessage({id: 'channel_popover.favorite', defaultMessage: 'Favorite'});

    // Mute Button State
    const mutedIcon = isMuted ? 'icon-bell-off-outline' : 'icon-bell-outline';
    const mutedText = isMuted ? formatMessage({id: 'channel_popover.muted', defaultMessage: 'Muted'}) : formatMessage({id: 'channel_popover.mute', defaultMessage: 'Mute'});

    // Copy Link State
    const copyIcon = copyLink.copiedRecently ? 'icon-check' : 'icon-link-variant';
    const copyText = copyLink.copiedRecently ? formatMessage({id: 'channel_popover.copied', defaultMessage: 'Copied'}) : formatMessage({id: 'channel_popover.copy_link', defaultMessage: 'Copy Link'});

    let channelTypeBadge = '';
    let fallbackIconClass = 'icon icon-globe';
    if (channel.type === Constants.PRIVATE_CHANNEL) {
        channelTypeBadge = formatMessage({id: 'channel_popover.private_badge', defaultMessage: 'PRIVATE'});
        fallbackIconClass = 'icon icon-lock-outline';
    } else if (channel.type === Constants.GM_CHANNEL) {
        channelTypeBadge = formatMessage({id: 'channel_popover.group_badge', defaultMessage: 'GROUP'});
        fallbackIconClass = 'icon icon-account-multiple-outline';
    } else {
        channelTypeBadge = formatMessage({id: 'channel_popover.public_badge', defaultMessage: 'PUBLIC'});
        fallbackIconClass = 'icon icon-globe';
    }

    const hasCustomIcon = channel.last_picture_update && channel.last_picture_update > 0;

    return (
        <div className='user-profile-popover_container'>
            <div className='user-profile-popover-title'>
                <div className='user-popover__role'>
                    <span>{channelTypeBadge}</span>
                </div>
                <button
                    type='button'
                    className='closeButtonRelativePosition class--close style--none'
                    onClick={actions.hide}
                    aria-label={formatMessage({id: 'channel_popover.close', defaultMessage: 'Close'})}
                >
                    <i className='icon icon-close'/>
                </button>
            </div>
            <div className='user-profile-popover-content'>
                <div className='user-popover-image'>
                    {hasCustomIcon ? (
                        <Avatar
                            size='xxl'
                            url={Client4.getChannelIconUrl(channel.id, channel.last_picture_update)}
                            alt={channel.display_name}
                        />
                    ) : (
                        <FallbackAvatar>
                            <i className={fallbackIconClass}/>
                        </FallbackAvatar>
                    )}
                </div>
                <div className='user-profile-popover__heading'>
                    <p>{channel.display_name}</p>
                </div>
                {channel.type !== Constants.GM_CHANNEL && (
                    <div className='user-profile-popover__non-heading'>
                        {`~${channel.name}`}
                    </div>
                )}
                <hr/>
                {channel.purpose && (
                    <div className='user-popover__custom_attributes'>
                        <div className='user-popover__subtitle'>
                            <FormattedMessage
                                id='channel_popover.purpose_title'
                                defaultMessage='CHANNEL PURPOSE'
                            />
                        </div>
                        <p className='user-popover__subtitle-text'>{channel.purpose}</p>
                    </div>
                )}
                {channel.header && (
                    <div className='user-popover__custom_attributes'>
                        <div className='user-popover__subtitle'>
                            <FormattedMessage
                                id='channel_popover.header_title'
                                defaultMessage='CHANNEL HEADER'
                            />
                        </div>
                        <p className='user-popover__subtitle-text'>{channel.header}</p>
                    </div>
                )}
                <div className='user-popover__custom_attributes'>
                    <div className='user-popover__subtitle'>
                        <FormattedMessage
                            id='channel_popover.id_title'
                            defaultMessage='CHANNEL ID'
                        />
                    </div>
                    <p className='user-popover__subtitle-text'>{channel.id}</p>
                </div>
            </div>
            <div className='user-profile-popover-bottom-row'>
                <hr className='user-popover__bottom-row-hr'/>
                <div className='user-popover__bottom-row-container'>
                    <button
                        type='button'
                        className='btn btn-primary btn-sm'
                        onClick={actions.toggleFavorite}
                        aria-label={favoriteText}
                    >
                        <i
                            className={`icon ${favoriteIcon}`}
                            aria-hidden='true'
                        />
                        {favoriteText}
                    </button>
                    <div className='user-popover__bottom-row-end'>
                        <WithTooltip title={mutedText}>
                            <span>
                                <button
                                    type='button'
                                    className={`btn btn-icon btn-sm ${isMuted ? 'active' : ''}`}
                                    onClick={actions.toggleMute}
                                    aria-label={mutedText}
                                >
                                    <i
                                        className={`icon ${mutedIcon}`}
                                        aria-hidden='true'
                                    />
                                </button>
                            </span>
                        </WithTooltip>
                        {canAddPeople && actions.addPeople && (
                            <WithTooltip title={formatMessage({id: 'channel_popover.add_people', defaultMessage: 'Add People'})}>
                                <span>
                                    <button
                                        type='button'
                                        className='btn btn-icon btn-sm'
                                        onClick={actions.addPeople}
                                        aria-label={formatMessage({id: 'channel_popover.add_people', defaultMessage: 'Add People'})}
                                    >
                                        <i
                                            className='icon icon-account-plus-outline'
                                            aria-hidden='true'
                                        />
                                    </button>
                                </span>
                            </WithTooltip>
                        )}
                        {channelURL && (
                            <WithTooltip title={copyText}>
                                <span>
                                    <button
                                        type='button'
                                        className='btn btn-icon btn-sm'
                                        onClick={copyLink.onClick}
                                        aria-label={copyText}
                                    >
                                        <i
                                            className={`icon ${copyIcon}`}
                                            aria-hidden='true'
                                        />
                                    </button>
                                </span>
                            </WithTooltip>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ChannelPopover;
