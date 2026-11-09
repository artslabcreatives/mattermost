// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package model

// PluginIDRoute matches the URL segment used by plugin HTTP and management routes.
// Keep the hyphen last: double-escaping it in a Go string can turn it into a
// character range and prevent valid hyphenated plugin IDs from reaching handlers.
const PluginIDRoute = "{plugin_id:[A-Za-z0-9_.-]+}"
