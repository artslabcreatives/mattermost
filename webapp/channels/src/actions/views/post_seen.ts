// Copyright (c) 2015-present Aura, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import type { PostSeenReceipts } from '@mattermost/types/posts';
import { Client4 } from 'mattermost-redux/client';
import { forceLogoutIfNecessary } from 'mattermost-redux/actions/helpers';

import type { ActionFuncAsync } from 'types/store';

export function fetchPostSeenReceipts(postId: string): ActionFuncAsync<PostSeenReceipts> {
	return async (dispatch, getState) => {
		try {
			const data = await Client4.getPostSeenReceipts(postId);
			return { data };
		} catch (error) {
			forceLogoutIfNecessary(error, dispatch, getState);
			return { error: error as Error };
		}
	};
}
