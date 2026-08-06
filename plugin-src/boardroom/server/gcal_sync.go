package main

import (
	"context"
	"strings"
	"sync"
	"time"

	"google.golang.org/api/calendar/v3"
)

const (
	gcalSyncInterval = 60 * time.Second
	lastSyncTimeKey  = "br_gcal_last_sync"
)

type syncRunner struct {
	stopChan chan struct{}
	wg       sync.WaitGroup
}

// startBackgroundSync starts a background ticker to poll Google Calendar for changes.
func (p *Plugin) startBackgroundSync() {
	p.stopBackgroundSync()

	cfg := p.getConfiguration()
	if !cfg.EnableCalendarSync {
		return
	}

	sr := &syncRunner{
		stopChan: make(chan struct{}),
	}

	p.syncRunnerLock.Lock()
	p.syncRunner = sr
	p.syncRunnerLock.Unlock()

	sr.wg.Add(1)
	go func() {
		defer sr.wg.Done()
		ticker := time.NewTicker(gcalSyncInterval)
		defer ticker.Stop()

		// Run an initial sync shortly after plugin start
		p.syncFromGoogle()
		p.resyncFailedBookings()

		for {
			select {
			case <-ticker.C:
				p.syncFromGoogle()
				p.resyncFailedBookings()
			case <-sr.stopChan:
				return
			}
		}
	}()
}

func (p *Plugin) stopBackgroundSync() {
	p.syncRunnerLock.Lock()
	sr := p.syncRunner
	p.syncRunner = nil
	p.syncRunnerLock.Unlock()

	if sr != nil {
		close(sr.stopChan)
		sr.wg.Wait()
	}
}

func (p *Plugin) syncFromGoogle() {
	cfg := p.getConfiguration()
	if !cfg.EnableCalendarSync {
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), googleTimeout)
	defer cancel()

	svc, err := p.calendarService(ctx)
	if err != nil {
		// Sync disabled or Google account not connected
		return
	}

	loc, err := p.location()
	if err != nil {
		return
	}

	now := time.Now().In(loc)
	timeMin := now.AddDate(0, 0, -7).Format(time.RFC3339)
	timeMax := now.AddDate(0, 0, 60).Format(time.RFC3339)

	req := svc.Events.List("primary").
		TimeMin(timeMin).
		TimeMax(timeMax).
		SingleEvents(true)

	var lastSyncStr string
	if err := p.client.KV.Get(lastSyncTimeKey, &lastSyncStr); err == nil && lastSyncStr != "" {
		req = req.UpdatedMin(lastSyncStr)
	}

	newSyncTime := time.Now().UTC().Format(time.RFC3339)

	events, err := req.Context(ctx).Do()
	if err != nil {
		p.client.Log.Warn("Failed to poll Google Calendar events", "error", err.Error())
		return
	}

	teamID := p.getDefaultTeamID()
	if teamID == "" {
		return
	}

	for _, item := range events.Items {
		p.processGoogleEvent(item, teamID, loc)
	}

	_, _ = p.client.KV.Set(lastSyncTimeKey, newSyncTime)
}

func (p *Plugin) getDefaultTeamID() string {
	teams, err := p.API.GetTeams()
	if err != nil || len(teams) == 0 {
		return ""
	}
	return teams[0].Id
}

func (p *Plugin) processGoogleEvent(event *calendar.Event, teamID string, loc *time.Location) {
	if event == nil || event.Id == "" {
		return
	}

	existing, err := p.store.GetByGoogleEventID(event.Id)
	if err != nil {
		p.client.Log.Warn("Failed checking existing booking for Google event", "event_id", event.Id, "error", err.Error())
		return
	}

	// Handle cancelled events
	if event.Status == "cancelled" {
		if existing != nil {
			if err := p.store.Delete(existing); err != nil {
				p.client.Log.Warn("Failed to delete cancelled Google event from store", "booking_id", existing.ID, "error", err.Error())
			} else {
				p.notify(existing, notifyCancelled, existing.CreatedBy)
			}
		}
		return
	}

	if event.Start == nil || event.End == nil {
		return
	}

	var startRaw, endRaw string
	if event.Start.DateTime != "" {
		startRaw = event.Start.DateTime
	} else {
		startRaw = event.Start.Date
	}
	if event.End.DateTime != "" {
		endRaw = event.End.DateTime
	} else {
		endRaw = event.End.Date
	}

	startTime, err := time.Parse(time.RFC3339, startRaw)
	if err != nil {
		t, errDate := time.ParseInLocation("2006-01-02", startRaw, loc)
		if errDate != nil {
			return
		}
		startTime = t
	} else {
		startTime = startTime.In(loc)
	}

	endTime, err := time.Parse(time.RFC3339, endRaw)
	if err != nil {
		t, errDate := time.ParseInLocation("2006-01-02", endRaw, loc)
		if errDate != nil {
			return
		}
		endTime = t
	} else {
		endTime = endTime.In(loc)
	}

	dateStr := startTime.Format("2006-01-02")
	startMinute := startTime.Hour()*60 + startTime.Minute()
	endMinute := endTime.Hour()*60 + endTime.Minute()

	if endMinute <= startMinute {
		endMinute = 24 * 60
	}

	title := strings.TrimSpace(event.Summary)
	if title == "" {
		title = "Google Calendar Booking"
	}
	if len(title) > maxTitleLen {
		title = title[:maxTitleLen]
	}

	notes := strings.TrimSpace(event.Description)
	if len(notes) > maxNotesLen {
		notes = notes[:maxNotesLen]
	}

	// Resolve host user
	hostID := ""

	// 1. Try parsing "Host: username" or "Host: @username" from Google event description
	if notes != "" {
		for _, line := range strings.Split(notes, "\n") {
			line = strings.TrimSpace(line)
			if strings.HasPrefix(strings.ToLower(line), "host:") {
				parts := strings.SplitN(line, ":", 2)
				if len(parts) == 2 {
					rawHost := strings.TrimSpace(parts[1])
					rawHost = strings.TrimPrefix(rawHost, "@")
					if user, err := p.API.GetUserByUsername(rawHost); err == nil && user != nil {
						hostID = user.Id
						break
					}
				}
			}
		}
	}

	conn, _ := p.getConnection()
	connectedUserID := ""
	if conn != nil {
		connectedUserID = conn.ConnectedBy
	}

	// 2. Try Organizer/Creator email if it matches a distinct Mattermost user
	if hostID == "" && event.Organizer != nil && event.Organizer.Email != "" {
		if user, err := p.API.GetUserByEmail(event.Organizer.Email); err == nil && user != nil && user.Id != connectedUserID {
			hostID = user.Id
		}
	}
	if hostID == "" && event.Creator != nil && event.Creator.Email != "" {
		if user, err := p.API.GetUserByEmail(event.Creator.Email); err == nil && user != nil && user.Id != connectedUserID {
			hostID = user.Id
		}
	}

	// 3. Fallback for new events where host cannot be determined
	if hostID == "" {
		if connectedUserID != "" {
			hostID = connectedUserID
		} else {
			hostID = p.botID
		}
	}

	// Resolve participants
	participantIDs := []string{}
	if event.Attendees != nil {
		for _, att := range event.Attendees {
			if att.Email == "" {
				continue
			}
			if user, err := p.API.GetUserByEmail(att.Email); err == nil && user != nil && user.Id != hostID {
				participantIDs = append(participantIDs, user.Id)
			}
		}
	}

	if existing == nil {
		// Create new booking from Google Event
		booking := &Booking{
			TeamID:         teamID,
			Title:          title,
			HostID:         hostID,
			ParticipantIDs: participantIDs,
			Date:           dateStr,
			StartMinute:    startMinute,
			EndMinute:      endMinute,
			Notes:          notes,
			CreatedBy:      hostID,
			GoogleEventID:  event.Id,
			SyncState:      syncSynced,
		}

		if err := booking.Validate(); err != nil {
			return
		}

		if err := p.store.Create(booking); err != nil {
			p.client.Log.Info("Skipped importing conflicting Google event", "event_id", event.Id, "error", err.Error())
			return
		}

		p.persistSync(booking)
		p.notify(booking, notifyCreated, hostID)
	} else {
		// Update existing booking from Google Event
		if existing.Title == title &&
			existing.Date == dateStr &&
			existing.StartMinute == startMinute &&
			existing.EndMinute == endMinute &&
			existing.Notes == notes {
			return
		}

		updated := *existing
		updated.Title = title
		updated.Date = dateStr
		updated.StartMinute = startMinute
		updated.EndMinute = endMinute
		updated.Notes = notes
		if existing.HostID != "" {
			updated.HostID = existing.HostID
		} else {
			updated.HostID = hostID
		}
		updated.ParticipantIDs = participantIDs
		updated.SyncState = syncSynced

		if err := updated.Validate(); err != nil {
			return
		}

		if err := p.store.Update(existing, &updated); err != nil {
			p.client.Log.Warn("Failed to update booking from Google event", "booking_id", existing.ID, "error", err.Error())
			return
		}

		p.persistSync(&updated)
		p.notify(&updated, notifyUpdated, hostID)
	}
}

func (p *Plugin) resyncFailedBookings() {
	cfg := p.getConfiguration()
	if !cfg.EnableCalendarSync {
		return
	}
	conn, err := p.getConnection()
	if err != nil || conn == nil {
		return
	}
	loc, err := p.location()
	if err != nil {
		return
	}
	teamID := p.getDefaultTeamID()
	if teamID == "" {
		return
	}

	now := time.Now().In(loc)
	from := now.Format("2006-01-02")
	to := now.AddDate(0, 0, 60).Format("2006-01-02")

	bookings, err := p.store.GetRange(teamID, from, to)
	if err != nil {
		return
	}

	for i := range bookings {
		b := &bookings[i]
		if b.SyncState == syncFailed || (b.SyncState != syncSynced && b.GoogleEventID == "") {
			eventID, syncErr := p.syncUpdate(b)
			p.applySync(b, eventID, syncErr)
			p.persistSync(b)
		}
	}
}
