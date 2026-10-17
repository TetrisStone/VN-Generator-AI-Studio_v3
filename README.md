# Visual Novel Creator AI

A React + Vite + TypeScript application for generating and playing Visual Novels and RPG mini-games using AI.

## Data Storage Architecture

To prevent browser `localStorage` quota exhaustion (typically limited to 5MB) and ensure high-performance loading during gameplay, this app has transitioned from an old monolithic localStorage architecture to a modern IndexedDB-based layout.

### IndexedDB Setup

Instead of keeping everything in memory and dropping it into localStorage, the application splits the data models.

1. **`VNCreatorDB`** - This is the primary IndexedDB namespace, utilizing multiple Object Stores.
2. **`project` Store** - Used for the abstract project data such as Characters, Maps, Scenes, and Battles. This ensures maximum JSON size scaling.
3. **`keyval` Store** - Used for storing User Save Games decoupled from the project data.
4. **`images` Store** - All multimedia, including Base64 representations of images, are decoupled from the JSON entities and stored here, mapped to UUID strings. Thus, a JSON document for a Scene only needs to reference `"bg_1234"` and doesn't suffer JSON-parse slowdowns attempting to decode 10-megabyte Base64 image blobs.

### The Migration Process

Upon loading the app for the first time, legacy `localStorage`-based saves are automatically converted to IndexedDB architecture via a built-in migration subroutine on application start. Old values are ported properly and existing game states are maintained to prevent progress loss.

### Exporting and Importing Projects

Given the sheer scale of the new storage structures, a single `.json` file can no longer easily map a complete project. Instead, the Application executes a multi-step bundling protocol using `JSZip`:
- Using the `Export` tools constructs a `.zip` archive.
- `project.json` is bundled inside containing all story parameters, triggers, relationships, and stats.
- A subdirectory called `images/` iterates across all known image IDs and builds standard text blobs holding Base64 URIs mapped directly to the keys.
- **Importing a ZIP archive** follows the exact reverse path, unpacking JSON states into the primary stores, and looping through `images/` restoring UUID mapping in `images` object store.

Legacy `.json` files are still supported during Import: the system detects filetypes and will gracefully fall back to native JSON-parsing if `JSZip` drops execution.

## Lokale Ausführung (Lokal starten)

Du kannst diese App ganz einfach auf deinem eigenen Rechner ausführen. Folge dazu diesen Schritten:

### 1. Voraussetzungen
Stelle sicher, dass **Node.js** (Version 18 oder neuer) auf deinem System installiert ist. Du kannst die Installation mit dem Befehl `node -v` im Terminal überprüfen.

### 2. Abhängigkeiten installieren
Öffne das Terminal im Stammverzeichnis des Projekts (wo sich die `package.json` befindet) und lade alle notwendigen Programmpakete herunter:
```bash
npm install
```

### 3. API Key konfigurieren (`.env`)
Erstelle im Hauptverzeichnis des Projekts eine Textdatei mit dem Namen `.env` (falls diese noch nicht existiert) und trage deinen Gemini API-Schlüssel ein:
```env
GEMINI_API_KEY=dein_gemini_api_key_hier
```
*Hinweis: Der API-Key wird dank unserer Full-Stack-Architektur sicher auf dem Server verarbeitet und niemals an den Browser übertragen. Dies schützt deinen Key vor unbefugtem Zugriff und behebt CORS-Probleme.*

### 4. Entwicklungs-Server starten
Starte den lokalen Express+Vite-Entwicklungs-Server mit:
```bash
npm run dev
```
Der Server startet standardmäßig auf **Port 3000** (bzw. http://localhost:3000). Du kannst die App jetzt über deinen Browser aufrufen.

### 5. Für Produktion bauen
Wenn du die Anwendung für den Produktivbetrieb kompilieren möchtest, führe folgenden Befehl aus:
```bash
npm run build
```
Dadurch wird die React-Frontend-Anwendung in den Ordner `dist/` kompiliert und der Express-Server als optimierte, eigenständige Quelldatei in `dist/server.cjs` gebündelt.

Danach kannst du die kompilierte App starten mit:
```bash
npm run start
```

