PLUGIN_ID := com.artslabcreatives.autojoin
BUNDLE_DIR := dist/$(PLUGIN_ID)
GO ?= go

.PHONY: all
all: bundle

.PHONY: server
server:
	CGO_ENABLED=0 GOOS=linux GOARCH=amd64 $(GO) build -trimpath -o server/dist/plugin-linux-amd64 ./server
	CGO_ENABLED=0 GOOS=linux GOARCH=arm64 $(GO) build -trimpath -o server/dist/plugin-linux-arm64 ./server

.PHONY: bundle
bundle: server
	rm -rf dist
	mkdir -p $(BUNDLE_DIR)
	cp plugin.json $(BUNDLE_DIR)/
	cp -r public $(BUNDLE_DIR)/
	mkdir -p $(BUNDLE_DIR)/server/dist
	cp server/dist/plugin-linux-* $(BUNDLE_DIR)/server/dist/
	cd dist && tar -czf $(PLUGIN_ID).tar.gz $(PLUGIN_ID)
	@echo "Built dist/$(PLUGIN_ID).tar.gz"

.PHONY: clean
clean:
	rm -rf dist server/dist
