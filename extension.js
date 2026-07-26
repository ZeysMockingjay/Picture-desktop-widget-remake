import St from 'gi://St';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { Extension, gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

export default class Picture_desktop_widget_extension extends Extension {
    enable() {
        this.settings = this.getSettings();
        this._profiles = this._normalizeProfiles(this._loadProfiles());
        this._widgetByProfileId = new Map();
        this._timeoutIds = new Map();
        this._settingsChangedIds = [];
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
                this._scheduleProfileRefresh(profile);
            });
            this._saveProfiles(this._profiles);
        } finally {
            this._reloadingProfiles = false;
        }

        this._settingsChangedIds.push(
            this.settings.connect('changed::widget-profiles', this._reloadProfiles),
            this.settings.connect('changed::active-profile-id', this._reloadProfiles)
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

        if (this._settingsChangedIds && this.settings) {
            for (const id of this._settingsChangedIds) {
                this.settings.disconnect(id);
            }
            this._settingsChangedIds = [];
        }

        for (const widget of this._widgetByProfileId.values()) {
            if (widget) {
                widget.destroy();
            }
        }
        this._widgetByProfileId.clear();
        this._profiles = [];
        this.settings = null;
    }

    _createDefaultProfile() {
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
        const hasOwnVisible = profile.visible !== undefined && fallback.visible !== undefined;
        const fallbackVisible = fallback.visible !== false;

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
            visible: hasOwnVisible
                ? (profile.visible !== false && fallback.visible !== false)
                : (profile.visible !== false),
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
        try {
            const raw = this.settings.get_string('widget-profiles');
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
                return parsed;
            }
        } catch (e) {
            console.warn(`Unable to parse widget profiles: ${e}`);
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
        profile.currentImagePath = `${folderPath}/${randomFile}`;
        profile.timeLastUpdate = Math.floor(Date.now() / 1000);
        profile._statusMessage = '';
        this._updateWidgetAppearance(widget, profile);
    }

    _scanImageFiles(folderPath) {
        const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg'];
        const folder = Gio.File.new_for_path(folderPath);
        const fileNames = [];

        const scanDirectory = (directory, relativeBase = '') => {
            try {
                const enumerator = directory.enumerate_children(
                    'standard::name',
                    Gio.FileQueryInfoFlags.NONE,
                    null
                );
                let info;
                while ((info = enumerator.next_file(null)) !== null) {
                    const childName = info.get_name();
                    const childPath = directory.get_child(childName);
                    const relative = relativeBase
                        ? `${relativeBase}/${childName}`
                        : childName;

                    if (info.get_file_type() === Gio.FileType.DIRECTORY) {
                        scanDirectory(childPath, relative);
                    } else if (imageExtensions.some(
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

                // Merge incoming values into the existing (preserving in-memory ref)
                // so that mutations from _refreshProfile/_selectRandomImage are kept
                Object.assign(existing, profile);
                Object.assign(existing, runtimeState);

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