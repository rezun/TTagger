import { addRuntimeListener, invoke, extension } from '../src/util/extension.js';
import { handleUserError } from '../src/util/errors.js';
import { resolveTagColor } from '../src/util/formatters.js';
import { DASHBOARD_REFRESH_INTERVAL_MS } from '../src/config.js';
import { localize, getMessageStrict, setLanguageOverride } from '../src/util/i18n.js';
import {
  TAG_STARRED,
  TAG_ALL,
  THEME_SYSTEM,
  THEME_DARK,
  THEME_LIGHT,
  DEFAULT_TAG_COLOR,
  TAG_COLOR_PRESETS,
  MOBILE_BREAKPOINT,
  PREFERENCE_SYNC_DELAY,
} from '../src/util/constants.js';
import {
  state,
  setAuth,
  setFollows,
  setTagState,
  mergePreferences,
  setFetchedAt,
  setLoading,
} from '../src/app/state.js';
import {
  renderApp,
  closeOpenMenus,
  updateLiveToggleAppearance,
  updateStarredToggleAppearance,
  lastUpdatedText,
} from '../src/app/render.js';
import { sortTagsByOrder } from '../src/util/sorting.js';
import { getPreferences } from '../src/storage/index.js';

const localizationReady = (async () => {
  try {
    const prefs = await getPreferences();
    const languagePreference = prefs?.languageOverride ?? 'system';
    await setLanguageOverride(languagePreference);
  } catch (error) {
    console.error('[App] Failed to apply language preference', error);
  }
})();

await localizationReady;
localize();

const t = (key, substitutions) => getMessageStrict(key, substitutions);

const elements = {
  loginButton: document.getElementById('login-button'),
  settingsButton: document.getElementById('settings-button'),
  userLabel: document.getElementById('user-label'),
  themeInputs: Array.from(document.querySelectorAll('input[name="theme-mode"]')),
  nameFilterInput: document.getElementById('name-filter'),
  clearNameFilter: document.getElementById('clear-name-filter'),
  contentFilterInput: document.getElementById('content-filter'),
  clearContentFilter: document.getElementById('clear-content-filter'),
  sortSelect: document.getElementById('sort-select'),
  liveToggle: document.getElementById('live-toggle'),
  liveToggleLabel: document.getElementById('live-toggle-label'),
  starredToggle: document.getElementById('starred-toggle'),
  starredToggleLabel: document.getElementById('starred-toggle-label'),
  refreshButton: document.getElementById('refresh-button'),
  tagList: document.getElementById('tag-list'),
  addTagButton: document.getElementById('add-tag-button'),
  reorderTagsButton: document.getElementById('reorder-tags-button'),
  streamerContainer: document.getElementById('streamer-container'),
  streamerCount: document.getElementById('streamer-count'),
  updatedLabel: document.getElementById('updated-label'),
  tagPane: document.getElementById('tag-sidebar'),
  tagPaneToggle: document.getElementById('tag-pane-toggle'),
  tagPaneClose: document.getElementById('tag-pane-close'),
};

const tagPaneMediaQuery = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`);
const prefersDark = window.matchMedia('(prefers-color-scheme: dark)');

let preferenceSyncHandle = null;
let isRefreshing = false;
let isMoveMode = false;
let autoRefreshInterval = null;
let isTagOperationInProgress = false;
let updatedLabelInterval = null;

/**
 * Debounce a function to reduce the frequency of calls
 * @param {Function} func - Function to debounce
 * @param {number} delay - Delay in milliseconds
 * @returns {Function} - Debounced function
 */
function debounce(func, delay) {
  let timeoutId = null;
  return function debounced(...args) {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    timeoutId = setTimeout(() => {
      func.apply(this, args);
    }, delay);
  };
}

/**
 * Wrapper for tag operations to provide loading state feedback
 * @param {Function} operation - Async operation to wrap
 * @returns {Promise} - Result of operation
 */
async function withTagOperationLoading(operation) {
  if (isTagOperationInProgress) {
    console.warn('[App] Tag operation already in progress, ignoring request');
    return;
  }

  isTagOperationInProgress = true;
  if (elements.addTagButton) {
    updateSpinner(elements.addTagButton, true);
  }

  try {
    return await operation();
  } finally {
    isTagOperationInProgress = false;
    if (elements.addTagButton) {
      updateSpinner(elements.addTagButton, false);
    }
  }
}

function resolveTheme(mode) {
  if (mode === THEME_DARK) return THEME_DARK;
  if (mode === THEME_LIGHT) return THEME_LIGHT;
  return prefersDark.matches ? THEME_DARK : THEME_LIGHT;
}

function applyTheme(mode) {
  const resolved = resolveTheme(mode);
  document.documentElement.setAttribute('data-bs-theme', resolved);
  elements.themeInputs.forEach((input) => {
    input.checked = input.value === mode;
  });
}

function updateLastUpdatedLabel() {
  if (!elements.updatedLabel) return;
  if (!state.fetchedAt) {
    elements.updatedLabel.textContent = '';
    return;
  }
  elements.updatedLabel.textContent = lastUpdatedText(state.fetchedAt);
}

function startUpdatedLabelTimer() {
  if (updatedLabelInterval) return;
  updateLastUpdatedLabel();
  updatedLabelInterval = setInterval(updateLastUpdatedLabel, 60000);
}

function stopUpdatedLabelTimer() {
  if (!updatedLabelInterval) return;
  clearInterval(updatedLabelInterval);
  updatedLabelInterval = null;
}

function handleSystemThemeChange() {
  if (state.preferences.themeMode === THEME_SYSTEM) {
    applyTheme(THEME_SYSTEM);
  }
}

function updateSpinner(button, loading) {
  if (!button) return;
  button.disabled = !!loading;
  if (loading) {
    if (!button.dataset.originalText) {
      button.dataset.originalText = button.textContent;
    }
    button.textContent = t('app_working_status');
  } else if (button.dataset.originalText) {
    button.textContent = button.dataset.originalText;
    delete button.dataset.originalText;
  }
}

/**
 * Escape HTML special characters to prevent XSS
 * WARNING: Only use this for simple text content, not for complex HTML structures
 * @param {string} str - String to escape
 * @returns {string} Escaped string
 */
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = String(str || '');
  return div.innerHTML;
}

/**
 * Show a custom input modal dialog
 * @param {string} title - Modal title (will be HTML-escaped)
 * @param {string} placeholder - Input placeholder text (will be HTML-escaped)
 * @param {string} initialValue - Initial input value (will be HTML-escaped)
 * @returns {Promise<string|null>} - Resolved with input value or null if cancelled
 * @warning All parameters are escaped to prevent XSS attacks
 */
function showInputModal(title, placeholder = '', initialValue = '') {
  return new Promise((resolve) => {
    // Create AbortController for automatic event listener cleanup
    const abortController = new AbortController();
    const { signal } = abortController;

    // Create modal backdrop
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop fade';
    document.body.appendChild(backdrop);
    setTimeout(() => backdrop.classList.add('show'), 10);

    // Create modal
    const modal = document.createElement('div');
    modal.className = 'modal fade';
    modal.tabIndex = -1;
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'modalTitle');
    // Safe: All user-controlled parameters are HTML-escaped to prevent XSS
    const closeLabel = escapeHtml(t('common_close'));
    const cancelText = escapeHtml(t('common_cancel'));
    const okText = escapeHtml(t('common_ok'));
    modal.innerHTML = `
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title" id="modalTitle">${escapeHtml(title)}</h5>
            <button type="button" class="btn-close" data-dismiss="modal" aria-label="${closeLabel}"></button>
          </div>
          <div class="modal-body">
            <input type="text" class="form-control" placeholder="${escapeHtml(placeholder)}" value="${escapeHtml(initialValue)}" maxlength="50" aria-label="${escapeHtml(placeholder)}">
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" data-dismiss="modal">${cancelText}</button>
            <button type="button" class="btn btn-primary" data-submit="modal">${okText}</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    const input = modal.querySelector('input');
    const cancelButtons = modal.querySelectorAll('[data-dismiss="modal"]');
    const submitBtn = modal.querySelector('[data-submit="modal"]');

    const cleanup = () => {
      // Abort all event listeners
      abortController.abort();

      modal.classList.remove('show');
      backdrop.classList.remove('show');
      setTimeout(() => {
        modal.remove();
        backdrop.remove();
        document.body.classList.remove('modal-open');
        document.body.style.removeProperty('overflow');
        document.body.style.removeProperty('padding-right');
      }, 150);
    };

    const handleSubmit = () => {
      const value = input.value.trim();
      if (!value) {
        input.focus();
        return;
      }
      cleanup();
      resolve(value);
    };

    const handleCancel = () => {
      cleanup();
      resolve(null);
    };

    // Use AbortController signal for automatic cleanup
    submitBtn.addEventListener('click', handleSubmit, { signal });
    cancelButtons.forEach(btn => btn.addEventListener('click', handleCancel, { signal }));

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleSubmit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        handleCancel();
      }
    }, { signal });

    backdrop.addEventListener('click', handleCancel, { signal });

    // Show modal
    document.body.classList.add('modal-open');
    document.body.style.overflow = 'hidden';
    setTimeout(() => {
      modal.classList.add('show');
      modal.style.display = 'block';
      input.focus();
      input.select();
    }, 10);
  });
}

/**
 * Show a custom confirmation modal dialog
 * @param {string} title - Modal title (will be HTML-escaped)
 * @param {string} message - Confirmation message (will be HTML-escaped)
 * @param {string} confirmText - Confirm button text (will be HTML-escaped)
 * @param {string} variant - Button variant (primary, danger, etc.) (will be sanitized for CSS class)
 * @returns {Promise<boolean>} - Resolved with true if confirmed, false if cancelled
 * @warning All parameters are escaped to prevent XSS attacks
 */
function showConfirmModal(title, message, confirmText = 'OK', variant = 'danger') {
  return new Promise((resolve) => {
    // Create AbortController for automatic event listener cleanup
    const abortController = new AbortController();
    const { signal } = abortController;

    // Create modal backdrop
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop fade';
    document.body.appendChild(backdrop);
    setTimeout(() => backdrop.classList.add('show'), 10);

    // Create modal
    const modal = document.createElement('div');
    modal.className = 'modal fade';
    modal.tabIndex = -1;
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'modalTitle');
    // Safe: All user-controlled parameters are HTML-escaped to prevent XSS
    // Variant is whitelisted to only allow valid Bootstrap button classes
    const safeVariant = ['primary', 'secondary', 'success', 'danger', 'warning', 'info', 'light', 'dark'].includes(variant) ? variant : 'danger';
    const closeLabel = escapeHtml(t('common_close'));
    const cancelText = escapeHtml(t('common_cancel'));
    const confirmSafeText = escapeHtml(confirmText || t('common_ok'));
    modal.innerHTML = `
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title" id="modalTitle">${escapeHtml(title)}</h5>
            <button type="button" class="btn-close" data-dismiss="modal" aria-label="${closeLabel}"></button>
          </div>
          <div class="modal-body">
            <p class="mb-0">${escapeHtml(message)}</p>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" data-dismiss="modal">${cancelText}</button>
            <button type="button" class="btn btn-${safeVariant}" data-submit="modal">${confirmSafeText}</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    const cancelButtons = modal.querySelectorAll('[data-dismiss="modal"]');
    const submitBtn = modal.querySelector('[data-submit="modal"]');

    const cleanup = () => {
      // Abort all event listeners
      abortController.abort();

      modal.classList.remove('show');
      backdrop.classList.remove('show');
      setTimeout(() => {
        modal.remove();
        backdrop.remove();
        document.body.classList.remove('modal-open');
        document.body.style.removeProperty('overflow');
        document.body.style.removeProperty('padding-right');
      }, 150);
    };

    const handleConfirm = () => {
      cleanup();
      resolve(true);
    };

    const handleCancel = () => {
      cleanup();
      resolve(false);
    };

    // Use AbortController signal for automatic cleanup
    submitBtn.addEventListener('click', handleConfirm, { signal });
    cancelButtons.forEach(btn => btn.addEventListener('click', handleCancel, { signal }));

    backdrop.addEventListener('click', handleCancel, { signal });

    // Show modal
    document.body.classList.add('modal-open');
    document.body.style.overflow = 'hidden';
    setTimeout(() => {
      modal.classList.add('show');
      modal.style.display = 'block';
      submitBtn.focus();
    }, 10);
  });
}

/**
 * Show a tag color picker modal dialog
 * @param {Object} options - Modal configuration
 * @param {string} options.title - Modal title
 * @param {string} options.initialColor - Initial color value
 * @param {string[]} options.defaultColors - Default color swatches to display
 * @returns {Promise<string|null>} - Resolved with selected color or null if cancelled
 */
function showColorPickerModal({ title, initialColor, defaultColors = [] }) {
  return new Promise((resolve) => {
    const abortController = new AbortController();
    const { signal } = abortController;

    const startingColor = resolveTagColor(initialColor, DEFAULT_TAG_COLOR).toLowerCase();
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop fade';
    document.body.appendChild(backdrop);
    setTimeout(() => backdrop.classList.add('show'), 10);

    const modal = document.createElement('div');
    modal.className = 'modal fade tag-color-modal';
    modal.tabIndex = -1;
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'modalTitle');

    const closeLabel = escapeHtml(t('common_close'));
    const cancelText = escapeHtml(t('common_cancel'));
    const okText = escapeHtml(t('common_ok'));
    const customColorLabel = escapeHtml(t('app_modal_color_custom_label'));
    const customColorHint = escapeHtml(t('app_modal_color_custom_hint'));
    const defaultColorsLabel = escapeHtml(t('app_modal_color_default_label'));
    const defaultColorsAria = escapeHtml(t('app_modal_color_default_aria'));
    modal.innerHTML = `
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title" id="modalTitle">${escapeHtml(title)}</h5>
            <button type="button" class="btn-close" data-dismiss="modal" aria-label="${closeLabel}"></button>
          </div>
          <div class="modal-body">
            <div class="tag-color-picker-body">
              <label class="tag-color-picker-label" for="tagColorPickerInput">${customColorLabel}</label>
              <input
                type="color"
                class="tag-color-picker-input"
                id="tagColorPickerInput"
                value="${escapeHtml(startingColor)}"
                aria-describedby="tagColorPickerHint"
              >
              <div class="tag-color-picker-hint text-muted small" id="tagColorPickerHint">
                ${customColorHint}
              </div>
            </div>
            <div class="tag-color-defaults">
              <span class="tag-color-defaults-label">${defaultColorsLabel}</span>
              <div class="tag-color-defaults-grid" role="listbox" aria-label="${defaultColorsAria}"></div>
            </div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" data-dismiss="modal">${cancelText}</button>
            <button type="button" class="btn btn-primary" data-submit="modal">${okText}</button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    const colorInput = modal.querySelector('#tagColorPickerInput');
    const cancelButtons = modal.querySelectorAll('[data-dismiss="modal"]');
    const submitBtn = modal.querySelector('[data-submit="modal"]');
    const defaultsSection = modal.querySelector('.tag-color-defaults');
    const defaultsGrid = modal.querySelector('.tag-color-defaults-grid');

    const normalizedDefaults = Array.from(
      new Set(
        defaultColors
          .map((color) => resolveTagColor(color, DEFAULT_TAG_COLOR).toLowerCase())
          .filter(Boolean),
      ),
    );

    const swatches = [];
    if (normalizedDefaults.length && defaultsGrid) {
      normalizedDefaults.forEach((color) => {
        const swatch = document.createElement('button');
        swatch.type = 'button';
        swatch.className = 'tag-color-default-swatch';
        swatch.dataset.color = color;
        swatch.setAttribute('role', 'option');
        const swatchLabel = t('app_modal_color_swatch_label', [color]);
        const resolvedLabel = swatchLabel === 'app_modal_color_swatch_label'
          ? `${swatchLabel} ${color}`.trim()
          : swatchLabel;
        swatch.setAttribute('aria-label', resolvedLabel);
        swatch.setAttribute('aria-selected', color === startingColor ? 'true' : 'false');
        swatch.style.backgroundColor = color;
        swatch.title = resolvedLabel;
        swatch.addEventListener('click', () => {
          if (colorInput) {
            colorInput.value = color;
            updateSelectedSwatch(color);
            colorInput.dispatchEvent(new Event('input', { bubbles: true }));
          }
        }, { signal });
        defaultsGrid.appendChild(swatch);
        swatches.push(swatch);
      });
    } else if (defaultsSection) {
      defaultsSection.remove();
    }

    const cleanup = () => {
      abortController.abort();
      modal.classList.remove('show');
      backdrop.classList.remove('show');
      setTimeout(() => {
        modal.remove();
        backdrop.remove();
        document.body.classList.remove('modal-open');
        document.body.style.removeProperty('overflow');
        document.body.style.removeProperty('padding-right');
      }, 150);
    };

    const handleSubmit = () => {
      const result = resolveTagColor(colorInput?.value, DEFAULT_TAG_COLOR);
      cleanup();
      resolve(result);
    };

    const handleCancel = () => {
      cleanup();
      resolve(null);
    };

    const updateSelectedSwatch = (nextColor) => {
      const normalized = resolveTagColor(nextColor, DEFAULT_TAG_COLOR).toLowerCase();
      swatches.forEach((swatch) => {
        const isActive = swatch.dataset.color === normalized;
        swatch.classList.toggle('is-selected', isActive);
        swatch.setAttribute('aria-selected', isActive ? 'true' : 'false');
      });
    };

    if (colorInput) {
      colorInput.addEventListener('input', (event) => {
        updateSelectedSwatch(event.target.value);
      }, { signal });
      colorInput.addEventListener('change', (event) => {
        updateSelectedSwatch(event.target.value);
      }, { signal });
    }

    if (submitBtn) {
      submitBtn.addEventListener('click', handleSubmit, { signal });
    }
    cancelButtons.forEach((btn) => btn.addEventListener('click', handleCancel, { signal }));
    backdrop.addEventListener('click', handleCancel, { signal });

    modal.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        handleCancel();
      } else if (event.key === 'Enter' && (event.target === colorInput || event.target === submitBtn)) {
        event.preventDefault();
        handleSubmit();
      }
    }, { signal });

    updateSelectedSwatch(colorInput?.value ?? startingColor);

    document.body.classList.add('modal-open');
    document.body.style.overflow = 'hidden';
    setTimeout(() => {
      modal.classList.add('show');
      modal.style.display = 'block';
      colorInput?.focus();
    }, 10);
  });
}

async function promptRenameTag(tagId, currentName) {
  const nextName = await showInputModal(
    t('app_modal_rename_tag_title'),
    t('app_modal_tag_name_placeholder'),
    currentName || '',
  );
  if (!nextName || nextName.trim() === currentName) return;

  await withTagOperationLoading(async () => {
    try {
      const data = await invoke('tag:update', { tagId, name: nextName });
      setTagState(data.tagState);
      render();
    } catch (error) {
      handleUserError(error, t('app_error_rename_tag'));
    }
  });
}

async function promptUpdateTagColor(tagId, currentColor) {
  const tagKey = tagId != null ? String(tagId) : null;
  if (!tagKey) {
    console.warn('[App] Cannot update tag color without a tag id');
    return;
  }

  const tagRecord = state.tagState?.tags?.[tagKey] || null;
  const initialColorSource = tagRecord?.color ?? currentColor;
  const initial = resolveTagColor(initialColorSource, DEFAULT_TAG_COLOR);
  const chosen = await showColorPickerModal({
    title: tagRecord?.name
      ? t('app_modal_color_picker_title_named', [tagRecord.name])
      : t('app_modal_color_picker_title_generic'),
    initialColor: initial,
    defaultColors: TAG_COLOR_PRESETS,
  });

  if (!chosen || chosen.toLowerCase() === initial.toLowerCase()) {
    return;
  }

  await withTagOperationLoading(async () => {
    try {
      const nextColor = resolveTagColor(chosen, DEFAULT_TAG_COLOR);
      const payload = { tagId: tagKey, color: nextColor };
      if (tagRecord?.name) {
        payload.name = tagRecord.name;
      }
      const data = await invoke('tag:update', payload);
      setTagState(data.tagState);
      render();
    } catch (error) {
      handleUserError(error, t('app_error_update_tag_color'));
    }
  });
}

async function confirmDeleteTag(tagId, name) {
  const confirmed = await showConfirmModal(
    t('app_modal_delete_tag_title'),
    t('app_modal_delete_tag_message', [name]),
    t('app_modal_delete_tag_confirm'),
    'danger'
  );
  if (!confirmed) return;

  await withTagOperationLoading(async () => {
    try {
      const data = await invoke('tag:remove', { tagId });
      setTagState(data.tagState);
      if (state.preferences.selectedTagId === tagId) {
        mergePreferences({ selectedTagId: TAG_ALL });
      }
      render();
    } catch (error) {
      handleUserError(error, t('app_error_delete_tag'));
    }
  });
}

function selectTag(tagId) {
  mergePreferences({ selectedTagId: tagId ?? TAG_ALL });
  render();
  queuePreferenceSync();
}

function queuePreferenceSync() {
  clearTimeout(preferenceSyncHandle);
  preferenceSyncHandle = setTimeout(() => {
    invoke('preferences:update', { preferences: state.preferences }).catch((error) => {
      console.error('Failed to sync preferences', error);
    });
  }, PREFERENCE_SYNC_DELAY);
}

function applyPreferences(preferences) {
  mergePreferences(preferences);
  if (![THEME_SYSTEM, THEME_DARK, THEME_LIGHT].includes(state.preferences.themeMode)) {
    mergePreferences({ themeMode: THEME_SYSTEM });
  }

  elements.nameFilterInput.value = state.preferences.nameFilter || '';
  elements.clearNameFilter.style.display = state.preferences.nameFilter ? 'block' : 'none';
  elements.contentFilterInput.value = state.preferences.contentFilter || '';
  elements.clearContentFilter.style.display = state.preferences.contentFilter ? 'block' : 'none';
  elements.sortSelect.value = state.preferences.sortBy || 'follow-date-desc';

  elements.liveToggle.checked = !!state.preferences.liveFirst;
  updateLiveToggleAppearance(elements);

  if (elements.starredToggle) {
    elements.starredToggle.checked = !!state.preferences.starredFirst;
    updateStarredToggleAppearance(elements);
  }

  elements.themeInputs.forEach((input) => {
    input.checked = input.value === state.preferences.themeMode;
  });
}

function setTagPaneOpen(open, { skipFocus } = {}) {
  const tagPaneEl = elements.tagPane;
  if (!tagPaneEl) return;

  const isMobile = tagPaneMediaQuery.matches;
  const shouldBeOpen = open || !isMobile;
  tagPaneEl.classList.toggle('is-open', isMobile && shouldBeOpen);
  if (elements.tagPaneToggle) {
    elements.tagPaneToggle.setAttribute('aria-expanded', String(shouldBeOpen));
  }
  if (!shouldBeOpen && isMobile && !skipFocus) {
    elements.tagPaneToggle?.focus();
  }
}

function handleTagPaneMediaChange(event) {
  if (event.matches) {
    setTagPaneOpen(false, { skipFocus: true });
  } else {
    setTagPaneOpen(true, { skipFocus: true });
  }
}

function render() {
  renderApp(elements, getRenderActions(), { isMoveMode });
  updateLastUpdatedLabel();
}

function getRenderActions() {
  return {
    tagList: {
      onSelectTag: selectTag,
      onRenameTag: promptRenameTag,
      onUpdateTagColor: promptUpdateTagColor,
      onDeleteTag: confirmDeleteTag,
    },
    card: {
      onToggleFavorite: async (streamerId, isFavorite) => {
        return withTagOperationLoading(async () => {
          try {
            const data = await invoke('tag:assign', {
              streamerId,
              tagId: TAG_STARRED,
              assign: isFavorite,
            });
            setTagState(data.tagState);
            render();
            return true;
          } catch (error) {
            handleUserError(error, t('app_error_update_favorite'));
            return false;
          }
        });
      },
      onToggleTagAssignment: async (streamerId, tagId, assign) => {
        return withTagOperationLoading(async () => {
          try {
            const data = await invoke('tag:assign', {
              streamerId,
              tagId,
              assign,
            });
            setTagState(data.tagState);
            render();
            return true;
          } catch (error) {
            handleUserError(error, t('app_error_update_tag_assignment'));
            return false;
          }
        });
      },
    },
  };
}

function getCustomTagOrderFromState() {
  const tags = Object.values(state.tagState.tags || {});
  return sortTagsByOrder(tags.filter((tag) => tag && tag.id && tag.id !== TAG_STARRED)).map((tag) => tag.id);
}

async function persistTagOrder(tagIds) {
  const filtered = Array.from(new Set(tagIds.filter(Boolean)));
  const currentOrder = getCustomTagOrderFromState();
  if (
    filtered.length === currentOrder.length &&
    filtered.every((tagId, index) => tagId === currentOrder[index])
  ) {
    return;
  }

  await withTagOperationLoading(async () => {
    try {
      const data = await invoke('tag:reorder', { tagIds: filtered });
      setTagState(data.tagState);
      render();
    } catch (error) {
      handleUserError(error, t('app_error_reorder_tags'));
      render();
    }
  });
}

function resetDragState() {
  const dragging = elements.tagList?.querySelector('.is-dragging');
  if (dragging) {
    dragging.classList.remove('is-dragging');
  }
}

function setMoveMode(enabled) {
  if (!elements.reorderTagsButton) return;
  if (isMoveMode === enabled) {
    return;
  }
  isMoveMode = enabled;
  resetDragState();
  updateMoveButton();
  closeOpenMenus();
  render();
}

function updateMoveButton() {
  const button = elements.reorderTagsButton;
  if (!button) return;
  const active = isMoveMode;
  button.textContent = active
    ? t('common_done')
    : t('app_reorder_tags_button');
  button.setAttribute('aria-pressed', String(active));
  button.classList.toggle('btn-primary', active);
  button.classList.toggle('btn-outline-secondary', !active);
  const label = active
    ? t('app_reorder_tags_finish')
    : t('app_reorder_tags_aria');
  button.setAttribute('aria-label', label);
}

function handleTagDragStart(event) {
  if (!isMoveMode) return;
  const item = event.target.closest('li');
  const tagId = item?.dataset.tagId;
  if (!item || !tagId) {
    event.preventDefault();
    return;
  }
  item.classList.add('is-dragging');
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
    try {
      event.dataTransfer.setData('text/plain', tagId);
    } catch (err) {
      // Some browsers may block setData during devtools drag, ignore.
    }
  }
}

function handleTagDragOver(event) {
  if (!isMoveMode) return;
  const dragging = elements.tagList?.querySelector('.is-dragging');
  if (!dragging) return;
  event.preventDefault();
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'move';
  }

  const targetItem = event.target.closest('li');
  if (!targetItem) {
    elements.tagList?.appendChild(dragging);
    return;
  }

  if (targetItem === dragging) {
    return;
  }

  if (!targetItem.dataset.tagId) {
    return;
  }

  const rect = targetItem.getBoundingClientRect();
  const shouldInsertBefore = event.clientY < rect.top + rect.height / 2;
  if (shouldInsertBefore) {
    targetItem.before(dragging);
  } else {
    targetItem.after(dragging);
  }
}

async function handleTagDrop(event) {
  if (!isMoveMode) return;
  event.preventDefault();
  const dragging = elements.tagList?.querySelector('.is-dragging');
  if (dragging) {
    dragging.classList.remove('is-dragging');
  }
  const orderedIds = Array.from(elements.tagList?.querySelectorAll('[data-tag-id]') || [])
    .map((node) => node.dataset.tagId)
    .filter(Boolean);
  await persistTagOrder(orderedIds);
}

function handleTagDragEnd() {
  resetDragState();
}

async function loadData(force = false) {
  const shouldShowSpinner = !state.fetchedAt;
  setLoading(true);
  if (shouldShowSpinner) {
    render();
  }

  try {
    const payload = await invoke('data:request', { force });
    setAuth(payload.auth || null);
    setFollows(payload.follows || []);
    if (payload.tagState) {
      setTagState(payload.tagState);
    }
    if (payload.preferences) {
      applyPreferences(payload.preferences);
    }
    setFetchedAt(payload.fetchedAt || null);
    applyTheme(state.preferences.themeMode);
  } catch (error) {
    console.error('Failed to load data', error);
  } finally {
    setLoading(false);
    render();
  }
}

function startAutoRefresh() {
  if (autoRefreshInterval) return;
  autoRefreshInterval = setInterval(async () => {
    if (!isRefreshing && state.auth?.user) {
      try {
        await loadData(true);
      } catch (error) {
        console.error('Auto-refresh failed', error);
      }
    }
  }, DASHBOARD_REFRESH_INTERVAL_MS);
}

function stopAutoRefresh() {
  if (autoRefreshInterval) {
    clearInterval(autoRefreshInterval);
    autoRefreshInterval = null;
  }
}

/**
 * Cleanup all timers and pending operations on shutdown
 */
function cleanup() {
  stopAutoRefresh();
  stopUpdatedLabelTimer();
  if (preferenceSyncHandle) {
    clearTimeout(preferenceSyncHandle);
    preferenceSyncHandle = null;
  }
}

function attachEventHandlers() {
  elements.loginButton.addEventListener('click', async () => {
    if (state.auth?.user) {
      return;
    }

    updateSpinner(elements.loginButton, true);
    try {
      await invoke('oauth:start');
      await loadData(true);
    } catch (error) {
      const message = (error?.message || '').toLowerCase();
      const isCancelled =
        message.includes('user denied') ||
        message.includes('user did not approve') ||
        message.includes('user cancelled') ||
        message.includes('user canceled') ||
        message.includes('window was closed');

      if (!isCancelled) {
        handleUserError(error, t('app_error_login'));
      }
    } finally {
      updateSpinner(elements.loginButton, false);
    }
  });

  elements.settingsButton?.addEventListener('click', () => {
    if (typeof extension?.runtime?.openOptionsPage === 'function') {
      try {
        const result = extension.runtime.openOptionsPage();
        if (result && typeof result.catch === 'function') {
          result.catch((error) => {
            console.error('Failed to open settings', error);
            handleUserError(error, t('app_error_open_settings'));
          });
        }
      } catch (error) {
        console.error('Failed to open settings', error);
        handleUserError(error, t('app_error_open_settings'));
      }
    } else {
      const url = extension.runtime.getURL('options/options.html');
      window.open(url, '_blank', 'noopener');
    }
  });

  elements.refreshButton.addEventListener('click', async () => {
    if (isRefreshing) return;
    isRefreshing = true;
    updateSpinner(elements.refreshButton, true);
    try {
      await loadData(true);
    } catch (error) {
      handleUserError(error, t('app_error_refresh_data'));
    } finally {
      updateSpinner(elements.refreshButton, false);
      isRefreshing = false;
    }
  });

  elements.tagPaneToggle?.addEventListener('click', () => {
    const isOpen = elements.tagPane?.classList.contains('is-open');
    setTagPaneOpen(!isOpen);
  });

  elements.tagPaneClose?.addEventListener('click', () => {
    setTagPaneOpen(false);
  });

  // Debounce closeOpenMenus for better performance during scroll/resize
  const debouncedCloseMenus = debounce(closeOpenMenus, 200);

  // Debounce render for filter inputs to avoid lag during rapid typing
  const debouncedRender = debounce(render, 150);

  elements.streamerContainer.addEventListener('scroll', debouncedCloseMenus);

  window.addEventListener('resize', debouncedCloseMenus);

  elements.nameFilterInput.addEventListener('input', (event) => {
    const value = event.target.value;
    mergePreferences({ nameFilter: value });
    elements.clearNameFilter.style.display = value ? 'block' : 'none';
    debouncedRender();
    queuePreferenceSync();
  });

  elements.clearNameFilter?.addEventListener('click', () => {
    elements.nameFilterInput.value = '';
    mergePreferences({ nameFilter: '' });
    elements.clearNameFilter.style.display = 'none';
    render();
    queuePreferenceSync();
  });

  elements.contentFilterInput.addEventListener('input', (event) => {
    const value = event.target.value;
    mergePreferences({ contentFilter: value });
    elements.clearContentFilter.style.display = value ? 'block' : 'none';
    debouncedRender();
    queuePreferenceSync();
  });

  elements.clearContentFilter?.addEventListener('click', () => {
    elements.contentFilterInput.value = '';
    mergePreferences({ contentFilter: '' });
    elements.clearContentFilter.style.display = 'none';
    render();
    queuePreferenceSync();
  });

  elements.sortSelect.addEventListener('change', (event) => {
    mergePreferences({ sortBy: event.target.value });
    render();
    queuePreferenceSync();
  });

  elements.liveToggle.addEventListener('change', (event) => {
    mergePreferences({ liveFirst: event.target.checked });
    updateLiveToggleAppearance(elements);
    render();
    queuePreferenceSync();
  });

  elements.starredToggle?.addEventListener('change', (event) => {
    mergePreferences({ starredFirst: event.target.checked });
    updateStarredToggleAppearance(elements);
    render();
    queuePreferenceSync();
  });

  elements.themeInputs.forEach((input) => {
    input.addEventListener('change', (event) => {
      if (!event.target.checked) return;
      const value = event.target.value;
      mergePreferences({ themeMode: value });
      applyTheme(value);
      queuePreferenceSync();
    });
  });

  elements.addTagButton.addEventListener('click', async () => {
    const name = await showInputModal(
      t('app_modal_new_tag_title'),
      t('app_modal_tag_name_placeholder'),
    );
    if (!name || !name.trim()) return;

    await withTagOperationLoading(async () => {
      try {
        const data = await invoke('tag:create', { name });
        setTagState(data.tagState);
        render();
      } catch (error) {
        handleUserError(error, t('app_error_create_tag'));
      }
    });
  });

  document.addEventListener('click', (event) => {
    if (!event.target.closest('.tag-selector')) {
      closeOpenMenus();
    }
  });

  elements.reorderTagsButton?.addEventListener('click', () => {
    setMoveMode(!isMoveMode);
  });

  if (elements.tagList) {
    elements.tagList.addEventListener('dragstart', handleTagDragStart);
    elements.tagList.addEventListener('dragover', handleTagDragOver);
    elements.tagList.addEventListener('drop', handleTagDrop);
    elements.tagList.addEventListener('dragend', handleTagDragEnd);
  }
}

async function initialize() {
  applyPreferences(state.preferences);
  applyTheme(state.preferences.themeMode);
  attachEventHandlers();
  startUpdatedLabelTimer();
  updateMoveButton();

  if (typeof tagPaneMediaQuery.addEventListener === 'function') {
    tagPaneMediaQuery.addEventListener('change', handleTagPaneMediaChange);
  } else if (typeof tagPaneMediaQuery.addListener === 'function') {
    tagPaneMediaQuery.addListener(handleTagPaneMediaChange);
  }

  if (typeof prefersDark.addEventListener === 'function') {
    prefersDark.addEventListener('change', handleSystemThemeChange);
  } else if (typeof prefersDark.addListener === 'function') {
    prefersDark.addListener(handleSystemThemeChange);
  }

  setTagPaneOpen(false, { skipFocus: true });

  try {
    await loadData(false);
  } catch (error) {
    console.error('Failed to load data', error);
  }

  startAutoRefresh();

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopAutoRefresh();
      stopUpdatedLabelTimer();
    } else {
      startAutoRefresh();
      startUpdatedLabelTimer();
    }
  });

  window.addEventListener('beforeunload', () => {
    cleanup();
  });

  // Close all other dropdowns when a new one is about to open
  document.addEventListener('show.bs.dropdown', (event) => {
    if (typeof bootstrap !== 'undefined' && bootstrap.Dropdown) {
      const openingToggle = event.target;
      document.querySelectorAll('[data-bs-toggle="dropdown"]').forEach((toggle) => {
        if (toggle !== openingToggle) {
          const dropdown = bootstrap.Dropdown.getInstance(toggle);
          if (dropdown) {
            dropdown.hide();
          }
        }
      });
    }
  });
}

addRuntimeListener((message) => {
  if (message?.type === 'oauth:status') {
    if (message.signedIn) {
      setAuth({ ...(state.auth || {}), user: message.user });
    } else {
      setAuth(null);
    }
    render();
    return;
  }

  if (message?.type === 'preferences:language-changed') {
    const previousLocale = state.preferences.languageOverride;
    mergePreferences({ languageOverride: message.languageOverride });
    if (message.languageOverride !== previousLocale) {
      Promise.resolve(setLanguageOverride(message.languageOverride))
        .then(() => {
          localize();
          render();
        })
        .catch((error) => {
          console.error('[App] Failed to apply broadcast language change', error);
        });
    }
    return;
  }

  if (message?.type === 'preferences:updated' && message.preferences) {
    const previousLocale = state.preferences.languageOverride;
    mergePreferences(message.preferences);

    if (Object.prototype.hasOwnProperty.call(message.preferences, 'languageOverride')) {
      const nextLocale = message.preferences.languageOverride;
      if (nextLocale !== previousLocale) {
        Promise.resolve(setLanguageOverride(nextLocale))
          .then(() => {
            localize();
            render();
          })
          .catch((error) => {
            console.error('[App] Failed to apply updated language preference', error);
          });
        return;
      }
    }

    render();
  }
});

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initialize);
} else {
  initialize();
}
