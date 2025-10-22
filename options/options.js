import { sendRuntimeMessage, invoke, addRuntimeListener } from '../src/util/extension.js';
import { handleUserError } from '../src/util/errors.js';
import { localize, getMessageStrict, setLanguageOverride } from '../src/util/i18n.js';
import { getPreferences, constants as storageConstants } from '../src/storage/index.js';

let currentLanguagePreference = 'system';
let activeLanguageOverride = null;
const DEFAULT_HIGHLIGHT_COLOR = '#ffd700';
let currentHighlightColor = DEFAULT_HIGHLIGHT_COLOR;

const localizationReady = (async () => {
  try {
    const prefs = await getPreferences();
    currentLanguagePreference = prefs?.languageOverride ?? 'system';
    activeLanguageOverride = await setLanguageOverride(currentLanguagePreference);
  } catch (error) {
    console.error('[Options] Failed to apply language preference', error);
  }
})();

await localizationReady;
localize();

const t = (key, substitutions) => getMessageStrict(key, substitutions);

const escapeHtml = (value) => {
  const div = document.createElement('div');
  div.textContent = String(value ?? '');
  return div.innerHTML;
};

const exportButton = document.getElementById('export-button');
const importInput = document.getElementById('import-input');
const signoutButton = document.getElementById('signout-button');
const statusButton = document.getElementById('status-button');
const notificationsToggle = document.getElementById('notifications-toggle');
const notificationCutoffInput = document.getElementById('notification-cutoff');
const openTabNever = document.getElementById('open-tab-never');
const openTabAlways = document.getElementById('open-tab-always');
const openTabSmart = document.getElementById('open-tab-smart');
const twitchHighlightingToggle = document.getElementById('twitch-highlighting-toggle');
const twitchSidebarTagsToggle = document.getElementById('twitch-sidebar-tags-toggle');
const twitchHighlightColorInput = document.getElementById('twitch-highlight-color');
const twitchHighlightColorHexInput = document.getElementById('twitch-highlight-color-hex');
const twitchHighlightColorResetButton = document.getElementById('twitch-highlight-color-reset');
const debugLoggingToggle = document.getElementById('debug-logging-toggle');
const resetButton = document.getElementById('reset-button');
const statusEl = document.getElementById('status');
const refreshLogButton = document.getElementById('refresh-log');
const clearLogButton = document.getElementById('clear-log');
const exportLogButton = document.getElementById('export-log');
const logEntriesEl = document.getElementById('log-entries');
const languageSelect = document.getElementById('language-select');

const NOTIFICATION_CUTOFF_DEFAULT = storageConstants.DEFAULT_NOTIFICATION_MAX_STREAM_AGE_MINUTES;
const NOTIFICATION_CUTOFF_MIN = storageConstants.MIN_NOTIFICATION_MAX_STREAM_AGE_MINUTES;
const NOTIFICATION_CUTOFF_MAX = storageConstants.MAX_NOTIFICATION_MAX_STREAM_AGE_MINUTES;



function showStatus(message, variant = 'success') {
  statusEl.textContent = message;
  statusEl.className = `alert alert-${variant}`;
  statusEl.classList.remove('d-none');
}

function hideStatus() {
  statusEl.classList.add('d-none');
}

function normalizeNotificationCutoff(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return NOTIFICATION_CUTOFF_DEFAULT;
  }
  const rounded = Math.round(parsed);
  return Math.min(
    NOTIFICATION_CUTOFF_MAX,
    Math.max(NOTIFICATION_CUTOFF_MIN, rounded),
  );
}

function normalizeHighlightColor(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) {
    return null;
  }
  const match = trimmed.match(/^#?([0-9a-f]{6})$/);
  if (!match) {
    return null;
  }
  return `#${match[1]}`;
}

function syncHighlightColorInputs(color) {
  if (twitchHighlightColorInput && color) {
    twitchHighlightColorInput.value = color;
  }
  if (twitchHighlightColorHexInput && color) {
    twitchHighlightColorHexInput.value = color;
  }
}

async function handleExport() {
  hideStatus();
  try {
    const data = await invoke('data:export');
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `twitch-tagger-export-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    setTimeout(() => {
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
    }, 0);
    showStatus(t('options_export_success'));
  } catch (error) {
    const message = error?.message || t('options_export_error');
    handleUserError(error, message);
    showStatus(message, 'danger');
  }
}

async function handleImport(file) {
  hideStatus();
  if (!file) return;
  try {
    const text = await file.text();
    const payload = JSON.parse(text);
    const replacePrompt = t(
      'options_import_replace_prompt',
      'Importing will replace your existing tags and assignments. Continue?'
    );
    if (!window.confirm(replacePrompt)) {
      return;
    }
    await invoke('data:import', { payload });
    showStatus(t('options_import_replace_success'));
  } catch (error) {
    const message = error?.message || t('options_import_error');
    handleUserError(error, message);
    showStatus(message, 'danger');
  } finally {
    importInput.value = '';
  }
}

async function handleSignout() {
  hideStatus();
  const promptMessage = t('options_signout_prompt');
  if (!window.confirm(promptMessage)) return;
  try {
    await invoke('oauth:signout');
    showStatus(t('options_signout_success'), 'warning');
  } catch (error) {
    const message = error?.message || t('options_signout_error');
    handleUserError(error, message);
    showStatus(message, 'danger');
  }
}

async function checkStatus() {
  hideStatus();
  try {
    const auth = await invoke('oauth:status:request');
    if (auth.signedIn) {
      const message = t(
        'options_status_signed_in',
        `Signed in as ${auth.user.displayName} (@${auth.user.login}).`,
        [auth.user.displayName, auth.user.login],
      );
      showStatus(message);
    } else {
      showStatus(t('options_status_signed_out'), 'warning');
    }
  } catch (error) {
    const message = error?.message || t('options_status_error');
    handleUserError(error, message);
    showStatus(message, 'danger');
  }
}

async function loadNotificationPreference() {
  try {
    const data = await invoke('data:request');
    const preferences = data.preferences || {};
    const auth = data.auth;

    const isSignedIn = !!auth;

    notificationsToggle.checked = preferences.notificationsEnabled || false;
    notificationsToggle.disabled = !isSignedIn;

    notificationsToggle.title = isSignedIn
      ? ''
      : t('options_notifications_require_auth');

    if (notificationCutoffInput) {
      const cutoff = normalizeNotificationCutoff(preferences.notificationMaxStreamAgeMinutes);
      notificationCutoffInput.value = cutoff;
      notificationCutoffInput.disabled = !isSignedIn;
      notificationCutoffInput.title = isSignedIn
        ? ''
        : t('options_notifications_require_auth');
    }

    // Handle backwards compatibility for openInCurrentTab
    let openInCurrentTab = preferences.openInCurrentTab;
    if (typeof openInCurrentTab === 'boolean') {
      openInCurrentTab = openInCurrentTab ? 'always' : 'never';
    }
    if (!openInCurrentTab || !['never', 'always', 'smart'].includes(openInCurrentTab)) {
      openInCurrentTab = 'never';
    }

    // Set the appropriate radio button
    if (openTabNever) openTabNever.checked = openInCurrentTab === 'never';
    if (openTabAlways) openTabAlways.checked = openInCurrentTab === 'always';
    if (openTabSmart) openTabSmart.checked = openInCurrentTab === 'smart';

    twitchHighlightingToggle.checked = preferences.twitchHighlighting !== false;
    if (twitchSidebarTagsToggle) {
      twitchSidebarTagsToggle.checked = preferences.twitchSidebarTags !== false;
      twitchSidebarTagsToggle.disabled = false;
    }
    const highlightColor = normalizeHighlightColor(preferences.twitchHighlightColor) || DEFAULT_HIGHLIGHT_COLOR;
    currentHighlightColor = highlightColor;
    syncHighlightColorInputs(highlightColor);
    if (twitchHighlightColorInput) {
      twitchHighlightColorInput.disabled = false;
    }
    if (twitchHighlightColorHexInput) {
      twitchHighlightColorHexInput.disabled = false;
    }
    if (twitchHighlightColorResetButton) {
      twitchHighlightColorResetButton.disabled = false;
    }
    if (debugLoggingToggle) {
      debugLoggingToggle.checked = !!preferences.debugLogging;
      debugLoggingToggle.disabled = false;
    }

    if (resetButton) {
      resetButton.disabled = !isSignedIn;
      resetButton.title = isSignedIn ? '' : t('options_reset_require_auth');
    }
    if (languageSelect) {
      languageSelect.disabled = false;
      languageSelect.value = preferences.languageOverride || 'system';
      currentLanguagePreference = languageSelect.value;
      activeLanguageOverride = currentLanguagePreference === 'system' ? null : currentLanguagePreference;
    }
  } catch (error) {
    console.warn('Failed to load notification preference:', error);
    notificationsToggle.disabled = true;
    if (notificationCutoffInput) {
      notificationCutoffInput.disabled = true;
      notificationCutoffInput.value = NOTIFICATION_CUTOFF_DEFAULT;
    }
    if (resetButton) {
      resetButton.disabled = true;
    }
    if (languageSelect) {
      languageSelect.disabled = true;
    }
    if (debugLoggingToggle) {
      debugLoggingToggle.checked = false;
    }
    if (twitchSidebarTagsToggle) {
      twitchSidebarTagsToggle.checked = true;
      twitchSidebarTagsToggle.disabled = true;
    }
    if (twitchHighlightColorInput) {
      twitchHighlightColorInput.disabled = true;
      twitchHighlightColorInput.value = DEFAULT_HIGHLIGHT_COLOR;
    }
    if (twitchHighlightColorHexInput) {
      twitchHighlightColorHexInput.disabled = true;
      twitchHighlightColorHexInput.value = DEFAULT_HIGHLIGHT_COLOR;
    }
    if (twitchHighlightColorResetButton) {
      twitchHighlightColorResetButton.disabled = true;
    }
    currentHighlightColor = DEFAULT_HIGHLIGHT_COLOR;
  }
}

async function handleNotificationToggle() {
  hideStatus();
  try {
    const enabled = notificationsToggle.checked;
    await invoke('preferences:update', {
      preferences: { notificationsEnabled: enabled }
    });
    const message = enabled
      ? t('options_notifications_enabled')
      : t('options_notifications_disabled');
    showStatus(message, 'success');
  } catch (error) {
    const message = error?.message || t('options_notifications_update_error');
    handleUserError(error, message);
    showStatus(message, 'danger');
    await loadNotificationPreference();
  }
}

async function handleNotificationCutoffChange() {
  if (!notificationCutoffInput) return;
  hideStatus();

  const normalized = normalizeNotificationCutoff(notificationCutoffInput.value);
  notificationCutoffInput.value = normalized;

  try {
    await invoke('preferences:update', {
      preferences: { notificationMaxStreamAgeMinutes: normalized }
    });
    const successMessage = t('options_notifications_cutoff_success', [normalized]);
    showStatus(successMessage, 'success');
  } catch (error) {
    const message = error?.message || t('options_notifications_cutoff_error');
    handleUserError(error, message);
    showStatus(message, 'danger');
    await loadNotificationPreference();
  }
}

async function handleLanguageChange() {
  if (!languageSelect) return;
  hideStatus();

  const selectedValue = languageSelect.value || 'system';
  if (selectedValue === currentLanguagePreference) {
    return;
  }
  languageSelect.disabled = true;

  try {
    await invoke('preferences:update', {
      preferences: { languageOverride: selectedValue },
    });

    const appliedLocale = await setLanguageOverride(selectedValue);
    localize();

    currentLanguagePreference = selectedValue;
    activeLanguageOverride = appliedLocale ?? null;

    const message = t('options_language_update_success');
    showStatus(message, 'success');

    sendRuntimeMessage({
      type: 'preferences:language-changed',
      languageOverride: selectedValue,
    }).catch((error) => {
      console.warn('[Options] Failed to broadcast language change', error);
    });
  } catch (error) {
    const message = error?.message || t('options_language_update_error');
    handleUserError(error, message);
    showStatus(message, 'danger');
  } finally {
    languageSelect.disabled = false;
  }
}

function applyExternalLanguagePreference(locale) {
  const normalized = locale ?? 'system';
  if (normalized === currentLanguagePreference) {
    return;
  }
  currentLanguagePreference = normalized;
  if (languageSelect) {
    languageSelect.disabled = false;
    languageSelect.value = normalized;
  }

  Promise.resolve(setLanguageOverride(normalized))
    .then((active) => {
      activeLanguageOverride = active ?? null;
      localize();
    })
    .catch((error) => {
      console.error('[Options] Failed to apply external language preference', error);
    });
}

async function handleOpenInCurrentTabToggle() {
  hideStatus();
  try {
    // Get the selected radio button value
    let selectedValue = 'never';
    if (openTabNever?.checked) selectedValue = 'never';
    else if (openTabAlways?.checked) selectedValue = 'always';
    else if (openTabSmart?.checked) selectedValue = 'smart';

    await invoke('preferences:update', {
      preferences: { openInCurrentTab: selectedValue }
    });

    const messages = {
      never: t('options_open_never'),
      always: t('options_open_always'),
      smart: t('options_open_smart'),
    };
    const hint = t('options_open_toggle_hint');
    showStatus(`${messages[selectedValue]} ${hint}`, 'success');
  } catch (error) {
    const message = error?.message || t('options_open_error');
    handleUserError(error, message);
    showStatus(message, 'danger');
    await loadNotificationPreference();
  }
}

async function persistHighlightColor(color, { successMessageKey, forceMessage } = {}) {
  if (!color) {
    syncHighlightColorInputs(currentHighlightColor);
    showStatus(t('options_highlight_color_invalid'), 'danger');
    return;
  }

  if (color === currentHighlightColor) {
    syncHighlightColorInputs(color);
    if (forceMessage && successMessageKey) {
      showStatus(t(successMessageKey), 'success');
    }
    return;
  }

  try {
    await invoke('preferences:update', {
      preferences: { twitchHighlightColor: color }
    });
    currentHighlightColor = color;
    syncHighlightColorInputs(color);
    const key = successMessageKey || 'options_highlight_color_success';
    showStatus(t(key), 'success');
  } catch (error) {
    const message = error?.message || t('options_highlight_color_error');
    handleUserError(error, message);
    showStatus(message, 'danger');
    syncHighlightColorInputs(currentHighlightColor);
  }
}

async function handleHighlightColorPickerChange() {
  if (!twitchHighlightColorInput) return;
  hideStatus();
  const normalized = normalizeHighlightColor(twitchHighlightColorInput.value);
  await persistHighlightColor(normalized);
}

function previewHighlightColorFromHex(event) {
  if (!twitchHighlightColorInput) return;
  const normalized = normalizeHighlightColor(event.target.value);
  if (normalized) {
    twitchHighlightColorInput.value = normalized;
  }
}

async function handleHighlightColorHexChange() {
  if (!twitchHighlightColorHexInput) return;
  hideStatus();
  const normalized = normalizeHighlightColor(twitchHighlightColorHexInput.value);
  await persistHighlightColor(normalized);
}

async function handleHighlightColorReset() {
  hideStatus();
  await persistHighlightColor(DEFAULT_HIGHLIGHT_COLOR, {
    successMessageKey: 'options_highlight_color_reset_success',
    forceMessage: true,
  });
}

async function handleTwitchHighlightingToggle() {
  hideStatus();
  try {
    const enabled = twitchHighlightingToggle.checked;
    await invoke('preferences:update', {
      preferences: { twitchHighlighting: enabled }
    });
    const message = enabled
      ? t('options_highlighting_enabled')
      : t('options_highlighting_disabled');
    showStatus(message, 'success');
  } catch (error) {
    const message = error?.message || t('options_highlighting_error');
    handleUserError(error, message);
    showStatus(message, 'danger');
    await loadNotificationPreference();
  }
}

async function handleTwitchSidebarTagsToggle() {
  if (!twitchSidebarTagsToggle) return;
  hideStatus();
  try {
    const enabled = twitchSidebarTagsToggle.checked;
    await invoke('preferences:update', {
      preferences: { twitchSidebarTags: enabled }
    });
    const message = enabled
      ? t('options_sidebar_tags_enabled')
      : t('options_sidebar_tags_disabled');
    showStatus(message, 'success');
  } catch (error) {
    const message = error?.message || t('options_sidebar_tags_error');
    handleUserError(error, message);
    showStatus(message, 'danger');
    await loadNotificationPreference();
  }
}

async function handleDebugLoggingToggle() {
  if (!debugLoggingToggle) return;
  hideStatus();
  try {
    const enabled = debugLoggingToggle.checked;
    await invoke('preferences:update', {
      preferences: { debugLogging: enabled }
    });
    const message = enabled
      ? t('options_debug_logging_enabled')
      : t('options_debug_logging_disabled');
    showStatus(message, 'success');
  } catch (error) {
    const message = error?.message || t('options_debug_logging_error');
    handleUserError(error, message);
    showStatus(message, 'danger');
    await loadNotificationPreference();
  }
}

async function handleReset() {
  hideStatus();
  if (!resetButton || resetButton.disabled) return;

  const confirmPrimary = window.confirm(
    t(
      'options_reset_confirm_primary',
      'Reset all tags and favorites? This will delete every custom tag and clear starred streamers.',
    ),
  );
  if (!confirmPrimary) return;
  if (!window.confirm(t('options_reset_confirm_secondary'))) return;

  const originalText = resetButton.textContent;
  resetButton.disabled = true;
  resetButton.textContent = t('options_resetting_label');

  try {
    await invoke('data:reset');
    showStatus(t('options_reset_success'), 'warning');
  } catch (error) {
    const message = error?.message || t('options_reset_error');
    handleUserError(error, message);
    showStatus(message, 'danger');
  } finally {
    resetButton.textContent = originalText;
    await loadNotificationPreference();
  }
}

async function loadUpdateLog() {
  try {
    const data = await invoke('debug:getLog');
    const logs = data.logs || [];

    if (!logs.length) {
      const emptyMessage = escapeHtml(t('options_log_empty'));
      logEntriesEl.innerHTML = `<tr><td colspan="7" class="text-center text-muted">${emptyMessage}</td></tr>`;
      return;
    }

    const skippedLabel = escapeHtml(t('options_log_status_skipped'));
    const successLabel = escapeHtml(t('options_log_status_success'));
    const failedLabel = escapeHtml(t('options_log_status_failed'));
    const unknownError = t('options_log_unknown_error');

    logEntriesEl.innerHTML = logs.reverse().map((entry) => {
      const date = new Date(entry.timestamp);
      const timeStr = escapeHtml(date.toLocaleString());
      const triggerBadge = getTriggerBadge(entry.trigger);

      let statusBadge;
      if (entry.skipped) {
        const skipReasonValue = entry.skipped === 'no_auth'
          ? t('options_log_skip_no_auth')
          : entry.skipped === 'no_cache'
            ? t('options_log_skip_no_cache')
            : entry.skipped;
        const skipReason = escapeHtml(skipReasonValue);
        const skipTitle = escapeHtml(
          t('options_log_skipped_title', [skipReasonValue]),
        );
        statusBadge = `<span class="badge bg-secondary" title="${skipTitle}">${skippedLabel}</span>`;
      } else if (entry.success) {
        statusBadge = `<span class="badge bg-success">${successLabel}</span>`;
      } else {
        const errorTextValue = entry.error || unknownError;
        const errorText = escapeHtml(errorTextValue);
        const failedTitle = escapeHtml(
          t('options_log_failed_title', errorTextValue, [errorTextValue]),
        );
        statusBadge = `<span class="badge bg-danger" title="${failedTitle}">${failedLabel}</span>`;
      }

      return `
        <tr>
          <td><small>${timeStr}</small></td>
          <td>${triggerBadge}</td>
          <td>${entry.liveCount || 0}</td>
          <td>${entry.starredCount || 0}</td>
          <td><small>${formatDuration(entry.cacheAge)}</small></td>
          <td><small>${formatDuration(entry.duration)}</small></td>
          <td>${statusBadge}</td>
        </tr>
      `;
    }).join('');
  } catch (error) {
    console.error('Failed to load update log:', error);
    const errorMessage = escapeHtml(t('options_log_load_error'));
    logEntriesEl.innerHTML = `<tr><td colspan="7" class="text-center text-danger">${errorMessage}</td></tr>`;
  }
}

function getTriggerBadge(trigger) {
  const classes = {
    alarm: 'bg-primary',
    manual: 'bg-info',
    fallback: 'bg-warning',
    initialization: 'bg-secondary',
  };
  const labels = {
    alarm: t('options_log_trigger_alarm'),
    manual: t('options_log_trigger_manual'),
    fallback: t('options_log_trigger_fallback'),
    initialization: t('options_log_trigger_initialization'),
  };
  const label = labels[trigger] || t('options_log_trigger_unknown');
  const badgeClass = classes[trigger] || 'bg-secondary';
  return `<span class="badge ${badgeClass}">${escapeHtml(label)}</span>`;
}

function formatDuration(ms) {
  if (!ms || ms === 0) return '-';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

async function handleClearLog() {
  hideStatus();
  if (!window.confirm(t('options_log_clear_prompt'))) return;
  
  try {
    await invoke('debug:clearLog');
    showStatus(t('options_log_clear_success'), 'success');
    await loadUpdateLog();
  } catch (error) {
    const message = error?.message || t('options_log_clear_error');
    handleUserError(error, message);
    showStatus(message, 'danger');
  }
}

async function handleExportLog() {
  hideStatus();
  try {
    const data = await invoke('debug:getLog');
    const json = JSON.stringify(data.logs, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `twitch-tagger-update-log-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    setTimeout(() => {
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
    }, 0);
    showStatus(t('options_log_export_success'));
  } catch (error) {
    const message = error?.message || t('options_log_export_error');
    handleUserError(error, message);
    showStatus(message, 'danger');
  }
}

function init() {
  exportButton.addEventListener('click', handleExport);
  importInput.addEventListener('change', (event) => handleImport(event.target.files?.[0]));
  signoutButton.addEventListener('click', handleSignout);
  statusButton.addEventListener('click', checkStatus);
  notificationsToggle.addEventListener('change', handleNotificationToggle);
  notificationCutoffInput?.addEventListener('change', handleNotificationCutoffChange);
  openTabNever?.addEventListener('change', handleOpenInCurrentTabToggle);
  openTabAlways?.addEventListener('change', handleOpenInCurrentTabToggle);
  openTabSmart?.addEventListener('change', handleOpenInCurrentTabToggle);
  twitchHighlightingToggle.addEventListener('change', handleTwitchHighlightingToggle);
  twitchSidebarTagsToggle?.addEventListener('change', handleTwitchSidebarTagsToggle);
  twitchHighlightColorInput?.addEventListener('change', handleHighlightColorPickerChange);
  twitchHighlightColorHexInput?.addEventListener('input', previewHighlightColorFromHex);
  twitchHighlightColorHexInput?.addEventListener('change', handleHighlightColorHexChange);
  twitchHighlightColorResetButton?.addEventListener('click', handleHighlightColorReset);
  debugLoggingToggle?.addEventListener('change', handleDebugLoggingToggle);
  resetButton?.addEventListener('click', handleReset);
  refreshLogButton.addEventListener('click', loadUpdateLog);
  clearLogButton.addEventListener('click', handleClearLog);
  exportLogButton.addEventListener('click', handleExportLog);
  languageSelect?.addEventListener('change', handleLanguageChange);

  loadNotificationPreference();
  loadUpdateLog();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

addRuntimeListener((message) => {
  if (message?.type === 'preferences:language-changed') {
    applyExternalLanguagePreference(message.languageOverride);
    return;
  }

  if (message?.type === 'preferences:updated' && message.preferences) {
    if (Object.prototype.hasOwnProperty.call(message.preferences, 'languageOverride')) {
      applyExternalLanguagePreference(message.preferences.languageOverride);
    }
    loadNotificationPreference();
  }
});
