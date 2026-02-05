import {
  fetchFollowedChannels,
  fetchStreamsByUserIds,
  fetchUsersByIds,
  fetchUsersByLogins,
} from '../api/twitch.js';
import { FOLLOW_CACHE_TTL_MS } from '../config.js';
import { getFollowCache, setFollowCache, clearFollowCache, getLastSeenLive, setLastSeenLive } from '../storage/index.js';
import { broadcastAuthStatus } from './auth.js';
import { ensureAuth, getAuthStatus, signOut } from '../../background/oauth.js';

export const CACHE_ITEMS_KEY = 'items';

/**
 * Pull the caller's full follow list and enrich it with user and stream data.
 * Returns a flattened snapshot suitable for caching and UI consumption.
 *
 * This function performs multiple API calls to build a complete snapshot:
 * 1. Fetches all followed channels (paginated)
 * 2. Fetches user profile data for all streamers
 * 3. Fetches current stream data to determine live status
 * 4. Updates "last seen live" timestamps for currently live streamers
 * 5. Cleans up stale last-seen data for unfollowed streamers
 *
 * @param {string} token - Twitch OAuth bearer token for authentication
 * @param {string} userId - Twitch user ID whose follows are fetched
 * @returns {Promise<Array<{
 *   id: string,
 *   login: string,
 *   displayName: string,
 *   title: string,
 *   gameName: string,
 *   isLive: boolean,
 *   startedAt: string|null,
 *   followDate: string,
 *   avatarUrl: string|null,
 *   viewerCount: number|null,
 *   thumbnailUrl: string|null,
 *   lastSeenLive: number|null,
 *   lastUpdated: number
 * }>>} Array of enriched streamer objects
 *
 * @throws {Error} If any Twitch API call fails (e.g., network error, invalid token)
 *
 * @sideeffects
 * - Updates lastSeenLive storage with current timestamps for live streamers
 * - Removes lastSeenLive entries for streamers that are no longer followed
 */
export async function buildFollowSnapshot(token, userId) {
  let cursor = undefined;
  const follows = [];

  do {
    const { data, pagination } = await fetchFollowedChannels(token, userId, cursor);
    follows.push(...data);
    cursor = pagination?.cursor;
  } while (cursor);

  const ids = [...new Set(follows.map((item) => item.broadcaster_id))];
  const [users, streams] = await Promise.all([
    ids.length ? fetchUsersByIds(token, ids) : [],
    ids.length ? fetchStreamsByUserIds(token, ids) : [],
  ]);
  const userMap = new Map(users.map((user) => [user.id, user]));
  const streamMap = new Map(streams.map((stream) => [stream.user_id, stream]));

  // Get last seen live data
  const lastSeenData = await getLastSeenLive();
  const now = Date.now();
  let lastSeenUpdated = false;

  // Build the snapshot
  const snapshot = follows.map((follow) => {
    const profile = userMap.get(follow.broadcaster_id) || {};
    const stream = streamMap.get(follow.broadcaster_id) || {};
    const thumbnailTemplate = typeof stream.thumbnail_url === 'string' ? stream.thumbnail_url : null;
    const thumbnailUrl = thumbnailTemplate
      ? thumbnailTemplate.replace('{width}x{height}', '320x180')
      : null;
    const isLive = stream.type === 'live';

    // Update last seen timestamp for currently live streamers
    if (isLive) {
      lastSeenData[follow.broadcaster_id] = now;
      lastSeenUpdated = true;
    }

    return {
      id: follow.broadcaster_id,
      login: follow.broadcaster_login,
      displayName: follow.broadcaster_name,
      title: stream.title || follow.title,
      gameName: stream.game_name || follow.game_name,
      isLive,
      startedAt: stream.started_at || null,
      followDate: follow.followed_at,
      avatarUrl: profile.profile_image_url || null,
      viewerCount: typeof stream.viewer_count === 'number' ? stream.viewer_count : null,
      thumbnailUrl,
      lastSeenLive: lastSeenData[follow.broadcaster_id] || null,
      lastUpdated: now,
    };
  });

  // Cleanup: Remove last-seen data for unfollowed streamers
  const followedIds = new Set(follows.map((f) => f.broadcaster_id));
  const entriesToRemove = Object.keys(lastSeenData).filter((id) => !followedIds.has(id));
  if (entriesToRemove.length > 0) {
    entriesToRemove.forEach((id) => delete lastSeenData[id]);
    lastSeenUpdated = true;
  }

  // Save updated last-seen data if changed
  if (lastSeenUpdated) {
    try {
      await setLastSeenLive(lastSeenData);
    } catch (error) {
      console.warn('Failed to update last seen live data:', error);
    }
  }

  return snapshot;
}

/**
 * Ensure the follow cache is fresh, attempting silent re-auth when needed.
 * Signs the user out if the token is rejected by Twitch.
 * @param {boolean} [force=false]
 * @returns {Promise<?{fetchedAt:number, [CACHE_ITEMS_KEY]: Array<object>}>}
 */
export async function refreshFollowCache(force = false) {
  let auth = await getAuthStatus();
  if (!auth) {
    try {
      auth = await ensureAuth({ interactive: false });
    } catch (error) {
      if (error.message && error.message.includes('Authentication required')) {
        return null;
      }
      throw error;
    }
  }

  if (!auth) {
    return null;
  }

  const cached = await getFollowCache();
  if (!force && cached && cached.fetchedAt + FOLLOW_CACHE_TTL_MS > Date.now()) {
    return cached;
  }

  try {
    const items = await buildFollowSnapshot(auth.accessToken, auth.user.id);
    const cache = {
      fetchedAt: Date.now(),
      [CACHE_ITEMS_KEY]: items,
    };
    await setFollowCache(cache);
    return cache;
  } catch (error) {
    if (error.status === 401 || error.status === 403) {
      await signOut();
      await clearFollowCache();
      await broadcastAuthStatus();
    }
    throw error;
  }
}

/**
 * Read the follow cache from storage without contacting Twitch.
 * Useful as a fallback when refresh attempts fail.
 * @returns {Promise<?{fetchedAt:number, [CACHE_ITEMS_KEY]: Array<object>}>}
 */
export async function getStoredFollowCache() {
  const cache = await getFollowCache();
  return cache || null;
}

/**
 * Add a newly followed streamer to the cache without a full refresh.
 * @param {string} token - Twitch OAuth bearer token
 * @param {string} login - Streamer's login name
 * @returns {Promise<void>}
 */
export async function addStreamerToCache(token, login) {
  try {
    // Fetch user data
    const users = await fetchUsersByLogins(token, [login]);
    if (!users || users.length === 0) {
      console.warn(`[TTagger] Could not find user with login: ${login}`);
      return;
    }

    const user = users[0];

    // Fetch stream data
    const streams = await fetchStreamsByUserIds(token, [user.id]);
    const stream = streams.length > 0 ? streams[0] : {};

    // Get last seen live data
    const lastSeenData = await getLastSeenLive();
    const now = Date.now();

    // Update last seen if live
    const isLive = stream.type === 'live';
    if (isLive) {
      lastSeenData[user.id] = now;
      await setLastSeenLive(lastSeenData);
    }

    // Build streamer entry
    const thumbnailTemplate = typeof stream.thumbnail_url === 'string' ? stream.thumbnail_url : null;
    const thumbnailUrl = thumbnailTemplate
      ? thumbnailTemplate.replace('{width}x{height}', '320x180')
      : null;

    const streamerEntry = {
      id: user.id,
      login: user.login,
      displayName: user.display_name,
      title: stream.title || '',
      gameName: stream.game_name || '',
      isLive,
      startedAt: stream.started_at || null,
      followDate: new Date().toISOString(), // We don't have the actual follow date
      avatarUrl: user.profile_image_url || null,
      viewerCount: typeof stream.viewer_count === 'number' ? stream.viewer_count : null,
      thumbnailUrl,
      lastSeenLive: lastSeenData[user.id] || null,
      lastUpdated: now,
    };

    // Get current cache
    const cache = await getFollowCache() || { fetchedAt: now, [CACHE_ITEMS_KEY]: [] };

    // Check if streamer already exists in cache
    const existingIndex = cache[CACHE_ITEMS_KEY].findIndex(item => item.id === user.id);

    if (existingIndex >= 0) {
      // Update existing entry
      cache[CACHE_ITEMS_KEY][existingIndex] = streamerEntry;
    } else {
      // Add new entry
      cache[CACHE_ITEMS_KEY].push(streamerEntry);
    }

    // Save updated cache
    await setFollowCache(cache);

    console.log(`[TTagger] Added streamer ${login} (${user.id}) to cache`);
  } catch (error) {
    console.error(`[TTagger] Failed to add streamer ${login} to cache:`, error);
  }
}

/**
 * Remove an unfollowed streamer from the cache.
 * @param {string} login - Streamer's login name
 * @returns {Promise<void>}
 */
export async function removeStreamerFromCache(login) {
  try {
    const cache = await getFollowCache();
    if (!cache || !cache[CACHE_ITEMS_KEY]) {
      return;
    }

    const normalizedLogin = login.toLowerCase();
    const filteredItems = cache[CACHE_ITEMS_KEY].filter(
      item => item.login.toLowerCase() !== normalizedLogin
    );

    // Only update if we actually removed something
    if (filteredItems.length < cache[CACHE_ITEMS_KEY].length) {
      cache[CACHE_ITEMS_KEY] = filteredItems;
      await setFollowCache(cache);
      console.log(`[TTagger] Removed streamer ${login} from cache`);
    }
  } catch (error) {
    console.error(`[TTagger] Failed to remove streamer ${login} from cache:`, error);
  }
}
