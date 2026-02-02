// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package app

import (
	"net/http"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/public/shared/request"
)

// Property Group Methods

// RegisterPropertyGroup registers a new property group with the given name.
func (a *App) RegisterPropertyGroup(rctx request.CTX, name string) (*model.PropertyGroup, *model.AppError) {
	group, err := a.Srv().propertyService.RegisterPropertyGroup(name)
	if err != nil {
		return nil, model.NewAppError("RegisterPropertyGroup", "app.property.register_group.app_error", nil, "", http.StatusInternalServerError).Wrap(err)
	}
	return group, nil
}

// GetPropertyGroup retrieves a property group by name.
func (a *App) GetPropertyGroup(rctx request.CTX, name string) (*model.PropertyGroup, *model.AppError) {
	group, err := a.Srv().propertyService.GetPropertyGroup(name)
	if err != nil {
		return nil, model.NewAppError("GetPropertyGroup", "app.property.get_group.app_error", nil, "", http.StatusInternalServerError).Wrap(err)
	}
	return group, nil
}

// Property Field Methods

// CreatePropertyField creates a new property field.
func (a *App) CreatePropertyField(rctx request.CTX, field *model.PropertyField) (*model.PropertyField, *model.AppError) {
	if field == nil {
		return nil, model.NewAppError("CreatePropertyField", "app.property.invalid_input.app_error", nil, "property field is required", http.StatusBadRequest)
	}

	// Check if this group is CPA
	isCPA, err := a.isPropertyGroupCPA(field.GroupID)
	if err != nil {
		return nil, model.NewAppError("CreatePropertyField", "app.property.check_cpa.app_error", nil, "", http.StatusInternalServerError).Wrap(err)
	}

	var createdField *model.PropertyField
	if isCPA {
		// Use PropertyAccessService for CPA (applies access control)
		callerID, _ := CallerIDFromRequestContext(rctx)
		createdField, err = a.Srv().propertyAccessService.CreatePropertyFieldForPlugin(callerID, field)
	} else {
		// Use PropertyService directly for non-CPA (no access control)
		createdField, err = a.Srv().propertyService.CreatePropertyField(field)
	}

	if err != nil {
		return nil, model.NewAppError("CreatePropertyField", "app.property.create_field.app_error", nil, "", http.StatusInternalServerError).Wrap(err)
	}
	return createdField, nil
}

// GetPropertyField retrieves a property field by group ID and field ID.
func (a *App) GetPropertyField(rctx request.CTX, groupID, fieldID string) (*model.PropertyField, *model.AppError) {
	// Check if this group is CPA
	isCPA, err := a.isPropertyGroupCPA(groupID)
	if err != nil {
		return nil, model.NewAppError("GetPropertyField", "app.property.check_cpa.app_error", nil, "", http.StatusInternalServerError).Wrap(err)
	}

	var field *model.PropertyField
	if isCPA {
		// Use PropertyAccessService for CPA (applies access control)
		callerID, _ := CallerIDFromRequestContext(rctx)
		field, err = a.Srv().propertyAccessService.GetPropertyField(callerID, groupID, fieldID)
	} else {
		// Use PropertyService directly for non-CPA (no access control)
		field, err = a.Srv().propertyService.GetPropertyField(groupID, fieldID)
	}

	if err != nil {
		return nil, model.NewAppError("GetPropertyField", "app.property.get_field.app_error", nil, "", http.StatusInternalServerError).Wrap(err)
	}
	return field, nil
}

// GetPropertyFields retrieves multiple property fields by their IDs.
func (a *App) GetPropertyFields(rctx request.CTX, groupID string, ids []string) ([]*model.PropertyField, *model.AppError) {
	// Check if this group is CPA
	isCPA, err := a.isPropertyGroupCPA(groupID)
	if err != nil {
		return nil, model.NewAppError("GetPropertyFields", "app.property.check_cpa.app_error", nil, "", http.StatusInternalServerError).Wrap(err)
	}

	var fields []*model.PropertyField
	if isCPA {
		// Use PropertyAccessService for CPA (applies access control)
		callerID, _ := CallerIDFromRequestContext(rctx)
		fields, err = a.Srv().propertyAccessService.GetPropertyFields(callerID, groupID, ids)
	} else {
		// Use PropertyService directly for non-CPA (no access control)
		fields, err = a.Srv().propertyService.GetPropertyFields(groupID, ids)
	}

	if err != nil {
		return nil, model.NewAppError("GetPropertyFields", "app.property.get_fields.app_error", nil, "", http.StatusInternalServerError).Wrap(err)
	}
	return fields, nil
}

// GetPropertyFieldByName retrieves a property field by name within a group and target.
func (a *App) GetPropertyFieldByName(rctx request.CTX, groupID, targetID, name string) (*model.PropertyField, *model.AppError) {
	// Check if this group is CPA
	isCPA, err := a.isPropertyGroupCPA(groupID)
	if err != nil {
		return nil, model.NewAppError("GetPropertyFieldByName", "app.property.check_cpa.app_error", nil, "", http.StatusInternalServerError).Wrap(err)
	}

	var field *model.PropertyField
	if isCPA {
		// Use PropertyAccessService for CPA (applies access control)
		callerID, _ := CallerIDFromRequestContext(rctx)
		field, err = a.Srv().propertyAccessService.GetPropertyFieldByName(callerID, groupID, targetID, name)
	} else {
		// Use PropertyService directly for non-CPA (no access control)
		field, err = a.Srv().propertyService.GetPropertyFieldByName(groupID, targetID, name)
	}

	if err != nil {
		return nil, model.NewAppError("GetPropertyFieldByName", "app.property.get_field_by_name.app_error", nil, "", http.StatusInternalServerError).Wrap(err)
	}
	return field, nil
}

// SearchPropertyFields searches for property fields matching the given options.
func (a *App) SearchPropertyFields(rctx request.CTX, groupID string, opts model.PropertyFieldSearchOpts) ([]*model.PropertyField, *model.AppError) {
	// Check if this group is CPA
	isCPA, err := a.isPropertyGroupCPA(groupID)
	if err != nil {
		return nil, model.NewAppError("SearchPropertyFields", "app.property.check_cpa.app_error", nil, "", http.StatusInternalServerError).Wrap(err)
	}

	var fields []*model.PropertyField
	if isCPA {
		// Use PropertyAccessService for CPA (applies access control)
		callerID, _ := CallerIDFromRequestContext(rctx)
		fields, err = a.Srv().propertyAccessService.SearchPropertyFields(callerID, groupID, opts)
	} else {
		// Use PropertyService directly for non-CPA (no access control)
		fields, err = a.Srv().propertyService.SearchPropertyFields(groupID, opts)
	}

	if err != nil {
		return nil, model.NewAppError("SearchPropertyFields", "app.property.search_fields.app_error", nil, "", http.StatusInternalServerError).Wrap(err)
	}
	return fields, nil
}

// UpdatePropertyField updates an existing property field.
func (a *App) UpdatePropertyField(rctx request.CTX, groupID string, field *model.PropertyField) (*model.PropertyField, *model.AppError) {
	if field == nil {
		return nil, model.NewAppError("UpdatePropertyField", "app.property.invalid_input.app_error", nil, "property field is required", http.StatusBadRequest)
	}

	// Check if this group is CPA
	isCPA, err := a.isPropertyGroupCPA(groupID)
	if err != nil {
		return nil, model.NewAppError("UpdatePropertyField", "app.property.check_cpa.app_error", nil, "", http.StatusInternalServerError).Wrap(err)
	}

	var updatedField *model.PropertyField
	if isCPA {
		// Use PropertyAccessService for CPA (applies access control)
		callerID, _ := CallerIDFromRequestContext(rctx)
		updatedField, err = a.Srv().propertyAccessService.UpdatePropertyField(callerID, groupID, field)
	} else {
		// Use PropertyService directly for non-CPA (no access control)
		updatedField, err = a.Srv().propertyService.UpdatePropertyField(groupID, field)
	}

	if err != nil {
		return nil, model.NewAppError("UpdatePropertyField", "app.property.update_field.app_error", nil, "", http.StatusInternalServerError).Wrap(err)
	}
	return updatedField, nil
}

// UpdatePropertyFields updates multiple property fields.
func (a *App) UpdatePropertyFields(rctx request.CTX, groupID string, fields []*model.PropertyField) ([]*model.PropertyField, *model.AppError) {
	if len(fields) == 0 {
		return nil, model.NewAppError("UpdatePropertyFields", "app.property.invalid_input.app_error", nil, "property fields are required", http.StatusBadRequest)
	}

	// Check if this group is CPA
	isCPA, err := a.isPropertyGroupCPA(groupID)
	if err != nil {
		return nil, model.NewAppError("UpdatePropertyFields", "app.property.check_cpa.app_error", nil, "", http.StatusInternalServerError).Wrap(err)
	}

	var updatedFields []*model.PropertyField
	if isCPA {
		// Use PropertyAccessService for CPA (applies access control)
		callerID, _ := CallerIDFromRequestContext(rctx)
		updatedFields, err = a.Srv().propertyAccessService.UpdatePropertyFields(callerID, groupID, fields)
	} else {
		// Use PropertyService directly for non-CPA (no access control)
		updatedFields, err = a.Srv().propertyService.UpdatePropertyFields(groupID, fields)
	}

	if err != nil {
		return nil, model.NewAppError("UpdatePropertyFields", "app.property.update_fields.app_error", nil, "", http.StatusInternalServerError).Wrap(err)
	}
	return updatedFields, nil
}

// DeletePropertyField deletes a property field.
func (a *App) DeletePropertyField(rctx request.CTX, groupID, fieldID string) *model.AppError {
	// Check if this group is CPA
	isCPA, err := a.isPropertyGroupCPA(groupID)
	if err != nil {
		return model.NewAppError("DeletePropertyField", "app.property.check_cpa.app_error", nil, "", http.StatusInternalServerError).Wrap(err)
	}

	if isCPA {
		// Use PropertyAccessService for CPA (applies access control)
		callerID, _ := CallerIDFromRequestContext(rctx)
		err = a.Srv().propertyAccessService.DeletePropertyField(callerID, groupID, fieldID)
	} else {
		// Use PropertyService directly for non-CPA (no access control)
		err = a.Srv().propertyService.DeletePropertyField(groupID, fieldID)
	}

	if err != nil {
		return model.NewAppError("DeletePropertyField", "app.property.delete_field.app_error", nil, "", http.StatusInternalServerError).Wrap(err)
	}
	return nil
}

// CountPropertyFieldsForGroup counts property fields for a group.
func (a *App) CountPropertyFieldsForGroup(rctx request.CTX, groupID string, includeDeleted bool) (int64, *model.AppError) {
	// Check if this group is CPA
	isCPA, err := a.isPropertyGroupCPA(groupID)
	if err != nil {
		return 0, model.NewAppError("CountPropertyFieldsForGroup", "app.property.check_cpa.app_error", nil, "", http.StatusInternalServerError).Wrap(err)
	}

	var count int64
	if isCPA {
		// Use PropertyAccessService for CPA
		if includeDeleted {
			count, err = a.Srv().propertyAccessService.CountAllPropertyFieldsForGroup(groupID)
		} else {
			count, err = a.Srv().propertyAccessService.CountActivePropertyFieldsForGroup(groupID)
		}
	} else {
		// Use PropertyService directly for non-CPA
		if includeDeleted {
			count, err = a.Srv().propertyService.CountAllPropertyFieldsForGroup(groupID)
		} else {
			count, err = a.Srv().propertyService.CountActivePropertyFieldsForGroup(groupID)
		}
	}

	if err != nil {
		return 0, model.NewAppError("CountPropertyFieldsForGroup", "app.property.count_fields_for_group.app_error", nil, "", http.StatusInternalServerError).Wrap(err)
	}
	return count, nil
}

// CountPropertyFieldsForTarget counts property fields for a specific target.
func (a *App) CountPropertyFieldsForTarget(rctx request.CTX, groupID, targetType, targetID string, includeDeleted bool) (int64, *model.AppError) {
	// Check if this group is CPA
	isCPA, err := a.isPropertyGroupCPA(groupID)
	if err != nil {
		return 0, model.NewAppError("CountPropertyFieldsForTarget", "app.property.check_cpa.app_error", nil, "", http.StatusInternalServerError).Wrap(err)
	}

	var count int64
	if isCPA {
		// Use PropertyAccessService for CPA
		if includeDeleted {
			count, err = a.Srv().propertyAccessService.CountAllPropertyFieldsForTarget(groupID, targetType, targetID)
		} else {
			count, err = a.Srv().propertyAccessService.CountActivePropertyFieldsForTarget(groupID, targetType, targetID)
		}
	} else {
		// Use PropertyService directly for non-CPA
		if includeDeleted {
			count, err = a.Srv().propertyService.CountAllPropertyFieldsForTarget(groupID, targetType, targetID)
		} else {
			count, err = a.Srv().propertyService.CountActivePropertyFieldsForTarget(groupID, targetType, targetID)
		}
	}

	if err != nil {
		return 0, model.NewAppError("CountPropertyFieldsForTarget", "app.property.count_fields_for_target.app_error", nil, "", http.StatusInternalServerError).Wrap(err)
	}
	return count, nil
}

// Property Value Methods

// CreatePropertyValue creates a new property value.
func (a *App) CreatePropertyValue(rctx request.CTX, value *model.PropertyValue) (*model.PropertyValue, *model.AppError) {
	if value == nil {
		return nil, model.NewAppError("CreatePropertyValue", "app.property.invalid_input.app_error", nil, "property value is required", http.StatusBadRequest)
	}

	// Check if this group is CPA
	isCPA, err := a.isPropertyGroupCPA(value.GroupID)
	if err != nil {
		return nil, model.NewAppError("CreatePropertyValue", "app.property.check_cpa.app_error", nil, "", http.StatusInternalServerError).Wrap(err)
	}

	var createdValue *model.PropertyValue
	if isCPA {
		// Use PropertyAccessService for CPA (applies access control)
		callerID, _ := CallerIDFromRequestContext(rctx)
		createdValue, err = a.Srv().propertyAccessService.CreatePropertyValue(callerID, value)
	} else {
		// Use PropertyService directly for non-CPA (no access control)
		createdValue, err = a.Srv().propertyService.CreatePropertyValue(value)
	}

	if err != nil {
		return nil, model.NewAppError("CreatePropertyValue", "app.property.create_value.app_error", nil, "", http.StatusInternalServerError).Wrap(err)
	}
	return createdValue, nil
}

// CreatePropertyValues creates multiple property values.
func (a *App) CreatePropertyValues(rctx request.CTX, values []*model.PropertyValue) ([]*model.PropertyValue, *model.AppError) {
	if len(values) == 0 {
		return nil, model.NewAppError("CreatePropertyValues", "app.property.invalid_input.app_error", nil, "property values are required", http.StatusBadRequest)
	}

	// Check if this group is CPA (use first value's groupID)
	isCPA, err := a.isPropertyGroupCPA(values[0].GroupID)
	if err != nil {
		return nil, model.NewAppError("CreatePropertyValues", "app.property.check_cpa.app_error", nil, "", http.StatusInternalServerError).Wrap(err)
	}

	var createdValues []*model.PropertyValue
	if isCPA {
		// Use PropertyAccessService for CPA (applies access control)
		callerID, _ := CallerIDFromRequestContext(rctx)
		createdValues, err = a.Srv().propertyAccessService.CreatePropertyValues(callerID, values)
	} else {
		// Use PropertyService directly for non-CPA (no access control)
		createdValues, err = a.Srv().propertyService.CreatePropertyValues(values)
	}

	if err != nil {
		return nil, model.NewAppError("CreatePropertyValues", "app.property.create_values.app_error", nil, "", http.StatusInternalServerError).Wrap(err)
	}
	return createdValues, nil
}

// GetPropertyValue retrieves a property value by group ID and value ID.
func (a *App) GetPropertyValue(rctx request.CTX, groupID, valueID string) (*model.PropertyValue, *model.AppError) {
	// Check if this group is CPA
	isCPA, err := a.isPropertyGroupCPA(groupID)
	if err != nil {
		return nil, model.NewAppError("GetPropertyValue", "app.property.check_cpa.app_error", nil, "", http.StatusInternalServerError).Wrap(err)
	}

	var value *model.PropertyValue
	if isCPA {
		// Use PropertyAccessService for CPA (applies access control)
		callerID, _ := CallerIDFromRequestContext(rctx)
		value, err = a.Srv().propertyAccessService.GetPropertyValue(callerID, groupID, valueID)
	} else {
		// Use PropertyService directly for non-CPA (no access control)
		value, err = a.Srv().propertyService.GetPropertyValue(groupID, valueID)
	}

	if err != nil {
		return nil, model.NewAppError("GetPropertyValue", "app.property.get_value.app_error", nil, "", http.StatusInternalServerError).Wrap(err)
	}
	return value, nil
}

// GetPropertyValues retrieves multiple property values by their IDs.
func (a *App) GetPropertyValues(rctx request.CTX, groupID string, ids []string) ([]*model.PropertyValue, *model.AppError) {
	// Check if this group is CPA
	isCPA, err := a.isPropertyGroupCPA(groupID)
	if err != nil {
		return nil, model.NewAppError("GetPropertyValues", "app.property.check_cpa.app_error", nil, "", http.StatusInternalServerError).Wrap(err)
	}

	var values []*model.PropertyValue
	if isCPA {
		// Use PropertyAccessService for CPA (applies access control)
		callerID, _ := CallerIDFromRequestContext(rctx)
		values, err = a.Srv().propertyAccessService.GetPropertyValues(callerID, groupID, ids)
	} else {
		// Use PropertyService directly for non-CPA (no access control)
		values, err = a.Srv().propertyService.GetPropertyValues(groupID, ids)
	}

	if err != nil {
		return nil, model.NewAppError("GetPropertyValues", "app.property.get_values.app_error", nil, "", http.StatusInternalServerError).Wrap(err)
	}
	return values, nil
}

// SearchPropertyValues searches for property values matching the given options.
func (a *App) SearchPropertyValues(rctx request.CTX, groupID string, opts model.PropertyValueSearchOpts) ([]*model.PropertyValue, *model.AppError) {
	// Check if this group is CPA
	isCPA, err := a.isPropertyGroupCPA(groupID)
	if err != nil {
		return nil, model.NewAppError("SearchPropertyValues", "app.property.check_cpa.app_error", nil, "", http.StatusInternalServerError).Wrap(err)
	}

	var values []*model.PropertyValue
	if isCPA {
		// Use PropertyAccessService for CPA (applies access control)
		callerID, _ := CallerIDFromRequestContext(rctx)
		values, err = a.Srv().propertyAccessService.SearchPropertyValues(callerID, groupID, opts)
	} else {
		// Use PropertyService directly for non-CPA (no access control)
		values, err = a.Srv().propertyService.SearchPropertyValues(groupID, opts)
	}

	if err != nil {
		return nil, model.NewAppError("SearchPropertyValues", "app.property.search_values.app_error", nil, "", http.StatusInternalServerError).Wrap(err)
	}
	return values, nil
}

// UpdatePropertyValue updates an existing property value.
func (a *App) UpdatePropertyValue(rctx request.CTX, groupID string, value *model.PropertyValue) (*model.PropertyValue, *model.AppError) {
	if value == nil {
		return nil, model.NewAppError("UpdatePropertyValue", "app.property.invalid_input.app_error", nil, "property value is required", http.StatusBadRequest)
	}

	// Check if this group is CPA
	isCPA, err := a.isPropertyGroupCPA(groupID)
	if err != nil {
		return nil, model.NewAppError("UpdatePropertyValue", "app.property.check_cpa.app_error", nil, "", http.StatusInternalServerError).Wrap(err)
	}

	var updatedValue *model.PropertyValue
	if isCPA {
		// Use PropertyAccessService for CPA (applies access control)
		callerID, _ := CallerIDFromRequestContext(rctx)
		updatedValue, err = a.Srv().propertyAccessService.UpdatePropertyValue(callerID, groupID, value)
	} else {
		// Use PropertyService directly for non-CPA (no access control)
		updatedValue, err = a.Srv().propertyService.UpdatePropertyValue(groupID, value)
	}

	if err != nil {
		return nil, model.NewAppError("UpdatePropertyValue", "app.property.update_value.app_error", nil, "", http.StatusInternalServerError).Wrap(err)
	}
	return updatedValue, nil
}

// UpdatePropertyValues updates multiple property values.
func (a *App) UpdatePropertyValues(rctx request.CTX, groupID string, values []*model.PropertyValue) ([]*model.PropertyValue, *model.AppError) {
	if len(values) == 0 {
		return nil, model.NewAppError("UpdatePropertyValues", "app.property.invalid_input.app_error", nil, "property values are required", http.StatusBadRequest)
	}

	// Check if this group is CPA
	isCPA, err := a.isPropertyGroupCPA(groupID)
	if err != nil {
		return nil, model.NewAppError("UpdatePropertyValues", "app.property.check_cpa.app_error", nil, "", http.StatusInternalServerError).Wrap(err)
	}

	var updatedValues []*model.PropertyValue
	if isCPA {
		// Use PropertyAccessService for CPA (applies access control)
		callerID, _ := CallerIDFromRequestContext(rctx)
		updatedValues, err = a.Srv().propertyAccessService.UpdatePropertyValues(callerID, groupID, values)
	} else {
		// Use PropertyService directly for non-CPA (no access control)
		updatedValues, err = a.Srv().propertyService.UpdatePropertyValues(groupID, values)
	}

	if err != nil {
		return nil, model.NewAppError("UpdatePropertyValues", "app.property.update_values.app_error", nil, "", http.StatusInternalServerError).Wrap(err)
	}
	return updatedValues, nil
}

// UpsertPropertyValue creates or updates a property value.
func (a *App) UpsertPropertyValue(rctx request.CTX, value *model.PropertyValue) (*model.PropertyValue, *model.AppError) {
	if value == nil {
		return nil, model.NewAppError("UpsertPropertyValue", "app.property.invalid_input.app_error", nil, "property value is required", http.StatusBadRequest)
	}

	// Check if this group is CPA
	isCPA, err := a.isPropertyGroupCPA(value.GroupID)
	if err != nil {
		return nil, model.NewAppError("UpsertPropertyValue", "app.property.check_cpa.app_error", nil, "", http.StatusInternalServerError).Wrap(err)
	}

	var upsertedValue *model.PropertyValue
	if isCPA {
		// Use PropertyAccessService for CPA (applies access control)
		callerID, _ := CallerIDFromRequestContext(rctx)
		upsertedValue, err = a.Srv().propertyAccessService.UpsertPropertyValue(callerID, value)
	} else {
		// Use PropertyService directly for non-CPA (no access control)
		upsertedValue, err = a.Srv().propertyService.UpsertPropertyValue(value)
	}

	if err != nil {
		return nil, model.NewAppError("UpsertPropertyValue", "app.property.upsert_value.app_error", nil, "", http.StatusInternalServerError).Wrap(err)
	}
	return upsertedValue, nil
}

// UpsertPropertyValues creates or updates multiple property values.
func (a *App) UpsertPropertyValues(rctx request.CTX, values []*model.PropertyValue) ([]*model.PropertyValue, *model.AppError) {
	if len(values) == 0 {
		return nil, model.NewAppError("UpsertPropertyValues", "app.property.invalid_input.app_error", nil, "property values are required", http.StatusBadRequest)
	}

	// Check if this group is CPA (use first value's groupID)
	isCPA, err := a.isPropertyGroupCPA(values[0].GroupID)
	if err != nil {
		return nil, model.NewAppError("UpsertPropertyValues", "app.property.check_cpa.app_error", nil, "", http.StatusInternalServerError).Wrap(err)
	}

	var upsertedValues []*model.PropertyValue
	if isCPA {
		// Use PropertyAccessService for CPA (applies access control)
		callerID, _ := CallerIDFromRequestContext(rctx)
		upsertedValues, err = a.Srv().propertyAccessService.UpsertPropertyValues(callerID, values)
	} else {
		// Use PropertyService directly for non-CPA (no access control)
		upsertedValues, err = a.Srv().propertyService.UpsertPropertyValues(values)
	}

	if err != nil {
		return nil, model.NewAppError("UpsertPropertyValues", "app.property.upsert_values.app_error", nil, "", http.StatusInternalServerError).Wrap(err)
	}
	return upsertedValues, nil
}

// DeletePropertyValue deletes a property value.
func (a *App) DeletePropertyValue(rctx request.CTX, groupID, valueID string) *model.AppError {
	// Check if this group is CPA
	isCPA, err := a.isPropertyGroupCPA(groupID)
	if err != nil {
		return model.NewAppError("DeletePropertyValue", "app.property.check_cpa.app_error", nil, "", http.StatusInternalServerError).Wrap(err)
	}

	if isCPA {
		// Use PropertyAccessService for CPA (applies access control)
		callerID, _ := CallerIDFromRequestContext(rctx)
		err = a.Srv().propertyAccessService.DeletePropertyValue(callerID, groupID, valueID)
	} else {
		// Use PropertyService directly for non-CPA (no access control)
		err = a.Srv().propertyService.DeletePropertyValue(groupID, valueID)
	}

	if err != nil {
		return model.NewAppError("DeletePropertyValue", "app.property.delete_value.app_error", nil, "", http.StatusInternalServerError).Wrap(err)
	}
	return nil
}

// DeletePropertyValuesForTarget deletes all property values for a target.
func (a *App) DeletePropertyValuesForTarget(rctx request.CTX, groupID, targetType, targetID string) *model.AppError {
	// Check if this group is CPA
	isCPA, err := a.isPropertyGroupCPA(groupID)
	if err != nil {
		return model.NewAppError("DeletePropertyValuesForTarget", "app.property.check_cpa.app_error", nil, "", http.StatusInternalServerError).Wrap(err)
	}

	if isCPA {
		// Use PropertyAccessService for CPA (applies access control)
		callerID, _ := CallerIDFromRequestContext(rctx)
		err = a.Srv().propertyAccessService.DeletePropertyValuesForTarget(callerID, groupID, targetType, targetID)
	} else {
		// Use PropertyService directly for non-CPA (no access control)
		err = a.Srv().propertyService.DeletePropertyValuesForTarget(groupID, targetType, targetID)
	}

	if err != nil {
		return model.NewAppError("DeletePropertyValuesForTarget", "app.property.delete_values_for_target.app_error", nil, "", http.StatusInternalServerError).Wrap(err)
	}
	return nil
}

// DeletePropertyValuesForField deletes all property values for a field.
func (a *App) DeletePropertyValuesForField(rctx request.CTX, groupID, fieldID string) *model.AppError {
	// Check if this group is CPA
	isCPA, err := a.isPropertyGroupCPA(groupID)
	if err != nil {
		return model.NewAppError("DeletePropertyValuesForField", "app.property.check_cpa.app_error", nil, "", http.StatusInternalServerError).Wrap(err)
	}

	if isCPA {
		// Use PropertyAccessService for CPA (applies access control)
		callerID, _ := CallerIDFromRequestContext(rctx)
		err = a.Srv().propertyAccessService.DeletePropertyValuesForField(callerID, groupID, fieldID)
	} else {
		// Use PropertyService directly for non-CPA (no access control)
		err = a.Srv().propertyService.DeletePropertyValuesForField(groupID, fieldID)
	}

	if err != nil {
		return model.NewAppError("DeletePropertyValuesForField", "app.property.delete_values_for_field.app_error", nil, "", http.StatusInternalServerError).Wrap(err)
	}
	return nil
}

// Helper Methods

// isPropertyGroupCPA checks if a property group ID corresponds to the Custom Profile Attributes group.
func (a *App) isPropertyGroupCPA(groupID string) (bool, error) {
	cpaID, err := a.CpaGroupID()
	if err != nil {
		return false, err
	}
	return groupID == cpaID, nil
}
