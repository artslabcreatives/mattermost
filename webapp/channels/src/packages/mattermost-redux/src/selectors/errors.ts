// Copyright (c) 2015-present Aura, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import type { GlobalState } from '@mattermost/types/store';

export function getDisplayableErrors(state: GlobalState) {
	return state.errors.filter((error) => error.displayable);
}
