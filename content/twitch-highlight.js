/**
 * Twitch.tv Content Script - Highlight Starred Streamers
 *
 * This script monitors the Twitch sidebar for followed channels and applies
 * visual highlighting to streamers marked as starred/favorite in the extension.
 */

// Constants
const STARRED_TAG_ID = 'favorite';
const HIGHLIGHT_CLASS = 'ttagger-starred';
const TAG_CONTAINER_CLASS = 'ttagger-sidebar-tag-badges';
const TAG_BADGE_CLASS = 'ttagger-sidebar-tag-badge';
const DEFAULT_BADGE_COLOR = '#6f42c1';
const DEBOUNCE_DELAY = 300;
let LOG_DEBUG = false;
const DEBUG_PREFIX = '[TTagger Highlight]';

// State
let starredStreamerIds = new Set(); // Twitch user IDs
let starredUsernames = new Set(); // Lowercase usernames
let processingTimeout = null;
let highlightingEnabled = true; // Whether highlighting is enabled
let sidebarTagsEnabled = true; // Whether tag badges are enabled
let streamerTagMap = new Map(); // login (lowercase) -> Array<{ id, name, abbr }>

function setDebugLogging(enabled) {
  LOG_DEBUG = !!enabled;
  if (LOG_DEBUG) {
    console.info(`${DEBUG_PREFIX} Debug logging enabled`);
  }
}

function debug(...args) {
  if (!LOG_DEBUG) return;
  console.debug(DEBUG_PREFIX, ...args);
}

/**
 * Create a compact uppercase abbreviation for a tag name.
 * @param {string} name
 * @returns {string}
 */
function abbreviateTagName(name) {
  if (!name || typeof name !== 'string') {
    return '';
  }

  const compact = name.replace(/\s+/g, '').trim();
  if (!compact) {
    return '';
  }

  return compact.slice(0, 2).toUpperCase();
}

/**
 * Normalize a potential tag color into a 6-digit hex.
 * Falls back to DEFAULT_BADGE_COLOR when invalid.
 * @param {string} color
 * @returns {string}
 */
function resolveTagColor(color) {
  if (typeof color !== 'string') {
    return DEFAULT_BADGE_COLOR;
  }
  const trimmed = color.trim();
  if (!trimmed) return DEFAULT_BADGE_COLOR;
  const match = trimmed.match(/^#?([0-9a-fA-F]{6})$/);
  if (!match) return DEFAULT_BADGE_COLOR;
  return `#${match[1].toLowerCase()}`;
}

/**
 * Provide a contrasting text color for a badge background.
 * @param {string} background
 * @returns {string}
 */
function getContrastingTextColor(background) {
  const resolved = resolveTagColor(background);
  const r = parseInt(resolved.slice(1, 3), 16) / 255;
  const g = parseInt(resolved.slice(3, 5), 16) / 255;
  const b = parseInt(resolved.slice(5, 7), 16) / 255;
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.57 ? '#1f1f23' : '#ffffff';
}

/**
 * Resolve the Twitch username associated with a sidebar card.
 * @param {Element} cardElement
 * @returns {string|null}
 */
function getCardUsername(cardElement) {
  if (!cardElement) return null;
  const linkElement = cardElement.querySelector('a[href^="/"]');
  if (!linkElement) return null;

  const href = linkElement.getAttribute('href');
  return extractUsername(href);
}

/**
 * Fetch the highlighting enabled preference from storage
 */
async function fetchHighlightingPreference() {
  try {
    const result = await chrome.storage.sync.get('preferences');
    const preferences = result.preferences || {};
    highlightingEnabled = preferences.twitchHighlighting !== false;
    sidebarTagsEnabled = preferences.twitchSidebarTags !== false;
    setDebugLogging(preferences.debugLogging === true);
    return highlightingEnabled;
  } catch (error) {
    console.error('[TTagger] Error fetching highlighting preference:', error);
    LOG_DEBUG = false;
    sidebarTagsEnabled = true;
    return true; // Default to enabled
  }
}

/**
 * Fetch the current list of starred streamers from storage
 */
async function fetchStarredStreamers() {
  try {
    // Get both tag assignments and follow cache
    const result = await chrome.storage.local.get(['tagState', 'followCache']);

    // First get the starred IDs from tagState (stored in sync)
    const syncResult = await chrome.storage.sync.get('tagState');
    const tagState = syncResult.tagState || { assignments: {}, tags: {} };
    const assignments = tagState.assignments || {};
    const tagsById = tagState.tags || {};

    // Get the follow cache which has the ID-to-username mapping
    const followCache = result.followCache || {};
    const streamers = followCache.items || [];

    // Find all streamers with the 'favorite' tag (these are IDs)
    const starredIds = new Set();
    for (const [streamerId, tags] of Object.entries(assignments)) {
      if (Array.isArray(tags) && tags.includes(STARRED_TAG_ID)) {
        starredIds.add(streamerId);
      }
    }

    // Convert IDs to usernames using the follow cache and build tag mapping
    const usernames = new Set();
    const loginToBadges = new Map();
    for (const streamer of streamers) {
      if (!streamer || !streamer.login) continue;

      const login = streamer.login.toLowerCase();

      if (starredIds.has(streamer.id)) {
        usernames.add(login);
      }

      const assignedTags = assignments[streamer.id];
      if (Array.isArray(assignedTags) && assignedTags.length > 0) {
        const badges = [];
        for (const tagId of assignedTags) {
          if (!tagId) continue;
          if (tagId === STARRED_TAG_ID) continue;
          const tag = tagsById[tagId] || {};
          const tagName = typeof tag.name === 'string' ? tag.name : '';
          const customName = typeof tag.customName === 'string' ? tag.customName : '';
          const displayName = (tagName && tagName.trim()) || (customName && customName.trim());
          if (!displayName) continue;
          const abbr = abbreviateTagName(displayName);
          if (!abbr) continue;
          const badgeColor = resolveTagColor(tag.color);
          const badgeId = tag.id || tagId;
          badges.push({ id: badgeId, name: displayName, abbr, color: badgeColor });
        }
        if (badges.length > 0) {
          loginToBadges.set(login, badges);
        }
      }
    }

    starredStreamerIds = starredIds;
    starredUsernames = usernames;
    streamerTagMap = loginToBadges;
    debug('Cached tag badges for', loginToBadges.size, 'streamers');

    return usernames;
  } catch (error) {
    console.error('[TTagger] Error fetching starred streamers:', error);
    streamerTagMap = new Map();
    return new Set();
  }
}

/**
 * Extract streamer username from various Twitch URL formats
 * @param {string} href - The href attribute from a Twitch link
 * @returns {string|null} - Normalized username or null
 */
function extractUsername(href) {
  if (!href) return null;

  try {
    // Handle relative URLs like "/asche" or full URLs
    const url = href.startsWith('/') ? href : new URL(href).pathname;

    // Extract username - typically the first path segment
    const match = url.match(/^\/([^\/\?#]+)/);
    if (match && match[1]) {
      // Normalize to lowercase
      return match[1].toLowerCase();
    }
  } catch (error) {
    // URL parsing failed, try simple extraction
    const match = href.match(/^\/([^\/\?#]+)/);
    if (match && match[1]) {
      return match[1].toLowerCase();
    }
  }

  return null;
}

/**
 * Apply or remove the highlight class for a sidebar card avatar.
 * @param {Element} cardElement
 * @param {string|null} username
 */
function updateAvatarHighlight(cardElement, username) {
  if (!cardElement) return;

  let avatarContainer = cardElement.querySelector('.side-nav-card__avatar');

  if (!avatarContainer) {
    const link = cardElement.querySelector('.side-nav-card__link');
    if (link) {
      avatarContainer = link.querySelector(':scope > div:first-child');
    }
  }

  if (!avatarContainer) {
    return;
  }

  if (!highlightingEnabled || !username || !starredUsernames.has(username)) {
    avatarContainer.classList.remove(HIGHLIGHT_CLASS);
    return;
  }

  avatarContainer.classList.add(HIGHLIGHT_CLASS);
}

/**
 * Render or remove compact tag badges for a sidebar card.
 * @param {Element} cardElement
 * @param {string|null} username
 */
function updateTagBadges(cardElement, username) {
  if (!cardElement) return;

  const existingContainer = cardElement.querySelector(`.${TAG_CONTAINER_CLASS}`);

  if (!sidebarTagsEnabled || !username) {
    if (existingContainer) existingContainer.remove();
    return;
  }

  const badges = streamerTagMap.get(username);
  if (!badges || badges.length === 0) {
    if (existingContainer) existingContainer.remove();
    return;
  }

  let container = existingContainer;
  if (!container) {
    const metadataContainer = cardElement.querySelector('[data-a-target="side-nav-card-metadata"]');
    if (!metadataContainer) return;
    container = document.createElement('div');
    container.className = TAG_CONTAINER_CLASS;
    metadataContainer.appendChild(container);
  }

  const badgeKey = badges.map(badge => `${badge.id}:${badge.abbr}:${badge.color}`).join(',');
  if (container.dataset.badgeKey === badgeKey) {
    return;
  }

  container.textContent = '';
  badges.forEach(badge => {
    const badgeElement = document.createElement('span');
    badgeElement.className = TAG_BADGE_CLASS;
    badgeElement.textContent = badge.abbr;
    const bgColor = badge.color || DEFAULT_BADGE_COLOR;
    badgeElement.style.backgroundColor = bgColor;
    badgeElement.style.color = getContrastingTextColor(bgColor);
    badgeElement.style.borderColor = bgColor;
    if (badge.name) {
      badgeElement.title = badge.name;
    }
    container.appendChild(badgeElement);
  });
  container.dataset.badgeKey = badgeKey;
}

/**
 * Apply or remove highlighting to sidebar cards
 */
function updateHighlighting() {
  // Find all sidebar cards for followed channels
  const sidebarCards = document.querySelectorAll('.side-nav-card');

  sidebarCards.forEach(card => {
    const username = getCardUsername(card);
    updateAvatarHighlight(card, username);
    updateTagBadges(card, username);
  });
}

/**
 * Debounced update function to avoid excessive processing
 */
function scheduleUpdate() {
  if (processingTimeout) {
    clearTimeout(processingTimeout);
  }

  processingTimeout = setTimeout(() => {
    updateHighlighting();
    processingTimeout = null;
  }, DEBOUNCE_DELAY);
}

/**
 * Set up MutationObserver to watch for sidebar changes
 */
function observeSidebar() {
  const observer = new MutationObserver((mutations) => {
    // Check if any mutations affect the sidebar
    const hasSidebarChanges = mutations.some(mutation => {
      // Check if added nodes contain sidebar elements
      if (mutation.addedNodes.length > 0) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            if (node.matches?.('.side-nav-card, .side-nav-section') ||
              node.querySelector?.('.side-nav-card, .side-nav-section')) {
              return true;
            }
          }
        }
      }

      // Check if removed nodes contained sidebar elements
      if (mutation.removedNodes.length > 0) {
        for (const node of mutation.removedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            if (node.matches?.('.side-nav-card, .side-nav-section')) {
              return true;
            }
          }
        }
      }

      return false;
    });

    if (hasSidebarChanges) {
      scheduleUpdate();
    }
  });

  // Start observing the document body for changes
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });

  return observer;
}

/**
 * Listen for storage changes to update highlighting in real-time
 */
function setupStorageListener() {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'sync') {
      // Tag state changed, refetch starred streamers and update
      if (changes.tagState) {
        fetchStarredStreamers().then(() => {
          updateHighlighting();
        });
      }

      // Preferences changed, check if highlighting was toggled
      if (changes.preferences) {
        fetchHighlightingPreference().then(() => {
          updateHighlighting();
        });
      }
    }

    if (areaName === 'local') {
      if (changes.followCache) {
        fetchStarredStreamers().then(() => {
          updateHighlighting();
        });
      }
    }
  });
}

/**
 * Initialize the content script
 */
async function initialize() {
  // Fetch highlighting preference
  await fetchHighlightingPreference();

  // Fetch initial list of starred streamers
  await fetchStarredStreamers();

  if (highlightingEnabled) {
    debug('Highlighting', starredUsernames.size, 'starred streamers on Twitch');
  } else {
    debug('Twitch highlighting is disabled');
  }

  // Apply initial highlighting
  updateHighlighting();

  // Set up observers and listeners
  observeSidebar();
  setupStorageListener();
}

// Start the script when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initialize);
} else {
  initialize();
}
