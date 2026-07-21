# Developer guide — Picture Desktop Widget

This extension lets you place **one or more independent desktop widgets** on your GNOME Shell background, each cycling through random images from its own folder.  
Targets GNOME 46–50. Built with GNOME HIG (Human Interface Guidelines) in mind.

---

## Quick start (one-liner)

```bash
# 1. Clone the repository
git clone https://github.com/GaszokS/Picture-desktop-widget
cd Picture-desktop-widget-main

# 2. Install to the user extensions folder
mkdir -p ~/.local/share/gnome-shell/extensions/Picture-desktop-widget@GaszokS.github.com
cp -r . ~/.local/share/gnome-shell/extensions/Picture-desktop-widget@GaszokS.github.com/

# 3. Compile the GSettings schema
glib-compile-schemas schemas/

# 4. Enable the extension
gnome-extensions enable Picture-desktop-widget@GaszokS.github.com

# 5. Open the preferences
gnome-extensions prefs Picture-desktop-widget@GaszokS.github.com
```

> If you already have an older version installed, delete the old folder first:
> `rm -rf ~/.local/share/gnome-shell/extensions/Picture-desktop-widget@GaszokS.github.com`

---

## Requirements

### Ubuntu / Debian
```bash
sudo apt update
sudo apt install -y git gettext gjs gir1.2-gtk-4.0 gir1.2-adw-1 glib2.0-bin
```

### Fedora
```bash
sudo dnf install git gettext gjs glib2-devel
```

### Arch Linux
```bash
sudo pacman -S git gettext gjs glib2
```

> For nested-shell testing (recommended) also install `mutter-devkit` (Ubuntu) or `gnome-shell` development packages on your distribution.

---

## Folder structure

```
Picture-desktop-widget-main/
├── extension.js        # Core extension logic (runs in GNOME Shell)
├── prefs.js            # Preferences dialog (runs in GNOME Settings)
├── metadata.json       # Extension metadata and version
├── schemas/
│   ├── *.gschema.xml   # GSettings schema definition
│   └── gschemas.compiled  # Compiled schema (regenerate after edits)
├── po/                 # Translation files
├── docs/               # Screenshots and assets
├── README.md           # End-user readme
└── DEV-README.md       # This file
```

---

## How the extension works

### `extension.js` — the running part

When the extension is enabled, it:

1. **Loads profiles** from the `widget-profiles` GSettings key (a JSON array of profile objects).
2. **Creates an `St.Widget`** for each profile and adds it to `Main.layoutManager._backgroundGroup` (this puts widgets behind desktop icons).
3. **Picks a random image** from each profile's configured folder and styles the widget with it as a CSS `background-image`.
4. **Starts a timer** per profile that picks a new random image at the configured interval.

When a profile is changed through the preferences dialog, `changed::widget-profiles` fires and `_reloadProfiles` handles add/update/remove of widgets.

**QoL features:**
- **Tooltip on hover** — shows the profile name and current image file path
- **Elapsed-time-aware scheduling** — if the system was suspended or the timer was delayed, the next refresh adjusts to maintain the correct cycle
- **Change-type-aware updates** — changing position/size/radius only re-applies layout without picking a new image; only changing the folder triggers a new random image
- **SVG support** — `.svg` files are now recognized alongside `.jpg`, `.jpeg`, `.png`, `.gif`, `.bmp`, `.webp`

### `prefs.js` — the settings dialog

Uses `Adw` (libadwaita) with a **multi-page layout** following GNOME HIG:

| Page | Content |
|------|---------|
| **General** | Profile selector, profile name, visibility toggle, add/duplicate/remove buttons with icon-only symbolic buttons and tooltips |
| **Widget** | Per-profile settings: image folder, size, position, aspect ratio, corner radius, refresh interval, current image info |
| **About** | Version, supported formats, usage tips |

**HIG-compliant features:**
- **Adw.MessageDialog** for destructive "Remove profile" action with `DESTRUCTIVE` response appearance
- **Icon buttons** (`list-add-symbolic`, `edit-copy-symbolic`, `user-trash-symbolic`) with tooltips
- **Descriptive subtitles** on every preference group and row
- **Image count** shown after folder selection
- **Read-only "Current Image" row** showing the active file path
- **Duplicate offsets** the new widget by +20px in both X and Y to prevent overlap

### GSettings schema

Defined in `schemas/org.gnome.shell.extensions.Picture-desktop-widget.gschema.xml`:

| Key | Type | Purpose |
|-----|------|---------|
| `widget-size` | int | Default widget size (used for new profiles) |
| `widget-aspect-ratio` | double | Default aspect ratio |
| `widget-position-x` | int | Default X position |
| `widget-position-y` | int | Default Y position |
| `image-path` | string | Default image folder path |
| `widget-timeout` | int | Default refresh interval in seconds |
| `widget-corner-radius` | int | Default corner radius % |
| `time-last-update` | int | Timestamp of last update (legacy) |
| `current-image-path` | string | Currently displayed image path (legacy) |
| `widget-profiles` | string | **JSON array of all profile configurations** |
| `active-profile-id` | string | ID of the profile being edited in prefs |

---

## Development workflow

### 1. Make your changes

Edit `extension.js` and/or `prefs.js` as needed.

### 2. If you changed the schema

```bash
glib-compile-schemas schemas/
```

### 3. Deploy the extension

```bash
# Remove old copy
rm -rf ~/.local/share/gnome-shell/extensions/Picture-desktop-widget@GaszokS.github.com

# Copy everything
mkdir -p ~/.local/share/gnome-shell/extensions/Picture-desktop-widget@GaszokS.github.com
cp -r . ~/.local/share/gnome-shell/extensions/Picture-desktop-widget@GaszokS.github.com/

# Disable (to clear cached state) then re-enable
gnome-extensions disable Picture-desktop-widget@GaszokS.github.com 2>/dev/null || true
gnome-extensions enable Picture-desktop-widget@GaszokS.github.com
```

### 4. Test

**Recommended:** Run a nested Wayland session:
```bash
dbus-run-session gnome-shell --devkit --wayland
```
Then in a second terminal:
```bash
gnome-extensions enable Picture-desktop-widget@GaszokS.github.com
gnome-extensions prefs Picture-desktop-widget@GaszokS.github.com
```

**Alternative (X11 or can't use nested):** Press `Alt+F2`, type `restart`, then enable from the Extensions app.

### 5. View logs

```bash
journalctl -f -o cat /usr/bin/gnome-shell   # Shell output
journalctl -f -o cat /usr/bin/gjs           # JavaScript output
```

For verbose debugging:
```bash
SHELL_DEBUG=all dbus-run-session gnome-shell --devkit --wayland
```

You can also open Looking Glass with `Alt+F2` then `lg`.

---

## Common issues

| Symptom | Likely cause |
|---------|-------------|
| Extension doesn't appear in Extensions app | UUID in `metadata.json` must match the install folder name exactly |
| Preferences window is blank | Schema not compiled — run `glib-compile-schemas schemas/` |
| Widget shows black box with "No images found" | The folder exists but contains no supported image files |
| Widget shows black box with "Folder not found" | The configured path doesn't exist |
| Widget doesn't update | Check `journalctl -f -o cat /usr/bin/gjs` for errors |
| After code changes nothing happens | You need to disable and re-enable the extension (or restart the shell) |
| Widget image changes when I only moved/resized it | **Fixed in v9** — only changing the folder triggers a new image pick |

---

## Profile data format

Each profile in the `widget-profiles` JSON array has this structure:

```json
{
  "id": "profile-abc12345",
  "name": "My Widget",
  "imagePath": "/home/user/Pictures/Wallpapers",
  "widgetSize": 200,
  "widgetPositionX": 100,
  "widgetPositionY": 100,
  "widgetAspectRatio": 1.0,
  "widgetTimeout": 60,
  "widgetCornerRadius": 20,
  "timeLastUpdate": 1712345678,
  "currentImagePath": "/home/user/Pictures/Wallpapers/sunset.jpg",
  "cachedFiles": ["sunset.jpg", "mountains.jpg", "beach.jpg"],
  "cachedFolderPath": "/home/user/Pictures/Wallpapers",
  "visible": true,
  "requiresRescan": false
}
```

- `cachedFiles` — cached list of image filenames (avoids rescanning on every timer tick)
- `cachedFolderPath` — the folder that was cached (used to detect folder changes)
- `requiresRescan` — set to `true` when the image folder changes, triggers a fresh scan
- `timeLastUpdate` — unix epoch timestamp of the last image pick (used for scheduling)

---

## Changelog (v9)

- **GNOME HIG redesign** of preferences: multi-page layout (General / Widget / About), icon buttons with tooltips, Adw.MessageDialog for destructive actions, descriptive subtitles, image count display
- **SVG support** added to image scanning
- **Tooltip on widget hover** shows profile name and current image path
- **Elapsed-time-aware scheduling** restores original behavior: timer adjusts for time spent suspended/paused
- **Change-type-aware updates**: only folder changes trigger new image; position/size/radius changes just re-apply layout
- **Reentrancy protection** in `enable()` prevents duplicate widget creation
- **Data-loss fix**: runtime mutations (`timeLastUpdate`, `currentImagePath`, `cachedFiles`) no longer lost on settings save
- **`_saveProfiles` no longer mutates** in-memory profile objects
- **Duplicate offset**: new duplicated widget is shifted +20px in X/Y to prevent overlap