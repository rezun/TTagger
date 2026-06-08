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

export const MAX_TAG_ABBREVIATION_LENGTH = 3;

/**
 * Validate tag abbreviation
 * Tag abbreviations should be 1-3 compact display characters.
 * @param {string} abbreviation - Abbreviation to validate
 * @returns {boolean} True if valid, false otherwise
 */
export function isValidTagAbbreviation(abbreviation) {
  if (typeof abbreviation !== 'string') return false;
  const chars = Array.from(abbreviation);
  if (chars.length === 0 || chars.length > MAX_TAG_ABBREVIATION_LENGTH) return false;
  if (/<[^>]*>/g.test(abbreviation)) return false;
  if (/\s/.test(abbreviation)) return false;
  return /^[\p{L}\p{N}+#&-]+$/u.test(abbreviation);
}

/**
 * Sanitize a tag abbreviation for badge display.
 * @param {string} abbreviation - Abbreviation to sanitize
 * @returns {string} Sanitized abbreviation
 */
export function sanitizeTagAbbreviation(abbreviation) {
  if (typeof abbreviation !== 'string') return '';
  const withoutHtml = abbreviation.replace(/<[^>]*>/g, '');
  const compact = withoutHtml.replace(/\s+/g, '').trim().toLocaleUpperCase();
  return Array.from(compact).slice(0, MAX_TAG_ABBREVIATION_LENGTH).join('');
}

function abbreviationCandidatesFromName(name) {
  const source = sanitizeTagName(name);
  if (!source) return [];

  const words = source
    .split(/[\s_-]+/)
    .map((word) => word.replace(/[^\p{L}\p{N}+#&-]/gu, ''))
    .filter(Boolean);

  const initials = words.map((word) => Array.from(word)[0]).join('');
  const compact = words.join('');
  const compactChars = Array.from(compact);
  const candidates = [];

  const lastWord = words[words.length - 1] || '';
  if (words.length > 1 && /^\d+$/u.test(lastWord)) {
    const stemInitials = words
      .slice(0, -1)
      .map((word) => Array.from(word)[0])
      .join('');
    const numberChars = Array.from(lastWord);
    const suffix = numberChars.slice(-Math.max(1, MAX_TAG_ABBREVIATION_LENGTH - 1)).join('');
    const prefixLength = Math.max(1, MAX_TAG_ABBREVIATION_LENGTH - Array.from(suffix).length);
    candidates.push(`${Array.from(stemInitials).slice(0, prefixLength).join('')}${suffix}`);
  }

  const trailingNumber = compact.match(/^(.*?)(\d+)$/u);
  if (trailingNumber && trailingNumber[1]) {
    const stemChars = Array.from(trailingNumber[1]);
    const numberChars = Array.from(trailingNumber[2]);
    const suffix = numberChars.slice(-Math.max(1, MAX_TAG_ABBREVIATION_LENGTH - 1)).join('');
    const prefixLength = Math.max(1, MAX_TAG_ABBREVIATION_LENGTH - Array.from(suffix).length);
    candidates.push(`${stemChars.slice(0, prefixLength).join('')}${suffix}`);
  }

  if (words.length > 1) {
    candidates.push(Array.from(initials).slice(0, MAX_TAG_ABBREVIATION_LENGTH).join(''));
  }

  candidates.push(compactChars.slice(0, Math.min(2, MAX_TAG_ABBREVIATION_LENGTH)).join(''));

  if (compactChars.length === 1) {
    candidates.push(compactChars[0]);
  }

  return Array.from(
    new Set(
      candidates
        .map(sanitizeTagAbbreviation)
        .filter(isValidTagAbbreviation),
    ),
  );
}

/**
 * Generate a valid abbreviation from a tag name, avoiding existing values when possible.
 * @param {string} name - Tag name
 * @param {Iterable<string>} existingAbbreviations - Abbreviations already in use
 * @returns {string} Generated abbreviation
 */
export function generateTagAbbreviation(name, existingAbbreviations = []) {
  const used = new Set(
    Array.from(existingAbbreviations || [])
      .map(sanitizeTagAbbreviation)
      .filter(isValidTagAbbreviation),
  );

  const candidates = abbreviationCandidatesFromName(name);
  const available = candidates.find((candidate) => !used.has(candidate));
  if (available) return available;

  const base = candidates[0] || 'T';
  const baseChars = Array.from(base);
  const fallbackStem = base.replace(/\d+$/u, '') || base;
  const fallbackStemChars = Array.from(fallbackStem);

  for (let index = 2; index <= 99; index += 1) {
    const suffix = String(index);
    const prefixLength = Math.max(1, MAX_TAG_ABBREVIATION_LENGTH - suffix.length);
    const prefix = fallbackStemChars.slice(0, prefixLength).join('')
      || baseChars.slice(0, prefixLength).join('');
    const candidate = sanitizeTagAbbreviation(`${prefix}${index}`);
    if (isValidTagAbbreviation(candidate) && !used.has(candidate)) {
      return candidate;
    }
  }

  return base;
}
