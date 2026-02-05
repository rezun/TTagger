/**
 * Validation utilities for user input and data from external sources
 */

/**
 * Validate Twitch username format
 * Twitch usernames must be 3-25 characters long and contain only alphanumeric characters and underscores
 * @param {string} username - Username to validate
 * @returns {boolean} True if valid, false otherwise
 */
export function isValidTwitchUsername(username) {
  if (typeof username !== 'string') return false;
  return /^[a-zA-Z0-9_]{3,25}$/.test(username);
}

/**
 * Validate and sanitize a Twitch username for use in URLs or display
 * @param {string} username - Username to validate
 * @returns {string|null} The username if valid, null otherwise
 */
export function sanitizeTwitchUsername(username) {
  if (!isValidTwitchUsername(username)) {
    return null;
  }
  return username;
}

/**
 * Validate hex color code format
 * @param {string} color - Color code to validate (e.g., "#FF0000" or "FF0000")
 * @returns {boolean} True if valid hex color, false otherwise
 */
export function isValidHexColor(color) {
  if (typeof color !== 'string') return false;
  return /^#?[0-9A-Fa-f]{6}$/.test(color);
}

/**
 * Validate tag name
 * Tag names should be 1-50 characters and not contain HTML tags
 * @param {string} name - Tag name to validate
 * @returns {boolean} True if valid, false otherwise
 */
export function isValidTagName(name) {
  if (typeof name !== 'string') return false;
  if (name.length === 0 || name.length > 50) return false;
  // Reject strings that contain HTML tags
  if (/<[^>]*>/g.test(name)) return false;
  return true;
}

/**
 * Sanitize tag name by removing HTML tags and limiting length
 * @param {string} name - Tag name to sanitize
 * @returns {string} Sanitized tag name
 */
export function sanitizeTagName(name) {
  if (typeof name !== 'string') return '';
  // Remove HTML tags
  const withoutHtml = name.replace(/<[^>]*>/g, '');
  // Trim and limit length
  return withoutHtml.trim().slice(0, 50);
}
