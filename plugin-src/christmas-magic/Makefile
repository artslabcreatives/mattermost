PLUGIN_ID := com.custom.christmas-magic
VERSION := $(shell python3 -c 'import json; print(json.load(open("plugin.json"))["version"])')
BUNDLE_DIR := dist/$(PLUGIN_ID)
GO ?= go

.PHONY: all server webapp test bundle
all: bundle

server:
	CGO_ENABLED=0 GOOS=linux GOARCH=amd64 $(GO) build -trimpath -ldflags='-s -w' -o server/dist/plugin-linux-amd64 ./server
	CGO_ENABLED=0 GOOS=linux GOARCH=arm64 $(GO) build -trimpath -ldflags='-s -w' -o server/dist/plugin-linux-arm64 ./server

webapp:
	cd webapp && npm ci --no-audit --no-fund && npm run check-types && npm run build

test:
	$(GO) test ./server
	cd webapp && npm run check-types && npm test

bundle: server webapp
	mkdir -p $(BUNDLE_DIR)/server/dist $(BUNDLE_DIR)/webapp/dist $(BUNDLE_DIR)/public
	cp plugin.json $(BUNDLE_DIR)/
	cp server/dist/plugin-linux-amd64 server/dist/plugin-linux-arm64 $(BUNDLE_DIR)/server/dist/
	cp webapp/dist/main.js $(BUNDLE_DIR)/webapp/dist/
	cp public/santa.wav $(BUNDLE_DIR)/public/
	rm -f dist/$(PLUGIN_ID)-*.tar.gz
	tar -czf dist/$(PLUGIN_ID)-$(VERSION).tar.gz -C dist $(PLUGIN_ID)
