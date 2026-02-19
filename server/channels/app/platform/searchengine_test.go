// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package platform

import (
	"testing"

	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/v8/config"
	"github.com/mattermost/mattermost/server/v8/platform/services/searchengine"
	searchenginemocks "github.com/mattermost/mattermost/server/v8/platform/services/searchengine/mocks"
)

func TestStartSearchEngine_Typesense(t *testing.T) {
	t.Run("Should start Typesense when enabled", func(t *testing.T) {
		// Setup
		cfg := model.Config{}
		cfg.SetDefaults()
		*cfg.TypesenseSettings.EnableIndexing = true

		configStore := config.NewTestMemoryStore()
		configStore.Set(&cfg)

		// Create mock Typesense engine
		mockTypesenseEngine := &searchenginemocks.SearchEngineInterface{}
		mockTypesenseEngine.On("IsEnabled").Return(true)
		mockTypesenseEngine.On("Start").Return(nil).Once()
		mockTypesenseEngine.On("UpdateConfig", mock.Anything).Return()

		// Create platform service
		ps := &PlatformService{
			config:       configStore,
			SearchEngine: &searchengine.Broker{},
		}
		ps.SearchEngine.TypesenseEngine = mockTypesenseEngine

		// Execute
		ps.StartSearchEngine()

		// Verify - wait a bit for goroutine to execute
		// Note: In production code, we might want to add synchronization mechanisms
		// but for this test, we just verify that the mock expectations were met
		mockTypesenseEngine.AssertExpectations(t)
	})

	t.Run("Should not start Typesense when disabled", func(t *testing.T) {
		// Setup
		cfg := model.Config{}
		cfg.SetDefaults()
		*cfg.TypesenseSettings.EnableIndexing = false

		configStore := config.NewTestMemoryStore()
		configStore.Set(&cfg)

		// Create mock Typesense engine
		mockTypesenseEngine := &searchenginemocks.SearchEngineInterface{}
		mockTypesenseEngine.On("IsEnabled").Return(false)
		mockTypesenseEngine.On("UpdateConfig", mock.Anything).Return()

		// Create platform service
		ps := &PlatformService{
			config:       configStore,
			SearchEngine: &searchengine.Broker{},
		}
		ps.SearchEngine.TypesenseEngine = mockTypesenseEngine

		// Execute
		ps.StartSearchEngine()

		// Verify - Start should not have been called
		mockTypesenseEngine.AssertNotCalled(t, "Start")
	})

	t.Run("Should handle nil Typesense engine gracefully", func(t *testing.T) {
		// Setup
		cfg := model.Config{}
		cfg.SetDefaults()

		configStore := config.NewTestMemoryStore()
		configStore.Set(&cfg)

		// Create platform service with nil Typesense engine
		ps := &PlatformService{
			config:       configStore,
			SearchEngine: &searchengine.Broker{},
		}

		// Execute - should not panic
		require.NotPanics(t, func() {
			ps.StartSearchEngine()
		})
	})
}

func TestStopSearchEngine_Typesense(t *testing.T) {
	t.Run("Should stop active Typesense engine", func(t *testing.T) {
		// Setup
		cfg := model.Config{}
		cfg.SetDefaults()

		configStore := config.NewTestMemoryStore()
		configStore.Set(&cfg)

		// Create mock Typesense engine
		mockTypesenseEngine := &searchenginemocks.SearchEngineInterface{}
		mockTypesenseEngine.On("IsActive").Return(true)
		mockTypesenseEngine.On("Stop").Return(nil).Once()

		// Create platform service
		ps := &PlatformService{
			config:       configStore,
			SearchEngine: &searchengine.Broker{},
		}
		ps.SearchEngine.TypesenseEngine = mockTypesenseEngine

		// Execute
		ps.StopSearchEngine()

		// Verify
		mockTypesenseEngine.AssertExpectations(t)
	})

	t.Run("Should not stop inactive Typesense engine", func(t *testing.T) {
		// Setup
		cfg := model.Config{}
		cfg.SetDefaults()

		configStore := config.NewTestMemoryStore()
		configStore.Set(&cfg)

		// Create mock Typesense engine
		mockTypesenseEngine := &searchenginemocks.SearchEngineInterface{}
		mockTypesenseEngine.On("IsActive").Return(false)

		// Create platform service
		ps := &PlatformService{
			config:       configStore,
			SearchEngine: &searchengine.Broker{},
		}
		ps.SearchEngine.TypesenseEngine = mockTypesenseEngine

		// Execute
		ps.StopSearchEngine()

		// Verify - Stop should not have been called
		mockTypesenseEngine.AssertNotCalled(t, "Stop")
	})

	t.Run("Should handle nil Typesense engine gracefully", func(t *testing.T) {
		// Setup
		cfg := model.Config{}
		cfg.SetDefaults()

		configStore := config.NewTestMemoryStore()
		configStore.Set(&cfg)

		// Create platform service with nil Typesense engine
		ps := &PlatformService{
			config:       configStore,
			SearchEngine: &searchengine.Broker{},
		}

		// Execute - should not panic
		require.NotPanics(t, func() {
			ps.StopSearchEngine()
		})
	})
}
