// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {
    useFloating,
    autoUpdate,
    autoPlacement,
    useTransitionStyles,
    useClick,
    useDismiss,
    useInteractions,
    useRole,
    shift,
    FloatingFocusManager,
    FloatingOverlay,
    FloatingPortal,
} from '@floating-ui/react';
import classNames from 'classnames';
import type {HtmlHTMLAttributes, ReactNode} from 'react';
import React, {useCallback, useState} from 'react';

import type {Channel} from '@mattermost/types/channels';

import {A11yClassNames, OverlaysTimings, OverlayTransitionStyles, RootHtmlPortalId} from 'utils/constants';

import ChannelPopover from './channel_popover';

interface Props<TriggerComponentType> {
    triggerComponentAs?: React.ElementType;
    triggerComponentId?: HtmlHTMLAttributes<TriggerComponentType>['id'];
    triggerComponentClass?: HtmlHTMLAttributes<TriggerComponentType>['className'];
    triggerComponentStyle?: HtmlHTMLAttributes<TriggerComponentType>['style'];
    children: ReactNode;
    channel: Channel;
    isFavorite: boolean;
    isMuted: boolean;
    isInvitingPeople: boolean;
    canAddPeople: boolean;
    channelURL?: string;
    actions: {
        toggleFavorite: () => void;
        toggleMute: () => void;
        addPeople: () => void;
    };
    returnFocus?: () => void;
}

export function ChannelPopoverController<TriggerComponentType = HTMLSpanElement>(props: Props<TriggerComponentType>) {
    const [isOpen, setOpen] = useState(false);

    const {refs, floatingStyles, context: floatingContext} = useFloating({
        open: isOpen,
        onOpenChange: setOpen,
        whileElementsMounted: autoUpdate,
        middleware: [autoPlacement(), shift()],
    });

    const {isMounted, styles: transitionStyles} = useTransitionStyles(floatingContext, {
        duration: {
            open: OverlaysTimings.FADE_IN_DURATION,
            close: OverlaysTimings.FADE_OUT_DURATION,
        },
        initial: OverlayTransitionStyles.START,
    });

    const clickInteractions = useClick(floatingContext);
    const dismissInteraction = useDismiss(floatingContext);
    const role = useRole(floatingContext);

    const {getReferenceProps, getFloatingProps} = useInteractions([
        clickInteractions,
        dismissInteraction,
        role,
    ]);

    const handleHide = useCallback(() => {
        setOpen(false);
    }, []);

    const TriggerComponent = props.triggerComponentAs ?? 'span';

    return (
        <>
            <TriggerComponent
                id={props.triggerComponentId}
                ref={refs.setReference}
                className={props.triggerComponentClass}
                style={props.triggerComponentStyle}
                {...getReferenceProps()}
            >
                {props.children}
            </TriggerComponent>

            {isMounted && (
                <FloatingPortal id={RootHtmlPortalId}>
                    <FloatingOverlay
                        className='user-profile-popover-floating-overlay'
                        lockScroll={true}
                    >
                        <FloatingFocusManager context={floatingContext}>
                            <div
                                ref={refs.setFloating}
                                style={{...floatingStyles, ...transitionStyles}}
                                className={classNames('user-profile-popover', A11yClassNames.POPUP)}
                                aria-label={props.channel.display_name}
                                {...getFloatingProps()}
                            >
                                <ChannelPopover
                                    channel={props.channel}
                                    isFavorite={props.isFavorite}
                                    isMuted={props.isMuted}
                                    canAddPeople={props.canAddPeople}
                                    channelURL={props.channelURL}
                                    actions={{
                                        ...props.actions,
                                        hide: handleHide,
                                    }}
                                />
                            </div>
                        </FloatingFocusManager>
                    </FloatingOverlay>
                </FloatingPortal>
            )}
        </>
    );
}
