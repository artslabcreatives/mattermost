// Copyright (c) 2015-present Aura, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React, { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

import { Client4 } from 'mattermost-redux/client';

import LoadingScreen from 'components/loading_screen';

/**
 * EmailLogin component - allows passwordless login via email query parameter
 * Usage: /email_login?email=user@example.com&redirect_to=/channels/town-square
 */
const EmailLogin: React.FC = () => {
	const location = useLocation();

	useEffect(() => {
		const params = new URLSearchParams(location.search);
		const email = params.get('email');
		const redirectTo = params.get('redirect_to') || '';

		// Build API URL with query parameters
		const apiUrl = `${Client4.getUsersRoute()}/login/email_only?email=${encodeURIComponent(email || '')}${redirectTo ? `&redirect_to=${encodeURIComponent(redirectTo)}` : ''}`;

		// Redirect to the API endpoint which will handle login and redirect
		window.location.href = apiUrl;
	}, [location.search]);

	return <LoadingScreen />;
};

export default EmailLogin;
