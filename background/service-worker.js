import { extension, addRuntimeListener } from '../src/util/extension.js';
import { getPreferences, setPreferences, clearFollowCache, getUpdateLog, clearUpdateLog } from '../src/storage/index.js';
import { startOAuthFlow, signOut, getAuthStatus } from './oauth.js';
import { broadcastAuthStatus } from '../src/background/auth.js';
import {
  ensureLiveChecksRunning,
  stopLiveChecks,
  syncLiveAssignments,
  clearLiveState,
  initializeLiveTracking,
  handleLiveAlarm,
  areLiveChecksRunning,
} from '../src/background/liveTracking.js';
import { refreshFollowCache, addStreamerToCache, removeStreamerFromCache } from '../src/background/followCache.js';
import {
  upsertTag,
  removeTag,
  updateAssignment,
  replaceAssignments,
  resetTagStateToDefault,
  reorderTags,
} from '../src/background/tagState.js';
import { handleExport, handleImport } from '../src/background/importExport.js';
import { getDashboardPayload } from '../src/background/payload.js';

extension.alarms.onAlarm.addListener(handleLiveAlarm);

const handlers = {
  async 'oauth:start'() {
    const state = await startOAuthFlow({ interactive: true });
    await broadcastAuthStatus();
    await refreshFollowCache(true);
    await ensureLiveChecksRunning({ runImmediately: true });
    return { user: state.user };
  },

  async 'oauth:status:request'() {
    const auth = await getAuthStatus();
    return { signedIn: !!auth, user: auth?.user || null };
  },

  async 'oauth:signout'() {
    await signOut();
    await clearFollowCache();
    await stopLiveChecks();
    await clearLiveState();
    await broadcastAuthStatus();
    return { ok: true };
  },

  async 'data:request'(message = {}) {
    const force = !!message.force;
    const payload = await getDashboardPayload({ forceRefresh: force });

    if (payload.auth) {
      const shouldRunImmediately = force || !areLiveChecksRunning();
      await ensureLiveChecksRunning({ runImmediately: shouldRunImmediately });
    }

    return payload;
  },

  async 'follow:refresh'() {
    await refreshFollowCache(true);
    const payload = await getDashboardPayload({ forceRefresh: false });
    if (payload.auth) {
      await ensureLiveChecksRunning({ runImmediately: true });
    }
    return payload;
  },

  async 'follow:add'(message) {
    const auth = await getAuthStatus();
    if (!auth) {
      throw new Error('Not authenticated');
    }
    await addStreamerToCache(auth.accessToken, message.login);
    return { ok: true };
  },

  async 'follow:remove'(message) {
    await removeStreamerFromCache(message.login);
    return { ok: true };
  },

  async 'tag:create'(message) {
    const state = await upsertTag({ name: message.name, color: message.color });
    return { tagState: state };
  },

  async 'tag:update'(message) {
    const state = await upsertTag({ name: message.name, color: message.color }, message.tagId);
    return { tagState: state };
  },

  async 'tag:remove'(message) {
    const state = await removeTag(message.tagId);
    return { tagState: state };
  },

  async 'tag:assign'(message) {
    const state = await updateAssignment(message.streamerId, message.tagId, message.assign);
    await syncLiveAssignments(state.assignments, { changedStreamerId: message.streamerId });
    return { tagState: state };
  },

  async 'tag:replace'(message) {
    const state = await replaceAssignments(message.streamerId, message.tagIds || []);
    await syncLiveAssignments(state.assignments, { changedStreamerId: message.streamerId });
    return { tagState: state };
  },

  async 'tag:reorder'(message = {}) {
    const state = await reorderTags(message.tagIds || []);
    return { tagState: state };
  },

  async 'preferences:update'(message) {
    const current = await getPreferences();
    const next = { ...current, ...message.preferences };
    await setPreferences(next);
    try {
      extension.runtime.sendMessage({ type: 'preferences:updated', preferences: next });
    } catch (error) {
      const messageText = error && error.message ? error.message : String(error);
      if (/receiving end does not exist/i.test(messageText) || /message port closed/i.test(messageText)) {
        console.debug('[ServiceWorker] No listeners for preferences:updated broadcast.');
      } else {
        console.warn('[ServiceWorker] Failed to broadcast preferences update', error);
      }
    }
    return { preferences: next };
  },

  async 'data:reset'() {
    const tagState = await resetTagStateToDefault();
    await clearLiveState();
    return { tagState };
  },

  async 'data:export'() {
    return handleExport();
  },

  async 'data:import'(message) {
    const result = await handleImport(message.payload);
    await syncLiveAssignments(result.tagState.assignments);
    await ensureLiveChecksRunning({ runImmediately: true });
    return result;
  },

  async 'debug:getLog'() {
    try {
      const logs = await getUpdateLog();
      return { logs };
    } catch (error) {
      console.error('Failed to get update log:', error);
      throw error;
    }
  },

  async 'debug:clearLog'() {
    try {
      await clearUpdateLog();
      return { ok: true };
    } catch (error) {
      console.error('Failed to clear update log:', error);
      throw error;
    }
  },
};

addRuntimeListener((message, sender, sendResponse) => {
  if (!message || !message.type) return false;
  const handler = handlers[message.type];
  if (!handler) return false;

  handler(message)
    .then((data) => sendResponse({ ok: true, data }))
    .catch((error) => {
      console.error('Background handler error', message.type, error);
      sendResponse({ ok: false, error: error.message || String(error) });
    });

  return true;
});

broadcastAuthStatus().catch((error) => {
  console.warn('Failed to initialize auth status broadcast', error);
});

initializeLiveTracking().catch((error) => {
  console.warn('Failed to initialize live tracking:', error);
});
