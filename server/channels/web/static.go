// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package web

import (
	"bytes"
	"fmt"
	"html"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"

	"github.com/klauspost/compress/gzhttp"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/public/shared/mlog"
	"github.com/mattermost/mattermost/server/v8/channels/utils"
	"github.com/mattermost/mattermost/server/v8/channels/utils/fileutils"
	"github.com/mattermost/mattermost/server/v8/platform/shared/templates"
)

// The site stays fully disallowed for search engines, but the link-preview
// crawlers are allowed to fetch "/" so shared links unfurl with the Open Graph
// tags from getOpenGraphMetaTags. facebookexternalhit and LinkedInBot obey
// robots.txt and would otherwise show no preview at all. They only ever see the
// logged-out shell, and root.html still sends noindex/nofollow.
var robotsTxt = []byte(strings.Join([]string{
	"User-agent: facebookexternalhit",
	"User-agent: facebookcatalog",
	"User-agent: Twitterbot",
	"User-agent: LinkedInBot",
	"User-agent: Slackbot",
	"User-agent: Slackbot-LinkExpanding",
	"User-agent: WhatsApp",
	"User-agent: Discordbot",
	"User-agent: TelegramBot",
	"User-agent: Iframely",
	"User-agent: SkypeUriPreview",
	"Allow: /$",
	"Allow: /static/images/og-image.png",
	"Disallow: /",
	"",
	"User-agent: *",
	"Disallow: /",
	"",
}, "\n"))

func (w *Web) InitStatic() {
	if *w.srv.Config().ServiceSettings.WebserverMode != "disabled" {
		if err := utils.UpdateAssetsSubpathFromConfig(w.srv.Config()); err != nil {
			mlog.Error("Failed to update assets subpath from config", mlog.Err(err))
		}

		staticDir, _ := fileutils.FindDir(model.ClientDir)
		mlog.Debug("Using client directory", mlog.String("clientDir", staticDir))

		subpath, _ := utils.GetSubpathFromConfig(w.srv.Config())

		staticHandler := staticFilesHandler(http.StripPrefix(path.Join(subpath, "static"), http.FileServer(http.Dir(staticDir))))
		pluginHandler := staticFilesHandler(http.StripPrefix(path.Join(subpath, "static", "plugins"), http.FileServer(http.Dir(*w.srv.Config().PluginSettings.ClientDirectory))))

		if *w.srv.Config().ServiceSettings.WebserverMode == "gzip" {
			staticHandler = gzhttp.GzipHandler(staticHandler)
			pluginHandler = gzhttp.GzipHandler(pluginHandler)
		}

		w.MainRouter.PathPrefix("/static/plugins/").Handler(pluginHandler)
		w.MainRouter.PathPrefix("/static/").Handler(staticHandler)
		w.MainRouter.Handle("/robots.txt", http.HandlerFunc(robotsHandler))
		w.MainRouter.Handle("/unsupported_browser.js", http.HandlerFunc(unsupportedBrowserScriptHandler))
		w.MainRouter.Handle("/{anything:.*}", w.NewStaticHandler(root)).Methods(http.MethodGet, http.MethodHead)

		// When a subpath is defined, it's necessary to handle redirects without a
		// trailing slash. We don't want to use StrictSlash on the w.MainRouter and affect
		// all routes, just /subpath -> /subpath/.
		w.MainRouter.HandleFunc("", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			r.URL.Path += "/"
			http.Redirect(w, r, r.URL.String(), http.StatusFound)
		}))
	}
}

func root(c *Context, w http.ResponseWriter, r *http.Request) {
	if !CheckClientCompatibility(r.UserAgent()) {
		w.Header().Set("Cache-Control", "no-store")
		data := renderUnsupportedBrowser(c.AppContext, r)

		err := c.App.Srv().TemplatesContainer().Render(w, "unsupported_browser", data)
		if err != nil {
			c.Logger.Error("Failed to render template", mlog.Err(err))
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		return
	}

	if IsAPICall(c.App, r) {
		Handle404(c.App, w, r)
		return
	}

	w.Header().Set("Cache-Control", "no-cache, max-age=31556926, public")

	staticDir, _ := fileutils.FindDir(model.ClientDir)
	contents, err := os.ReadFile(filepath.Join(staticDir, "root.html"))
	if err != nil {
		c.Logger.Warn("Failed to read content from file",
			mlog.String("file_path", filepath.Join(staticDir, "root.html")),
			mlog.Err(err))
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	titleTemplate := "<title>%s</title>"
	originalHTML := fmt.Sprintf(titleTemplate, html.EscapeString(model.TeamSettingsDefaultSiteName))
	modifiedHTML := getOpenGraphMetaTags(c)
	if originalHTML != modifiedHTML {
		contents = bytes.ReplaceAll(contents, []byte(originalHTML), []byte(modifiedHTML))
	}

	w.Header().Set("Content-Type", "text/html")
	if _, err = w.Write(contents); err != nil {
		c.Logger.Warn("Failed to write content to HTTP reply", mlog.Err(err))
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
}

func staticFilesHandler(handler http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		//wrap our ResponseWriter with our no-cache 404-handler
		w = &notFoundNoCacheResponseWriter{ResponseWriter: w}

		if path.Base(r.URL.Path) == "remote_entry.js" {
			w.Header().Set("Cache-Control", "no-cache, max-age=31556926, public")
		} else {
			w.Header().Set("Cache-Control", "max-age=31556926, public")
		}

		// Hardcoded sensible default values for these security headers. Feel free to override in proxy or ingress
		w.Header().Set("Permissions-Policy", "")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "no-referrer")

		if strings.HasSuffix(r.URL.Path, "/") {
			http.NotFound(w, r)
			return
		}

		handler.ServeHTTP(w, r)
	})
}

type notFoundNoCacheResponseWriter struct {
	http.ResponseWriter
}

func (w *notFoundNoCacheResponseWriter) WriteHeader(statusCode int) {
	if statusCode == http.StatusNotFound {
		// we have a 404, update our cache header first then fall through
		w.Header().Set("Cache-Control", "no-cache, public")
	}
	w.ResponseWriter.WriteHeader(statusCode)
}

func robotsHandler(w http.ResponseWriter, r *http.Request) {
	if strings.HasSuffix(r.URL.Path, "/") {
		http.NotFound(w, r)
		return
	}
	if _, err := w.Write(robotsTxt); err != nil {
		mlog.Warn("Failed to write robots.txt", mlog.Err(err))
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
}

func unsupportedBrowserScriptHandler(w http.ResponseWriter, r *http.Request) {
	if strings.HasSuffix(r.URL.Path, "/") {
		http.NotFound(w, r)
		return
	}

	templatesDir, _ := templates.GetTemplateDirectory()
	http.ServeFile(w, r, filepath.Join(templatesDir, "unsupported_browser.js"))
}

// Branding for link previews (Open Graph / Twitter cards) is kept separate from
// TeamSettings.SiteName on purpose: SiteName also drives the browser tab, the
// login page and notification emails, and we want those to keep saying "Aura"
// while shared links unfurl under the organisation name. Override with the
// ARTSLAB_OG_* environment variables; leave them unset to fall back to SiteName.
const (
	defaultOGTitle       = "Artslab Internal Communicate"
	defaultOGDescription = "Secure team messaging, files and collaboration — all in one place."
	defaultOGImage       = "/static/images/og-image.png"
	defaultOGImageAlt    = "Artslab Internal Communicate"
)

func envOr(key, fallback string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return fallback
}

func getOpenGraphMetaTags(c *Context) string {
	siteName := model.TeamSettingsDefaultSiteName
	customSiteName := c.App.Srv().Config().TeamSettings.SiteName
	if customSiteName != nil && *customSiteName != "" {
		siteName = *customSiteName
	}

	siteDescription := model.TeamSettingsDefaultCustomDescriptionText
	customSiteDescription := c.App.Srv().Config().TeamSettings.CustomDescriptionText
	if customSiteDescription != nil && *customSiteDescription != "" {
		siteDescription = *customSiteDescription
	}

	// The browser tab keeps using SiteName; only the preview cards get the
	// organisation-level branding.
	ogTitle := envOr("ARTSLAB_OG_TITLE", defaultOGTitle)
	if ogTitle == "" {
		ogTitle = siteName
	}

	ogDescription := envOr("ARTSLAB_OG_DESCRIPTION", defaultOGDescription)
	if ogDescription == "" {
		ogDescription = siteDescription
	}

	// Crawlers require absolute URLs for og:url and og:image, so anchor both to
	// SiteURL. Without a SiteURL we simply omit them rather than emit a relative
	// value that every scraper would reject.
	siteURL := ""
	if u := c.App.Srv().Config().ServiceSettings.SiteURL; u != nil {
		siteURL = strings.TrimRight(*u, "/")
	}

	ogImage := envOr("ARTSLAB_OG_IMAGE", defaultOGImage)
	if !strings.HasPrefix(ogImage, "http://") && !strings.HasPrefix(ogImage, "https://") {
		if siteURL == "" {
			ogImage = ""
		} else {
			ogImage = siteURL + "/" + strings.TrimLeft(ogImage, "/")
		}
	}

	var b strings.Builder

	fmt.Fprintf(&b, "<title>%s</title>", html.EscapeString(siteName))
	fmt.Fprintf(&b, `<meta name="description" content="%s" />`, html.EscapeString(ogDescription))

	fmt.Fprint(&b, `<meta property="og:type" content="website" />`)
	fmt.Fprintf(&b, `<meta property="og:site_name" content="%s" />`, html.EscapeString(siteName))
	fmt.Fprintf(&b, `<meta property="og:title" content="%s" />`, html.EscapeString(ogTitle))
	if ogDescription != "" {
		fmt.Fprintf(&b, `<meta property="og:description" content="%s" />`, html.EscapeString(ogDescription))
	}
	if siteURL != "" {
		fmt.Fprintf(&b, `<meta property="og:url" content="%s" />`, html.EscapeString(siteURL))
	}
	fmt.Fprint(&b, `<meta property="og:locale" content="en_US" />`)

	twitterCard := "summary"
	if ogImage != "" {
		twitterCard = "summary_large_image"

		fmt.Fprintf(&b, `<meta property="og:image" content="%s" />`, html.EscapeString(ogImage))
		fmt.Fprintf(&b, `<meta property="og:image:secure_url" content="%s" />`, html.EscapeString(ogImage))
		fmt.Fprint(&b, `<meta property="og:image:type" content="image/png" />`)
		fmt.Fprint(&b, `<meta property="og:image:width" content="1200" />`)
		fmt.Fprint(&b, `<meta property="og:image:height" content="630" />`)
		fmt.Fprintf(&b, `<meta property="og:image:alt" content="%s" />`,
			html.EscapeString(envOr("ARTSLAB_OG_IMAGE_ALT", defaultOGImageAlt)))
	}

	fmt.Fprintf(&b, `<meta name="twitter:card" content="%s" />`, twitterCard)
	fmt.Fprintf(&b, `<meta name="twitter:title" content="%s" />`, html.EscapeString(ogTitle))
	if ogDescription != "" {
		fmt.Fprintf(&b, `<meta name="twitter:description" content="%s" />`, html.EscapeString(ogDescription))
	}
	if ogImage != "" {
		fmt.Fprintf(&b, `<meta name="twitter:image" content="%s" />`, html.EscapeString(ogImage))
		fmt.Fprintf(&b, `<meta name="twitter:image:alt" content="%s" />`,
			html.EscapeString(envOr("ARTSLAB_OG_IMAGE_ALT", defaultOGImageAlt)))
	}

	// Tints mobile browser chrome to match the preview image. root.html already
	// carries application-name, so it is deliberately not repeated here.
	fmt.Fprint(&b, `<meta name="theme-color" content="#111A33" />`)

	return b.String()
}
