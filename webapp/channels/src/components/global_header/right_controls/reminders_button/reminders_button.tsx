// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React from 'react';
import {FormattedMessage, useIntl} from 'react-intl';
import {useDispatch, useSelector} from 'react-redux';

import {closeRightHandSide, showReminders} from 'actions/views/rhs';
import {getRhsState} from 'selectors/rhs';

import IconButton from 'components/global_header/header_icon_button';
import WithTooltip from 'components/with_tooltip';

import {RHSStates} from 'utils/constants';

import type {GlobalState} from 'types/store';

const RemindersButton = (): JSX.Element | null => {
    const {formatMessage} = useIntl();
    const dispatch = useDispatch();
    const rhsState = useSelector((state: GlobalState) => getRhsState(state));

    const remindersButtonClick = (e: React.MouseEvent<HTMLButtonElement>) => {
        e.preventDefault();
        if (rhsState === RHSStates.REMINDER) {
            dispatch(closeRightHandSide());
        } else {
            dispatch(showReminders());
        }
    };

    return (
        <WithTooltip
            title={
                <FormattedMessage
                    id='channel_header.reminders'
                    defaultMessage='Reminders'
                />
            }
        >
            <IconButton
                icon={'clock-outline'}
                toggled={rhsState === RHSStates.REMINDER}
                onClick={remindersButtonClick}
                aria-expanded={rhsState === RHSStates.REMINDER}
                aria-controls='rhsContainer'
                aria-label={formatMessage({id: 'channel_header.reminders', defaultMessage: 'Reminders'})}
            />
        </WithTooltip>
    );
};

export default RemindersButton;
