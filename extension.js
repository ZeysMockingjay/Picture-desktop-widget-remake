import St from 'gi://St';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { Extension, gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

/**
 * Picture Desktop Widget extension
 * - Manages multiple widget "profiles" each showing random images from a folder
 * - Caches file lists per-profile and monitors directories for changes
 * - Applies layout and CSS styling directly to St.Widget instances
 *
 * Performance notes:
 * - Scanning is depth-limited and capped to avoid blocking on huge folders
 * - Directory monitors trigger lightweight refreshes and mark profiles for rescans
 */
// Scanning limits to avoid blocking on extremely large folders
const MAX_SCAN_DEPTH = 6;
const MAX_SCAN_FILES = 20000;
const SKIP_DOT_DIRS = true;
const SUPPORTED_IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg'];

export default class PictureDesktopWidgetExtension extends Extension {
    enable() {
        this.settings = this.getSettings();
        this._dirMonitors = new Map();
        this._monitorDebounceIds = new Map();
        this._profiles = this._normalizeProfiles(this._loadProfiles());
        this._widgetByProfileId = new Map();
        this._timeoutIds = new Map();
        this._reloadingProfiles = false;

        if (this._profiles.length === 0) {
            this._profiles = [this._createDefaultProfile()];
        }

        // Create all widgets and start their timers BEFORE saving, to prevent
        // the 'changed::widget-profiles' signal from triggering _reloadProfiles
        // mid-initialization and causing duplicate work.
        this._reloadingProfiles = true;
        try {
            this._profiles.forEach(profile => {
                this._createWidget(profile);
                this._refreshProfile(profile, true);
                this._installDirMonitor(profile);
                this._scheduleProfileRefresh(profile);
            });
            this._saveProfiles(this._profiles);
        } finally {
            this._reloadingProfiles = false;
        }

        this.settings.connectObject(
            'changed::widget-profiles',
            this._reloadProfiles,
            'changed::active-profile-id',
            this._reloadProfiles,
            this
        );
    }

    disable() {
        this._reloadingProfiles = true;

        for (const [id, timeoutId] of this._timeoutIds) {
            if (timeoutId) {
                GLib.Source.remove(timeoutId);
            }
        }
        this._timeoutIds.clear();
        for (const [id, timeoutId] of this._monitorDebounceIds) {
            if (timeoutId) {
                GLib.Source.remove(timeoutId);
            }
        }
        this._monitorDebounceIds.clear();

        if (this.settings)
            this.settings.disconnectObject(this);

        for (const widget of this._widgetByProfileId.values()) {
            if (widget) {
                widget.destroy();
            }
        }
        this._widgetByProfileId.clear();
        // Cancel any directory monitors
        if (this._dirMonitors) {
            for (const profileId of this._dirMonitors.keys()) {
                this._removeDirMonitor(profileId);
            }
            this._dirMonitors.clear();
        }
        this._profiles = [];
        this.settings = null;
    }

    _installDirMonitor(profile) {
        // Install a Gio.File monitor for `profile.imagePath` so that
        // adding/removing files in the directory triggers an update.
        // This is intentionally lightweight: we mark `requiresRescan` and
        // trigger the normal refresh cycle rather than doing a full scan
        // in the monitor callback.
        if (!profile || !profile.imagePath)
            return;
        if (!Gio.File.new_for_path(profile.imagePath).query_exists(null))
            return;
        try {
            // Remove existing monitor for this profile if present
            this._removeDirMonitor(profile.id);

            const file = Gio.File.new_for_path(profile.imagePath);
            const monitor = file.monitor_directory(Gio.FileMonitorFlags.NONE, null);
            monitor.connectObject('changed', () => {
                this._queueMonitorTriggeredRefresh(profile);
            }, this);
            this._dirMonitors.set(profile.id, monitor);
        } catch (error) {
            console.warn(`Failed to install monitor for ${profile.imagePath}: ${error}`);
        }
    }

    _removeDirMonitor(profileId) {
        // Cancel and remove a previously installed directory monitor.
        if (!this._dirMonitors)
            return;
        const monitor = this._dirMonitors.get(profileId);
        if (monitor) {
            this._disconnectAndCancelMonitor(monitor);
            this._dirMonitors.delete(profileId);
        }
        const debounceTimeoutId = this._monitorDebounceIds.get(profileId);
        if (debounceTimeoutId) {
            GLib.Source.remove(debounceTimeoutId);
            this._monitorDebounceIds.delete(profileId);
        }
    }

    _disconnectAndCancelMonitor(monitor) {
        if (!monitor)
            return;
        monitor.disconnectObject(this);
        monitor.cancel();
    }

    _queueMonitorTriggeredRefresh(profile) {
        if (!profile)
            return;

        const profileId = profile.id;
        const existingTimeoutId = this._monitorDebounceIds.get(profileId);
        if (existingTimeoutId) {
            GLib.Source.remove(existingTimeoutId);
            this._monitorDebounceIds.delete(profileId);
        }

        const timeoutId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT,
            1,
            () => {
                this._monitorDebounceIds.delete(profileId);
                profile.requiresRescan = true;
                this._refreshProfile(profile, false);
                this._scheduleProfileRefresh(profile);
                return GLib.SOURCE_REMOVE;
            }
        );
        this._monitorDebounceIds.set(profileId, timeoutId);
    }

    _createDefaultProfile() {
        // Create a sane default profile used when none are configured.
        return this._normalizeProfile({
            id: `profile-${Math.random().toString(36).slice(2, 10)}`,
            name: 'Default widget',
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
        });
    }

    _normalizeProfile(profile = {}, fallback = {}) {
        // Normalize profile values providing fallback defaults and type coercion.
        const profileVisible = profile.visible;
        const fallbackVisible = fallback.visible;

        const normalized = {
            id: profile.id ||
                 fallback.id ||
                 `profile-${Math.random().toString(36).slice(2, 10)}`,
            name: profile.name || fallback.name || _('Default widget'),
            imagePath: profile.imagePath ?? fallback.imagePath ?? '',
            widgetSize: Number.isFinite(Number(profile.widgetSize))
                ? Number(profile.widgetSize)
                : (Number.isFinite(Number(fallback.widgetSize))
                    ? Number(fallback.widgetSize)
                    : 200),
            widgetPositionX: Number.isFinite(Number(profile.widgetPositionX))
                ? Number(profile.widgetPositionX)
                : (Number.isFinite(Number(fallback.widgetPositionX))
                    ? Number(fallback.widgetPositionX)
                    : 100),
            widgetPositionY: Number.isFinite(Number(profile.widgetPositionY))
                ? Number(profile.widgetPositionY)
                : (Number.isFinite(Number(fallback.widgetPositionY))
                    ? Number(fallback.widgetPositionY)
                    : 100),
            widgetAspectRatio: Number.isFinite(Number(profile.widgetAspectRatio))
                ? Number(profile.widgetAspectRatio)
                : (Number.isFinite(Number(fallback.widgetAspectRatio))
                    ? Number(fallback.widgetAspectRatio)
                    : 1.0),
            widgetTimeout: Number.isFinite(Number(profile.widgetTimeout))
                ? Number(profile.widgetTimeout)
                : (Number.isFinite(Number(fallback.widgetTimeout))
                    ? Number(fallback.widgetTimeout)
                    : 60),
            widgetCornerRadius: Number.isFinite(Number(profile.widgetCornerRadius))
                ? Number(profile.widgetCornerRadius)
                : (Number.isFinite(Number(fallback.widgetCornerRadius))
                    ? Number(fallback.widgetCornerRadius)
                    : 20),
            timeLastUpdate: Number.isFinite(Number(profile.timeLastUpdate))
                ? Number(profile.timeLastUpdate)
                : (Number.isFinite(Number(fallback.timeLastUpdate))
                    ? Number(fallback.timeLastUpdate)
                    : 0),
            currentImagePath: profile.currentImagePath ?? fallback.currentImagePath ?? '',
            cachedFiles: Array.isArray(profile.cachedFiles)
                ? profile.cachedFiles
                : (Array.isArray(fallback.cachedFiles) ? fallback.cachedFiles : []),
            cachedFolderPath: profile.cachedFolderPath ?? fallback.cachedFolderPath ?? '',
            visible: profileVisible === undefined
                ? fallbackVisible !== false
                : profileVisible !== false,
            requiresRescan: profile.requiresRescan === true ||
                            fallback.requiresRescan === true ||
                            (profile.requiresRescan === undefined &&
                             fallback.requiresRescan === undefined),
        };

        if (normalized.widgetSize < 20) normalized.widgetSize = 20;
        if (normalized.widgetTimeout < 5) normalized.widgetTimeout = 5;
        if (normalized.widgetCornerRadius < 0) normalized.widgetCornerRadius = 0;
        return normalized;
    }

    _normalizeProfiles(profiles) {
        if (!Array.isArray(profiles)) return [];
        return profiles.map(p => this._normalizeProfile(p));
    }

    _loadProfiles() {
        // Load serialized profiles from GSettings. Be defensive: a corrupt
        // value should not crash the extension.
        try {
            const raw = this.settings.get_string('widget-profiles');
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
                return parsed;
            }
        } catch (error) {
            console.warn(`Unable to parse widget profiles: ${error}`);
        }
        return [];
    }

    _saveProfiles(profiles = this._profiles) {
        if (!this.settings) return;
        // Clone to avoid mutating in-memory profiles with normalization artifacts
        const toSave = this._normalizeProfiles(profiles.map(p => ({ ...p })));
        this.settings.set_string('widget-profiles', JSON.stringify(toSave));
        if (!this.settings.get_string('active-profile-id') && toSave[0]) {
            this.settings.set_string('active-profile-id', toSave[0].id);
        }
    }

    _createWidget(profile) {
        // Create an St.Widget and attach it to GNOME's background group.
        if (this._widgetByProfileId.has(profile.id)) {
            return this._widgetByProfileId.get(profile.id);
        }
        const widget = new St.Widget();
        widget._profileId = profile.id;
        widget._profileName = profile.name;
        widget.visible = profile.visible !== false;
        Main.layoutManager._backgroundGroup.add_child(widget);
        this._widgetByProfileId.set(profile.id, widget);
        return widget;
    }

    _scheduleProfileRefresh(profile, elapsedSeconds = null) {
        // Schedule the next refresh for `profile`, with optional adjustment
        // if `elapsedSeconds` (time since last real update) is known.
        const id = profile.id;
        if (this._timeoutIds.has(id)) {
            GLib.Source.remove(this._timeoutIds.get(id));
            this._timeoutIds.delete(id);
        }

        const interval = Math.max(5, profile.widgetTimeout || 60);

        // If we know how much time has passed since the last update, adjust
        // the next trigger so we maintain a consistent cycle from the last
        // real update time rather than always adding a full interval.
        let delay;
        if (elapsedSeconds !== null && elapsedSeconds >= 0) {
            delay = Math.max(5, interval - elapsedSeconds);
        } else if (profile.timeLastUpdate > 0) {
            const passed = Math.floor(Date.now() / 1000) - profile.timeLastUpdate;
            delay = Math.max(5, interval - Math.min(passed, interval));
        } else {
            delay = interval;
        }

        const timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, delay, () => {
            const current = this._profiles.find(p => p.id === id);
            if (current) {
                this._refreshProfile(current, false);
            }
            this._scheduleProfileRefresh(current || profile);
            return GLib.SOURCE_REMOVE;
        });
        this._timeoutIds.set(id, timeoutId);
    }

    _refreshProfile(profile, force = false) {
        const widget = this._widgetByProfileId.get(profile.id);
        if (!widget) return;

        widget.visible = profile.visible !== false;
        this._applyWidgetLayout(widget, profile);
        this._selectRandomImage(profile, force);
    }

    _applyWidgetLayout(widget, profile) {
        const aspectRatio = Math.max(0.25, profile.widgetAspectRatio || 1.0);
        const rawSize = Math.max(20, profile.widgetSize || 200);
        const width = rawSize * Math.sqrt(aspectRatio);
        const height = rawSize / Math.sqrt(aspectRatio);
        const x = Math.max(0, profile.widgetPositionX || 0);
        const y = Math.max(0, profile.widgetPositionY || 0);
        widget.set_width(width);
        widget.set_height(height);
        widget.set_position(x, y);
    }

    _selectRandomImage(profile, force = false) {
        // Select a random image for `profile` from the cachedFiles (or
        // rescan the folder if needed). Updates `profile.currentImagePath`.
        const widget = this._widgetByProfileId.get(profile.id);
        if (!widget) return;

        widget.visible = profile.visible !== false;
        if (profile.visible === false) return;

        const folderPath = profile.imagePath || '';
        if (folderPath === '') {
            profile.currentImagePath = '';
            profile._statusMessage = _('Add a path\n to folder with images');
            this._updateWidgetAppearance(widget, profile);
            return;
        }

        let fileNames = profile.cachedFiles || [];
        const shouldRescan = force ||
            profile.requiresRescan ||
            profile.cachedFolderPath !== folderPath ||
            fileNames.length === 0;
        if (shouldRescan) {
            // Rescan (synchronous, but capped by MAX_SCAN_* constants)
            fileNames = this._scanImageFiles(folderPath);
            profile.cachedFiles = fileNames;
            profile.cachedFolderPath = folderPath;
            profile.requiresRescan = false;
        }

        if (!Gio.File.new_for_path(folderPath).query_exists(null)) {
            profile.currentImagePath = '';
            profile._statusMessage = _('Folder not found');
            this._updateWidgetAppearance(widget, profile);
            return;
        }

        if (fileNames.length === 0) {
            profile.currentImagePath = '';
            profile.timeLastUpdate = 0;
            profile._statusMessage = _('No images found in this folder');
            this._updateWidgetAppearance(widget, profile);
            return;
        }

        const randomIndex = Math.floor(Math.random() * fileNames.length);
        const randomFile = fileNames[randomIndex];
        profile.currentImagePath = GLib.build_filenamev([folderPath, randomFile]);
        profile.timeLastUpdate = Math.floor(Date.now() / 1000);
        profile._statusMessage = '';
        this._updateWidgetAppearance(widget, profile);
    }

    _scanImageFiles(folderPath) {
        const folder = Gio.File.new_for_path(folderPath);
        const fileNames = [];

        // Depth-first directory scan with limits to avoid long blocking ops.
        // Returns relative paths (from folderPath) of matching image files.
        const scanDirectory = (directory, relativeBase = '', depth = 0) => {
            if (depth >= MAX_SCAN_DEPTH) return;
            try {
                const enumerator = directory.enumerate_children(
                    'standard::name,standard::type',
                    Gio.FileQueryInfoFlags.NONE,
                    null
                );
                let info;
                while ((info = enumerator.next_file(null)) !== null) {
                    if (fileNames.length >= MAX_SCAN_FILES) break;
                    const childName = info.get_name();
                    // Skip dot-directories like .cache or .git
                    if (SKIP_DOT_DIRS && childName.startsWith('.')) {
                        continue;
                    }
                    const childPath = directory.get_child(childName);
                    const relative = relativeBase
                        ? `${relativeBase}/${childName}`
                        : childName;

                    if (info.get_file_type() === Gio.FileType.DIRECTORY) {
                        scanDirectory(childPath, relative, depth + 1);
                    } else if (SUPPORTED_IMAGE_EXTENSIONS.some(
                        ext => childName.toLowerCase().endsWith(ext)
                    )) {
                        fileNames.push(relative);
                    }
                }
                enumerator.close(null);
            } catch (error) {
                console.warn(
                    `Error scanning directory ${directory.get_path()}: ${error}`
                );
            }
        };

        scanDirectory(folder);
        return fileNames.sort();
    }

    _updateWidgetAppearance(widget, profile) {
        // Apply sizing, corner-radius, and either placeholder text or a
        // background image URI to the widget's inline CSS.
        const radiusPercent = Math.max(0, profile.widgetCornerRadius || 0) / 100;
        const size = Math.max(20, profile.widgetSize || 200);
        const aspectRatio = Math.max(0.25, profile.widgetAspectRatio || 1.0);
        const width = size * Math.sqrt(aspectRatio);
        const height = size / Math.sqrt(aspectRatio);
        const radiusPx = radiusPercent * Math.min(width, height) / 2;

        widget.visible = profile.visible !== false;

        // Remove previously added label
        if (widget._emptyStateBox) {
            widget._emptyStateBox.destroy();
            widget._emptyStateBox = null;
            widget._label = null;
        } else if (widget._label) {
            widget._label.destroy();
            widget._label = null;
        }

        if (profile.visible === false) return;

        if (profile.currentImagePath === '') {
            widget.set_style(`
                background-image: none;
                background-color: rgba(0, 0, 0, 1);
                border-radius: ${radiusPx}px;
            `);

            const msg = profile._statusMessage ||
                (profile.imagePath
                    ? _('No images found in this folder')
                    : _('Add a path\n to folder with images'));
            const emptyStateBox = new St.BoxLayout({
                vertical: true,
                x_expand: true,
                y_expand: true,
                x_align: Clutter.ActorAlign.FILL,
                y_align: Clutter.ActorAlign.FILL,
            });
            const topSpacer = new St.Widget({ x_expand: true, y_expand: true });
            const label = new St.Label({
                text: msg,
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
                x_expand: true,
                y_expand: false,
            });
            label.set_style(`
                color: white;
                font-size: ${Math.max(10, Math.min(width, height) / 18)}px;
                text-align: center;
            `);
            const bottomSpacer = new St.Widget({ x_expand: true, y_expand: true });
            emptyStateBox.add_child(topSpacer);
            emptyStateBox.add_child(label);
            emptyStateBox.add_child(bottomSpacer);
            widget.add_child(emptyStateBox);
            widget._emptyStateBox = emptyStateBox;
            widget._label = label;
        } else {
            const imageUri = Gio.File.new_for_path(
                profile.currentImagePath
            ).get_uri();
            widget.set_style(`
                background-image: url("${imageUri}");
                background-size: cover;
                background-repeat: no-repeat;
                background-position: center;
                border-radius: ${radiusPx}px;
            `);
        }
    }

    _reloadProfiles = () => {
        // Reload profiles from GSettings and reconcile with in-memory state.
        // This preserves runtime-only fields (currentImagePath, cachedFiles,
        // etc.) by merging them back into incoming profiles.
        if (this._reloadingProfiles) return;
        this._reloadingProfiles = true;

        try {
            const incoming = this._normalizeProfiles(this._loadProfiles());
            const incomingIds = new Set(incoming.map(p => p.id));
            const existingIds = new Set(this._profiles.map(p => p.id));

            // Remove profiles that no longer exist
            for (const id of existingIds) {
                if (!incomingIds.has(id)) {
                    const widget = this._widgetByProfileId.get(id);
                    if (widget) widget.destroy();
                    this._widgetByProfileId.delete(id);

                    const tid = this._timeoutIds.get(id);
                    if (tid) GLib.Source.remove(tid);
                    this._timeoutIds.delete(id);
                    // Remove any directory monitor for the deleted profile
                    this._removeDirMonitor(id);
                }
            }

            // Create or update profiles
            for (let i = 0; i < incoming.length; i++) {
                const profile = incoming[i];
                const existing = this._profiles.find(p => p.id === profile.id);

                if (!existing) {
                    // Brand new profile
                    this._createWidget(profile);
                    this._refreshProfile(profile, true);
                    this._installDirMonitor(profile);
                    this._scheduleProfileRefresh(profile);
                    continue;
                }

                // Detect what actually changed
                const imagePathChanged = existing.imagePath !== profile.imagePath;
                const timeoutChanged = existing.widgetTimeout !== profile.widgetTimeout;
                const layoutChanged =
                    existing.widgetSize !== profile.widgetSize ||
                    existing.widgetPositionX !== profile.widgetPositionX ||
                    existing.widgetPositionY !== profile.widgetPositionY ||
                    existing.widgetAspectRatio !== profile.widgetAspectRatio ||
                    existing.widgetCornerRadius !== profile.widgetCornerRadius;
                const visibilityChanged = existing.visible !== profile.visible;
                const nameChanged = existing.name !== profile.name;

                const runtimeState = {
                    currentImagePath: existing.currentImagePath,
                    cachedFiles: existing.cachedFiles,
                    cachedFolderPath: existing.cachedFolderPath,
                    timeLastUpdate: existing.timeLastUpdate,
                    _statusMessage: existing._statusMessage,
                };

                // If the image path changed, remove any existing directory monitor
                if (imagePathChanged) {
                    this._removeDirMonitor(profile.id);
                }

                // Merge incoming values into the existing (preserving in-memory ref)
                // so that mutations from _refreshProfile/_selectRandomImage are kept
                Object.assign(existing, profile);
                Object.assign(existing, runtimeState);

                // Install directory monitor for the new path if it changed
                if (imagePathChanged) {
                    this._installDirMonitor(existing);
                }

                if (!imagePathChanged) {
                    existing.requiresRescan = false;
                } else {
                    existing.requiresRescan = true;
                }

                const widget = this._widgetByProfileId.get(profile.id);
                if (!widget) continue;

                const needsRefresh =
                    imagePathChanged || layoutChanged || visibilityChanged ||
                    timeoutChanged || nameChanged;

                if (!needsRefresh) continue;

                if (imagePathChanged) {
                    // Full refresh handles layout + image reselection
                    this._refreshProfile(existing, true);
                } else if (layoutChanged || visibilityChanged) {
                    this._applyWidgetLayout(widget, existing);
                    widget.visible = existing.visible !== false;
                    this._updateWidgetAppearance(widget, existing);
                }

                if (timeoutChanged) {
                    this._scheduleProfileRefresh(existing);
                }

                // Replace the incoming profile with the existing (mutated) reference
                // so that runtime-updated fields (timeLastUpdate, currentImagePath,
                // _statusMessage, cachedFiles, etc.) are not lost.
                incoming[i] = existing;
            }

            this._profiles = incoming;

            // Ensure active-profile-id is valid
            const activeId = this.settings.get_string('active-profile-id') ||
                             (incoming[0]?.id ?? '');
            this.settings.set_string(
                'active-profile-id',
                incoming.some(p => p.id === activeId) ? activeId : (incoming[0]?.id ?? '')
            );
        } finally {
            this._reloadingProfiles = false;
        }
    };
}