package main

import (
	"encoding/json"
)

type Poll struct {
	ID        string              `json:"id"`
	CreatedAt int64               `json:"created_at"`
	UserID    string              `json:"user_id"`
	ChannelID string              `json:"channel_id"`
	Question  string              `json:"question"`
	Options   []string            `json:"options"`
	Votes     map[string][]string `json:"votes"` // optionIndexStr -> list of userIDs
	Multiple  bool                `json:"multiple"`
	Ended     bool                `json:"ended"`
}

func NewPoll(id, userID, channelID, question string, options []string, multiple bool, createdAt int64) *Poll {
	votes := make(map[string][]string)
	for i := range options {
		votes[string(rune('0'+i))] = []string{}
	}
	return &Poll{
		ID:        id,
		CreatedAt: createdAt,
		UserID:    userID,
		ChannelID: channelID,
		Question:  question,
		Options:   options,
		Votes:     votes,
		Multiple:  multiple,
		Ended:     false,
	}
}

func PollFromBytes(b []byte) (*Poll, error) {
	var p Poll
	err := json.Unmarshal(b, &p)
	if err != nil {
		return nil, err
	}
	if p.Votes == nil {
		p.Votes = make(map[string][]string)
	}
	return &p, nil
}

func (p *Poll) Bytes() ([]byte, error) {
	return json.Marshal(p)
}

func (p *Poll) TotalVotes() int {
	votedUsers := make(map[string]bool)
	for _, userList := range p.Votes {
		for _, uid := range userList {
			votedUsers[uid] = true
		}
	}
	return len(votedUsers)
}

func (p *Poll) Vote(userID string, optKey string) {
	if p.Ended {
		return
	}

	// Check if user already voted on this option
	existingList := p.Votes[optKey]
	alreadyVotedThisOpt := false
	for _, uid := range existingList {
		if uid == userID {
			alreadyVotedThisOpt = true
			break
		}
	}

	if !p.Multiple {
		// Single selection poll: remove user's vote from all other options first
		for k, list := range p.Votes {
			newList := []string{}
			for _, uid := range list {
				if uid != userID {
					newList = append(newList, uid)
				}
			}
			p.Votes[k] = newList
		}
		// Toggle vote on optKey
		if !alreadyVotedThisOpt {
			p.Votes[optKey] = append(p.Votes[optKey], userID)
		}
	} else {
		// Multiple selection poll: toggle option vote
		if alreadyVotedThisOpt {
			// Remove vote
			newList := []string{}
			for _, uid := range existingList {
				if uid != userID {
					newList = append(newList, uid)
				}
			}
			p.Votes[optKey] = newList
		} else {
			// Add vote
			p.Votes[optKey] = append(existingList, userID)
		}
	}
}
