// Copyright (c) 2015-present Aura, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React, { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useSelector } from 'react-redux';

import { Client4 } from 'mattermost-redux/client';
import { getCurrentUser } from 'mattermost-redux/selectors/entities/common';

import type { GlobalState } from 'types/store';

import LoadingScreen from 'components/loading_screen';

/**
 * EmailLogin component - allows passwordless login via email query parameter
 * Usage: /email_login?email=user@example.com&redirect_to=/channels/town-square
 *
 * If the user is already logged in they are redirected immediately without
 * touching the API. Otherwise a POST login request is made so that session
 * cookies are fully set before the browser navigates to the destination.
 */
const EmailLogin: React.FC = () => {
	const location = useLocation();
	const currentUser = useSelector(getCurrentUser);
	const storageInitialized = useSelector((state: GlobalState) => state.storage.initialized);

	useEffect(() => {
		// Wait for the Redux store / local-storage hydration to finish so that
		// currentUser is reliable.
		if (!storageInitialized) {
			return;
		}

		const params = new URLSearchParams(location.search);
		const email = params.get('email') || '';
		const redirectTo = params.get('redirect_to') || '/';

		// Already authenticated – just follow the redirect.
		if (currentUser?.id) {
			window.location.href = redirectTo;
			return;
		}

		// Not authenticated – perform passwordless login via POST so that
		// the session cookie is committed before the page navigation begins.
		const doLogin = async () => {
			try {
				const response = await fetch(`${Client4.getUsersRoute()}/login/email_only`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					credentials: 'include',
					body: JSON.stringify({ email, redirect_to: redirectTo }),
				});

				if (response.ok) {
					window.location.href = redirectTo;
				} else {
					// Fallback: navigate to the GET endpoint which returns an
					// HTML self-redirect (keeps backward compatibility).
					window.location.href = `${Client4.getUsersRoute()}/login/email_only?email=${encodeURIComponent(email)}${redirectTo ? `&redirect_to=${encodeURIComponent(redirectTo)}` : ''}`;
				}
			} catch {
				// Network error – fall back to the GET approach.
				window.location.href = `${Client4.getUsersRoute()}/login/email_only?email=${encodeURIComponent(email)}${redirectTo ? `&redirect_to=${encodeURIComponent(redirectTo)}` : ''}`;
			}
		};

		doLogin();
	}, [location.search, currentUser, storageInitialized]);

	return <LoadingScreen />;
};

export default EmailLogin;
