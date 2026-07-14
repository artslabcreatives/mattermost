// Copyright (c) 2015-present Aura, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {
	useFloating,
	autoUpdate,
	autoPlacement,
	useTransitionStyles,
	useHover,
	useDismiss,
	useInteractions,
	useRole,
	shift,
	FloatingFocusManager,
	FloatingPortal,
	safePolygon,
} from '@floating-ui/react';
import classNames from 'classnames';
import type { ReactNode } from 'react';
import React, { useCallback, useEffect, useState, useMemo } from 'react';
import { useDispatch, useSelector } from 'react-redux';

import type { Channel } from '@mattermost/types/channels';
import type { GlobalState } from 'types/store';

import { getChannelByNameAndTeamName, getChannelStats, joinChannel } from 'mattermost-redux/actions/channels';
import { getAllChannels, getAllChannelStats, getMyChannelMembership } from 'mattermost-redux/selectors/entities/channels';
import { getCurrentTeam } from 'mattermost-redux/selectors/entities/teams';
import { getCurrentUserId } from 'mattermost-redux/selectors/entities/common';

import { switchToChannel } from 'actions/views/channel';
import { A11yClassNames, OverlaysTimings, OverlayTransitionStyles, RootHtmlPortalId } from 'utils/constants';

import './channel_mention.scss';

interface Props {
	channelName: string;
	teamName?: string;
	children: ReactNode;
}

export default function ChannelMention({ channelName, teamName, children }: Props) {
	const dispatch = useDispatch();
	const currentTeam = useSelector(getCurrentTeam);
	const currentUserId = useSelector(getCurrentUserId);
	const activeTeamName = teamName || currentTeam?.name || '';
	const activeTeamId = currentTeam?.id || '';

	// Find channel by name
	const channel = useSelector((state: GlobalState) => {
		const channels = getAllChannels(state);
		return Object.values(channels).find(
			(c) => c.name === channelName && c.delete_at === 0
		);
	});

	// Select membership
	const myMembership = useSelector((state: GlobalState) => {
		if (!channel) {
			return undefined;
		}
		return getMyChannelMembership(state, channel.id);
	});

	// Select statistics
	const stats = useSelector((state: GlobalState) => {
		if (!channel) {
			return undefined;
		}
		return getAllChannelStats(state)[channel.id];
	});

	// Fetch channel details if not found in redux
	useEffect(() => {
		if (!channel && activeTeamName) {
			dispatch(getChannelByNameAndTeamName(activeTeamName, channelName, true));
		}
	}, [channel, activeTeamName, channelName, dispatch]);

	// Fetch channel stats if channel is loaded but stats are missing
	useEffect(() => {
		if (channel?.id && !stats) {
			dispatch(getChannelStats(channel.id));
		}
	}, [channel?.id, stats, dispatch]);

	const [isOpen, setOpen] = useState(false);

	const { refs, floatingStyles, context: floatingContext } = useFloating({
		open: isOpen,
		onOpenChange: setOpen,
		whileElementsMounted: autoUpdate,
		middleware: [autoPlacement(), shift()],
	});

	const TRANSITION_STYLE_PROPS = useMemo(() => ({
		duration: {
			open: OverlaysTimings.FADE_IN_DURATION,
			close: OverlaysTimings.FADE_OUT_DURATION,
		},
		initial: OverlayTransitionStyles.START,
	}), []);

	const { isMounted, styles: transitionStyles } = useTransitionStyles(floatingContext, TRANSITION_STYLE_PROPS);

	const hoverInteractions = useHover(floatingContext, {
		delay: { open: 400, close: 300 },
		handleClose: safePolygon(),
	});
	const dismissInteraction = useDismiss(floatingContext);
	const role = useRole(floatingContext);

	const { getReferenceProps, getFloatingProps } = useInteractions([
		hoverInteractions,
		dismissInteraction,
		role,
	]);

	const handleNavigate = useCallback(async (e: React.MouseEvent) => {
		e.preventDefault();
		if (!channel) {
			return;
		}
		setOpen(false);
		if (!myMembership && channel.type === 'O') {
			await dispatch(joinChannel(currentUserId, channel.team_id || activeTeamId, channel.id));
		}
		dispatch(switchToChannel(channel));
	}, [channel, myMembership, currentUserId, activeTeamId, dispatch]);

	if (!channel) {
		return (
			<span className="mention-link">
				{children}
			</span>
		);
	}

	const isMember = Boolean(myMembership);
	const isPublic = channel.type === 'O';

	return (
		<>
			<a
				ref={refs.setReference}
				className="mention-link"
				href="#"
				onClick={handleNavigate}
				{...getReferenceProps()}
			>
				{children}
			</a>

			{isMounted && (
				<FloatingPortal id={RootHtmlPortalId}>
					<FloatingFocusManager context={floatingContext} modal={false}>
						<div
							ref={refs.setFloating}
							style={{ ...floatingStyles, ...transitionStyles, zIndex: 9999 }}
							className={classNames('channel-mention-popover', A11yClassNames.POPUP)}
							{...getFloatingProps()}
						>
							<div className="channel-mention-popover__container">
								<div className="channel-mention-popover__header">
									<i className={channel.type === 'P' ? 'icon icon-lock-outline' : 'icon icon-globe'} />
									<span className="channel-mention-popover__title">
										{channel.display_name}
									</span>
								</div>
								<div className="channel-mention-popover__content">
									{channel.purpose && (
										<div className="channel-mention-popover__section">
											<div className="channel-mention-popover__label">Purpose</div>
											<div className="channel-mention-popover__value">{channel.purpose}</div>
										</div>
									)}
									{channel.header && (
										<div className="channel-mention-popover__section">
											<div className="channel-mention-popover__label">Header</div>
											<div className="channel-mention-popover__value">{channel.header}</div>
										</div>
									)}
									{!channel.purpose && !channel.header && (
										<div className="channel-mention-popover__fallback">
											No description or purpose set for this channel.
										</div>
									)}
								</div>
								<div className="channel-mention-popover__footer">
									<div className="channel-mention-popover__stats">
										<span className="channel-mention-popover__member-count">
											{stats?.member_count || 0} {stats?.member_count === 1 ? 'member' : 'members'}
										</span>
									</div>
									<div className="channel-mention-popover__actions">
										{isMember ? (
											<button
												className="btn btn-primary btn-sm channel-mention-popover__btn"
												onClick={handleNavigate}
											>
												View Channel
											</button>
										) : isPublic ? (
											<button
												className="btn btn-primary btn-sm channel-mention-popover__btn"
												onClick={handleNavigate}
											>
												Join Channel
											</button>
										) : (
											<button
												className="btn btn-secondary btn-sm channel-mention-popover__btn"
												disabled={true}
											>
												Private Channel
											</button>
										)}
									</div>
								</div>
							</div>
						</div>
					</FloatingFocusManager>
				</FloatingPortal>
			)}
		</>
	);
}
