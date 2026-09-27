# Terrarium Manager

A small Windows desktop app for keeping track of the terrariums on your shelf, the ones you've sold (date, price, profit) and who bought them. It also turns the unsold terrariums into a PDF catalog to send to clients. The interface is in Brazilian Portuguese.

Built with Electron and SQLite. It uses Node's built-in `node:sqlite`, so there are no native modules to compile, and the UI is plain HTML, CSS and JavaScript with no build step.

## Features

- **Na prateleira**: every terrarium not yet sold, with photo, size, container, plants, cost and asking price. Search by name, plants or notes.
- **Vendidos**: sales with date, price and profit. **Marcar como vendido** records a sale and its buyer; a sale can be undone.
- **Compradores**: buyers with name, cellphone and notes, their purchases, and a button that opens a WhatsApp chat.
- **Catálogo Rápido**: an A4 PDF of the unsold terrariums, with your logo, colors, fonts and layout, and a live preview.
- **Visão geral**: totals for this month, this year and all time, sales per month over the last 12 months, and a breakdown by size.
- **Configurações**: currency, where the data lives, and saving or restoring a backup.
- Daily automatic backups, keeping the last 14.
- Shortcuts: **Ctrl+N** adds a terrarium, **Ctrl+F** jumps to the search box.

## Getting started

You need [Node.js](https://nodejs.org/) (LTS) with npm, on Windows.

```bash
npm install
npm run dev
```

`npm run dev` runs the app with live reload. Changes in `renderer/` reload the window, and changes to `main.js`, `preload.js` or `src/` restart the app. It keeps its data in `.dev-data\`, separate from the installed app, so both can be open at once. Press Ctrl+Shift+I for DevTools.

`npm start` runs it once without live reload, using the same data as the installed app. To point it at another folder instead:

```powershell
$env:TERRARIUM_DATA_DIR = "C:\temp\terrarium-test"; npm start
```

## Building the installer

```bash
npm run dist
```

This creates `dist\Terrarium Manager Setup <version>.exe`. Run it to install the app with a Start menu and desktop shortcut.

```bash
npm run dist:portable
```

This builds a single `dist\TerrariumManager-portable.exe` that runs without installing.

The installer isn't code-signed, so Windows SmartScreen may warn the first time. Click **Mais informações → Executar assim mesmo**.

To change the icon, edit the SVG in `scripts/make-icon.js` and run `npm run icon`.

## Where the data lives

`%APPDATA%\Terrarium Manager\terrariums.db`. Everything is in that one SQLite file, photos included.

- The app saves a copy to `backups\` each day it's opened and keeps the last 14.
- **Configurações → Salvar um backup…** writes a copy anywhere you like (a pen drive or cloud folder is a good idea).
- **Configurações → Restaurar um backup…** replaces the data. It saves the current data to `backups\` first, so a restore can be undone.

## Project layout

| Path | What it is |
| --- | --- |
| `main.js` | Electron main process: window, `app://` and `photo://` protocols, IPC, backups, PDF export |
| `preload.js` | The `window.api` bridge the UI uses to talk to the database |
| `src/db.js` | SQLite schema, migrations and queries (money is stored in cents) |
| `renderer/` | The UI: HTML, CSS, fonts and JavaScript modules |
| `renderer/js/views/` | One file per page: shelf, sold, buyers, catalog, overview, settings |
| `renderer/js/terrarium.js` | Details panel, add/edit form and "Marcar como vendido" dialog |
| `renderer/js/buyer.js` | Buyer panel, buyer editing, and the Comprador + Celular fields used when selling |
| `renderer/js/catalog-render.js` | Lays out the Catálogo Rápido's A4 pages |
| `scripts/dev.js` | The `npm run dev` runner with live reload |
| `scripts/make-icon.js` | Draws `build/icon.png` from an SVG |

## Development notes

### Database

Buyers live in their own table; each sale points at one. When selling, a name that matches an existing buyer (ignoring capitals and extra spaces) reuses that buyer, and a phone typed there updates theirs. Buyers left with no purchases and no phone or notes are removed automatically.

To add a column, add a new numbered entry to `MIGRATIONS` in `src/db.js`, bump `SCHEMA_VERSION` and add the column name to `EDITABLE`. Existing databases upgrade automatically the next time the app opens, and a copy of the old data is saved to `backups\before-upgrade-v<N>-….db` first.

### Catálogo Rápido

On the left you choose which terrariums go in and how the catalog looks (logo, header texts, layout, photo shape, which details to show, colors, fonts, footer); on the right is a live preview. Changes are saved automatically.

The preview is drawn by `renderer/js/catalog-render.js`, which lays out the A4 pages itself: terrariums are added one by one and move to a new page when they don't fit, and with "Agrupar por tamanho" each size gets a heading that's never left alone at the bottom of a page. Page styles are in `renderer/catalog.css`, scoped under `.catalog-doc`. To save the PDF, the tab copies the preview pages into a print-only area (`.print-root`) and `main.js` prints the window with Electron's `printToPDF`, so the PDF always matches the preview.

Settings are stored as JSON in the `catalog_config` setting (defaults in `DEFAULT_CATALOG`) and the logo as a PNG data URL in `catalog_logo`. Only the **Descrição** field goes in the catalog; **Observações** stays private.

### Price fields

Price inputs use a 9999,99 mask (`renderer/js/money-input.js`): digits fill in from the right, like a banking app, and the selected currency's symbol is shown in front. To allow bigger prices, raise `MAX_DIGITS` in that file.

### Keeping it fast on modest computers

The app is meant to run well on a low-end laptop (e.g. an Intel Celeron with 4 GB of RAM), so a few things are deliberate:

- **Thumbnails.** Everywhere in the app, photos are shown from a 480-pixel copy (`photo://terrarium/<id>`), stored in the `thumbnails` table. It's made when a photo is saved, or the first time an older photo is shown. The full photo (`photo://terrarium/<id>/full`) is only used for the PDF catalog, where it's embedded as-is.
- **Listing never touches the photos table.** `terrariums.photo_version` changes whenever the photo does, and the photo URLs use it to bust the cache. (The photo's bytes come before its date in `photos`, and SQLite would read through every photo to reach the date.)
- **WAL mode.** Saving waits for the disk less often. Close the app before copying `terrariums.db` by hand, or use **Salvar um backup…**, which always writes one self-contained file.
- **Backups run in the background.** The daily backup starts a few seconds after the window opens, and neither it nor **Salvar um backup…** freezes the app.
- **Long lists render in parts.** Vendidos and Compradores show 100 rows with a **Mostrar mais** button (`ROWS_PER_PAGE` in `renderer/js/table.js`). Shelf cards are reused between searches, and cards scrolled out of view aren't drawn.
- **Catálogo Rápido** redraws the pages at most a moment after you stop typing, and color changes don't redraw the pages at all.
- **Smaller installer.** It only includes Chromium's English and Portuguese language files (`electronLanguages` in `package.json`).
