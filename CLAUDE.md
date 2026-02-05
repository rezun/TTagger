# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

TTagger is a Chromium Manifest V3 browser extension for organizing Twitch follows with custom tags, starred streamers, and live notifications. Built with vanilla ES modules and Bootstrap CSS—no build step required.

## Development Commands

**Load for development:**
1. Visit `chrome://extensions`, enable Developer Mode
2. Click "Load unpacked" and select this repository root
3. Hit "Reload" after code changes

**Package for release:**
```bash
python3 scripts/package.py --include-docs
# Options: --target chrome|firefox|all (default: all)
```

## Architecture

### Message-Passing Pattern
The background service worker (`background/service-worker.js`) is the central message router. UI surfaces and content scripts communicate via `chrome.runtime.sendMessage()`:
- Messages: `{ type: 'namespace:action', ...payload }`
- Responses: `{ ok: true, data: {...} }` or `{ ok: false, error: '...' }`

### Key Modules
| Module | Purpose |
|--------|---------|
| `background/service-worker.js` | Central message dispatcher, routes 20+ message types |
| `src/background/followCache.js` | Fetches & enriches Twitch follows, manages 5-min cache TTL |
| `src/background/tagState.js` | Tag CRUD & assignment mutations with concurrency control |
| `src/background/liveTracking.js` | Alarm-based live polling, notifications, badge updates |
| `src/background/payload.js` | Assembles dashboard state (auth + follows + tags + prefs) |
| `src/api/twitch.js` | Helix REST wrapper (rate-limit aware) |
| `src/app/state.js` | Dashboard mutable state singleton |
| `src/app/render.js` | Memoized DOM rendering from state |

### Storage Layout
- **Local** (`chrome.storage.local`): OAuth tokens, follow cache, live state, debug logs
- **Sync** (`chrome.storage.sync`): Tag definitions (`tagState`), user preferences—shared across browsers

### Directory Structure
- `src/background/` — state management, caching, live tracking
- `src/api/` — Twitch Helix API wrapper
- `src/util/` — shared helpers (i18n, formatting, sorting, notifications)
- `src/storage/` — typed chrome.storage accessors
- `app/`, `popup/`, `options/` — UI surface controllers
- `content/` — Twitch.tv DOM injection scripts
- `_locales/` — i18n messages (en, de)

## Coding Conventions

- Vanilla ES modules, 2-space indentation, single quotes, trailing commas
- `const`/`let` only (no `var`)
- Named exports for reusable helpers
- Files named by responsibility: `followCache.js`, `tagState.js`
- UI strings in `_locales/<lang>/messages.json` with `data-i18n` HTML attributes
- JSDoc only when behavior is non-obvious

## Testing

No automated tests. Manual QA checklist:
- OAuth: Connect/disconnect Twitch account
- Dashboard: Tag CRUD, assign streamers, reorder tags
- Popup: Live counts, notification toggle, filter by tag
- Twitch overlays: Star button and tag chips on channel pages
- Notifications: Star streamers, verify badge counts and alerts

Inspect storage via DevTools (`chrome.storage.local` / `chrome.storage.sync`). Enable debug logging in options for verbose output.

## Commit Guidelines

Use imperative, present-tense subjects (e.g., "Add memoized live count helpers"). Keep commits focused. For UI changes, include before/after screenshots in PRs.

## Security Notes

- Twitch client ID in `src/config.js` is public (OAuth implicit grant)
- Never log access tokens; debug logging is opt-in
- Redirect URIs must match Twitch Developer Console settings
