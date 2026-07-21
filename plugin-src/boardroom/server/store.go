package main

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/public/pluginapi"
)

// Bookings are stored one KV entry per team per day, holding that day's whole
// list. Conflict detection and the write then happen inside a single atomic
// compare-and-set, so two people booking the same slot at the same instant
// cannot both win. A day holds few enough bookings that reading the whole list
// is cheap.
//
// A second entry per booking maps its ID back to the day that contains it, so
// edits and deletes can find a booking without scanning every day.
const (
	dayKeyPrefix  = "br_day_"
	locKeyPrefix  = "br_loc_"
	gcalKeyPrefix = "br_gcal_"
)

func dayKey(teamID, date string) string {
	return dayKeyPrefix + teamID + "_" + date
}

func locKey(bookingID string) string {
	return locKeyPrefix + bookingID
}

func gcalKey(googleEventID string) string {
	return gcalKeyPrefix + googleEventID
}

// bookingLocation records which day list a booking lives in.
type bookingLocation struct {
	TeamID string `json:"team_id"`
	Date   string `json:"date"`
}

// ConflictError is returned when a requested slot collides with an existing
// booking. It carries the offending booking so the UI can name it.
type ConflictError struct {
	Existing Booking
}

func (e *ConflictError) Error() string {
	return fmt.Sprintf("the board room is already booked from %s to %s",
		formatMinute(e.Existing.StartMinute), formatMinute(e.Existing.EndMinute))
}

type store struct {
	kv *pluginapi.KVService
}

func newStore(kv *pluginapi.KVService) *store {
	return &store{kv: kv}
}

func (s *store) getDay(teamID, date string) ([]Booking, error) {
	var bookings []Booking
	if err := s.kv.Get(dayKey(teamID, date), &bookings); err != nil {
		return nil, fmt.Errorf("failed to read bookings for %s: %w", date, err)
	}
	return bookings, nil
}

// GetRange returns every booking between from and to inclusive, ordered by
// start time. Both bounds are YYYY-MM-DD.
func (s *store) GetRange(teamID, from, to string) ([]Booking, error) {
	start, err := time.Parse("2006-01-02", from)
	if err != nil {
		return nil, fmt.Errorf("invalid from date")
	}
	end, err := time.Parse("2006-01-02", to)
	if err != nil {
		return nil, fmt.Errorf("invalid to date")
	}
	if end.Before(start) {
		return nil, fmt.Errorf("the end date must not be before the start date")
	}
	if end.Sub(start) > maxRangeDays*24*time.Hour {
		return nil, fmt.Errorf("the requested range must be %d days or fewer", maxRangeDays)
	}

	out := []Booking{}
	for d := start; !d.After(end); d = d.AddDate(0, 0, 1) {
		day, err := s.getDay(teamID, d.Format("2006-01-02"))
		if err != nil {
			return nil, err
		}
		out = append(out, day...)
	}
	sortBookings(out)
	return out, nil
}

func (s *store) Get(bookingID string) (*Booking, error) {
	var loc bookingLocation
	if err := s.kv.Get(locKey(bookingID), &loc); err != nil {
		return nil, fmt.Errorf("failed to look up booking: %w", err)
	}
	if loc.Date == "" {
		return nil, nil
	}

	day, err := s.getDay(loc.TeamID, loc.Date)
	if err != nil {
		return nil, err
	}
	for i := range day {
		if day[i].ID == bookingID {
			return &day[i], nil
		}
	}
	return nil, nil
}

// insertInto adds b to a day list, rejecting it if it overlaps anything already
// there. skipID names a booking to drop first, so editing a booking neither
// conflicts with its own previous slot nor leaves that slot behind.
func insertInto(day []Booking, b *Booking, skipID string) ([]Booking, error) {
	if skipID != "" {
		day = removeFrom(day, skipID)
	}
	for i := range day {
		if b.Overlaps(&day[i]) {
			return nil, &ConflictError{Existing: day[i]}
		}
	}
	if len(day) >= maxBookingsPerDay {
		return nil, fmt.Errorf("this day already has the maximum number of bookings")
	}
	day = append(day, *b)
	sortBookings(day)
	return day, nil
}

func removeFrom(day []Booking, bookingID string) []Booking {
	out := make([]Booking, 0, len(day))
	for _, existing := range day {
		if existing.ID != bookingID {
			out = append(out, existing)
		}
	}
	return out
}

// Create stores a new booking, failing with *ConflictError if its slot is taken.
func (s *store) Create(b *Booking) error {
	b.ID = model.NewId()
	b.CreateAt = model.GetMillis()
	b.UpdateAt = b.CreateAt

	if err := s.addToDay(b, ""); err != nil {
		return err
	}
	return s.saveLocation(b)
}

// addToDay performs the conflict check and the write atomically.
func (s *store) addToDay(b *Booking, skipID string) error {
	return s.kv.SetAtomicWithRetries(dayKey(b.TeamID, b.Date), func(oldValue []byte) (any, error) {
		day := []Booking{}
		if len(oldValue) > 0 {
			if err := json.Unmarshal(oldValue, &day); err != nil {
				return nil, fmt.Errorf("stored bookings for %s are corrupt: %w", b.Date, err)
			}
		}
		return insertInto(day, b, skipID)
	})
}

func (s *store) removeFromDay(teamID, date, bookingID string) error {
	return s.kv.SetAtomicWithRetries(dayKey(teamID, date), func(oldValue []byte) (any, error) {
		day := []Booking{}
		if len(oldValue) > 0 {
			if err := json.Unmarshal(oldValue, &day); err != nil {
				return nil, fmt.Errorf("stored bookings for %s are corrupt: %w", date, err)
			}
		}
		return removeFrom(day, bookingID), nil
	})
}

func (s *store) saveLocation(b *Booking) error {
	_, err := s.kv.Set(locKey(b.ID), &bookingLocation{TeamID: b.TeamID, Date: b.Date})
	if err != nil {
		return fmt.Errorf("failed to index booking: %w", err)
	}
	return nil
}

// Update replaces an existing booking. When the date changes the booking is
// added to the new day before being removed from the old one, so a conflict on
// the new day leaves the original booking untouched.
func (s *store) Update(old, updated *Booking) error {
	updated.UpdateAt = model.GetMillis()

	if old.Date == updated.Date {
		return s.addToDay(updated, updated.ID)
	}

	if err := s.addToDay(updated, ""); err != nil {
		return err
	}
	if err := s.removeFromDay(old.TeamID, old.Date, old.ID); err != nil {
		// The booking now exists on both days. Roll the new one back so we
		// don't leave a phantom holding a slot nobody can see or cancel.
		if rbErr := s.removeFromDay(updated.TeamID, updated.Date, updated.ID); rbErr != nil {
			return fmt.Errorf("failed to move booking and failed to roll back: %w", rbErr)
		}
		return fmt.Errorf("failed to move booking: %w", err)
	}
	return s.saveLocation(updated)
}

func (s *store) saveGoogleIndex(googleEventID, bookingID string) error {
	if googleEventID == "" {
		return nil
	}
	_, err := s.kv.Set(gcalKey(googleEventID), bookingID)
	return err
}

// GetByGoogleEventID looks up a booking by its linked Google Calendar event ID.
func (s *store) GetByGoogleEventID(googleEventID string) (*Booking, error) {
	if googleEventID == "" {
		return nil, nil
	}
	var bookingID string
	if err := s.kv.Get(gcalKey(googleEventID), &bookingID); err != nil {
		return nil, err
	}
	if bookingID == "" {
		return nil, nil
	}
	return s.Get(bookingID)
}

// SaveSyncState records the Google sync outcome on a booking that is already
// stored. It only ever touches an existing entry: if the booking was cancelled
// while we were talking to Google, writing it back would resurrect a booking
// that nobody can see and that holds the room hostage.
func (s *store) SaveSyncState(b *Booking) error {
	if b.GoogleEventID != "" {
		_ = s.saveGoogleIndex(b.GoogleEventID, b.ID)
	}
	return s.kv.SetAtomicWithRetries(dayKey(b.TeamID, b.Date), func(oldValue []byte) (any, error) {
		day := []Booking{}
		if len(oldValue) > 0 {
			if err := json.Unmarshal(oldValue, &day); err != nil {
				return nil, fmt.Errorf("stored bookings for %s are corrupt: %w", b.Date, err)
			}
		}
		for i := range day {
			if day[i].ID == b.ID {
				day[i].GoogleEventID = b.GoogleEventID
				day[i].SyncState = b.SyncState
				day[i].SyncError = b.SyncError
				return day, nil
			}
		}
		// Gone already: leave the day exactly as we found it.
		return day, nil
	})
}

func (s *store) Delete(b *Booking) error {
	if err := s.removeFromDay(b.TeamID, b.Date, b.ID); err != nil {
		return err
	}
	if b.GoogleEventID != "" {
		_ = s.kv.Delete(gcalKey(b.GoogleEventID))
	}
	if err := s.kv.Delete(locKey(b.ID)); err != nil {
		return fmt.Errorf("failed to remove booking index: %w", err)
	}
	return nil
}
