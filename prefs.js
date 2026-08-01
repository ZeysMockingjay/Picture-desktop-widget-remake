'use strict';

import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gdk from 'gi://Gdk';

import { ExtensionPreferences, gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const FRAME_TILE_SIZE = 200;
const FRAME_TILE_PADDING = 12;
const FRAME_TILE_SPACING = 10;
const SUPPORTED_IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg'];

export default class PictureDesktopWidgetPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        this.settings = this.getSettings();
        window.set_title(_('Picture Desktop Widget Remake'));
        this._profiles = this._normalizeProfiles(this._loadProfiles());
        this._activeProfileId = this.settings.get_string('active-profile-id') ||
                                this._profiles[0]?.id || '';

        if (!this._profiles.some(p => p.id === this._activeProfileId))
            this._activeProfileId = this._profiles[0]?.id || '';

        this._frameCards = new Map();
        this._frameStack = null;
        this._frameDashboardFlow = null;
        this._frameTitleLabel = null;
        this._frameSubtitleLabel = null;
        this._settingsHeaderTitle = null;
        this._settingsHeaderSubtitle = null;
        this._settingsPageButton = null;
        this._deleteFrameRow = null;
        this._deleteFrameButton = null;
        this._profileSaveTimeoutId = 0;
        this._frameTileStyleProvider = null;
        this._developerErrorLabel = null;
        this._lastDeveloperError = _('No developer errors recorded yet.');

        const page = new Adw.PreferencesPage();
        page.set_title(_('Image Frames'));
        page.set_name(_('Image Frames'));

        const toolbarView = new Adw.ToolbarView();
        const titlebar = new Gtk.HeaderBar({
            show_title_buttons: true,
        });
        const aboutButton = Gtk.Button.new_from_icon_name('help-about-symbolic');
        aboutButton.add_css_class('flat');
        aboutButton.set_tooltip_text(_('About'));
        aboutButton.connect('clicked', () => this._showAboutDialog(window));
        titlebar.pack_end(aboutButton);
        toolbarView.add_top_bar(titlebar);
        toolbarView.set_content(page);
        window.set_content(toolbarView);

        const shellGroup = new Adw.PreferencesGroup();
        shellGroup.set_title(_('Image Frames'));
        shellGroup.set_description(
            _('Tap the add card to create a new frame, then open it to edit its settings.')
        );

        const shellBox = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 18,
        });
        shellGroup.add(shellBox);
        page.add(shellGroup);

        const headerRow = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 12,
            hexpand: true,
        });
        const headerText = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 4,
            hexpand: true,
        });
        this._frameTitleLabel = new Gtk.Label({
            label: _('Image Frames'),
            xalign: 0,
            wrap: true,
        });
        this._frameTitleLabel.add_css_class('title-1');
        this._frameSubtitleLabel = new Gtk.Label({
            label: _('Tap the add card to create frame 1.'),
            xalign: 0,
            wrap: true,
        });
        this._frameSubtitleLabel.add_css_class('dim-label');
        headerText.append(this._frameTitleLabel);
        headerText.append(this._frameSubtitleLabel);

        headerRow.append(headerText);
        shellBox.append(headerRow);

        this._frameStack = new Gtk.Stack({
            transition_type: Gtk.StackTransitionType.SLIDE_LEFT_RIGHT,
            transition_duration: 220,
            hexpand: true,
            vexpand: true,
        });
        shellBox.append(this._frameStack);

        const developerBox = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 12,
            hexpand: true,
            vexpand: true,
        });
        const developerScroll = new Gtk.ScrolledWindow({
            hexpand: true,
            vexpand: true,
            hscrollbar_policy: Gtk.PolicyType.NEVER,
        });
        const developerContent = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 12,
            hexpand: true,
            vexpand: true,
        });
        developerScroll.set_child(developerContent);
        this._developerErrorLabel = new Gtk.Label({
            label: this._lastDeveloperError,
            xalign: 0,
            wrap: true,
            selectable: true,
            valign: Gtk.Align.START,
        });
        this._developerErrorLabel.add_css_class('dim-label');
        developerContent.append(this._developerErrorLabel);
        developerBox.append(developerScroll);
        this._frameStack.add_named(developerBox, 'developer');

        const dashboardBox = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 12,
            hexpand: true,
            vexpand: true,
        });
        const dashboardScroll = new Gtk.ScrolledWindow({
            hexpand: true,
            vexpand: true,
            hscrollbar_policy: Gtk.PolicyType.NEVER,
        });
        this._frameDashboardFlow = new Gtk.FlowBox({
            selection_mode: Gtk.SelectionMode.NONE,
            valign: Gtk.Align.START,
            row_spacing: 14,
            column_spacing: 14,
            homogeneous: false,
            max_children_per_line: 4,
        });
        dashboardScroll.set_child(this._frameDashboardFlow);
        dashboardBox.append(dashboardScroll);
        this._frameStack.add_named(dashboardBox, 'dashboard');

        const settingsBox = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 16,
            hexpand: true,
            vexpand: true,
        });

        const settingsHeader = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 12,
            hexpand: true,
        });
        const settingsBack = Gtk.Button.new_from_icon_name('go-previous-symbolic');
        settingsBack.add_css_class('flat');
        settingsBack.set_tooltip_text(_('Back to image frames'));
        settingsBack.connect('clicked', () => this._showDashboard());
        this._settingsPageButton = settingsBack;

        const settingsHeaderText = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 4,
            hexpand: true,
        });
        this._settingsHeaderTitle = new Gtk.Label({
            label: _('Image Frame Settings'),
            xalign: 0,
            wrap: true,
        });
        this._settingsHeaderTitle.add_css_class('title-1');
        this._settingsHeaderSubtitle = new Gtk.Label({
            label: _('Edit the selected frame below.'),
            xalign: 0,
            wrap: true,
        });
        this._settingsHeaderSubtitle.add_css_class('dim-label');
        settingsHeaderText.append(this._settingsHeaderTitle);
        settingsHeaderText.append(this._settingsHeaderSubtitle);
        settingsHeader.append(settingsBack);
        settingsHeader.append(settingsHeaderText);
        settingsBox.append(settingsHeader);

        const settingsScroll = new Gtk.ScrolledWindow({
            hexpand: true,
            vexpand: true,
            hscrollbar_policy: Gtk.PolicyType.NEVER,
        });
        const settingsContent = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 18,
            hexpand: true,
            vexpand: true,
        });
        settingsScroll.set_child(settingsContent);

        const frameGroup = new Adw.PreferencesGroup();
        frameGroup.set_title(_('Image Frame Details'));
        frameGroup.set_description(
            _('Name the frame and decide whether it is visible on the desktop.')
        );

        this._frameNameRow = new Adw.EntryRow({ title: _('Image Frame Name') });
        this._frameNameRow.set_text(this._getActiveProfile()?.name || _('Frame 1'));
        this._frameNameRow.connect('notify::text', () => {
            const profile = this._getActiveProfile();
            if (!profile) return;
            profile.name = this._frameNameRow.get_text();
            this._queueSaveProfiles();
            this._updateFrameTile(profile);
            this._syncActiveFrameHeaders(profile);
        });
        frameGroup.add(this._frameNameRow);

        this._visibleRow = new Adw.SwitchRow({
            title: _('Visible on Desktop'),
            subtitle: _('Show or hide this image frame without deleting it'),
        });
        this._visibleRow.set_active(this._getActiveProfile()?.visible !== false);
        this._visibleRow.connect('notify::active', () => {
            const profile = this._getActiveProfile();
            if (!profile) return;
            profile.visible = this._visibleRow.get_active();
            this._queueSaveProfiles();
            this._updateFrameTile(profile);
        });
        frameGroup.add(this._visibleRow);

        this._deleteFrameRow = new Adw.ActionRow({
            title: _('Delete image frame'),
            subtitle: _('Remove this frame. At least one frame must remain.'),
        });
        this._deleteFrameButton = Gtk.Button.new_from_icon_name('user-trash-symbolic');
        this._deleteFrameButton.add_css_class('destructive-action');
        this._deleteFrameButton.set_valign(Gtk.Align.CENTER);
        this._deleteFrameButton.connect('clicked', () => {
            const idx = this._profiles.findIndex(p => p.id === this._activeProfileId);
            if (idx < 0 || this._profiles.length <= 1) return;

            const dialog = new Adw.MessageDialog({
                transient_for: window,
                heading: _('Delete image frame?'),
                body: _(
                    'The frame “%s” and all its settings will be removed.'
                ).format(this._profiles[idx].name || this._profiles[idx].id),
                close_response: 'cancel',
            });
            dialog.add_response('cancel', _('_Cancel'));
            dialog.add_response('remove', _('_Delete'));
            dialog.set_response_appearance('remove', Adw.ResponseAppearance.DESTRUCTIVE);
            dialog.set_default_response('cancel');

            dialog.connect('response', (dlg, response) => {
                if (response !== 'remove') {
                    dlg.destroy();
                    return;
                }
                this._profiles.splice(idx, 1);
                this._activeProfileId = this._profiles[Math.max(0, idx - 1)].id;
                this.settings.set_string('active-profile-id', this._activeProfileId);
                this._saveProfiles();
                this._refreshFrameDashboard();
                this._updateSettingRows();
                this._showSettingsPage();
                dlg.destroy();
            });
            dialog.present();
        });
        this._deleteFrameRow.add_suffix(this._deleteFrameButton);
        this._deleteFrameRow.activatable_widget = this._deleteFrameButton;

        const imageGroup = new Adw.PreferencesGroup();
        imageGroup.set_title(_('Image Source'));
        imageGroup.set_description(
            _('Pick the folder, size, position, rounding, and refresh timing for this frame.')
        );

        this._imagePathRow = this._createFolderChooserRow(
            _('Image Folder'), settingsScroll,
            () => this._getActiveProfile()?.imagePath || '',
            value => this._setActiveProfileValue('imagePath', value)
        );
        imageGroup.add(this._imagePathRow);

        this._sizeRow = this._createSpinRow(
            _('Widget Size (px)'), 50, 2000, 1, 10,
            () => this._getActiveProfile()?.widgetSize || 200,
            value => this._setActiveProfileValue('widgetSize', value)
        );
        this._sizeRow.set_subtitle(_('Controls the overall footprint of the frame'));
        imageGroup.add(this._sizeRow);

        this._xPositionRow = this._createSpinRow(
            _('X Position (px)'), 0, 100000, 5, 50,
            () => this._getActiveProfile()?.widgetPositionX || 0,
            value => this._setActiveProfileValue('widgetPositionX', value)
        );
        imageGroup.add(this._xPositionRow);

        this._yPositionRow = this._createSpinRow(
            _('Y Position (px)'), 0, 100000, 5, 50,
            () => this._getActiveProfile()?.widgetPositionY || 0,
            value => this._setActiveProfileValue('widgetPositionY', value)
        );
        imageGroup.add(this._yPositionRow);

        this._aspectRatioRow = this._createSliderRow(
            _('Aspect Ratio'), 0.25, 4, 0.01, 0.1,
            () => this._getActiveProfile()?.widgetAspectRatio || 1.0,
            value => this._setActiveProfileValue('widgetAspectRatio', value),
            'double'
        );
        this._aspectRatioRow.set_subtitle(_('Width relative to height (1.0 = square)'));
        imageGroup.add(this._aspectRatioRow);

        this._cornerRadiusRow = this._createSliderRow(
            _('Corner Radius (%)'), 0, 100, 1, 10,
            () => this._getActiveProfile()?.widgetCornerRadius || 20,
            value => this._setActiveProfileValue('widgetCornerRadius', value)
        );
        this._cornerRadiusRow.set_subtitle(_('Percentage of the shortest side'));
        imageGroup.add(this._cornerRadiusRow);

        this._timeoutRow = this._createSpinRow(
            _('Refresh Interval (s)'), 5, 100000, 5, 60,
            () => this._getActiveProfile()?.widgetTimeout || 60,
            value => this._setActiveProfileValue('widgetTimeout', value)
        );
        this._timeoutRow.set_subtitle(_('How often a new random image is selected'));
        imageGroup.add(this._timeoutRow);

        this._currentInfoRow = new Adw.ActionRow({
            title: _('Current Image'),
            subtitle: this._getActiveProfile()?.currentImagePath || _('(none selected yet)'),
            activatable: false,
        });
        imageGroup.add(this._currentInfoRow);

        settingsContent.append(frameGroup);
        settingsContent.append(this._deleteFrameRow);
        settingsContent.append(imageGroup);
        settingsBox.append(settingsScroll);
        this._frameStack.add_named(settingsBox, 'settings');

        this._refreshFrameDashboard();
        this._showDashboard();
        this._installFrameTileStyles();

        window.connect('close-request', () => {
            this._flushQueuedProfileSave();
            this.settings = null;
        });

        // Initial sync
        this._updateSettingRows();
    }

    /**
     * Preferences UI notes:
     * - The preferences window manages multiple "frames" (profiles) and
     *   exposes a dashboard with tiles and a detailed settings page.
     * - UI helpers below create reusable rows (spin, slider, folder chooser)
     *   following GNOME HIG patterns.
     */

    // -----------------------------------------------------------------------
    // Profile helpers
    // -----------------------------------------------------------------------

    _normalizeProfile(profile = {}, fallback = {}) {
        return {
            ...fallback,
            ...profile,
            id: profile.id || fallback.id ||
                `profile-${Math.random().toString(36).slice(2, 10)}`,
            name: profile.name || fallback.name || _('New image frame'),
            imagePath: profile.imagePath ?? fallback.imagePath ?? '',
            widgetSize: Number.isFinite(Number(profile.widgetSize))
                ? Number(profile.widgetSize)
                : (Number(fallback.widgetSize) || 200),
            widgetPositionX: Number.isFinite(Number(profile.widgetPositionX))
                ? Number(profile.widgetPositionX)
                : (Number(fallback.widgetPositionX) || 100),
            widgetPositionY: Number.isFinite(Number(profile.widgetPositionY))
                ? Number(profile.widgetPositionY)
                : (Number(fallback.widgetPositionY) || 100),
            widgetAspectRatio: Number.isFinite(Number(profile.widgetAspectRatio))
                ? Number(profile.widgetAspectRatio)
                : (Number(fallback.widgetAspectRatio) || 1.0),
            widgetTimeout: Number.isFinite(Number(profile.widgetTimeout))
                ? Number(profile.widgetTimeout)
                : (Number(fallback.widgetTimeout) || 60),
            widgetCornerRadius: Number.isFinite(Number(profile.widgetCornerRadius))
                ? Number(profile.widgetCornerRadius)
                : (Number(fallback.widgetCornerRadius) || 20),
            timeLastUpdate: Number.isFinite(Number(profile.timeLastUpdate))
                ? Number(profile.timeLastUpdate)
                : (Number(fallback.timeLastUpdate) || 0),
            currentImagePath: profile.currentImagePath ??
                              fallback.currentImagePath ?? '',
            cachedFiles: Array.isArray(profile.cachedFiles)
                ? profile.cachedFiles
                : (Array.isArray(fallback.cachedFiles)
                    ? fallback.cachedFiles
                    : []),
            cachedFolderPath: profile.cachedFolderPath ??
                              fallback.cachedFolderPath ?? '',
            visible: profile.visible !== false && fallback.visible !== false,
            requiresRescan: profile.requiresRescan === true ||
                            fallback.requiresRescan === true ||
                            (profile.requiresRescan === undefined &&
                             fallback.requiresRescan === undefined),
        };
    }

    _normalizeProfiles(profiles) {
        if (!Array.isArray(profiles)) return [];
        return profiles
            .map(p => this._normalizeProfile(p))
            .filter(profile => !this._isLegacyPlaceholderProfile(profile));
    }

    _isLegacyPlaceholderProfile(profile) {
        if (!profile) return false;
        const legacyNames = new Set([
            _('Default widget'),
            _('New profile'),
            _('New image frame'),
        ]);
        const hasMeaningfulData =
            profile.imagePath ||
            profile.currentImagePath ||
            (Array.isArray(profile.cachedFiles) && profile.cachedFiles.length > 0) ||
            profile.widgetSize !== 200 ||
            profile.widgetPositionX !== 100 ||
            profile.widgetPositionY !== 100 ||
            profile.widgetAspectRatio !== 1.0 ||
            profile.widgetTimeout !== 60 ||
            profile.widgetCornerRadius !== 20 ||
            profile.visible === false;
        return legacyNames.has(profile.name) && !hasMeaningfulData;
    }

    _loadProfiles() {
        try {
            const raw = this.settings.get_string('widget-profiles');
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) return parsed;
        } catch (error) {
            const message = `Unable to parse image frame settings: ${error}`;
            this._recordDeveloperError(message);
            console.warn(message);
        }
        return [];
    }

    _saveProfiles() {
        const toSave = this._normalizeProfiles(
            this._profiles.map(p => ({ ...p }))
        );
        this.settings.set_string('widget-profiles', JSON.stringify(toSave));
    }

    _createProfile() {
        const offset = this._profiles.length * 40;
        return this._normalizeProfile({
            id: `profile-${Math.random().toString(36).slice(2, 10)}`,
            name: this._getNextFrameName(),
            imagePath: '',
            widgetSize: 200,
            widgetPositionX: 100 + offset,
            widgetPositionY: 100 + offset,
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

    _getActiveProfile() {
        return this._profiles.find(p => p.id === this._activeProfileId) ||
               this._profiles[0];
    }

    _setActiveFrame(frameId) {
        const profile = this._profiles.find(p => p.id === frameId);
        if (!profile) return;
        this._activeProfileId = profile.id;
        if (this.settings)
            this.settings.set_string('active-profile-id', profile.id);
        this._syncFrameTileSelection();
        this._updateSettingRows();
    }

    _setActiveProfileValue(key, value) {
        const profile = this._getActiveProfile();
        if (!profile) return;
        profile[key] = value;
        this._queueSaveProfiles();
        if (key === 'name') {
            this._updateFrameTile(profile);
            this._syncActiveFrameHeaders(profile);
        } else if (key === 'visible') {
            this._updateFrameTile(profile);
        }
    }

    // -----------------------------------------------------------------------
    // UI sync helpers
    // -----------------------------------------------------------------------

    _updateSettingRows() {
        const profile = this._getActiveProfile();
        if (!profile) {
            if (this._frameTitleLabel)
                this._frameTitleLabel.set_label(_('Image Frames'));
            if (this._frameSubtitleLabel)
                this._frameSubtitleLabel.set_label(_('Tap the add card to create frame 1.'));
            return;
        }

        this._syncActiveFrameHeaders(profile);
        if (this._frameNameRow && this._frameNameRow.get_text() !== (profile.name || _('Frame 1')))
            this._frameNameRow.set_text(profile.name || _('Frame 1'));

        if (this._sizeRow)
            this._sizeRow.set_value(profile.widgetSize || 200);
        if (this._xPositionRow)
            this._xPositionRow.set_value(profile.widgetPositionX || 0);
        if (this._yPositionRow)
            this._yPositionRow.set_value(profile.widgetPositionY || 0);
        if (this._timeoutRow)
            this._timeoutRow.set_value(profile.widgetTimeout || 60);
        if (this._cornerRadiusRow)
            this._cornerRadiusRow.set_value(profile.widgetCornerRadius || 20);
        if (this._aspectRatioRow)
            this._aspectRatioRow.set_value(profile.widgetAspectRatio || 1.0);
        if (this._imagePathRow)
            this._imagePathRow.set_subtitle(profile.imagePath || '');
        if (this._visibleRow)
            this._visibleRow.set_active(profile.visible !== false);
        if (this._currentInfoRow) {
            this._currentInfoRow.set_subtitle(
                profile.currentImagePath || _('(none selected yet)')
            );
        }
        if (this._deleteFrameButton)
            this._deleteFrameButton.set_sensitive(this._profiles.length > 1);
    }

    _showDashboard() {
        if (this._frameStack)
            this._frameStack.set_visible_child_name('dashboard');
    }

    _showSettingsPage() {
        if (this._frameStack)
            this._frameStack.set_visible_child_name('settings');
    }

    _recordDeveloperError(message) {
        this._lastDeveloperError = message || _('No developer errors recorded yet.');
        if (this._developerErrorLabel)
            this._developerErrorLabel.set_label(this._lastDeveloperError);
    }

    _showDeveloperPage() {
        if (this._frameStack)
            this._frameStack.set_visible_child_name('developer');
        this._recordDeveloperError(this._lastDeveloperError);
    }

    _getExtensionVersion() {
        const version = this.metadata?.version;
        if (version !== undefined && version !== null && version !== '')
            return String(version);
        return _('Unknown');
    }

    _showAboutDialog(window) {
        const dialog = new Adw.MessageDialog({
            transient_for: window,
            heading: _('Picture Desktop Widget Remake'),
            body: _(
                'Version %s\nSupports JPEG, PNG, GIF, BMP, and WebP images.\n\nMaintained by:\nMaximilian Rosenbaum\nElias-Leander Ahlers\n\nCredits:\nOriginal creator: GaszokS\nBased on Picture Desktop Widget.\n\nRecent: Added developer page and error capture'
            ).format(this._getExtensionVersion()),
            close_response: 'close',
        });
        dialog.add_response('close', _('_Close'));
        dialog.add_response('dev-page', _('Developer page'));
        dialog.add_response('buy-me-a-coffee', _('Buy Me a Coffee'));
        dialog.set_default_response('close');
        dialog.connect('response', (dlg, response) => {
            if (response === 'dev-page') {
                this._showDeveloperPage();
                dlg.destroy();
                return;
            }
            if (response === 'buy-me-a-coffee') {
                this._openExternalUrl('https://buymeacoffee.com/MaximilianRosenbaum', window);
                dlg.destroy();
                return;
            }
            dlg.destroy();
        });
        dialog.present();
    }

    _openExternalUrl(url, window) {
        try {
            Gtk.show_uri(window, url, Gdk.CURRENT_TIME);
        } catch (error) {
            const message = `Unable to open URL ${url}: ${error}`;
            this._recordDeveloperError(message);
            console.warn(message);
        }
    }

    _syncActiveFrameHeaders(profile) {
        if (this._frameSubtitleLabel)
            this._frameSubtitleLabel.set_label(_('Editing the selected frame.'));
        if (this._settingsHeaderTitle)
            this._settingsHeaderTitle.set_label(profile?.name || _('Image Frames'));
        if (this._settingsHeaderSubtitle)
            this._settingsHeaderSubtitle.set_label(
                _('Adjust the folder, size, position, rounding, and refresh interval.')
            );
    }

    _syncFrameTileSelection() {
        for (const [profileId, tile] of this._frameCards) {
            if (profileId === this._activeProfileId)
                tile.add_css_class('frame-selected');
            else
                tile.remove_css_class('frame-selected');
        }
    }

    _updateFrameTile(profile) {
        const tile = this._frameCards.get(profile.id);
        if (!tile)
            return;
        if (tile._titleLabel)
            tile._titleLabel.set_label(profile.name || _('Image frame'));
        if (tile._statusLabel)
            tile._statusLabel.set_label(profile.visible === false ? _('Hidden') : _('Visible'));
        if (tile._subtitleLabel)
            tile._subtitleLabel.set_label(profile.id === this._activeProfileId ? _('Open its settings') : _('Tap to edit'));
    }

    _getNextFrameName() {
        const usedNumbers = new Set();
        for (const profile of this._profiles) {
            const match = /^Frame\s+(\d+)$/u.exec(profile.name || '');
            if (match)
                usedNumbers.add(Number(match[1]));
        }
        let frameNumber = 1;
        while (usedNumbers.has(frameNumber))
            frameNumber++;
        return `Frame ${frameNumber}`;
    }

    _queueSaveProfiles() {
        if (!this.settings)
            return;
        if (this._profileSaveTimeoutId) {
            GLib.Source.remove(this._profileSaveTimeoutId);
            this._profileSaveTimeoutId = 0;
        }
        this._profileSaveTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 120, () => {
            this._profileSaveTimeoutId = 0;
            this._saveProfiles();
            return GLib.SOURCE_REMOVE;
        });
    }

    _flushQueuedProfileSave() {
        if (this._profileSaveTimeoutId) {
            GLib.Source.remove(this._profileSaveTimeoutId);
            this._profileSaveTimeoutId = 0;
            this._saveProfiles();
        }
    }

    _refreshFrameDashboard() {
        if (!this._frameDashboardFlow)
            return;

        let child = this._frameDashboardFlow.get_first_child();
        while (child) {
            const next = child.get_next_sibling();
            this._frameDashboardFlow.remove(child);
            child = next;
        }

        this._frameCards = new Map();

        const addTile = this._buildFrameTile({ isAdd: true });
        this._frameDashboardFlow.insert(addTile, -1);

        for (const profile of this._profiles) {
            const tile = this._buildFrameTile({ profile, isActive: profile.id === this._activeProfileId });
            this._frameCards.set(profile.id, tile);
            this._frameDashboardFlow.insert(tile, -1);
        }

        if (this._frameTitleLabel)
            this._frameTitleLabel.set_label(_('Image Frames'));
        if (this._frameSubtitleLabel) {
            const count = this._profiles.length;
            this._frameSubtitleLabel.set_label(
                count === 0 ? _('Tap the add card to create frame 1.') : _('%d image frame%s ready to edit.').format(count, count === 1 ? '' : 's')
            );
        }

        this._syncFrameTileSelection();
        this._updateSettingRows();
    }

    _buildFrameTile({ profile = null, isAdd = false, isActive = false }) {
        // Build a clickable tile used on the dashboard representing a
        // profile (or the add-new tile). Tiles are fixed-size buttons
        // that contain an icon, title, subtitle and optional status line.
        const tile = new Gtk.Button({
            width_request: FRAME_TILE_SIZE,
            height_request: FRAME_TILE_SIZE,
            halign: Gtk.Align.START,
            valign: Gtk.Align.START,
            hexpand: false,
            vexpand: false,
        });
        tile.add_css_class('card');
        tile.add_css_class('frame-tile');
        if (isAdd)
            tile.add_css_class('suggested-action');
        if (isActive)
            tile.add_css_class('frame-selected');

        const box = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: FRAME_TILE_SPACING,
            margin_top: FRAME_TILE_PADDING,
            margin_bottom: FRAME_TILE_PADDING,
            margin_start: FRAME_TILE_PADDING,
            margin_end: FRAME_TILE_PADDING,
            halign: Gtk.Align.FILL,
            valign: Gtk.Align.FILL,
        });
        const icon = new Gtk.Image({
            icon_name: isAdd ? 'list-add-symbolic' : 'folder-pictures-symbolic',
            pixel_size: 34,
            halign: Gtk.Align.CENTER,
        });
        const title = new Gtk.Label({
            label: isAdd ? _('Add image frame') : (profile.name || _('Image frame')),
            xalign: 0.5,
            justify: Gtk.Justification.CENTER,
            wrap: true,
        });
        title.set_halign(Gtk.Align.CENTER);
        title.add_css_class('title-3');
        const subtitle = new Gtk.Label({
            label: isAdd ? _('Create a new frame') : _('Open its settings'),
            xalign: 0.5,
            justify: Gtk.Justification.CENTER,
            wrap: true,
        });
        subtitle.set_halign(Gtk.Align.CENTER);
        subtitle.add_css_class('dim-label');
        const status = new Gtk.Label({
            label: isAdd ? '' : (profile.visible === false ? _('Hidden') : _('Visible')),
            xalign: 0.5,
            justify: Gtk.Justification.CENTER,
            wrap: true,
        });
        status.set_halign(Gtk.Align.CENTER);
        if (!isAdd)
            status.add_css_class('caption');

        box.append(icon);
        box.append(title);
        box.append(subtitle);
        if (!isAdd)
            box.append(status);
        tile.set_child(box);
        tile._titleLabel = title;
        tile._subtitleLabel = subtitle;
        tile._statusLabel = status;

        if (isAdd) {
            tile.connect('clicked', () => {
                const profileToAdd = this._createProfile();
                this._profiles.push(profileToAdd);
                this._activeProfileId = profileToAdd.id;
                this.settings.set_string('active-profile-id', profileToAdd.id);
                this._saveProfiles();
                this._refreshFrameDashboard();
                this._updateSettingRows();
                this._showSettingsPage();
            });
        } else {
            tile.connect('clicked', () => {
                this._setActiveFrame(profile.id);
                this._showSettingsPage();
            });
        }

        return tile;
    }

    _installFrameTileStyles() {
        // Provide small CSS tweaks for selected tiles. Ensures a consistent
        // visual treatment across themes.
        if (this._frameTileStyleProvider)
            return;

        this._frameTileStyleProvider = new Gtk.CssProvider();
        this._frameTileStyleProvider.load_from_data(`
            .frame-tile {
                min-width: ${FRAME_TILE_SIZE}px;
                min-height: ${FRAME_TILE_SIZE}px;
                padding: 0;
            }

            .frame-tile.frame-selected {
                box-shadow: inset 0 0 0 2px @accent_bg_color;
            }

            .frame-tile.frame-selected:hover {
                box-shadow: inset 0 0 0 2px @accent_bg_color;
            }
        `);

        const display = Gdk.Display.get_default();
        if (display) {
            Gtk.StyleContext.add_provider_for_display(
                display,
                this._frameTileStyleProvider,
                Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION
            );
        }
    }

    // -----------------------------------------------------------------------
    // Widget factories (GNOME HIG compliant)
    // -----------------------------------------------------------------------

    _createSpinRow(title, lower, upper, stepIncrement, pageIncrement,
                   getter, setter) {
        const row = new Adw.SpinRow({
            title: title,
            adjustment: new Gtk.Adjustment({
                lower: lower,
                upper: upper,
                step_increment: stepIncrement,
                page_increment: pageIncrement,
                value: getter(),
            }),
        });
        row.connect('notify::value', () => {
            const newValue = row.get_value();
            const currentValue = getter();
            if (newValue !== currentValue) {
                setter(Math.round(newValue));
            }
        });
        return row;
    }

    _createSliderRow(title, lower, upper, stepIncrement, pageIncrement,
                     getter, setter, settingType = 'int') {
        const digits = stepIncrement < 1
            ? Math.ceil(-Math.log10(stepIncrement))
            : 0;

        const row = new Adw.ActionRow({ title: title });
        const adjustment = new Gtk.Adjustment({
            lower: lower,
            upper: upper,
            step_increment: stepIncrement,
            page_increment: pageIncrement,
            value: getter(),
        });
        const scale = new Gtk.Scale({
            orientation: Gtk.Orientation.HORIZONTAL,
            adjustment: adjustment,
            digits: digits,
            hexpand: true,
            valign: Gtk.Align.CENTER,
        });
        scale.set_draw_value(true);
        scale.set_value_pos(Gtk.PositionType.RIGHT);
        scale.connect('value-changed', () => {
            const newValue = scale.get_value();
            const currentValue = getter();
            if (newValue !== currentValue) {
                setter(newValue);
            }
        });
        row.set_value = value => scale.set_value(value);
        row.get_value = () => scale.get_value();
        row.add_suffix(scale);
        row.activatable_widget = scale;
        return row;
    }

    _createFolderChooserRow(title, page, getter, setter) {
        const row = new Adw.ActionRow({
            title: title,
            activatable: false,
        });
        row.set_subtitle(getter() || '');

        const button = new Gtk.Button({
            label: _('Choose Folder'),
            halign: Gtk.Align.END,
            valign: Gtk.Align.CENTER,
        });
        button.connect('clicked', () => {
            const dialog = new Gtk.FileChooserDialog({
                title: _('Select Image Folder'),
                transient_for: page.get_root(),
                modal: true,
                action: Gtk.FileChooserAction.SELECT_FOLDER,
            });
            dialog.add_button(_('_Cancel'), Gtk.ResponseType.CANCEL);
            dialog.add_button(_('_Open'), Gtk.ResponseType.OK);

            dialog.connect('response', (dlg, response) => {
                if (response === Gtk.ResponseType.OK) {
                    const folderPath = dlg.get_file().get_path();
                    setter(folderPath);
                    row.set_subtitle(folderPath);

                    // Count images in the chosen folder (informational)
                    try {
                        const folder = Gio.File.new_for_path(folderPath);
                        if (folder.query_exists(null)) {
                            const enumerator = folder.enumerate_children(
                                'standard::name',
                                Gio.FileQueryInfoFlags.NONE,
                                null
                            );
                            let count = 0;
                            let info;
                            while ((info = enumerator.next_file(null)) !== null) {
                                const name = info.get_name().toLowerCase();
                                if (SUPPORTED_IMAGE_EXTENSIONS.some(ext => name.endsWith(ext))) {
                                    count++;
                                }
                            }
                            enumerator.close(null);
                            if (count > 0) {
                                row.set_subtitle(
                                    _('%d images found').format(count)
                                );
                            }
                        }
                    } catch (error) {
                        const message = `Unable to count images in selected folder: ${error}`;
                        this._recordDeveloperError(message);
                        console.warn(message);
                    }
                }
                dlg.destroy();
            });
            dialog.present();
        });
        row.add_suffix(button);
        row.activatable_widget = button;
        return row;
    }
}