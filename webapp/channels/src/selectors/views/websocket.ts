// Copyright (c) 2015-present Aura, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import type { GlobalState } from 'types/store';

export const getSocketStatus = (state: GlobalState) => state.websocket;
