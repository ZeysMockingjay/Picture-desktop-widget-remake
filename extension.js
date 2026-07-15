import St from 'gi://St';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
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
            this._saveProfiles(this._profiles);
        }

        this._profiles.forEach(profile => {
            this._createWidget(profile);
            this._refreshProfile(profile, true);
            this._scheduleProfileRefresh(profile);
        });

        this._settingsChangedIds.push(
            this.settings.connect('changed::widget-profiles', this._reloadProfiles),
            this.settings.connect('changed::active-profile-id', this._reloadProfiles)
        );
    }

    disable() {
        this._timeoutIds.forEach((id) => {
            if (id) {
                GLib.Source.remove(id);
            }
        });
        this._timeoutIds.clear();

        if (this._settingsChangedIds && this.settings) {
            this._settingsChangedIds.forEach(id => this.settings.disconnect(id));
            this._settingsChangedIds = [];
        }

        this._widgetByProfileId.forEach(widget => widget?.destroy());
        this._widgetByProfileId.clear();
        this.settings = null;
    }

    _createDefaultProfile() {
        const fallbackSettings = {
            imagePath: this.settings.get_string('image-path') || '',
            widgetSize: this.settings.get_int('widget-size') || 200,
            widgetPositionX: this.settings.get_int('widget-position-x') || 100,
            widgetPositionY: this.settings.get_int('widget-position-y') || 100,
            widgetAspectRatio: this.settings.get_double('widget-aspect-ratio') || 1.0,
            widgetTimeout: this.settings.get_int('widget-timeout') || 60,
            widgetCornerRadius: this.settings.get_int('widget-corner-radius') || 20,
            timeLastUpdate: this.settings.get_int('time-last-update') || 0,
            currentImagePath: this.settings.get_string('current-image-path') || '',
        };

        return this._normalizeProfile({
            id: `profile-${Math.random().toString(36).slice(2, 10)}`,
            name: 'Default widget',
            ...fallbackSettings,
        }, fallbackSettings);
    }

    _normalizeProfile(profile = {}, fallback = {}) {
        const createdId = `profile-${Math.random().toString(36).slice(2, 10)}`;
        const normalized = {
            ...fallback,
            ...profile,
            id: profile.id || fallback.id || createdId,
            name: profile.name || fallback.name || _('Default widget'),
            imagePath: profile.imagePath ?? fallback.imagePath ?? '',
            widgetSize: Number.isFinite(Number(profile.widgetSize)) ? Number(profile.widgetSize) : (Number(fallback.widgetSize) || 200),
            widgetPositionX: Number.isFinite(Number(profile.widgetPositionX)) ? Number(profile.widgetPositionX) : (Number(fallback.widgetPositionX) || 100),
            widgetPositionY: Number.isFinite(Number(profile.widgetPositionY)) ? Number(profile.widgetPositionY) : (Number(fallback.widgetPositionY) || 100),
            widgetAspectRatio: Number.isFinite(Number(profile.widgetAspectRatio)) ? Number(profile.widgetAspectRatio) : (Number(fallback.widgetAspectRatio) || 1.0),
            widgetTimeout: Number.isFinite(Number(profile.widgetTimeout)) ? Number(profile.widgetTimeout) : (Number(fallback.widgetTimeout) || 60),
            widgetCornerRadius: Number.isFinite(Number(profile.widgetCornerRadius)) ? Number(profile.widgetCornerRadius) : (Number(fallback.widgetCornerRadius) || 20),
            timeLastUpdate: Number.isFinite(Number(profile.timeLastUpdate)) ? Number(profile.timeLastUpdate) : (Number(fallback.timeLastUpdate) || 0),
            currentImagePath: profile.currentImagePath ?? fallback.currentImagePath ?? '',
            cachedFiles: Array.isArray(profile.cachedFiles) ? profile.cachedFiles : (Array.isArray(fallback.cachedFiles) ? fallback.cachedFiles : []),
            cachedFolderPath: profile.cachedFolderPath ?? fallback.cachedFolderPath ?? '',
            visible: profile.visible !== false && fallback.visible !== false,
            requiresRescan: profile.requiresRescan === true || fallback.requiresRescan === true || (profile.requiresRescan === undefined && fallback.requiresRescan === undefined),
        };

        if (normalized.widgetSize < 20) {
            normalized.widgetSize = 20;
        }
        if (normalized.widgetTimeout < 5) {
            normalized.widgetTimeout = 5;
        }
        if (normalized.widgetCornerRadius < 0) {
            normalized.widgetCornerRadius = 0;
        }
        return normalized;
    }

    _normalizeProfiles(profiles) {
        if (!Array.isArray(profiles)) {
            return [];
        }

        return profiles.map(profile => this._normalizeProfile(profile));
    }

    _loadProfiles() {
        try {
            const raw = this.settings.get_string('widget-profiles');
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
                return this._normalizeProfiles(parsed);
            }
        } catch (e) {
            log(`Unable to parse widget profiles: ${e}`);
        }

        return [];
    }

    _saveProfiles(profiles = this._profiles) {
        if (!this.settings) {
            return;
        }

        const normalizedProfiles = this._normalizeProfiles(profiles);
        this.settings.set_string('widget-profiles', JSON.stringify(normalizedProfiles));
        if (!this.settings.get_string('active-profile-id')) {
            const firstProfile = normalizedProfiles[0];
            if (firstProfile) {
                this.settings.set_string('active-profile-id', firstProfile.id);
            }
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

    _scheduleProfileRefresh(profile) {
        if (this._timeoutIds.has(profile.id)) {
            GLib.Source.remove(this._timeoutIds.get(profile.id));
            this._timeoutIds.delete(profile.id);
        }

        const timeoutSeconds = Math.max(5, profile.widgetTimeout || 60);
        const timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, timeoutSeconds, () => {
            const current = this._profiles.find(item => item.id === profile.id);
            if (current) {
                this._refreshProfile(current, false);
            }
            this._scheduleProfileRefresh(profile);
            return false;
        });
        this._timeoutIds.set(profile.id, timeoutId);
    }

    _refreshProfile(profile, force = false) {
        const widget = this._widgetByProfileId.get(profile.id);
        if (!widget) {
            return;
        }

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
        if (!widget) {
            return;
        }

        widget.visible = profile.visible !== false;
        if (profile.visible === false) {
            return;
        }

        const folderPath = profile.imagePath || '';
        if (folderPath === '') {
            profile.currentImagePath = '';
            profile._statusMessage = _('Add a path\n to folder with images');
            this._updateWidgetAppearance(widget, profile);
            return;
        }

        let fileNames = profile.cachedFiles || [];
        const shouldRescan = force || profile.requiresRescan || profile.cachedFolderPath !== folderPath || fileNames.length === 0;
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
        const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp'];
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
                    const relativeChildPath = relativeBase ? `${relativeBase}/${childName}` : childName;

                    if (info.get_file_type() === Gio.FileType.DIRECTORY) {
                        scanDirectory(childPath, relativeChildPath);
                    } else if (imageExtensions.some(ext => childName.toLowerCase().endsWith(ext))) {
                        fileNames.push(relativeChildPath);
                    }
                }
                enumerator.close(null);
            } catch (error) {
                log(`Error scanning directory ${directory.get_path()}: ${error}`);
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
        if (widget._label) {
            widget._label.destroy();
            widget._label = null;
        }

        if (profile.visible === false) {
            return;
        }

        if (profile.currentImagePath === '') {
            widget.set_style(`
                background-image: none;
                background-color: rgba(0, 0, 0, 1);
                border-radius: ${radiusPx}px;
            `);

            const labelText = profile._statusMessage || (profile.imagePath ? _('No images found in this folder') : _('Add a path\n to folder with images'));
            const label = new St.Label({ text: labelText });
            label.set_style(`
                color: white;
                font-size: ${Math.max(12, Math.min(width, height) / 10)}px;
                text-align: center;
            `);
            widget.add_child(label);
            widget._label = label;
        } else {
            const imageUri = Gio.File.new_for_path(profile.currentImagePath).get_uri();
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
        if (this._reloadingProfiles) {
            return;
        }

        this._reloadingProfiles = true;
        try {
            const profiles = this._normalizeProfiles(this._loadProfiles());
            const existingIds = new Set(this._profiles.map(profile => profile.id));
            const incomingIds = new Set(profiles.map(profile => profile.id));

            profiles.forEach(profile => {
                const existingProfile = this._profiles.find(item => item.id === profile.id);
                if (!existingProfile) {
                    this._createWidget(profile);
                    this._refreshProfile(profile, true);
                    this._scheduleProfileRefresh(profile);
                    return;
                }

                const changed = existingProfile.name !== profile.name || existingProfile.imagePath !== profile.imagePath || existingProfile.widgetSize !== profile.widgetSize || existingProfile.widgetPositionX !== profile.widgetPositionX || existingProfile.widgetPositionY !== profile.widgetPositionY || existingProfile.widgetAspectRatio !== profile.widgetAspectRatio || existingProfile.widgetTimeout !== profile.widgetTimeout || existingProfile.widgetCornerRadius !== profile.widgetCornerRadius || existingProfile.visible !== profile.visible;
                const normalizedExistingProfile = this._normalizeProfile(profile, existingProfile);
                Object.assign(existingProfile, normalizedExistingProfile);
                existingProfile.requiresRescan = existingProfile.requiresRescan || changed;
                const widget = this._widgetByProfileId.get(profile.id);
                if (widget) {
                    this._applyWidgetLayout(widget, existingProfile);
                    this._updateWidgetAppearance(widget, existingProfile);
                    this._refreshProfile(existingProfile, changed);
                }
            });

            existingIds.forEach(id => {
                if (!incomingIds.has(id)) {
                    const widget = this._widgetByProfileId.get(id);
                    if (widget) {
                        widget.destroy();
                        this._widgetByProfileId.delete(id);
                    }
                    const timeoutId = this._timeoutIds.get(id);
                    if (timeoutId) {
                        GLib.Source.remove(timeoutId);
                        this._timeoutIds.delete(id);
                    }
                }
            });

            this._profiles = profiles;
            const activeProfileId = this.settings.get_string('active-profile-id') || profiles[0]?.id || '';
            this.settings.set_string('active-profile-id', profiles.some(profile => profile.id === activeProfileId) ? activeProfileId : profiles[0]?.id || '');
        } finally {
            this._reloadingProfiles = false;
        }
    };
}