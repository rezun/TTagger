import { extension, addRuntimeListener, sendRuntimeMessage } from '../src/util/extension.js';
import {
  formatUptime,
  formatViewerCount,
  appendMetaSegment,
} from '../src/util/formatters.js';
import { TAG_STARRED } from '../src/util/constants.js';
import { handleUserError } from '../src/util/errors.js';
import {
  getPreferences,
  setPreferences,
  getPopupSnapshot,
  setPopupSnapshot,
  clearPopupSnapshot,
} from '../src/storage/index.js';
import { localize, getMessageStrict, setLanguageOverride } from '../src/util/i18n.js';

let activeLanguageOverride = null;

const localizationReady = (async () => {
  try {
    const prefs = await getPreferences();
    const languagePreference = prefs?.languageOverride ?? 'system';
    activeLanguageOverride = await setLanguageOverride(languagePreference);
  } catch (error) {
    console.error('[Popup] Failed to apply language preference', error);
  }
})();

await localizationReady;
localize();

const t = (key, substitutions) => getMessageStrict(key, substitutions);



const openButton = document.getElementById('open-app');
const settingsButton = document.getElementById('open-settings');
const refreshButton = document.getElementById('refresh-button');
const notificationToggleButton = document.getElementById('toggle-notifications');
const notificationIcon = document.getElementById('notification-icon');
const signinButton = document.getElementById('signin-button');
const signinContainer = document.getElementById('signin-container');
const loadingEl = document.getElementById('loading');
const loadingTextEl = document.getElementById('loading-text');
const messageEl = document.getElementById('message');
const listEl = document.getElementById('starred-list');
const labelFilterBtn = document.getElementById('label-filter-btn');
const labelFilterText = document.getElementById('label-filter-text');
const labelFilterMenu = document.getElementById('label-filter-menu');
const resetFilterBtn = document.getElementById('reset-filter-btn');

let notificationsEnabled = false;
let openInCurrentTab = 'never'; // 'never', 'always', or 'smart'
let currentTagState = null;
let currentFollows = [];
let selectedTagId = TAG_STARRED;



function updateNotificationIcon(enabled) {
  if (!notificationIcon) return;
  notificationsEnabled = enabled;

  const useElement = notificationIcon.querySelector('use');
  if (!useElement) return;

  if (enabled) {
    useElement.setAttribute('href', '../assets/icons/bell.svg#icon');
    notificationToggleButton?.classList.remove('btn-outline-secondary');
    notificationToggleButton?.classList.add('btn-outline-primary');
  } else {
    useElement.setAttribute('href', '../assets/icons/bell-slash.svg#icon');
    notificationToggleButton?.classList.remove('btn-outline-primary');
    notificationToggleButton?.classList.add('btn-outline-secondary');
  }
}

function normalizeOpenInCurrentTab(value) {
  if (typeof value === 'boolean') {
    return value ? 'always' : 'never';
  }
  if (value === 'never' || value === 'always' || value === 'smart') {
    return value;
  }
  return 'never';
}

function applyPreferences(preferences) {
  if (!preferences) return;

  updateNotificationIcon(!!preferences.notificationsEnabled);
  openInCurrentTab = normalizeOpenInCurrentTab(preferences.openInCurrentTab);
}

function showLoading(isLoading) {
  if (!loadingEl) return;
  loadingEl.hidden = !isLoading;
}

function setMessage(text, variant = 'muted') {
  if (!messageEl) return;
  messageEl.textContent = text || '';
  messageEl.className = `popup-message text-${variant}`;
  messageEl.hidden = !text;
}

function showSignin(show) {
  if (!signinContainer) return;
  signinContainer.hidden = !show;
}

function getLiveCountForTag(tagId) {
  if (!currentFollows.length || !currentTagState) return 0;

  const assignments = currentTagState.assignments || {};
  return currentFollows.filter(streamer => {
    if (!streamer.isLive) return false;
    const streamerTags = assignments[streamer.id] || [];
    return streamerTags.includes(tagId);
  }).length;
}

function populateLabelFilter(tagState) {
  if (!labelFilterMenu || !labelFilterText || !tagState) return;

  currentTagState = tagState;
  labelFilterMenu.innerHTML = '';

  // Validate selected tag still exists, otherwise reset to starred
  if (!tagState.tags[selectedTagId]) {
    selectedTagId = TAG_STARRED;
  }

  // Get all tags and sort by sortOrder
  const tags = Object.values(tagState.tags || {})
    .filter(tag => tag && tag.id)
    .sort((a, b) => {
      const orderA = typeof a.sortOrder === 'number' ? a.sortOrder : Number.MAX_SAFE_INTEGER;
      const orderB = typeof b.sortOrder === 'number' ? b.sortOrder : Number.MAX_SAFE_INTEGER;
      return orderA - orderB;
    });

  // Populate dropdown with tags
  tags.forEach(tag => {
    const li = document.createElement('li');
    const button = document.createElement('button');
    button.className = 'dropdown-item';
    button.type = 'button';
    button.dataset.tagId = tag.id;

    // Create the label content with colored dot and count
    // Skip the dot for Starred tag since it has a star icon
    if (tag.id !== TAG_STARRED) {
      const dot = document.createElement('span');
      dot.className = 'label-dot';
      dot.textContent = '●';
      if (tag.color) {
        dot.style.color = tag.color;
      }
      button.appendChild(dot);
    }

    const name = document.createElement('span');
    name.className = 'label-name';
    name.textContent = tag.name;

    const count = document.createElement('span');
    const liveCount = getLiveCountForTag(tag.id);
    count.className = liveCount > 0 ? 'label-count label-count-live' : 'label-count';
    count.textContent = liveCount.toString();

    button.appendChild(name);
    button.appendChild(count);

    button.addEventListener('click', async () => {
      selectedTagId = tag.id;
      updateLabelFilterButton();
      if (currentTagState) {
        const cached = getFilteredStreamersByTag(currentFollows, currentTagState, selectedTagId);
        renderStarred(cached);
      }
      await saveSelectedTag();
      await fetchStarred(false);
    });

    li.appendChild(button);
    labelFilterMenu.appendChild(li);
  });

  updateLabelFilterButton();
}

function updateLabelFilterButton() {
  if (!labelFilterText || !currentTagState) return;

  const selectedTag = currentTagState.tags[selectedTagId];
  if (!selectedTag) return;

  labelFilterText.innerHTML = '';

  // Skip the dot for Starred tag since it has a star icon
  if (selectedTag.id !== TAG_STARRED) {
    const dot = document.createElement('span');
    dot.className = 'label-dot';
    dot.textContent = '●';
    if (selectedTag.color) {
      dot.style.color = selectedTag.color;
    }
    labelFilterText.appendChild(dot);
  }

  const name = document.createElement('span');
  name.className = 'label-name';
  name.textContent = selectedTag.name;

  labelFilterText.appendChild(name);
}

function getSelectedTagName() {
  if (!currentTagState || !selectedTagId) return t('popup_default_tag_name');
  const tag = currentTagState.tags[selectedTagId];
  return tag ? tag.name : t('popup_default_tag_name');
}

function applyLocalizedUiUpdates() {
  localize();
  updateLabelFilterButton();
  if (currentTagState) {
    const filtered = getFilteredStreamersByTag(currentFollows, currentTagState, selectedTagId);
    renderStarred(filtered);
  }
  if (loadingTextEl) {
    loadingTextEl.textContent = t('popup_loading_indicator');
  }
}

function sortStreamersForDisplay(a, b) {
  const startedAtA = a?.startedAt ? Date.parse(a.startedAt) : Number.NaN;
  const startedAtB = b?.startedAt ? Date.parse(b.startedAt) : Number.NaN;

  const aHasStart = Number.isFinite(startedAtA);
  const bHasStart = Number.isFinite(startedAtB);

  if (aHasStart && bHasStart && startedAtA !== startedAtB) {
    return startedAtB - startedAtA;
  }

  if (aHasStart && !bHasStart) return -1;
  if (!aHasStart && bHasStart) return 1;

  return (b?.viewerCount || 0) - (a?.viewerCount || 0);
}

function getFilteredStreamersByTag(follows = [], tagState, tagId = selectedTagId) {
  if (!Array.isArray(follows) || !tagState || !tagId) return [];

  const assignments = tagState.assignments || {};

  return follows
    .filter((streamer) => {
      if (!streamer?.isLive) return false;
      const streamerTags = assignments[streamer.id];
      if (!Array.isArray(streamerTags)) return false;
      return streamerTags.includes(tagId);
    })
    .sort(sortStreamersForDisplay);
}

/**
 * Check if a tab URL qualifies for "smart" opening
 * (i.e., it's blank or already on Twitch)
 */
function isTabSmartOpenable(url) {
  if (!url) return true; // Treat missing URL as blank

  // Check if it's a blank tab
  const blankPages = [
    'about:blank',
    'chrome://newtab/',
    'edge://newtab/',
    'about:newtab',
    'chrome://new-tab-page/',
  ];
  if (blankPages.some(page => url.startsWith(page))) {
    return true;
  }

  // Check if it's already on Twitch
  if (url.startsWith('https://www.twitch.tv') || url.startsWith('https://twitch.tv')) {
    return true;
  }

  return false;
}

async function saveSelectedTag() {
  try {
    const prefs = await getPreferences();
    await setPreferences({ ...prefs, popupSelectedTagId: selectedTagId });
  } catch (error) {
    console.error('Failed to save selected tag:', error);
  }
}

async function loadSelectedTag() {
  try {
    const prefs = await getPreferences();
    const saved =
      (typeof prefs.popupSelectedTagId === 'string' && prefs.popupSelectedTagId) ||
      (typeof prefs.selectedTagId === 'string' && prefs.selectedTagId) ||
      null;
    if (saved) {
      selectedTagId = saved;
    }
  } catch (error) {
    console.error('Failed to load selected tag:', error);
  }
}

function renderStarred(streamers) {
  if (!listEl) return;
  listEl.innerHTML = '';
  if (!streamers.length) {
    const tagName = getSelectedTagName();
    setMessage(t('popup_no_live_streamers', [tagName]), 'secondary');
    return;
  }
  setMessage('');

  streamers.forEach((streamer) => {
    const item = document.createElement('li');
    item.className = 'starred-item';

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'starred-card';
    button.addEventListener('click', async (event) => {
      if (!streamer.login) return;
      const url = `https://www.twitch.tv/${streamer.login}`;

      // Determine if we should open in current tab based on the setting and Shift key
      let shouldOpenInCurrentTab = false;

      if (openInCurrentTab === 'never') {
        // Never open in current tab (unless Shift is pressed to override)
        shouldOpenInCurrentTab = event.shiftKey;
      } else if (openInCurrentTab === 'always') {
        // Always open in current tab (unless Shift is pressed to override)
        shouldOpenInCurrentTab = !event.shiftKey;
      } else if (openInCurrentTab === 'smart') {
        // Smart mode: check if current tab is blank or on Twitch
        if (extension?.tabs?.query) {
          try {
            const [activeTab] = await extension.tabs.query({ active: true, currentWindow: true });
            const isSmartOpenable = activeTab?.url ? isTabSmartOpenable(activeTab.url) : true;
            // Use smart logic, but allow Shift to override
            shouldOpenInCurrentTab = isSmartOpenable ? !event.shiftKey : event.shiftKey;
          } catch (error) {
            console.error('Failed to query active tab', error);
            // Fallback to new tab if we can't check
            shouldOpenInCurrentTab = event.shiftKey;
          }
        } else {
          // If we can't query tabs, fallback to never (new tab)
          shouldOpenInCurrentTab = event.shiftKey;
        }
      }

      // Open in current tab if determined above
      if (shouldOpenInCurrentTab && extension?.tabs?.query && extension?.tabs?.update) {
        try {
          const [activeTab] = await extension.tabs.query({ active: true, currentWindow: true });
          if (activeTab?.id) {
            await extension.tabs.update(activeTab.id, { url });
            window.close();
            return;
          }
        } catch (error) {
          console.error('Failed to update active tab', error);
        }
      }

      // Otherwise open in new tab
      if (extension?.tabs?.create) {
        extension.tabs.create({ url });
        window.close();
      } else {
        window.open(url, '_blank', 'noopener');
      }
    });

    // Handle middle mouse button click
    button.addEventListener('auxclick', async (event) => {
      if (event.button === 1 && streamer.login) {
        event.preventDefault();
        const url = `https://www.twitch.tv/${streamer.login}`;
        if (extension?.tabs?.create) {
          extension.tabs.create({ url, active: false });
        } else {
          window.open(url, '_blank', 'noopener');
        }
      }
    });

    const avatar = document.createElement('img');
    avatar.className = 'starred-avatar';
    avatar.src = streamer.avatarUrl || '../assets/icons/icon48.png';
    avatar.alt = `${streamer.displayName || streamer.login} avatar`;

    const body = document.createElement('div');
    body.className = 'starred-body';

    const titleRow = document.createElement('div');
    titleRow.className = 'starred-title-row';

    const titleText = document.createElement('div');
    titleText.className = 'starred-title';
    titleText.textContent = streamer.displayName || streamer.login;

    const titleMeta = document.createElement('div');
    titleMeta.className = 'starred-title-meta';

    if (streamer.viewerCount != null) {
      const viewerNumber = document.createElement('span');
      viewerNumber.className = 'starred-viewers';
      viewerNumber.textContent = formatViewerCount(streamer.viewerCount);
      appendMetaSegment(titleMeta, viewerNumber, 'starred-meta-separator');
    }

    const uptimeText = formatUptime(streamer.startedAt, '');
    if (uptimeText) {
      const uptimeValue = document.createElement('span');
      uptimeValue.className = 'starred-uptime';
      uptimeValue.textContent = uptimeText;
      appendMetaSegment(titleMeta, uptimeValue, 'starred-meta-separator');
    }

    titleRow.appendChild(titleText);
    titleRow.appendChild(titleMeta);

    const meta = document.createElement('div');
    meta.className = 'starred-meta';

    if (streamer.gameName) {
      const gameSpan = document.createElement('span');
      gameSpan.className = 'starred-game';
      gameSpan.textContent = streamer.gameName;
      appendMetaSegment(meta, gameSpan, 'starred-meta-separator');
    }

    const description = document.createElement('div');
    description.className = 'starred-description';
    description.textContent = streamer.title || t('popup_no_title');

    body.appendChild(titleRow);
    body.appendChild(meta);
    body.appendChild(description);

    button.appendChild(avatar);

    if (streamer.thumbnailUrl) {
      const previewWrapper = document.createElement('div');
      previewWrapper.className = 'starred-preview-wrapper';

      const preview = document.createElement('img');
      preview.className = 'starred-preview';
      preview.src = streamer.thumbnailUrl;
      preview.alt = `${streamer.displayName || streamer.login} live preview`;
      preview.loading = 'lazy';

      previewWrapper.appendChild(preview);
      button.appendChild(previewWrapper);
      button.classList.add('has-preview');
    }

    button.appendChild(body);

    item.appendChild(button);
    listEl.appendChild(item);
  });
}

async function restoreFromSnapshot() {
  try {
    const snapshot = await getPopupSnapshot();
    if (!snapshot) return false;

    const {
      hasAuth = false,
      follows = [],
      tagState = null,
      preferences = null,
    } = snapshot;

    if (loadingTextEl) {
      loadingTextEl.textContent = t('popup_loading_indicator');
    }

    applyPreferences(preferences);

    currentFollows = Array.isArray(follows) ? follows : [];

    if (tagState) {
      populateLabelFilter(tagState);
    }

    if (!hasAuth) {
      renderStarred([]);
      setMessage('');
      showSignin(true);
      return true;
    }

    showSignin(false);

    if (tagState) {
      const filtered = getFilteredStreamersByTag(currentFollows, tagState, selectedTagId);
      renderStarred(filtered);
    }

    return true;
  } catch (error) {
    console.error('Failed to restore popup snapshot:', error);
    return false;
  }
}

async function fetchStarred(force = false) {
  if (loadingTextEl) {
    loadingTextEl.textContent = t('popup_loading_indicator');
  }

  showLoading(true);
  try {
    const response = await sendRuntimeMessage({ type: 'data:request', force });
    if (!response || !response.ok) {
      throw new Error(response?.error || t('popup_error_load_data'));
    }
    const { auth, follows = [], tagState, preferences, fetchedAt = null } = response.data || {};

    currentFollows = Array.isArray(follows) ? follows : [];

    applyPreferences(preferences);

    // Populate label filter dropdown
    if (tagState) {
      populateLabelFilter(tagState);
    }

    if (!auth) {
      currentFollows = [];
      await clearPopupSnapshot();
      renderStarred([]);
      setMessage('');
      showSignin(true);
      return;
    }

    showSignin(false);

    const filtered = getFilteredStreamersByTag(currentFollows, tagState, selectedTagId);
    renderStarred(filtered);

    try {
      await setPopupSnapshot({
        hasAuth: true,
        follows: currentFollows,
        tagState,
        preferences,
        fetchedAt,
      });
    } catch (storageError) {
      console.error('Failed to cache popup snapshot:', storageError);
    }
  } catch (error) {
    const message = t(
      'popup_error_unable_dashboard',
      'Unable to load streamers. Open the dashboard for full controls.',
    );
    handleUserError(error, message);
    setMessage(message, 'danger');
  } finally {
    showLoading(false);
  }
}

function handleTabResult() {
  const error = extension.runtime.lastError;
  if (error) {
    console.error('Failed to open dashboard', error);
    setMessage(
      t(
        'popup_error_open_dashboard',
        'Unable to open the dashboard automatically. Please open it from chrome://extensions.',
      ),
      'danger',
    );
  } else {
    window.close();
  }
}

async function openDashboard(event) {
  event.preventDefault();
  const url = extension.runtime.getURL('app/app.html');

  if (extension?.tabs?.query && extension?.tabs?.update) {
    try {
      const tabs = await extension.tabs.query({});
      const existingTab = tabs.find(tab => tab.url === url);

      if (existingTab) {
        await extension.tabs.update(existingTab.id, { active: true });
        if (existingTab.windowId) {
          await extension.windows.update(existingTab.windowId, { focused: true });
        }
        window.close();
        return;
      }
    } catch (error) {
      console.error('Failed to query/focus existing tab', error);
    }
  }

  if (extension?.tabs?.create) {
    extension.tabs.create({ url }, handleTabResult);
  } else {
    window.open(url, '_blank', 'noopener');
    window.close();
  }
}

openButton?.addEventListener('click', openDashboard);

function openSettings(event) {
  event.preventDefault();

  const handleFailure = (err) => {
    if (err) {
      console.error('Failed to open settings', err);
    }
    setMessage(
      t('popup_error_open_settings'),
      'danger',
    );
  };

  const handleSuccess = () => {
    window.close();
  };

  if (typeof extension?.runtime?.openOptionsPage === 'function') {
    try {
      const maybePromise = extension.runtime.openOptionsPage(() => {
        const runtimeError = extension.runtime.lastError;
        if (runtimeError) {
          handleFailure(runtimeError);
          return;
        }
        handleSuccess();
      });
      if (maybePromise && typeof maybePromise.then === 'function') {
        maybePromise.then(handleSuccess).catch(handleFailure);
        return;
      }
      return;
    } catch (error) {
      handleFailure(error);
      return;
    }
  }

  const url = extension.runtime.getURL('options/options.html');
  try {
    window.open(url, '_blank', 'noopener');
    handleSuccess();
  } catch (error) {
    handleFailure(error);
  }
}

settingsButton?.addEventListener('click', openSettings);

refreshButton?.addEventListener('click', async () => {
  if (refreshButton.disabled) return;
  refreshButton.disabled = true;
  try {
    await fetchStarred(true);
  } catch (error) {
    handleUserError(error, t('popup_error_refresh'));
  } finally {
    refreshButton.disabled = false;
  }
});

notificationToggleButton?.addEventListener('click', async () => {
  if (notificationToggleButton.disabled) return;
  notificationToggleButton.disabled = true;
  try {
    const newState = !notificationsEnabled;
    await sendRuntimeMessage({
      type: 'preferences:update',
      preferences: { notificationsEnabled: newState }
    });
    updateNotificationIcon(newState);
  } catch (error) {
    handleUserError(error, t('popup_error_toggle_notifications'));
  } finally {
    notificationToggleButton.disabled = false;
  }
});

signinButton?.addEventListener('click', async () => {
  if (signinButton.disabled) return;
  signinButton.disabled = true;

  const buttonText = signinButton.querySelector('.signin-button-text');
  const spinner = signinButton.querySelector('.spinner-border');

  if (buttonText) buttonText.hidden = true;
  if (spinner) spinner.hidden = false;

  try {
    const response = await sendRuntimeMessage({ type: 'oauth:start' });
    if (!response || !response.ok) {
      throw new Error(response?.error || t('popup_error_signin_short'));
    }
    await fetchStarred(true);
  } catch (error) {
    const message = (error?.message || '').toLowerCase();
    const isCancelled =
      message.includes('user denied') ||
      message.includes('user did not approve') ||
      message.includes('user cancelled') ||
      message.includes('user canceled') ||
      message.includes('window was closed');

    if (!isCancelled) {
      const signInMessage = t('popup_error_signin');
      handleUserError(error, signInMessage);
      setMessage(signInMessage, 'danger');
    }
  } finally {
    signinButton.disabled = false;
    if (buttonText) buttonText.hidden = false;
    if (spinner) spinner.hidden = true;
  }
});

resetFilterBtn?.addEventListener('click', async () => {
  if (selectedTagId === TAG_STARRED) return;
  selectedTagId = TAG_STARRED;
  updateLabelFilterButton();
  if (currentTagState) {
    const cached = getFilteredStreamersByTag(currentFollows, currentTagState, selectedTagId);
    renderStarred(cached);
  }
  await saveSelectedTag();
  await fetchStarred(false);
});

addRuntimeListener((message) => {
  if (message?.type === 'oauth:status') {
    fetchStarred(false);
    return;
  }

  if (message?.type === 'preferences:language-changed') {
    Promise.resolve(setLanguageOverride(message.languageOverride))
      .then((active) => {
        activeLanguageOverride = active ?? null;
        applyLocalizedUiUpdates();
      })
      .catch((error) => {
        console.error('[Popup] Failed to apply broadcast language change', error);
      });
    return;
  }

  if (message?.type === 'preferences:updated' && message.preferences) {
    if (Object.prototype.hasOwnProperty.call(message.preferences, 'languageOverride')) {
      const nextLocale = message.preferences.languageOverride;
      if (nextLocale === activeLanguageOverride || (nextLocale === 'system' && activeLanguageOverride === null)) {
        return;
      }
      Promise.resolve(setLanguageOverride(nextLocale))
        .then((active) => {
          activeLanguageOverride = active ?? null;
          applyLocalizedUiUpdates();
        })
        .catch((error) => {
          console.error('[Popup] Failed to apply updated language preference', error);
        });
    }
  }
});

(async () => {
  await loadSelectedTag();
  await restoreFromSnapshot();
  await fetchStarred(false);
})();
