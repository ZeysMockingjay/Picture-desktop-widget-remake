# Picture Desktop Widget for GNOME Shell
## A GNOME Shell extension that places one or more desktop widgets on the background, each showing a random image from its own folder.

This project is a GNOME Shell extension that creates desktop widgets which display random images selected from configurable folders. The extension now supports multiple widget profiles, so you can create several independent widgets that each use a different source directory, size, position, aspect ratio, corner radius, and refresh interval.

Profiles can be selected and managed from the preferences dialog before changing the per-widget settings, making it easier to create multiple desktop widgets without mixing their configuration. The implementation uses cached file lists and lightweight refresh scheduling to keep image updates efficient while remaining responsive.

![Gnome desktop with a widget showing an image on the top left of the screen](/docs/ExempleScreenshot.png)

The extension can be downloaded from the GNOME Extensions website:
[<img src="docs/gnome-extensions_logo.svg" height="100">](https://extensions.gnome.org/extension/8388/picture-desktop-widget/)

## Developer resources

For extension development and debugging guidance, see:
- GNOME Shell 50 porting guide: https://gjs.guide/extensions/upgrading/gnome-shell-50.html
- Extension development docs: https://gjs.guide/extensions/development/creating.html
- Debugging guide: https://gjs.guide/extensions/development/debugging.html

## Find a bug or you have a suggestion?
Don't hesitate to report any issue you found or any suggestion you have to make in order to improve the extension.

## Like the project?
Do not hesitate to share the extension!
