package main

import (
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/public/plugin"
)

type Plugin struct {
	plugin.MattermostPlugin

	configurationLock sync.RWMutex
	configuration     *configuration

	stopChan chan struct{}
}

type configuration struct {
	AutoJoinChannels string `json:"AutoJoinChannels"`
	ScanInterval     string `json:"ScanInterval"`
}

func (p *Plugin) OnConfigurationChange() error {
	var config configuration
	if err := p.API.LoadPluginConfiguration(&config); err != nil {
		return err
	}

	p.configurationLock.Lock()
	p.configuration = &config
	p.configurationLock.Unlock()

	// Restart background sync loop
	p.stopBackgroundSync()
	p.startBackgroundSync()

	return nil
}

func (p *Plugin) getConfiguration() *configuration {
	p.configurationLock.RLock()
	defer p.configurationLock.RUnlock()
	if p.configuration == nil {
		return &configuration{
			AutoJoinChannels: "town-square, off-topic",
			ScanInterval:     "10",
		}
	}
	return p.configuration
}

func (p *Plugin) OnDeactivate() error {
	p.stopBackgroundSync()
	return nil
}

func (p *Plugin) startBackgroundSync() {
	p.stopChan = make(chan struct{})
	go func() {
		cfg := p.getConfiguration()
		intervalMins, err := strconv.Atoi(cfg.ScanInterval)
		if err != nil || intervalMins <= 0 {
			intervalMins = 10
		}
		
		// Run initial sync shortly after configuration change or activation
		time.Sleep(3 * time.Second)
		p.SyncUsersToChannels()

		ticker := time.NewTicker(time.Duration(intervalMins) * time.Minute)
		defer ticker.Stop()

		for {
			select {
			case <-ticker.C:
				p.SyncUsersToChannels()
			case <-p.stopChan:
				return
			}
		}
	}()
}

func (p *Plugin) stopBackgroundSync() {
	if p.stopChan != nil {
		close(p.stopChan)
		p.stopChan = nil
	}
}

// UserHasBeenCreated is called when a new user is created.
func (p *Plugin) UserHasBeenCreated(c *plugin.Context, user *model.User) {
	p.API.LogInfo("Auto Join Channels: processing newly created user", "username", user.Username)
	p.addUserToConfiguredChannels(user)
}

func (p *Plugin) SyncUsersToChannels() {
	p.API.LogInfo("Auto Join Channels: starting background scan/sync of active users")
	
	// Fetch all resolved general channels
	channels := p.getResolvedChannels()
	if len(channels) == 0 {
		p.API.LogDebug("Auto Join Channels: no channels configured for auto-join")
		return
	}

	// Iterate through all active users and add them to target channels
	page := 0
	perPage := 100
	for {
		users, err := p.API.GetUsers(&model.UserGetOptions{Page: page, PerPage: perPage})
		if err != nil {
			p.API.LogError("Auto Join Channels: failed to fetch users list", "error", err.Error())
			break
		}
		if len(users) == 0 {
			break
		}

		for _, user := range users {
			// Skip deleted or inactive users
			if user.DeleteAt > 0 {
				continue
			}
			p.addUserToChannels(user, channels)
		}

		page++
	}
	p.API.LogInfo("Auto Join Channels: background scan/sync completed")
}

func (p *Plugin) getResolvedChannels() []*model.Channel {
	cfg := p.getConfiguration()
	rawList := strings.Split(cfg.AutoJoinChannels, ",")
	var resolved []*model.Channel

	// Fetch all teams once for fallback lookup
	teams, err := p.API.GetTeams()
	if err != nil {
		p.API.LogError("Auto Join Channels: failed to get teams list", "error", err.Error())
		return nil
	}

	for _, entry := range rawList {
		cleaned := strings.TrimSpace(entry)
		if cleaned == "" {
			continue
		}

		// 1. Try to resolve as Channel ID directly
		if channel, err := p.API.GetChannel(cleaned); err == nil && channel != nil {
			resolved = append(resolved, channel)
			continue
		}

		// 2. Try to resolve as TeamHandle:ChannelHandle format
		if strings.Contains(cleaned, ":") {
			parts := strings.SplitN(cleaned, ":", 2)
			teamHandle := strings.TrimSpace(parts[0])
			channelHandle := strings.TrimSpace(parts[1])
			
			// Find team
			var matchedTeam *model.Team
			for _, team := range teams {
				if strings.EqualFold(team.Name, teamHandle) || strings.EqualFold(team.DisplayName, teamHandle) {
					matchedTeam = team
					break
				}
			}
			if matchedTeam != nil {
				if channel, err := p.API.GetChannelByName(matchedTeam.Id, channelHandle, false); err == nil && channel != nil {
					resolved = append(resolved, channel)
					continue
				}
			}
		}

		// 3. Fallback: Search channel across all teams
		var found bool
		for _, team := range teams {
			if channel, err := p.API.GetChannelByName(team.Id, cleaned, false); err == nil && channel != nil {
				resolved = append(resolved, channel)
				found = true
				break
			}
		}
		if found {
			continue
		}

		// 4. Try getting channel by display name instead of name/handle
		for _, team := range teams {
			// Get all public channels in team to search by display name
			channels, err := p.API.GetPublicChannelsForTeam(team.Id, 0, 100)
			if err == nil {
				for _, ch := range channels {
					if strings.EqualFold(ch.DisplayName, cleaned) || strings.EqualFold(ch.Name, cleaned) {
						resolved = append(resolved, ch)
						found = true
						break
					}
				}
			}
			if found {
				break
			}
		}
	}

	return resolved
}

func (p *Plugin) addUserToConfiguredChannels(user *model.User) {
	channels := p.getResolvedChannels()
	p.addUserToChannels(user, channels)
}

func (p *Plugin) addUserToChannels(user *model.User, channels []*model.Channel) {
	for _, channel := range channels {
		// Verify team membership first (user must belong to team before they can join team channels)
		if channel.TeamId != "" {
			_, err := p.API.GetTeamMember(channel.TeamId, user.Id)
			if err != nil {
				// Not a team member, add them
				p.API.LogDebug("Auto Join Channels: adding user to team", "username", user.Username, "team_id", channel.TeamId)
				_, teamErr := p.API.CreateTeamMember(channel.TeamId, user.Id)
				if teamErr != nil {
					p.API.LogError("Auto Join Channels: failed to add user to team", "username", user.Username, "team_id", channel.TeamId, "error", teamErr.Error())
					continue
				}
			}
		}

		// Verify channel membership
		_, err := p.API.GetChannelMember(channel.Id, user.Id)
		if err != nil {
			// Not a channel member, add them
			p.API.LogInfo("Auto Join Channels: adding user to channel", "username", user.Username, "channel_name", channel.Name)
			_, chanErr := p.API.AddChannelMember(channel.Id, user.Id)
			if chanErr != nil {
				p.API.LogError("Auto Join Channels: failed to add user to channel", "username", user.Username, "channel_name", channel.Name, "error", chanErr.Error())
			}
		}
	}
}
