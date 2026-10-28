// Copyright (c) 2015-present Aura, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React from 'react';

import type {Channel} from '@mattermost/types/channels';

import {Client4} from 'mattermost-redux/client';

import ChannelTypeIcon from 'components/channel_type_icon';
import Avatar from 'components/widgets/users/avatar';

import Constants from 'utils/constants';

type Props = {
    channel: Channel;
};

const SidebarBaseChannelIcon = ({channel}: Props) => {
    if (channel.last_picture_update && channel.last_picture_update > 0) {
        return (
            <Avatar
                size='xs'
                url={Client4.getChannelIconUrl(channel.id, channel.last_picture_update)}
                alt={channel.display_name}
            />
        );
    }

    if (channel.type !== Constants.OPEN_CHANNEL && channel.type !== Constants.PRIVATE_CHANNEL) {
        return null;
    }
    return <ChannelTypeIcon channel={channel}/>;
};

export default SidebarBaseChannelIcon;
