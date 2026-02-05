# Chrome Web Store Data Safety Answers

Use this reference when completing the Chrome Web Store Data Safety questionnaire for TTagger. The responses explain what user data is collected, how it is handled, and why.

## Data Collection & Sharing

- **Does the extension collect or transmit user data?** Yes, but only via direct requests to Twitch that the user initiates (user profile, follow list) and only to render extension features. No data is sent to developer-owned servers.
- **Is any data shared with third parties?** No. Twitch data stays within the user’s browser storage.

## Data Types and Usage

| Data Category | Examples | Purpose | Shared? | Stored? | Notes |
| ------------- | -------- | ------- | ------- | ------- | ----- |
| Account info | Twitch ID, login, display name, avatar URL | Core app functionality (show who is signed in, label streamers) | No | Yes (local storage) | Fetched after user authorizes Twitch OAuth. |
| App activity | Followed channels, live status, last seen live timestamps | Core app functionality (dashboard, popup, notifications) | No | Yes (local storage) | Cached to reduce API calls and power live notifications. |
| User-generated content | Tags, tag colors, tag assignments, starred streamers | Core app functionality (organizing streamers) | No | Yes (sync storage) | Sync storage lets preferences and tags follow the user to other Chrome profiles. |
| App settings | Filters, theme, language, notification preference, debug logging flag | Core app functionality | No | Yes (sync storage) | Needed to keep the UI consistent between sessions. |
| Diagnostics (optional) | Update log entries (timestamp, trigger, count) | Developer communications / diagnostic | No | Yes (local storage) | Only recorded if debug logging is enabled; user can clear at any time. |

No location, payment, contacts, or personally sensitive categories are accessed.

## Data Handling Details

- **On-device processing:** All data is processed inside the browser.
- **Encryption in transit:** Requests to Twitch use HTTPS.
- **Encryption at rest:** Chrome manages encryption of extension storage tied to the user’s Google account.
- **Retention:** Cached data overwrites itself on refresh; logs capped at 300 entries. Users can delete all data via the options page or by uninstalling the extension.
- **User choice:** Connecting Twitch, enabling notifications, and activating debug logging are all opt-in. Users can revoke access and clear stored data inside the extension.

## Why Data is Required

The extension cannot function without the Twitch follow list and basic profile information; they are mandatory for the dashboard, popup, tag assignments, and live notifications.

## Contact and Documentation

- **Privacy policy URL:** link to `PRIVACY.md` in the public GitHub repository.
- **Support contact:** apps@steve-dev.de (also listed in the Chrome Web Store form).

Keep this document updated if new features introduce different data handling.
