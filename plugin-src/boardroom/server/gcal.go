package main

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"time"

	"google.golang.org/api/calendar/v3"
	"google.golang.org/api/option"
)

// Google Calendar sync.
//
// Every booking is written to one shared Board Room Google account, which an
// admin connects once. The host and participants are added as attendees, so
// Google emails them the invite and it lands on their calendars when they
// accept. Nobody except that one account ever authenticates.
//
// Writing the event onto the host's own calendar would need the host's
// consent, or Workspace domain-wide delegation. This domain's mail is on Zoho,
// so there is no Workspace and no delegation — hence the shared account.
//
// Sync is best-effort by design: the room is a physical resource, so a booking
// must never fail because Google is unreachable.

const (
	syncOff    = "off"
	syncSynced = "synced"
	syncFailed = "failed"

	googleTimeout = 15 * time.Second
)

var (
	errSyncDisabled  = errors.New("calendar sync is off")
	errNotConnected  = errors.New("the Board Room Google account is not connected")
	errNoCredentials = errors.New("calendar sync is enabled but the Google OAuth client is not configured")
)

// location resolves the room's timezone. Bookings are wall-clock times in the
// room's own zone, and the container runs in UTC, so this must never fall back
// to the server's local zone.
func (p *Plugin) location() (*time.Location, error) {
	tz := p.getConfiguration().RoomTimezone
	loc, err := time.LoadLocation(tz)
	if err != nil {
		return nil, fmt.Errorf("the room timezone %q isn't a valid IANA name: %w", tz, err)
	}
	return loc, nil
}

// times converts a booking's wall-clock slot into real timestamps. It uses
// time.Date rather than adding minutes to midnight so that a DST boundary
// lands on the correct instant.
func (b *Booking) times(loc *time.Location) (time.Time, time.Time, error) {
	day, err := time.ParseInLocation("2006-01-02", b.Date, loc)
	if err != nil {
		return time.Time{}, time.Time{}, fmt.Errorf("invalid booking date: %w", err)
	}
	y, m, d := day.Date()
	start := time.Date(y, m, d, b.StartMinute/60, b.StartMinute%60, 0, 0, loc)
	end := time.Date(y, m, d, b.EndMinute/60, b.EndMinute%60, 0, 0, loc)
	return start, end, nil
}

// calendarService builds a client for the shared Board Room account. The
// oauth2 token source refreshes the access token on its own, so the stored
// refresh token keeps working indefinitely.
func (p *Plugin) calendarService(ctx context.Context) (*calendar.Service, error) {
	cfg := p.getConfiguration()
	if !cfg.EnableCalendarSync {
		return nil, errSyncDisabled
	}

	conf, err := p.oauthConfig()
	if err != nil {
		return nil, errNoCredentials
	}

	conn, err := p.getConnection()
	if err != nil {
		return nil, err
	}
	if conn == nil {
		return nil, errNotConnected
	}

	tok, err := p.token(conn)
	if err != nil {
		return nil, err
	}

	return calendar.NewService(ctx, option.WithTokenSource(conf.TokenSource(ctx, tok)))
}

// attendeeEmail returns the address to invite, or "" if the user can't be.
// Test and local accounts have no real mailbox, and inviting them would make
// Google reject the whole event.
func (p *Plugin) attendeeEmail(userID string) string {
	user, err := p.client.User.Get(userID)
	if err != nil || user.Email == "" || user.IsBot {
		return ""
	}
	email := strings.ToLower(strings.TrimSpace(user.Email))

	domain := strings.ToLower(strings.TrimSpace(p.getConfiguration().AttendeeDomain))
	if domain != "" && !strings.HasSuffix(email, "@"+domain) {
		return ""
	}
	return email
}

func (p *Plugin) buildEvent(b *Booking, loc *time.Location) (*calendar.Event, error) {
	start, end, err := b.times(loc)
	if err != nil {
		return nil, err
	}

	attendees := []*calendar.EventAttendee{}
	for _, id := range b.Attendees() {
		if email := p.attendeeEmail(id); email != "" {
			attendees = append(attendees, &calendar.EventAttendee{Email: email})
		}
	}

	// The shared account is the organiser, so the real host is named in the
	// event itself — otherwise nobody could tell whose meeting it is.
	description := fmt.Sprintf("Host: %s", p.username(b.HostID))
	if b.Notes != "" {
		description += "\n\n" + b.Notes
	}

	return &calendar.Event{
		Summary:     b.Title,
		Description: description,
		Location:    roomDisplayDefault,
		Start:       &calendar.EventDateTime{DateTime: start.Format(time.RFC3339), TimeZone: loc.String()},
		End:         &calendar.EventDateTime{DateTime: end.Format(time.RFC3339), TimeZone: loc.String()},
		Attendees:   attendees,
		Source:      &calendar.EventSource{Title: "Mattermost board room", Url: p.siteURL()},
	}, nil
}

func (p *Plugin) siteURL() string {
	if url := p.client.Configuration.GetConfig().ServiceSettings.SiteURL; url != nil {
		return *url
	}
	return ""
}

// syncCreate pushes a new booking to Google and returns the event ID.
func (p *Plugin) syncCreate(b *Booking) (string, error) {
	loc, err := p.location()
	if err != nil {
		return "", err
	}

	ctx, cancel := context.WithTimeout(context.Background(), googleTimeout)
	defer cancel()

	svc, err := p.calendarService(ctx)
	if err != nil {
		return "", err
	}
	event, err := p.buildEvent(b, loc)
	if err != nil {
		return "", err
	}

	created, err := svc.Events.Insert("primary", event).SendUpdates("all").Context(ctx).Do()
	if err != nil {
		return "", fmt.Errorf("Google rejected the event: %w", err)
	}
	return created.Id, nil
}

// syncUpdate rewrites the existing event, recreating it if its Google copy has
// been deleted so a booking can't stay permanently unsynced.
func (p *Plugin) syncUpdate(b *Booking) (string, error) {
	if b.GoogleEventID == "" {
		return p.syncCreate(b)
	}

	loc, err := p.location()
	if err != nil {
		return "", err
	}

	ctx, cancel := context.WithTimeout(context.Background(), googleTimeout)
	defer cancel()

	svc, err := p.calendarService(ctx)
	if err != nil {
		return "", err
	}
	event, err := p.buildEvent(b, loc)
	if err != nil {
		return "", err
	}

	updated, err := svc.Events.Update("primary", b.GoogleEventID, event).SendUpdates("all").Context(ctx).Do()
	if err != nil {
		if isGoneErr(err) {
			clone := *b
			clone.GoogleEventID = ""
			return p.syncCreate(&clone)
		}
		return "", fmt.Errorf("Google rejected the update: %w", err)
	}
	return updated.Id, nil
}

func (p *Plugin) syncDelete(b *Booking) error {
	if b.GoogleEventID == "" {
		return nil
	}

	ctx, cancel := context.WithTimeout(context.Background(), googleTimeout)
	defer cancel()

	svc, err := p.calendarService(ctx)
	if err != nil {
		return err
	}
	if err := svc.Events.Delete("primary", b.GoogleEventID).SendUpdates("all").Context(ctx).Do(); err != nil {
		if isGoneErr(err) {
			return nil // Already gone: nothing to do.
		}
		return fmt.Errorf("Google rejected the cancellation: %w", err)
	}
	return nil
}

// isGoneErr reports whether Google says the event no longer exists.
func isGoneErr(err error) bool {
	if err == nil {
		return false
	}
	msg := err.Error()
	return strings.Contains(msg, "404") || strings.Contains(msg, "410") ||
		strings.Contains(msg, "notFound") || strings.Contains(msg, "deleted")
}

// applySyncState records the outcome on the booking. Sync never fails a
// booking, so the result is stored rather than returned as an error.
//
// Only a deliberately disabled sync counts as "off"; every other problem is a
// visible failure, so a half-finished setup can't pass unnoticed.
func (p *Plugin) applySyncState(b *Booking, eventID string, err error) {
	switch {
	case errors.Is(err, errSyncDisabled):
		b.SyncState = syncOff
		b.SyncError = ""
	case err != nil:
		b.SyncState = syncFailed
		b.SyncError = truncate(err.Error(), 200)
	default:
		b.SyncState = syncSynced
		b.SyncError = ""
		b.GoogleEventID = eventID
	}
}

// applySync records the outcome and logs anything that went wrong.
func (p *Plugin) applySync(b *Booking, eventID string, err error) {
	p.applySyncState(b, eventID, err)
	if b.SyncState == syncFailed {
		p.client.Log.Warn("Board room booking did not sync to Google Calendar",
			"booking_id", b.ID, "error", err.Error())
	}
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}

// googleCalendarWebLink builds a 1-click Google Calendar web link for adding the event.
func (p *Plugin) googleCalendarWebLink(b *Booking) string {
	loc, err := p.location()
	if err != nil {
		loc = time.UTC
	}
	start, end, err := b.times(loc)
	if err != nil {
		return ""
	}

	startStr := start.UTC().Format("20060102T150405Z")
	endStr := end.UTC().Format("20060102T150405Z")
	dates := startStr + "/" + endStr

	details := fmt.Sprintf("Host: %s", p.username(b.HostID))
	if b.Notes != "" {
		details += "\n\n" + b.Notes
	}

	v := url.Values{}
	v.Set("action", "TEMPLATE")
	v.Set("text", b.Title)
	v.Set("dates", dates)
	v.Set("details", details)
	v.Set("location", roomDisplayDefault)

	return "https://calendar.google.com/calendar/render?" + v.Encode()
}
