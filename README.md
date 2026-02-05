# TTagger

Full disclosure: This extension was developed using AI.
It uses bootstrap and vanilla JS, because I haven't used any JS framework before and I don't want to create code that I can't fully understand or maintain myself.

## What TTagger Does
TTagger is a browser extension for Chromium-based browsers and Firefox that helps you organize the chaos of a long "Following" list. It lets you add personal tags to the streamers you follow, or star your favorite streamers and notify you when they go live.
With either the quick-access popup or the full-featured dashboard, you can select a tag and see which streamers with that label are live right now.

## Key Things You Can Do
- Create custom color-coded tags and drag them into whatever order makes sense.
- Filter and sort your follow list by name, content, follow date, live status, or star priority.
- Star essential streamers and get optional browser notifications when they start streaming.
- Assign and edit tags right from Twitch streamer pages without leaving the site.
- Switch between light/dark/system themes and localize the UI (English and German available today).
- Export your tag setup to back it up, share it, or move it to another browser profile.

## Where You’ll Use It
- **Dashboard (`app/app.html`)** – the full management surface with filters, tag management, live prioritization, and at-a-glance activity details.
- **Browser action popup (`popup/popup.html`)** – a compact quick-launch view showing starred streamers, live counts per tag, notification toggle, and recent activity.
- **Twitch.tv overlays (`content/*.js`)** – injects a tag drawer and star toggle directly into streamer pages so you can label channels in the context you discover them.
- **Options page (`options/options.html`)** – manage notifications, “open in current tab” behavior, Twitch highlighting, language, debug logging, and import/export/reset workflows.

## Getting Started

### Chromium (Chrome, Edge, Brave, etc.)
1. Open `chrome://extensions` (or the equivalent in Edge/Brave), enable Developer Mode, choose "Load unpacked...", and select this project root. There's no build step or dependency install.
2. **Connect Twitch:** open the dashboard or popup and click "Connect Twitch" to authorize. The extension only requests `user:read:follows`.
3. **Create your first tag:** use the "Add Tag" button in the dashboard; choose a name, then assign it to streamers from the grid, popup, or Twitch page overlay.

### Firefox
1. Navigate to `about:debugging#/runtime/this-firefox`, click "Load Temporary Add-on...", and select the `manifest.json` file from this project root.
2. The OAuth redirect URL for Firefox differs from Chromium. You must register the Firefox redirect URL in the [Twitch Developer Console](https://dev.twitch.tv/console/apps) alongside the Chromium one. To find it, inspect the extension's background script console and run `chrome.identity.getRedirectURL('oauth')`.
3. Temporary add-ons are removed when Firefox closes. For persistent development, use Firefox Developer Edition or Nightly with `xpinstall.signatures.required` set to `false` in `about:config`.

## Privacy & Safety
- Your Twitch token, follow cache, and live-tracking state stay inside browser storage; nothing is sent to third-party servers beyond Twitch’s official API.
- Tag definitions and preferences sync (via `chrome.storage.sync`) across browsers where you install the extension with the same account.
- Live notifications are optional and respect your “open in current tab” preference; you can switch them off anytime in the popup or options page.
- Debug logs and manual exports are stored locally so you’re in control of what leaves your machine.

---

## Technical Overview

### High-Level Architecture
- `manifest.json` wires together the action popup, dashboard, options page, background service worker, and Twitch content scripts. It requests `storage`, `identity`, `tabs`, `notifications`, and `alarms`.
- `background/service-worker.js` is the central message router. It coordinates OAuth (`background/oauth.js`), follow caching (`src/background/followCache.js`), tag state mutations (`src/background/tagState.js`), import/export, preference updates, and live-tracking alarms.
- UI surfaces (dashboard, popup, options) are vanilla ES modules that import shared logic from `src/`. Each surface bootstraps localization via `src/util/i18n.js` before rendering.
- Content scripts under `content/` hydrate Twitch pages with tag displays, star toggles, and context menus by reading shared state from extension storage and reacting to updates.

### Data Flow & Runtime Responsibilities
1. **Authentication:** `background/oauth.js` implements the Twitch implicit grant, stores access tokens in `chrome.storage.local`, and exposes status through runtime messaging.
2. **Follow cache:** `src/background/followCache.js` batches Helix calls (`src/api/twitch.js`) to build an enriched follow snapshot (profile, stream metadata, last-seen timestamps). The cache refreshes on demand and every five minutes (`FOLLOW_CACHE_TTL_MS`).
3. **Dashboard payload:** `src/background/payload.js` merges auth, cached follows, tag state, and preferences into a single response for the dashboard and popup.
4. **Tag management:** `src/background/tagState.js` owns tag CRUD, order changes, and streamer assignments. Normalized state is shared with all surfaces and content scripts.
5. **Live tracking & notifications:** `src/background/liveTracking.js` schedules alarms, updates the action badge, pushes optional notifications via `src/util/notifications.js`, and records update metadata for inspection in the options page.
6. **UI rendering:** Dashboard state lives in `src/app/state.js`; `src/app/render.js` memoizes derived data (filters, counts) and produces DOM nodes via helpers in `src/util/components.js`. Popup and options follow a similar pattern with leaner state.

### Storage Layout
- **Local storage (`chrome.storage.local`):** OAuth tokens (`authState`), cached follows (`followCache`), popup snapshots, live-state, update log, and “last seen live” timestamps.
- **Sync storage (`chrome.storage.sync`):** tag definitions (`tagState`) and user preferences (`preferences`), including language overrides, notification toggle, “open in current tab”, and Twitch highlighting setting.
- Storage quota awareness lives in `src/util/storageQuota.js`, which preflights sync writes and returns cleanup suggestions when limits are approached.

### Directory Guide
- `src/api/` – Helix REST helpers (rate-limit aware).
- `src/background/` – cache building, tag state, import/export, live tracking, payload assembly.
- `src/storage/` – typed accessors for extension storage (local + sync).
- `src/ui/` – shared UI primitives (modals, toasts, icons) reused across surfaces.
- `src/util/` – cross-cutting helpers (formatting, i18n, notifications, sorting, constants, extension shims).
- `app/`, `popup/`, `options/` – respective HTML entry points plus their controllers.
- `content/` – Twitch DOM integration scripts and CSS.
- `assets/`, `styles/` – icon set, Bootstrap bundle, and extension-specific styling.
- `_locales/` – localization bundles (English default, German translation maintained in parallel).

### Localization & Accessibility
- Messages are registered under `_locales/<lang>/messages.json`; helpers in `src/util/i18n.js` provide fallbacks and runtime switching.
- UI strings use `data-i18n` attributes in HTML templates; dynamic text resolves through `getMessageStrict`.
- Keyboard and screen-reader affordances (ARIA attributes, focus management) live in the render modules to keep surfaces accessible.

### Development Workflow
1. No build tooling or package install is required—the extension runs directly from source in Chromium and Firefox.
2. Load the project via the Chromium extension loader or Firefox's `about:debugging` for local testing; keep the extension reloaded while iterating.
3. When you're ready to ship, run `python3 scripts/package.py` to produce browser-specific zips in `dist/`. Use `--target chrome` or `--target firefox` to build just one.

### Manual QA Checklist
- **OAuth handshake:** Connect and disconnect a Twitch account; confirm follow cache refreshes afterwards.
- **Dashboard tag CRUD:** Create, rename, recolor, reorder, and delete tags; ensure assignments propagate to popup and Twitch overlays.
- **Popup quick assign:** Toggle notifications, filter by tag, check live counts, and launch streamers with each “open in current tab” mode.
- **Twitch overlays:** Verify tag chips render on streamer pages, update live when assignments change, and clean up when navigating around Twitch.
- **Live notifications:** Star streamers, confirm badge counts and desktop notifications, then stop them by disabling notifications.

### Permission Rationale
- `storage`: save OAuth tokens, cached follows, tags, and preferences in Chrome’s local/sync storage so your setup persists across sessions.
- `identity`: start the Twitch OAuth flow through Chrome identity APIs so you can sign in without embedding secrets.
- `tabs`: open Twitch streams (and optionally reuse an existing tab) when you click a live notification or dashboard action.
- `notifications`: show browser alerts when starred streamers start streaming.
- `alarms`: schedule background refreshes that keep live status, badges, and notifications current.
- `https://id.twitch.tv/*`, `https://api.twitch.tv/*`, `*://www.twitch.tv/*`: call Twitch’s OAuth and Helix APIs, and inject the tag UI only on twitch.tv pages.

### Security Notes
- Twitch client ID lives in `src/config.js`; no secrets are bundled. Redirect URIs must stay in sync with your Twitch Developer settings (`docs/auth.md` covers rotations).
- Error handlers sanitize messages before presenting them to users, and debug logging is opt-in to prevent leaking sensitive session data.
