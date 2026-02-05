/**
 * @fileoverview Dashboard State Management
 *
 * This module provides a centralized mutable state object for the dashboard UI.
 * The state is modified through setter functions to maintain consistency.
 *
 * ## State Structure
 * - `auth`: Current authentication state (user and token info)
 * - `follows`: Array of followed streamers with live status
 * - `tagState`: Tag definitions and streamer assignments
 * - `preferences`: User preferences (sorting, filters, theme)
 * - `fetchedAt`: Timestamp of last data fetch
 * - `isLoading`: Loading indicator flag
 * - `openTagMenu`: Currently open tag menu streamer ID
 *
 * ## Mutation Pattern
 * State should ONLY be modified through the exported setter functions.
 * Direct mutation of the state object is discouraged to prevent bugs.
 *
 * ## Synchronization
 * - State is synchronized with storage when modified
 * - Changes trigger re-renders via render.js
 * - Background script broadcasts updates via message passing
 * - Storage listeners update state reactively
 *
 * @module app/state
 */

import {
  TAG_ALL,
  THEME_SYSTEM,
  LANGUAGE_SYSTEM,
} from '../util/constants.js';

export const defaultTagState = { tags: {}, assignments: {}, nextId: 1 };

export const defaultPreferences = {
  sortBy: 'follow-date-desc',
  liveFirst: true,
  starredFirst: true,
  nameFilter: '',
  contentFilter: '',
  selectedTagId: TAG_ALL,
  themeMode: THEME_SYSTEM,
  notificationsEnabled: false,
  openInCurrentTab: false,
  twitchHighlighting: true,
  twitchSidebarTags: true,
  languageOverride: LANGUAGE_SYSTEM,
  debugLogging: false,
};

/**
 * Mutable singleton holding the dashboard view-model.
 * Mutations go through the helper functions below to keep wiring consistent.
 */
export const state = {
  auth: null,
  follows: [],
  tagState: { ...defaultTagState },
  preferences: { ...defaultPreferences },
  fetchedAt: null,
  isLoading: false,
  openTagMenu: null,
};

/**
 * Replace the cached auth payload from the background script.
 * @param {object|null} auth
 */
export function setAuth(auth) {
  state.auth = auth;
}

/**
 * Replace the follow list backing the streamer grid.
 * @param {Array<object>} follows
 */
export function setFollows(follows) {
  state.follows = follows;
}

/**
 * Replace the stored tag state snapshot.
 * @param {{tags: object, assignments: object, nextId: number}} next
 */
export function setTagState(next) {
  state.tagState = next;
}

/**
 * Merge preference fields in place, preserving existing values by default.
 * @param {object} [next]
 */
export function mergePreferences(next = {}) {
  state.preferences = {
    ...state.preferences,
    ...next,
  };
}

/**
 * Stamp the time of the most recent follow cache update (ms).
 * @param {number|null} timestamp
 */
export function setFetchedAt(timestamp) {
  state.fetchedAt = timestamp;
}

/**
 * Toggle the loading flag so renders can show spinners.
 * @param {boolean} isLoading
 */
export function setLoading(isLoading) {
  state.isLoading = isLoading;
}

/**
 * Remember which streamer's tag menu is open, if any.
 * @param {string|null} streamerId
 */
export function setOpenTagMenu(streamerId) {
  state.openTagMenu = streamerId;
}

/**
 * Reset the open tag menu tracking.
 */
export function clearOpenTagMenu() {
  state.openTagMenu = null;
}

/**
 * Return tag ids assigned to a streamer, defaulting to an empty array.
 * @param {string} streamerId
 * @returns {Array<string>}
 */
export function getAssignmentsFor(streamerId) {
  return state.tagState?.assignments?.[streamerId] || [];
}
