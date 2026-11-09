package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/public/plugin/plugintest"
	"github.com/stretchr/testify/mock"
)

func TestWishText(t *testing.T) {
	for command, want := range map[string]string{
		"/christmas":                             "",
		"/christmas   ":                          "",
		"/christmas Happy holidays!":             "Happy holidays!",
		"/christmas  Peace\n and   joy ":         "Peace and joy",
		"/christmas " + strings.Repeat("a", 300): strings.Repeat("a", maxWishLength-1) + "…",
	} {
		if got := wishText(command); got != want {
			t.Errorf("wishText(%q) = %q, want %q", command, got, want)
		}
	}
}

func newWishPlugin(t *testing.T) (*Plugin, *plugintest.API) {
	api := &plugintest.API{}
	t.Cleanup(func() { api.AssertExpectations(t) })
	p := &Plugin{config: defaults()}
	p.SetAPI(api)
	return p, api
}

func TestChristmasCommandSavesAndBroadcastsWish(t *testing.T) {
	p, api := newWishPlugin(t)
	existing, _ := json.Marshal([]wish{{ID: "old", Name: "Ann", Message: "Snow!"}})
	api.On("KVGet", "cooldown-u1").Return([]byte(nil), (*model.AppError)(nil))
	api.On("GetUser", "u1").Return(&model.User{Id: "u1", Username: "sam.w", FirstName: "Sam"}, (*model.AppError)(nil))
	api.On("KVGet", wishesKey).Return(existing, (*model.AppError)(nil))
	api.On("KVCompareAndSet", wishesKey, existing, mock.MatchedBy(func(data []byte) bool {
		var list []wish
		return json.Unmarshal(data, &list) == nil && len(list) == 2 && list[1].Name == "Sam" && list[1].Message == "Peace on earth"
	})).Return(true, (*model.AppError)(nil))
	api.On("KVSet", "cooldown-u1", mock.Anything).Return((*model.AppError)(nil))
	api.On("PublishWebSocketEvent", "wish", mock.MatchedBy(func(payload map[string]any) bool {
		return payload["wish"].(map[string]any)["message"] == "Peace on earth"
	}), mock.Anything).Return()

	response, appErr := p.ExecuteCommand(nil, &model.CommandArgs{UserId: "u1", Command: "/christmas Peace on earth"})
	if appErr != nil || !strings.Contains(response.Text, "on the Christmas tree") || response.ResponseType != model.CommandResponseTypeEphemeral {
		t.Fatalf("unexpected response %+v %v", response, appErr)
	}
}

func TestChristmasCommandLimitsAndSettings(t *testing.T) {
	p, api := newWishPlugin(t)
	api.On("KVGet", "cooldown-u1").Return([]byte(strconv.FormatInt(model.GetMillis(), 10)), (*model.AppError)(nil))
	if response, _ := p.ExecuteCommand(nil, &model.CommandArgs{UserId: "u1", Command: "/christmas again"}); !strings.Contains(response.Text, "try again") {
		t.Errorf("cooldown not enforced: %q", response.Text)
	}
	if response, _ := p.ExecuteCommand(nil, &model.CommandArgs{UserId: "u1", Command: "/christmas"}); !strings.Contains(response.Text, "Type your wish") {
		t.Errorf("empty wish accepted: %q", response.Text)
	}
	p.config.Wishes = false
	if response, _ := p.ExecuteCommand(nil, &model.CommandArgs{UserId: "u1", Command: "/christmas hi"}); !strings.Contains(response.Text, "turned off") {
		t.Errorf("disabled wishes accepted: %q", response.Text)
	}
}

func TestWishesEndpoints(t *testing.T) {
	p, api := newWishPlugin(t)
	stored, _ := json.Marshal([]wish{{ID: "a", Message: "one"}, {ID: "b", Message: "two"}})
	api.On("KVGet", wishesKey).Return(stored, (*model.AppError)(nil))
	api.On("HasPermissionTo", "member", model.PermissionManageSystem).Return(false)
	api.On("HasPermissionTo", "admin", model.PermissionManageSystem).Return(true)
	api.On("KVCompareAndSet", wishesKey, stored, mock.MatchedBy(func(data []byte) bool {
		var list []wish
		return json.Unmarshal(data, &list) == nil && len(list) == 1 && list[0].ID == "b"
	})).Return(true, (*model.AppError)(nil))
	api.On("PublishWebSocketEvent", "wishes_removed", map[string]any{"id": "a"}, mock.Anything).Return()

	serve := func(method, path, user string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, path, nil)
		r.Header.Set("Mattermost-User-Id", user)
		w := httptest.NewRecorder()
		p.ServeHTTP(nil, w, r)
		return w
	}
	if w := serve(http.MethodGet, "/wishes", "member"); w.Code != http.StatusOK || !strings.Contains(w.Body.String(), `"message":"two"`) {
		t.Errorf("GET /wishes: %d %s", w.Code, w.Body)
	}
	if w := serve(http.MethodDelete, "/wishes/a", "member"); w.Code != http.StatusForbidden {
		t.Errorf("member deleted a wish: %d", w.Code)
	}
	if w := serve(http.MethodDelete, "/wishes/a", "admin"); w.Code != http.StatusNoContent {
		t.Errorf("admin delete: %d %s", w.Code, w.Body)
	}
	if w := serve(http.MethodPost, "/wishes", "admin"); w.Code != http.StatusMethodNotAllowed {
		t.Errorf("POST /wishes: %d", w.Code)
	}
	if w := serve(http.MethodGet, "/wishes", ""); w.Code != http.StatusUnauthorized {
		t.Errorf("anonymous GET /wishes: %d", w.Code)
	}
}
