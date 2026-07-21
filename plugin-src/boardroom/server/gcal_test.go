package main

import (
	"testing"
	"time"
)

// A booking's wall-clock slot must land on the right real instant. Getting
// this wrong would put every synced event in the wrong hour without any
// visible error, so it's pinned down here.
func TestBookingTimes(t *testing.T) {
	colombo, err := time.LoadLocation("Asia/Colombo")
	if err != nil {
		t.Fatalf("tzdata missing: %v", err)
	}

	b := &Booking{Date: "2026-09-15", StartMinute: 570, EndMinute: 630} // 09:30–10:30
	start, end, err := b.times(colombo)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if got := start.Format(time.RFC3339); got != "2026-09-15T09:30:00+05:30" {
		t.Errorf("start = %s, want 2026-09-15T09:30:00+05:30", got)
	}
	if got := end.Format(time.RFC3339); got != "2026-09-15T10:30:00+05:30" {
		t.Errorf("end = %s, want 2026-09-15T10:30:00+05:30", got)
	}
}

// The container runs in UTC, so a booking must not be interpreted in the
// server's zone.
func TestBookingTimesIgnoresServerZone(t *testing.T) {
	colombo, _ := time.LoadLocation("Asia/Colombo")
	b := &Booking{Date: "2026-09-15", StartMinute: 540, EndMinute: 600}

	start, _, err := b.times(colombo)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	// 09:00 in Colombo is 03:30 UTC; if this ever reads 09:00 UTC the zone
	// has been ignored.
	if got := start.UTC().Format("15:04"); got != "03:30" {
		t.Errorf("09:00 Colombo = %s UTC, want 03:30", got)
	}
}

// In a DST zone, adding minutes to midnight would drift by an hour across the
// transition; time.Date must not.
func TestBookingTimesAcrossDST(t *testing.T) {
	london, err := time.LoadLocation("Europe/London")
	if err != nil {
		t.Skip("tzdata missing")
	}

	// 29 March 2026 is the day the UK springs forward at 01:00.
	b := &Booking{Date: "2026-03-29", StartMinute: 600, EndMinute: 660} // 10:00–11:00
	start, end, err := b.times(london)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if got := start.Format("15:04"); got != "10:00" {
		t.Errorf("start = %s, want a 10:00 wall-clock time", got)
	}
	if d := end.Sub(start); d != time.Hour {
		t.Errorf("duration = %v, want 1h", d)
	}
}

func TestRoomTimezoneFallsBackWhenInvalid(t *testing.T) {
	cases := map[string]string{
		"":                 defaultRoomTimezone,
		"Not/AZone":        defaultRoomTimezone,
		"  Asia/Colombo  ": "Asia/Colombo",
		"America/New_York": "America/New_York",
	}
	for input, want := range cases {
		got := (&rawConfiguration{RoomTimezone: input}).parse().RoomTimezone
		if got != want {
			t.Errorf("RoomTimezone(%q) = %q, want %q", input, got, want)
		}
	}
}

// "off" must mean an admin deliberately turned sync off. Enabling sync but
// forgetting the key is a misconfiguration, and reporting it as "off" would
// hide it from everyone.
func TestSyncStateDistinguishesOffFromMisconfigured(t *testing.T) {
	t.Run("disabled is off and silent", func(t *testing.T) {
		b := &Booking{}
		(&Plugin{}).applySyncState(b, "", errSyncDisabled)
		if b.SyncState != syncOff {
			t.Fatalf("SyncState = %q, want %q", b.SyncState, syncOff)
		}
		if b.SyncError != "" {
			t.Errorf("a deliberate off should carry no error, got %q", b.SyncError)
		}
	})

	t.Run("enabled without a key is a visible failure", func(t *testing.T) {
		b := &Booking{}
		(&Plugin{}).applySyncState(b, "", errString("calendar sync is enabled but no Google service account key is configured"))
		if b.SyncState != syncFailed {
			t.Fatalf("SyncState = %q, want %q", b.SyncState, syncFailed)
		}
		if b.SyncError == "" {
			t.Error("a misconfiguration must explain itself")
		}
	})

	t.Run("success records the event id", func(t *testing.T) {
		b := &Booking{}
		(&Plugin{}).applySyncState(b, "evt123", nil)
		if b.SyncState != syncSynced || b.GoogleEventID != "evt123" {
			t.Fatalf("got %q/%q, want synced/evt123", b.SyncState, b.GoogleEventID)
		}
	})
}

func TestIsGoneErr(t *testing.T) {
	if !isGoneErr(errString("googleapi: Error 404: Not Found, notFound")) {
		t.Error("404 should be treated as gone")
	}
	if isGoneErr(errString("googleapi: Error 403: Forbidden")) {
		t.Error("403 must not be treated as gone; it would recreate the event on every edit")
	}
	if isGoneErr(nil) {
		t.Error("nil is not gone")
	}
}

type errString string

func (e errString) Error() string { return string(e) }
