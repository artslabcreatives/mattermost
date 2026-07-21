package main

import (
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/public/plugin"
)

func (p *Plugin) ServeHTTP(_ *plugin.Context, w http.ResponseWriter, r *http.Request) {
	router := http.NewServeMux()
	router.HandleFunc("GET /api/v1/config", p.withUser(p.handleGetConfig))
	router.HandleFunc("GET /api/v1/connection", p.withUser(p.handleConnectionStatus))
	router.HandleFunc("GET /oauth/connect", p.withUser(p.handleOAuthConnect))
	router.HandleFunc("GET /oauth/complete", p.withUser(p.handleOAuthComplete))
	router.HandleFunc("POST /api/v1/disconnect", p.withUser(p.handleOAuthDisconnect))
	router.HandleFunc("GET /api/v1/bookings", p.withUser(p.handleListBookings))
	router.HandleFunc("POST /api/v1/bookings", p.withUser(p.handleCreateBooking))
	router.HandleFunc("PUT /api/v1/bookings/{id}", p.withUser(p.handleUpdateBooking))
	router.HandleFunc("DELETE /api/v1/bookings/{id}", p.withUser(p.handleDeleteBooking))
	router.ServeHTTP(w, r)
}

type handlerFunc func(w http.ResponseWriter, r *http.Request, userID string)

// withUser rejects anonymous requests. The server sets Mattermost-User-Id only
// for authenticated sessions, which is what lets the UI skip its own login.
func (p *Plugin) withUser(next handlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID := r.Header.Get("Mattermost-User-Id")
		if userID == "" {
			writeError(w, http.StatusUnauthorized, "You must be logged in to use the board room.")
			return
		}
		next(w, r, userID)
	}
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"message": message})
}

// requireTeamAccess confirms the caller actually belongs to the team whose
// calendar they're touching.
func (p *Plugin) requireTeamAccess(w http.ResponseWriter, userID, teamID string) bool {
	if teamID == "" {
		writeError(w, http.StatusBadRequest, "A team is required.")
		return false
	}
	if _, err := p.client.Team.GetMember(teamID, userID); err != nil {
		writeError(w, http.StatusForbidden, "You don't have access to this team's board room.")
		return false
	}
	return true
}

// canModify reports whether userID may edit or cancel b. Only the person who
// made the booking can change it; system admins can too, so a room can be
// freed when its owner is unavailable.
func (p *Plugin) canModify(userID string, b *Booking) bool {
	if b.CreatedBy == userID {
		return true
	}
	user, err := p.client.User.Get(userID)
	if err != nil {
		return false
	}
	return user.IsSystemAdmin()
}

type configResponse struct {
	OpeningHour int    `json:"opening_hour"`
	ClosingHour int    `json:"closing_hour"`
	SlotMinutes int    `json:"slot_minutes"`
	RoomName    string `json:"room_name"`
}

func (p *Plugin) handleGetConfig(w http.ResponseWriter, _ *http.Request, _ string) {
	cfg := p.getConfiguration()
	writeJSON(w, http.StatusOK, configResponse{
		OpeningHour: cfg.OpeningHour,
		ClosingHour: cfg.ClosingHour,
		SlotMinutes: cfg.SlotMinutes,
		RoomName:    roomDisplayDefault,
	})
}

func (p *Plugin) handleListBookings(w http.ResponseWriter, r *http.Request, userID string) {
	q := r.URL.Query()
	teamID := q.Get("team_id")
	if !p.requireTeamAccess(w, userID, teamID) {
		return
	}

	from, to := q.Get("from"), q.Get("to")
	if to == "" {
		to = from
	}

	bookings, err := p.store.GetRange(teamID, from, to)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, bookings)
}

// bookingRequest is the client-supplied half of a booking. Ownership and
// timestamps are set by the server and deliberately not accepted from the body.
type bookingRequest struct {
	TeamID         string   `json:"team_id"`
	Title          string   `json:"title"`
	HostID         string   `json:"host_id"`
	ParticipantIDs []string `json:"participant_ids"`
	Date           string   `json:"date"`
	StartMinute    int      `json:"start_minute"`
	EndMinute      int      `json:"end_minute"`
	Notes          string   `json:"notes"`
}

func decodeBooking(w http.ResponseWriter, r *http.Request) (*bookingRequest, bool) {
	var req bookingRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64*1024)).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "The booking could not be read.")
		return nil, false
	}
	return &req, true
}

// verifyAttendees ensures the host and every participant is a real member of
// the team, so nobody can be attached to a booking they can't even see.
func (p *Plugin) verifyAttendees(b *Booking) error {
	for _, id := range b.Attendees() {
		if !model.IsValidId(id) {
			return errors.New("an invalid user was selected")
		}
		if _, err := p.client.Team.GetMember(b.TeamID, id); err != nil {
			return errors.New("everyone on a booking must be a member of this team")
		}
	}
	return nil
}

// writeSaveError maps a store failure onto the right status code, giving slot
// collisions a 409 with the conflicting booking attached.
func writeSaveError(w http.ResponseWriter, err error) {
	var conflict *ConflictError
	if errors.As(err, &conflict) {
		writeJSON(w, http.StatusConflict, map[string]any{
			"message":  conflict.Error(),
			"conflict": conflict.Existing,
		})
		return
	}
	writeError(w, http.StatusInternalServerError, err.Error())
}

func (p *Plugin) handleCreateBooking(w http.ResponseWriter, r *http.Request, userID string) {
	req, ok := decodeBooking(w, r)
	if !ok {
		return
	}
	if !p.requireTeamAccess(w, userID, req.TeamID) {
		return
	}

	booking := &Booking{
		TeamID:         req.TeamID,
		Title:          req.Title,
		HostID:         req.HostID,
		ParticipantIDs: req.ParticipantIDs,
		Date:           req.Date,
		StartMinute:    req.StartMinute,
		EndMinute:      req.EndMinute,
		Notes:          req.Notes,
		CreatedBy:      userID,
	}
	if err := booking.Validate(); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := p.verifyAttendees(booking); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	// The booking is stored first so it wins the slot outright; Google is a
	// mirror and must never be able to block a room booking.
	if err := p.store.Create(booking); err != nil {
		writeSaveError(w, err)
		return
	}

	eventID, syncErr := p.syncCreate(booking)
	p.applySync(booking, eventID, syncErr)
	p.persistSync(booking)

	p.notify(booking, notifyCreated, userID)
	writeJSON(w, http.StatusCreated, booking)
}

// persistSync writes the sync outcome back onto the stored booking. It runs
// after the slot is already won, so a failure here only costs the sync badge.
func (p *Plugin) persistSync(b *Booking) {
	if err := p.store.SaveSyncState(b); err != nil {
		p.client.Log.Warn("Failed to record calendar sync state",
			"booking_id", b.ID, "error", err.Error())
	}
}

// loadModifiable fetches a booking and checks the caller may change it.
func (p *Plugin) loadModifiable(w http.ResponseWriter, r *http.Request, userID string) (*Booking, bool) {
	bookingID := r.PathValue("id")
	if !model.IsValidId(bookingID) {
		writeError(w, http.StatusBadRequest, "That booking ID isn't valid.")
		return nil, false
	}

	booking, err := p.store.Get(bookingID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return nil, false
	}
	if booking == nil {
		writeError(w, http.StatusNotFound, "That booking no longer exists.")
		return nil, false
	}
	if !p.requireTeamAccess(w, userID, booking.TeamID) {
		return nil, false
	}
	if !p.canModify(userID, booking) {
		writeError(w, http.StatusForbidden, "Only the person who made this booking can change it.")
		return nil, false
	}
	if p.isPastBooking(booking) {
		writeError(w, http.StatusBadRequest, "Past bookings cannot be edited or cancelled.")
		return nil, false
	}
	return booking, true
}

// isPastBooking checks if a booking date/time has already passed in the room's timezone.
func (p *Plugin) isPastBooking(b *Booking) bool {
	loc, err := p.location()
	if err != nil {
		loc = time.UTC
	}
	now := time.Now().In(loc)
	todayStr := now.Format("2006-01-02")
	if b.Date < todayStr {
		return true
	}
	if b.Date == todayStr {
		nowMinute := now.Hour()*60 + now.Minute()
		return nowMinute >= b.EndMinute
	}
	return false
}

func (p *Plugin) handleUpdateBooking(w http.ResponseWriter, r *http.Request, userID string) {
	existing, ok := p.loadModifiable(w, r, userID)
	if !ok {
		return
	}
	req, ok := decodeBooking(w, r)
	if !ok {
		return
	}

	// The booking keeps its identity, owner and team; only the details move.
	updated := *existing
	updated.Title = req.Title
	updated.HostID = req.HostID
	updated.ParticipantIDs = req.ParticipantIDs
	updated.Date = req.Date
	updated.StartMinute = req.StartMinute
	updated.EndMinute = req.EndMinute
	updated.Notes = req.Notes

	if err := updated.Validate(); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := p.verifyAttendees(&updated); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := p.store.Update(existing, &updated); err != nil {
		writeSaveError(w, err)
		return
	}

	eventID, syncErr := p.syncUpdate(&updated)
	p.applySync(&updated, eventID, syncErr)
	p.persistSync(&updated)

	p.notify(&updated, notifyUpdated, userID)
	writeJSON(w, http.StatusOK, updated)
}

func (p *Plugin) handleDeleteBooking(w http.ResponseWriter, r *http.Request, userID string) {
	booking, ok := p.loadModifiable(w, r, userID)
	if !ok {
		return
	}
	if err := p.store.Delete(booking); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	// The room is already free; a stranded Google event is worth a log, not a
	// failed cancellation.
	if err := p.syncDelete(booking); err != nil && !errors.Is(err, errSyncDisabled) {
		p.client.Log.Warn("Cancelled booking left an event in Google Calendar",
			"booking_id", booking.ID, "google_event_id", booking.GoogleEventID, "error", err.Error())
	}

	p.notify(booking, notifyCancelled, userID)
	w.WriteHeader(http.StatusNoContent)
}
