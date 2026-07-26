# Ubuntu Testing Guide — Picture Desktop Widget

Ein einfaches Tutorial zum Testen dieser GNOME Shell Extension auf Ubuntu.

---

## 📋 Schritt 1: Abhängigkeiten installieren

Öffne ein Terminal und installiere die notwendigen Pakete:

```bash
sudo apt update
sudo apt install -y git gettext gjs gir1.2-gtk-4.0 gir1.2-adw-1 glib2.0-bin libglib2.0-bin
```

---

## 📥 Schritt 2: Repository klonen

```bash
git clone https://github.com/ZeysMockingjay/Picture-desktop-widget-remake
cd Picture-desktop-widget-remake
```

---

## 🔧 Schritt 3: Extension installieren

Kopiere die Extension in den GNOME-Ordner:

```bash
mkdir -p ~/.local/share/gnome-shell/extensions/Picture-desktop-widget@GaszokS.github.com
cp -r . ~/.local/share/gnome-shell/extensions/Picture-desktop-widget@GaszokS.github.com/
```

---

## 📝 Schritt 4: GSettings-Schema kompilieren

Wechsle in den Extension-Ordner und kompiliere das Schema:

```bash
cd ~/.local/share/gnome-shell/extensions/Picture-desktop-widget@GaszokS.github.com
glib-compile-schemas schemas/
```

---

## ✅ Schritt 5: Extension aktivieren

Aktiviere die Extension mit diesem Befehl:

```bash
gnome-extensions enable Picture-desktop-widget@GaszokS.github.com
```

---

## 🎯 Schritt 6: Einstellungen öffnen und testen

Öffne die Einstellungen der Extension:

```bash
gnome-extensions prefs Picture-desktop-widget@GaszokS.github.com
```

Jetzt kannst du:
1. Einen Ordner mit Bildern auswählen
2. Die Größe und Position des Widgets anpassen
3. Das Widget auf deinem Desktop sehen

---

## 🔄 Änderungen testen

Wenn du Code in `extension.js` oder `prefs.js` änderst:

### Option 1: Extension neu laden (einfach)
```bash
gnome-extensions disable Picture-desktop-widget@GaszokS.github.com && gnome-extensions enable Picture-desktop-widget@GaszokS.github.com
```

### Option 2: Nested Wayland Session (empfohlen)
Öffne ein neues Terminal-Fenster in einer separaten GNOME-Sitzung:

```bash
dbus-run-session gnome-shell --wayland --nested
```

Im neuen Fenster kannst du dann die Extension testen ohne deine aktuelle Session zu beeinflussen.

---

## 🐛 Fehler beheben

**Schau in die Logs:**
```bash
journalctl -f -o cat /usr/bin/gjs
```

**Häufige Probleme:**

| Problem | Lösung |
|---------|--------|
| Extension erscheint nicht in der App | Stelle sicher, dass der Ordnername `Picture-desktop-widget@GaszokS.github.com` ist |
| Einstellungen sind leer | Führe `glib-compile-schemas schemas/` erneut aus |
| Widget zeigt "Folder not found" | Der Ordnerpfad existiert nicht oder ist falsch |
| Änderungen haben keine Auswirkung | Deaktiviere und aktiviere die Extension erneut |

---

## 📁 Folderstruktur der Extension

```
Picture-desktop-widget-remake/
├── extension.js        ← Hauptlogik
├── prefs.js            ← Einstellungsdialog
├── metadata.json       ← Extension-Infos
├── schemas/            ← Konfigurationsschema
├── po/                 ← Übersetzungsdateien
└── docs/               ← Screenshots
```

---

## 🎓 Das wars!

Deine Extension sollte jetzt funktionieren. Viel Spaß beim Testen und Entwickeln! 🚀
