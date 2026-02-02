// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package app

import (
	"encoding/json"
	"testing"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestGetPropertyFieldReadAccess(t *testing.T) {
	th := Setup(t)
	pas := th.App.PropertyAccessService()

	// Register the CPA group
	group, appErr := th.App.RegisterPropertyGroup(th.Context, "cpa")
	require.Nil(t, appErr)
	cpaGroupID = group.ID

	pluginID1 := "plugin-1"
	pluginID2 := "plugin-2"
	userID := model.NewId()

	t.Run("public field - any caller can read without filtering", func(t *testing.T) {
		field := &model.PropertyField{
			GroupID:    group.ID,
			Name:       "public-field",
			Type:       model.PropertyFieldTypeSelect,
			TargetType: "user",
			Attrs: model.StringInterface{
				model.PropertyAttrsAccessMode: model.PropertyAccessModePublic,
				model.PropertyFieldAttributeOptions: []any{
					map[string]any{"id": "opt1", "value": "Option 1"},
					map[string]any{"id": "opt2", "value": "Option 2"},
				},
			},
		}
		created, err := pas.CreatePropertyField("", field)
		require.NoError(t, err)

		// Plugin 1 can read
		retrieved, err := pas.GetPropertyField(pluginID1, group.ID, created.ID)
		require.NoError(t, err)
		assert.Equal(t, created.ID, retrieved.ID)
		assert.Len(t, retrieved.Attrs[model.PropertyFieldAttributeOptions].([]any), 2)

		// Plugin 2 can read
		retrieved, err = pas.GetPropertyField(pluginID2, group.ID, created.ID)
		require.NoError(t, err)
		assert.Equal(t, created.ID, retrieved.ID)
		assert.Len(t, retrieved.Attrs[model.PropertyFieldAttributeOptions].([]any), 2)

		// User can read
		retrieved, err = pas.GetPropertyField(userID, group.ID, created.ID)
		require.NoError(t, err)
		assert.Equal(t, created.ID, retrieved.ID)
		assert.Len(t, retrieved.Attrs[model.PropertyFieldAttributeOptions].([]any), 2)

		// Anonymous caller can read
		retrieved, err = pas.GetPropertyField("", group.ID, created.ID)
		require.NoError(t, err)
		assert.Equal(t, created.ID, retrieved.ID)
		assert.Len(t, retrieved.Attrs[model.PropertyFieldAttributeOptions].([]any), 2)
	})

	t.Run("source_only field - source plugin gets all options", func(t *testing.T) {
		field := &model.PropertyField{
			GroupID:    group.ID,
			Name:       "source-only-field",
			Type:       model.PropertyFieldTypeSelect,
			TargetType: "user",
			Attrs: model.StringInterface{
				model.PropertyAttrsAccessMode: model.PropertyAccessModeSourceOnly,
				model.PropertyAttrsProtected:  true,
				model.PropertyFieldAttributeOptions: []any{
					map[string]any{"id": "opt1", "value": "Secret Option 1"},
					map[string]any{"id": "opt2", "value": "Secret Option 2"},
				},
			},
		}
		created, err := pas.CreatePropertyFieldForPlugin(pluginID1, field)
		require.NoError(t, err)

		// Source plugin can see all options
		retrieved, err := pas.GetPropertyField(pluginID1, group.ID, created.ID)
		require.NoError(t, err)
		assert.Equal(t, created.ID, retrieved.ID)
		assert.Len(t, retrieved.Attrs[model.PropertyFieldAttributeOptions].([]any), 2)
	})

	t.Run("source_only field - other plugin gets empty options", func(t *testing.T) {
		field := &model.PropertyField{
			GroupID:    group.ID,
			Name:       "source-only-field-2",
			Type:       model.PropertyFieldTypeSelect,
			TargetType: "user",
			Attrs: model.StringInterface{
				model.PropertyAttrsAccessMode: model.PropertyAccessModeSourceOnly,
				model.PropertyAttrsProtected:  true,
				model.PropertyFieldAttributeOptions: []any{
					map[string]any{"id": "opt1", "value": "Secret Option 1"},
					map[string]any{"id": "opt2", "value": "Secret Option 2"},
				},
			},
		}
		created, err := pas.CreatePropertyFieldForPlugin(pluginID1, field)
		require.NoError(t, err)

		// Other plugin gets field but with empty options
		retrieved, err := pas.GetPropertyField(pluginID2, group.ID, created.ID)
		require.NoError(t, err)
		assert.Equal(t, created.ID, retrieved.ID)
		assert.Empty(t, retrieved.Attrs[model.PropertyFieldAttributeOptions].([]any))
	})

	t.Run("source_only field - user gets empty options", func(t *testing.T) {
		field := &model.PropertyField{
			GroupID:    group.ID,
			Name:       "source-only-field-3",
			Type:       model.PropertyFieldTypeSelect,
			TargetType: "user",
			Attrs: model.StringInterface{
				model.PropertyAttrsAccessMode: model.PropertyAccessModeSourceOnly,
				model.PropertyAttrsProtected:  true,
				model.PropertyFieldAttributeOptions: []any{
					map[string]any{"id": "opt1", "value": "Secret Option 1"},
					map[string]any{"id": "opt2", "value": "Secret Option 2"},
				},
			},
		}
		created, err := pas.CreatePropertyFieldForPlugin(pluginID1, field)
		require.NoError(t, err)

		// User gets field but with empty options
		retrieved, err := pas.GetPropertyField(userID, group.ID, created.ID)
		require.NoError(t, err)
		assert.Equal(t, created.ID, retrieved.ID)
		assert.Empty(t, retrieved.Attrs[model.PropertyFieldAttributeOptions].([]any))
	})

	t.Run("source_only field - anonymous caller gets empty options", func(t *testing.T) {
		field := &model.PropertyField{
			GroupID:    group.ID,
			Name:       "source-only-field-4",
			Type:       model.PropertyFieldTypeSelect,
			TargetType: "user",
			Attrs: model.StringInterface{
				model.PropertyAttrsAccessMode: model.PropertyAccessModeSourceOnly,
				model.PropertyAttrsProtected:  true,
				model.PropertyFieldAttributeOptions: []any{
					map[string]any{"id": "opt1", "value": "Secret Option 1"},
					map[string]any{"id": "opt2", "value": "Secret Option 2"},
				},
			},
		}
		created, err := pas.CreatePropertyFieldForPlugin(pluginID1, field)
		require.NoError(t, err)

		// Anonymous caller gets field but with empty options
		retrieved, err := pas.GetPropertyField("", group.ID, created.ID)
		require.NoError(t, err)
		assert.Equal(t, created.ID, retrieved.ID)
		assert.Empty(t, retrieved.Attrs[model.PropertyFieldAttributeOptions].([]any))
	})

	t.Run("shared_only field - caller with values sees filtered options", func(t *testing.T) {
		field := &model.PropertyField{
			GroupID:    group.ID,
			Name:       "shared-only-field",
			Type:       model.PropertyFieldTypeMultiselect,
			TargetType: "user",
			Attrs: model.StringInterface{
				model.PropertyAttrsAccessMode: model.PropertyAccessModeSharedOnly,
				model.PropertyAttrsProtected:  true,
				model.PropertyFieldAttributeOptions: []any{
					map[string]any{"id": "opt1", "value": "Option 1"},
					map[string]any{"id": "opt2", "value": "Option 2"},
					map[string]any{"id": "opt3", "value": "Option 3"},
				},
			},
		}
		created, err := pas.CreatePropertyFieldForPlugin("test-plugin", field)
		require.NoError(t, err)

		// Create values for the caller (userID has opt1 and opt2)
		value1, err := json.Marshal([]string{"opt1", "opt2"})
		require.NoError(t, err)
		_, err = pas.CreatePropertyValue("test-plugin", &model.PropertyValue{
			GroupID:    group.ID,
			FieldID:    created.ID,
			TargetType: "user",
			TargetID:   userID,
			Value:      value1,
		})
		require.NoError(t, err)

		// User should only see opt1 and opt2
		retrieved, err := pas.GetPropertyField(userID, group.ID, created.ID)
		require.NoError(t, err)
		assert.Equal(t, created.ID, retrieved.ID)
		options := retrieved.Attrs[model.PropertyFieldAttributeOptions].([]any)
		assert.Len(t, options, 2)

		// Verify the options are opt1 and opt2
		optionIDs := make([]string, 0, len(options))
		for _, opt := range options {
			optMap := opt.(map[string]any)
			optionIDs = append(optionIDs, optMap["id"].(string))
		}
		assert.Contains(t, optionIDs, "opt1")
		assert.Contains(t, optionIDs, "opt2")
		assert.NotContains(t, optionIDs, "opt3")
	})

	t.Run("shared_only field - caller with no values sees empty options", func(t *testing.T) {
		field := &model.PropertyField{
			GroupID:    group.ID,
			Name:       "shared-only-field-2",
			Type:       model.PropertyFieldTypeMultiselect,
			TargetType: "user",
			Attrs: model.StringInterface{
				model.PropertyAttrsAccessMode: model.PropertyAccessModeSharedOnly,
				model.PropertyAttrsProtected:  true,
				model.PropertyFieldAttributeOptions: []any{
					map[string]any{"id": "opt1", "value": "Option 1"},
					map[string]any{"id": "opt2", "value": "Option 2"},
				},
			},
		}
		created, err := pas.CreatePropertyFieldForPlugin("test-plugin", field)
		require.NoError(t, err)

		// User has no values for this field
		retrieved, err := pas.GetPropertyField(userID, group.ID, created.ID)
		require.NoError(t, err)
		assert.Equal(t, created.ID, retrieved.ID)
		assert.Empty(t, retrieved.Attrs[model.PropertyFieldAttributeOptions].([]any))
	})

	t.Run("shared_only field - source plugin gets all options", func(t *testing.T) {
		field := &model.PropertyField{
			GroupID:    group.ID,
			Name:       "shared-only-field-source",
			Type:       model.PropertyFieldTypeMultiselect,
			TargetType: "user",
			Attrs: model.StringInterface{
				model.PropertyAttrsAccessMode:     model.PropertyAccessModeSharedOnly,
				model.PropertyAttrsSourcePluginID: pluginID1,
				model.PropertyAttrsProtected:      true,
				model.PropertyFieldAttributeOptions: []any{
					map[string]any{"id": "opt1", "value": "Option 1"},
					map[string]any{"id": "opt2", "value": "Option 2"},
					map[string]any{"id": "opt3", "value": "Option 3"},
				},
			},
		}
		created, err := pas.CreatePropertyFieldForPlugin(pluginID1, field)
		require.NoError(t, err)

		// Source plugin can see all options even without having any values
		retrieved, err := pas.GetPropertyField(pluginID1, group.ID, created.ID)
		require.NoError(t, err)
		assert.Equal(t, created.ID, retrieved.ID)
		options := retrieved.Attrs[model.PropertyFieldAttributeOptions].([]any)
		assert.Len(t, options, 3)

		// Other plugin with no values sees empty options
		retrieved, err = pas.GetPropertyField(pluginID2, group.ID, created.ID)
		require.NoError(t, err)
		assert.Equal(t, created.ID, retrieved.ID)
		assert.Empty(t, retrieved.Attrs[model.PropertyFieldAttributeOptions].([]any))
	})

	t.Run("field with no attrs defaults to public", func(t *testing.T) {
		field := &model.PropertyField{
			GroupID:    group.ID,
			Name:       "no-attrs-field",
			Type:       model.PropertyFieldTypeText,
			TargetType: "user",
			Attrs:      nil,
		}
		created, err := pas.CreatePropertyField("", field)
		require.NoError(t, err)

		// Any caller can read
		retrieved, err := pas.GetPropertyField(userID, group.ID, created.ID)
		require.NoError(t, err)
		assert.Equal(t, created.ID, retrieved.ID)
	})

	t.Run("field with empty access_mode defaults to public", func(t *testing.T) {
		field := &model.PropertyField{
			GroupID:    group.ID,
			Name:       "empty-access-mode-field",
			Type:       model.PropertyFieldTypeText,
			TargetType: "user",
			Attrs:      model.StringInterface{},
		}
		created, err := pas.CreatePropertyField("", field)
		require.NoError(t, err)

		// Any caller can read
		retrieved, err := pas.GetPropertyField(userID, group.ID, created.ID)
		require.NoError(t, err)
		assert.Equal(t, created.ID, retrieved.ID)
	})

	t.Run("field with invalid access_mode is rejected", func(t *testing.T) {
		field := &model.PropertyField{
			GroupID:    group.ID,
			Name:       "invalid-access-mode-field",
			Type:       model.PropertyFieldTypeSelect,
			TargetType: "user",
			Attrs: model.StringInterface{
				model.PropertyAttrsAccessMode: "invalid-mode",
				model.PropertyFieldAttributeOptions: []any{
					map[string]any{"id": "opt1", "value": "Option 1"},
				},
			},
		}
		_, err := pas.CreatePropertyField("", field)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "invalid access mode")
	})
}

func TestGetPropertyFieldsReadAccess(t *testing.T) {
	th := Setup(t)
	pas := th.App.PropertyAccessService()

	// Register the CPA group
	group, appErr := th.App.RegisterPropertyGroup(th.Context, "cpa")
	require.Nil(t, appErr)
	cpaGroupID = group.ID

	pluginID := "plugin-1"
	userID := model.NewId()

	// Create multiple fields with different access modes
	publicField := &model.PropertyField{
		GroupID:    group.ID,
		Name:       "public-field",
		Type:       model.PropertyFieldTypeText,
		TargetType: "user",
		Attrs: model.StringInterface{
			model.PropertyAttrsAccessMode: model.PropertyAccessModePublic,
		},
	}
	publicField, err := pas.CreatePropertyField("", publicField)
	require.NoError(t, err)

	sourceOnlyField := &model.PropertyField{
		GroupID:    group.ID,
		Name:       "source-only-field",
		Type:       model.PropertyFieldTypeSelect,
		TargetType: "user",
		Attrs: model.StringInterface{
			model.PropertyAttrsAccessMode: model.PropertyAccessModeSourceOnly,
			model.PropertyAttrsProtected:  true,
			model.PropertyFieldAttributeOptions: []any{
				map[string]any{"id": "opt1", "value": "Secret Option"},
			},
		},
	}
	sourceOnlyField, err = pas.CreatePropertyFieldForPlugin(pluginID, sourceOnlyField)
	require.NoError(t, err)

	sharedOnlyField := &model.PropertyField{
		GroupID:    group.ID,
		Name:       "shared-only-field",
		Type:       model.PropertyFieldTypeMultiselect,
		TargetType: "user",
		Attrs: model.StringInterface{
			model.PropertyAttrsAccessMode: model.PropertyAccessModeSharedOnly,
			model.PropertyAttrsProtected:  true,
			model.PropertyFieldAttributeOptions: []any{
				map[string]any{"id": "opt1", "value": "Option 1"},
				map[string]any{"id": "opt2", "value": "Option 2"},
			},
		},
	}
	sharedOnlyField, err = pas.CreatePropertyFieldForPlugin("test-plugin", sharedOnlyField)
	require.NoError(t, err)

	// Create a value for userID on the shared field (opt1)
	value, err := json.Marshal([]string{"opt1"})
	require.NoError(t, err)
	_, err = pas.CreatePropertyValue("test-plugin", &model.PropertyValue{
		GroupID:    group.ID,
		FieldID:    sharedOnlyField.ID,
		TargetType: "user",
		TargetID:   userID,
		Value:      value,
	})
	require.NoError(t, err)

	t.Run("source plugin sees all fields with full options", func(t *testing.T) {
		fields, err := pas.GetPropertyFields(pluginID, group.ID, []string{publicField.ID, sourceOnlyField.ID, sharedOnlyField.ID})
		require.NoError(t, err)
		require.Len(t, fields, 3)

		// Find each field and verify
		for _, field := range fields {
			if field.ID == sourceOnlyField.ID {
				// Source plugin sees all options
				assert.Len(t, field.Attrs[model.PropertyFieldAttributeOptions].([]any), 1)
			}
		}
	})

	t.Run("user sees all fields with filtered options", func(t *testing.T) {
		fields, err := pas.GetPropertyFields(userID, group.ID, []string{publicField.ID, sourceOnlyField.ID, sharedOnlyField.ID})
		require.NoError(t, err)
		require.Len(t, fields, 3)

		// Find each field and verify
		for _, field := range fields {
			if field.ID == sourceOnlyField.ID {
				// User sees empty options for source_only
				assert.Empty(t, field.Attrs[model.PropertyFieldAttributeOptions].([]any))
			} else if field.ID == sharedOnlyField.ID {
				// User sees filtered options (only opt1)
				assert.Len(t, field.Attrs[model.PropertyFieldAttributeOptions].([]any), 1)
			}
		}
	})
}

func TestSearchPropertyFieldsReadAccess(t *testing.T) {
	th := Setup(t)
	pas := th.App.PropertyAccessService()

	// Register the CPA group
	group, appErr := th.App.RegisterPropertyGroup(th.Context, "cpa")
	require.Nil(t, appErr)
	cpaGroupID = group.ID

	pluginID := "plugin-1"
	userID := model.NewId()

	// Create fields with different access modes
	publicField := &model.PropertyField{
		GroupID:    group.ID,
		Name:       "public-search-field",
		Type:       model.PropertyFieldTypeText,
		TargetType: "user",
		Attrs: model.StringInterface{
			model.PropertyAttrsAccessMode: model.PropertyAccessModePublic,
		},
	}
	_, err := pas.CreatePropertyField("", publicField)
	require.NoError(t, err)

	sourceOnlyField := &model.PropertyField{
		GroupID:    group.ID,
		Name:       "source-search-field",
		Type:       model.PropertyFieldTypeSelect,
		TargetType: "user",
		Attrs: model.StringInterface{
			model.PropertyAttrsAccessMode: model.PropertyAccessModeSourceOnly,
			model.PropertyAttrsProtected:  true,
			model.PropertyFieldAttributeOptions: []any{
				map[string]any{"id": "opt1", "value": "Secret"},
			},
		},
	}
	_, err = pas.CreatePropertyFieldForPlugin(pluginID, sourceOnlyField)
	require.NoError(t, err)

	sharedOnlyField := &model.PropertyField{
		GroupID:    group.ID,
		Name:       "shared-search-field",
		Type:       model.PropertyFieldTypeMultiselect,
		TargetType: "user",
		Attrs: model.StringInterface{
			model.PropertyAttrsAccessMode: model.PropertyAccessModeSharedOnly,
			model.PropertyAttrsProtected:  true,
			model.PropertyFieldAttributeOptions: []any{
				map[string]any{"id": "opt1", "value": "Option 1"},
				map[string]any{"id": "opt2", "value": "Option 2"},
			},
		},
	}
	sharedOnlyField, err = pas.CreatePropertyFieldForPlugin("test-plugin", sharedOnlyField)
	require.NoError(t, err)

	// Create value for userID (opt1)
	value, err := json.Marshal([]string{"opt1"})
	require.NoError(t, err)
	_, err = pas.CreatePropertyValue("test-plugin", &model.PropertyValue{
		GroupID:    group.ID,
		FieldID:    sharedOnlyField.ID,
		TargetType: "user",
		TargetID:   userID,
		Value:      value,
	})
	require.NoError(t, err)

	t.Run("search returns all fields with appropriate filtering", func(t *testing.T) {
		// User search
		results, err := pas.SearchPropertyFields(userID, group.ID, model.PropertyFieldSearchOpts{
			PerPage: 100,
		})
		require.NoError(t, err)
		assert.GreaterOrEqual(t, len(results), 3)

		// Verify filtering
		for _, field := range results {
			if field.Name == "source-search-field" {
				// User sees empty options for source_only
				assert.Empty(t, field.Attrs[model.PropertyFieldAttributeOptions].([]any))
			} else if field.Name == "shared-search-field" {
				// User sees filtered options (only opt1)
				options := field.Attrs[model.PropertyFieldAttributeOptions].([]any)
				assert.Len(t, options, 1)
			}
		}
	})

	t.Run("source plugin search sees unfiltered options", func(t *testing.T) {
		results, err := pas.SearchPropertyFields(pluginID, group.ID, model.PropertyFieldSearchOpts{
			PerPage: 100,
		})
		require.NoError(t, err)

		// Verify source plugin sees all options
		for _, field := range results {
			if field.Name == "source-search-field" {
				assert.Len(t, field.Attrs[model.PropertyFieldAttributeOptions].([]any), 1)
			}
		}
	})
}

func TestGetPropertyFieldByNameReadAccess(t *testing.T) {
	th := Setup(t)
	pas := th.App.PropertyAccessService()

	// Register the CPA group
	group, appErr := th.App.RegisterPropertyGroup(th.Context, "cpa")
	require.Nil(t, appErr)
	cpaGroupID = group.ID

	pluginID := "plugin-1"
	userID := model.NewId()
	targetID := model.NewId()

	t.Run("source_only field by name - filters options for non-source", func(t *testing.T) {
		field := &model.PropertyField{
			GroupID:    group.ID,
			Name:       "byname-source-only",
			Type:       model.PropertyFieldTypeSelect,
			TargetType: "user",
			TargetID:   targetID,
			Attrs: model.StringInterface{
				model.PropertyAttrsAccessMode: model.PropertyAccessModeSourceOnly,
				model.PropertyAttrsProtected:  true,
				model.PropertyFieldAttributeOptions: []any{
					map[string]any{"id": "opt1", "value": "Secret"},
				},
			},
		}
		created, err := pas.CreatePropertyFieldForPlugin(pluginID, field)
		require.NoError(t, err)

		// Source plugin can see options
		retrieved, err := pas.GetPropertyFieldByName(pluginID, group.ID, targetID, created.Name)
		require.NoError(t, err)
		assert.Len(t, retrieved.Attrs[model.PropertyFieldAttributeOptions].([]any), 1)

		// User sees empty options
		retrieved, err = pas.GetPropertyFieldByName(userID, group.ID, targetID, created.Name)
		require.NoError(t, err)
		assert.Empty(t, retrieved.Attrs[model.PropertyFieldAttributeOptions].([]any))
	})
}

// TestCreatePropertyField_SourcePluginIDValidation tests source_plugin_id validation during field creation
func TestCreatePropertyField_SourcePluginIDValidation(t *testing.T) {
	th := Setup(t)

	// Register the CPA group
	group, appErr := th.App.RegisterPropertyGroup(th.Context, "cpa")
	require.Nil(t, appErr)
	cpaGroupID = group.ID

	t.Run("allows field creation without source_plugin_id", func(t *testing.T) {
		field := &model.PropertyField{
			GroupID: cpaGroupID,
			Name:    model.NewId(),
			Type:    model.PropertyFieldTypeText,
		}

		created, err := th.App.PropertyAccessService().CreatePropertyField("user1", field)
		require.NoError(t, err)
		assert.NotNil(t, created)
		// Verify source_plugin_id was not set
		assert.Nil(t, created.Attrs[model.PropertyAttrsSourcePluginID])
	})

	t.Run("rejects any attempt to set source_plugin_id via CreatePropertyField", func(t *testing.T) {
		field := &model.PropertyField{
			GroupID: cpaGroupID,
			Name:    model.NewId(),
			Type:    model.PropertyFieldTypeText,
			Attrs: model.StringInterface{
				model.PropertyAttrsSourcePluginID: "plugin1",
			},
		}

		// Should be rejected even if caller matches
		created, err := th.App.PropertyAccessService().CreatePropertyField("plugin1", field)
		require.Error(t, err)
		assert.Nil(t, created)
		assert.Contains(t, err.Error(), "source_plugin_id cannot be set directly")
	})

	t.Run("rejects source_plugin_id from user/admin via CreatePropertyField", func(t *testing.T) {
		field := &model.PropertyField{
			GroupID: cpaGroupID,
			Name:    model.NewId(),
			Type:    model.PropertyFieldTypeText,
			Attrs: model.StringInterface{
				model.PropertyAttrsSourcePluginID: "plugin1",
			},
		}

		created, err := th.App.PropertyAccessService().CreatePropertyField("user-id-123", field)
		require.Error(t, err)
		assert.Nil(t, created)
		assert.Contains(t, err.Error(), "source_plugin_id cannot be set directly")
	})

	t.Run("allows empty string source_plugin_id", func(t *testing.T) {
		field := &model.PropertyField{
			GroupID: cpaGroupID,
			Name:    model.NewId(),
			Type:    model.PropertyFieldTypeText,
			Attrs: model.StringInterface{
				model.PropertyAttrsSourcePluginID: "",
			},
		}

		// Empty string is allowed (default value from API serialization)
		created, err := th.App.PropertyAccessService().CreatePropertyField("", field)
		require.NoError(t, err)
		assert.NotNil(t, created)
	})

	t.Run("rejects protected attribute via CreatePropertyField", func(t *testing.T) {
		field := &model.PropertyField{
			GroupID: cpaGroupID,
			Name:    model.NewId(),
			Type:    model.PropertyFieldTypeText,
			Attrs: model.StringInterface{
				model.PropertyAttrsProtected: true,
			},
		}

		// Should be rejected - only plugins can set protected via CreatePropertyFieldForPlugin
		created, err := th.App.PropertyAccessService().CreatePropertyField("user1", field)
		require.Error(t, err)
		assert.Nil(t, created)
		assert.Contains(t, err.Error(), "protected can only be set by plugins")
	})

	t.Run("rejects protected attribute even when caller is empty", func(t *testing.T) {
		field := &model.PropertyField{
			GroupID: cpaGroupID,
			Name:    model.NewId(),
			Type:    model.PropertyFieldTypeText,
			Attrs: model.StringInterface{
				model.PropertyAttrsProtected: true,
			},
		}

		created, err := th.App.PropertyAccessService().CreatePropertyField("", field)
		require.Error(t, err)
		assert.Nil(t, created)
		assert.Contains(t, err.Error(), "protected can only be set by plugins")
	})
}

// TestCreatePropertyFieldForPlugin tests the plugin-specific field creation method
func TestCreatePropertyFieldForPlugin(t *testing.T) {
	th := Setup(t)

	// Register the CPA group
	group, appErr := th.App.RegisterPropertyGroup(th.Context, "cpa")
	require.Nil(t, appErr)
	cpaGroupID = group.ID

	t.Run("automatically sets source_plugin_id", func(t *testing.T) {
		field := &model.PropertyField{
			GroupID: cpaGroupID,
			Name:    model.NewId(),
			Type:    model.PropertyFieldTypeText,
		}

		created, err := th.App.PropertyAccessService().CreatePropertyFieldForPlugin("plugin1", field)
		require.NoError(t, err)
		assert.NotNil(t, created)
		assert.Equal(t, "plugin1", created.Attrs[model.PropertyAttrsSourcePluginID])
	})

	t.Run("overwrites any pre-set source_plugin_id with plugin ID", func(t *testing.T) {
		field := &model.PropertyField{
			GroupID: cpaGroupID,
			Name:    model.NewId(),
			Type:    model.PropertyFieldTypeText,
			Attrs: model.StringInterface{
				model.PropertyAttrsSourcePluginID: "malicious-plugin",
			},
		}

		created, err := th.App.PropertyAccessService().CreatePropertyFieldForPlugin("plugin1", field)
		require.NoError(t, err)
		assert.NotNil(t, created)
		// Should override with correct plugin ID
		assert.Equal(t, "plugin1", created.Attrs[model.PropertyAttrsSourcePluginID])
	})

	t.Run("rejects empty plugin ID", func(t *testing.T) {
		field := &model.PropertyField{
			GroupID: cpaGroupID,
			Name:    model.NewId(),
			Type:    model.PropertyFieldTypeText,
		}

		created, err := th.App.PropertyAccessService().CreatePropertyFieldForPlugin("", field)
		require.Error(t, err)
		assert.Nil(t, created)
		assert.Contains(t, err.Error(), "pluginID is required")
	})

	t.Run("creates protected field with source_only access mode", func(t *testing.T) {
		field := &model.PropertyField{
			GroupID:    cpaGroupID,
			Name:       model.NewId(),
			Type:       model.PropertyFieldTypeSelect,
			TargetType: "user",
			Attrs: model.StringInterface{
				model.PropertyAttrsProtected:  true,
				model.PropertyAttrsAccessMode: model.PropertyAccessModeSourceOnly,
				model.PropertyFieldAttributeOptions: []any{
					map[string]any{"id": "opt1", "value": "Secret Option"},
				},
			},
		}

		created, err := th.App.PropertyAccessService().CreatePropertyFieldForPlugin("security-plugin", field)
		require.NoError(t, err)
		assert.NotNil(t, created)
		assert.Equal(t, "security-plugin", created.Attrs[model.PropertyAttrsSourcePluginID])
		assert.True(t, created.Attrs[model.PropertyAttrsProtected].(bool))
		assert.Equal(t, model.PropertyAccessModeSourceOnly, created.Attrs[model.PropertyAttrsAccessMode])
	})
}

// TestUpdatePropertyField_WriteAccessControl tests write access control for field updates
func TestUpdatePropertyField_WriteAccessControl(t *testing.T) {
	th := Setup(t)

	// Register the CPA group
	group, appErr := th.App.RegisterPropertyGroup(th.Context, "cpa")
	require.Nil(t, appErr)
	cpaGroupID = group.ID

	t.Run("allows update of unprotected field", func(t *testing.T) {
		field := &model.PropertyField{
			GroupID: cpaGroupID,
			Name:    "Original Name",
			Type:    model.PropertyFieldTypeText,
		}

		created, err := th.App.PropertyAccessService().CreatePropertyField("plugin1", field)
		require.NoError(t, err)

		created.Name = "Updated Name"
		updated, err := th.App.PropertyAccessService().UpdatePropertyField("plugin2", cpaGroupID, created)
		require.NoError(t, err)
		assert.Equal(t, "Updated Name", updated.Name)
	})

	t.Run("allows source plugin to update protected field", func(t *testing.T) {
		field := &model.PropertyField{
			GroupID: cpaGroupID,
			Name:    "Protected Field",
			Type:    model.PropertyFieldTypeText,
			Attrs: model.StringInterface{
				model.PropertyAttrsProtected: true,
			},
		}

		created, err := th.App.PropertyAccessService().CreatePropertyFieldForPlugin("plugin1", field)
		require.NoError(t, err)

		created.Name = "Updated Protected Field"
		updated, err := th.App.PropertyAccessService().UpdatePropertyField("plugin1", cpaGroupID, created)
		require.NoError(t, err)
		assert.Equal(t, "Updated Protected Field", updated.Name)
	})

	t.Run("denies non-source plugin updating protected field", func(t *testing.T) {
		field := &model.PropertyField{
			GroupID: cpaGroupID,
			Name:    "Protected Field",
			Type:    model.PropertyFieldTypeText,
			Attrs: model.StringInterface{
				model.PropertyAttrsProtected: true,
			},
		}

		created, err := th.App.PropertyAccessService().CreatePropertyFieldForPlugin("plugin1", field)
		require.NoError(t, err)

		created.Name = "Attempted Update"
		updated, err := th.App.PropertyAccessService().UpdatePropertyField("plugin2", cpaGroupID, created)
		require.Error(t, err)
		assert.Nil(t, updated)
		assert.Contains(t, err.Error(), "protected")
		assert.Contains(t, err.Error(), "plugin1")
	})

	t.Run("denies empty callerID updating protected field", func(t *testing.T) {
		field := &model.PropertyField{
			GroupID: cpaGroupID,
			Name:    "Protected Field Empty Caller",
			Type:    model.PropertyFieldTypeText,
			Attrs: model.StringInterface{
				model.PropertyAttrsProtected: true,
			},
		}

		created, err := th.App.PropertyAccessService().CreatePropertyFieldForPlugin("plugin1", field)
		require.NoError(t, err)

		created.Name = "Attempted Update"
		updated, err := th.App.PropertyAccessService().UpdatePropertyField("", cpaGroupID, created)
		require.Error(t, err)
		assert.Nil(t, updated)
		assert.Contains(t, err.Error(), "protected")
	})

	t.Run("prevents changing source_plugin_id", func(t *testing.T) {
		field := &model.PropertyField{
			GroupID: cpaGroupID,
			Name:    "Field",
			Type:    model.PropertyFieldTypeText,
			Attrs:   model.StringInterface{},
		}

		created, err := th.App.PropertyAccessService().CreatePropertyFieldForPlugin("plugin1", field)
		require.NoError(t, err)

		// Try to change source_plugin_id
		created.Attrs[model.PropertyAttrsSourcePluginID] = "plugin2"
		updated, err := th.App.PropertyAccessService().UpdatePropertyField("plugin1", cpaGroupID, created)
		require.Error(t, err)
		assert.Nil(t, updated)
		assert.Contains(t, err.Error(), "immutable")
	})
}

// TestUpdatePropertyFields_BulkWriteAccessControl tests bulk field updates with atomic access checking
func TestUpdatePropertyFields_BulkWriteAccessControl(t *testing.T) {
	th := Setup(t)

	// Register the CPA group
	group, appErr := th.App.RegisterPropertyGroup(th.Context, "cpa")
	require.Nil(t, appErr)
	cpaGroupID = group.ID

	t.Run("allows bulk update of unprotected fields", func(t *testing.T) {
		field1 := &model.PropertyField{GroupID: cpaGroupID, Name: "Field1", Type: model.PropertyFieldTypeText}
		field2 := &model.PropertyField{GroupID: cpaGroupID, Name: "Field2", Type: model.PropertyFieldTypeText}

		created1, err := th.App.PropertyAccessService().CreatePropertyField("plugin1", field1)
		require.NoError(t, err)
		created2, err := th.App.PropertyAccessService().CreatePropertyField("plugin1", field2)
		require.NoError(t, err)

		created1.Name = "Updated Field1"
		created2.Name = "Updated Field2"

		updated, err := th.App.PropertyAccessService().UpdatePropertyFields("plugin2", cpaGroupID, []*model.PropertyField{created1, created2})
		require.NoError(t, err)
		assert.Len(t, updated, 2)
	})

	t.Run("fails atomically when one protected field in batch", func(t *testing.T) {
		// Create unprotected field
		field1 := &model.PropertyField{GroupID: cpaGroupID, Name: "Unprotected", Type: model.PropertyFieldTypeText}
		created1, err := th.App.PropertyAccessService().CreatePropertyField("plugin1", field1)
		require.NoError(t, err)

		// Create protected field
		field2 := &model.PropertyField{
			GroupID: cpaGroupID,
			Name:    "Protected",
			Type:    model.PropertyFieldTypeText,
			Attrs: model.StringInterface{
				model.PropertyAttrsProtected: true,
			},
		}
		created2, err := th.App.PropertyAccessService().CreatePropertyFieldForPlugin("plugin1", field2)
		require.NoError(t, err)

		// Try to update both with plugin2 (should fail atomically)
		created1.Name = "Updated Unprotected"
		created2.Name = "Updated Protected"

		updated, err := th.App.PropertyAccessService().UpdatePropertyFields("plugin2", cpaGroupID, []*model.PropertyField{created1, created2})
		require.Error(t, err)
		assert.Nil(t, updated)
		assert.Contains(t, err.Error(), "protected")

		// Verify neither was updated
		check1, err := th.App.PropertyAccessService().GetPropertyField("plugin1", cpaGroupID, created1.ID)
		require.NoError(t, err)
		assert.Equal(t, "Unprotected", check1.Name)

		check2, err := th.App.PropertyAccessService().GetPropertyField("plugin1", cpaGroupID, created2.ID)
		require.NoError(t, err)
		assert.Equal(t, "Protected", check2.Name)
	})
}

// TestDeletePropertyField_WriteAccessControl tests write access control for field deletion
func TestDeletePropertyField_WriteAccessControl(t *testing.T) {
	th := Setup(t)
	pas := th.App.PropertyAccessService()

	// Register the CPA group
	group, appErr := th.App.RegisterPropertyGroup(th.Context, "cpa")
	require.Nil(t, appErr)
	cpaGroupID = group.ID

	t.Run("allows deletion of unprotected field", func(t *testing.T) {
		field := &model.PropertyField{GroupID: cpaGroupID, Name: "Unprotected", Type: model.PropertyFieldTypeText}
		created, err := th.App.PropertyAccessService().CreatePropertyField("plugin1", field)
		require.NoError(t, err)

		err = th.App.PropertyAccessService().DeletePropertyField("plugin2", cpaGroupID, created.ID)
		require.NoError(t, err)
	})

	t.Run("allows source plugin to delete protected field", func(t *testing.T) {
		field := &model.PropertyField{
			GroupID: cpaGroupID,
			Name:    "Protected",
			Type:    model.PropertyFieldTypeText,
			Attrs: model.StringInterface{
				model.PropertyAttrsProtected: true,
			},
		}
		created, err := th.App.PropertyAccessService().CreatePropertyFieldForPlugin("plugin1", field)
		require.NoError(t, err)

		err = th.App.PropertyAccessService().DeletePropertyField("plugin1", cpaGroupID, created.ID)
		require.NoError(t, err)
	})

	t.Run("denies non-source plugin deleting protected field", func(t *testing.T) {
		pas.setPluginCheckerForTests(func(pluginID string) bool {
			return pluginID == "plugin1"
		})

		field := &model.PropertyField{
			GroupID: cpaGroupID,
			Name:    "Protected",
			Type:    model.PropertyFieldTypeText,
			Attrs: model.StringInterface{
				model.PropertyAttrsProtected: true,
			},
		}
		created, err := pas.CreatePropertyFieldForPlugin("plugin1", field)
		require.NoError(t, err)

		err = pas.DeletePropertyField("plugin2", cpaGroupID, created.ID)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "protected")
	})
}

// TestCreatePropertyValue_WriteAccessControl tests write access control for value creation
func TestCreatePropertyValue_WriteAccessControl(t *testing.T) {
	th := Setup(t)

	// Register the CPA group
	group, appErr := th.App.RegisterPropertyGroup(th.Context, "cpa")
	require.Nil(t, appErr)
	cpaGroupID = group.ID

	t.Run("allows creating value for public field", func(t *testing.T) {
		field := &model.PropertyField{GroupID: cpaGroupID, Name: "Public", Type: model.PropertyFieldTypeText}
		created, err := th.App.PropertyAccessService().CreatePropertyField("plugin1", field)
		require.NoError(t, err)

		value := &model.PropertyValue{
			GroupID:    cpaGroupID,
			FieldID:    created.ID,
			TargetType: "user",
			TargetID:   model.NewId(),
			Value:      json.RawMessage(`"test value"`),
		}

		createdValue, err := th.App.PropertyAccessService().CreatePropertyValue("plugin2", value)
		require.NoError(t, err)
		assert.NotNil(t, createdValue)
	})

	t.Run("allows source plugin to create value for source_only field", func(t *testing.T) {
		field := &model.PropertyField{
			GroupID: cpaGroupID,
			Name:    "SourceOnly",
			Type:    model.PropertyFieldTypeText,
			Attrs: model.StringInterface{
				model.PropertyAttrsAccessMode: model.PropertyAccessModeSourceOnly,
				model.PropertyAttrsProtected:  true,
			},
		}
		created, err := th.App.PropertyAccessService().CreatePropertyFieldForPlugin("plugin1", field)
		require.NoError(t, err)

		value := &model.PropertyValue{
			GroupID:    cpaGroupID,
			FieldID:    created.ID,
			TargetType: "user",
			TargetID:   model.NewId(),
			Value:      json.RawMessage(`"secret value"`),
		}

		createdValue, err := th.App.PropertyAccessService().CreatePropertyValue("plugin1", value)
		require.NoError(t, err)
		assert.NotNil(t, createdValue)
	})

	t.Run("denies creating value for protected field by non-source", func(t *testing.T) {
		field := &model.PropertyField{
			GroupID: cpaGroupID,
			Name:    "Protected",
			Type:    model.PropertyFieldTypeText,
			Attrs: model.StringInterface{
				model.PropertyAttrsProtected: true,
			},
		}
		created, err := th.App.PropertyAccessService().CreatePropertyFieldForPlugin("plugin1", field)
		require.NoError(t, err)

		value := &model.PropertyValue{
			GroupID:    cpaGroupID,
			FieldID:    created.ID,
			TargetType: "user",
			TargetID:   model.NewId(),
			Value:      json.RawMessage(`"value"`),
		}

		createdValue, err := th.App.PropertyAccessService().CreatePropertyValue("plugin2", value)
		require.Error(t, err)
		assert.Nil(t, createdValue)
		assert.Contains(t, err.Error(), "protected")
	})
}

// TestDeletePropertyValue_WriteAccessControl tests write access control for value deletion
func TestDeletePropertyValue_WriteAccessControl(t *testing.T) {
	th := Setup(t)

	// Register the CPA group
	group, appErr := th.App.RegisterPropertyGroup(th.Context, "cpa")
	require.Nil(t, appErr)
	cpaGroupID = group.ID

	t.Run("allows deleting value for public field", func(t *testing.T) {
		field := &model.PropertyField{GroupID: cpaGroupID, Name: "Public", Type: model.PropertyFieldTypeText}
		created, err := th.App.PropertyAccessService().CreatePropertyField("plugin1", field)
		require.NoError(t, err)

		value := &model.PropertyValue{
			GroupID:    cpaGroupID,
			FieldID:    created.ID,
			TargetType: "user",
			TargetID:   model.NewId(),
			Value:      json.RawMessage(`"test"`),
		}
		createdValue, err := th.App.PropertyAccessService().CreatePropertyValue("plugin1", value)
		require.NoError(t, err)

		err = th.App.PropertyAccessService().DeletePropertyValue("plugin2", cpaGroupID, createdValue.ID)
		require.NoError(t, err)
	})

	t.Run("denies non-source deleting value for protected field", func(t *testing.T) {
		field := &model.PropertyField{
			GroupID: cpaGroupID,
			Name:    "Protected",
			Type:    model.PropertyFieldTypeText,
			Attrs: model.StringInterface{
				model.PropertyAttrsProtected: true,
			},
		}
		created, err := th.App.PropertyAccessService().CreatePropertyFieldForPlugin("plugin1", field)
		require.NoError(t, err)

		value := &model.PropertyValue{
			GroupID:    cpaGroupID,
			FieldID:    created.ID,
			TargetType: "user",
			TargetID:   model.NewId(),
			Value:      json.RawMessage(`"test"`),
		}
		createdValue, err := th.App.PropertyAccessService().CreatePropertyValue("plugin1", value)
		require.NoError(t, err)

		err = th.App.PropertyAccessService().DeletePropertyValue("plugin2", cpaGroupID, createdValue.ID)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "protected")
	})
}

// TestDeletePropertyValuesForTarget_WriteAccessControl tests bulk deletion with access control
func TestDeletePropertyValuesForTarget_WriteAccessControl(t *testing.T) {
	th := Setup(t)

	// Register the CPA group
	group, appErr := th.App.RegisterPropertyGroup(th.Context, "cpa")
	require.Nil(t, appErr)
	cpaGroupID = group.ID

	t.Run("allows deleting all values when caller has write access to all fields", func(t *testing.T) {
		field1 := &model.PropertyField{GroupID: cpaGroupID, Name: "Field1", Type: model.PropertyFieldTypeText}
		field2 := &model.PropertyField{GroupID: cpaGroupID, Name: "Field2", Type: model.PropertyFieldTypeText}

		created1, err := th.App.PropertyAccessService().CreatePropertyField("plugin1", field1)
		require.NoError(t, err)
		created2, err := th.App.PropertyAccessService().CreatePropertyField("plugin1", field2)
		require.NoError(t, err)

		targetID := model.NewId()
		value1 := &model.PropertyValue{GroupID: cpaGroupID, FieldID: created1.ID, TargetType: "user", TargetID: targetID, Value: json.RawMessage(`"v1"`)}
		value2 := &model.PropertyValue{GroupID: cpaGroupID, FieldID: created2.ID, TargetType: "user", TargetID: targetID, Value: json.RawMessage(`"v2"`)}

		_, err = th.App.PropertyAccessService().CreatePropertyValue("plugin1", value1)
		require.NoError(t, err)
		_, err = th.App.PropertyAccessService().CreatePropertyValue("plugin1", value2)
		require.NoError(t, err)

		err = th.App.PropertyAccessService().DeletePropertyValuesForTarget("plugin2", cpaGroupID, "user", targetID)
		require.NoError(t, err)
	})

	t.Run("fails atomically when caller lacks access to one field", func(t *testing.T) {
		// Create public field
		field1 := &model.PropertyField{GroupID: cpaGroupID, Name: "Public", Type: model.PropertyFieldTypeText}
		created1, err := th.App.PropertyAccessService().CreatePropertyField("plugin1", field1)
		require.NoError(t, err)

		// Create protected field
		field2 := &model.PropertyField{
			GroupID: cpaGroupID,
			Name:    "Protected",
			Type:    model.PropertyFieldTypeText,
			Attrs: model.StringInterface{
				model.PropertyAttrsProtected: true,
			},
		}
		created2, err := th.App.PropertyAccessService().CreatePropertyFieldForPlugin("plugin1", field2)
		require.NoError(t, err)

		targetID := model.NewId()
		value1 := &model.PropertyValue{GroupID: cpaGroupID, FieldID: created1.ID, TargetType: "user", TargetID: targetID, Value: json.RawMessage(`"v1"`)}
		value2 := &model.PropertyValue{GroupID: cpaGroupID, FieldID: created2.ID, TargetType: "user", TargetID: targetID, Value: json.RawMessage(`"v2"`)}

		_, err = th.App.PropertyAccessService().CreatePropertyValue("plugin1", value1)
		require.NoError(t, err)
		_, err = th.App.PropertyAccessService().CreatePropertyValue("plugin1", value2)
		require.NoError(t, err)

		// Try to delete with plugin2 (should fail)
		err = th.App.PropertyAccessService().DeletePropertyValuesForTarget("plugin2", cpaGroupID, "user", targetID)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "protected")

		// Verify values still exist
		values, err := th.App.PropertyAccessService().SearchPropertyValues("plugin1", cpaGroupID, model.PropertyValueSearchOpts{
			TargetIDs: []string{targetID},
			PerPage:   10,
		})
		require.NoError(t, err)
		assert.Len(t, values, 2)
	})
}

func TestGetPropertyValueReadAccess(t *testing.T) {
	th := Setup(t)
	pas := th.App.PropertyAccessService()

	// Register the CPA group
	group, appErr := th.App.RegisterPropertyGroup(th.Context, "cpa")
	require.Nil(t, appErr)
	cpaGroupID = group.ID

	pluginID1 := "plugin-1"
	pluginID2 := "plugin-2"
	userID1 := model.NewId()
	userID2 := model.NewId()

	t.Run("public field value - any caller can read", func(t *testing.T) {
		// Create public field
		field := &model.PropertyField{
			GroupID:    group.ID,
			Name:       "public-field",
			Type:       model.PropertyFieldTypeText,
			TargetType: "user",
			Attrs: model.StringInterface{
				model.PropertyAttrsAccessMode: model.PropertyAccessModePublic,
			},
		}
		field, err := pas.CreatePropertyField("", field)
		require.NoError(t, err)

		// Create value
		textValue, err := json.Marshal("test value")
		require.NoError(t, err)
		value := &model.PropertyValue{
			GroupID:    group.ID,
			FieldID:    field.ID,
			TargetType: "user",
			TargetID:   userID1,
			Value:      textValue,
		}
		value, err = pas.CreatePropertyValue("", value)
		require.NoError(t, err)

		// Plugin 1 can read
		retrieved, err := pas.GetPropertyValue(pluginID1, group.ID, value.ID)
		require.NoError(t, err)
		require.NotNil(t, retrieved)
		assert.Equal(t, value.ID, retrieved.ID)
		assert.Equal(t, json.RawMessage(textValue), retrieved.Value)

		// Plugin 2 can read
		retrieved, err = pas.GetPropertyValue(pluginID2, group.ID, value.ID)
		require.NoError(t, err)
		require.NotNil(t, retrieved)
		assert.Equal(t, value.ID, retrieved.ID)

		// User can read
		retrieved, err = pas.GetPropertyValue(userID2, group.ID, value.ID)
		require.NoError(t, err)
		require.NotNil(t, retrieved)
		assert.Equal(t, value.ID, retrieved.ID)

		// Anonymous caller can read
		retrieved, err = pas.GetPropertyValue("", group.ID, value.ID)
		require.NoError(t, err)
		require.NotNil(t, retrieved)
		assert.Equal(t, value.ID, retrieved.ID)
	})

	t.Run("source_only field value - only source plugin can read", func(t *testing.T) {
		// Create source_only field
		field := &model.PropertyField{
			GroupID:    group.ID,
			Name:       "source-only-field",
			Type:       model.PropertyFieldTypeText,
			TargetType: "user",
			Attrs: model.StringInterface{
				model.PropertyAttrsAccessMode: model.PropertyAccessModeSourceOnly,
				model.PropertyAttrsProtected:  true,
			},
		}
		field, err := pas.CreatePropertyFieldForPlugin(pluginID1, field)
		require.NoError(t, err)

		// Create value
		textValue, err := json.Marshal("secret value")
		require.NoError(t, err)
		value := &model.PropertyValue{
			GroupID:    group.ID,
			FieldID:    field.ID,
			TargetType: "user",
			TargetID:   userID1,
			Value:      textValue,
		}
		value, err = pas.CreatePropertyValue(pluginID1, value)
		require.NoError(t, err)

		// Source plugin can read
		retrieved, err := pas.GetPropertyValue(pluginID1, group.ID, value.ID)
		require.NoError(t, err)
		require.NotNil(t, retrieved)
		assert.Equal(t, value.ID, retrieved.ID)
		assert.Equal(t, json.RawMessage(textValue), retrieved.Value)
	})

	t.Run("source_only field value - other plugin gets nil", func(t *testing.T) {
		// Create source_only field
		field := &model.PropertyField{
			GroupID:    group.ID,
			Name:       "source-only-field-2",
			Type:       model.PropertyFieldTypeText,
			TargetType: "user",
			Attrs: model.StringInterface{
				model.PropertyAttrsAccessMode: model.PropertyAccessModeSourceOnly,
				model.PropertyAttrsProtected:  true,
			},
		}
		field, err := pas.CreatePropertyFieldForPlugin(pluginID1, field)
		require.NoError(t, err)

		// Create value
		textValue, err := json.Marshal("secret value")
		require.NoError(t, err)
		value := &model.PropertyValue{
			GroupID:    group.ID,
			FieldID:    field.ID,
			TargetType: "user",
			TargetID:   userID1,
			Value:      textValue,
		}
		value, err = pas.CreatePropertyValue(pluginID1, value)
		require.NoError(t, err)

		// Other plugin gets nil
		retrieved, err := pas.GetPropertyValue(pluginID2, group.ID, value.ID)
		require.NoError(t, err)
		assert.Nil(t, retrieved)

		// User gets nil
		retrieved, err = pas.GetPropertyValue(userID2, group.ID, value.ID)
		require.NoError(t, err)
		assert.Nil(t, retrieved)

		// Anonymous caller gets nil
		retrieved, err = pas.GetPropertyValue("", group.ID, value.ID)
		require.NoError(t, err)
		assert.Nil(t, retrieved)
	})

	t.Run("shared_only single-select - return value only if caller has same", func(t *testing.T) {
		// Create shared_only field
		field := &model.PropertyField{
			GroupID:    group.ID,
			Name:       "shared-only-single-select",
			Type:       model.PropertyFieldTypeSelect,
			TargetType: "user",
			Attrs: model.StringInterface{
				model.PropertyAttrsAccessMode: model.PropertyAccessModeSharedOnly,
				model.PropertyAttrsProtected:  true,
				model.PropertyFieldAttributeOptions: []any{
					map[string]any{"id": "opt1", "value": "Option 1"},
					map[string]any{"id": "opt2", "value": "Option 2"},
					map[string]any{"id": "opt3", "value": "Option 3"},
				},
			},
		}
		field, err := pas.CreatePropertyFieldForPlugin("test-plugin", field)
		require.NoError(t, err)

		// User 1 has opt1
		user1Value, err := json.Marshal("opt1")
		require.NoError(t, err)
		value1 := &model.PropertyValue{
			GroupID:    group.ID,
			FieldID:    field.ID,
			TargetType: "user",
			TargetID:   userID1,
			Value:      user1Value,
		}
		value1, err = pas.CreatePropertyValue("test-plugin", value1)
		require.NoError(t, err)

		// User 2 also has opt1
		user2Value, err := json.Marshal("opt1")
		require.NoError(t, err)
		value2 := &model.PropertyValue{
			GroupID:    group.ID,
			FieldID:    field.ID,
			TargetType: "user",
			TargetID:   userID2,
			Value:      user2Value,
		}
		_, err = pas.CreatePropertyValue("test-plugin", value2)
		require.NoError(t, err)

		// User 2 can see user 1's value (both have opt1)
		retrieved, err := pas.GetPropertyValue(userID2, group.ID, value1.ID)
		require.NoError(t, err)
		require.NotNil(t, retrieved)
		assert.Equal(t, value1.ID, retrieved.ID)
		assert.Equal(t, json.RawMessage(user1Value), retrieved.Value)

		// Create another user with opt2
		userID3 := model.NewId()
		user3Value, err := json.Marshal("opt2")
		require.NoError(t, err)
		value3 := &model.PropertyValue{
			GroupID:    group.ID,
			FieldID:    field.ID,
			TargetType: "user",
			TargetID:   userID3,
			Value:      user3Value,
		}
		_, err = pas.CreatePropertyValue("test-plugin", value3)
		require.NoError(t, err)

		// User 3 cannot see user 1's value (different options, no intersection)
		retrieved, err = pas.GetPropertyValue(userID3, group.ID, value1.ID)
		require.NoError(t, err)
		assert.Nil(t, retrieved)
	})

	t.Run("shared_only multi-select - return intersection of arrays", func(t *testing.T) {
		// Create shared_only multiselect field
		field := &model.PropertyField{
			GroupID:    group.ID,
			Name:       "shared-only-multi-select",
			Type:       model.PropertyFieldTypeMultiselect,
			TargetType: "user",
			Attrs: model.StringInterface{
				model.PropertyAttrsAccessMode: model.PropertyAccessModeSharedOnly,
				model.PropertyAttrsProtected:  true,
				model.PropertyFieldAttributeOptions: []any{
					map[string]any{"id": "opt1", "value": "Hiking"},
					map[string]any{"id": "opt2", "value": "Cooking"},
					map[string]any{"id": "opt3", "value": "Gaming"},
				},
			},
		}
		field, err := pas.CreatePropertyFieldForPlugin("test-plugin", field)
		require.NoError(t, err)

		// Alice has ["opt1", "opt2"] (hiking, cooking)
		aliceID := model.NewId()
		aliceValue, err := json.Marshal([]string{"opt1", "opt2"})
		require.NoError(t, err)
		alicePropertyValue := &model.PropertyValue{
			GroupID:    group.ID,
			FieldID:    field.ID,
			TargetType: "user",
			TargetID:   aliceID,
			Value:      aliceValue,
		}
		alicePropertyValue, err = pas.CreatePropertyValue("test-plugin", alicePropertyValue)
		require.NoError(t, err)

		// Bob has ["opt1", "opt3"] (hiking, gaming)
		bobID := model.NewId()
		bobValue, err := json.Marshal([]string{"opt1", "opt3"})
		require.NoError(t, err)
		bobPropertyValue := &model.PropertyValue{
			GroupID:    group.ID,
			FieldID:    field.ID,
			TargetType: "user",
			TargetID:   bobID,
			Value:      bobValue,
		}
		_, err = pas.CreatePropertyValue("test-plugin", bobPropertyValue)
		require.NoError(t, err)

		// Bob views Alice - should only see ["opt1"] (intersection)
		retrieved, err := pas.GetPropertyValue(bobID, group.ID, alicePropertyValue.ID)
		require.NoError(t, err)
		require.NotNil(t, retrieved)
		assert.Equal(t, alicePropertyValue.ID, retrieved.ID)

		var retrievedOptions []string
		err = json.Unmarshal(retrieved.Value, &retrievedOptions)
		require.NoError(t, err)
		assert.Len(t, retrievedOptions, 1)
		assert.Contains(t, retrievedOptions, "opt1")

		// Create user with no overlapping values
		charlieID := model.NewId()
		charlieValue, err := json.Marshal([]string{"opt3"})
		require.NoError(t, err)
		charliePropertyValue := &model.PropertyValue{
			GroupID:    group.ID,
			FieldID:    field.ID,
			TargetType: "user",
			TargetID:   charlieID,
			Value:      charlieValue,
		}
		_, err = pas.CreatePropertyValue("test-plugin", charliePropertyValue)
		require.NoError(t, err)

		// Charlie views Alice - should get nil (no intersection)
		retrieved, err = pas.GetPropertyValue(charlieID, group.ID, alicePropertyValue.ID)
		require.NoError(t, err)
		assert.Nil(t, retrieved)
	})

	t.Run("shared_only value - caller with no values sees nothing", func(t *testing.T) {
		// Create shared_only field
		field := &model.PropertyField{
			GroupID:    group.ID,
			Name:       "shared-only-no-values",
			Type:       model.PropertyFieldTypeMultiselect,
			TargetType: "user",
			Attrs: model.StringInterface{
				model.PropertyAttrsAccessMode: model.PropertyAccessModeSharedOnly,
				model.PropertyAttrsProtected:  true,
				model.PropertyFieldAttributeOptions: []any{
					map[string]any{"id": "opt1", "value": "Option 1"},
				},
			},
		}
		field, err := pas.CreatePropertyFieldForPlugin("test-plugin", field)
		require.NoError(t, err)

		// Create value for user 1
		user1Value, err := json.Marshal([]string{"opt1"})
		require.NoError(t, err)
		value := &model.PropertyValue{
			GroupID:    group.ID,
			FieldID:    field.ID,
			TargetType: "user",
			TargetID:   userID1,
			Value:      user1Value,
		}
		value, err = pas.CreatePropertyValue("test-plugin", value)
		require.NoError(t, err)

		// User 2 has no values for this field
		retrieved, err := pas.GetPropertyValue(userID2, group.ID, value.ID)
		require.NoError(t, err)
		assert.Nil(t, retrieved)
	})
}

func TestGetPropertyValuesReadAccess(t *testing.T) {
	th := Setup(t)
	pas := th.App.PropertyAccessService()

	// Register the CPA group
	group, appErr := th.App.RegisterPropertyGroup(th.Context, "cpa")
	require.Nil(t, appErr)
	cpaGroupID = group.ID

	pluginID1 := "plugin-1"
	pluginID2 := "plugin-2"
	userID := model.NewId()

	t.Run("mixed access modes - bulk read respects per-field access control", func(t *testing.T) {
		// Create public field
		publicField := &model.PropertyField{
			GroupID:    group.ID,
			Name:       "public-field-bulk",
			Type:       model.PropertyFieldTypeText,
			TargetType: "user",
			Attrs: model.StringInterface{
				model.PropertyAttrsAccessMode: model.PropertyAccessModePublic,
			},
		}
		publicField, err := pas.CreatePropertyField("", publicField)
		require.NoError(t, err)

		// Create source_only field
		sourceOnlyField := &model.PropertyField{
			GroupID:    group.ID,
			Name:       "source-only-field-bulk",
			Type:       model.PropertyFieldTypeText,
			TargetType: "user",
			Attrs: model.StringInterface{
				model.PropertyAttrsAccessMode: model.PropertyAccessModeSourceOnly,
				model.PropertyAttrsProtected:  true,
			},
		}
		sourceOnlyField, err = pas.CreatePropertyFieldForPlugin(pluginID1, sourceOnlyField)
		require.NoError(t, err)

		// Create values
		publicValue, err := json.Marshal("public")
		require.NoError(t, err)
		publicPropValue := &model.PropertyValue{
			GroupID:    group.ID,
			FieldID:    publicField.ID,
			TargetType: "user",
			TargetID:   userID,
			Value:      publicValue,
		}
		publicPropValue, err = pas.CreatePropertyValue("", publicPropValue)
		require.NoError(t, err)

		sourceOnlyValue, err := json.Marshal("secret")
		require.NoError(t, err)
		sourceOnlyPropValue := &model.PropertyValue{
			GroupID:    group.ID,
			FieldID:    sourceOnlyField.ID,
			TargetType: "user",
			TargetID:   userID,
			Value:      sourceOnlyValue,
		}
		sourceOnlyPropValue, err = pas.CreatePropertyValue(pluginID1, sourceOnlyPropValue)
		require.NoError(t, err)

		// Plugin 1 (source) sees both values
		retrieved, err := pas.GetPropertyValues(pluginID1, group.ID, []string{publicPropValue.ID, sourceOnlyPropValue.ID})
		require.NoError(t, err)
		assert.Len(t, retrieved, 2)

		// Plugin 2 sees only public value
		retrieved, err = pas.GetPropertyValues(pluginID2, group.ID, []string{publicPropValue.ID, sourceOnlyPropValue.ID})
		require.NoError(t, err)
		assert.Len(t, retrieved, 1)
		assert.Equal(t, publicPropValue.ID, retrieved[0].ID)

		// User sees only public value
		retrieved, err = pas.GetPropertyValues(userID, group.ID, []string{publicPropValue.ID, sourceOnlyPropValue.ID})
		require.NoError(t, err)
		assert.Len(t, retrieved, 1)
		assert.Equal(t, publicPropValue.ID, retrieved[0].ID)
	})
}

func TestSearchPropertyValuesReadAccess(t *testing.T) {
	th := Setup(t)
	pas := th.App.PropertyAccessService()

	// Register the CPA group
	group, appErr := th.App.RegisterPropertyGroup(th.Context, "cpa")
	require.Nil(t, appErr)
	cpaGroupID = group.ID

	pluginID1 := "plugin-1"
	pluginID2 := "plugin-2"
	userID1 := model.NewId()
	userID2 := model.NewId()

	t.Run("search filters based on field access", func(t *testing.T) {
		// Create public field
		publicField := &model.PropertyField{
			GroupID:    group.ID,
			Name:       "public-field-search",
			Type:       model.PropertyFieldTypeText,
			TargetType: "user",
			Attrs: model.StringInterface{
				model.PropertyAttrsAccessMode: model.PropertyAccessModePublic,
			},
		}
		publicField, err := pas.CreatePropertyField("", publicField)
		require.NoError(t, err)

		// Create source_only field
		sourceOnlyField := &model.PropertyField{
			GroupID:    group.ID,
			Name:       "source-only-field-search",
			Type:       model.PropertyFieldTypeText,
			TargetType: "user",
			Attrs: model.StringInterface{
				model.PropertyAttrsAccessMode: model.PropertyAccessModeSourceOnly,
				model.PropertyAttrsProtected:  true,
			},
		}
		sourceOnlyField, err = pas.CreatePropertyFieldForPlugin(pluginID1, sourceOnlyField)
		require.NoError(t, err)

		// Create values for both fields
		publicValue, err := json.Marshal("public data")
		require.NoError(t, err)
		_, err = pas.CreatePropertyValue("", &model.PropertyValue{
			GroupID:    group.ID,
			FieldID:    publicField.ID,
			TargetType: "user",
			TargetID:   userID1,
			Value:      publicValue,
		})
		require.NoError(t, err)

		sourceOnlyValue, err := json.Marshal("secret data")
		require.NoError(t, err)
		_, err = pas.CreatePropertyValue(pluginID1, &model.PropertyValue{
			GroupID:    group.ID,
			FieldID:    sourceOnlyField.ID,
			TargetType: "user",
			TargetID:   userID1,
			Value:      sourceOnlyValue,
		})
		require.NoError(t, err)

		// Source plugin sees both values
		results, err := pas.SearchPropertyValues(pluginID1, group.ID, model.PropertyValueSearchOpts{
			TargetIDs: []string{userID1},
			PerPage:   100,
		})
		require.NoError(t, err)
		assert.Len(t, results, 2)

		// Other plugin sees only public value
		results, err = pas.SearchPropertyValues(pluginID2, group.ID, model.PropertyValueSearchOpts{
			TargetIDs: []string{userID1},
			PerPage:   100,
		})
		require.NoError(t, err)
		assert.Len(t, results, 1)
		assert.Equal(t, publicField.ID, results[0].FieldID)
	})

	t.Run("search shared_only values show intersection", func(t *testing.T) {
		// Create shared_only field
		sharedField := &model.PropertyField{
			GroupID:    group.ID,
			Name:       "shared-field-search",
			Type:       model.PropertyFieldTypeMultiselect,
			TargetType: "user",
			Attrs: model.StringInterface{
				model.PropertyAttrsAccessMode: model.PropertyAccessModeSharedOnly,
				model.PropertyAttrsProtected:  true,
				model.PropertyFieldAttributeOptions: []any{
					map[string]any{"id": "opt1", "value": "Option 1"},
					map[string]any{"id": "opt2", "value": "Option 2"},
					map[string]any{"id": "opt3", "value": "Option 3"},
				},
			},
		}
		sharedField, err := pas.CreatePropertyFieldForPlugin("test-plugin", sharedField)
		require.NoError(t, err)

		// User 1 has ["opt1", "opt2"]
		user1Value, err := json.Marshal([]string{"opt1", "opt2"})
		require.NoError(t, err)
		_, err = pas.CreatePropertyValue("test-plugin", &model.PropertyValue{
			GroupID:    group.ID,
			FieldID:    sharedField.ID,
			TargetType: "user",
			TargetID:   userID1,
			Value:      user1Value,
		})
		require.NoError(t, err)

		// User 2 has ["opt1", "opt3"]
		user2Value, err := json.Marshal([]string{"opt1", "opt3"})
		require.NoError(t, err)
		_, err = pas.CreatePropertyValue("test-plugin", &model.PropertyValue{
			GroupID:    group.ID,
			FieldID:    sharedField.ID,
			TargetType: "user",
			TargetID:   userID2,
			Value:      user2Value,
		})
		require.NoError(t, err)

		// User 2 searches for user 1's values - should see only ["opt1"]
		results, err := pas.SearchPropertyValues(userID2, group.ID, model.PropertyValueSearchOpts{
			TargetIDs: []string{userID1},
			FieldID:   sharedField.ID,
			PerPage:   100,
		})
		require.NoError(t, err)
		require.Len(t, results, 1)

		var retrievedOptions []string
		err = json.Unmarshal(results[0].Value, &retrievedOptions)
		require.NoError(t, err)
		assert.Len(t, retrievedOptions, 1)
		assert.Contains(t, retrievedOptions, "opt1")
	})
}

// TestCreatePropertyValues_WriteAccessControl tests write access control for bulk value creation
func TestCreatePropertyValues_WriteAccessControl(t *testing.T) {
	th := Setup(t)
	pas := th.App.PropertyAccessService()

	// Register the CPA group
	group, appErr := th.App.RegisterPropertyGroup(th.Context, "cpa")
	require.Nil(t, appErr)
	cpaGroupID = group.ID

	pluginID1 := "plugin-1"
	pluginID2 := "plugin-2"

	t.Run("allows creating values for public fields", func(t *testing.T) {
		field1 := &model.PropertyField{
			GroupID:    group.ID,
			Name:       "public-field-1",
			Type:       model.PropertyFieldTypeText,
			TargetType: "user",
			Attrs: model.StringInterface{
				model.PropertyAttrsAccessMode: model.PropertyAccessModePublic,
			},
		}
		field1, err := pas.CreatePropertyField("", field1)
		require.NoError(t, err)

		field2 := &model.PropertyField{
			GroupID:    group.ID,
			Name:       "public-field-2",
			Type:       model.PropertyFieldTypeText,
			TargetType: "user",
			Attrs: model.StringInterface{
				model.PropertyAttrsAccessMode: model.PropertyAccessModePublic,
			},
		}
		field2, err = pas.CreatePropertyField("", field2)
		require.NoError(t, err)

		targetID := model.NewId()
		value1, v1err := json.Marshal("value1")
		require.NoError(t, v1err)
		value2, v2err := json.Marshal("value2")
		require.NoError(t, v2err)

		values := []*model.PropertyValue{
			{
				GroupID:    group.ID,
				FieldID:    field1.ID,
				TargetType: "user",
				TargetID:   targetID,
				Value:      value1,
			},
			{
				GroupID:    group.ID,
				FieldID:    field2.ID,
				TargetType: "user",
				TargetID:   targetID,
				Value:      value2,
			},
		}

		created, cerr := pas.CreatePropertyValues(pluginID2, values)
		require.NoError(t, cerr)
		assert.Len(t, created, 2)
	})

	t.Run("allows source plugin to create values for protected fields", func(t *testing.T) {
		field1 := &model.PropertyField{
			GroupID:    group.ID,
			Name:       "protected-field-1",
			Type:       model.PropertyFieldTypeText,
			TargetType: "user",
			Attrs: model.StringInterface{
				model.PropertyAttrsAccessMode: model.PropertyAccessModeSourceOnly,
				model.PropertyAttrsProtected:  true,
			},
		}
		field1, err := pas.CreatePropertyFieldForPlugin(pluginID1, field1)
		require.NoError(t, err)

		field2 := &model.PropertyField{
			GroupID:    group.ID,
			Name:       "protected-field-2",
			Type:       model.PropertyFieldTypeText,
			TargetType: "user",
			Attrs: model.StringInterface{
				model.PropertyAttrsAccessMode: model.PropertyAccessModeSourceOnly,
				model.PropertyAttrsProtected:  true,
			},
		}
		field2, err = pas.CreatePropertyFieldForPlugin(pluginID1, field2)
		require.NoError(t, err)

		targetID := model.NewId()
		value1, v1err := json.Marshal("secret1")
		require.NoError(t, v1err)
		value2, v2err := json.Marshal("secret2")
		require.NoError(t, v2err)

		values := []*model.PropertyValue{
			{
				GroupID:    group.ID,
				FieldID:    field1.ID,
				TargetType: "user",
				TargetID:   targetID,
				Value:      value1,
			},
			{
				GroupID:    group.ID,
				FieldID:    field2.ID,
				TargetType: "user",
				TargetID:   targetID,
				Value:      value2,
			},
		}

		created, cerr := pas.CreatePropertyValues(pluginID1, values)
		require.NoError(t, cerr)
		assert.Len(t, created, 2)
	})

	t.Run("fails atomically when one protected field in batch", func(t *testing.T) {
		publicField := &model.PropertyField{
			GroupID:    group.ID,
			Name:       "public-field-batch",
			Type:       model.PropertyFieldTypeText,
			TargetType: "user",
			Attrs: model.StringInterface{
				model.PropertyAttrsAccessMode: model.PropertyAccessModePublic,
			},
		}
		publicField, err := pas.CreatePropertyField("", publicField)
		require.NoError(t, err)

		protectedField := &model.PropertyField{
			GroupID:    group.ID,
			Name:       "protected-field-batch",
			Type:       model.PropertyFieldTypeText,
			TargetType: "user",
			Attrs: model.StringInterface{
				model.PropertyAttrsAccessMode: model.PropertyAccessModeSourceOnly,
				model.PropertyAttrsProtected:  true,
			},
		}
		protectedField, err = pas.CreatePropertyFieldForPlugin(pluginID1, protectedField)
		require.NoError(t, err)

		targetID := model.NewId()
		publicValue, err := json.Marshal("public data")
		require.NoError(t, err)
		protectedValue, err := json.Marshal("secret data")
		require.NoError(t, err)

		values := []*model.PropertyValue{
			{
				GroupID:    group.ID,
				FieldID:    publicField.ID,
				TargetType: "user",
				TargetID:   targetID,
				Value:      publicValue,
			},
			{
				GroupID:    group.ID,
				FieldID:    protectedField.ID,
				TargetType: "user",
				TargetID:   targetID,
				Value:      protectedValue,
			},
		}

		// Plugin 2 should fail to create both values atomically
		created, err := pas.CreatePropertyValues(pluginID2, values)
		require.Error(t, err)
		assert.Nil(t, created)
		assert.Contains(t, err.Error(), "protected")

		// Verify neither value was created
		results, err := pas.SearchPropertyValues(pluginID1, group.ID, model.PropertyValueSearchOpts{
			TargetIDs: []string{targetID},
			PerPage:   100,
		})
		require.NoError(t, err)
		assert.Empty(t, results)
	})

	t.Run("creates values across multiple groups", func(t *testing.T) {
		// Register a second group
		group2, appErr := th.App.RegisterPropertyGroup(th.Context, "test-group-create-values-2")
		require.Nil(t, appErr)

		// Create fields in both groups
		field1 := &model.PropertyField{
			GroupID:    group.ID,
			Name:       "field-group1",
			Type:       model.PropertyFieldTypeText,
			TargetType: "user",
			Attrs: model.StringInterface{
				model.PropertyAttrsAccessMode: model.PropertyAccessModePublic,
			},
		}
		field1, err := pas.CreatePropertyField("", field1)
		require.NoError(t, err)

		field2 := &model.PropertyField{
			GroupID:    group2.ID,
			Name:       "field-group2",
			Type:       model.PropertyFieldTypeText,
			TargetType: "user",
			Attrs: model.StringInterface{
				model.PropertyAttrsAccessMode: model.PropertyAccessModePublic,
			},
		}
		field2, err = pas.CreatePropertyField("", field2)
		require.NoError(t, err)

		targetID := model.NewId()
		value1, err := json.Marshal("data from group 1")
		require.NoError(t, err)
		value2, err := json.Marshal("data from group 2")
		require.NoError(t, err)

		// Create values for fields from different groups in a single call
		values := []*model.PropertyValue{
			{
				GroupID:    group.ID,
				FieldID:    field1.ID,
				TargetType: "user",
				TargetID:   targetID,
				Value:      value1,
			},
			{
				GroupID:    group2.ID,
				FieldID:    field2.ID,
				TargetType: "user",
				TargetID:   targetID,
				Value:      value2,
			},
		}

		created, err := pas.CreatePropertyValues(pluginID2, values)
		require.NoError(t, err)
		assert.Len(t, created, 2)

		// Verify both values were created
		retrieved1, err := pas.GetPropertyValue(pluginID2, group.ID, created[0].ID)
		require.NoError(t, err)
		require.NotNil(t, retrieved1)

		retrieved2, err := pas.GetPropertyValue(pluginID2, group2.ID, created[1].ID)
		require.NoError(t, err)
		require.NotNil(t, retrieved2)
	})

	t.Run("enforces access control across multiple groups atomically", func(t *testing.T) {
		// Register a third group
		group3, appErr := th.App.RegisterPropertyGroup(th.Context, "test-group-create-values-3")
		require.Nil(t, appErr)

		// Create public field in group 1
		publicField := &model.PropertyField{
			GroupID:    group.ID,
			Name:       "public-field-multigroup",
			Type:       model.PropertyFieldTypeText,
			TargetType: "user",
			Attrs: model.StringInterface{
				model.PropertyAttrsAccessMode: model.PropertyAccessModePublic,
			},
		}
		publicField, err := pas.CreatePropertyField("", publicField)
		require.NoError(t, err)

		// Create protected field in group 3
		protectedField := &model.PropertyField{
			GroupID:    group3.ID,
			Name:       "protected-field-multigroup",
			Type:       model.PropertyFieldTypeText,
			TargetType: "user",
			Attrs: model.StringInterface{
				model.PropertyAttrsAccessMode: model.PropertyAccessModeSourceOnly,
				model.PropertyAttrsProtected:  true,
			},
		}
		protectedField, err = pas.CreatePropertyFieldForPlugin(pluginID1, protectedField)
		require.NoError(t, err)

		targetID := model.NewId()
		publicValue, err := json.Marshal("public data")
		require.NoError(t, err)
		protectedValue, err := json.Marshal("secret data")
		require.NoError(t, err)

		// Try to create values from different groups with one protected field
		values := []*model.PropertyValue{
			{
				GroupID:    group.ID,
				FieldID:    publicField.ID,
				TargetType: "user",
				TargetID:   targetID,
				Value:      publicValue,
			},
			{
				GroupID:    group3.ID,
				FieldID:    protectedField.ID,
				TargetType: "user",
				TargetID:   targetID,
				Value:      protectedValue,
			},
		}

		// Plugin 2 should fail atomically
		created, err := pas.CreatePropertyValues(pluginID2, values)
		require.Error(t, err)
		assert.Nil(t, created)
		assert.Contains(t, err.Error(), "protected")

		// Verify no values were created in either group
		results1, err := pas.SearchPropertyValues(pluginID1, group.ID, model.PropertyValueSearchOpts{
			TargetIDs: []string{targetID},
			PerPage:   100,
		})
		require.NoError(t, err)
		assert.Empty(t, results1)

		results3, err := pas.SearchPropertyValues(pluginID1, group3.ID, model.PropertyValueSearchOpts{
			TargetIDs: []string{targetID},
			PerPage:   100,
		})
		require.NoError(t, err)
		assert.Empty(t, results3)
	})
}

func TestDeletePropertyField_OrphanedFieldDeletion(t *testing.T) {
	th := Setup(t)
	pas := th.App.PropertyAccessService()

	groupID, err := th.App.CpaGroupID()
	require.NoError(t, err)

	t.Run("allows deletion of orphaned protected field when plugin is uninstalled", func(t *testing.T) {
		pas.setPluginCheckerForTests(func(pluginID string) bool {
			return false
		})

		field := &model.PropertyField{
			GroupID: groupID,
			Name:    "Orphaned Protected Field",
			Type:    model.PropertyFieldTypeText,
			Attrs: model.StringInterface{
				model.PropertyAttrsProtected: true,
			},
		}
		created, err := pas.CreatePropertyFieldForPlugin("removed-plugin", field)
		require.NoError(t, err)

		err = pas.DeletePropertyField("admin-user", groupID, created.ID)
		require.NoError(t, err)
	})

	t.Run("blocks deletion of protected field when plugin is still installed", func(t *testing.T) {
		pas.setPluginCheckerForTests(func(pluginID string) bool {
			return pluginID == "installed-plugin"
		})

		field := &model.PropertyField{
			GroupID: groupID,
			Name:    "Active Protected Field",
			Type:    model.PropertyFieldTypeText,
			Attrs: model.StringInterface{
				model.PropertyAttrsProtected: true,
			},
		}
		created, err := pas.CreatePropertyFieldForPlugin("installed-plugin", field)
		require.NoError(t, err)

		err = pas.DeletePropertyField("admin-user", groupID, created.ID)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "protected")
		assert.Contains(t, err.Error(), "installed-plugin")

		err = pas.DeletePropertyField("installed-plugin", groupID, created.ID)
		require.NoError(t, err)
	})

	t.Run("blocks update of orphaned protected field even when plugin is uninstalled", func(t *testing.T) {
		pas.setPluginCheckerForTests(func(pluginID string) bool {
			return false
		})

		field := &model.PropertyField{
			GroupID: groupID,
			Name:    "Orphaned Field For Update",
			Type:    model.PropertyFieldTypeText,
			Attrs: model.StringInterface{
				model.PropertyAttrsProtected: true,
			},
		}
		created, err := pas.CreatePropertyFieldForPlugin("removed-plugin", field)
		require.NoError(t, err)

		created.Name = "Updated Orphaned Field"
		updated, err := pas.UpdatePropertyField("admin-user", groupID, created)
		require.Error(t, err)
		assert.Nil(t, updated)
		assert.Contains(t, err.Error(), "protected")
	})
}

func TestUpdatePropertyValue_WriteAccessControl(t *testing.T) {
	th := Setup(t)
	pas := th.App.PropertyAccessService()

	// Register the CPA group
	group, appErr := th.App.RegisterPropertyGroup(th.Context, "cpa")
	require.Nil(t, appErr)
	cpaGroupID = group.ID

	t.Run("source plugin can update values for protected field", func(t *testing.T) {
		// Create a protected field
		field := &model.PropertyField{
			GroupID:    cpaGroupID,
			Name:       "protected-field-for-update",
			Type:       model.PropertyFieldTypeText,
			TargetType: "user",
			Attrs: model.StringInterface{
				model.PropertyAttrsProtected: true,
			},
		}
		created, err := pas.CreatePropertyFieldForPlugin("plugin1", field)
		require.NoError(t, err)

		// Create a value
		value := &model.PropertyValue{
			GroupID:    cpaGroupID,
			FieldID:    created.ID,
			TargetType: "user",
			TargetID:   model.NewId(),
			Value:      json.RawMessage(`"original"`),
		}
		createdValue, err := pas.CreatePropertyValue("plugin1", value)
		require.NoError(t, err)

		// Source plugin can update the value
		createdValue.Value = json.RawMessage(`"updated"`)
		updated, err := pas.UpdatePropertyValue("plugin1", cpaGroupID, createdValue)
		require.NoError(t, err)
		assert.NotNil(t, updated)
		assert.Equal(t, `"updated"`, string(updated.Value))
	})

	t.Run("non-source plugin cannot update values for protected field", func(t *testing.T) {
		// Create a protected field
		field := &model.PropertyField{
			GroupID:    cpaGroupID,
			Name:       "protected-field-for-update-2",
			Type:       model.PropertyFieldTypeText,
			TargetType: "user",
			Attrs: model.StringInterface{
				model.PropertyAttrsProtected: true,
			},
		}
		created, err := pas.CreatePropertyFieldForPlugin("plugin1", field)
		require.NoError(t, err)

		// Create a value with plugin1
		value := &model.PropertyValue{
			GroupID:    cpaGroupID,
			FieldID:    created.ID,
			TargetType: "user",
			TargetID:   model.NewId(),
			Value:      json.RawMessage(`"original"`),
		}
		createdValue, err := pas.CreatePropertyValue("plugin1", value)
		require.NoError(t, err)

		// Different plugin cannot update
		createdValue.Value = json.RawMessage(`"hacked"`)
		updated, err := pas.UpdatePropertyValue("plugin2", cpaGroupID, createdValue)
		require.Error(t, err)
		assert.Nil(t, updated)
		assert.Contains(t, err.Error(), "protected")
	})

	t.Run("any caller can update values for non-protected field", func(t *testing.T) {
		// Create a non-protected field
		field := &model.PropertyField{
			GroupID:    cpaGroupID,
			Name:       "public-field-for-update",
			Type:       model.PropertyFieldTypeText,
			TargetType: "user",
		}
		created, err := pas.CreatePropertyField("", field)
		require.NoError(t, err)

		// Create a value
		value := &model.PropertyValue{
			GroupID:    cpaGroupID,
			FieldID:    created.ID,
			TargetType: "user",
			TargetID:   model.NewId(),
			Value:      json.RawMessage(`"original"`),
		}
		createdValue, err := pas.CreatePropertyValue("plugin1", value)
		require.NoError(t, err)

		// Different plugin can update
		createdValue.Value = json.RawMessage(`"updated by plugin2"`)
		updated, err := pas.UpdatePropertyValue("plugin2", cpaGroupID, createdValue)
		require.NoError(t, err)
		assert.NotNil(t, updated)
		assert.Equal(t, `"updated by plugin2"`, string(updated.Value))
	})
}

func TestUpdatePropertyValues_WriteAccessControl(t *testing.T) {
	th := Setup(t)
	pas := th.App.PropertyAccessService()

	// Register the CPA group
	group, appErr := th.App.RegisterPropertyGroup(th.Context, "cpa")
	require.Nil(t, appErr)
	cpaGroupID = group.ID

	pluginID1 := "plugin-1"
	pluginID2 := "plugin-2"

	t.Run("source plugin can update multiple values atomically", func(t *testing.T) {
		// Create two protected fields
		field1 := &model.PropertyField{
			GroupID:    cpaGroupID,
			Name:       "bulk-update-field-1",
			Type:       model.PropertyFieldTypeText,
			TargetType: "user",
			Attrs: model.StringInterface{
				model.PropertyAttrsProtected: true,
			},
		}
		field2 := &model.PropertyField{
			GroupID:    cpaGroupID,
			Name:       "bulk-update-field-2",
			Type:       model.PropertyFieldTypeText,
			TargetType: "user",
			Attrs: model.StringInterface{
				model.PropertyAttrsProtected: true,
			},
		}
		created1, err := pas.CreatePropertyFieldForPlugin(pluginID1, field1)
		require.NoError(t, err)
		created2, err := pas.CreatePropertyFieldForPlugin(pluginID1, field2)
		require.NoError(t, err)

		// Create values
		targetID := model.NewId()
		value1 := &model.PropertyValue{
			GroupID:    cpaGroupID,
			FieldID:    created1.ID,
			TargetType: "user",
			TargetID:   targetID,
			Value:      json.RawMessage(`"value1"`),
		}
		value2 := &model.PropertyValue{
			GroupID:    cpaGroupID,
			FieldID:    created2.ID,
			TargetType: "user",
			TargetID:   targetID,
			Value:      json.RawMessage(`"value2"`),
		}
		createdValues, err := pas.CreatePropertyValues(pluginID1, []*model.PropertyValue{value1, value2})
		require.NoError(t, err)
		require.Len(t, createdValues, 2)

		// Update both values
		createdValues[0].Value = json.RawMessage(`"updated1"`)
		createdValues[1].Value = json.RawMessage(`"updated2"`)
		updated, err := pas.UpdatePropertyValues(pluginID1, cpaGroupID, createdValues)
		require.NoError(t, err)
		assert.Len(t, updated, 2)
	})

	t.Run("non-source plugin cannot update values atomically", func(t *testing.T) {
		// Create two protected fields
		field1 := &model.PropertyField{
			GroupID:    cpaGroupID,
			Name:       "bulk-update-fail-1",
			Type:       model.PropertyFieldTypeText,
			TargetType: "user",
			Attrs: model.StringInterface{
				model.PropertyAttrsProtected: true,
			},
		}
		field2 := &model.PropertyField{
			GroupID:    cpaGroupID,
			Name:       "bulk-update-fail-2",
			Type:       model.PropertyFieldTypeText,
			TargetType: "user",
			Attrs: model.StringInterface{
				model.PropertyAttrsProtected: true,
			},
		}
		created1, err := pas.CreatePropertyFieldForPlugin(pluginID1, field1)
		require.NoError(t, err)
		created2, err := pas.CreatePropertyFieldForPlugin(pluginID1, field2)
		require.NoError(t, err)

		// Create values
		targetID := model.NewId()
		value1 := &model.PropertyValue{
			GroupID:    cpaGroupID,
			FieldID:    created1.ID,
			TargetType: "user",
			TargetID:   targetID,
			Value:      json.RawMessage(`"value1"`),
		}
		value2 := &model.PropertyValue{
			GroupID:    cpaGroupID,
			FieldID:    created2.ID,
			TargetType: "user",
			TargetID:   targetID,
			Value:      json.RawMessage(`"value2"`),
		}
		createdValues, err := pas.CreatePropertyValues(pluginID1, []*model.PropertyValue{value1, value2})
		require.NoError(t, err)
		require.Len(t, createdValues, 2)

		// Try to update both values with different plugin - should fail atomically
		createdValues[0].Value = json.RawMessage(`"hacked1"`)
		createdValues[1].Value = json.RawMessage(`"hacked2"`)
		updated, err := pas.UpdatePropertyValues(pluginID2, cpaGroupID, createdValues)
		require.Error(t, err)
		assert.Nil(t, updated)
		assert.Contains(t, err.Error(), "protected")

		// Verify values were NOT updated
		retrieved, err := pas.GetPropertyValues(pluginID1, cpaGroupID, []string{createdValues[0].ID, createdValues[1].ID})
		require.NoError(t, err)
		assert.Equal(t, `"value1"`, string(retrieved[0].Value))
		assert.Equal(t, `"value2"`, string(retrieved[1].Value))
	})

	t.Run("mixed protected and non-protected fields - enforces access control only on protected fields", func(t *testing.T) {
		// Create one protected field and one non-protected field
		protectedField := &model.PropertyField{
			GroupID:    cpaGroupID,
			Name:       "mixed-update-protected-field",
			Type:       model.PropertyFieldTypeText,
			TargetType: "user",
			Attrs: model.StringInterface{
				model.PropertyAttrsProtected: true,
			},
		}
		publicField := &model.PropertyField{
			GroupID:    cpaGroupID,
			Name:       "mixed-update-public-field",
			Type:       model.PropertyFieldTypeText,
			TargetType: "user",
		}

		createdProtected, err := pas.CreatePropertyFieldForPlugin(pluginID1, protectedField)
		require.NoError(t, err)
		createdPublic, err := pas.CreatePropertyField("", publicField)
		require.NoError(t, err)

		// Create values for both fields with plugin1
		targetID := model.NewId()
		protectedValue := &model.PropertyValue{
			GroupID:    cpaGroupID,
			FieldID:    createdProtected.ID,
			TargetType: "user",
			TargetID:   targetID,
			Value:      json.RawMessage(`"protected value"`),
		}
		publicValue := &model.PropertyValue{
			GroupID:    cpaGroupID,
			FieldID:    createdPublic.ID,
			TargetType: "user",
			TargetID:   targetID,
			Value:      json.RawMessage(`"public value"`),
		}
		createdValues, err := pas.CreatePropertyValues(pluginID1, []*model.PropertyValue{protectedValue, publicValue})
		require.NoError(t, err)
		require.Len(t, createdValues, 2)

		// Try to update both values with plugin2 - should fail atomically
		createdValues[0].Value = json.RawMessage(`"hacked protected"`)
		createdValues[1].Value = json.RawMessage(`"hacked public"`)
		updated, err := pas.UpdatePropertyValues(pluginID2, cpaGroupID, createdValues)
		require.Error(t, err)
		assert.Nil(t, updated)
		assert.Contains(t, err.Error(), "protected")

		// Verify NO values were updated (atomic failure)
		retrieved, err := pas.GetPropertyValues(pluginID1, cpaGroupID, []string{createdValues[0].ID, createdValues[1].ID})
		require.NoError(t, err)
		assert.Equal(t, `"protected value"`, string(retrieved[0].Value))
		assert.Equal(t, `"public value"`, string(retrieved[1].Value))

		// Now try with source plugin - should succeed for both
		createdValues[0].Value = json.RawMessage(`"updated protected"`)
		createdValues[1].Value = json.RawMessage(`"updated public"`)
		updated, err = pas.UpdatePropertyValues(pluginID1, cpaGroupID, createdValues)
		require.NoError(t, err)
		assert.Len(t, updated, 2)
		assert.Equal(t, `"updated protected"`, string(updated[0].Value))
		assert.Equal(t, `"updated public"`, string(updated[1].Value))
	})

	t.Run("multiple protected fields with different owners - enforces access control atomically", func(t *testing.T) {
		// Create two protected fields, each owned by a different plugin
		field1 := &model.PropertyField{
			GroupID:    cpaGroupID,
			Name:       "multi-owner-field-1",
			Type:       model.PropertyFieldTypeText,
			TargetType: "user",
			Attrs: model.StringInterface{
				model.PropertyAttrsProtected: true,
			},
		}
		field2 := &model.PropertyField{
			GroupID:    cpaGroupID,
			Name:       "multi-owner-field-2",
			Type:       model.PropertyFieldTypeText,
			TargetType: "user",
			Attrs: model.StringInterface{
				model.PropertyAttrsProtected: true,
			},
		}

		createdField1, err := pas.CreatePropertyFieldForPlugin(pluginID1, field1)
		require.NoError(t, err)
		createdField2, err := pas.CreatePropertyFieldForPlugin(pluginID2, field2)
		require.NoError(t, err)

		// Create values for both fields (each plugin creates its own)
		targetID := model.NewId()
		value1 := &model.PropertyValue{
			GroupID:    cpaGroupID,
			FieldID:    createdField1.ID,
			TargetType: "user",
			TargetID:   targetID,
			Value:      json.RawMessage(`"value from plugin1"`),
		}
		value2 := &model.PropertyValue{
			GroupID:    cpaGroupID,
			FieldID:    createdField2.ID,
			TargetType: "user",
			TargetID:   targetID,
			Value:      json.RawMessage(`"value from plugin2"`),
		}

		createdValue1, err := pas.CreatePropertyValue(pluginID1, value1)
		require.NoError(t, err)
		createdValue2, err := pas.CreatePropertyValue(pluginID2, value2)
		require.NoError(t, err)

		// Try to update both values with plugin1 - should fail because it doesn't own field2
		createdValue1.Value = json.RawMessage(`"updated by plugin1"`)
		createdValue2.Value = json.RawMessage(`"hacked by plugin1"`)
		updated, err := pas.UpdatePropertyValues(pluginID1, cpaGroupID, []*model.PropertyValue{createdValue1, createdValue2})
		require.Error(t, err)
		assert.Nil(t, updated)
		assert.Contains(t, err.Error(), "protected")

		// Verify NO values were updated (atomic failure)
		retrieved, err := pas.GetPropertyValues(pluginID1, cpaGroupID, []string{createdValue1.ID, createdValue2.ID})
		require.NoError(t, err)
		assert.Equal(t, `"value from plugin1"`, string(retrieved[0].Value))
		assert.Equal(t, `"value from plugin2"`, string(retrieved[1].Value))

		// Try to update both values with plugin2 - should also fail because it doesn't own field1
		createdValue1.Value = json.RawMessage(`"hacked by plugin2"`)
		createdValue2.Value = json.RawMessage(`"updated by plugin2"`)
		updated, err = pas.UpdatePropertyValues(pluginID2, cpaGroupID, []*model.PropertyValue{createdValue1, createdValue2})
		require.Error(t, err)
		assert.Nil(t, updated)
		assert.Contains(t, err.Error(), "protected")

		// Verify still NO values were updated
		retrieved, err = pas.GetPropertyValues(pluginID1, cpaGroupID, []string{createdValue1.ID, createdValue2.ID})
		require.NoError(t, err)
		assert.Equal(t, `"value from plugin1"`, string(retrieved[0].Value))
		assert.Equal(t, `"value from plugin2"`, string(retrieved[1].Value))

		// Each plugin can update its own value individually
		createdValue1.Value = json.RawMessage(`"plugin1 updated its own"`)
		updated1, err := pas.UpdatePropertyValue(pluginID1, cpaGroupID, createdValue1)
		require.NoError(t, err)
		assert.Equal(t, `"plugin1 updated its own"`, string(updated1.Value))

		createdValue2.Value = json.RawMessage(`"plugin2 updated its own"`)
		updated2, err := pas.UpdatePropertyValue(pluginID2, cpaGroupID, createdValue2)
		require.NoError(t, err)
		assert.Equal(t, `"plugin2 updated its own"`, string(updated2.Value))
	})
}

func TestUpsertPropertyValue_WriteAccessControl(t *testing.T) {
	th := Setup(t)
	pas := th.App.PropertyAccessService()

	// Register the CPA group
	group, appErr := th.App.RegisterPropertyGroup(th.Context, "cpa")
	require.Nil(t, appErr)
	cpaGroupID = group.ID

	t.Run("source plugin can upsert value for protected field", func(t *testing.T) {
		// Create a protected field
		field := &model.PropertyField{
			GroupID:    cpaGroupID,
			Name:       "upsert-protected-field",
			Type:       model.PropertyFieldTypeText,
			TargetType: "user",
			Attrs: model.StringInterface{
				model.PropertyAttrsProtected: true,
			},
		}
		created, err := pas.CreatePropertyFieldForPlugin("plugin1", field)
		require.NoError(t, err)

		// Upsert value (create)
		targetID := model.NewId()
		value := &model.PropertyValue{
			GroupID:    cpaGroupID,
			FieldID:    created.ID,
			TargetType: "user",
			TargetID:   targetID,
			Value:      json.RawMessage(`"first"`),
		}
		upserted, err := pas.UpsertPropertyValue("plugin1", value)
		require.NoError(t, err)
		assert.NotNil(t, upserted)

		// Upsert again (update)
		value.Value = json.RawMessage(`"second"`)
		upserted2, err := pas.UpsertPropertyValue("plugin1", value)
		require.NoError(t, err)
		assert.Equal(t, `"second"`, string(upserted2.Value))
	})

	t.Run("non-source plugin cannot upsert value for protected field", func(t *testing.T) {
		// Create a protected field
		field := &model.PropertyField{
			GroupID:    cpaGroupID,
			Name:       "upsert-protected-field-2",
			Type:       model.PropertyFieldTypeText,
			TargetType: "user",
			Attrs: model.StringInterface{
				model.PropertyAttrsProtected: true,
			},
		}
		created, err := pas.CreatePropertyFieldForPlugin("plugin1", field)
		require.NoError(t, err)

		// Try to upsert value with different plugin
		value := &model.PropertyValue{
			GroupID:    cpaGroupID,
			FieldID:    created.ID,
			TargetType: "user",
			TargetID:   model.NewId(),
			Value:      json.RawMessage(`"unauthorized"`),
		}
		upserted, err := pas.UpsertPropertyValue("plugin2", value)
		require.Error(t, err)
		assert.Nil(t, upserted)
		assert.Contains(t, err.Error(), "protected")
	})
}

func TestUpsertPropertyValues_WriteAccessControl(t *testing.T) {
	th := Setup(t)
	pas := th.App.PropertyAccessService()

	// Register the CPA group
	group, appErr := th.App.RegisterPropertyGroup(th.Context, "cpa")
	require.Nil(t, appErr)
	cpaGroupID = group.ID

	pluginID1 := "plugin-1"
	pluginID2 := "plugin-2"

	t.Run("source plugin can bulk upsert values for protected fields", func(t *testing.T) {
		// Create two protected fields
		field1 := &model.PropertyField{
			GroupID:    cpaGroupID,
			Name:       "bulk-upsert-field-1",
			Type:       model.PropertyFieldTypeText,
			TargetType: "user",
			Attrs: model.StringInterface{
				model.PropertyAttrsProtected: true,
			},
		}
		field2 := &model.PropertyField{
			GroupID:    cpaGroupID,
			Name:       "bulk-upsert-field-2",
			Type:       model.PropertyFieldTypeText,
			TargetType: "user",
			Attrs: model.StringInterface{
				model.PropertyAttrsProtected: true,
			},
		}
		created1, err := pas.CreatePropertyFieldForPlugin(pluginID1, field1)
		require.NoError(t, err)
		created2, err := pas.CreatePropertyFieldForPlugin(pluginID1, field2)
		require.NoError(t, err)

		// Bulk upsert values
		targetID := model.NewId()
		values := []*model.PropertyValue{
			{
				GroupID:    cpaGroupID,
				FieldID:    created1.ID,
				TargetType: "user",
				TargetID:   targetID,
				Value:      json.RawMessage(`"upsert1"`),
			},
			{
				GroupID:    cpaGroupID,
				FieldID:    created2.ID,
				TargetType: "user",
				TargetID:   targetID,
				Value:      json.RawMessage(`"upsert2"`),
			},
		}
		upserted, err := pas.UpsertPropertyValues(pluginID1, values)
		require.NoError(t, err)
		assert.Len(t, upserted, 2)
	})

	t.Run("non-source plugin cannot bulk upsert values atomically", func(t *testing.T) {
		// Create two protected fields
		field1 := &model.PropertyField{
			GroupID:    cpaGroupID,
			Name:       "bulk-upsert-fail-1",
			Type:       model.PropertyFieldTypeText,
			TargetType: "user",
			Attrs: model.StringInterface{
				model.PropertyAttrsProtected: true,
			},
		}
		field2 := &model.PropertyField{
			GroupID:    cpaGroupID,
			Name:       "bulk-upsert-fail-2",
			Type:       model.PropertyFieldTypeText,
			TargetType: "user",
			Attrs: model.StringInterface{
				model.PropertyAttrsProtected: true,
			},
		}
		created1, err := pas.CreatePropertyFieldForPlugin(pluginID1, field1)
		require.NoError(t, err)
		created2, err := pas.CreatePropertyFieldForPlugin(pluginID1, field2)
		require.NoError(t, err)

		// Try to bulk upsert with different plugin
		targetID := model.NewId()
		values := []*model.PropertyValue{
			{
				GroupID:    cpaGroupID,
				FieldID:    created1.ID,
				TargetType: "user",
				TargetID:   targetID,
				Value:      json.RawMessage(`"unauthorized1"`),
			},
			{
				GroupID:    cpaGroupID,
				FieldID:    created2.ID,
				TargetType: "user",
				TargetID:   targetID,
				Value:      json.RawMessage(`"unauthorized2"`),
			},
		}
		upserted, err := pas.UpsertPropertyValues(pluginID2, values)
		require.Error(t, err)
		assert.Nil(t, upserted)
		assert.Contains(t, err.Error(), "protected")

		// Verify no values were created
		retrieved, err := pas.SearchPropertyValues(pluginID1, cpaGroupID, model.PropertyValueSearchOpts{
			TargetIDs: []string{targetID},
			PerPage:   100,
		})
		require.NoError(t, err)
		assert.Empty(t, retrieved)
	})

	t.Run("mixed protected and non-protected fields - enforces access control only on protected fields", func(t *testing.T) {
		// Create one protected field and one non-protected field
		protectedField := &model.PropertyField{
			GroupID:    cpaGroupID,
			Name:       "mixed-protected-field",
			Type:       model.PropertyFieldTypeText,
			TargetType: "user",
			Attrs: model.StringInterface{
				model.PropertyAttrsProtected: true,
			},
		}
		publicField := &model.PropertyField{
			GroupID:    cpaGroupID,
			Name:       "mixed-public-field",
			Type:       model.PropertyFieldTypeText,
			TargetType: "user",
		}

		createdProtected, err := pas.CreatePropertyFieldForPlugin(pluginID1, protectedField)
		require.NoError(t, err)
		createdPublic, err := pas.CreatePropertyField("", publicField)
		require.NoError(t, err)

		// Try to upsert values for both fields with plugin2
		targetID := model.NewId()
		values := []*model.PropertyValue{
			{
				GroupID:    cpaGroupID,
				FieldID:    createdProtected.ID,
				TargetType: "user",
				TargetID:   targetID,
				Value:      json.RawMessage(`"protected value"`),
			},
			{
				GroupID:    cpaGroupID,
				FieldID:    createdPublic.ID,
				TargetType: "user",
				TargetID:   targetID,
				Value:      json.RawMessage(`"public value"`),
			},
		}

		// Should fail atomically - plugin2 cannot upsert value for protected field
		upserted, err := pas.UpsertPropertyValues(pluginID2, values)
		require.Error(t, err)
		assert.Nil(t, upserted)
		assert.Contains(t, err.Error(), "protected")

		// Verify no values were created (atomic failure)
		retrieved, err := pas.SearchPropertyValues(pluginID1, cpaGroupID, model.PropertyValueSearchOpts{
			TargetIDs: []string{targetID},
			PerPage:   100,
		})
		require.NoError(t, err)
		assert.Empty(t, retrieved)

		// Now try with source plugin - should succeed for both
		upserted, err = pas.UpsertPropertyValues(pluginID1, values)
		require.NoError(t, err)
		assert.Len(t, upserted, 2)
	})

	t.Run("multiple protected fields with different owners - enforces access control atomically", func(t *testing.T) {
		// Create two protected fields, each owned by a different plugin
		field1 := &model.PropertyField{
			GroupID:    cpaGroupID,
			Name:       "upsert-multi-owner-field-1",
			Type:       model.PropertyFieldTypeText,
			TargetType: "user",
			Attrs: model.StringInterface{
				model.PropertyAttrsProtected: true,
			},
		}
		field2 := &model.PropertyField{
			GroupID:    cpaGroupID,
			Name:       "upsert-multi-owner-field-2",
			Type:       model.PropertyFieldTypeText,
			TargetType: "user",
			Attrs: model.StringInterface{
				model.PropertyAttrsProtected: true,
			},
		}

		createdField1, err := pas.CreatePropertyFieldForPlugin(pluginID1, field1)
		require.NoError(t, err)
		createdField2, err := pas.CreatePropertyFieldForPlugin(pluginID2, field2)
		require.NoError(t, err)

		// Try to upsert values for both fields with plugin1 - should fail because it doesn't own field2
		targetID := model.NewId()
		values := []*model.PropertyValue{
			{
				GroupID:    cpaGroupID,
				FieldID:    createdField1.ID,
				TargetType: "user",
				TargetID:   targetID,
				Value:      json.RawMessage(`"value from plugin1"`),
			},
			{
				GroupID:    cpaGroupID,
				FieldID:    createdField2.ID,
				TargetType: "user",
				TargetID:   targetID,
				Value:      json.RawMessage(`"hacked by plugin1"`),
			},
		}

		upserted, err := pas.UpsertPropertyValues(pluginID1, values)
		require.Error(t, err)
		assert.Nil(t, upserted)
		assert.Contains(t, err.Error(), "protected")

		// Verify no values were created (atomic failure)
		retrieved, err := pas.SearchPropertyValues(pluginID1, cpaGroupID, model.PropertyValueSearchOpts{
			TargetIDs: []string{targetID},
			PerPage:   100,
		})
		require.NoError(t, err)
		assert.Empty(t, retrieved)

		// Try to upsert both values with plugin2 - should also fail because it doesn't own field1
		values[0].Value = json.RawMessage(`"hacked by plugin2"`)
		values[1].Value = json.RawMessage(`"value from plugin2"`)

		upserted, err = pas.UpsertPropertyValues(pluginID2, values)
		require.Error(t, err)
		assert.Nil(t, upserted)
		assert.Contains(t, err.Error(), "protected")

		// Verify still no values were created
		retrieved, err = pas.SearchPropertyValues(pluginID1, cpaGroupID, model.PropertyValueSearchOpts{
			TargetIDs: []string{targetID},
			PerPage:   100,
		})
		require.NoError(t, err)
		assert.Empty(t, retrieved)

		// Each plugin can upsert its own value individually
		upserted1, err := pas.UpsertPropertyValue(pluginID1, &model.PropertyValue{
			GroupID:    cpaGroupID,
			FieldID:    createdField1.ID,
			TargetType: "user",
			TargetID:   targetID,
			Value:      json.RawMessage(`"plugin1 upserted its own"`),
		})
		require.NoError(t, err)
		assert.Equal(t, `"plugin1 upserted its own"`, string(upserted1.Value))

		upserted2, err := pas.UpsertPropertyValue(pluginID2, &model.PropertyValue{
			GroupID:    cpaGroupID,
			FieldID:    createdField2.ID,
			TargetType: "user",
			TargetID:   targetID,
			Value:      json.RawMessage(`"plugin2 upserted its own"`),
		})
		require.NoError(t, err)
		assert.Equal(t, `"plugin2 upserted its own"`, string(upserted2.Value))
	})
}

func TestDeletePropertyValuesForField_WriteAccessControl(t *testing.T) {
	th := Setup(t)
	pas := th.App.PropertyAccessService()

	// Register the CPA group
	group, appErr := th.App.RegisterPropertyGroup(th.Context, "cpa")
	require.Nil(t, appErr)
	cpaGroupID = group.ID

	t.Run("source plugin can delete all values for protected field", func(t *testing.T) {
		// Create a protected field
		field := &model.PropertyField{
			GroupID:    cpaGroupID,
			Name:       "field-delete-values",
			Type:       model.PropertyFieldTypeText,
			TargetType: "user",
			Attrs: model.StringInterface{
				model.PropertyAttrsProtected: true,
			},
		}
		created, err := pas.CreatePropertyFieldForPlugin("plugin1", field)
		require.NoError(t, err)

		// Create multiple values
		targetID1 := model.NewId()
		targetID2 := model.NewId()
		values := []*model.PropertyValue{
			{
				GroupID:    cpaGroupID,
				FieldID:    created.ID,
				TargetType: "user",
				TargetID:   targetID1,
				Value:      json.RawMessage(`"value1"`),
			},
			{
				GroupID:    cpaGroupID,
				FieldID:    created.ID,
				TargetType: "user",
				TargetID:   targetID2,
				Value:      json.RawMessage(`"value2"`),
			},
		}
		_, err = pas.CreatePropertyValues("plugin1", values)
		require.NoError(t, err)

		// Source plugin can delete all values for the field
		err = pas.DeletePropertyValuesForField("plugin1", cpaGroupID, created.ID)
		require.NoError(t, err)

		// Verify values are deleted
		retrieved, err := pas.SearchPropertyValues("plugin1", cpaGroupID, model.PropertyValueSearchOpts{
			FieldID: created.ID,
			PerPage: 100,
		})
		require.NoError(t, err)
		assert.Empty(t, retrieved)
	})

	t.Run("non-source plugin cannot delete values for protected field", func(t *testing.T) {
		// Create a protected field
		field := &model.PropertyField{
			GroupID:    cpaGroupID,
			Name:       "field-delete-values-fail",
			Type:       model.PropertyFieldTypeText,
			TargetType: "user",
			Attrs: model.StringInterface{
				model.PropertyAttrsProtected: true,
			},
		}
		created, err := pas.CreatePropertyFieldForPlugin("plugin1", field)
		require.NoError(t, err)

		// Create a value
		value := &model.PropertyValue{
			GroupID:    cpaGroupID,
			FieldID:    created.ID,
			TargetType: "user",
			TargetID:   model.NewId(),
			Value:      json.RawMessage(`"protected value"`),
		}
		_, err = pas.CreatePropertyValue("plugin1", value)
		require.NoError(t, err)

		// Different plugin cannot delete values
		err = pas.DeletePropertyValuesForField("plugin2", cpaGroupID, created.ID)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "protected")

		// Verify value still exists
		retrieved, err := pas.SearchPropertyValues("plugin1", cpaGroupID, model.PropertyValueSearchOpts{
			FieldID: created.ID,
			PerPage: 100,
		})
		require.NoError(t, err)
		assert.Len(t, retrieved, 1)
	})

	t.Run("any caller can delete values for non-protected field", func(t *testing.T) {
		// Create a non-protected field
		field := &model.PropertyField{
			GroupID:    cpaGroupID,
			Name:       "public-field-delete-values",
			Type:       model.PropertyFieldTypeText,
			TargetType: "user",
		}
		created, err := pas.CreatePropertyField("", field)
		require.NoError(t, err)

		// Create values with plugin1
		values := []*model.PropertyValue{
			{
				GroupID:    cpaGroupID,
				FieldID:    created.ID,
				TargetType: "user",
				TargetID:   model.NewId(),
				Value:      json.RawMessage(`"value1"`),
			},
			{
				GroupID:    cpaGroupID,
				FieldID:    created.ID,
				TargetType: "user",
				TargetID:   model.NewId(),
				Value:      json.RawMessage(`"value2"`),
			},
		}
		_, err = pas.CreatePropertyValues("plugin1", values)
		require.NoError(t, err)

		// Different plugin can delete values
		err = pas.DeletePropertyValuesForField("plugin2", cpaGroupID, created.ID)
		require.NoError(t, err)

		// Verify values are deleted
		retrieved, err := pas.SearchPropertyValues("plugin2", cpaGroupID, model.PropertyValueSearchOpts{
			FieldID: created.ID,
			PerPage: 100,
		})
		require.NoError(t, err)
		assert.Empty(t, retrieved)
	})
}
