// Copyright (c) 2015-present Aura, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import type { Dispatch } from 'redux';

import { getMissingProfilesByIds } from 'mattermost-redux/actions/users';

import AuditTable from './audit_table';

function mapDispatchToProps(dispatch: Dispatch) {
	return {
		actions: bindActionCreators({
			getMissingProfilesByIds,
		}, dispatch),
	};
}

export default connect(null, mapDispatchToProps)(AuditTable);
