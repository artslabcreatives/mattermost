// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import moment from 'moment-timezone';
import React, {memo, useCallback, useEffect, useState} from 'react';
import {FormattedMessage, useIntl} from 'react-intl';
import {useDispatch, useSelector} from 'react-redux';
import {Link} from 'react-router-dom';

import type {PostReminderDetail} from '@mattermost/types/posts';

import {Client4} from 'mattermost-redux/client';
import {getCurrentTimezone} from 'mattermost-redux/selectors/entities/timezone';
import {getCurrentUserId} from 'mattermost-redux/selectors/entities/users';

import {closeRightHandSide} from 'actions/views/rhs';

import LoadingSpinner from 'components/widgets/loading/loading_spinner';
import WithTooltip from 'components/with_tooltip';

import {getSiteURL} from 'utils/url';

import './rhs_reminders.scss';

const RhsReminders: React.FC = () => {
    const {formatMessage} = useIntl();
    const dispatch = useDispatch();
    const currentUserId = useSelector(getCurrentUserId);
    const userTimezone = useSelector(getCurrentTimezone);

    const [reminders, setReminders] = useState<PostReminderDetail[]>([]);
    const [loading, setLoading] = useState(true);
    const [deletingId, setDeletingId] = useState<string | null>(null);

    const fetchReminders = useCallback(async () => {
        if (!currentUserId) {
            return;
        }
        setLoading(true);
        try {
            const data = await Client4.getPostReminders(currentUserId);
            setReminders(data || []);
        } catch (error) {
            // eslint-disable-next-line no-console
            console.error('Failed to fetch post reminders:', error);
            setReminders([]);
        } finally {
            setLoading(false);
        }
    }, [currentUserId]);

    useEffect(() => {
        fetchReminders();
    }, [fetchReminders]);

    const handleClose = useCallback(() => {
        dispatch(closeRightHandSide());
    }, [dispatch]);

    const handleDelete = useCallback(async (postId: string) => {
        if (!currentUserId || deletingId) {
            return;
        }
        setDeletingId(postId);
        try {
            await Client4.deletePostReminder(currentUserId, postId);
            setReminders((prev) => prev.filter((r) => r.post_id !== postId));
        } catch (error) {
            // Failed to delete
        } finally {
            setDeletingId(null);
        }
    }, [currentUserId, deletingId]);

    const formatTargetTime = (targetTimeSec: number) => {
        const targetMoment = userTimezone ? moment.unix(targetTimeSec).tz(userTimezone) : moment.unix(targetTimeSec);
        const fromNow = targetMoment.fromNow();
        const formatted = targetMoment.format('MMM D, h:mm A');
        const isUrgent = (targetTimeSec * 1000) - Date.now() < 30 * 60 * 1000;

        return {fromNow, formatted, isUrgent};
    };

    const getRelativePath = (permalink: string) => {
        const siteURL = getSiteURL();
        let path = permalink;
        if (permalink.startsWith(siteURL)) {
            path = permalink.slice(siteURL.length);
        }
        if (!path.startsWith('/')) {
            path = '/' + path;
        }
        return path;
    };

    return (
        <div
            id='rhsContainer'
            className='sidebar-right__body rhs-reminders'
        >
            {/* RHS Header */}
            <div className='sidebar--right__header'>
                <span className='sidebar--right__title'>
                    <h2>
                        <span
                            id='rhsPanelTitle'
                            className='style--none'
                        >
                            <i
                                className='icon icon-clock-outline'
                                style={{marginRight: 8, fontSize: 16}}
                            />
                            <FormattedMessage
                                id='rhs_reminders.header.title'
                                defaultMessage='My Reminders'
                            />
                        </span>
                    </h2>
                </span>

                <WithTooltip
                    title={
                        <FormattedMessage
                            id='rhs_header.closeSidebarTooltip'
                            defaultMessage='Close'
                        />
                    }
                >
                    <button
                        id='rhsCloseButton'
                        type='button'
                        className='sidebar--right__close btn btn-icon btn-sm'
                        aria-label={formatMessage({id: 'rhs_header.closeTooltip.icon', defaultMessage: 'Close Sidebar Icon'})}
                        onClick={handleClose}
                    >
                        <i className='icon icon-close'/>
                    </button>
                </WithTooltip>
            </div>

            {/* Sub-header / Tabs */}
            <div className='rhs-reminders__tabs'>
                <div className='rhs-reminders__tab'>
                    <FormattedMessage
                        id='rhs_reminders.tab.upcoming'
                        defaultMessage='Upcoming'
                    />
                    <span className='badge'>{reminders.length}</span>
                </div>
            </div>

            {/* Content Area */}
            <div className='rhs-reminders__content'>
                {loading && (
                    <div className='rhs-reminders__loading'>
                        <LoadingSpinner/>
                    </div>
                )}
                {!loading && reminders.length === 0 && (
                    <div className='rhs-reminders__empty'>
                        <i className='icon icon-clock-outline empty-icon'/>
                        <div className='empty-title'>
                            <FormattedMessage
                                id='rhs_reminders.empty.title'
                                defaultMessage='No scheduled reminders'
                            />
                        </div>
                        <div className='empty-subtitle'>
                            <FormattedMessage
                                id='rhs_reminders.empty.subtitle'
                                defaultMessage='When you set a reminder on a message, it will appear here until it fires.'
                            />
                        </div>
                    </div>
                )}
                {!loading && reminders.length > 0 && (
                    <div className='rhs-reminders__list'>
                        {reminders.map((reminder) => {
                            const {fromNow, formatted, isUrgent} = formatTargetTime(reminder.target_time);
                            const channelName = reminder.channel_display_name || reminder.channel_name;
                            const authorName = reminder.user_display_name || `@${reminder.username}`;

                            return (
                                <div
                                    key={reminder.post_id}
                                    className='rhs-reminder-card'
                                >
                                    <div className='rhs-reminder-card__header'>
                                        <div className={`rhs-reminder-card__time-badge ${isUrgent ? 'rhs-reminder-card__time-badge--urgent' : ''}`}>
                                            <i className='icon icon-clock-outline'/>
                                            <span>{`${fromNow} (${formatted})`}</span>
                                        </div>

                                        <WithTooltip
                                            title={
                                                <FormattedMessage
                                                    id='rhs_reminders.card.delete_tooltip'
                                                    defaultMessage='Delete reminder'
                                                />
                                            }
                                        >
                                            <button
                                                type='button'
                                                className='rhs-reminder-card__delete-btn'
                                                disabled={deletingId === reminder.post_id}
                                                onClick={() => handleDelete(reminder.post_id)}
                                                aria-label={formatMessage({id: 'rhs_reminders.card.delete_tooltip', defaultMessage: 'Delete reminder'})}
                                            >
                                                <i className='icon icon-trash-can-outline'/>
                                            </button>
                                        </WithTooltip>
                                    </div>

                                    <div className='rhs-reminder-card__meta'>
                                        <span className='author'>{authorName}</span>
                                        {channelName && (
                                            <>
                                                <span>
                                                    <FormattedMessage
                                                        id='rhs_reminders.card.in_channel'
                                                        defaultMessage='in'
                                                    />
                                                </span>
                                                <span className='channel-tag'>{`~${channelName}`}</span>
                                            </>
                                        )}
                                    </div>

                                    {reminder.message && (
                                        <div className='rhs-reminder-card__message'>
                                            {reminder.message}
                                        </div>
                                    )}

                                    <div className='rhs-reminder-card__actions'>
                                        <Link
                                            to={getRelativePath(reminder.permalink)}
                                            className='rhs-reminder-card__jump-btn'
                                        >
                                            <span>
                                                <FormattedMessage
                                                    id='rhs_reminders.card.jump_to_message'
                                                    defaultMessage='Jump to message'
                                                />
                                            </span>
                                            <i className='icon icon-arrow-right'/>
                                        </Link>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
};

export default memo(RhsReminders);
