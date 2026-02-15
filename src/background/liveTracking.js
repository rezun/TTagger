import { extension, setBadgeBackgroundColor, setBadgeText } from '../util/extension.js';
import { createLiveNotification } from '../util/notifications.js';
import { FOLLOW_CACHE_TTL_MS } from '../config.js';
import { getPreferences, getTagState, addUpdateLogEntry, setPopupSnapshot, constants as storageConstants } from '../storage/index.js';
import { normalizeTagState } from './tagState.js';
import { refreshFollowCache, CACHE_ITEMS_KEY } from './followCache.js';
import { getAuthStatus } from '../../background/oauth.js';
import { isValidTwitchUsername } from '../util/validators.js';

const LIVE_CHECK_ALARM_NAME = 'live-check-alarm';
const LIVE_STATE_KEY = 'liveState';
const BADGE_COLOR = '#9146FF';
const DEFAULT_NOTIFICATION_MAX_AGE_MINUTES = storageConstants.DEFAULT_NOTIFICATION_MAX_STREAM_AGE_MINUTES;
const MAX_NOTIFICATION_MAX_AGE_MINUTES = storageConstants.MAX_NOTIFICATION_MAX_STREAM_AGE_MINUTES;
// Prevent duplicate entries when initialization runs right before an alarm fires.
const RECENT_INITIALIZATION_DEBOUNCE_MS = 1500;

let liveState = new Map();
let liveCheckTimeoutId = null;
let badgeColorInitialized = false;
let shouldRunLiveChecks = false;
let initializationRunInFlight = false;
let lastRunMeta = {
  trigger: null,
  completedAt: 0,
  success: false,
};

async function logUpdate(trigger, metadata = {}) {
  const entry = {
    timestamp: Date.now(),
    trigger, // 'alarm' | 'manual' | 'fallback' | 'initialization'
    liveCount: metadata.liveCount || 0,
    starredCount: metadata.starredCount || 0,
    cacheAge: metadata.cacheAge || 0,
    success: metadata.success !== false,
    error: metadata.error || null,
    skipped: metadata.skipped || null,
    duration: metadata.duration || 0
  };

  try {
    await addUpdateLogEntry(entry);
  } catch (error) {
    console.warn('Failed to log update:', error);
  }
}

function recordRunMeta(trigger, success) {
  lastRunMeta = {
    trigger,
    completedAt: Date.now(),
    success,
  };
}

function shouldSkipScheduledRun(trigger) {
  if (trigger !== 'alarm' && trigger !== 'fallback') {
    return false;
  }

  if (initializationRunInFlight) {
    return true;
  }

  if (lastRunMeta.trigger !== 'initialization' || !lastRunMeta.success) {
    return false;
  }

  return Date.now() - lastRunMeta.completedAt < RECENT_INITIALIZATION_DEBOUNCE_MS;
}

async function runLiveCheckAndLog(trigger) {
  const startTime = Date.now();
  const isInitialization = trigger === 'initialization';

  if (isInitialization) {
    initializationRunInFlight = true;
  }

  try {
    const result = await runLiveCheck();
    const duration = Date.now() - startTime;
    await logUpdate(trigger, {
      ...result,
      duration,
    });
    const didRun = result.success !== false && !result.skipped;
    recordRunMeta(trigger, didRun);
    return result;
  } catch (error) {
    const duration = Date.now() - startTime;
    await logUpdate(trigger, {
      success: false,
      error: error.message,
      duration,
    });
    recordRunMeta(trigger, false);
    throw error;
  } finally {
    if (isInitialization) {
      initializationRunInFlight = false;
    }
  }
}

async function loadLiveState() {
  try {
    const result = await extension.storage.local.get(LIVE_STATE_KEY);
    const saved = result[LIVE_STATE_KEY] || {};
    liveState = new Map(
      Object.entries(saved).map(([streamerId, entry]) => {
        if (!entry || typeof entry !== 'object') {
          return [streamerId, { isLive: !!entry, startedAt: null }];
        }
        return [
          streamerId,
          {
            isLive: !!entry.isLive,
            startedAt: Number.isFinite(entry.startedAt) ? entry.startedAt : null,
          },
        ];
      }),
    );
  } catch (error) {
    console.warn('Failed to load live state:', error);
    liveState = new Map();
  }
}

async function saveLiveState() {
  try {
    const obj = Object.fromEntries(
      Array.from(liveState.entries()).map(([streamerId, entry]) => [
        streamerId,
        {
          isLive: !!entry?.isLive,
          startedAt: Number.isFinite(entry?.startedAt) ? entry.startedAt : null,
        },
      ]),
    );
    await extension.storage.local.set({ [LIVE_STATE_KEY]: obj });
  } catch (error) {
    console.warn('Failed to save live state:', error);
  }
}

function parseStartedAtMs(startedAt) {
  if (!startedAt) return null;
  const parsed = Date.parse(startedAt);
  return Number.isFinite(parsed) ? parsed : null;
}

function scheduleLiveCheckFallback() {
  if (!shouldRunLiveChecks) {
    liveCheckTimeoutId = null;
    return;
  }

  if (liveCheckTimeoutId) {
    clearTimeout(liveCheckTimeoutId);
  }

  liveCheckTimeoutId = setTimeout(async () => {
    liveCheckTimeoutId = null;
    try {
      if (shouldSkipScheduledRun('fallback')) {
        return;
      }
      await runLiveCheckAndLog('fallback');
    } catch (error) {
      console.error('Live check fallback failed', error);
    } finally {
      scheduleLiveCheckFallback();
    }
  }, FOLLOW_CACHE_TTL_MS);
}

async function startLiveCheckAlarm() {
  try {
    await extension.alarms.clear(LIVE_CHECK_ALARM_NAME);
    await extension.alarms.create(LIVE_CHECK_ALARM_NAME, {
      periodInMinutes: FOLLOW_CACHE_TTL_MS / (60 * 1000),
    });
    if (liveCheckTimeoutId) {
      clearTimeout(liveCheckTimeoutId);
      liveCheckTimeoutId = null;
    }
    shouldRunLiveChecks = true;
  } catch (error) {
    console.warn('Failed to create alarm, falling back to timer:', error);
    shouldRunLiveChecks = true;
    scheduleLiveCheckFallback();
  }
}

/**
 * Halt recurring live checks by cancelling alarms and timers.
 * Leaves any cached live state untouched so the badge can be cleared later.
 * @returns {Promise<void>}
 */
export async function stopLiveChecks() {
  shouldRunLiveChecks = false;
  try {
    await extension.alarms.clear(LIVE_CHECK_ALARM_NAME);
  } catch (error) {
    console.warn('Failed to clear alarm:', error);
  }

  if (liveCheckTimeoutId) {
    clearTimeout(liveCheckTimeoutId);
    liveCheckTimeoutId = null;
  }
}

function getLiveStarredCount() {
  let count = 0;
  liveState.forEach((entry) => {
    if (entry?.isLive) count += 1;
  });
  return count;
}

async function updateLiveBadge(liveCount) {
  if (!extension?.action) return;
  try {
    if (!badgeColorInitialized && liveCount >= 0) {
      await setBadgeBackgroundColor({ color: BADGE_COLOR });
      badgeColorInitialized = true;
    }
    const text = liveCount > 0 ? String(liveCount) : '';
    await setBadgeText({ text });
  } catch (error) {
    console.warn('Failed to update live badge', error);
  }
}

/**
 * Sync live-state entries with current assignments and live status.
 * Removes streamers that are no longer starred or have gone offline.
 * Keeps the badge count accurate after tag changes or status updates.
 * @param {Record<string, Array<string>>} [assignments]
 * @returns {Promise<void>}
 */
export async function syncLiveAssignments(assignments = {}, options = {}) {
  const { changedStreamerId = null } = options;
  const normalizedChangedId = changedStreamerId != null ? String(changedStreamerId) : null;

  const starredIds = new Set(
    Object.entries(assignments)
      .filter(([, tagIds]) => Array.isArray(tagIds) && tagIds.includes('favorite'))
      .map(([streamerId]) => String(streamerId)),
  );

  // Get current follow cache to check live status
  let cache = await refreshFollowCache(false);
  let cacheItems = Array.isArray(cache?.[CACHE_ITEMS_KEY]) ? cache[CACHE_ITEMS_KEY] : [];

  const cacheMissingChangedStreamer = normalizedChangedId
    ? !cacheItems.some((streamer) => String(streamer.id) === normalizedChangedId)
    : false;

  if (normalizedChangedId && (!cacheItems.length || cacheMissingChangedStreamer)) {
    try {
      const refreshed = await refreshFollowCache(true);
      if (refreshed && Array.isArray(refreshed[CACHE_ITEMS_KEY])) {
        cache = refreshed;
        cacheItems = refreshed[CACHE_ITEMS_KEY];
      }
    } catch (error) {
      console.warn('Failed to refresh follow cache during sync:', error);
    }
  }

  const liveStatusMap = new Map();

  const cacheItemsById = new Map();

  cacheItems.forEach((streamer) => {
    const streamerId = String(streamer.id);
    cacheItemsById.set(streamerId, streamer);
    liveStatusMap.set(streamerId, !!streamer.isLive);
  });

  let modified = false;

  // Remove streamers that are no longer starred OR have gone offline
  for (const streamerId of Array.from(liveState.keys())) {
    const isStarred = starredIds.has(streamerId);
    const isCurrentlyLive = liveStatusMap.get(streamerId);
    const previousEntry = liveState.get(streamerId) || { isLive: false, startedAt: null };
    const wasLive = !!previousEntry.isLive;

    // Remove if no longer starred
    if (!isStarred) {
      liveState.delete(streamerId);
      modified = true;
      continue;
    }

    // Remove or update if live status changed
    if (wasLive && isCurrentlyLive === false) {
      // Streamer went offline
      liveState.set(streamerId, { isLive: false, startedAt: null });
      modified = true;
    } else if (isCurrentlyLive === true) {
      const data = cacheItemsById.get(streamerId);
      const startedAtMs = parseStartedAtMs(data?.startedAt);
      const newEntry = {
        isLive: true,
        startedAt: startedAtMs,
      };
      if (!wasLive || previousEntry.startedAt !== newEntry.startedAt) {
        modified = true;
      }
      liveState.set(streamerId, newEntry);
    }
  }

  // Add newly starred live streamers that were not previously tracked
  starredIds.forEach((streamerId) => {
    if (liveState.has(streamerId)) {
      return;
    }

    if (liveStatusMap.get(streamerId)) {
      const data = cacheItemsById.get(streamerId);
      const startedAtMs = parseStartedAtMs(data?.startedAt);
      liveState.set(streamerId, {
        isLive: true,
        startedAt: startedAtMs,
      });
      modified = true;
    }
  });

  if (modified) {
    await saveLiveState();
    await updateLiveBadge(getLiveStarredCount());
  }
}

/**
 * Reset the persisted live-state map and clear the action badge.
 * @returns {Promise<void>}
 */
export async function clearLiveState() {
  liveState.clear();
  await saveLiveState();
  await updateLiveBadge(0);
}

async function runLiveCheck() {
  const auth = await getAuthStatus();
  if (!auth) {
    await clearLiveState();
    return { success: true, liveCount: 0, starredCount: 0, cacheAge: 0, skipped: 'no_auth' };
  }

  const cache = await refreshFollowCache(false);
  if (!cache || !cache[CACHE_ITEMS_KEY]) {
    return { success: true, liveCount: 0, starredCount: 0, cacheAge: 0, skipped: 'no_cache' };
  }

  try {
    const preferences = await getPreferences();
    const shouldNotify = !!preferences.notificationsEnabled;
    const maxAgeMinutesRaw = Number(preferences.notificationMaxStreamAgeMinutes);
    const maxAgeMinutes = Number.isFinite(maxAgeMinutesRaw) && maxAgeMinutesRaw > 0
      ? Math.min(maxAgeMinutesRaw, MAX_NOTIFICATION_MAX_AGE_MINUTES)
      : DEFAULT_NOTIFICATION_MAX_AGE_MINUTES;
    const maxAgeMs = maxAgeMinutes * 60 * 1000;

    const tagState = normalizeTagState(await getTagState());
    const assignments = tagState.assignments || {};

    const streamers = cache[CACHE_ITEMS_KEY];
    const starredStreamers = streamers.filter((streamer) => assignments[streamer.id]?.includes('favorite'));
    const starredIds = new Set(starredStreamers.map((streamer) => streamer.id));
    const pendingNotifications = [];

    for (const streamer of starredStreamers) {
      const previousEntry = liveState.get(streamer.id) || { isLive: false, startedAt: null };
      const wasLive = !!previousEntry.isLive;
      const isLive = streamer.isLive;
      const startedAtMs = parseStartedAtMs(streamer.startedAt);
      const streamAgeMs = Number.isFinite(startedAtMs) ? Date.now() - startedAtMs : Number.POSITIVE_INFINITY;
      const hasFreshStart = Number.isFinite(startedAtMs)
        && (!Number.isFinite(previousEntry.startedAt) || previousEntry.startedAt !== startedAtMs);

      const isEligibleForNotification = shouldNotify
        && isLive
        && streamAgeMs <= maxAgeMs
        && (!wasLive || hasFreshStart);

      if (isEligibleForNotification) {
        // Validate streamer login to prevent URL injection attacks
        if (!isValidTwitchUsername(streamer.login)) {
          console.warn('Invalid streamer login, skipping notification:', streamer.id, streamer.login);
          continue;
        }

        pendingNotifications.push({
          displayName: streamer.displayName,
          login: streamer.login,
          avatarUrl: streamer.avatarUrl,
          id: streamer.id,
        });
      }

      liveState.set(streamer.id, {
        isLive,
        startedAt: isLive ? startedAtMs : null,
      });
    }

    for (const streamerId of Array.from(liveState.keys())) {
      if (!starredIds.has(streamerId)) {
        liveState.delete(streamerId);
      }
    }

    // Send notifications sequentially with a short delay between each so
    // macOS notification center doesn't collapse or replace them.
    for (let i = 0; i < pendingNotifications.length; i++) {
      const { displayName, login, avatarUrl, id } = pendingNotifications[i];
      const streamUrl = `https://www.twitch.tv/${login}`;
      try {
        await createLiveNotification(displayName, streamUrl, avatarUrl);
      } catch (error) {
        console.error('Failed to create live notification', id, error);
      }
      if (i < pendingNotifications.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }

    await saveLiveState();
    await updateLiveBadge(getLiveStarredCount());

    const cacheAge = Date.now() - cache.fetchedAt;
    const liveCount = getLiveStarredCount();
    const starredCount = starredStreamers.length;

    try {
      await setPopupSnapshot({
        hasAuth: true,
        follows: streamers,
        tagState,
        preferences,
        fetchedAt: cache.fetchedAt,
      });
    } catch (error) {
      console.warn('Failed to update popup snapshot from live check:', error);
    }

    return {
      success: true,
      liveCount,
      starredCount,
      cacheAge
    };
  } catch (error) {
    console.error('Error during live check:', error);
    return {
      success: false,
      liveCount: 0,
      starredCount: 0,
      cacheAge: 0,
      error: error.message
    };
  }
}

/**
 * Run a single live-status refresh cycle using cached follow data.
 * @returns {Promise<void>}
 */
export async function performLiveCheck() {
  await runLiveCheck();
}

/**
 * Make sure recurring live checks are scheduled, optionally running one now.
 * @param {{runImmediately?: boolean, trigger?: string}} [options]
 * @returns {Promise<void>}
 */
export async function ensureLiveChecksRunning({ runImmediately = false, trigger = 'manual' } = {}) {
  if (!shouldRunLiveChecks) {
    await startLiveCheckAlarm();
  }
  if (runImmediately) {
    try {
      await runLiveCheckAndLog(trigger);
    } catch (error) {
      console.error('Live check failed during ensureLiveChecksRunning', error);
    }
  }
}

/**
 * Whether recurring live checks are currently scheduled.
 * @returns {boolean}
 */
export function areLiveChecksRunning() {
  return shouldRunLiveChecks;
}

/**
 * Restore persisted live state and start background alarms after startup.
 * Clears stale state if the user is currently signed out.
 * @returns {Promise<void>}
 */
export async function initializeLiveTracking() {
  const startTime = Date.now();
  try {
    await loadLiveState();
    const auth = await getAuthStatus();
    if (!auth) {
      if (liveState.size) {
        await clearLiveState();
      } else {
        await updateLiveBadge(0);
      }
      await logUpdate('initialization', {
        success: true,
        liveCount: 0,
        starredCount: 0,
        duration: Date.now() - startTime
      });
      return;
    }

    await updateLiveBadge(getLiveStarredCount());
    await ensureLiveChecksRunning({ runImmediately: true, trigger: 'initialization' });
  } catch (error) {
    await logUpdate('initialization', {
      success: false,
      error: error.message,
      duration: Date.now() - startTime
    });
  }
}

/**
 * Alarm listener invoked by the service worker when live checks tick.
 * @param {{name: string}} alarm
 * @returns {Promise<void>}
 */
export async function handleLiveAlarm(alarm) {
  if (alarm.name !== LIVE_CHECK_ALARM_NAME) {
    return;
  }
  
  if (shouldSkipScheduledRun('alarm')) {
    return;
  }

  try {
    await runLiveCheckAndLog('alarm');
  } catch (error) {
    console.error('Error in live check alarm:', error);
  }
}
