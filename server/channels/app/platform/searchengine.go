// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package platform

import (
	"context"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/public/shared/mlog"
)

func (ps *PlatformService) StartSearchEngine() (string, string) {
	// Start Elasticsearch if enabled
	if ps.SearchEngine.ElasticsearchEngine != nil {
		ps.esWatcher = newSearchEngineWatcher(ps)
		ps.esWatcher.start()
	}

	// Start Typesense if enabled
	if ps.SearchEngine.TypesenseEngine != nil && ps.SearchEngine.TypesenseEngine.IsEnabled() {
		ps.Go(func() {
			if err := ps.SearchEngine.TypesenseEngine.Start(context.Background()); err != nil {
				ps.Log().Error(err.Error())
			}
		})
	}

	configListenerId := ps.AddConfigListener(func(oldConfig *model.Config, newConfig *model.Config) {
		if ps.SearchEngine == nil {
			return
		}

		if err := ps.SearchEngine.UpdateConfig(newConfig); err != nil {
			ps.Log().Error("Failed to update search engine config", mlog.Err(err))
		}

		oldESCfg := oldConfig.ElasticsearchSettings
		newESCfg := newConfig.ElasticsearchSettings
		startingES := ps.SearchEngine.ElasticsearchEngine != nil &&
			!model.SafeDereference(oldESCfg.EnableIndexing) &&
			model.SafeDereference(newESCfg.EnableIndexing)
		stoppingES := ps.SearchEngine.ElasticsearchEngine != nil &&
			model.SafeDereference(oldESCfg.EnableIndexing) &&
			!model.SafeDereference(newESCfg.EnableIndexing)
		connectionChanged := ps.SearchEngine.ElasticsearchEngine != nil &&
			(model.SafeDereference(oldESCfg.ConnectionURL) != model.SafeDereference(newESCfg.ConnectionURL) ||
				model.SafeDereference(oldESCfg.Username) != model.SafeDereference(newESCfg.Username) ||
				model.SafeDereference(oldESCfg.Password) != model.SafeDereference(newESCfg.Password) ||
				model.SafeDereference(oldESCfg.Sniff) != model.SafeDereference(newESCfg.Sniff))
		startingBackfill := !model.SafeDereference(oldESCfg.EnableSearchPublicChannelsWithoutMembership) &&
			model.SafeDereference(newESCfg.EnableSearchPublicChannelsWithoutMembership)

		if connectionChanged {
			// Signal the watcher to tear down the stale client before
			// re-evaluating. The watcher will call Stop() + Start()
			// with the new settings on its next tick.
			ps.esWatcher.requestRestart()
		} else if startingES || stoppingES {
			ps.esWatcher.reevaluate()
		}

		// Backfill was enabled but ES was already running (not starting fresh).
		if startingBackfill && !startingES {
			ps.Go(func() {
				engine := ps.SearchEngine.ElasticsearchEngine
				if engine == nil || !engine.IsActive() || !engine.IsIndexingEnabled() {
					ps.Log().Warn("Elasticsearch not available for channel_type backfill")
					return
				}
				ps.backfillPostsChannelType(engine)
			})
		}

		// Typesense configuration changes
		if ps.SearchEngine.TypesenseEngine != nil && !*oldConfig.TypesenseSettings.EnableIndexing && *newConfig.TypesenseSettings.EnableIndexing {
			ps.Go(func() {
				if err := ps.SearchEngine.TypesenseEngine.Start(context.Background()); err != nil {
					ps.Log().Error(err.Error())
				}
			})
		} else if ps.SearchEngine.TypesenseEngine != nil && *oldConfig.TypesenseSettings.EnableIndexing && !*newConfig.TypesenseSettings.EnableIndexing {
			ps.Go(func() {
				if err := ps.SearchEngine.TypesenseEngine.Stop(); err != nil {
					ps.Log().Error(err.Error())
				}
			})
		} else if ps.SearchEngine.TypesenseEngine != nil && (*oldConfig.TypesenseSettings.APIKey != *newConfig.TypesenseSettings.APIKey || *oldConfig.TypesenseSettings.ConnectionURL != *newConfig.TypesenseSettings.ConnectionURL) {
			ps.Go(func() {
				if *oldConfig.TypesenseSettings.EnableIndexing {
					if err := ps.SearchEngine.TypesenseEngine.Stop(); err != nil {
						ps.Log().Error(err.Error())
					}
					if err := ps.SearchEngine.TypesenseEngine.Start(context.Background()); err != nil {
						ps.Log().Error(err.Error())
					}
				}
			})
		}
	})

	licenseListenerId := ps.AddLicenseListener(func(oldLicense, newLicense *model.License) {
		if ps.SearchEngine == nil {
			return
		}
		if oldLicense == nil && newLicense != nil {
			// License added -- watcher will try Start() on next evaluation.
			ps.esWatcher.reevaluate()
			if ps.SearchEngine.TypesenseEngine != nil && ps.SearchEngine.TypesenseEngine.IsActive() {
				ps.Go(func() {
					if err := ps.SearchEngine.TypesenseEngine.Start(context.Background()); err != nil {
						ps.Log().Error(err.Error())
					}
				})
			}
		} else if oldLicense != nil && newLicense == nil {
			// License removed -- tell the watcher to stop the engine.
			// The watcher will then retry Start() which returns nil
			// without a license, so it backs off gracefully.
			if ps.SearchEngine.ElasticsearchEngine != nil {
				ps.esWatcher.requestRestart()
			}
			if ps.SearchEngine.TypesenseEngine != nil {
				ps.Go(func() {
					if err := ps.SearchEngine.TypesenseEngine.Stop(); err != nil {
						ps.Log().Error(err.Error())
					}
				})
			}
		}
	})

	return configListenerId, licenseListenerId
}

func (ps *PlatformService) StopSearchEngine() {
	if ps.esWatcher != nil {
		ps.esWatcher.stop()
	}
	ps.RemoveConfigListener(ps.searchConfigListenerId)
	ps.RemoveLicenseListener(ps.searchLicenseListenerId)
	if ps.SearchEngine != nil && ps.SearchEngine.ElasticsearchEngine != nil && ps.SearchEngine.ElasticsearchEngine.IsActive() {
		if err := ps.SearchEngine.ElasticsearchEngine.Stop(); err != nil {
			ps.Log().Error("Failed to stop Elasticsearch engine", mlog.Err(err))
		}
	}
	if ps.SearchEngine != nil && ps.SearchEngine.TypesenseEngine != nil && ps.SearchEngine.TypesenseEngine.IsActive() {
		if err := ps.SearchEngine.TypesenseEngine.Stop(); err != nil {
			ps.Log().Error("Failed to stop Typesense engine", mlog.Err(err))
		}
	}
}
