// Tag constants
export const TAG_STARRED = 'favorite';
export const TAG_UNTAGGED = '__untagged__';
export const TAG_ALL = null;

// Theme constants
export const THEME_SYSTEM = 'system';
export const THEME_DARK = 'dark';
export const THEME_LIGHT = 'light';

// Language constants
export const LANGUAGE_SYSTEM = 'system';
export const SUPPORTED_LANGUAGES = ['en', 'de'];

// UI constants
export const DEFAULT_TAG_COLOR = '#6f42c1';
export const TAG_COLOR_PRESETS = [
  '#6f42c1',
  '#22c55e',
  '#ff6f61',
  '#f97316',
  '#facc15',
  '#2563eb',
  '#14b8a6',
  '#0ea5e9',
  '#ec4899',
  '#ef4444',
  '#65a30d',
  '#4b5563',
];
export const TWITCH_BADGE_COLOR = '#9146FF';
export const THUMBNAIL_SIZE = '320x180';
export const MOBILE_BREAKPOINT = 991.98;

// Timing constants
export const PREFERENCE_SYNC_DELAY = 300;
export { FOLLOW_CACHE_TTL_MS } from '../config.js';

// Sort options
export const SORT_OPTIONS = {
  FOLLOW_DATE_DESC: 'follow-date-desc',
  FOLLOW_DATE_ASC: 'follow-date-asc',
  NAME_ASC: 'name-asc',
  NAME_DESC: 'name-desc',
};
