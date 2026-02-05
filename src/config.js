/**
 * Twitch OAuth Client ID
 *
 * SECURITY NOTE: This client ID is intentionally committed to source control.
 * It is designed for OAuth 2.0 Implicit Grant Flow (public client pattern).
 *
 * Public clients (browser extensions, mobile apps, SPAs) cannot securely store
 * client secrets. The implicit flow relies on redirect URI validation and
 * short-lived tokens for security.
 *
 * ⚠️ NEVER add a client secret to this codebase ⚠️
 *
 * Security measures in place:
 * - OAuth state parameter prevents CSRF attacks
 * - Redirect URI must be registered in Twitch Developer Console
 * - Access tokens are short-lived and stored only in browser local storage
 * - Scopes are limited to minimum required permissions
 *
 * For more information, see:
 * https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/#implicit-grant-flow
 */
export const TWITCH_CLIENT_ID = 'a9j7abksc8ccs0ujeimo5q2w7dnkrk';

/**
 * OAuth scopes requested from Twitch
 * - user:read:follows: Required to read the user's followed channels
 */
export const TWITCH_SCOPES = ['user:read:follows'];
export const FOLLOW_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
export const DASHBOARD_REFRESH_INTERVAL_MS = 1 * 60 * 1000; // 1 minute
export const TAG_COLOR_POOL = [
  '#6f42c1', // purple
  '#22c55e', // emerald
  '#ff6f61', // coral
  '#f97316', // orange
  '#facc15', // goldenrod
  '#2563eb', // blue
  '#14b8a6', // teal
  '#0ea5e9', // sky blue
  '#ec4899', // pink
  '#ef4444', // red
  '#65a30d', // olive
  '#4b5563', // slate
];
