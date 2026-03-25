// Copyright (c) 2015-present Aura, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React, { memo } from 'react';
import { FormattedMessage } from 'react-intl';
import { useDispatch, useSelector } from 'react-redux';

import { closeRightHandSide, showPinnedFiles } from 'actions/views/rhs';
import { getRhsState } from 'selectors/rhs';

import * as Menu from 'components/menu';

import { RHSStates } from 'utils/constants';

type Props = {
	channelID: string;
}

const ViewPinnedFiles = ({
	channelID,
}: Props) => {
	const dispatch = useDispatch();
	const rhsState = useSelector(getRhsState);
	const hasPinnedFiles = rhsState === RHSStates.PINNED_FILES;

	const handleClick = () => {
		if (hasPinnedFiles) {
			dispatch(closeRightHandSide());
		} else {
			dispatch(showPinnedFiles(channelID));
		}
	};

	return (
		<Menu.Item
			onClick={handleClick}
			labels={
				<FormattedMessage
					id='navbar.viewPinnedFiles'
					defaultMessage='View Pinned Files'
				/>
			}
		/>
	);
};

export default memo(ViewPinnedFiles);
