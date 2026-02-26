// Copyright (c) 2015-present Aura, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import { ActionTypes } from 'utils/constants';

export function dismissNotice(type) {
	return (dispatch) => {
		dispatch({
			type: ActionTypes.DISMISS_NOTICE,
			data: type,
		});

		return { data: true };
	};
}
