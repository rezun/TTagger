import { storageGet, storageSet, storageRemove } from '../util/extension.js';
import { TAG_STARRED } from '../util/constants.js';
import { checkStorageQuota, getStorageCleanupSuggestions } from '../util/storageQuota.js';

const AUTH_KEY = 'authState';
const FOLLOW_CACHE_KEY = 'followCache';
const POPUP_SNAPSHOT_KEY = 'popupSnapshot';
const TAG_STATE_KEY = 'tagState';
const PREFERENCE_KEY = 'preferences';
const LAST_SEEN_LIVE_KEY = 'lastSeenLive';
const UPDATE_LOG_KEY = 'updateLog';
const MAX_LOG_ENTRIES = 300;
const DEFAULT_NOTIFICATION_MAX_STREAM_AGE_MINUTES = 30;
const MIN_NOTIFICATION_MAX_STREAM_AGE_MINUTES = 5;
const MAX_NOTIFICATION_MAX_STREAM_AGE_MINUTES = 720;

const defaultTagState = Object.freeze({ tags: {}, assignments: {}, nextId: 1 });
const defaultPreferences = Object.freeze({
  sortBy: 'follow-date-desc',
  liveFirst: true,
  starredFirst: true,
  nameFilter: '',
  contentFilter: '',
  selectedTagId: null,
  popupSelectedTagId: TAG_STARRED,
  themeMode: 'system',
  notificationsEnabled: false,
  openInCurrentTab: 'never', // 'never', 'always', or 'smart'
  twitchHighlighting: true,
  twitchSidebarTags: true,
  twitchHighlightColor: '#ffd700',
  languageOverride: 'system',
  debugLogging: false,
  notificationMaxStreamAgeMinutes: DEFAULT_NOTIFICATION_MAX_STREAM_AGE_MINUTES,
});

export async function getAuthState() {
  try {
    const result = await storageGet('local', AUTH_KEY);
    return result[AUTH_KEY] || null;
  } catch (error) {
    console.error('[Storage] Failed to get auth state:', error);
    return null;
  }
}

export async function setAuthState(state) {
  try {
    return await storageSet('local', { [AUTH_KEY]: state });
  } catch (error) {
    console.error('[Storage] Failed to set auth state:', error);
    throw new Error(`Failed to save authentication state: ${error.message}`);
  }
}

export async function clearAuthState() {
  try {
    await storageRemove('local', AUTH_KEY);
  } catch (error) {
    console.error('[Storage] Failed to clear auth state:', error);
    // Don't throw - clearing is often done during cleanup
  }
}

export async function getFollowCache() {
  try {
    const result = await storageGet('local', FOLLOW_CACHE_KEY);
    return result[FOLLOW_CACHE_KEY] || null;
  } catch (error) {
    console.error('[Storage] Failed to get follow cache:', error);
    return null;
  }
}

export async function setFollowCache(cache) {
  try {
    return await storageSet('local', { [FOLLOW_CACHE_KEY]: cache });
  } catch (error) {
    console.error('[Storage] Failed to set follow cache:', error);
    throw new Error(`Failed to save follow cache: ${error.message}`);
  }
}

export async function clearFollowCache() {
  try {
    await storageRemove('local', FOLLOW_CACHE_KEY);
  } catch (error) {
    console.error('[Storage] Failed to clear follow cache:', error);
    // Don't throw - clearing is often done during cleanup
  }
}

export async function getPopupSnapshot() {
  try {
    const result = await storageGet('local', POPUP_SNAPSHOT_KEY);
    return result[POPUP_SNAPSHOT_KEY] || null;
  } catch (error) {
    console.error('[Storage] Failed to get popup snapshot:', error);
    return null;
  }
}

export async function setPopupSnapshot(snapshot) {
  try {
    return await storageSet('local', { [POPUP_SNAPSHOT_KEY]: snapshot });
  } catch (error) {
    console.error('[Storage] Failed to set popup snapshot:', error);
    throw new Error(`Failed to save popup snapshot: ${error.message}`);
  }
}

export async function clearPopupSnapshot() {
  try {
    await storageRemove('local', POPUP_SNAPSHOT_KEY);
  } catch (error) {
    console.error('[Storage] Failed to clear popup snapshot:', error);
    // Don't throw - clearing is often done during cleanup
  }
}

export async function getTagState() {
  try {
    const result = await storageGet('sync', TAG_STATE_KEY);
    return result[TAG_STATE_KEY] || { ...defaultTagState };
  } catch (error) {
    console.error('[Storage] Failed to get tag state:', error);
    return { ...defaultTagState };
  }
}

export async function setTagState(state) {
  try {
    // Check quota before attempting to save
    const quotaCheck = await checkStorageQuota();

    if (quotaCheck.shouldBlock) {
      const suggestions = getStorageCleanupSuggestions();
      const suggestionText = suggestions.map((s, i) => `${i + 1}. ${s}`).join('\n');
      throw new Error(
        `${quotaCheck.message}\n\nSuggestions:\n${suggestionText}`
      );
    }

    // Warn user if approaching quota (but allow save)
    if (quotaCheck.shouldWarn) {
      console.warn('[Storage] Storage quota warning:', quotaCheck.message);
    }

    return await storageSet('sync', { [TAG_STATE_KEY]: state });
  } catch (error) {
    // Check if quota exceeded during save (fallback)
    const isQuotaError = error.message && (
      error.message.includes('QUOTA_BYTES') ||
      error.message.includes('QuotaExceededError') ||
      error.message.includes('quota')
    );

    if (isQuotaError) {
      console.error('[Storage] Sync storage quota exceeded:', error);
      const suggestions = getStorageCleanupSuggestions();
      const suggestionText = suggestions.map((s, i) => `${i + 1}. ${s}`).join('\n');
      throw new Error(
        `Storage quota exceeded. Please reduce your data usage.\n\nSuggestions:\n${suggestionText}`
      );
    }

    console.error('[Storage] Failed to set tag state:', error);
    throw error;
  }
}

export async function getPreferences() {
  try {
    const result = await storageGet('sync', PREFERENCE_KEY);
    const stored = result[PREFERENCE_KEY] || {};
    const merged = { ...defaultPreferences, ...stored };

    if (!Object.prototype.hasOwnProperty.call(stored, 'popupSelectedTagId')) {
      if (typeof stored.selectedTagId === 'string' && stored.selectedTagId) {
        merged.popupSelectedTagId = stored.selectedTagId;
      }
    }

    const maxAgeRaw = Number(merged.notificationMaxStreamAgeMinutes);
    if (!Number.isFinite(maxAgeRaw)) {
      merged.notificationMaxStreamAgeMinutes = DEFAULT_NOTIFICATION_MAX_STREAM_AGE_MINUTES;
    } else {
      const rounded = Math.round(maxAgeRaw);
      const clamped = Math.min(
        MAX_NOTIFICATION_MAX_STREAM_AGE_MINUTES,
        Math.max(MIN_NOTIFICATION_MAX_STREAM_AGE_MINUTES, rounded),
      );
      merged.notificationMaxStreamAgeMinutes = clamped;
    }

    const highlightColor = typeof merged.twitchHighlightColor === 'string'
      ? merged.twitchHighlightColor.trim().toLowerCase()
      : '';
    const colorMatch = highlightColor.match(/^#?([0-9a-f]{6})$/);
    merged.twitchHighlightColor = colorMatch
      ? `#${colorMatch[1]}`
      : defaultPreferences.twitchHighlightColor;

    return merged;
  } catch (error) {
    console.error('[Storage] Failed to get preferences:', error);
    return { ...defaultPreferences };
  }
}

export async function setPreferences(prefs) {
  try {
    return await storageSet('sync', { [PREFERENCE_KEY]: prefs });
  } catch (error) {
    console.error('[Storage] Failed to set preferences:', error);
    throw new Error(`Failed to save preferences: ${error.message}`);
  }
}

export async function getLastSeenLive() {
  try {
    const result = await storageGet('local', LAST_SEEN_LIVE_KEY);
    return result[LAST_SEEN_LIVE_KEY] || {};
  } catch (error) {
    console.error('[Storage] Failed to get last seen live:', error);
    return {};
  }
}

export async function setLastSeenLive(data) {
  try {
    return await storageSet('local', { [LAST_SEEN_LIVE_KEY]: data });
  } catch (error) {
    console.error('[Storage] Failed to set last seen live:', error);
    // Don't throw - this is non-critical data
  }
}

export async function getUpdateLog() {
  try {
    const result = await storageGet('local', UPDATE_LOG_KEY);
    return result[UPDATE_LOG_KEY] || [];
  } catch (error) {
    console.error('[Storage] Failed to get update log:', error);
    return [];
  }
}

export async function addUpdateLogEntry(entry) {
  try {
    const logs = await getUpdateLog();
    logs.push(entry);

    // Keep only last 300 entries
    if (logs.length > MAX_LOG_ENTRIES) {
      logs.splice(0, logs.length - MAX_LOG_ENTRIES);
    }

    return await storageSet('local', { [UPDATE_LOG_KEY]: logs });
  } catch (error) {
    console.error('[Storage] Failed to add update log entry:', error);
    // Don't throw - logging failures shouldn't break the app
  }
}

export async function clearUpdateLog() {
  try {
    await storageRemove('local', UPDATE_LOG_KEY);
  } catch (error) {
    console.error('[Storage] Failed to clear update log:', error);
    // Don't throw - clearing is often done during cleanup
  }
}

export const constants = {
  AUTH_KEY,
  FOLLOW_CACHE_KEY,
  TAG_STATE_KEY,
  PREFERENCE_KEY,
  LAST_SEEN_LIVE_KEY,
  UPDATE_LOG_KEY,
  POPUP_SNAPSHOT_KEY,
  MAX_LOG_ENTRIES,
  DEFAULT_NOTIFICATION_MAX_STREAM_AGE_MINUTES,
  MIN_NOTIFICATION_MAX_STREAM_AGE_MINUTES,
  MAX_NOTIFICATION_MAX_STREAM_AGE_MINUTES,
};
