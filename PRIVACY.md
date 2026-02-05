# Privacy Policy

Last updated: March 6, 2025

TTagger (“extension”, “we”, “our”) is a personal browser extension that you install in your Chromium-based browser. This document explains what information the extension can access, how it is used, and the controls you have.

## Data We Access

When you choose to connect your Twitch account, the extension receives:

- Twitch OAuth access token (short-lived)
- Twitch user profile basics (ID, login, display name, profile image URL)
- List of channels you follow on Twitch

You may also create data inside the extension:

- Custom tags, tag colors, and tag assignments
- Tag sorting and filter preferences
- Notification, language, and UI settings
- “Last seen live” timestamps for followed channels
- Update log entries (timestamped results of live-check runs) when debug logging is enabled

## How We Use Information

All accessed data is used exclusively to provide the extension’s features:

- Build the dashboard and popup views of your followed channels
- Let you assign personal tags to channels and filter them quickly
- Show Twitch streamer overlays (tags and star status) while you browse twitch.tv
- Send optional browser notifications when starred streamers go live
- Maintain cached data for faster loading and to avoid rate-limiting

The extension does **not** sell, rent, or share your data with third parties. It does not include analytics, advertising, or tracking libraries.

## Storage and Retention

- OAuth tokens, follow cache, live-state, popup snapshots, and update logs are stored in `chrome.storage.local` (per device).
- Tags, tag assignments, and UI preferences are stored in `chrome.storage.sync` (synced across Chrome profiles where you install the extension).
- Cached Twitch data is refreshed on demand or automatically every few minutes; old snapshots are overwritten.
- Debug logs are capped at the most recent 300 entries and can be cleared at any time.

No data leaves your browser except for direct calls to Twitch’s official APIs that you authorize.

## User Controls

- **Disconnect Twitch:** Options page → “Disconnect Twitch” clears tokens, cache, and live tracking state.
- **Reset data:** Options page → “Reset data” removes tags, assignments, and preferences.
- **Clear update log:** Options page → “Clear log” wipes debug entries.
- **Disable notifications or overlays:** Options page toggles let you turn features off.
- **Remove extension:** Uninstalling the extension from Chrome clears all stored data automatically.

## Security Practices

- Tokens are stored using Chrome’s extension storage APIs and are never written to external services.
- Twitch access uses HTTPS and Twitch’s recommended implicit grant flow.
- Sensitive errors are sanitized before being shown to users; optional debug logging can be disabled at any time.

## Children’s Privacy

The extension is designed for general audiences and does not target or knowingly collect information from children under 13.

## Changes to This Policy

If this policy changes, we will update the “Last updated” date and describe the changes in the project README or release notes. Continued use of the extension after updates constitutes acceptance of the revised policy.

## Contact

Questions or concerns? Email Steve Schmidt at apps@steve-dev.de.
