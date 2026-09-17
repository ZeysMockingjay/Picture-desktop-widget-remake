import St from 'gi://St';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import GdkPixbuf from 'gi://GdkPixbuf';
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
const MONITOR_RATE_LIMIT_MS = 500;
const MONITOR_DEBOUNCE_MS = 400;
const SKIP_DOT_DIRS = true;
const SUPPORTED_IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg'];

export default class PictureDesktopWidgetExtension extends Extension {
    enable() {
        this.settings = this.getSettings();
        this._dirMonitors = new Map();
        this._profiles = this._normalizeProfiles(this._loadProfiles());
        this._widgetByProfileId = new Map();
        this._timeoutIds = new Map();
        this._monitorDebounceTimeoutIds = new Map();
        this._imageCacheDir = null;
        this._reloadingProfiles = false;

        if (this._profiles.length === 0) {
            this._profiles = [this._createDefaultProfile()];
        }
        this._rebuildProfileIndex();

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

        for (const timeoutId of this._timeoutIds.values()) {
            if (timeoutId) {
                GLib.Source.remove(timeoutId);
            }
        }
        this._timeoutIds.clear();
        for (const profileId of this._monitorDebounceTimeoutIds.keys()) {
            this._clearMonitorRefreshDebounce(profileId);
        }
        this._monitorDebounceTimeoutIds.clear();

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
        this._profileById = new Map();
        this._imageCacheDir = null;
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
            monitor.set_rate_limit(MONITOR_RATE_LIMIT_MS);
            monitor.connectObject('changed', () => {
                this._queueMonitorRefresh(profile.id);
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
        this._clearMonitorRefreshDebounce(profileId);
    }

    _disconnectAndCancelMonitor(monitor) {
        if (!monitor)
            return;
        monitor.disconnectObject(this);
        monitor.cancel();
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
            fadeDuration: 700,
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
            fadeDuration: Number.isFinite(Number(profile.fadeDuration))
                ? Number(profile.fadeDuration)
                : (Number.isFinite(Number(fallback.fadeDuration))
                    ? Number(fallback.fadeDuration)
                    : 700),
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
        if (normalized.fadeDuration < 0) normalized.fadeDuration = 0;
        if (normalized.fadeDuration > 3000) normalized.fadeDuration = 3000;
        if (normalized.widgetCornerRadius < 0) normalized.widgetCornerRadius = 0;
        return normalized;
    }

    _normalizeProfiles(profiles) {
        if (!Array.isArray(profiles)) return [];
        return profiles.map(p => this._normalizeProfile(p));
    }

    _rebuildProfileIndex() {
        this._profileById = new Map(this._profiles.map(profile => [profile.id, profile]));
    }

    _clearMonitorRefreshDebounce(profileId) {
        const timeoutId = this._monitorDebounceTimeoutIds.get(profileId);
        if (timeoutId) {
            GLib.Source.remove(timeoutId);
            this._monitorDebounceTimeoutIds.delete(profileId);
        }
    }

    _queueMonitorRefresh(profileId) {
        if (!profileId || this._monitorDebounceTimeoutIds.has(profileId))
            return;

        const timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, MONITOR_DEBOUNCE_MS, () => {
            this._monitorDebounceTimeoutIds.delete(profileId);
            const profile = this._profileById.get(profileId);
            if (!profile)
                return GLib.SOURCE_REMOVE;
            profile.requiresRescan = true;
            this._refreshProfile(profile, false);
            this._scheduleProfileRefresh(profile);
            return GLib.SOURCE_REMOVE;
        });
        this._monitorDebounceTimeoutIds.set(profileId, timeoutId);
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
        const serializedProfiles = JSON.stringify(toSave);
        if (this.settings.get_string('widget-profiles') !== serializedProfiles)
            this.settings.set_string('widget-profiles', serializedProfiles);
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
        widget._imageLayers = [new St.Widget(), new St.Widget()];
        widget._activeImageLayer = -1;
        widget._displayedImagePath = '';
        widget._imageTransitionId = 0;
        for (const layer of widget._imageLayers) {
            layer.opacity = 0;
            layer.visible = false;
            widget.add_child(layer);
        }
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
            const current = this._profileById.get(id);
            if (!current) {
                this._timeoutIds.delete(id);
                return GLib.SOURCE_REMOVE;
            }
            this._refreshProfile(current, false);
            this._scheduleProfileRefresh(current);
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
        for (const layer of widget._imageLayers || []) {
            layer.set_size(width, height);
            layer.set_position(0, 0);
        }
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

        const folder = Gio.File.new_for_path(folderPath);
        if (!folder.query_exists(null)) {
            profile.currentImagePath = '';
            profile._statusMessage = _('Folder not found');
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
            for (const layer of widget._imageLayers || []) {
                layer.remove_all_transitions();
                layer.visible = false;
                layer.opacity = 0;
            }
            widget._activeImageLayer = -1;
            widget._displayedImagePath = '';
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
            const displayPath = this._getDisplayImagePath(profile.currentImagePath);
            const imageUri = Gio.File.new_for_path(
                displayPath
            ).get_uri();
            const layers = widget._imageLayers;
            if (!layers)
                return;

            const imageChanged = widget._displayedImagePath !== displayPath;
            const firstImage = widget._activeImageLayer < 0;
            if (!imageChanged && !firstImage) {
                layers[widget._activeImageLayer].set_style(`
                    background-image: url("${imageUri}");
                    background-size: cover;
                    background-repeat: no-repeat;
                    background-position: center;
                    border-radius: ${radiusPx}px;
                `);
                return;
            }

            const nextLayerIndex = firstImage ? 0 : 1 - widget._activeImageLayer;
            const nextLayer = layers[nextLayerIndex];
            const oldLayer = firstImage ? null : layers[widget._activeImageLayer];
            const transitionId = ++widget._imageTransitionId;
            const fadeDuration = Math.min(
                Math.max(0, profile.fadeDuration ?? 700),
                Math.max(0, (profile.widgetTimeout || 60) * 500)
            );
            const reducedMotion = St.Settings.get().reducedMotion ===
                St.ReducedMotion.REDUCE;
            const animate = !firstImage && fadeDuration > 0 && !reducedMotion;

            for (const layer of layers)
                layer.remove_all_transitions();

            nextLayer.set_style(`
                background-image: url("${imageUri}");
                background-size: cover;
                background-repeat: no-repeat;
                background-position: center;
                border-radius: ${radiusPx}px;
            `);
            nextLayer.visible = true;
            nextLayer.opacity = animate ? 0 : 255;

            if (oldLayer) {
                oldLayer.opacity = animate ? 255 : 0;
                oldLayer.visible = animate;
            }

            widget._activeImageLayer = nextLayerIndex;
            widget._displayedImagePath = displayPath;

            if (animate) {
                nextLayer.ease({
                    opacity: 255,
                    duration: fadeDuration,
                    mode: Clutter.AnimationMode.EASE_IN_OUT_QUAD,
                });
                oldLayer.ease({
                    opacity: 0,
                    duration: fadeDuration,
                    mode: Clutter.AnimationMode.EASE_IN_OUT_QUAD,
                    onComplete: () => {
                        if (widget._imageTransitionId !== transitionId)
                            return;
                        oldLayer.visible = false;
                    },
                });
            }
        }
    }

    _readJpegOrientation(path) {
        const file = Gio.File.new_for_path(path);
        const [, contents] = file.load_contents(null);
        if (contents.length < 12 || contents[0] !== 0xff || contents[1] !== 0xd8)
            return 1;

        const readUint16 = (data, offset, littleEndian) => littleEndian
            ? data[offset] | (data[offset + 1] << 8)
            : (data[offset] << 8) | data[offset + 1];
        const readUint32 = (data, offset, littleEndian) => littleEndian
            ? (data[offset] |
               (data[offset + 1] << 8) |
               (data[offset + 2] << 16) |
               (data[offset + 3] << 24)) >>> 0
            : ((data[offset] << 24) |
               (data[offset + 1] << 16) |
               (data[offset + 2] << 8) |
               data[offset + 3]) >>> 0;

        let offset = 2;
        while (offset + 4 <= contents.length) {
            if (contents[offset] !== 0xff)
                break;
            const marker = contents[offset + 1];
            if (marker === 0xda || marker === 0xd9)
                break;
            const segmentLength = (contents[offset + 2] << 8) |
                                  contents[offset + 3];
            if (segmentLength < 2 || offset + 2 + segmentLength > contents.length)
                break;

            if (marker === 0xe1 && segmentLength >= 8 &&
                contents[offset + 4] === 0x45 &&
                contents[offset + 5] === 0x78 &&
                contents[offset + 6] === 0x69 &&
                contents[offset + 7] === 0x66 &&
                contents[offset + 8] === 0x00 &&
                contents[offset + 9] === 0x00) {
                const tiff = offset + 10;
                const littleEndian = contents[tiff] === 0x49 && contents[tiff + 1] === 0x49;
                if (!littleEndian &&
                    !(contents[tiff] === 0x4d && contents[tiff + 1] === 0x4d))
                    return 1;
                const ifdOffset = readUint32(contents, tiff + 4, littleEndian);
                const ifd = tiff + ifdOffset;
                if (ifd + 2 > contents.length)
                    return 1;
                const entryCount = readUint16(contents, ifd, littleEndian);
                for (let index = 0; index < entryCount; index++) {
                    const entry = ifd + 2 + index * 12;
                    if (entry + 12 > contents.length)
                        return 1;
                    if (readUint16(contents, entry, littleEndian) === 0x0112 &&
                        readUint16(contents, entry + 2, littleEndian) === 3)
                        return readUint16(contents, entry + 8, littleEndian);
                }
                return 1;
            }
            offset += 2 + segmentLength;
        }
        return 1;
    }

    _transformImageOrientation(pixbuf, orientation) {
        switch (orientation) {
        case 2:
            return pixbuf.flip(true);
        case 3:
            return pixbuf.rotate_simple(GdkPixbuf.PixbufRotation.UPSIDEDOWN);
        case 4:
            return pixbuf.flip(false);
        case 5:
            return pixbuf.flip(true).rotate_simple(GdkPixbuf.PixbufRotation.COUNTERCLOCKWISE);
        case 6:
            return pixbuf.rotate_simple(GdkPixbuf.PixbufRotation.CLOCKWISE);
        case 7:
            return pixbuf.flip(true).rotate_simple(GdkPixbuf.PixbufRotation.CLOCKWISE);
        case 8:
            return pixbuf.rotate_simple(GdkPixbuf.PixbufRotation.COUNTERCLOCKWISE);
        default:
            return pixbuf;
        }
    }

    _getDisplayImagePath(path) {
        if (!/\.jpe?g$/i.test(path))
            return path;

        try {
            const sourceFile = Gio.File.new_for_path(path);
            const info = sourceFile.query_info(
                'standard::size,time::modified',
                Gio.FileQueryInfoFlags.NONE,
                null
            );
            const orientation = this._readJpegOrientation(path);
            if (orientation === 1)
                return path;

            if (!this._imageCacheDir) {
                const cachePath = GLib.build_filenamev([
                    GLib.get_user_cache_dir(),
                    'picture-desktop-widget-remake',
                ]);
                this._imageCacheDir = Gio.File.new_for_path(cachePath);
                if (!this._imageCacheDir.query_exists(null))
                    this._imageCacheDir.make_directory_with_parents(null);
            }

            const signature = `${path}:${info.get_size()}:${info.get_attribute_uint64('time::modified')}:${orientation}`;
            const cacheName = `${GLib.compute_checksum_for_string(
                GLib.ChecksumType.SHA256,
                signature,
                -1
            )}.jpg`;
            const cacheFile = this._imageCacheDir.get_child(cacheName);
            if (!cacheFile.query_exists(null)) {
                const pixbuf = GdkPixbuf.Pixbuf.new_from_file(path);
                const corrected = this._transformImageOrientation(pixbuf, orientation);
                corrected.savev(cacheFile.get_path(), 'jpeg', ['quality'], ['95']);
            }
            return cacheFile.get_path();
        } catch (error) {
            console.warn(`Unable to normalize image orientation for ${path}: ${error}`);
            return path;
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
            const existingById = new Map(this._profiles.map(p => [p.id, p]));

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
                const existing = existingById.get(profile.id);

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
            this._rebuildProfileIndex();

            // Ensure active-profile-id is valid
            const currentActiveId = this.settings.get_string('active-profile-id');
            const activeId = currentActiveId ||
                             (incoming[0]?.id ?? '');
            const nextActiveId = incoming.some(p => p.id === activeId)
                ? activeId
                : (incoming[0]?.id ?? '');
            if (currentActiveId !== nextActiveId)
                this.settings.set_string('active-profile-id', nextActiveId);
        } finally {
            this._reloadingProfiles = false;
        }
    };
}