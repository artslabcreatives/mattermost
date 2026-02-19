// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package api4

import (
	"encoding/json"
	"net/http"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/public/shared/mlog"
)

func (api *API) InitTypesense() {
	api.BaseRoutes.Typesense.Handle("/test", api.APISessionRequired(testTypesense)).Methods(http.MethodPost)
	api.BaseRoutes.Typesense.Handle("/purge_indexes", api.APISessionRequired(purgeTypesenseIndexes)).Methods(http.MethodPost)
}

func testTypesense(c *Context, w http.ResponseWriter, r *http.Request) {
	var cfg *model.Config
	err := json.NewDecoder(r.Body).Decode(&cfg)
	if err != nil {
		c.Logger.Warn("Error decoding config.", mlog.Err(err))
	}
	if cfg == nil {
		cfg = c.App.Config()
	}

	if checkHasNilFields(&cfg.TypesenseSettings) {
		c.Err = model.NewAppError("testTypesense", "api.typesense.test_typesense_settings_nil.app_error", nil, "", http.StatusBadRequest)
		return
	}

	// Check permission to test Typesense
	if !c.App.SessionHasPermissionToAndNotRestrictedAdmin(*c.AppContext.Session(), model.PermissionTestElasticsearch) {
		c.SetPermissionError(model.PermissionTestElasticsearch)
		return
	}

	if err := c.App.TestTypesense(c.AppContext, cfg); err != nil {
		c.Err = err
		return
	}

	ReturnStatusOK(w)
}

func purgeTypesenseIndexes(c *Context, w http.ResponseWriter, r *http.Request) {
	auditRec := c.MakeAuditRecord("purge_typesense_indexes", model.AuditStatusFail)
	defer c.LogAuditRec(auditRec)

	if !c.App.SessionHasPermissionToAndNotRestrictedAdmin(*c.AppContext.Session(), model.PermissionPurgeElasticsearchIndexes) {
		c.SetPermissionError(model.PermissionPurgeElasticsearchIndexes)
		return
	}

	specifiedIndexesQuery := r.URL.Query()["index"]
	if err := c.App.PurgeTypesenseIndexes(c.AppContext, specifiedIndexesQuery); err != nil {
		c.Err = err
		return
	}

	auditRec.Success()

	ReturnStatusOK(w)
}
