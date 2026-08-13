PLUGIN_ID := com.artslabcreatives.poll
BUNDLE_DIR := dist/$(PLUGIN_ID)
GO ?= go

.PHONY: all
all: bundle

.PHONY: server
server:
	CGO_ENABLED=0 GOOS=linux GOARCH=amd64 $(GO) build -trimpath -o server/dist/plugin-linux-amd64 ./server
	CGO_ENABLED=0 GOOS=linux GOARCH=arm64 $(GO) build -trimpath -o server/dist/plugin-linux-arm64 ./server

.PHONY: webapp
webapp:
	cd webapp && npm install --no-audit --no-fund && npm run build

.PHONY: bundle
bundle: server webapp
	rm -rf dist
	mkdir -p $(BUNDLE_DIR)
	cp plugin.json $(BUNDLE_DIR)/
	mkdir -p $(BUNDLE_DIR)/public
	mkdir -p $(BUNDLE_DIR)/server/dist $(BUNDLE_DIR)/webapp/dist
	cp server/dist/plugin-linux-* $(BUNDLE_DIR)/server/dist/
	cp webapp/dist/main.js $(BUNDLE_DIR)/webapp/dist/
	cd dist && tar -czf $(PLUGIN_ID).tar.gz $(PLUGIN_ID)
	@echo "Built dist/$(PLUGIN_ID).tar.gz"

.PHONY: clean
clean:
	rm -rf dist server/dist webapp/dist webapp/node_modules
