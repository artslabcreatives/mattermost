package main

import (
	"fmt"
	"strings"

	"github.com/mattermost/mattermost/server/public/model"
)

type notifyKind string

const (
	notifyCreated   notifyKind = "created"
	notifyUpdated   notifyKind = "updated"
	notifyCancelled notifyKind = "cancelled"
)

// notify DMs the host and participants about a booking. Notification is a
// courtesy: a failure here must never fail the booking itself, so errors are
// logged rather than returned.
func (p *Plugin) notify(b *Booking, kind notifyKind, actorID string) {
	if !p.getConfiguration().NotifyOnBook || p.botID == "" {
		return
	}

	message := p.notificationText(b, kind, actorID)

	for _, userID := range b.Attendees() {
		// The person who made the change already knows about it.
		if userID == actorID {
			continue
		}
		if err := p.dm(userID, message); err != nil {
			p.client.Log.Warn("Failed to send booking notification",
				"user_id", userID, "booking_id", b.ID, "error", err.Error())
		}
	}
}

func (p *Plugin) dm(userID, message string) error {
	channel, err := p.client.Channel.GetDirect(userID, p.botID)
	if err != nil {
		return err
	}
	return p.client.Post.CreatePost(&model.Post{
		UserId:    p.botID,
		ChannelId: channel.Id,
		Message:   message,
	})
}

func (p *Plugin) notificationText(b *Booking, kind notifyKind, actorID string) string {
	actor := p.username(actorID)
	host := p.username(b.HostID)

	var headline string
	switch kind {
	case notifyCreated:
		headline = fmt.Sprintf("%s booked the board room and added you to a meeting.", actor)
	case notifyUpdated:
		headline = fmt.Sprintf("%s updated a board room booking you're part of.", actor)
	case notifyCancelled:
		headline = fmt.Sprintf("%s cancelled a board room booking you were part of.", actor)
	}

	var sb strings.Builder
	fmt.Fprintf(&sb, "%s\n\n", headline)
	fmt.Fprintf(&sb, "| | |\n|:--|:--|\n")
	fmt.Fprintf(&sb, "| **Meeting** | %s |\n", escapePipes(b.Title))
	fmt.Fprintf(&sb, "| **When** | %s |\n", b.formatRange())
	fmt.Fprintf(&sb, "| **Host** | %s |\n", host)

	if len(b.ParticipantIDs) > 0 {
		names := make([]string, 0, len(b.ParticipantIDs))
		for _, id := range b.ParticipantIDs {
			names = append(names, p.username(id))
		}
		fmt.Fprintf(&sb, "| **Participants** | %s |\n", strings.Join(names, ", "))
	}
	if b.Notes != "" {
		fmt.Fprintf(&sb, "| **Notes** | %s |\n", escapePipes(b.Notes))
	}
	if kind != notifyCancelled {
		if gcalLink := p.googleCalendarWebLink(b); gcalLink != "" {
			fmt.Fprintf(&sb, "\n[📅 Add to Google Calendar](%s)\n", gcalLink)
		}
	}
	return sb.String()
}

// username renders a user as an @-mention, falling back to a neutral label if
// the account has since been removed.
func (p *Plugin) username(userID string) string {
	user, err := p.client.User.Get(userID)
	if err != nil {
		return "someone"
	}
	return "@" + user.Username
}

// escapePipes keeps user text from breaking out of a markdown table cell.
func escapePipes(s string) string {
	return strings.ReplaceAll(strings.ReplaceAll(s, "|", "\\|"), "\n", " ")
}
