/**
 * Twitch.tv Content Script - Highlight Starred Streamers
 *
 * This script monitors the Twitch sidebar for followed channels and applies
 * visual highlighting to streamers marked as starred/favorite in the extension.
 */

// Constants
const STARRED_TAG_ID = 'favorite';
const HIGHLIGHT_CLASS = 'ttagger-starred';
const DEBOUNCE_DELAY = 300;
let LOG_DEBUG = false;
const DEBUG_PREFIX = '[TTagger Highlight]';

// State
let starredStreamerIds = new Set(); // Twitch user IDs
let starredUsernames = new Set(); // Lowercase usernames
let processingTimeout = null;
let highlightingEnabled = true; // Whether highlighting is enabled

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
 * Fetch the highlighting enabled preference from storage
 */
async function fetchHighlightingPreference() {
  try {
    const result = await chrome.storage.sync.get('preferences');
    const preferences = result.preferences || {};
    highlightingEnabled = preferences.twitchHighlighting !== false;
    setDebugLogging(preferences.debugLogging === true);
    return highlightingEnabled;
  } catch (error) {
    console.error('[TTagger] Error fetching highlighting preference:', error);
    LOG_DEBUG = false;
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
    const tagState = syncResult.tagState || { assignments: {} };
    const assignments = tagState.assignments || {};

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

    // Convert IDs to usernames using the follow cache
    const usernames = new Set();
    for (const streamer of streamers) {
      if (starredIds.has(streamer.id)) {
        const username = streamer.login.toLowerCase();
        usernames.add(username);
      }
    }

    starredStreamerIds = starredIds;
    starredUsernames = usernames;

    return usernames;
  } catch (error) {
    console.error('[TTagger] Error fetching starred streamers:', error);
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
 * Check if a sidebar card element represents a starred streamer
 * @param {Element} cardElement - The side-nav-card element
 * @returns {boolean}
 */
function isStarredStreamer(cardElement) {
  // Find the link element that contains the streamer URL
  const linkElement = cardElement.querySelector('a[href^="/"]');
  if (!linkElement) return false;

  const href = linkElement.getAttribute('href');
  const username = extractUsername(href);

  if (!username) return false;

  return starredUsernames.has(username);
}

/**
 * Apply or remove highlighting to sidebar cards
 */
function updateHighlighting() {
  // Find all sidebar cards for followed channels
  const sidebarCards = document.querySelectorAll('.side-nav-card');

  sidebarCards.forEach(card => {
    // Try to find the normal avatar container first
    let avatarContainer = card.querySelector('.side-nav-card__avatar');

    // If not found, this might be a guest stream (co-stream) which has a different structure
    // In that case, the first child div of the link is the wrapper we want to highlight
    if (!avatarContainer) {
      const link = card.querySelector('.side-nav-card__link');
      if (link) {
        // Get the first direct child div which is the avatar wrapper for guest streams
        avatarContainer = link.querySelector(':scope > div:first-child');
      }
    }

    if (avatarContainer) {
      // If highlighting is disabled, remove all highlights
      if (!highlightingEnabled) {
        avatarContainer.classList.remove(HIGHLIGHT_CLASS);
        return;
      }

      // Otherwise, apply highlighting based on starred status
      const shouldHighlight = isStarredStreamer(card);
      if (shouldHighlight) {
        avatarContainer.classList.add(HIGHLIGHT_CLASS);
      } else {
        avatarContainer.classList.remove(HIGHLIGHT_CLASS);
      }
    }
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
