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

func TestCreatePropertyField(t *testing.T) {
	th := Setup(t)

	// Get the actual CPA group ID
	cpaGroupID, err := th.App.CpaGroupID()
	require.NoError(t, err)

	t.Run("CPA group routes through PropertyAccessService setting source_plugin_id from caller", func(t *testing.T) {
		// CPA group routes through CreatePropertyFieldForPlugin which sets source_plugin_id from caller
		field := &model.PropertyField{
			GroupID: cpaGroupID,
			Name:    model.NewId(),
			Type:    model.PropertyFieldTypeText,
			Attrs: model.StringInterface{
				model.PropertyAttrsProtected: true,
			},
		}

		rctx := RequestContextWithCallerID(th.Context, "plugin1")
		created, appErr := th.App.CreatePropertyField(rctx, field)
		require.Nil(t, appErr)
		assert.NotNil(t, created)
		// Verify source_plugin_id was set from the caller ID
		assert.Equal(t, "plugin1", created.Attrs[model.PropertyAttrsSourcePluginID])
	})

	t.Run("non-CPA group routes directly to PropertyService without setting source_plugin_id", func(t *testing.T) {
		// Register a non-CPA group
		nonCpaGroup, appErr := th.App.RegisterPropertyGroup(th.Context, "other-group-create")
		require.Nil(t, appErr)

		// Non-CPA group should NOT automatically set source_plugin_id (unlike CPA groups)
		field := &model.PropertyField{
			GroupID: nonCpaGroup.ID,
			Name:    model.NewId(),
			Type:    model.PropertyFieldTypeText,
		}

		rctx := RequestContextWithCallerID(th.Context, "plugin2")
		created, appErr := th.App.CreatePropertyField(rctx, field)
		require.Nil(t, appErr)
		assert.NotNil(t, created)
		// Verify source_plugin_id was NOT set (goes directly to PropertyService)
		assert.Nil(t, created.Attrs[model.PropertyAttrsSourcePluginID])
	})
}

func TestGetPropertyField(t *testing.T) {
	th := Setup(t)

	// Get the actual CPA group ID
	cpaGroupID, err := th.App.CpaGroupID()
	require.NoError(t, err)

	pluginID1 := "plugin-1"
	pluginID2 := "plugin-2"

	t.Run("CPA group routes through PropertyAccessService with source_only filtering", func(t *testing.T) {
		// Create a source_only field in CPA group
		field := &model.PropertyField{
			GroupID:    cpaGroupID,
			Name:       "routing-test-cpa-source-only",
			Type:       model.PropertyFieldTypeSelect,
			TargetType: "user",
			Attrs: model.StringInterface{
				model.PropertyAttrsAccessMode:     model.PropertyAccessModeSourceOnly,
				model.PropertyAttrsProtected:      true,
				model.PropertyAttrsSourcePluginID: pluginID1,
				model.PropertyFieldAttributeOptions: []any{
					map[string]any{"id": "opt1", "value": "Secret Option 1"},
					map[string]any{"id": "opt2", "value": "Secret Option 2"},
				},
			},
		}
		rctx1 := RequestContextWithCallerID(th.Context, pluginID1)
		created, appErr := th.App.CreatePropertyField(rctx1, field)
		require.Nil(t, appErr)

		// Source plugin sees all options (through PropertyAccessService)
		retrieved, appErr := th.App.GetPropertyField(rctx1, cpaGroupID, created.ID)
		require.Nil(t, appErr)
		assert.Len(t, retrieved.Attrs[model.PropertyFieldAttributeOptions].([]any), 2)

		// Other plugin sees filtered options (PropertyAccessService filtering)
		rctx2 := RequestContextWithCallerID(th.Context, pluginID2)
		retrieved2, appErr := th.App.GetPropertyField(rctx2, cpaGroupID, created.ID)
		require.Nil(t, appErr)
		assert.Len(t, retrieved2.Attrs[model.PropertyFieldAttributeOptions].([]any), 0) // Filtered
	})

	t.Run("non-CPA group routes directly to PropertyService without filtering", func(t *testing.T) {
		// Register a non-CPA group
		nonCpaGroup, appErr := th.App.RegisterPropertyGroup(th.Context, "other-group-routing-read")
		require.Nil(t, appErr)

		// Create a source_only field in non-CPA group
		field := &model.PropertyField{
			GroupID:    nonCpaGroup.ID,
			Name:       "routing-test-non-cpa-source-only",
			Type:       model.PropertyFieldTypeSelect,
			TargetType: "user",
			Attrs: model.StringInterface{
				model.PropertyAttrsAccessMode:     model.PropertyAccessModeSourceOnly,
				model.PropertyAttrsProtected:      true,
				model.PropertyAttrsSourcePluginID: pluginID1,
				model.PropertyFieldAttributeOptions: []any{
					map[string]any{"id": "opt1", "value": "Option 1"},
					map[string]any{"id": "opt2", "value": "Option 2"},
				},
			},
		}
		rctx1 := RequestContextWithCallerID(th.Context, pluginID1)
		created, appErr := th.App.CreatePropertyField(rctx1, field)
		require.Nil(t, appErr)

		// Other plugin sees ALL options (no filtering, goes directly to PropertyService)
		rctx2 := RequestContextWithCallerID(th.Context, pluginID2)
		retrieved, appErr := th.App.GetPropertyField(rctx2, nonCpaGroup.ID, created.ID)
		require.Nil(t, appErr)
		assert.Len(t, retrieved.Attrs[model.PropertyFieldAttributeOptions].([]any), 2) // NOT filtered
	})
}

func TestUpdatePropertyField(t *testing.T) {
	th := Setup(t)

	// Get the actual CPA group ID
	cpaGroupID, err := th.App.CpaGroupID()
	require.NoError(t, err)

	t.Run("CPA group routes through PropertyAccessService enforcing write access control", func(t *testing.T) {
		// Create a protected field in CPA group
		field := &model.PropertyField{
			GroupID: cpaGroupID,
			Name:    "Routing Test Protected",
			Type:    model.PropertyFieldTypeText,
			Attrs: model.StringInterface{
				model.PropertyAttrsProtected: true,
			},
		}

		rctx1 := RequestContextWithCallerID(th.Context, "plugin1")
		created, appErr := th.App.CreatePropertyField(rctx1, field)
		require.Nil(t, appErr)

		// Try to update with different plugin - should be denied
		created.Name = "Attempted Update"
		rctx2 := RequestContextWithCallerID(th.Context, "plugin2")
		updated, appErr := th.App.UpdatePropertyField(rctx2, cpaGroupID, created)
		require.NotNil(t, appErr)
		assert.Nil(t, updated)
		assert.Contains(t, appErr.Error(), "protected")
	})

	t.Run("non-CPA group routes directly to PropertyService without access control", func(t *testing.T) {
		// Register a non-CPA group
		nonCpaGroup, appErr := th.App.RegisterPropertyGroup(th.Context, "other-group-update")
		require.Nil(t, appErr)

		// Create a protected field in non-CPA group
		field := &model.PropertyField{
			GroupID: nonCpaGroup.ID,
			Name:    "Non-CPA Protected",
			Type:    model.PropertyFieldTypeText,
			Attrs: model.StringInterface{
				model.PropertyAttrsProtected:      true,
				model.PropertyAttrsSourcePluginID: "plugin1",
			},
		}

		rctx1 := RequestContextWithCallerID(th.Context, "plugin1")
		created, appErr := th.App.CreatePropertyField(rctx1, field)
		require.Nil(t, appErr)

		// Update with different plugin - should be allowed (no access control)
		created.Name = "Updated by Plugin2"
		rctx2 := RequestContextWithCallerID(th.Context, "plugin2")
		updated, appErr := th.App.UpdatePropertyField(rctx2, nonCpaGroup.ID, created)
		require.Nil(t, appErr)
		assert.NotNil(t, updated)
		assert.Equal(t, "Updated by Plugin2", updated.Name)
	})
}

func TestDeletePropertyField(t *testing.T) {
	th := Setup(t)

	// Get the actual CPA group ID
	cpaGroupID, err := th.App.CpaGroupID()
	require.NoError(t, err)

	t.Run("CPA group routes through PropertyAccessService enforcing delete access control", func(t *testing.T) {
		// Mock plugin installation check
		pas := th.App.PropertyAccessService()
		pas.setPluginCheckerForTests(func(pluginID string) bool {
			return pluginID == "plugin1"
		})

		// Create a protected field in CPA group
		field := &model.PropertyField{
			GroupID: cpaGroupID,
			Name:    "Routing Delete Protected",
			Type:    model.PropertyFieldTypeText,
			Attrs: model.StringInterface{
				model.PropertyAttrsProtected: true,
			},
		}

		rctx1 := RequestContextWithCallerID(th.Context, "plugin1")
		created, appErr := th.App.CreatePropertyField(rctx1, field)
		require.Nil(t, appErr)

		// Try to delete with different plugin - should be denied
		rctx2 := RequestContextWithCallerID(th.Context, "plugin2")
		appErr = th.App.DeletePropertyField(rctx2, cpaGroupID, created.ID)
		require.NotNil(t, appErr)
		assert.Contains(t, appErr.Error(), "protected")
	})

	t.Run("non-CPA group routes directly to PropertyService without access control", func(t *testing.T) {
		// Register a non-CPA group
		nonCpaGroup, appErr := th.App.RegisterPropertyGroup(th.Context, "other-group-delete")
		require.Nil(t, appErr)

		// Create a protected field in non-CPA group
		field := &model.PropertyField{
			GroupID: nonCpaGroup.ID,
			Name:    "Non-CPA Delete Protected",
			Type:    model.PropertyFieldTypeText,
			Attrs: model.StringInterface{
				model.PropertyAttrsProtected:      true,
				model.PropertyAttrsSourcePluginID: "plugin1",
			},
		}

		rctx1 := RequestContextWithCallerID(th.Context, "plugin1")
		created, appErr := th.App.CreatePropertyField(rctx1, field)
		require.Nil(t, appErr)

		// Delete with different plugin - should be allowed (no access control)
		rctx2 := RequestContextWithCallerID(th.Context, "plugin2")
		appErr = th.App.DeletePropertyField(rctx2, nonCpaGroup.ID, created.ID)
		require.Nil(t, appErr)
	})
}

func TestCreatePropertyValue(t *testing.T) {
	th := Setup(t)

	// Get the actual CPA group ID
	cpaGroupID, err := th.App.CpaGroupID()
	require.NoError(t, err)

	t.Run("CPA group routes through PropertyAccessService enforcing write access control", func(t *testing.T) {
		// Create a protected field in CPA group
		field := &model.PropertyField{
			GroupID: cpaGroupID,
			Name:    "Routing Value Protected",
			Type:    model.PropertyFieldTypeText,
			Attrs: model.StringInterface{
				model.PropertyAttrsProtected: true,
			},
		}

		rctx1 := RequestContextWithCallerID(th.Context, "plugin1")
		created, appErr := th.App.CreatePropertyField(rctx1, field)
		require.Nil(t, appErr)

		// Try to create value with different plugin - should be denied
		value := &model.PropertyValue{
			GroupID:    cpaGroupID,
			FieldID:    created.ID,
			TargetType: "user",
			TargetID:   model.NewId(),
			Value:      json.RawMessage(`"test value"`),
		}

		rctx2 := RequestContextWithCallerID(th.Context, "plugin2")
		createdValue, appErr := th.App.CreatePropertyValue(rctx2, value)
		require.NotNil(t, appErr)
		assert.Nil(t, createdValue)
		assert.Contains(t, appErr.Error(), "protected")
	})

	t.Run("non-CPA group routes directly to PropertyService without access control", func(t *testing.T) {
		// Register a non-CPA group
		nonCpaGroup, appErr := th.App.RegisterPropertyGroup(th.Context, "other-group-value-create")
		require.Nil(t, appErr)

		// Create a protected field in non-CPA group
		field := &model.PropertyField{
			GroupID: nonCpaGroup.ID,
			Name:    "Non-CPA Value Protected",
			Type:    model.PropertyFieldTypeText,
			Attrs: model.StringInterface{
				model.PropertyAttrsProtected:      true,
				model.PropertyAttrsSourcePluginID: "plugin1",
			},
		}

		rctx1 := RequestContextWithCallerID(th.Context, "plugin1")
		created, appErr := th.App.CreatePropertyField(rctx1, field)
		require.Nil(t, appErr)

		// Create value with different plugin - should be allowed (no access control)
		value := &model.PropertyValue{
			GroupID:    nonCpaGroup.ID,
			FieldID:    created.ID,
			TargetType: "user",
			TargetID:   model.NewId(),
			Value:      json.RawMessage(`"test value"`),
		}

		rctx2 := RequestContextWithCallerID(th.Context, "plugin2")
		createdValue, appErr := th.App.CreatePropertyValue(rctx2, value)
		require.Nil(t, appErr)
		assert.NotNil(t, createdValue)
	})
}

func TestGetPropertyValue(t *testing.T) {
	th := Setup(t)

	// Get the actual CPA group ID
	cpaGroupID, err := th.App.CpaGroupID()
	require.NoError(t, err)

	t.Run("CPA group routes through PropertyAccessService with source_only filtering", func(t *testing.T) {
		// Create a source_only field in CPA group
		field := &model.PropertyField{
			GroupID:    cpaGroupID,
			Name:       "routing-value-source-only",
			Type:       model.PropertyFieldTypeText,
			TargetType: "user",
			Attrs: model.StringInterface{
				model.PropertyAttrsAccessMode: model.PropertyAccessModeSourceOnly,
				model.PropertyAttrsProtected:  true,
			},
		}

		rctx1 := RequestContextWithCallerID(th.Context, "plugin1")
		created, appErr := th.App.CreatePropertyField(rctx1, field)
		require.Nil(t, appErr)

		// Create a value
		targetID := model.NewId()
		value := &model.PropertyValue{
			GroupID:    cpaGroupID,
			FieldID:    created.ID,
			TargetType: "user",
			TargetID:   targetID,
			Value:      json.RawMessage(`"secret"`),
		}
		createdValue, appErr := th.App.CreatePropertyValue(rctx1, value)
		require.Nil(t, appErr)

		// Source plugin can read (through PropertyAccessService)
		retrieved, appErr := th.App.GetPropertyValue(rctx1, cpaGroupID, createdValue.ID)
		require.Nil(t, appErr)
		assert.NotNil(t, retrieved)

		// Other plugin gets nil (PropertyAccessService filtering)
		rctx2 := RequestContextWithCallerID(th.Context, "plugin2")
		retrieved2, appErr := th.App.GetPropertyValue(rctx2, cpaGroupID, createdValue.ID)
		require.Nil(t, appErr)
		assert.Nil(t, retrieved2)
	})

	t.Run("non-CPA group routes directly to PropertyService without filtering", func(t *testing.T) {
		// Register a non-CPA group
		nonCpaGroup, appErr := th.App.RegisterPropertyGroup(th.Context, "other-group-value-read")
		require.Nil(t, appErr)

		// Create a source_only field in non-CPA group
		field := &model.PropertyField{
			GroupID:    nonCpaGroup.ID,
			Name:       "non-cpa-value-source-only",
			Type:       model.PropertyFieldTypeText,
			TargetType: "user",
			Attrs: model.StringInterface{
				model.PropertyAttrsAccessMode:     model.PropertyAccessModeSourceOnly,
				model.PropertyAttrsProtected:      true,
				model.PropertyAttrsSourcePluginID: "plugin1",
			},
		}

		rctx1 := RequestContextWithCallerID(th.Context, "plugin1")
		created, appErr := th.App.CreatePropertyField(rctx1, field)
		require.Nil(t, appErr)

		// Create a value
		targetID := model.NewId()
		value := &model.PropertyValue{
			GroupID:    nonCpaGroup.ID,
			FieldID:    created.ID,
			TargetType: "user",
			TargetID:   targetID,
			Value:      json.RawMessage(`"visible"`),
		}
		createdValue, appErr := th.App.CreatePropertyValue(rctx1, value)
		require.Nil(t, appErr)

		// Other plugin can read (no filtering, goes directly to PropertyService)
		rctx2 := RequestContextWithCallerID(th.Context, "plugin2")
		retrieved, appErr := th.App.GetPropertyValue(rctx2, nonCpaGroup.ID, createdValue.ID)
		require.Nil(t, appErr)
		assert.NotNil(t, retrieved)

		// User can also read (no filtering, goes directly to PropertyService)
		userID := model.NewId()
		rctxUser := RequestContextWithCallerID(th.Context, userID)
		retrievedByUser, appErr := th.App.GetPropertyValue(rctxUser, nonCpaGroup.ID, createdValue.ID)
		require.Nil(t, appErr)
		assert.NotNil(t, retrievedByUser)
	})
}

func TestCreatePropertyValues(t *testing.T) {
	th := Setup(t)

	// Get the actual CPA group ID
	cpaGroupID, err := th.App.CpaGroupID()
	require.NoError(t, err)

	pluginID1 := "plugin-1"
	pluginID2 := "plugin-2"

	t.Run("CPA group routes through PropertyAccessService with atomic access control enforcement", func(t *testing.T) {
		// Create two protected fields in CPA group
		field1 := &model.PropertyField{
			GroupID:    cpaGroupID,
			Name:       "routing-bulk-protected-1",
			Type:       model.PropertyFieldTypeText,
			TargetType: "user",
			Attrs: model.StringInterface{
				model.PropertyAttrsProtected: true,
			},
		}
		field2 := &model.PropertyField{
			GroupID:    cpaGroupID,
			Name:       "routing-bulk-protected-2",
			Type:       model.PropertyFieldTypeText,
			TargetType: "user",
			Attrs: model.StringInterface{
				model.PropertyAttrsProtected: true,
			},
		}

		rctx1 := RequestContextWithCallerID(th.Context, pluginID1)
		created1, appErr := th.App.CreatePropertyField(rctx1, field1)
		require.Nil(t, appErr)
		created2, appErr := th.App.CreatePropertyField(rctx1, field2)
		require.Nil(t, appErr)

		// Try to create values for both fields with different plugin - should be denied atomically
		targetID := model.NewId()
		values := []*model.PropertyValue{
			{
				GroupID:    cpaGroupID,
				FieldID:    created1.ID,
				TargetType: "user",
				TargetID:   targetID,
				Value:      json.RawMessage(`"value1"`),
			},
			{
				GroupID:    cpaGroupID,
				FieldID:    created2.ID,
				TargetType: "user",
				TargetID:   targetID,
				Value:      json.RawMessage(`"value2"`),
			},
		}

		rctx2 := RequestContextWithCallerID(th.Context, pluginID2)
		createdValues, appErr := th.App.CreatePropertyValues(rctx2, values)
		require.NotNil(t, appErr)
		assert.Nil(t, createdValues)
		assert.Contains(t, appErr.Error(), "protected")
	})

	t.Run("non-CPA group routes directly to PropertyService without access control", func(t *testing.T) {
		// Register a non-CPA group
		nonCpaGroup, appErr := th.App.RegisterPropertyGroup(th.Context, "other-group-bulk")
		require.Nil(t, appErr)

		// Create two fields in non-CPA group
		field1 := &model.PropertyField{
			GroupID:    nonCpaGroup.ID,
			Name:       "non-cpa-bulk-field-1",
			Type:       model.PropertyFieldTypeText,
			TargetType: "user",
		}
		field2 := &model.PropertyField{
			GroupID:    nonCpaGroup.ID,
			Name:       "non-cpa-bulk-field-2",
			Type:       model.PropertyFieldTypeText,
			TargetType: "user",
		}

		rctx1 := RequestContextWithCallerID(th.Context, pluginID1)
		created1, appErr := th.App.CreatePropertyField(rctx1, field1)
		require.Nil(t, appErr)
		created2, appErr := th.App.CreatePropertyField(rctx1, field2)
		require.Nil(t, appErr)

		// Create values for both fields with different plugin - should be allowed (no access control)
		targetID := model.NewId()
		values := []*model.PropertyValue{
			{
				GroupID:    nonCpaGroup.ID,
				FieldID:    created1.ID,
				TargetType: "user",
				TargetID:   targetID,
				Value:      json.RawMessage(`"value1"`),
			},
			{
				GroupID:    nonCpaGroup.ID,
				FieldID:    created2.ID,
				TargetType: "user",
				TargetID:   targetID,
				Value:      json.RawMessage(`"value2"`),
			},
		}

		rctx2 := RequestContextWithCallerID(th.Context, pluginID2)
		createdValues, appErr := th.App.CreatePropertyValues(rctx2, values)
		require.Nil(t, appErr)
		assert.Len(t, createdValues, 2)
	})

	t.Run("mixed CPA and non-CPA groups enforce access control atomically only on CPA group", func(t *testing.T) {
		// Register a non-CPA group
		nonCpaGroup, appErr := th.App.RegisterPropertyGroup(th.Context, "other-group-mixed")
		require.Nil(t, appErr)

		// Create protected field in CPA group
		cpaField := &model.PropertyField{
			GroupID:    cpaGroupID,
			Name:       "cpa-protected-mixed",
			Type:       model.PropertyFieldTypeText,
			TargetType: "user",
			Attrs: model.StringInterface{
				model.PropertyAttrsProtected: true,
			},
		}
		rctx1 := RequestContextWithCallerID(th.Context, pluginID1)
		cpaField, appErr = th.App.CreatePropertyField(rctx1, cpaField)
		require.Nil(t, appErr)

		// Create field in non-CPA group (no access control attributes)
		nonCpaField := &model.PropertyField{
			GroupID:    nonCpaGroup.ID,
			Name:       "non-cpa-field-mixed",
			Type:       model.PropertyFieldTypeText,
			TargetType: "user",
		}
		nonCpaField, appErr = th.App.CreatePropertyField(rctx1, nonCpaField)
		require.Nil(t, appErr)

		// Try to bulk create values for BOTH groups with pluginID2
		targetID := model.NewId()
		values := []*model.PropertyValue{
			{
				GroupID:    cpaGroupID,
				FieldID:    cpaField.ID,
				TargetType: "user",
				TargetID:   targetID,
				Value:      json.RawMessage(`"cpa data"`),
			},
			{
				GroupID:    nonCpaGroup.ID,
				FieldID:    nonCpaField.ID,
				TargetType: "user",
				TargetID:   targetID,
				Value:      json.RawMessage(`"non-cpa data"`),
			},
		}

		// Should fail atomically - pluginID2 cannot create value on CPA group protected field
		rctx2 := RequestContextWithCallerID(th.Context, pluginID2)
		created, appErr := th.App.CreatePropertyValues(rctx2, values)
		require.NotNil(t, appErr)
		assert.Nil(t, created)
		assert.Contains(t, appErr.Error(), "protected")

		// Verify NO values were created in either group (atomic failure)
		rctxCheck := RequestContextWithCallerID(th.Context, pluginID1)
		results, appErr := th.App.SearchPropertyValues(rctxCheck, cpaGroupID, model.PropertyValueSearchOpts{
			TargetIDs: []string{targetID},
			PerPage:   100,
		})
		require.Nil(t, appErr)
		assert.Empty(t, results)

		resultsNonCpa, appErr := th.App.SearchPropertyValues(rctxCheck, nonCpaGroup.ID, model.PropertyValueSearchOpts{
			TargetIDs: []string{targetID},
			PerPage:   100,
		})
		require.Nil(t, appErr)
		assert.Empty(t, resultsNonCpa)

		// Now try with the source plugin (pluginID1) using the same values - should succeed
		created2, appErr := th.App.CreatePropertyValues(rctx1, values)
		require.Nil(t, appErr)
		assert.Len(t, created2, 2)

		// Verify both values were created
		resultsCpa2, appErr := th.App.SearchPropertyValues(rctx1, cpaGroupID, model.PropertyValueSearchOpts{
			TargetIDs: []string{targetID},
			PerPage:   100,
		})
		require.Nil(t, appErr)
		assert.Len(t, resultsCpa2, 1)

		resultsNonCpa2, appErr := th.App.SearchPropertyValues(rctx1, nonCpaGroup.ID, model.PropertyValueSearchOpts{
			TargetIDs: []string{targetID},
			PerPage:   100,
		})
		require.Nil(t, appErr)
		assert.Len(t, resultsNonCpa2, 1)
	})
}
