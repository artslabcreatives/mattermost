package main

import (
	"errors"
	"testing"
)

func slot(id, date string, start, end int) Booking {
	return Booking{ID: id, Date: date, StartMinute: start, EndMinute: end, Title: "meeting", HostID: "host"}
}

func TestOverlaps(t *testing.T) {
	base := slot("a", "2026-07-20", 540, 600) // 09:00–10:00

	cases := []struct {
		name string
		with Booking
		want bool
	}{
		{"identical slot", slot("b", "2026-07-20", 540, 600), true},
		{"starts inside", slot("b", "2026-07-20", 570, 630), true},
		{"ends inside", slot("b", "2026-07-20", 510, 570), true},
		{"fully contains", slot("b", "2026-07-20", 480, 660), true},
		{"fully contained", slot("b", "2026-07-20", 550, 560), true},
		{"touching at end", slot("b", "2026-07-20", 600, 660), false},
		{"touching at start", slot("b", "2026-07-20", 480, 540), false},
		{"clear of it", slot("b", "2026-07-20", 660, 720), false},
		{"same time, next day", slot("b", "2026-07-21", 540, 600), false},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := base.Overlaps(&tc.with); got != tc.want {
				t.Fatalf("Overlaps() = %v, want %v", got, tc.want)
			}
			// Overlap is symmetric.
			if got := tc.with.Overlaps(&base); got != tc.want {
				t.Fatalf("reversed Overlaps() = %v, want %v", got, tc.want)
			}
		})
	}
}

func TestInsertIntoRejectsConflict(t *testing.T) {
	day := []Booking{slot("existing", "2026-07-20", 540, 600)}
	incoming := slot("new", "2026-07-20", 570, 630)

	_, err := insertInto(day, &incoming, "")

	var conflict *ConflictError
	if !errors.As(err, &conflict) {
		t.Fatalf("expected a ConflictError, got %v", err)
	}
	if conflict.Existing.ID != "existing" {
		t.Fatalf("conflict named booking %q, want %q", conflict.Existing.ID, "existing")
	}
}

func TestInsertIntoAcceptsFreeSlot(t *testing.T) {
	day := []Booking{slot("existing", "2026-07-20", 540, 600)}
	incoming := slot("new", "2026-07-20", 600, 660)

	got, err := insertInto(day, &incoming, "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("day has %d bookings, want 2", len(got))
	}
	// The list stays ordered by start time so the UI can render it directly.
	if got[0].ID != "existing" || got[1].ID != "new" {
		t.Fatalf("day is out of order: %v, %v", got[0].ID, got[1].ID)
	}
}

// Editing a booking must not collide with its own previous slot.
func TestInsertIntoIgnoresSelfWhenEditing(t *testing.T) {
	day := []Booking{slot("mine", "2026-07-20", 540, 600)}
	edited := slot("mine", "2026-07-20", 550, 610)

	got, err := insertInto(day, &edited, "mine")
	if err != nil {
		t.Fatalf("editing own booking conflicted with itself: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("day has %d bookings, want 1", len(got))
	}
	if got[0].StartMinute != 550 {
		t.Fatalf("edit did not apply: start = %d, want 550", got[0].StartMinute)
	}
}

func TestValidate(t *testing.T) {
	valid := func() *Booking {
		return &Booking{Title: "Standup", HostID: "host", Date: "2026-07-20", StartMinute: 540, EndMinute: 600}
	}

	t.Run("accepts a good booking", func(t *testing.T) {
		if err := valid().Validate(); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
	})

	bad := map[string]func(*Booking){
		"empty title":       func(b *Booking) { b.Title = "   " },
		"missing host":      func(b *Booking) { b.HostID = "" },
		"malformed date":    func(b *Booking) { b.Date = "20-07-2026" },
		"impossible date":   func(b *Booking) { b.Date = "2026-02-31" },
		"end before start":  func(b *Booking) { b.EndMinute = 480 },
		"zero length":       func(b *Booking) { b.EndMinute = b.StartMinute },
		"end past midnight": func(b *Booking) { b.EndMinute = minutesInDay + 1 },
		"negative start":    func(b *Booking) { b.StartMinute = -1 },
		"overlong title":    func(b *Booking) { b.Title = string(make([]byte, maxTitleLen+1)) },
	}
	for name, mutate := range bad {
		t.Run("rejects "+name, func(t *testing.T) {
			b := valid()
			mutate(b)
			if err := b.Validate(); err == nil {
				t.Fatal("expected an error, got nil")
			}
		})
	}
}

// The host attends implicitly, so listing them again must not duplicate them.
func TestValidateDedupesParticipants(t *testing.T) {
	b := &Booking{
		Title: "Standup", HostID: "host", Date: "2026-07-20", StartMinute: 540, EndMinute: 600,
		ParticipantIDs: []string{"amy", "host", "amy", "", "bob"},
	}
	if err := b.Validate(); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	want := []string{"amy", "bob"}
	if len(b.ParticipantIDs) != len(want) {
		t.Fatalf("got %v, want %v", b.ParticipantIDs, want)
	}
	for i := range want {
		if b.ParticipantIDs[i] != want[i] {
			t.Fatalf("got %v, want %v", b.ParticipantIDs, want)
		}
	}
}
