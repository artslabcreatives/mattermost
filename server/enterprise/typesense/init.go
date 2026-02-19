// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.enterprise for license information.

package typesense

import (
	"github.com/mattermost/mattermost/server/v8/channels/app/platform"
	"github.com/mattermost/mattermost/server/v8/enterprise/typesense/typesense"
	"github.com/mattermost/mattermost/server/v8/platform/services/searchengine"
)

func init() {
	platform.RegisterTypesenseInterface(func(s *platform.PlatformService) searchengine.SearchEngineInterface {
		return &typesense.TypesenseInterfaceImpl{Platform: s}
	})
}

func MakeTypesenseInterface(ps *platform.PlatformService) searchengine.SearchEngineInterface {
	return &typesense.TypesenseInterfaceImpl{
		Platform: ps,
	}
}
