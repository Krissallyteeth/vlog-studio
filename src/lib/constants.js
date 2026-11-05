import { t } from '../i18n/index.js';

// Labels are getters so every list follows the current UI language.
const labelled = (prefix, ids) =>
  ids.map((id) => ({
    id,
    get label() {
      return t(`${prefix}.${id}`);
    },
  }));

export const STATUSES = labelled('status', ['planning', 'shooting', 'editing', 'done']);

export const TYPES = labelled('type', ['travel', 'daily', 'interior', 'lifestyle']);

/** What the video gives the viewer: name + one-line description. */
export const VALUES = ['info', 'practical', 'emotion', 'aesthetic', 'fun', 'company', 'cognitive', 'inspire', 'identity'].map((id) => ({
  id,
  get name() {
    return t(`value.${id}`);
  },
  get desc() {
    return t(`value.${id}.desc`);
  },
}));

export const SHOT_TYPES = ['env', 'action', 'reaction', 'detail', 'feeling'].map((id) => ({
  id,
  get name() {
    return t(`shot.${id}`);
  },
  get desc() {
    return t(`shot.${id}.desc`);
  },
  get hint() {
    return t(`shot.${id}.hint`);
  },
}));

export const SORT_OPTIONS = labelled('sort', ['shootDesc', 'shootAsc', 'updatedDesc', 'createdDesc']);

export const DEFAULT_TARGET = { min: 120, max: 180 };

/** Filter value prefix for user-written video types ("custom:맛집"), so they never collide with built-in ids. */
export const CUSTOM_TYPE_PREFIX = 'custom:';

export const labelOf = (list, id) => list.find((x) => x.id === id)?.label ?? '';

/** Every video type of a project as display labels: built-in ones first, then the user's own. */
export const typeLabels = (p) => [...(p.types ?? []).map((id) => labelOf(TYPES, id)).filter(Boolean), ...(p.customTypes ?? [])];
