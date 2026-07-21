'use strict';

import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';

import { ExtensionPreferences, gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class PictureDesktopWidgetPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        this.settings = this.getSettings();
        this._profiles = this._normalizeProfiles(this._loadProfiles());
        this._activeProfileId = this.settings.get_string('active-profile-id') ||
                                this._profiles[0]?.id || '';

        // === PAGE: General ==================================================
        const generalPage = new Adw.PreferencesPage();
        generalPage.set_title(_('General'));
        generalPage.set_name(_('General'));

        // -- Group: Widget profiles ------------------------------------------
        const profileGroup = new Adw.PreferencesGroup();
        profileGroup.set_title(_('Widget Profiles'));
        profileGroup.set_description(
            _('Each profile is an independent desktop widget with its own folder, ' +
              'size, position, and refresh interval. Use the selector below to ' +
              'switch between profiles and adjust their settings.')
        );

        // Profile selector with icon
        const profileSelectorRow = new Adw.ActionRow({
            title: _('Active Profile'),
            subtitle: this._getActiveProfile()?.name || _('Default widget'),
        });

        const profileModel = new Gtk.StringList({
            strings: this._profiles.map(p => p.name || p.id),
        });
        const profileSelector = new Gtk.DropDown({
            model: profileModel,
            valign: Gtk.Align.CENTER,
        });
        const activeIndex = this._profiles.findIndex(
            p => p.id === this._activeProfileId
        );
        profileSelector.set_selected(activeIndex >= 0 ? activeIndex : 0);
        profileSelector.connect('notify::selected', () => {
            const idx = profileSelector.get_selected();
            const profile = this._profiles[idx];
            if (!profile) return;
            this._activeProfileId = profile.id;
            this.settings.set_string('active-profile-id', profile.id);
            profileSelectorRow.set_subtitle(profile.name || profile.id);
            profileNameRow.set_text(profile.name || _('Default widget'));
            if (this._visibleRow)
                this._visibleRow.set_active(profile.visible !== false);
            this._updateSettingRows();
        });
        profileSelectorRow.add_suffix(profileSelector);
        profileSelectorRow.activatable_widget = profileSelector;
        profileGroup.add(profileSelectorRow);

        // Profile name
        const profileNameRow = new Adw.EntryRow({ title: _('Profile Name') });
        profileNameRow.set_text(
            this._getActiveProfile()?.name || _('Default widget')
        );
        profileNameRow.connect('notify::text', () => {
            const profile = this._getActiveProfile();
            if (profile) {
                profile.name = profileNameRow.get_text();
                this._saveProfiles();
                this._rebuildProfileSelector(profileSelector);
                profileSelectorRow.set_subtitle(profile.name || profile.id);
            }
        });
        profileGroup.add(profileNameRow);

        // Visibility
        this._visibleRow = new Adw.SwitchRow({
            title: _('Visible on Desktop'),
            subtitle: _('Show or hide this widget without removing its settings'),
        });
        this._visibleRow.set_active(this._getActiveProfile()?.visible !== false);
        this._visibleRow.connect('notify::active', () => {
            const profile = this._getActiveProfile();
            if (!profile) return;
            profile.visible = this._visibleRow.get_active();
            this._saveProfiles();
        });
        profileGroup.add(this._visibleRow);

        // -- Profile management actions ----------------------------------------
        const actionsGroup = new Adw.PreferencesGroup();
        actionsGroup.set_title(_('Manage Profiles'));
        actionsGroup.set_description(
            _('Add a new blank widget, duplicate the current one with all its ' +
              'settings, or remove the active profile. You must keep at least ' +
              'one profile.')
        );

        const actionsRow = new Adw.ActionRow({
            title: _('Profile actions'),
        });

        const addBtn = Gtk.Button.new_from_icon_name('list-add-symbolic');
        addBtn.set_tooltip_text(_('Add new widget profile'));
        addBtn.set_valign(Gtk.Align.CENTER);
        addBtn.connect('clicked', () => {
            const profile = this._createProfile();
            this._profiles.push(profile);
            this._activeProfileId = profile.id;
            this.settings.set_string('active-profile-id', profile.id);
            this._saveProfiles();
            this._rebuildProfileSelector(profileSelector);
            this._updateSettingRows();
            profileNameRow.set_text(profile.name || _('Default widget'));
            profileSelectorRow.set_subtitle(profile.name || profile.id);
        });

        const dupBtn = Gtk.Button.new_from_icon_name('edit-copy-symbolic');
        dupBtn.set_tooltip_text(_('Duplicate the active profile'));
        dupBtn.set_valign(Gtk.Align.CENTER);
        dupBtn.connect('clicked', () => {
            const src = this._getActiveProfile();
            if (!src) return;
            const dup = this._createProfile();
            Object.assign(dup, {
                name: `${src.name || _('Widget')} copy`,
                imagePath: src.imagePath || '',
                widgetSize: src.widgetSize || 200,
                widgetPositionX: (src.widgetPositionX || 100) + 20,
                widgetPositionY: (src.widgetPositionY || 100) + 20,
                widgetAspectRatio: src.widgetAspectRatio || 1.0,
                widgetTimeout: src.widgetTimeout || 60,
                widgetCornerRadius: src.widgetCornerRadius || 20,
                visible: src.visible !== false,
            });
            this._profiles.push(dup);
            this._activeProfileId = dup.id;
            this.settings.set_string('active-profile-id', dup.id);
            this._saveProfiles();
            this._rebuildProfileSelector(profileSelector);
            this._updateSettingRows();
            profileNameRow.set_text(dup.name || _('Default widget'));
            profileSelectorRow.set_subtitle(dup.name || dup.id);
        });

        const removeBtn = Gtk.Button.new_from_icon_name('user-trash-symbolic');
        removeBtn.set_tooltip_text(_('Remove the active profile'));
        removeBtn.set_valign(Gtk.Align.CENTER);
        removeBtn.connect('clicked', () => {
            const idx = this._profiles.findIndex(
                p => p.id === this._activeProfileId
            );
            if (idx < 0 || this._profiles.length <= 1) return;

            // GNOME-native confirmation dialog (Adw.MessageDialog)
            const dialog = new Adw.MessageDialog({
                transient_for: window,
                heading: _('Remove profile?'),
                body: _(
                    'The widget “%s” and all its settings will be permanently ' +
                    'removed.'
                ).format(
                    this._profiles[idx].name || this._profiles[idx].id
                ),
                close_response: 'cancel',
            });
            dialog.add_response('cancel', _('_Cancel'));
            dialog.add_response('remove', _('_Remove'));
            dialog.set_response_appearance('remove', Adw.ResponseAppearance.DESTRUCTIVE);
            dialog.set_default_response('cancel');

            dialog.connect('response', (dlg, response) => {
                if (response !== 'remove') {
                    dlg.destroy();
                    return;
                }
                this._profiles.splice(idx, 1);
                this._activeProfileId = this._profiles[
                    Math.max(0, idx - 1)
                ].id;
                this.settings.set_string(
                    'active-profile-id', this._activeProfileId
                );
                this._saveProfiles();
                this._rebuildProfileSelector(profileSelector);
                this._updateSettingRows();
                profileNameRow.set_text(
                    this._getActiveProfile()?.name || _('Default widget')
                );
                profileSelectorRow.set_subtitle(
                    this._getActiveProfile()?.name || ''
                );
                dlg.destroy();
            });
            dialog.present();
        });

        actionsRow.add_suffix(addBtn);
        actionsRow.add_suffix(dupBtn);
        actionsRow.add_suffix(removeBtn);
        actionsGroup.add(actionsRow);
        generalPage.add(profileGroup);
        generalPage.add(actionsGroup);
        window.add(generalPage);

        // === PAGE: Settings ==================================================
        const settingsPage = new Adw.PreferencesPage();
        settingsPage.set_title(_('Widget'));
        settingsPage.set_name(_('Widget'));

        const settingsGroup = new Adw.PreferencesGroup();
        settingsGroup.set_title(_('Selected Profile Settings'));
        settingsGroup.set_description(
            _('Changes apply immediately. The widget on your desktop will ' +
              'update without needing to close preferences.')
        );

        // Image source
        this._imagePathRow = this._createFolderChooserRow(
            _('Image Folder'), settingsPage,
            () => this._getActiveProfile()?.imagePath || '',
            value => this._setActiveProfileValue('imagePath', value)
        );
        settingsGroup.add(this._imagePathRow);

        // Size
        this._sizeRow = this._createSpinRow(
            _('Widget Size (px)'), 50, 2000, 1, 10,
            () => this._getActiveProfile()?.widgetSize || 200,
            value => this._setActiveProfileValue('widgetSize', value)
        );
        this._sizeRow.set_subtitle(_('Controls the overall footprint of the widget'));
        settingsGroup.add(this._sizeRow);

        // Position X
        this._xPositionRow = this._createSpinRow(
            _('X Position (px)'), 0, 100000, 5, 50,
            () => this._getActiveProfile()?.widgetPositionX || 0,
            value => this._setActiveProfileValue('widgetPositionX', value)
        );
        settingsGroup.add(this._xPositionRow);

        // Position Y
        this._yPositionRow = this._createSpinRow(
            _('Y Position (px)'), 0, 100000, 5, 50,
            () => this._getActiveProfile()?.widgetPositionY || 0,
            value => this._setActiveProfileValue('widgetPositionY', value)
        );
        settingsGroup.add(this._yPositionRow);

        // Aspect ratio
        this._aspectRatioRow = this._createSliderRow(
            _('Aspect Ratio'), 0.25, 4, 0.01, 0.1,
            () => this._getActiveProfile()?.widgetAspectRatio || 1.0,
            value => this._setActiveProfileValue('widgetAspectRatio', value),
            'double'
        );
        this._aspectRatioRow.set_subtitle(
            _('Width relative to height (1.0 = square)')
        );
        settingsGroup.add(this._aspectRatioRow);

        // Corner radius
        this._cornerRadiusRow = this._createSliderRow(
            _('Corner Radius (%)'), 0, 100, 1, 10,
            () => this._getActiveProfile()?.widgetCornerRadius || 20,
            value => this._setActiveProfileValue('widgetCornerRadius', value)
        );
        this._cornerRadiusRow.set_subtitle(
            _('Percentage of the shortest side')
        );
        settingsGroup.add(this._cornerRadiusRow);

        // Refresh interval
        this._timeoutRow = this._createSpinRow(
            _('Refresh Interval (s)'), 5, 100000, 5, 60,
            () => this._getActiveProfile()?.widgetTimeout || 60,
            value => this._setActiveProfileValue('widgetTimeout', value)
        );
        this._timeoutRow.set_subtitle(
            _('How often a new random image is selected')
        );
        settingsGroup.add(this._timeoutRow);

        // Current image info (read-only)
        const currentInfoRow = new Adw.ActionRow({
            title: _('Current Image'),
            subtitle: this._getActiveProfile()?.currentImagePath ||
                       _('(none selected yet)'),
            activatable: false,
        });
        settingsGroup.add(currentInfoRow);
        this._currentInfoRow = currentInfoRow;

        settingsPage.add(settingsGroup);
        window.add(settingsPage);

        // === PAGE: About ====================================================
        const aboutPage = new Adw.PreferencesPage();
        aboutPage.set_title(_('About'));
        aboutPage.set_name(_('About'));

        const aboutGroup = new Adw.PreferencesGroup();
        aboutGroup.set_title(_('Picture Desktop Widget'));
        aboutGroup.set_description(
            _('Display multiple independent picture widgets on your desktop ' +
              'background. Each widget cycles through images from its own folder.')
        );

        const versionRow = new Adw.ActionRow({
            title: _('Version'),
            subtitle: '9',
            activatable: false,
        });
        aboutGroup.add(versionRow);

        const supportedRow = new Adw.ActionRow({
            title: _('Supported Images'),
            subtitle: _('JPEG, PNG, GIF, BMP, WebP'),
            activatable: false,
        });
        aboutGroup.add(supportedRow);

        const tipRow = new Adw.ActionRow({
            title: _('Tip'),
            subtitle: _(
                'Use the Duplicate button to quickly create a new widget ' +
                'with the same settings as an existing one, then just change ' +
                'the folder.'
            ),
            activatable: false,
        });
        aboutGroup.add(tipRow);

        aboutPage.add(aboutGroup);
        window.add(aboutPage);

        // Close handler
        window.connect('close-request', () => {
            this.settings = null;
        });

        // Initial sync
        this._updateSettingRows();
    }

    // -----------------------------------------------------------------------
    // Profile helpers
    // -----------------------------------------------------------------------

    _normalizeProfile(profile = {}, fallback = {}) {
        return {
            ...fallback,
            ...profile,
            id: profile.id || fallback.id ||
                `profile-${Math.random().toString(36).slice(2, 10)}`,
            name: profile.name || fallback.name || _('New profile'),
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
        return profiles.map(p => this._normalizeProfile(p));
    }

    _loadProfiles() {
        try {
            const raw = this.settings.get_string('widget-profiles');
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) return parsed;
        } catch (error) {
            console.warn(`Unable to parse profile settings: ${error}`);
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
        return this._normalizeProfile({
            id: `profile-${Math.random().toString(36).slice(2, 10)}`,
            name: _('New profile'),
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

    _getActiveProfile() {
        return this._profiles.find(p => p.id === this._activeProfileId) ||
               this._profiles[0];
    }

    _setActiveProfileValue(key, value) {
        const profile = this._getActiveProfile();
        if (!profile) return;
        profile[key] = value;
        this._saveProfiles();
    }

    // -----------------------------------------------------------------------
    // UI sync helpers
    // -----------------------------------------------------------------------

    _updateSettingRows() {
        const profile = this._getActiveProfile();
        if (!profile) return;

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
    }

    _rebuildProfileSelector(selector) {
        const names = this._profiles.map(p => p.name || p.id);
        const newModel = new Gtk.StringList({ strings: names });
        selector.set_model(newModel);
        const activeIndex = this._profiles.findIndex(
            p => p.id === this._activeProfileId
        );
        selector.set_selected(activeIndex >= 0 ? activeIndex : 0);
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
                                if (name.endsWith('.jpg') ||
                                    name.endsWith('.jpeg') ||
                                    name.endsWith('.png') ||
                                    name.endsWith('.gif') ||
                                    name.endsWith('.bmp') ||
                                    name.endsWith('.webp')) {
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
                    } catch (_e) {
                        // Silently ignore subtitle count errors
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