// Copyright (c) 2015-present Aura, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React from 'react';
import { screen, waitFor } from '@testing-library/react';

import type { Post } from '@mattermost/types/posts';

import { renderWithContext } from 'tests/react_testing_utils';
import MessageInfoModal from './message_info_modal';

const mockDispatch = jest.fn();
jest.mock('react-redux', () => ({
	...jest.requireActual('react-redux'),
	useDispatch: () => mockDispatch,
}));

describe('MessageInfoModal', () => {
	const basePost: Post = {
		id: 'post_123',
		create_at: 1690000000000,
		update_at: 1690000000000,
		edit_at: 0,
		delete_at: 0,
		is_pinned: false,
		user_id: 'user_author',
		channel_id: 'channel_1',
		root_id: '',
		original_id: '',
		message: 'Hello team, this is an important message!',
		type: '' as any,
		props: {},
		hashtags: '',
		pending_post_id: '',
		reply_count: 0,
		metadata: {} as any,
	};

	beforeEach(() => {
		jest.clearAllMocks();
	});

	test('renders message excerpt, sent time, and loads seen receipts', async () => {
		mockDispatch.mockImplementation((action) => {
			if (typeof action === 'function') {
				return Promise.resolve({
					data: {
						post_id: 'post_123',
						channel_id: 'channel_1',
						create_at: 1690000000000,
						read_by: [
							{
								user_id: 'user_reader_1',
								username: 'john',
								first_name: 'John',
								last_name: 'Doe',
								nickname: '',
								viewed_at: 1690000500000,
							},
						],
						delivered_to: [
							{
								user_id: 'user_unseen_1',
								username: 'alice',
								first_name: 'Alice',
								last_name: 'Smith',
								nickname: '',
							},
						],
					},
				});
			}
			return Promise.resolve({});
		});

		renderWithContext(
			<MessageInfoModal
				post={basePost}
				onExited={jest.fn()}
			/>,
		);

		// Verify title and post content
		expect(screen.getByText('Message Info')).toBeInTheDocument();
		expect(screen.getByText('Hello team, this is an important message!')).toBeInTheDocument();

		// Wait for receipts data to load
		await waitFor(() => {
			expect(screen.getByText('John Doe')).toBeInTheDocument();
			expect(screen.getByText('@john')).toBeInTheDocument();
		});

		// Verify Read by count badge
		expect(screen.getByText('Read by')).toBeInTheDocument();
		expect(screen.getByText('Delivered to')).toBeInTheDocument();
	});
});
