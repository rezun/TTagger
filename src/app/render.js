import { resolveTagColor } from '../util/formatters.js';
import { createStreamerCard } from '../util/components.js';
import {
  TAG_STARRED,
  TAG_UNTAGGED,
  TAG_ALL,
  DEFAULT_TAG_COLOR,
  SORT_OPTIONS,
} from '../util/constants.js';
import {
  state,
  getAssignmentsFor,
  clearOpenTagMenu,
  setOpenTagMenu,
} from './state.js';
import { compareTagsByOrder } from '../util/sorting.js';
import { getMessageStrict } from '../util/i18n.js';

const t = (key, substitutions) => getMessageStrict(key, substitutions);

// Memoization caches for performance optimization
let tagUsageCache = null;
let tagUsageCacheKey = null;
let liveCountsCache = null;
let liveCountsCacheKey = null;
let filteredStreamersCache = null;
let filteredStreamersCacheKey = null;

/**
 * Generate a cache key for memoization based on relevant state
 */
function getCacheKey(dependencies) {
  return dependencies.map(dep => {
    if (typeof dep === 'object' && dep !== null) {
      return JSON.stringify(dep);
    }
    return String(dep);
  }).join('|');
}

function isCustomTagId(tagId) {
  if (!tagId && tagId !== 0) return false;
  const key = String(tagId);
  return key !== TAG_ALL && key !== TAG_UNTAGGED && key !== TAG_STARRED;
}

/**
 * Human-friendly "last updated" string for the follow cache timestamp.
 * @param {number|null} timestamp
 * @returns {string}
 */
export function lastUpdatedText(timestamp) {
  if (!timestamp) return '';
  const diff = Date.now() - timestamp;
  const minutes = Math.round(diff / 60000);
  if (minutes <= 0) {
    return t('app_meta_updated_just_now');
  }
  if (minutes === 1) {
    return t('app_meta_updated_minute');
  }
  const minutesText = String(minutes);
  return t('app_meta_updated_minutes', [minutesText]);
}

function computeTagUsage() {
  // Memoize based on assignments object
  const cacheKey = getCacheKey([state.tagState?.assignments]);
  if (tagUsageCacheKey === cacheKey && tagUsageCache !== null) {
    return tagUsageCache;
  }

  const usage = {};
  Object.values(state.tagState?.assignments || {}).forEach((tagIds) => {
    if (!Array.isArray(tagIds)) return;
    tagIds.forEach((tagId) => {
      usage[tagId] = (usage[tagId] || 0) + 1;
    });
  });

  tagUsageCache = usage;
  tagUsageCacheKey = cacheKey;
  return usage;
}

function computeLiveCounts() {
  // Memoize based on follows array and assignments object
  // We need to track follows separately since isLive status can change
  const followsKey = state.follows.map(s => `${s.id}:${s.isLive ? '1' : '0'}`).join(',');
  const cacheKey = getCacheKey([followsKey, state.tagState?.assignments]);
  if (liveCountsCacheKey === cacheKey && liveCountsCache !== null) {
    return liveCountsCache;
  }

  const counts = {
    total: 0,
    untagged: 0,
    tags: {},
  };

  const assignments = state.tagState?.assignments || {};
  const followMap = new Map(state.follows.map((streamer) => [streamer.id, streamer]));

  state.follows.forEach((streamer) => {
    if (streamer.isLive) {
      counts.total += 1;
    }
  });

  Object.entries(assignments).forEach(([streamerId, tagIds]) => {
    const streamer = followMap.get(streamerId);
    if (!streamer || !streamer.isLive || !Array.isArray(tagIds)) return;
    tagIds.forEach((tagId) => {
      const key = String(tagId);
      counts.tags[key] = (counts.tags[key] || 0) + 1;
    });
  });

  state.follows.forEach((streamer) => {
    if (!streamer.isLive) return;
    const tagIds = assignments[streamer.id] || [];
    if (!tagIds.length) {
      counts.untagged += 1;
    }
  });

  liveCountsCache = counts;
  liveCountsCacheKey = cacheKey;
  return counts;
}

function getFilteredStreamers() {
  // Memoize based on follows, preferences, and assignments
  const followsKey = state.follows.map(s =>
    `${s.id}:${s.isLive ? '1' : '0'}:${s.displayName}:${s.title}:${s.gameName}:${s.followDate}`
  ).join(',');
  const prefsKey = getCacheKey([state.preferences]);
  const assignmentsKey = getCacheKey([state.tagState?.assignments]);
  const cacheKey = `${followsKey}|${prefsKey}|${assignmentsKey}`;

  if (filteredStreamersCacheKey === cacheKey && filteredStreamersCache !== null) {
    return filteredStreamersCache;
  }

  const { sortBy, liveFirst, starredFirst, nameFilter, contentFilter, selectedTagId } =
    state.preferences;
  const nameTerm = nameFilter.trim().toLowerCase();
  const contentTerm = contentFilter.trim().toLowerCase();
  let streamers = state.follows.slice();

  if (nameTerm) {
    streamers = streamers.filter((item) => {
      const name = item.displayName?.toLowerCase() || '';
      const login = item.login?.toLowerCase() || '';
      return name.includes(nameTerm) || login.includes(nameTerm);
    });
  }

  if (contentTerm) {
    streamers = streamers.filter((item) => {
      const title = item.title?.toLowerCase() || '';
      const category = item.gameName?.toLowerCase() || '';
      return title.includes(contentTerm) || category.includes(contentTerm);
    });
  }

  if (selectedTagId === TAG_UNTAGGED) {
    streamers = streamers.filter((item) => !(getAssignmentsFor(item.id)?.length));
  } else if (selectedTagId) {
    streamers = streamers.filter((item) => getAssignmentsFor(item.id)?.includes(selectedTagId));
  }

  const comparators = {
    [SORT_OPTIONS.FOLLOW_DATE_DESC]: (a, b) => new Date(b.followDate || 0) - new Date(a.followDate || 0),
    [SORT_OPTIONS.FOLLOW_DATE_ASC]: (a, b) => new Date(a.followDate || 0) - new Date(b.followDate || 0),
    [SORT_OPTIONS.NAME_ASC]: (a, b) => (a.displayName || a.login || '').localeCompare(b.displayName || b.login || ''),
    [SORT_OPTIONS.NAME_DESC]: (a, b) => (b.displayName || b.login || '').localeCompare(a.displayName || a.login || ''),
  };

  const comparator = comparators[sortBy] || comparators[SORT_OPTIONS.FOLLOW_DATE_DESC];
  const starredMap = starredFirst
    ? new Map(streamers.map((item) => [item.id, getAssignmentsFor(item.id)?.includes(TAG_STARRED)]))
    : null;

  streamers.sort((a, b) => {
    if (liveFirst) {
      const aLive = a.isLive;
      const bLive = b.isLive;
      if (aLive !== bLive) {
        return aLive ? -1 : 1;
      }
    }

    if (starredMap) {
      const aStar = starredMap.get(a.id);
      const bStar = starredMap.get(b.id);
      if (aStar !== bStar) {
        return aStar ? -1 : 1;
      }
    }

    return comparator(a, b);
  });

  filteredStreamersCache = streamers;
  filteredStreamersCacheKey = cacheKey;
  return streamers;
}

/**
 * Hide any open tag selector menus and clear the tracked state.
 */
export function closeOpenMenus() {
  // Close Bootstrap dropdowns
  if (typeof bootstrap !== 'undefined' && bootstrap.Dropdown) {
    document.querySelectorAll('.tag-selector [data-bs-toggle="dropdown"]').forEach((toggle) => {
      const dropdown = bootstrap.Dropdown.getInstance(toggle);
      if (dropdown) {
        dropdown.hide();
      }
    });
  }
  clearOpenTagMenu();
}

/**
 * Position a tag selector menu near its trigger while keeping it onscreen.
 * @param {HTMLElement} menu
 * @param {HTMLElement} trigger
 */
export function adjustTagMenuPosition(menu, trigger) {
  if (!menu || !trigger) return;

  const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
  const triggerRect = trigger.getBoundingClientRect();

  const menuRect = menu.getBoundingClientRect();
  const menuWidth = menuRect.width;
  const menuHeight = menuRect.height;

  const EDGE_GAP = 12;
  let top = triggerRect.bottom + EDGE_GAP;
  let left = triggerRect.right - menuWidth;

  if (left < EDGE_GAP) {
    left = EDGE_GAP;
  }
  if (left + menuWidth > viewportWidth - EDGE_GAP) {
    left = Math.max(EDGE_GAP, viewportWidth - EDGE_GAP - menuWidth);
  }

  if (top + menuHeight > viewportHeight - EDGE_GAP) {
    const candidate = triggerRect.top - EDGE_GAP - menuHeight;
    if (candidate >= EDGE_GAP) {
      top = candidate;
    } else {
      top = Math.max(EDGE_GAP, viewportHeight - EDGE_GAP - menuHeight);
    }
  }

  menu.style.top = `${Math.round(top)}px`;
  menu.style.left = `${Math.round(left)}px`;
}

/**
 * Prepare the dataset driving the tag list UI rows.
 * @param {string|null} selectedTagId
 * @param {Record<string, {id:string, name:string, color?:string}>} tags
 * @param {Record<string, number>} usage
 * @param {{total:number, untagged:number, tags:Record<string, number>}} liveCounts
 * @returns {Array<{id:string|null, label:string, count:number, liveCount:number, color?:string, isSelected:boolean}>}
 */
function buildTagListEntries(selectedTagId, tags, usage, liveCounts) {
  const total = state.follows.length;
  const untaggedCount = state.follows.filter((item) => !getAssignmentsFor(item.id).length).length;

  const entries = [
    {
      id: TAG_ALL,
      label: 'All',
      count: total,
      liveCount: liveCounts.total,
      isSelected: selectedTagId === TAG_ALL,
    },
    {
      id: TAG_UNTAGGED,
      label: 'Untagged',
      count: untaggedCount,
      liveCount: liveCounts.untagged,
      isSelected: selectedTagId === TAG_UNTAGGED,
    },
  ];

  const favorite = {
    id: TAG_STARRED,
    label: '⭐ Starred',
    count: usage[TAG_STARRED] || 0,
    liveCount: liveCounts.tags[TAG_STARRED] || 0,
    color: tags[TAG_STARRED]?.color,
    isSelected: selectedTagId === TAG_STARRED,
  };
  entries.push(favorite);

  Object.values(tags)
    .filter((tag) => tag.id !== TAG_STARRED)
    .sort(compareTagsByOrder)
    .forEach((tag) => {
      entries.push({
        id: tag.id,
        label: tag.name,
        count: usage[tag.id] || 0,
        liveCount: liveCounts.tags[String(tag.id)] || 0,
        color: tag.color,
        isSelected: selectedTagId === tag.id,
      });
    });

  return entries;
}

function createTagListItem(entry, actions, tagRecord, options = {}) {
  const { isMoveMode } = options;
  const isCustomTag = isCustomTagId(entry.id);
  const item = document.createElement('li');
  item.className = 'list-group-item d-flex justify-content-between align-items-center flex-wrap gap-2';
  if (entry.isSelected) {
    item.classList.add('active');
    item.setAttribute('aria-current', 'true');
  }

  if (isCustomTag) {
    item.dataset.tagId = entry.id;
  }

  const labelWrapper = document.createElement('span');
  labelWrapper.className = 'd-flex align-items-center tag-list-label';

  if (isMoveMode && isCustomTag) {
    item.classList.add('tag-list-item-reorderable');
    item.draggable = true;
    const handle = document.createElement('span');
    handle.className = 'tag-move-handle';
    handle.setAttribute('role', 'presentation');
    handle.setAttribute('aria-hidden', 'true');
    handle.title = t('app_reorder_drag_handle_title');
    handle.textContent = '⋮⋮';
    labelWrapper.appendChild(handle);
  } else {
    item.draggable = false;
  }

  if (entry.id && entry.id !== TAG_STARRED && entry.color) {
    const swatch = document.createElement('span');
    swatch.className = 'tag-color-swatch';
    swatch.style.backgroundColor = resolveTagColor(entry.color, DEFAULT_TAG_COLOR);
    labelWrapper.appendChild(swatch);
  }

  const labelText = document.createElement('span');
  labelText.className = 'tag-name-text';
  labelText.textContent = entry.label;
  labelWrapper.appendChild(labelText);
  item.appendChild(labelWrapper);

  const right = document.createElement('div');
  right.className = 'd-flex align-items-center gap-2';
  right.appendChild(createCountBadge(entry.count, entry.liveCount));

  if (!isMoveMode && entry.id && entry.id !== TAG_UNTAGGED && entry.id !== TAG_STARRED) {
    right.appendChild(createTagActionMenu(entry, actions, tagRecord));
  }

  item.appendChild(right);
  item.addEventListener('click', (event) => {
    if (isMoveMode && isCustomTag) {
      event.preventDefault();
      return;
    }
    actions.onSelectTag(entry.id);
  });
  return item;
}

function createCountBadge(total, live) {
  const badge = document.createElement('div');
  badge.className = 'combined-count-badge';

  const totalCount = document.createElement('span');
  totalCount.className = 'total-count';
  totalCount.textContent = total;
  badge.appendChild(totalCount);

  if (live > 0) {
    const liveCount = document.createElement('span');
    liveCount.className = 'live-count';
    liveCount.textContent = live;
    badge.appendChild(liveCount);
  }

  return badge;
}

function createTagActionMenu(entry, actions, tagRecord) {
  const wrapper = document.createElement('div');
  wrapper.className = 'dropdown';

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'btn btn-sm btn-outline-secondary tag-dropdown-toggle';
  toggle.setAttribute('data-bs-toggle', 'dropdown');
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('title', 'Tag actions');
  toggle.setAttribute('aria-label', `Actions for tag ${entry.label}`);
  toggle.innerHTML = `
    <svg class="icon-pencil" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M12.146.854a.5.5 0 0 1 .708 0l2.292 2.292a.5.5 0 0 1 0 .708l-8.5 8.5A.5.5 0 0 1 6.5 12.5H3.707a.5.5 0 0 1-.5-.5V9.207a.5.5 0 0 1 .146-.354l8.5-8.5Z" />
      <path d="M11.207 3.5 12.5 4.793 4.354 12.94a.5.5 0 0 1-.168.11l-2 1a.5.5 0 0 1-.671-.671l1-2a.5.5 0 0 1 .11-.168L11.207 3.5Z" />
      <path d="M4 13h6v1H4z" />
    </svg>
  `;
  toggle.addEventListener('click', (event) => {
    event.stopPropagation();
  });

  const menu = document.createElement('ul');
  menu.className = 'dropdown-menu dropdown-menu-end';

  menu.appendChild(createMenuItem('Rename', () => {
    hideDropdown(toggle);
    actions.onRenameTag(entry.id, tagRecord?.name);
  }));

  menu.appendChild(createMenuItem('Change color', () => {
    hideDropdown(toggle);
    actions.onUpdateTagColor(entry.id, tagRecord?.color);
  }));

  menu.appendChild(createDividerItem());

  menu.appendChild(
    createMenuItem('Delete', () => {
      hideDropdown(toggle);
      actions.onDeleteTag(entry.id, tagRecord?.name);
    }, 'dropdown-item text-danger'),
  );

  wrapper.appendChild(toggle);
  wrapper.appendChild(menu);

  // Initialize Bootstrap dropdown with custom config to escape overflow container
  if (typeof bootstrap !== 'undefined' && bootstrap.Dropdown) {
    setTimeout(() => {
      const dropdown = new bootstrap.Dropdown(toggle, {
        boundary: 'viewport',
        popperConfig: {
          strategy: 'fixed',
          modifiers: [
            {
              name: 'preventOverflow',
              options: {
                boundary: 'viewport',
              },
            },
          ],
        },
      });

      // Toggle overflow on tag-list when dropdown opens/closes
      const tagList = toggle.closest('.tag-list');
      if (tagList) {
        toggle.addEventListener('show.bs.dropdown', () => {
          tagList.classList.add('dropdown-open');
        });
        toggle.addEventListener('hide.bs.dropdown', () => {
          tagList.classList.remove('dropdown-open');
        });
      }
    }, 0);
  }

  return wrapper;
}

function createMenuItem(label, handler, className = 'dropdown-item') {
  const item = document.createElement('li');
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.textContent = label;
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    handler();
  });
  item.appendChild(button);
  return item;
}

function createDividerItem() {
  const item = document.createElement('li');
  const divider = document.createElement('hr');
  divider.className = 'dropdown-divider';
  item.appendChild(divider);
  return item;
}

function hideDropdown(toggle) {
  const Dropdown = window.bootstrap?.Dropdown;
  if (!Dropdown) return;
  const instance = Dropdown.getInstance(toggle) || new Dropdown(toggle);
  instance.hide();
}

function renderTagList(elements, actions, options = {}) {
  const tagListEl = elements.tagList;
  tagListEl.innerHTML = '';

  const isMoveMode = !!options.isMoveMode;
  tagListEl.classList.toggle('is-reordering', isMoveMode);

  if (state.isLoading && !state.fetchedAt) {
    const loadingItem = document.createElement('li');
    loadingItem.className = 'list-group-item text-center text-muted py-4';
    const wrapper = document.createElement('div');
    wrapper.className = 'd-flex flex-column align-items-center gap-2';
    const spinner = document.createElement('div');
    spinner.className = 'spinner-border';
    spinner.setAttribute('role', 'status');
    spinner.setAttribute('aria-hidden', 'true');
    const loadingLabel = document.createElement('span');
    loadingLabel.textContent = t('app_loading_tags');
    wrapper.appendChild(spinner);
    wrapper.appendChild(loadingLabel);
    loadingItem.appendChild(wrapper);
    tagListEl.appendChild(loadingItem);
    return;
  }

  const usage = computeTagUsage();
  const liveCounts = computeLiveCounts();
  const entries = buildTagListEntries(
    state.preferences.selectedTagId,
    state.tagState?.tags || {},
    usage,
    liveCounts,
  );

  entries.forEach((entry) => {
    const tagRecord = entry.id ? state.tagState?.tags?.[entry.id] : null;
    const item = createTagListItem(entry, actions, tagRecord, options);
    if (!isCustomTagId(entry.id)) {
      item.removeAttribute('data-tag-id');
    }
    tagListEl.appendChild(item);
  });
}

function renderStreamerList(elements, cardActions) {
  const streamerContainer = elements.streamerContainer;
  const streamerCount = elements.streamerCount;
  const updatedLabel = elements.updatedLabel;

  const streamers = getFilteredStreamers();
  const streamCount = streamers.length;
  if (streamCount === 1) {
    streamerCount.textContent = t('app_streamer_count_single');
  } else {
    const countText = String(streamCount);
    streamerCount.textContent = t('app_streamer_count_multiple', [countText]);
  }
  updatedLabel.textContent = lastUpdatedText(state.fetchedAt);

  if (state.isLoading && !state.fetchedAt) {
    streamerCount.textContent = t('app_loading_label');
    updatedLabel.textContent = '';
    streamerContainer.innerHTML = '';
    const loadingState = document.createElement('div');
    loadingState.className = 'loading-state';
    const spinner = document.createElement('div');
    spinner.className = 'spinner-border';
    spinner.setAttribute('role', 'status');
    spinner.setAttribute('aria-hidden', 'true');
    const loadingText = document.createElement('span');
    loadingText.textContent = t('app_loading_streamers');
    loadingState.appendChild(spinner);
    loadingState.appendChild(loadingText);
    streamerContainer.appendChild(loadingState);
    return;
  }

  if (!state.auth) {
    streamerContainer.innerHTML = '';
    const signedOutMessage = document.createElement('p');
    signedOutMessage.className = 'text-muted mb-0';
    signedOutMessage.textContent = t('app_signed_out_message');
    streamerContainer.appendChild(signedOutMessage);
    return;
  }

  if (!streamers.length) {
    streamerContainer.innerHTML = '';
    const emptyState = document.createElement('div');
    emptyState.className = 'empty-state';
    emptyState.textContent = t('app_no_matching_streamers');
    streamerContainer.appendChild(emptyState);
    return;
  }

  streamerContainer.innerHTML = '';

  const handlers = {
    onToggleFavorite: cardActions.onToggleFavorite,
    onToggleTagAssignment: cardActions.onToggleTagAssignment,
    onToggleTagMenu: (streamerId, menu, trigger) => {
      if (state.openTagMenu && state.openTagMenu !== streamerId) {
        closeOpenMenus();
      }
      const isOpen = state.openTagMenu === streamerId;
      if (isOpen) {
        menu.classList.add('hidden');
        menu.style.top = '';
        menu.style.left = '';
        clearOpenTagMenu();
      } else {
        menu.classList.remove('hidden');
        setOpenTagMenu(streamerId);
        adjustTagMenuPosition(menu, trigger);
      }
    },
  };

  streamers.forEach((streamer) => {
    const card = createStreamerCard(streamer, state, handlers);
    streamerContainer.appendChild(card);
  });
}

function updateAuthUI(elements) {
  const loginButton = elements.loginButton;
  if (!loginButton) return;

  if (state.auth?.user) {
    loginButton.classList.add('d-none');
    loginButton.disabled = true;
    const { displayName, login } = state.auth.user;
    elements.userLabel.textContent = `${displayName} (@${login})`;
  } else {
    loginButton.textContent = t('app_connect_button');
    loginButton.classList.remove('btn-outline-danger');
    loginButton.classList.add('btn-primary');
    loginButton.disabled = false;
    loginButton.classList.remove('d-none');
    elements.userLabel.textContent = '';
  }
}

/**
 * Sync the live-first toggle button styling with its checked state.
 * @param {{liveToggle: HTMLInputElement, liveToggleLabel: HTMLElement}} elements
 */
export function updateLiveToggleAppearance(elements) {
  const liveToggle = elements.liveToggle;
  const liveToggleLabel = elements.liveToggleLabel;
  if (!liveToggle || !liveToggleLabel) return;
  const isLiveFirst = !!liveToggle.checked;
  liveToggleLabel.classList.toggle('btn-outline-primary', !isLiveFirst);
  liveToggleLabel.classList.toggle('btn-primary', isLiveFirst);
  liveToggleLabel.classList.toggle('active', isLiveFirst);
  liveToggleLabel.querySelector('.live-toggle-icon')?.classList.toggle('is-active', isLiveFirst);
  liveToggleLabel.setAttribute('aria-pressed', String(isLiveFirst));
}

/**
 * Sync the starred-first toggle button styling with its checked state.
 * @param {{starredToggle?: HTMLInputElement, starredToggleLabel?: HTMLElement}} elements
 */
export function updateStarredToggleAppearance(elements) {
  const starredToggle = elements.starredToggle;
  const starredToggleLabel = elements.starredToggleLabel;
  if (!starredToggle || !starredToggleLabel) return;
  const isStarredFirst = !!starredToggle.checked;
  starredToggleLabel.classList.toggle('btn-outline-warning', !isStarredFirst);
  starredToggleLabel.classList.toggle('btn-warning', isStarredFirst);
  starredToggleLabel.classList.toggle('active', isStarredFirst);
  starredToggleLabel.querySelector('.starred-toggle-icon')?.classList.toggle('is-active', isStarredFirst);
  starredToggleLabel.setAttribute('aria-pressed', String(isStarredFirst));
}

/**
 * Render the dashboard by updating tags, streamer cards, and auth UI.
 * @param {object} elements - DOM references collected in app.js.
 * @param {object} actions - Handlers for tag list and card interactions.
 */
export function renderApp(elements, actions, options = {}) {
  closeOpenMenus();
  renderTagList(elements, actions.tagList, options);
  renderStreamerList(elements, actions.card);
  updateAuthUI(elements);
  updateLiveToggleAppearance(elements);
  updateStarredToggleAppearance(elements);
  if (elements.tagPane) {
    elements.tagPane.classList.toggle('is-reordering', !!options.isMoveMode);
  }
}
