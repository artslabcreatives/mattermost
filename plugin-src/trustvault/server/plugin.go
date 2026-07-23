package main

import (
	"sync"

	"github.com/mattermost/mattermost/server/public/plugin"
)

type Plugin struct {
	plugin.MattermostPlugin

	configurationLock sync.RWMutex
	configuration     *configuration
}

type configuration struct{}

func (p *Plugin) OnActivate() error {
	return nil
}
