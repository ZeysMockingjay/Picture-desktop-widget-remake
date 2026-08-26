import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

export const MIN_WIDGET_SIZE = 20;
export const MIN_WIDGET_TIMEOUT = 5;
export const MIN_WIDGET_ASPECT_RATIO = 0.25;
export const MIN_WIDGET_CORNER_RADIUS = 0;

export const DEFAULT_PROFILE = {
    name: _('Default widget'),
    imagePath: '',
    widgetSize: 200,
    widgetPositionX: 100,
    widgetPositionY: 100,
    widgetAspectRatio: 1.0,
    widgetTimeout: 60,
    widgetCornerRadius: 20,
    timeLastUpdate: 0,
    currentImagePath: '',
    cachedFiles: [],
    cachedFolderPath: '',
    visible: true,
    requiresRescan: true,
};

function _createProfileId() {
    return `profile-${Math.random().toString(36).slice(2, 10)}`;
}

function _toNumberOrFallback(value, fallback) {
    const numberValue = Number(value);
    if (Number.isFinite(numberValue))
        return numberValue;
    return Number(fallback);
}

function _resolveVisible(profileValue, fallbackValue) {
    if (profileValue === undefined)
        return fallbackValue !== false;
    return profileValue !== false;
}

export function normalizeProfile(profile = {}, fallback = {}, defaultName = DEFAULT_PROFILE.name) {
    const mergedFallback = { ...DEFAULT_PROFILE, ...fallback };
    const normalized = {
        ...mergedFallback,
        ...profile,
        id: profile.id || mergedFallback.id || _createProfileId(),
        name: profile.name || mergedFallback.name || defaultName,
        imagePath: profile.imagePath ?? mergedFallback.imagePath ?? '',
        widgetSize: _toNumberOrFallback(profile.widgetSize, mergedFallback.widgetSize),
        widgetPositionX: _toNumberOrFallback(
            profile.widgetPositionX,
            mergedFallback.widgetPositionX
        ),
        widgetPositionY: _toNumberOrFallback(
            profile.widgetPositionY,
            mergedFallback.widgetPositionY
        ),
        widgetAspectRatio: _toNumberOrFallback(
            profile.widgetAspectRatio,
            mergedFallback.widgetAspectRatio
        ),
        widgetTimeout: _toNumberOrFallback(profile.widgetTimeout, mergedFallback.widgetTimeout),
        widgetCornerRadius: _toNumberOrFallback(
            profile.widgetCornerRadius,
            mergedFallback.widgetCornerRadius
        ),
        timeLastUpdate: _toNumberOrFallback(profile.timeLastUpdate, mergedFallback.timeLastUpdate),
        currentImagePath: profile.currentImagePath ?? mergedFallback.currentImagePath ?? '',
        cachedFiles: Array.isArray(profile.cachedFiles)
            ? profile.cachedFiles
            : (Array.isArray(mergedFallback.cachedFiles) ? mergedFallback.cachedFiles : []),
        cachedFolderPath: profile.cachedFolderPath ?? mergedFallback.cachedFolderPath ?? '',
        visible: _resolveVisible(profile.visible, mergedFallback.visible),
        requiresRescan: profile.requiresRescan === true ||
            mergedFallback.requiresRescan === true ||
            (profile.requiresRescan === undefined &&
             mergedFallback.requiresRescan === undefined),
    };

    if (normalized.widgetSize < MIN_WIDGET_SIZE)
        normalized.widgetSize = MIN_WIDGET_SIZE;
    if (normalized.widgetTimeout < MIN_WIDGET_TIMEOUT)
        normalized.widgetTimeout = MIN_WIDGET_TIMEOUT;
    if (normalized.widgetCornerRadius < MIN_WIDGET_CORNER_RADIUS)
        normalized.widgetCornerRadius = MIN_WIDGET_CORNER_RADIUS;
    if (normalized.widgetAspectRatio < MIN_WIDGET_ASPECT_RATIO)
        normalized.widgetAspectRatio = MIN_WIDGET_ASPECT_RATIO;

    return normalized;
}

export function normalizeProfiles(profiles, defaultName = DEFAULT_PROFILE.name) {
    if (!Array.isArray(profiles))
        return [];
    const seenIds = new Set();
    const normalizedProfiles = [];

    for (const profile of profiles) {
        const normalized = normalizeProfile(profile, {}, defaultName);
        if (seenIds.has(normalized.id))
            normalized.id = _createProfileId();
        seenIds.add(normalized.id);
        normalizedProfiles.push(normalized);
    }

    return normalizedProfiles;
}

export function createDefaultProfile(defaultName = DEFAULT_PROFILE.name) {
    return normalizeProfile({ id: _createProfileId(), name: defaultName });
}

export function toPersistedProfile(profile = {}, defaultName = DEFAULT_PROFILE.name) {
    const normalized = normalizeProfile(profile, {}, defaultName);
    return {
        id: normalized.id,
        name: normalized.name,
        imagePath: normalized.imagePath,
        widgetSize: normalized.widgetSize,
        widgetPositionX: normalized.widgetPositionX,
        widgetPositionY: normalized.widgetPositionY,
        widgetAspectRatio: normalized.widgetAspectRatio,
        widgetTimeout: normalized.widgetTimeout,
        widgetCornerRadius: normalized.widgetCornerRadius,
        visible: normalized.visible !== false,
    };
}
