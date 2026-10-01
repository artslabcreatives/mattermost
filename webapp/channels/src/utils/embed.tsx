// Copyright (c) 2015-present Aura, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

/**
 * Checks if the application is running embedded in another platform
 * This is determined by checking if window.self is not equal to window.parent.
 * If accessing window.parent throws an error, it is assumed the app is in a cross-origin iframe.
 * @returns True if the app is running embedded
 */
export function isEmbedded(): boolean {
    try {
        return window.self !== window.parent;
    } catch (e) {
        // If accessing window.parent throws an error, we're in a cross-origin iframe
        return true;
    }
}

// Origins of the Hub application, which embeds Aura in a drawer iframe
const HUB_ORIGINS = [
    'https://hub-dev.artslabcreatives.com:5173',
    'https://hub-dev.artslabcreatives.com',
];

const HUB_EMBED_STORAGE_KEY = 'embeddedInHub';

export const HUB_EMBED_BODY_CLASS = 'embedded-hub';

function getParentOrigin(): string | undefined {
    const ancestorOrigins = window.location.ancestorOrigins;
    if (ancestorOrigins && ancestorOrigins.length > 0) {
        return ancestorOrigins[0];
    }

    // Firefox has no ancestorOrigins, so fall back to the referrer of the initial frame load
    try {
        return document.referrer ? new URL(document.referrer).origin : undefined;
    } catch (e) {
        return undefined;
    }
}

/**
 * Checks if the application is running inside the Hub drawer iframe.
 * The result is remembered for the session, since the referrer fallback is lost
 * after a full page navigation inside the frame (e.g. after logging in).
 * @returns True if the app is embedded by one of the Hub origins
 */
export function isEmbeddedInHub(): boolean {
    if (!isEmbedded()) {
        return false;
    }

    try {
        if (sessionStorage.getItem(HUB_EMBED_STORAGE_KEY) === 'true') {
            return true;
        }
    } catch (e) {
        // Storage can be unavailable in third-party iframes
    }

    const parentOrigin = getParentOrigin();
    const embeddedInHub = Boolean(parentOrigin && HUB_ORIGINS.includes(parentOrigin));

    if (embeddedInHub) {
        try {
            sessionStorage.setItem(HUB_EMBED_STORAGE_KEY, 'true');
        } catch (e) {
            // Storage can be unavailable in third-party iframes
        }
    }

    return embeddedInHub;
}
