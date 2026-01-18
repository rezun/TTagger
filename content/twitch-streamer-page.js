/**
 * Twitch.tv Content Script - Streamer Page Star & Tags Integration
 *
 * Displays star button and custom tags on streamer pages for followed streamers.
 * Shows/hides UI based on follow state and updates in real-time.
 */

(function () {
  'use strict';

  const LANGUAGE_SYSTEM = 'system';
  let activeLanguageOverride = null;

  let getMessage;
  let setLanguageOverride;

  const i18nModulePromise = import(chrome.runtime.getURL('src/util/i18n.js')).then((mod) => {
    ({ getMessage, setLanguageOverride } = mod);
    return mod;
  });

  function normalizeSubstitutions(substitutions) {
    if (substitutions == null) {
      return [];
    }
    return Array.isArray(substitutions) ? substitutions : [substitutions];
  }

  function formatFallbackMessage(key, substitutions) {
    const normalizedSubs = normalizeSubstitutions(substitutions);
    if (!normalizedSubs.length) {
      return key || '';
    }
    const suffix = normalizedSubs.map((value) => (value != null ? String(value) : '')).join(' ');
    return [key || '', suffix].filter(Boolean).join(' ');
  }

  const t = (key, substitutions) => {
    if (getMessage) {
      const message = getMessage(key, substitutions);
      if (message) {
        return message;
      }
    }
    return formatFallbackMessage(key, substitutions);
  };

  // Constants
  const STARRED_TAG_ID = 'favorite';
  const DEFAULT_TAG_COLOR = '#6f42c1';
  const DEBOUNCE_DELAY = 300;
  const CHECK_INTERVAL = 500; // Check for UI injection points
  let LOG_DEBUG = false;
  const STAR_SVG_PATH = 'M47.755 3.765l11.525 23.353c0.448 0.907 1.313 1.535 2.314 1.681l25.772 3.745c2.52 0.366 3.527 3.463 1.703 5.241L70.42 55.962c-0.724 0.706-1.055 1.723-0.884 2.72l4.402 25.667c0.431 2.51-2.204 4.424-4.458 3.239L46.43 75.47c-0.895-0.471-1.965-0.471-2.86 0L20.519 87.588c-2.254 1.185-4.889-0.729-4.458-3.239l4.402-25.667c0.171-0.997-0.16-2.014-0.884-2.72L0.931 37.784c-1.824-1.778-0.817-4.875 1.703-5.241l25.772-3.745c1.001-0.145 1.866-0.774 2.314-1.681L42.245 3.765c1.127-2.284 4.383-2.284 5.51 0z';
  const TAG_SVG_PATH = 'm483.24 0h-150.29c-27.556 0-66.04 15.94-85.52 35.424l-232.81 232.81c-19.483 19.483-19.483 51.37 0 70.85l179.64 179.64c19.483 19.484 51.37 19.484 70.849 0l232.81-232.81c19.483-19.484 35.424-57.969 35.424-85.52v-150.29c-.0001-27.554-22.544-50.1-50.1-50.1m-66.57 166.67c-27.614 0-50-22.385-50-50 0-27.614 22.386-50 50-50 27.614 0 50 22.386 50 50 0 27.614-22.386 50-50 50z';
  const DEBUG_PREFIX = '[TTagger Streamer Page]';

  // State
  let currentStreamerUsername = null;
  let currentStreamerId = null;
  let isFollowed = false;
  let followCache = null;
  let tagState = null;
  let uiInjected = false;
  let checkInterval = null;

  // Cleanup tracking for memory leak prevention
  const eventListeners = [];
  const observers = [];
  let followButtonObserver = null;
  let urlChangeObserver = null;
  let storageListener = null;
  let isProcessingFollow = false;

  function hasStarButton() {
    return !!document.querySelector('.ttagger-star-container');
  }

  function hasTagsSection() {
    return !!document.querySelector('[data-ttagger-tags]');
  }

  /**
   * Whether both injected UI elements are currently present in the DOM.
   * Used to guard against Twitch re-rendering the header after we inject.
   * @returns {boolean}
   */
  function hasInjectedUi() {
    return hasStarButton() && hasTagsSection();
  }

  /**
   * Ensure our UI exists when it should, restarting injection attempts if not.
   * @param {string} reason
   */
  function ensureUiPresence(reason = '') {
    if (!isFollowed || !currentStreamerUsername) return;
    if (hasInjectedUi()) return;

    if (reason) {
      debug('UI missing; reinjecting due to', reason);
    } else {
      debug('UI missing; reinjecting');
    }

    const starPresent = hasStarButton();
    const tagsPresent = hasTagsSection();

    if (starPresent && !tagsPresent) {
      injectTagsSection();
      startInjectionCheck();
      return;
    }

    uiInjected = false;
    injectUI();
    startInjectionCheck();
  }

  /**
   * Normalize a hex color string to #rrggbb format.
   * @param {string} color
   * @param {string} fallback
   * @returns {string}
   */
  function normalizeHexColor(color, fallback = DEFAULT_TAG_COLOR) {
    if (typeof color !== 'string') return fallback;
    const trimmed = color.trim();
    if (!trimmed) return fallback;
    const match = trimmed.match(/^#?([0-9a-fA-F]{6})$/);
    if (!match) return fallback;
    return `#${match[1].toLowerCase()}`;
  }

  /**
   * Choose black or white text based on background brightness.
   * @param {string} color
   * @returns {string}
   */
  function getContrastingTextColor(color) {
    const hex = normalizeHexColor(color, DEFAULT_TAG_COLOR);
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    return luminance > 0.57 ? '#000000' : '#ffffff';
  }

  /**
   * Debug logging helper
   */
  function setDebugLogging(enabled) {
    LOG_DEBUG = !!enabled;
    if (LOG_DEBUG) {
      console.info(`${DEBUG_PREFIX} Debug logging enabled`);
    }
  }

  async function loadDebugLoggingPreference() {
    try {
      const result = await chrome.storage.sync.get('preferences');
      const preferences = result.preferences || {};
      setDebugLogging(preferences.debugLogging === true);
    } catch (error) {
      LOG_DEBUG = false;
      console.error('[TTagger] Error fetching debug logging preference:', error);
    }
  }

  function debug(...args) {
    if (!LOG_DEBUG) {
      return;
    }
    console.debug(DEBUG_PREFIX, ...args);
  }

  const localizationReady = (async () => {
    try {
      await i18nModulePromise;
    } catch (error) {
      console.error('[TTagger] Failed to load i18n module', error);
      return;
    }
    try {
      const result = await chrome.storage.sync.get('preferences');
      const preferences = result?.preferences || {};
      const languagePreference = preferences.languageOverride ?? LANGUAGE_SYSTEM;
      const applied = await setLanguageOverride(languagePreference);
      activeLanguageOverride = applied ?? null;
    } catch (error) {
      console.error('[TTagger] Failed to apply language preference', error);
    }
  })();

  async function applyLanguagePreference(locale) {
    try {
      await i18nModulePromise;
    } catch (error) {
      console.error('[TTagger] Failed to load i18n module', error);
      return activeLanguageOverride;
    }
    const previous = activeLanguageOverride ?? null;
    try {
      const applied = await setLanguageOverride(locale);
      activeLanguageOverride = applied ?? null;
    } catch (error) {
      console.error('[TTagger] Failed to apply language preference', error);
      activeLanguageOverride = null;
    }
    if ((activeLanguageOverride ?? null) !== (previous ?? null)) {
      refreshLocalizedUi();
    }
    return activeLanguageOverride;
  }

  /**
   * Clean up all event listeners, observers, and timers to prevent memory leaks
   */
  function cleanup() {
    debug('Cleaning up per-streamer observers...');

    // Clear interval timer
    if (checkInterval) {
      clearInterval(checkInterval);
      checkInterval = null;
      debug('Cleared injection check interval');
    }

    // Remove tracked event listeners
    const listenerCount = eventListeners.length;
    for (const { target, type, listener, options } of eventListeners) {
      target.removeEventListener(type, listener, options);
    }
    eventListeners.length = 0;
    if (listenerCount > 0) {
      debug('Removed', listenerCount, 'tracked event listeners');
    }

    // Disconnect all tracked observers that are scoped to the current streamer
    const observerCount = observers.length;
    observers.forEach(observer => observer.disconnect());
    observers.length = 0;
    if (observerCount > 0) {
      debug('Disconnected', observerCount, 'tracked observers');
    }

    // Disconnect follow button observer
    if (followButtonObserver) {
      followButtonObserver.disconnect();
      followButtonObserver = null;
      debug('Disconnected follow button observer');
    }

    // Remove storage listener
    if (storageListener) {
      chrome.storage.onChanged.removeListener(storageListener);
      storageListener = null;
      debug('Removed storage listener');
    }

    debug('Per-streamer cleanup complete');
  }

  /**
   * Track an event listener for later cleanup
   */
  function trackEventListener(target, type, listener, options) {
    eventListeners.push({ target, type, listener, options });
    target.addEventListener(type, listener, options);
  }

  /**
   * Track an observer for later cleanup
   */
  function trackObserver(observer) {
    observers.push(observer);
    return observer;
  }

  /**
   * Extract streamer username from current URL
   * @returns {string|null}
   */
  function extractUsernameFromUrl() {
    const path = window.location.pathname;
    debug('Current path:', path);

    // Match patterns like "/username" but not "/directory", "/settings", etc.
    const match = path.match(/^\/([a-zA-Z0-9_]+)$/);
    if (match && match[1]) {
      const username = match[1].toLowerCase();
      // Exclude known Twitch system paths
      const systemPaths = ['directory', 'settings', 'subscriptions', 'inventory', 'drops', 'jobs', 'store', 'turbo', 'products', 'prime', 'downloads', 'friends'];
      if (systemPaths.includes(username)) {
        debug('Path is a system path, ignoring:', username);
        return null;
      }
      debug('Extracted username from URL:', username);
      return username;
    }
    debug('No username match in URL');
    return null;
  }

  /**
   * Fetch follow cache from storage
   */
  async function fetchFollowCache() {
    try {
      debug('Fetching follow cache...');
      const result = await chrome.storage.local.get('followCache');
      followCache = result.followCache || null;
      debug('Follow cache loaded:', followCache ? `${followCache.items?.length || 0} streamers` : 'null');
      return followCache;
    } catch (error) {
      console.error('[TTagger] Error fetching follow cache:', error);
      return null;
    }
  }

  /**
   * Fetch tag state from storage
   */
  async function fetchTagState() {
    try {
      debug('Fetching tag state...');
      const result = await chrome.storage.sync.get('tagState');
      tagState = result.tagState || { tags: {}, assignments: {}, nextId: 1 };
      debug('Tag state loaded:', Object.keys(tagState.tags || {}).length, 'tags');
      return tagState;
    } catch (error) {
      console.error('[TTagger] Error fetching tag state:', error);
      return { tags: {}, assignments: {}, nextId: 1 };
    }
  }

  /**
   * Find streamer in follow cache by username
   * @param {string} username
   * @returns {object|null} Streamer object with id, login, display_name
   */
  function findStreamerInCache(username) {
    if (!followCache || !followCache.items) {
      debug('No follow cache available');
      return null;
    }
    const normalized = username.toLowerCase();
    const streamer = followCache.items.find(item => item.login.toLowerCase() === normalized) || null;
    debug('Streamer lookup for', username, ':', streamer ? `Found (ID: ${streamer.id})` : 'Not found');
    return streamer;
  }

  /**
   * Check if current streamer is followed
   * @returns {boolean}
   */
  function checkFollowState() {
    if (!currentStreamerUsername) {
      debug('No current streamer username set');
      return false;
    }
    const streamer = findStreamerInCache(currentStreamerUsername);
    if (streamer) {
      currentStreamerId = streamer.id;
      debug('Streamer is followed. ID:', currentStreamerId);
      return true;
    }
    debug('Streamer is NOT followed');
    return false;
  }

  /**
   * Get assigned tags for current streamer
   * @returns {Array<string>} Array of tag IDs
   */
  function getAssignedTags() {
    if (!currentStreamerId || !tagState) return [];
    return tagState.assignments[currentStreamerId] || [];
  }

  /**
   * Check if streamer is starred
   * @returns {boolean}
   */
  function isStreamerStarred() {
    const assignedTags = getAssignedTags();
    return assignedTags.includes(STARRED_TAG_ID);
  }

  /**
   * Toggle star status for current streamer
   */
  async function toggleStar() {
    if (!currentStreamerId) return;

    try {
      await fetchTagState(); // Refresh state
      const starred = isStreamerStarred();

      // Send message to background script to update assignment
      const response = await chrome.runtime.sendMessage({
        type: 'tag:assign',
        streamerId: currentStreamerId,
        tagId: STARRED_TAG_ID,
        assign: !starred
      });

      if (response && response.ok) {
        // Refresh local tag state
        await fetchTagState();

        // Update star button UI
        updateStarButton();

        debug(`${starred ? 'Unstarred' : 'Starred'} streamer:`, currentStreamerUsername);
      } else {
        const fallbackMessage = t('content_error_toggle_star');
        throw new Error(response?.error || fallbackMessage);
      }
    } catch (error) {
      console.error('[TTagger] Error toggling star:', error);
      const alertMessage = error?.message || t('content_error_toggle_star');
      alert(alertMessage);
    }
  }

  /**
   * Toggle tag assignment for current streamer
   * @param {string} tagId
   */
  async function toggleTag(tagId) {
    if (!currentStreamerId) return;

    try {
      await fetchTagState(); // Refresh state
      const assignedTags = getAssignedTags();
      const isAssigned = assignedTags.includes(tagId);

      // Send message to background script to update assignment
      const response = await chrome.runtime.sendMessage({
        type: 'tag:assign',
        streamerId: currentStreamerId,
        tagId: tagId,
        assign: !isAssigned
      });

      if (response && response.ok) {
        // Refresh local tag state with the updated state from background
        await fetchTagState();

        // Update UI to reflect changes
        updateTagsSection();

        debug(`${isAssigned ? 'Removed' : 'Assigned'} tag ${tagId} to:`, currentStreamerUsername);
      } else {
        const fallbackMessage = t('content_error_toggle_tag');
        throw new Error(response?.error || fallbackMessage);
      }
    } catch (error) {
      console.error('[TTagger] Error toggling tag:', error);
      const alertMessage = error?.message || t('content_error_toggle_tag');
      alert(alertMessage);
    }
  }

  /**
   * Create star button element
   * @returns {HTMLElement}
   */
  function createStarButton() {
    const starred = isStreamerStarred();
    debug('Creating star button. Starred:', starred);

    const button = document.createElement('button');
    button.className = 'ScCoreButton-sc-ocjdkq-0 cAajJv ttagger-star-button';
    button.setAttribute('data-ttagger-star', '');
    const addStarLabel = t('content_add_to_starred');
    const removeStarLabel = t('content_remove_from_starred');
    button.setAttribute('aria-label', starred ? removeStarLabel : addStarLabel);
    button.setAttribute('title', starred ? removeStarLabel : addStarLabel);

    if (starred) {
      button.classList.add('is-starred');
    }
    button.dataset.ttaggerStarred = starred ? 'true' : 'false';

    button.innerHTML = `
      <div class="ScCoreButtonLabel-sc-s7h2b7-0 kaIUar">
        <div data-a-target="tw-core-button-label-text" class="Layout-sc-1xcs6mc-0 bLZXTb">
          <div class="Layout-sc-1xcs6mc-0 ceVcik">
            <div class="InjectLayout-sc-1i43xsx-0 iDMNUO">
              <figure class="ScFigure-sc-1hrsqw6-0 iozBbY tw-svg">
              <svg width="20" height="20" viewBox="0 0 90 90" class="ScSvg-sc-1hrsqw6-1 dzvvut" aria-hidden="true" focusable="false">
                <path d="${STAR_SVG_PATH}" fill="currentColor"></path>
              </svg>
            </figure>
          </div>
        </div>
      </div>
    </div>
    `;

    button.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      await toggleStar();
    });

    return button;
  }

  /**
   * Create tag badge element
   * @param {string} tagId
   * @param {object} tag
   * @param {boolean} assigned
   * @returns {HTMLElement}
   */
  function createTagBadge(tagId, tag, assigned) {
    const badge = document.createElement('div');
    badge.className = `ttagger-tag-badge ${assigned ? 'ttagger-tag-assigned' : ''}`;
    badge.setAttribute('data-tag-id', tagId);
    const resolvedColor = normalizeHexColor(tag && tag.color);
    badge.style.borderColor = resolvedColor;
    if (assigned) {
      badge.style.backgroundColor = resolvedColor;
      badge.style.color = getContrastingTextColor(resolvedColor);
    }

    // Safe: Create span and use textContent to prevent XSS
    const nameSpan = document.createElement('span');
    nameSpan.className = 'ttagger-tag-name';
    nameSpan.textContent = tag.name;
    badge.appendChild(nameSpan);

    return badge;
  }

  /**
   * Show the create tag form inline in the dropdown
   * @param {HTMLElement} dropdownMenu
   */
  function showCreateTagForm(dropdownMenu) {
    // Hide existing menu items except the form
    const menuItems = dropdownMenu.querySelectorAll('.ttagger-tags-dropdown-item:not(.ttagger-tags-create-form)');
    const separator = dropdownMenu.querySelector('.ttagger-tags-dropdown-separator');

    menuItems.forEach(item => item.style.display = 'none');
    if (separator) separator.style.display = 'none';

    // Check if form already exists
    let form = dropdownMenu.querySelector('.ttagger-tags-create-form');
    if (form) {
      form.style.display = 'flex';
      const input = form.querySelector('.ttagger-tags-create-input');
      if (input) input.focus();
      return;
    }

    // Create the form
    form = document.createElement('div');
    form.className = 'ttagger-tags-dropdown-item ttagger-tags-create-form';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'ttagger-tags-create-input';
    input.maxLength = 50;
    input.placeholder = t('content_create_tag_placeholder');

    const actions = document.createElement('div');
    actions.className = 'ttagger-tags-create-actions';

    const saveBtn = document.createElement('button');
    saveBtn.className = 'ttagger-tags-create-save';
    saveBtn.title = t('content_create_tag_save');
    saveBtn.textContent = '✓';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'ttagger-tags-create-cancel';
    cancelBtn.title = t('common_cancel');
    cancelBtn.textContent = '✕';

    actions.appendChild(saveBtn);
    actions.appendChild(cancelBtn);
    form.appendChild(input);
    form.appendChild(actions);

    // Handle save
    const handleSave = async (e) => {
      e.preventDefault();
      e.stopPropagation();

      const tagName = input.value.trim();
      if (!tagName) {
        input.focus();
        return;
      }

      saveBtn.disabled = true;
      cancelBtn.disabled = true;

      try {
        // Create the tag via background script
        const response = await chrome.runtime.sendMessage({
          type: 'tag:create',
          name: tagName
        });

        if (response.ok && response.data?.tagState) {
          // Update local tag state
          await fetchTagState();

          // Find the newly created tag
          const newTagId = Object.keys(response.data.tagState.tags).find(id => {
            return response.data.tagState.tags[id].name === tagName;
          });

          // Automatically assign the new tag to current streamer
          if (newTagId && currentStreamerId) {
            await chrome.runtime.sendMessage({
              type: 'tag:assign',
              streamerId: currentStreamerId,
              tagId: newTagId,
              assign: true
            });
            await fetchTagState();
          }

          // Close form and refresh UI
          dropdownMenu.style.display = 'none';
          resetCreateTagForm(dropdownMenu);
          rebuildTagsSection();

          debug('Created and assigned tag:', tagName);
        } else {
          const fallbackMessage = t('content_error_create_tag');
          throw new Error(response.error || fallbackMessage);
        }
      } catch (error) {
        console.error('[TTagger] Error creating tag:', error);
        const alertMessage = error?.message || t('content_error_create_tag');
        alert(alertMessage);
        saveBtn.disabled = false;
        cancelBtn.disabled = false;
      }
    };

    // Handle cancel
    const handleCancel = (e) => {
      e.preventDefault();
      e.stopPropagation();
      resetCreateTagForm(dropdownMenu);
    };

    saveBtn.addEventListener('click', handleSave);
    cancelBtn.addEventListener('click', handleCancel);

    // Handle Enter key
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        handleSave(e);
      } else if (e.key === 'Escape') {
        handleCancel(e);
      }
    });

    // Prevent click propagation to avoid closing dropdown
    form.addEventListener('click', (e) => {
      e.stopPropagation();
    });

    dropdownMenu.appendChild(form);
    input.focus();
  }

  /**
   * Reset/hide the create tag form
   * @param {HTMLElement} dropdownMenu
   */
  function resetCreateTagForm(dropdownMenu) {
    const form = dropdownMenu.querySelector('.ttagger-tags-create-form');
    if (form) {
      form.style.display = 'none';
      const input = form.querySelector('.ttagger-tags-create-input');
      if (input) input.value = '';
    }

    // Show menu items again
    const menuItems = dropdownMenu.querySelectorAll('.ttagger-tags-dropdown-item:not(.ttagger-tags-create-form)');
    const separator = dropdownMenu.querySelector('.ttagger-tags-dropdown-separator');

    menuItems.forEach(item => item.style.display = 'flex');
    if (separator) separator.style.display = 'block';
  }

  /**
   * Create tags section element
   * @returns {HTMLElement}
   */
  function createTagsSection() {
    debug('Creating tags section');

    const section = document.createElement('div');
    section.className = 'ttagger-tags-section';
    section.setAttribute('data-ttagger-tags', '');

    const assignedTags = getAssignedTags();
    debug('Assigned tags for section:', assignedTags);

    // Create container that holds label, tags, and dropdown in one row
    const tagsContainer = document.createElement('div');
    tagsContainer.className = 'ttagger-tags-container';

    // Add label
    const label = document.createElement('span');
    label.className = 'ttagger-tags-label';
    label.textContent = t('content_no_tags_label');
    tagsContainer.appendChild(label);

    if (!tagState || !tagState.tags) {
      const noTagsMsg = document.createElement('span');
      noTagsMsg.className = 'ttagger-no-tags';
      noTagsMsg.textContent = t('content_no_tags_available');
      tagsContainer.appendChild(noTagsMsg);
      section.appendChild(tagsContainer);
      return section;
    }

    // Get all custom tags (sorted, excluding starred tag)
    const sortedTags = Object.entries(tagState.tags)
      .filter(([id]) => id !== STARRED_TAG_ID)
      .sort((a, b) => (a[1].sortOrder || 0) - (b[1].sortOrder || 0));

    if (sortedTags.length === 0) {
      const noTagsMsg = document.createElement('span');
      noTagsMsg.className = 'ttagger-no-tags';
      noTagsMsg.textContent = t('content_no_custom_tags');
      tagsContainer.appendChild(noTagsMsg);
      section.appendChild(tagsContainer);
      return section;
    }

    // Show only assigned tags as badges
    const assignedTagsData = sortedTags.filter(([tagId]) => assignedTags.includes(tagId));

    if (assignedTagsData.length > 0) {
      assignedTagsData.forEach(([tagId, tag]) => {
        const badge = createTagBadge(tagId, tag, true);
        tagsContainer.appendChild(badge);
      });
    } else {
      const noTagsMsg = document.createElement('span');
      noTagsMsg.className = 'ttagger-no-tags';
      noTagsMsg.textContent = t('content_no_tags_assigned');
      tagsContainer.appendChild(noTagsMsg);
    }

    // Create dropdown button with tag icon and arrow
    const dropdownBtn = document.createElement('button');
    dropdownBtn.className = 'ttagger-tags-dropdown-btn';
    dropdownBtn.innerHTML = `
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path fill="currentColor" d="${TAG_SVG_PATH}" transform="matrix(0.02787037 0 0 0.02787037 0.6355336 0.5)"></path>
    </svg>
    <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path fill="currentColor" d="M4 6l4 4 4-4H4z"/>
    </svg>
  `;
    const manageTagsLabel = t('content_manage_tags');
    dropdownBtn.setAttribute('title', manageTagsLabel);
    dropdownBtn.setAttribute('aria-label', manageTagsLabel);

    // Create dropdown menu
    const dropdownMenu = document.createElement('div');
    dropdownMenu.className = 'ttagger-tags-dropdown-menu';
    dropdownMenu.style.display = 'none';

    sortedTags.forEach(([tagId, tag]) => {
      const isAssigned = assignedTags.includes(tagId);
      const menuItem = document.createElement('button');
      menuItem.className = 'ttagger-tags-dropdown-item';
      menuItem.setAttribute('data-tag-id', tagId);

      // Safe: Create elements programmatically to prevent XSS
      const checkbox = document.createElement('span');
      checkbox.className = 'ttagger-tags-dropdown-checkbox';
      checkbox.textContent = isAssigned ? '✓' : '';

      const colorSpan = document.createElement('span');
      colorSpan.className = 'ttagger-tags-dropdown-color';
      const resolvedColor = normalizeHexColor(tag && tag.color);
      colorSpan.style.backgroundColor = resolvedColor;

      const nameSpan = document.createElement('span');
      nameSpan.className = 'ttagger-tags-dropdown-name';
      nameSpan.textContent = tag.name;

      menuItem.appendChild(checkbox);
      menuItem.appendChild(colorSpan);
      menuItem.appendChild(nameSpan);

      menuItem.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        await toggleTag(tagId);
      });

      dropdownMenu.appendChild(menuItem);
    });

    // Add separator and "Create New Tag" button
    const separator = document.createElement('div');
    separator.className = 'ttagger-tags-dropdown-separator';
    dropdownMenu.appendChild(separator);

    const createTagBtn = document.createElement('button');
    createTagBtn.className = 'ttagger-tags-dropdown-item ttagger-tags-create-btn';
    createTagBtn.innerHTML = `
    <span class="ttagger-tags-dropdown-checkbox">+</span>
    <span class="ttagger-tags-dropdown-color" style="background-color: transparent; border: 1px dashed rgba(255, 255, 255, 0.3);"></span>
    <span class="ttagger-tags-dropdown-name"></span>
  `;
    createTagBtn.querySelector('.ttagger-tags-dropdown-name').textContent = t('content_create_new_tag');

    createTagBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      showCreateTagForm(dropdownMenu);
    });

    dropdownMenu.appendChild(createTagBtn);

    // Position dropdown relative to button
    const positionDropdown = () => {
      const rect = dropdownBtn.getBoundingClientRect();
      const menuHeight = dropdownMenu.offsetHeight;
      const viewportHeight = window.innerHeight;

      // Position below button by default
      let top = rect.bottom + 4;

      // If dropdown would go off bottom of screen, position above button
      if (top + menuHeight > viewportHeight && rect.top - menuHeight - 4 > 0) {
        top = rect.top - menuHeight - 4;
      }

      dropdownMenu.style.top = `${top}px`;
      dropdownMenu.style.left = `${rect.left}px`;
    };

    const closeDropdown = () => {
      dropdownMenu.style.display = 'none';
      resetCreateTagForm(dropdownMenu);
    };

    // Toggle dropdown on button click
    dropdownBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const isVisible = dropdownMenu.style.display !== 'none';

      if (isVisible) {
        closeDropdown();
      } else {
        dropdownMenu.style.display = 'block';
        positionDropdown();
      }
    });

    // Close dropdown when clicking outside
    const handleOutsideClick = (e) => {
      if (dropdownMenu.style.display === 'none') return;

      const target = e.target;
      if (dropdownMenu.contains(target) || dropdownBtn.contains(target)) {
        return;
      }

      closeDropdown();
    };

    document.addEventListener('click', handleOutsideClick, true);

    // Reposition dropdown on scroll/resize
    const repositionOnScroll = () => {
      if (dropdownMenu.style.display !== 'none') {
        positionDropdown();
      }
    };

    window.addEventListener('scroll', repositionOnScroll, true);
    window.addEventListener('resize', repositionOnScroll);

    tagsContainer.appendChild(dropdownBtn);
    section.appendChild(tagsContainer);
    section.appendChild(dropdownMenu);

    return section;
  }

  /**
   * Update star button state
   */
  function updateStarButton() {
    const button = document.querySelector('[data-ttagger-star]');
    if (!button) return;

    const starred = isStreamerStarred();
    const addStarLabel = t('content_add_to_starred');
    const removeStarLabel = t('content_remove_from_starred');
    button.setAttribute('aria-label', starred ? removeStarLabel : addStarLabel);
    button.setAttribute('title', starred ? removeStarLabel : addStarLabel);

    button.classList.toggle('is-starred', starred);
    button.dataset.ttaggerStarred = starred ? 'true' : 'false';
  }

  /**
   * Rebuild the entire tags section (used when tags are added/removed)
   */
  function rebuildTagsSection() {
    const existingSection = document.querySelector('[data-ttagger-tags]');
    if (!existingSection) return;

    // Find where the section is in the DOM
    const parent = existingSection.parentElement;
    if (!parent) return;

    // Remove old section
    existingSection.remove();

    // Create and insert new section
    const newSection = createTagsSection();
    parent.appendChild(newSection);
  }

  /**
   * Update tags section
   */
  function updateTagsSection() {
    const section = document.querySelector('[data-ttagger-tags]');
    if (!section) return;

    const assignedTags = getAssignedTags();

    // Update dropdown menu items
    const dropdownItems = section.querySelectorAll('.ttagger-tags-dropdown-item');
    dropdownItems.forEach(item => {
      const tagId = item.getAttribute('data-tag-id');
      const assigned = assignedTags.includes(tagId);
      const checkbox = item.querySelector('.ttagger-tags-dropdown-checkbox');
      if (checkbox) {
        checkbox.textContent = assigned ? '✓' : '';
      }
    });

    // Rebuild the tags container to show current assigned tags
    const tagsContainer = section.querySelector('.ttagger-tags-container');
    if (!tagsContainer) return;

    // Ensure label exists
    let label = tagsContainer.querySelector('.ttagger-tags-label');
    if (!label) {
      label = document.createElement('span');
      label.className = 'ttagger-tags-label';
      tagsContainer.insertBefore(label, tagsContainer.firstChild);
    }
    label.textContent = t('content_no_tags_label');

    // Remove all badges (but keep dropdown button and label)
    const existingBadges = tagsContainer.querySelectorAll('.ttagger-tag-badge');
    existingBadges.forEach(badge => badge.remove());

    // Remove "no tags" message if it exists
    const noTagsMsg = tagsContainer.querySelector('.ttagger-no-tags');
    if (noTagsMsg) noTagsMsg.remove();

    // Get sorted tags
    const sortedTags = Object.entries(tagState.tags)
      .filter(([id]) => id !== STARRED_TAG_ID)
      .sort((a, b) => (a[1].sortOrder || 0) - (b[1].sortOrder || 0));

    const assignedTagsData = sortedTags.filter(([tagId]) => assignedTags.includes(tagId));

    // Insert assigned tags before dropdown button
    const dropdownBtn = tagsContainer.querySelector('.ttagger-tags-dropdown-btn');

    if (assignedTagsData.length > 0) {
      assignedTagsData.forEach(([tagId, tag]) => {
        const badge = createTagBadge(tagId, tag, true);
        if (dropdownBtn) {
          tagsContainer.insertBefore(badge, dropdownBtn);
        } else {
          tagsContainer.appendChild(badge);
        }
      });
    } else {
      const newNoTagsMsg = document.createElement('span');
      newNoTagsMsg.className = 'ttagger-no-tags';
      newNoTagsMsg.textContent = t('content_no_tags_assigned');
      if (dropdownBtn) {
        tagsContainer.insertBefore(newNoTagsMsg, dropdownBtn);
      } else {
        tagsContainer.appendChild(newNoTagsMsg);
      }
    }
  }

  /**
   * Inject only the tags section below the game link.
   * @returns {boolean} true when tags were injected
   */
  function injectTagsSection() {
    debug('Looking for game link to inject tags section...');
    const gameLink = document.querySelector('[data-a-target="stream-game-link"]');
    if (!gameLink) {
      debug('Game link not found');
      return false;
    }
    debug('Game link found');
    const tagsSection = createTagsSection();

    const tagsAnchor =
      gameLink.closest('[data-target="stream-info-card-component"]')
      || gameLink.closest('[data-test-selector="stream-info-card-component"]')
      || gameLink.closest('[data-target="stream-info-card"]')
      || gameLink.parentElement?.parentElement
      || gameLink.parentElement;

    if (tagsAnchor && tagsAnchor.parentElement) {
      debug('Injecting tags section after game link container');
      tagsAnchor.parentElement.insertBefore(tagsSection, tagsAnchor.nextSibling);
      debug('Tags section injected');
      return true;
    }

    debug('No suitable tags anchor found near game link');
    return false;
  }

  /**
   * Inject UI elements into the page
   */
  function injectUI() {
    debug('injectUI called. uiInjected:', uiInjected, 'isFollowed:', isFollowed);

    // Don't inject if already injected or not followed
    if (uiInjected) {
      debug('UI already injected, skipping');
      return;
    }

    // Clean up stale tags before reinjecting to avoid duplicates
    const existingTags = document.querySelector('[data-ttagger-tags]');
    if (existingTags) {
      debug('Removing stale tags section before reinjection');
      existingTags.remove();
    }

    if (!isFollowed) {
      debug('Streamer not followed, skipping UI injection');
      return;
    }

    // Find the button container next to unfollow button
    debug('Looking for unfollow button...');
    const unfollowButton = document.querySelector('[data-a-target="unfollow-button"]');
    if (!unfollowButton) {
      debug('Unfollow button not found during inject attempt');
      return;
    }
    debug('Unfollow button found');

    // Inject star button
    debug('Creating and injecting star button...');
    let starInjected = false;
    const starButton = createStarButton();
    const starContainer = document.createElement('div');
    starContainer.className = 'ttagger-star-container';
    starContainer.appendChild(starButton);

    const buttonMount =
      unfollowButton.closest('[data-target="channel-header-right"]')
      || unfollowButton.closest('[data-test-selector="follow-button"]')
      || unfollowButton.parentElement;

    if (buttonMount && buttonMount.parentElement) {
      debug('Injecting star button before unfollow button');
      unfollowButton.insertAdjacentElement('beforebegin', starContainer);
      starInjected = true;
    } else if (unfollowButton.parentElement) {
      debug('Fallback inject: inserting star button before unfollow button in parent');
      unfollowButton.parentElement.insertBefore(starContainer, unfollowButton);
      starInjected = true;
    } else {
      debug('Unable to find mount point for star button');
      return;
    }
    debug('Star button injected');

    const tagsInjected = injectTagsSection();

    uiInjected = starInjected || tagsInjected;
    debug('UI injection complete for streamer:', currentStreamerUsername, 'star:', starInjected, 'tags:', tagsInjected);
  }

  /**
   * Remove UI elements from the page
   */
  function removeUI() {
    debug('removeUI called');
    const starContainer = document.querySelector('.ttagger-star-container');
    if (starContainer) {
      starContainer.remove();
      debug('Star container removed');
    }

    const tagsSection = document.querySelector('[data-ttagger-tags]');
    if (tagsSection) {
      tagsSection.remove();
      debug('Tags section removed');
    }

    uiInjected = false;
    debug('UI removed, uiInjected set to false');
  }

  /**
   * Reapply localized strings to existing UI elements.
   */
  function refreshLocalizedUi() {
    updateStarButton();
    updateTagsSection();

    const createTagButtonLabel = document.querySelector('.ttagger-tags-create-btn .ttagger-tags-dropdown-name');
    if (createTagButtonLabel) {
      createTagButtonLabel.textContent = t('content_create_new_tag');
    }

    const createForm = document.querySelector('.ttagger-tags-create-form');
    if (createForm) {
      const input = createForm.querySelector('.ttagger-tags-create-input');
      if (input) {
        input.placeholder = t('content_create_tag_placeholder');
      }
      const saveBtn = createForm.querySelector('.ttagger-tags-create-save');
      if (saveBtn) {
        saveBtn.title = t('content_create_tag_save');
      }
      const cancelBtn = createForm.querySelector('.ttagger-tags-create-cancel');
      if (cancelBtn) {
        cancelBtn.title = t('common_cancel');
      }
    }

    const label = document.querySelector('.ttagger-tags-label');
    if (label) {
      label.textContent = t('content_no_tags_label');
    }
  }

  /**
   * Watch for follow button click and add streamer to cache when followed
   */
  async function handleFollowButtonClick() {
    if (isProcessingFollow) return;
    isProcessingFollow = true;
    try {
      if (!currentStreamerUsername) return;

      const MAX_RETRIES = 5;
      const RETRY_DELAY = 2000; // 2 seconds
      let detected = false;

      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        debug(`Follow detection attempt ${attempt}/${MAX_RETRIES}...`);

        // Wait for Twitch to process the follow
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));

        // Check if we now have an unfollow button (meaning user just followed)
        const unfollowButton = document.querySelector('[data-a-target="unfollow-button"]');
        if (unfollowButton && !isFollowed) {
          debug('User just followed streamer, adding to cache...');
          detected = true;

          try {
            // Send message to background to add streamer to cache
            await chrome.runtime.sendMessage({
              type: 'follow:add',
              login: currentStreamerUsername
            });

            debug('Streamer added to cache, refreshing data...');

            // Refresh our local cache
            await fetchFollowCache();

            // Update follow state
            isFollowed = checkFollowState();

            // Inject UI if now followed
            if (isFollowed) {
              debug('Follow state confirmed, injecting UI...');
              injectUI();
            }
            break;
          } catch (error) {
            console.error('[TTagger] Error handling follow:', error);
            break;
          }
        }

        if (attempt === MAX_RETRIES && !detected) {
          console.warn('[TTagger] Failed to detect follow state change after', MAX_RETRIES, 'attempts. You may need to refresh the page for UI to appear.');
        }
      }
    } finally {
      isProcessingFollow = false;
    }
  }

  /**
   * Watch for modal unfollow confirmation and remove streamer from cache when unfollowed
   */
  async function handleModalUnfollowButtonClick() {
    if (!currentStreamerUsername) return;

    const MAX_RETRIES = 5;
    const RETRY_DELAY = 2000; // 2 seconds
    let detected = false;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      debug(`Unfollow detection attempt ${attempt}/${MAX_RETRIES}...`);

      // Wait for Twitch to process the unfollow
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));

      // Check if we now have a follow button (meaning user just unfollowed)
      const followButton = document.querySelector('[data-a-target="follow-button"]');
      if (followButton && isFollowed) {
        debug('User confirmed unfollow, removing from cache...');
        detected = true;

        try {
          // Send message to background to remove streamer from cache
          await chrome.runtime.sendMessage({
            type: 'follow:remove',
            login: currentStreamerUsername
          });

          debug('Streamer removed from cache, refreshing data...');

          // Refresh our local cache
          await fetchFollowCache();

          // Update follow state
          isFollowed = checkFollowState();

          // Remove UI if no longer followed
          if (!isFollowed) {
            debug('Follow state confirmed, removing UI...');
            removeUI();
          }
          break;
        } catch (error) {
          console.error('[TTagger] Error handling unfollow:', error);
          break;
        }
      }

      if (attempt === MAX_RETRIES && !detected) {
        console.warn('[TTagger] Failed to detect unfollow state change after', MAX_RETRIES, 'attempts. You may need to refresh the page for UI to be removed.');
      }
    }
  }

  /**
   * Set up listener on follow/unfollow buttons
   */
  function setupFollowButtonListener() {
    // Use event delegation on the body to catch follow/unfollow button clicks
    const listener = async (e) => {
      const followTarget = e.target.closest('[data-a-target="follow-button"]');
      const modalUnfollowTarget = e.target.closest('[data-a-target="modal-unfollow-button"]');

      if (followTarget) {
        debug('Follow button clicked');
        await handleFollowButtonClick();
      } else if (modalUnfollowTarget) {
        debug('Modal unfollow button clicked');
        await handleModalUnfollowButtonClick();
      }
    };

    // Track this listener for cleanup
    trackEventListener(document, 'click', listener, true);
  }

  /**
   * Check and update follow state by observing the follow/unfollow button
   */
  function observeFollowButton() {
    const observer = new MutationObserver(() => {
      const wasFollowed = isFollowed;
      isFollowed = checkFollowState();

      if (isFollowed) {
        ensureUiPresence('follow button mutation');
      }

      if (wasFollowed !== isFollowed) {
        debug('Follow state changed:', isFollowed);
        if (isFollowed) {
          injectUI();
        } else {
          removeUI();
        }
      }
    });

    // Observe the entire channel header for button changes
    const channelHeader = document.querySelector('[data-target="channel-header-right"]');
    if (channelHeader) {
      observer.observe(channelHeader, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['data-a-target']
      });
    }

    // Store observer reference for cleanup
    followButtonObserver = observer;
    return observer;
  }

  /**
   * Setup storage listener for real-time updates
   */
  function setupStorageListener() {
    // Define listener function so we can remove it later
    const listener = async (changes, areaName) => {
      if (areaName === 'sync') {
        if (changes.tagState) {
          await fetchTagState();
          updateStarButton();
          updateTagsSection();
        }

        if (changes.preferences) {
          const nextPreferences = changes.preferences.newValue || {};
          setDebugLogging(nextPreferences.debugLogging === true);
          const nextLocale = nextPreferences.languageOverride ?? LANGUAGE_SYSTEM;
          try {
            await applyLanguagePreference(nextLocale);
          } catch (error) {
            console.error('[TTagger] Failed to apply language preference from storage change', error);
          }
        }
      }

      if (areaName === 'local' && changes.followCache) {
        await fetchFollowCache();
        const wasFollowed = isFollowed;
        isFollowed = checkFollowState();

        if (isFollowed) {
          ensureUiPresence('follow cache change');
        }

        if (wasFollowed !== isFollowed) {
          if (isFollowed) {
            injectUI();
          } else {
            removeUI();
          }
        }
      }
    };

    // Store listener reference for cleanup
    storageListener = listener;
    chrome.storage.onChanged.addListener(listener);
  }

  /**
   * Try to inject UI periodically until it is present.
   */
  function startInjectionCheck() {
    if (checkInterval) {
      debug('Clearing existing check interval');
      clearInterval(checkInterval);
    }

    checkInterval = setInterval(() => {
      const starPresent = hasStarButton();
      const tagsPresent = hasTagsSection();

      if (!isFollowed) {
        debug('Streamer not followed, skipping injection attempt');
        return;
      }

      if (starPresent && tagsPresent) {
        uiInjected = true;
        debug('UI present; stopping injection check interval');
        clearInterval(checkInterval);
        checkInterval = null;
        return;
      }

      if (starPresent && !tagsPresent) {
        debug('Star button present but tags missing; attempting to inject tags only');
        injectTagsSection();
        return;
      }

      uiInjected = false;
      injectUI();
    }, CHECK_INTERVAL);
  }

  /**
   * Handle URL changes (Twitch is a SPA)
   */
  function handleUrlChange() {
    const newUsername = extractUsernameFromUrl();

    if (newUsername !== currentStreamerUsername) {
      debug('URL changed from', currentStreamerUsername, 'to', newUsername);

      // Clean up previous state - remove UI, listeners, observers, and timers
      removeUI();
      cleanup();

      currentStreamerUsername = newUsername;
      currentStreamerId = null;
      isFollowed = false;
      uiInjected = false;

      if (newUsername) {
        // Initialize for new streamer
        initialize();
      }
    }
  }

  /**
   * Observe URL changes
   */
  function observeUrlChanges() {
    // Watch for URL changes via history API
    let lastUrl = location.href;

    const observer = new MutationObserver(() => {
      const url = location.href;
      if (url !== lastUrl) {
        lastUrl = url;
        handleUrlChange();
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    // Store observer reference for cleanup
    urlChangeObserver = observer;

    // Also listen to popstate - track this listener
    trackEventListener(window, 'popstate', handleUrlChange);
  }

  /**
   * Initialize the content script
   */
  async function initialize() {
    debug('=== INITIALIZE CALLED ===');
    debug('Document ready state:', document.readyState);
    debug('Current URL:', window.location.href);

    currentStreamerUsername = extractUsernameFromUrl();

    if (!currentStreamerUsername) {
      debug('Not on a streamer page, exiting');
      return;
    }

    debug('Detected streamer page:', currentStreamerUsername);

    // Fetch data
    await fetchFollowCache();
    await fetchTagState();

    // Check if followed
    isFollowed = checkFollowState();

    if (!isFollowed) {
      debug('Streamer not followed, UI will not be shown');
      return;
    }

    debug('Streamer is followed, preparing to inject UI');
    debug('Current streamer ID:', currentStreamerId);
    debug('Assigned tags:', getAssignedTags());

    // Start trying to inject UI
    startInjectionCheck();

    // Set up observers
    debug('Setting up follow button observer...');
    observeFollowButton();
    debug('Initialization complete');
  }

  if (chrome?.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((message) => {
      if (!message || !message.type) return;

      if (message.type === 'preferences:language-changed') {
        Promise.resolve(applyLanguagePreference(message.languageOverride))
          .catch((error) => {
            console.error('[TTagger] Failed to apply broadcast language change in content script', error);
          });
        return;
      }

      if (message.type === 'preferences:updated' && message.preferences) {
        if (Object.prototype.hasOwnProperty.call(message.preferences, 'languageOverride')) {
          Promise.resolve(applyLanguagePreference(message.preferences.languageOverride))
            .catch((error) => {
              console.error('[TTagger] Failed to apply updated language preference in content script', error);
            });
        }
      }
    });
  }

  async function start() {
    await localizationReady;
    await loadDebugLoggingPreference();
    await initialize();
    setupStorageListener();
    observeUrlChanges();
    setupFollowButtonListener();
  }

  // Start the script when DOM is ready
  debug('Script loaded. Document ready state:', document.readyState);

  if (document.readyState === 'loading') {
    debug('Waiting for DOMContentLoaded...');
    document.addEventListener('DOMContentLoaded', () => {
      debug('DOMContentLoaded fired');
      start().catch((error) => {
        console.error('[TTagger] Failed to start streamer page integration:', error);
      });
    });
  } else {
    debug('DOM already ready, initializing immediately');
    start().catch((error) => {
      console.error('[TTagger] Failed to start streamer page integration:', error);
    });
  }
})();
