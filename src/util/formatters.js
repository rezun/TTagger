import { getMessageStrict } from './i18n.js';

export function formatUptime(startedAt, prefix = '') {
  if (!startedAt) return null;
  const startMs = Date.parse(startedAt);
  if (Number.isNaN(startMs)) return null;
  const diff = Date.now() - startMs;
  if (diff < 0) return null;

  const totalMinutes = Math.floor(diff / 60000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) {
    return `${prefix}${days}d${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
  }

  return `${prefix}${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
}

export function formatLastSeenLive(timestamp) {
  if (!timestamp) return null;
  const diff = Date.now() - timestamp;
  if (diff < 0) return null;

  const totalMinutes = Math.floor(diff / 60000);
  if (totalMinutes < 1) {
    return getMessageStrict('app_last_seen_just_now');
  }
  if (totalMinutes < 60) {
    const minutesText = String(totalMinutes);
    return getMessageStrict('app_last_seen_minutes', [minutesText]);
  }

  const hours = Math.floor(totalMinutes / 60);
  if (hours < 24) {
    const hoursText = String(hours);
    return getMessageStrict('app_last_seen_hours', [hoursText]);
  }

  const days = Math.floor(hours / 24);
  if (days < 7) {
    const daysText = String(days);
    return getMessageStrict('app_last_seen_days', [daysText]);
  }

  // For longer periods, show the actual date
  const date = new Date(timestamp);
  return date.toLocaleDateString();
}

export function formatViewerCount(count) {
  if (count == null) return null;
  if (count < 1000) return count.toString();
  if (count < 1000000) return `${(count / 1000).toFixed(1).replace(/\.0$/, '')}K`;
  return `${(count / 1000000).toFixed(1).replace(/\.0$/, '')}M`;
}

export function appendMetaSegment(container, element, separatorClass = 'streamer-meta-separator') {
  if (!container || !element) return;
  if (container.childElementCount) {
    const separator = document.createElement('span');
    separator.className = separatorClass;
    separator.textContent = '•';
    container.appendChild(separator);
  }
  container.appendChild(element);
}

/**
 * Normalize and validate a hex color value
 * @param {string} color - Color to normalize (with or without #)
 * @param {Object} options - Configuration options
 * @param {string} options.defaultColor - Fallback color if invalid (default: '#6f42c1')
 * @param {boolean} options.strict - If true, throw error on invalid color; if false, return default
 * @returns {string|null} - Normalized color (#rrggbb lowercase) or null if strict and empty
 * @throws {Error} - If strict mode and color is invalid (not empty)
 */
export function normalizeTagColor(color, options = {}) {
  const { defaultColor = '#6f42c1', strict = false } = options;

  if (typeof color !== 'string') {
    if (strict) {
      return null;
    }
    return defaultColor;
  }

  const trimmed = color.trim();
  if (!trimmed) {
    return strict ? null : defaultColor;
  }

  const match = trimmed.match(/^#?([0-9a-fA-F]{6})$/);
  if (!match) {
    if (strict) {
      throw new Error('Tag color must be a 6-digit hex value.');
    }
    return defaultColor;
  }

  return `#${match[1].toLowerCase()}`;
}

/**
 * Resolve a tag color to a valid hex value with fallback
 * @param {string} color - Color to resolve
 * @param {string} defaultColor - Fallback color (default: '#6f42c1')
 * @returns {string} - Valid hex color
 * @deprecated Use normalizeTagColor with strict: false instead
 */
export function resolveTagColor(color, defaultColor = '#6f42c1') {
  return normalizeTagColor(color, { defaultColor, strict: false });
}

/**
 * Determine whether light or dark text will have better contrast on a background color.
 * @param {string} color - Background color in hex format
 * @param {Object} options - Configuration options
 * @param {string} options.light - Text color to use on dark backgrounds (default '#ffffff')
 * @param {string} options.dark - Text color to use on light backgrounds (default '#000000')
 * @param {number} options.threshold - Luminance threshold between 0-1 (default 0.57)
 * @returns {string} - Hex color string for text
 */
export function getContrastingTextColor(color, { light = '#ffffff', dark = '#000000', threshold = 0.57 } = {}) {
  const background = resolveTagColor(color, light);
  const r = parseInt(background.slice(1, 3), 16) / 255;
  const g = parseInt(background.slice(3, 5), 16) / 255;
  const b = parseInt(background.slice(5, 7), 16) / 255;

  // Relative luminance per WCAG definition (sRGB)
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > threshold ? dark : light;
}
