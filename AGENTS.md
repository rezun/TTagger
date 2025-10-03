# Repository Guidelines

## Project Structure & Module Organization
TTagger ships as a Chromium Manifest V3 extension. `manifest.json` wires the background service worker, UI surfaces, and content scripts. Keep feature logic in `src/`: `src/background/` owns state, caching, live tracking, and messaging; `src/api/` wraps Twitch Helix; `src/util/`, `src/ui/`, and `src/storage/` host shared helpers. Surface controllers live under `app/`, `popup/`, and `options/`, Twitch overlays reside in `content/`, assets and themes stay in `assets/` and `styles/`, and locales are stored in `_locales/<lang>/messages.json`.

## Build, Test, and Development Commands
The extension runs unpacked—no package install required. For local testing, visit `chrome://extensions`, enable Developer Mode, choose **Load unpacked**, and point to this repository root; hit **Reload** after edits. Package a release build with `scripts/package.sh --include-docs`, or run `zip -r dist/ttagger.zip manifest.json app popup options background src content assets styles _locales`.

## Coding Style & Naming Conventions
Stick to the existing vanilla ES module style: 2-space indentation, single quotes, trailing commas in multi-line literals, and `const`/`let` instead of `var`. Export reusable helpers via named exports, keep files aligned with their responsibility (`followCache.js`, `tagState.js`), and route shared logic through `src/util/`, `src/ui/`, or `src/storage/`. Use JSDoc when behavior is subtle and add UI strings through `_locales` with matching `data-i18n` hooks.

## Testing Guidelines
No automated tests exist, so follow the README checklist: authenticate via the popup, exercise dashboard tag CRUD, confirm popup live counts, validate Twitch overlays, and test notification flows. Inspect `chrome.storage` through DevTools, toggle debug logging before verbose output, and capture notes or gifs in pull requests so reviewers can see coverage.

## Commit & Pull Request Guidelines
Git history is sparse; use imperative, present-tense subjects (e.g., `Add memoized live count helpers`). Keep commits focused, describe user-impacting changes in the body, and mention migrations up front. Pull requests should summarize intent, list manual checks, state whether `scripts/package.sh` ran, link related issues, and attach before/after screenshots or recordings for UI updates.

## Security & Configuration Tips
Never hard-code secrets. The Twitch client ID in `src/config.js` must match the developer portal; rotate credentials by updating both. When testing OAuth flows, verify redirect URIs and avoid logging access tokens. Keep packaged artifacts in `dist/` and review them before distributing to ensure no private data is bundled.
