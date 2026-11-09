// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package model

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gorilla/mux"
)

func TestPluginIDRoute(t *testing.T) {
	for _, prefix := range []string{"/plugins/", "/api/v4/plugins/"} {
		for _, id := range []string{"com.custom.christmas-magic", "com.mattermost-community.plugin-google-drive", "plugin_test", "zoom"} {
			t.Run(prefix+id, func(t *testing.T) {
				router := mux.NewRouter()
				router.PathPrefix(prefix+PluginIDRoute).Subrouter().HandleFunc("/configuration", func(w http.ResponseWriter, r *http.Request) {
					if got := mux.Vars(r)["plugin_id"]; got != id {
						t.Errorf("plugin ID = %q, want %q", got, id)
					}
					w.WriteHeader(http.StatusNoContent)
				})
				response := httptest.NewRecorder()
				router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, prefix+id+"/configuration", nil))
				if response.Code != http.StatusNoContent {
					t.Fatalf("valid plugin route returned %d", response.Code)
				}
			})
		}
	}
	for _, id := range []string{`invalid\plugin`, "invalid+plugin", "invalid/plugin"} {
		router := mux.NewRouter()
		router.HandleFunc("/plugins/"+PluginIDRoute+"/configuration", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) })
		response := httptest.NewRecorder()
		router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/plugins/"+id+"/configuration", nil))
		if response.Code != http.StatusNotFound {
			t.Errorf("invalid ID %q accepted", id)
		}
	}
}
