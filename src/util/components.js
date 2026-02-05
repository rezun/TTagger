import {
  formatUptime,
  formatViewerCount,
  formatLastSeenLive,
  appendMetaSegment,
  resolveTagColor,
  getContrastingTextColor,
} from './formatters.js';
import { TAG_STARRED, DEFAULT_TAG_COLOR } from './constants.js';
import { handleUserError } from './errors.js';
import { compareTagsByOrder } from './sorting.js';
import { getMessageStrict } from './i18n.js';

const STAR_SVG_PATH = 'M47.755 3.765l11.525 23.353c0.448 0.907 1.313 1.535 2.314 1.681l25.772 3.745c2.52 0.366 3.527 3.463 1.703 5.241L70.42 55.962c-0.724 0.706-1.055 1.723-0.884 2.72l4.402 25.667c0.431 2.51-2.204 4.424-4.458 3.239L46.43 75.47c-0.895-0.471-1.965-0.471-2.86 0L20.519 87.588c-2.254 1.185-4.889-0.729-4.458-3.239l4.402-25.667c0.171-0.997-0.16-2.014-0.884-2.72L0.931 37.784c-1.824-1.778-0.817-4.875 1.703-5.241l25.772-3.745c1.001-0.145 1.866-0.774 2.314-1.681L42.245 3.765c1.127-2.284 4.383-2.284 5.51 0z';

const t = (key, substitutions) => getMessageStrict(key, substitutions);

export function createStreamerCard(streamer, state, handlers) {
  const card = document.createElement('div');
  card.className = 'streamer-card clickable-card';

  const avatar = createAvatar(streamer);
  card.appendChild(avatar);

  const preview = createStreamerPreview(streamer);
  card.appendChild(preview);
  card.classList.toggle('has-preview', preview.hasChildNodes);

  const body = createStreamerBody(streamer, state);
  card.appendChild(body);

  const footer = createStreamerActions(streamer, state, handlers);
  card.appendChild(footer);

  addStreamerCardEvents(card, streamer);

  return card;
}

function createAvatar(streamer) {
  const avatar = document.createElement('img');
  avatar.className = 'streamer-avatar';
  avatar.src = streamer.avatarUrl || '../assets/icons/icon48.png';
  avatar.alt = `${streamer.displayName || streamer.login} avatar`;
  return avatar;
}

function createStreamerBody(streamer, state) {
  const body = document.createElement('div');
  body.className = 'streamer-body';

  const titleRow = createTitleRow(streamer);
  body.appendChild(titleRow);

  const metaPrimary = createPrimaryMeta(streamer);
  if (metaPrimary.childElementCount) {
    body.appendChild(metaPrimary);
  }

  if (streamer.title) {
    const streamTitle = document.createElement('div');
    streamTitle.className = 'streamer-title';
    streamTitle.textContent = streamer.title;
    body.appendChild(streamTitle);
  }

  const tagWrapper = createTagWrapper(streamer, state);
  body.appendChild(tagWrapper);

  return body;
}

function createTitleRow(streamer) {
  const titleRow = document.createElement('div');
  titleRow.className = 'streamer-title-row';

  const titleLeft = document.createElement('div');
  titleLeft.className = 'd-flex align-items-center gap-2';

  const nameEl = document.createElement('h3');
  nameEl.className = 'h6 mb-0';
  nameEl.textContent = streamer.displayName || streamer.login;
  titleLeft.appendChild(nameEl);

  if (streamer.isLive) {
    const badge = document.createElement('span');
    badge.className = 'badge bg-danger';
    badge.textContent = t('app_badge_live');
    titleLeft.appendChild(badge);
  }

  titleRow.appendChild(titleLeft);

  const titleRight = document.createElement('div');
  titleRight.className = 'streamer-title-meta';

  if (streamer.viewerCount != null) {
    const viewersContainer = document.createElement('span');
    const formattedCount = formatViewerCount(streamer.viewerCount);
    const labelKey = streamer.viewerCount === 1 ? 'app_meta_viewer_single' : 'app_meta_viewers';
    const fullLabel = t(labelKey, [formattedCount]);

    const index = formattedCount ? fullLabel.indexOf(formattedCount) : -1;
    if (index > -1) {
      const before = fullLabel.slice(0, index);
      const after = fullLabel.slice(index + formattedCount.length);
      if (before) {
        viewersContainer.appendChild(document.createTextNode(before));
      }
      const viewersNumber = document.createElement('span');
      viewersNumber.className = 'streamer-meta-viewers';
      viewersNumber.textContent = formattedCount;
      viewersContainer.appendChild(viewersNumber);
      if (after) {
        viewersContainer.appendChild(document.createTextNode(after));
      }
    } else {
      viewersContainer.textContent = fullLabel;
    }

    appendMetaSegment(titleRight, viewersContainer);
  }

  const livePrefix = t('app_meta_live_prefix');
  const uptimeText = formatUptime(streamer.startedAt, '');
  if (uptimeText) {
    const uptimeContainer = document.createElement('span');
    if (livePrefix) {
      uptimeContainer.appendChild(document.createTextNode(livePrefix));
    }
    const uptimeValue = document.createElement('span');
    uptimeValue.className = 'streamer-meta-uptime';
    uptimeValue.textContent = uptimeText;
    uptimeContainer.appendChild(uptimeValue);
    appendMetaSegment(titleRight, uptimeContainer);
  }

  titleRow.appendChild(titleRight);

  return titleRow;
}

function createPrimaryMeta(streamer) {
  const metaPrimary = document.createElement('div');
  metaPrimary.className = 'streamer-meta streamer-meta-primary';

  if (streamer.gameName) {
    const gameSpan = document.createElement('span');
    gameSpan.className = 'streamer-meta-game';
    gameSpan.textContent = streamer.gameName;
    appendMetaSegment(metaPrimary, gameSpan);
  }

  if (!streamer.isLive) {
    const offlineSpan = document.createElement('span');
    offlineSpan.className = 'streamer-meta-offline';
    offlineSpan.textContent = t('app_meta_status_offline');
    appendMetaSegment(metaPrimary, offlineSpan);

    const lastSeenText = formatLastSeenLive(streamer.lastSeenLive);
    if (lastSeenText) {
      const lastSeenSpan = document.createElement('span');
      lastSeenSpan.className = 'streamer-meta-last-seen';
      lastSeenSpan.textContent = t('app_meta_last_seen', [lastSeenText]);
      appendMetaSegment(metaPrimary, lastSeenSpan);
    }
  }

  return metaPrimary;
}

function createFollowMeta(streamer) {
  const followMeta = document.createElement('div');
  followMeta.className = 'streamer-meta streamer-meta-followed';
  if (streamer.followDate) {
    const followDate = new Date(streamer.followDate).toLocaleDateString();
    followMeta.textContent = t('app_meta_followed_date', [followDate]);
  } else {
    followMeta.textContent = t('app_meta_followed_unknown');
  }
  return followMeta;
}

function createTagWrapper(streamer, state) {
  const tagWrapper = document.createElement('div');
  const assignedTags = getAssignmentsFor(streamer.id, state);
  
  if (assignedTags.length) {
    const orderedTags = assignedTags
      .map((tagId) => state.tagState?.tags?.[tagId])
      .filter(Boolean)
      .filter((tag) => tag.id !== TAG_STARRED)
      .sort(compareTagsByOrder);

    orderedTags.forEach((tag) => {
      const chip = createTagChip(tag);
      tagWrapper.appendChild(chip);
    });
  }

  return tagWrapper;
}

function getAssignmentsFor(streamerId, state) {
  return state.tagState?.assignments?.[streamerId] || [];
}

function createTagChip(tag) {
  const chip = document.createElement('span');
  chip.className = 'tag-chip';
  const backgroundColor = resolveTagColor(tag.color, DEFAULT_TAG_COLOR);
  chip.style.backgroundColor = backgroundColor;
  chip.style.color = getContrastingTextColor(backgroundColor);
  chip.textContent = tag.name;
  return chip;
}

function createStreamerPreview(streamer) {
  const previewColumn = document.createElement('div');
  previewColumn.className = 'streamer-preview-column';
  
  const hasPreview = streamer.isLive && streamer.thumbnailUrl;
  if (hasPreview) {
    const preview = document.createElement('img');
    preview.className = 'streamer-preview';
    preview.src = streamer.thumbnailUrl;
    const previewName = streamer.displayName || streamer.login;
    const previewFallback = `${previewName} live preview`;
    preview.alt = t('app_stream_preview_alt', [previewName]);
    preview.loading = 'lazy';
    previewColumn.appendChild(preview);
  } else {
    previewColumn.classList.add('empty');
  }

  return previewColumn;
}

function createStreamerActions(streamer, state, handlers) {
  const footer = document.createElement('div');
  footer.className = 'streamer-actions';

  const favoriteButton = createFavoriteButton(streamer, state, handlers);
  footer.appendChild(favoriteButton);

  const tagSelector = createTagSelector(streamer, state, handlers);
  footer.appendChild(tagSelector);

  return footer;
}

function createFavoriteButton(streamer, state, handlers) {
  const favoriteButton = document.createElement('button');
  favoriteButton.type = 'button';
  favoriteButton.className = 'btn btn-sm favorite-btn';
  const addToStarredLabel = t('content_add_to_starred');
  const removeFromStarredLabel = t('content_remove_from_starred');
  favoriteButton.setAttribute('aria-label', addToStarredLabel);
  favoriteButton.innerHTML = `
    <svg width="18" height="18" viewBox="0 0 90 90" aria-hidden="true" focusable="false">
      <path d="${STAR_SVG_PATH}" fill="currentColor"></path>
    </svg>
  `;
  
  const isFavorite = getAssignmentsFor(streamer.id, state).includes(TAG_STARRED);
  favoriteButton.setAttribute('aria-pressed', isFavorite ? 'true' : 'false');
  if (isFavorite) {
    favoriteButton.classList.add('favorite-btn--active');
    favoriteButton.title = removeFromStarredLabel;
    favoriteButton.setAttribute('aria-label', removeFromStarredLabel);
  } else {
    favoriteButton.classList.remove('favorite-btn--active');
    favoriteButton.title = addToStarredLabel;
    favoriteButton.setAttribute('aria-label', addToStarredLabel);
  }

  favoriteButton.addEventListener('click', async (event) => {
    event.stopPropagation();
    favoriteButton.disabled = true;
    try {
      await handlers.onToggleFavorite(streamer.id, !isFavorite);
    } catch (error) {
      handleUserError(error, t('app_error_update_favorite'));
    } finally {
      favoriteButton.disabled = false;
    }
  });

  return favoriteButton;
}

function createTagSelector(streamer, state, handlers) {
  const tagSelector = document.createElement('div');
  tagSelector.className = 'dropdown tag-selector';

  const manageButton = createManageButton();
  const menu = createTagMenu(streamer, state, handlers);

  tagSelector.appendChild(manageButton);
  tagSelector.appendChild(menu);

  // Initialize Bootstrap dropdown with fixed positioning
  if (typeof bootstrap !== 'undefined' && bootstrap.Dropdown) {
    setTimeout(() => {
      new bootstrap.Dropdown(manageButton, {
        boundary: 'viewport',
        autoClose: 'outside',
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
    }, 0);
  }

  return tagSelector;
}

function createManageButton() {
  const manageButton = document.createElement('button');
  manageButton.type = 'button';
  manageButton.className = 'btn btn-sm btn-primary btn-icon';
  manageButton.setAttribute('data-bs-toggle', 'dropdown');
  manageButton.setAttribute('aria-expanded', 'false');
  const manageLabel = t('content_manage_tags');
  manageButton.setAttribute('aria-label', manageLabel);
  manageButton.title = manageLabel;
  manageButton.innerHTML = `
    <svg class="icon-tag" width="16" height="16" fill="currentColor" aria-hidden="true" focusable="false">
      <use href="../assets/icons/tag.svg#icon"/>
    </svg>
  `;
  manageButton.addEventListener('click', (event) => {
    event.stopPropagation();
  });
  return manageButton;
}

function createTagMenu(streamer, state, handlers) {
  const menu = document.createElement('ul');
  menu.className = 'dropdown-menu tag-selector-menu';
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', t('app_tag_menu_label'));

  const availableTags = Object.values(state.tagState?.tags || {})
    .filter((tag) => tag.id !== TAG_STARRED)
    .sort(compareTagsByOrder);

  if (!availableTags.length) {
    const emptyItem = document.createElement('li');
    const emptyText = document.createElement('span');
    emptyText.className = 'tag-selector-empty text-muted small';
    emptyText.textContent = t('app_tag_menu_empty');
    emptyItem.appendChild(emptyText);
    menu.appendChild(emptyItem);
    return menu;
  }

  const assignments = new Set(getAssignmentsFor(streamer.id, state));

  availableTags.forEach((tag) => {
    const item = document.createElement('li');
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'tag-selector-item';
    trigger.dataset.tagId = tag.id;
    trigger.setAttribute('role', 'menuitemcheckbox');

    const isAssigned = assignments.has(tag.id);
    trigger.setAttribute('aria-checked', isAssigned ? 'true' : 'false');

    const checkmark = document.createElement('span');
    checkmark.className = 'tag-selector-check';
    checkmark.textContent = isAssigned ? '✓' : '';

    const colorSwatch = document.createElement('span');
    colorSwatch.className = 'tag-selector-color';
    const resolvedColor = resolveTagColor(tag.color, DEFAULT_TAG_COLOR);
    colorSwatch.style.backgroundColor = resolvedColor;

    const name = document.createElement('span');
    name.className = 'tag-selector-name';
    name.textContent = tag.name;

    trigger.appendChild(checkmark);
    trigger.appendChild(colorSwatch);
    trigger.appendChild(name);

    trigger.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (trigger.disabled) return;

      const shouldAssign = !assignments.has(tag.id);
      trigger.disabled = true;
      trigger.classList.add('is-loading');

      const success = await handlers.onToggleTagAssignment(streamer.id, tag.id, shouldAssign);

      trigger.disabled = false;
      trigger.classList.remove('is-loading');

      if (!success) {
        return;
      }

      if (shouldAssign) {
        assignments.add(tag.id);
        checkmark.textContent = '✓';
        trigger.setAttribute('aria-checked', 'true');
      } else {
        assignments.delete(tag.id);
        checkmark.textContent = '';
        trigger.setAttribute('aria-checked', 'false');
      }
    });

    item.appendChild(trigger);
    menu.appendChild(item);
  });

  return menu;
}

function addStreamerCardEvents(card, streamer) {
  const openStreamer = () => {
    if (!streamer.login) return;
    const url = `https://www.twitch.tv/${streamer.login}`;
    window.open(url, '_blank', 'noopener');
  };

  const openStreamerInBackground = () => {
    if (!streamer.login) return;
    const url = `https://www.twitch.tv/${streamer.login}`;
    if (typeof chrome !== 'undefined' && chrome.tabs) {
      chrome.tabs.create({ url, active: false });
    } else if (typeof browser !== 'undefined' && browser.tabs) {
      browser.tabs.create({ url, active: false });
    } else {
      window.open(url, '_blank', 'noopener');
    }
  };

  card.addEventListener('click', (event) => {
    const interactive = event.target.closest('button, input, label, select, textarea, a');
    if (interactive) return;
    openStreamer();
  });

  card.addEventListener('auxclick', (event) => {
    if (event.button === 1) {
      event.preventDefault();
      const interactive = event.target.closest('button, input, label, select, textarea, a');
      if (interactive) return;
      openStreamerInBackground();
    }
  });

  card.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const interactive = event.target.closest('button, input, label, select, textarea, a');
    if (interactive && interactive !== card) return;
    event.preventDefault();
    openStreamer();
  });

  card.tabIndex = 0;
  card.setAttribute('role', 'link');
  card.setAttribute('aria-label', `Open ${streamer.displayName || streamer.login} on Twitch`);
}
