// Copyright (c) 2015-present Aura, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React from 'react';
import { MemoryRouter, Route } from 'react-router-dom';

import type { Team } from '@mattermost/types/teams';

import { renderWithContext, screen, waitFor } from 'tests/react_testing_utils';

import TeamController from './team_controller';

jest.mock('components/channel_layout/channel_controller', () => {
	return function MockChannelController(props: { shouldRenderCenterChannel: boolean }) {
		return <div data-testid='channel-controller' data-should-render={String(props.shouldRenderCenterChannel)} />;
	};
});

jest.mock('components/initial_loading_screen', () => ({
	stop: jest.fn(),
}));

jest.mock('components/common/hooks/useTelemetryIdentifySync', () => ({
	__esModule: true,
	default: jest.fn(),
}));

jest.mock('utils/desktop_api', () => ({
	reactAppInitialized: jest.fn(),
}));

jest.mock('mattermost-redux/selectors/entities/content_flagging', () => ({
	contentFlaggingFeatureEnabled: jest.fn(() => false),
}));

describe('components/team_controller/TeamController', () => {
	it('renders the center channel even if the initial channel fetch returns an error object', async () => {
		const team: Team = {
			id: 'team-id',
			name: 'artslab-creatives',
			display_name: 'Artslab Creatives',
			create_at: 0,
			update_at: 0,
			delete_at: 0,
			type: 'O',
			description: '',
			email: '',
			allowed_domains: '',
			company_name: '',
			policy_id: '',
			invite_id: '',
			scheme_id: '',
			group_constrained: false,
			allow_open_invite: true,
			last_team_icon_update: 0,
		};

		const fetchAllMyTeamsChannels = jest.fn().mockResolvedValue({error: new Error('network failed')});
		const fetchAllMyChannelMembers = jest.fn().mockResolvedValue({data: []});
		const initializeTeam = jest.fn().mockResolvedValue({data: team});

		renderWithContext(
			<MemoryRouter initialEntries={['/artslab-creatives/channels/town-square']}>
				<Route path='/:team'>
					<TeamController
						currentTeamId='team-id'
						currentChannelId='channel-id'
						teamsList={[team]}
						plugins={[]}
						selectedThreadId={null}
						selectedPostId={''}
						mfaRequired={false}
						disableRefetchingOnBrowserFocus={false}
						disableWakeUpReconnectHandler={false}
						fetchChannelsAndMembers={jest.fn()}
						fetchAllMyTeamsChannels={fetchAllMyTeamsChannels}
						fetchAllMyChannelMembers={fetchAllMyChannelMembers}
						markAsReadOnFocus={jest.fn()}
						initializeTeam={initializeTeam}
						joinTeam={jest.fn()}
						unsetActiveChannelOnServer={jest.fn()}
						history={{} as any}
						location={{} as any}
						match={{params: {team: 'artslab-creatives'}} as any}
					/>
				</Route>
			</MemoryRouter>,
		);

		await waitFor(() => {
			expect(screen.getByTestId('channel-controller')).toHaveAttribute('data-should-render', 'true');
		});

		expect(fetchAllMyTeamsChannels).toHaveBeenCalled();
		expect(fetchAllMyChannelMembers).toHaveBeenCalled();
		expect(initializeTeam).toHaveBeenCalledWith(team);
	});
});