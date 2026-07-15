# Developer README

This guide explains how to test the extension locally on Ubuntu without publishing it to GNOME Extensions.

## 1. Prerequisites

Install the GNOME Shell development tools and dependencies:

```bash
sudo apt update
sudo apt install -y git gnome-shell-extension-tool gnome-shell-common gettext gjs gir1.2-gtk-4.0 gir1.2-adw-1
```

If you are using a newer Ubuntu release, you may also need the GNOME Shell development packages that match your installed shell version.

## 2. Clone the project

```bash
git clone <your-repo-url>
cd Picture-desktop-widget-main
```

## 3. Prepare the extension folder

The extension expects to live in a directory that GNOME Shell can discover. A common path is:

```bash
mkdir -p ~/.local/share/gnome-shell/extensions/Picture-desktop-widget@GaszokS.github.com
cp -r . ~/.local/share/gnome-shell/extensions/Picture-desktop-widget@GaszokS.github.com/
```

If you are updating an existing local copy, replace the target directory contents with the latest files.

## 4. Compile the GSettings schema

Run this from the extension folder:

```bash
glib-compile-schemas schemas/
```

This ensures the schema file is compiled for local use.

## 5. Reload GNOME Shell

You can reload the shell from the keyboard by pressing:

```text
Alt + F2
```

Then type:

```text
r
```

Press Enter.

Alternatively, log out and back in.

## 6. Enable the extension

Open the Extensions app and enable the local extension named:

```text
Picture desktop widget
```

If the extension does not show up, you may need to restart the shell again.

## 7. Open the preferences window

You can launch the preferences UI from the Extensions app or by running:

```bash
gnome-extensions prefs Picture-desktop-widget@GaszokS.github.com
```

## 8. Test the new workflow

After enabling the extension:

1. Open the Preferences window.
2. Use the Add widget button to create a new widget profile.
3. Rename it.
4. Choose a folder containing images.
5. Toggle visibility on or off.
6. Duplicate an existing profile to create a second widget with similar settings.
7. Confirm that each widget appears on the desktop independently.

## 9. Debugging tips

### View shell logs

```bash
journalctl -f -o cat /usr/bin/gnome-shell
```

### Check for extension errors

```bash
journalctl -f -o cat /usr/bin/gnome-shell | grep -i "Picture"
```

### Reload after changes

After editing files, run the schema compile command again and then reload GNOME Shell.

## 10. Common issues

- The extension is not shown: ensure the UUID in metadata.json matches the install folder name.
- The folder chooser does not work: confirm you installed the relevant GTK and Adwaita libraries.
- The widget does not appear: check the shell journal for errors and confirm the extension is enabled.

## 11. Quick test loop

Use this loop while iterating on the extension:

```bash
glib-compile-schemas schemas/
cp -r . ~/.local/share/gnome-shell/extensions/Picture-desktop-widget@GaszokS.github.com/
```

Then reload GNOME Shell and test again.
