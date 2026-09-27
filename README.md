# Terrarium Manager

A small Windows desktop app for keeping track of the jars you buy, the terrariums you make with them, what became of each one (sold, given away, lost or kept) and who bought them. It also turns the terrariums for sale into a PDF catalog to send to clients. The interface is in Brazilian Portuguese.

Built with Electron and SQLite. It uses Node's built-in `node:sqlite`, so there are no native modules to compile, and the UI is plain HTML, CSS and JavaScript with no build step.

## Features

- **Na prateleira**: every terrarium still on the shelf, with photo, size, container, plants, cost and asking price. Search by name, plants or notes. Terrariums in the **Acervo pessoal** (personal collection) are here too, tagged: they can be sold but stay out of the catalog.
- **Frascos**: the jars you've bought, one lot per kind of jar per purchase (collection, supplier, date, quantity, jar + lid + shipping cost, suggested price). **Registrar compra** enters a whole order at once and splits its shipping among the jars, equally or in proportion to each jar's price. Stock goes down by itself: when adding a terrarium, pick its jar under **Frasco do estoque**, which also fills in the container, cost, price and description.
- **Vendidos**: tabs for sales (date, price, profit), **Cortesias** (terrariums given away, and what they cost) and **Perdas** (terrariums that died or broke). Each can be undone with **Voltar para a prateleira**. Sales and gifts record **De onde veio a venda** (Instagram, friends, a fair…) and when they were delivered, and can be filtered by where they came from: the totals then show what each channel brings in.
- **Compradores**: buyers with name, cellphone, Instagram and notes, their purchases and gifts, where they first came from, and buttons that open a WhatsApp chat or their Instagram profile.
- **Catálogo Rápido**: an A4 PDF of the terrariums for sale, with your logo, colors, fonts and layout, and a live preview.
- **Visão geral**: totals for this month, this year and all time, sales per month over the last 12 months, and a breakdown by size.
- **Configurações**: currency, where the data lives, saving or restoring a backup, exporting everything as spreadsheets (CSV), and a one-time import of the old "Controle Terrários" spreadsheet.
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
| `src/xlsx.js` | Reads cell values from an .xlsx file, with no extra libraries |
| `src/import-sheet.js` | The one-time import of the "Controle Terrários" spreadsheet |
| `renderer/` | The UI: HTML, CSS, fonts and JavaScript modules |
| `renderer/js/views/` | One file per page: shelf, jars, sold, buyers, catalog, overview, settings |
| `renderer/js/terrarium.js` | Details panel, add/edit form, and the sold / given away / lost dialog |
| `renderer/js/jar-lot.js` | Jar lot panel, "Registrar compra" (with the shipping split) and lot editing |
| `renderer/js/buyer.js` | Buyer panel, buyer editing, and the Comprador + Celular fields used when selling |
| `renderer/js/csv.js` | The CSV export |
| `renderer/js/catalog-render.js` | Lays out the Catálogo Rápido's A4 pages |
| `scripts/dev.js` | The `npm run dev` runner with live reload |
| `scripts/make-icon.js` | Draws `build/icon.png` from an SVG |

## Development notes

### Database

Buyers live in their own table; each sale points at one. When selling, a name that matches an existing buyer (ignoring capitals and extra spaces) reuses that buyer, and a phone typed there updates theirs. Buyers left with no purchases and no phone or notes are removed automatically.

A terrarium's `status` is `available`, `personal` (Acervo pessoal: on the shelf, out of the catalog), `sold`, `donated` or `lost`. For the last three, `sold_on` is the day it left the shelf, `buyer_id` who got it, `channel` where the sale came from and `delivered_on` when it was delivered (none of them is set for a loss), and `sale_notes` the notes or reason; only a sale has `sold_price_cents`. A buyer's `instagram` is the handle without the @ (several are kept as "ana / bia"). `Store` keeps these consistent whatever the renderer sends.

Jars live in `jar_lots`, one row per kind of jar per purchase. How many are left is never stored: it's `quantity` minus the terrariums whose `lot_id` points at the lot, so deleting a terrarium puts its jar back. A lot with nothing left can't be given to another terrarium.

To add a column, add a new numbered entry to `MIGRATIONS` in `src/db.js`, bump `SCHEMA_VERSION` and add the column name to `EDITABLE` (or `LOT_EDITABLE`). Existing databases upgrade automatically the next time the app opens, and a copy of the old data is saved to `backups\before-upgrade-v<N>-….db` first. Foreign keys are switched off while upgrading, because changing a CHECK constraint means rebuilding the table, and dropping `terrariums` with them on would delete every photo. Each upgrade runs `PRAGMA foreign_key_check` before it's kept.

**Careful with `npm run dev`:** it restarts the app whenever `src/` changes, so a half-written migration runs against `.dev-data` as soon as you save it. Stop the dev app while writing one.

### Importing the old spreadsheet

**Configurações → Importar planilha "Controle Terrários"…** reads the "Frascos de vidro" and "VENDIDOS" sheets. Each row of "Frascos de vidro" becomes a jar lot, and each unit of a lot with an assembly date becomes a terrarium. Which lot each sale came from, and what happened to units the sales don't cover (the sheet showed that with row colours), was worked out by hand and is written down in `src/import-sheet.js` (`SALE_LOTS`, `OTHER_OUTCOMES`). The import checks the rows it relies on and refuses a spreadsheet that has changed since. It shows a preview first, saves a backup to `backups\before-import-….db`, and then lists what the spreadsheet left unclear, for review. It can only run once (the `sheet_imported_at` setting).

### Spreadsheets (CSV)

**Configurações → Exportar planilhas (CSV)…** writes `frascos.csv`, `terrarios.csv` and `compradores.csv` to a folder you choose. They use semicolons, decimal commas and dd/mm/yyyy dates, with a byte-order mark, which is what Excel and LibreOffice expect in Portuguese.

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
