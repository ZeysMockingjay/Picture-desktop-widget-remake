'use strict';

import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';

import { ExtensionPreferences, gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class PictureDesktopWidgetPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        this.settings = this.getSettings();
        this._profiles = this._normalizeProfiles(this._loadProfiles());
        this._activeProfileId = this.settings.get_string('active-profile-id') || this._profiles[0]?.id || '';

        const page = new Adw.PreferencesPage();
        const profileGroup = new Adw.PreferencesGroup();
        profileGroup.set_title(_('Profiles'));

        const profileNameRow = new Adw.EntryRow({ title: _('Profile name') });
        profileNameRow.set_text(this._getActiveProfile()?.name || _('Default widget'));
        profileNameRow.connect('notify::text', () => {
            const profile = this._getActiveProfile();
            if (profile) {
                profile.name = profileNameRow.get_text();
                this._saveProfiles();
                this._refreshProfileSelector(profileSelector);
            }
        });
        profileGroup.add(profileNameRow);

        const profileSelectorRow = new Adw.ActionRow({ title: _('Select profile') });
        const profileModel = new Gtk.StringList({ strings: this._profiles.map(profile => profile.name || profile.id) });
        const profileSelector = new Gtk.DropDown({ model: profileModel, valign: Gtk.Align.CENTER });
        const activeIndex = this._profiles.findIndex(profile => profile.id === this._activeProfileId);
        profileSelector.set_selected(activeIndex >= 0 ? activeIndex : 0);
        profileSelector.connect('notify::selected', () => {
            const index = profileSelector.get_selected();
            const profile = this._profiles[index];
            if (!profile) {
                return;
            }
            this._activeProfileId = profile.id;
            this.settings.set_string('active-profile-id', profile.id);
            profileNameRow.set_text(profile.name || _('Default widget'));
            if (this._visibleRow) {
                this._visibleRow.set_active(profile.visible !== false);
            }
            this._updateSettingRows();
        });
        profileSelectorRow.add_suffix(profileSelector);
        profileSelectorRow.activatable_widget = profileSelector;
        profileGroup.add(profileSelectorRow);

        const profileActionsRow = new Adw.ActionRow({ title: _('Profile actions') });
        const addButton = new Gtk.Button({ label: _('Add widget'), valign: Gtk.Align.CENTER });
        addButton.connect('clicked', () => {
            const profile = this._createProfile();
            this._profiles.push(profile);
            this._activeProfileId = profile.id;
            this.settings.set_string('active-profile-id', profile.id);
            this._saveProfiles();
            this._refreshProfileSelector(profileSelector);
            this._updateSettingRows();
            profileNameRow.set_text(profile.name || _('Default widget'));
        });
        const duplicateButton = new Gtk.Button({ label: _('Duplicate'), valign: Gtk.Align.CENTER });
        duplicateButton.connect('clicked', () => {
            const sourceProfile = this._getActiveProfile();
            if (!sourceProfile) {
                return;
            }
            const duplicated = this._createProfile();
            duplicated.name = `${sourceProfile.name || _('Widget')} copy`;
            duplicated.imagePath = sourceProfile.imagePath || '';
            duplicated.widgetSize = sourceProfile.widgetSize || 200;
            duplicated.widgetPositionX = sourceProfile.widgetPositionX || 100;
            duplicated.widgetPositionY = sourceProfile.widgetPositionY || 100;
            duplicated.widgetAspectRatio = sourceProfile.widgetAspectRatio || 1.0;
            duplicated.widgetTimeout = sourceProfile.widgetTimeout || 60;
            duplicated.widgetCornerRadius = sourceProfile.widgetCornerRadius || 20;
            duplicated.visible = sourceProfile.visible !== false;
            this._profiles.push(duplicated);
            this._activeProfileId = duplicated.id;
            this.settings.set_string('active-profile-id', duplicated.id);
            this._saveProfiles();
            this._refreshProfileSelector(profileSelector);
            this._updateSettingRows();
            profileNameRow.set_text(duplicated.name || _('Default widget'));
        });
        const removeButton = new Gtk.Button({ label: _('Remove'), valign: Gtk.Align.CENTER });
        removeButton.connect('clicked', () => {
            const index = this._profiles.findIndex(profile => profile.id === this._activeProfileId);
            if (index < 0 || this._profiles.length <= 1) {
                return;
            }
            this._profiles.splice(index, 1);
            this._activeProfileId = this._profiles[Math.max(0, index - 1)].id;
            this.settings.set_string('active-profile-id', this._activeProfileId);
            this._saveProfiles();
            this._refreshProfileSelector(profileSelector);
            this._updateSettingRows();
        });
        profileActionsRow.add_suffix(addButton);
        profileActionsRow.add_suffix(duplicateButton);
        profileActionsRow.add_suffix(removeButton);
        profileGroup.add(profileActionsRow);

        this._visibleRow = new Adw.SwitchRow({ title: _('Visible on desktop') });
        this._visibleRow.set_active(this._getActiveProfile()?.visible !== false);
        this._visibleRow.connect('notify::active', () => {
            const profile = this._getActiveProfile();
            if (!profile) {
                return;
            }
            profile.visible = this._visibleRow.get_active();
            this._saveProfiles();
        });
        profileGroup.add(this._visibleRow);

        page.add(profileGroup);

        const settingsGroup = new Adw.PreferencesGroup();
        settingsGroup.set_title(_('Selected profile settings'));

        this._sizeRow = this._createSpinRow(_('Widget Size'), 50, 2000, 1, 10, () => this._getActiveProfile()?.widgetSize || 200, value => this._setActiveProfileValue('widgetSize', value));
        this._xPositionRow = this._createSpinRow(_('X Position'), 0, 100000, 5, 50, () => this._getActiveProfile()?.widgetPositionX || 0, value => this._setActiveProfileValue('widgetPositionX', value));
        this._yPositionRow = this._createSpinRow(_('Y Position'), 0, 100000, 5, 50, () => this._getActiveProfile()?.widgetPositionY || 0, value => this._setActiveProfileValue('widgetPositionY', value));
        this._imagePathRow = this._createFolderChooserRow(_('Images Path'), page, () => this._getActiveProfile()?.imagePath || '', value => this._setActiveProfileValue('imagePath', value));
        this._timeoutRow = this._createSpinRow(_('Image Update Interval (seconds)'), 5, 100000, 5, 60, () => this._getActiveProfile()?.widgetTimeout || 60, value => this._setActiveProfileValue('widgetTimeout', value));
        this._cornerRadiusRow = this._createSliderRow(_('Widget Corner Radius (%)'), 0, 100, 1, 10, () => this._getActiveProfile()?.widgetCornerRadius || 20, value => this._setActiveProfileValue('widgetCornerRadius', value));
        this._aspectRatioRow = this._createSliderRow(_('Widget Aspect Ratio (Width/Height)'), 0.25, 4, 0.01, 0.1, () => this._getActiveProfile()?.widgetAspectRatio || 1.0, value => this._setActiveProfileValue('widgetAspectRatio', value), 'double');

        settingsGroup.add(this._sizeRow);
        settingsGroup.add(this._xPositionRow);
        settingsGroup.add(this._yPositionRow);
        settingsGroup.add(this._imagePathRow);
        settingsGroup.add(this._timeoutRow);
        settingsGroup.add(this._cornerRadiusRow);
        settingsGroup.add(this._aspectRatioRow);
        page.add(settingsGroup);
        window.add(page);

        window.connect('close-request', () => {
            this.settings = null;
        });

        this._updateSettingRows();
    }

    _normalizeProfile(profile = {}, fallback = {}) {
        return {
            ...fallback,
            ...profile,
            id: profile.id || fallback.id || `profile-${Math.random().toString(36).slice(2, 10)}`,
            name: profile.name || fallback.name || _('New profile'),
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
        } catch (error) {
            log(`Unable to parse profile settings: ${error}`);
        }
        return [];
    }

    _saveProfiles() {
        this.settings.set_string('widget-profiles', JSON.stringify(this._normalizeProfiles(this._profiles)));
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
        return this._profiles.find(profile => profile.id === this._activeProfileId) || this._profiles[0];
    }

    _setActiveProfileValue(key, value) {
        const profile = this._getActiveProfile();
        if (!profile) {
            return;
        }
        profile[key] = value;
        this._saveProfiles();
    }

    _updateSettingRows() {
        const profile = this._getActiveProfile();
        if (!profile) {
            return;
        }

        if (this._sizeRow) {
            this._sizeRow.set_value(profile.widgetSize || 200);
        }
        if (this._xPositionRow) {
            this._xPositionRow.set_value(profile.widgetPositionX || 0);
        }
        if (this._yPositionRow) {
            this._yPositionRow.set_value(profile.widgetPositionY || 0);
        }
        if (this._timeoutRow) {
            this._timeoutRow.set_value(profile.widgetTimeout || 60);
        }
        if (this._cornerRadiusRow) {
            this._cornerRadiusRow.set_value(profile.widgetCornerRadius || 20);
        }
        if (this._aspectRatioRow) {
            this._aspectRatioRow.set_value(profile.widgetAspectRatio || 1.0);
        }
        if (this._imagePathRow) {
            this._imagePathRow.set_subtitle(profile.imagePath || '');
        }
        if (this._visibleRow) {
            this._visibleRow.set_active(profile.visible !== false);
        }
    }

    _refreshProfileSelector(selector) {
        const names = this._profiles.map(profile => profile.name || profile.id);
        const newModel = new Gtk.StringList({ strings: names });
        selector.set_model(newModel);
        const activeIndex = this._profiles.findIndex(profile => profile.id === this._activeProfileId);
        selector.set_selected(activeIndex >= 0 ? activeIndex : 0);
    }

    _createSpinRow(title, lower, upper, stepIncrement, pageIncrement, getter, setter) {
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

    _createSliderRow(title, lower, upper, stepIncrement, pageIncrement, getter, setter, settingType = 'int') {
        let digits;
        if (stepIncrement < 1) {
            digits = Math.ceil(-Math.log10(stepIncrement));
        } else {
            digits = 0;
        }

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
        const row = new Adw.ActionRow({ title: title, activatable: false });
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

            dialog.connect('response', (dialog, response) => {
                if (response === Gtk.ResponseType.OK) {
                    const folderPath = dialog.get_file().get_path();
                    setter(folderPath);
                    row.set_subtitle(folderPath);
                }
                dialog.destroy();
            });

            dialog.present();
        });

        row.add_suffix(button);
        row.activatable_widget = button;

        return row;
    }
}