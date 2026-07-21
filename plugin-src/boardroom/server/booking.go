package main

import (
	"fmt"
	"regexp"
	"sort"
	"strings"
	"time"
)

const (
	maxTitleLen        = 128
	maxNotesLen        = 1024
	maxParticipants    = 100
	minutesInDay       = 24 * 60
	maxBookingsPerDay  = 200
	maxRangeDays       = 62
	roomDisplayDefault = "Board Room"
)

var dateRe = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)

// Booking is a single reservation of the board room.
//
// Times are stored as minutes from midnight in the room's local wall-clock
// time rather than as absolute timestamps: the room is a physical place, so a
// booking at 09:00 stays at 09:00 regardless of the viewer's timezone.
type Booking struct {
	ID             string   `json:"id"`
	TeamID         string   `json:"team_id"`
	Title          string   `json:"title"`
	HostID         string   `json:"host_id"`
	ParticipantIDs []string `json:"participant_ids"`
	Date           string   `json:"date"`
	StartMinute    int      `json:"start_minute"`
	EndMinute      int      `json:"end_minute"`
	Notes          string   `json:"notes"`
	CreatedBy      string   `json:"created_by"`
	CreateAt       int64    `json:"create_at"`
	UpdateAt       int64    `json:"update_at"`

	// Google Calendar mirror. Sync is best-effort, so these record what
	// happened rather than gating the booking itself.
	GoogleEventID string `json:"google_event_id,omitempty"`
	SyncState     string `json:"sync_state,omitempty"`
	SyncError     string `json:"sync_error,omitempty"`
}

// Overlaps reports whether two bookings on the same day collide in time.
// Touching intervals (one ends exactly when the next starts) do not collide.
func (b *Booking) Overlaps(other *Booking) bool {
	if b.Date != other.Date {
		return false
	}
	return b.StartMinute < other.EndMinute && b.EndMinute > other.StartMinute
}

func (b *Booking) Validate() error {
	b.Title = strings.TrimSpace(b.Title)
	b.Notes = strings.TrimSpace(b.Notes)

	if b.Title == "" {
		return fmt.Errorf("a title is required")
	}
	if len(b.Title) > maxTitleLen {
		return fmt.Errorf("title must be %d characters or fewer", maxTitleLen)
	}
	if len(b.Notes) > maxNotesLen {
		return fmt.Errorf("notes must be %d characters or fewer", maxNotesLen)
	}
	if b.HostID == "" {
		return fmt.Errorf("a host is required")
	}
	if !dateRe.MatchString(b.Date) {
		return fmt.Errorf("date must be in YYYY-MM-DD format")
	}
	if _, err := time.Parse("2006-01-02", b.Date); err != nil {
		return fmt.Errorf("%q is not a valid date", b.Date)
	}
	if b.StartMinute < 0 || b.StartMinute >= minutesInDay {
		return fmt.Errorf("start time is outside the day")
	}
	if b.EndMinute <= 0 || b.EndMinute > minutesInDay {
		return fmt.Errorf("end time is outside the day")
	}
	if b.EndMinute <= b.StartMinute {
		return fmt.Errorf("the end time must be after the start time")
	}
	if len(b.ParticipantIDs) > maxParticipants {
		return fmt.Errorf("a booking can have at most %d participants", maxParticipants)
	}

	b.ParticipantIDs = dedupe(b.ParticipantIDs, b.HostID)
	return nil
}

// dedupe removes duplicates and the host (who is always implicitly attending)
// while preserving the caller's ordering.
func dedupe(ids []string, hostID string) []string {
	seen := map[string]bool{hostID: true}
	out := make([]string, 0, len(ids))
	for _, id := range ids {
		if id == "" || seen[id] {
			continue
		}
		seen[id] = true
		out = append(out, id)
	}
	return out
}

// Attendees returns the host followed by every participant.
func (b *Booking) Attendees() []string {
	return append([]string{b.HostID}, b.ParticipantIDs...)
}

func sortBookings(bookings []Booking) {
	sort.Slice(bookings, func(i, j int) bool {
		if bookings[i].Date != bookings[j].Date {
			return bookings[i].Date < bookings[j].Date
		}
		if bookings[i].StartMinute != bookings[j].StartMinute {
			return bookings[i].StartMinute < bookings[j].StartMinute
		}
		return bookings[i].ID < bookings[j].ID
	})
}

func formatMinute(m int) string {
	return fmt.Sprintf("%02d:%02d", m/60, m%60)
}

// formatRange renders a booking's slot the way it reads in a DM.
func (b *Booking) formatRange() string {
	return fmt.Sprintf("%s, %s–%s", b.Date, formatMinute(b.StartMinute), formatMinute(b.EndMinute))
}
