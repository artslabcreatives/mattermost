// Copyright (c) 2015-present Aura, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React from 'react';

jest.mock('@tippyjs/react', () => ({
	__esModule: true,
	default: () => (<div id='tippyMock' />),
}));
