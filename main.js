const { app, BrowserWindow, Menu, dialog, ipcMain, nativeImage, nativeTheme, net, protocol, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { Store } = require('./src/db');
const { readXlsx } = require('./src/xlsx');
const { planImport, applyImport, checkNotImported } = require('./src/import-sheet');

const RENDERER_DIR = path.join(__dirname, 'renderer');
const DAILY_BACKUPS_KEPT = 14;
const DAILY_BACKUP_DELAY_MS = 5000; // after the window opens, so it never slows startup
// Thumbnails are this many pixels on their short side: sharp in the app's biggest jar,
// even on screens scaled to 150%.
const THUMBNAIL_SIDE = 480;
// The `theme` setting: follow Windows, or always light or dark.
const THEMES = ['system', 'light', 'dark'];

// `app://` serves the UI, `photo://` serves terrarium photos straight from the database.
// `codeCache` lets Chromium keep the compiled JavaScript between launches, so the app
// starts faster from the second launch on.
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, codeCache: true } },
  { scheme: 'photo', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

// `npm run dev` passes --dev: the window reloads when the UI changes, and data lives in
// .dev-data so testing never touches the installed app's data.
const DEV = !app.isPackaged && process.argv.includes('--dev');

// Point the app at another data folder, e.g. for testing without touching real data.
const dataOverride = process.env.TERRARIUM_DATA_DIR || (DEV && path.join(__dirname, '.dev-data'));
if (dataOverride) app.setPath('userData', path.resolve(dataOverride));

let store;
let win;

const dataDir = () => app.getPath('userData');
const dbFile = () => path.join(dataDir(), 'terrariums.db');
const backupDir = () => path.join(dataDir(), 'backups');
const today = () => new Date().toLocaleDateString('sv-SE'); // YYYY-MM-DD in local time

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  app.whenReady().then(start);
}

function start() {
  store = new Store(dbFile(), { backupDir: backupDir(), makeThumbnail });
  applyTheme();
  registerProtocols();
  registerIpc();
  if (app.isPackaged) Menu.setApplicationMenu(null);
  createWindow();
  win.webContents.once('did-finish-load', () => setTimeout(dailyBackup, DAILY_BACKUP_DELAY_MS));
  if (DEV) reloadOnRendererChanges();
}

// A small JPEG of a photo. Decoding full-size photos just to show them in small jars
// costs a lot of memory, and memory is what slow computers have least of.
function makeThumbnail(bytes) {
  const image = nativeImage.createFromBuffer(Buffer.from(bytes));
  if (image.isEmpty()) return null; // not a format nativeImage reads: the photo itself is shown
  const { width, height } = image.getSize();
  const scale = THUMBNAIL_SIDE / Math.min(width, height);
  const small = scale < 1
    ? image.resize({ width: Math.round(width * scale), height: Math.round(height * scale), quality: 'better' })
    : image;
  return small.toJPEG(82);
}

// The UI's colours follow `prefers-color-scheme` (see renderer/styles.css), which Electron
// answers from `themeSource`: the saved theme, or Windows' own when it's 'system'.
function applyTheme() {
  const theme = store.getSettings().theme;
  nativeTheme.themeSource = THEMES.includes(theme) ? theme : 'system';
}

function reloadOnRendererChanges() {
  let timer;
  fs.watch(RENDERER_DIR, { recursive: true }, (_event, file) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (!win || win.isDestroyed()) return;
      console.log(`[dev] ${file} changed, reloading the window...`);
      win.webContents.reloadIgnoringCache();
    }, 150);
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 620,
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#141B17' : '#EEF2EC', // --bg in renderer/styles.css
    title: 'Terrarium Manager',
    icon: path.join(__dirname, 'build', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      v8CacheOptions: 'bypassHeatCheck', // cache compiled scripts after the first launch
    },
  });
  win.once('ready-to-show', () => win.show());
  // Links never open inside the app window.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('app://')) event.preventDefault();
  });
  win.loadURL('app://local/index.html');
}

function registerProtocols() {
  protocol.handle('app', (request) => {
    const { pathname } = new URL(request.url);
    const file = path.normalize(path.join(RENDERER_DIR, decodeURIComponent(pathname)));
    if (!file.startsWith(RENDERER_DIR + path.sep)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });

  // photo://terrarium/<id>?v=<version> is the thumbnail shown in the app;
  // photo://terrarium/<id>/full?v=<version> is the photo itself, used for the PDF catalog.
  protocol.handle('photo', (request) => {
    const match = /^\/(\d+)(\/full)?$/.exec(new URL(request.url).pathname);
    const id = match && Number(match[1]);
    const photo = !id ? null : match[2] ? store.getPhoto(id) : store.getThumbnail(id);
    if (!photo) return new Response('Not found', { status: 404 });
    return new Response(photo.data, {
      headers: { 'content-type': photo.mime, 'cache-control': 'max-age=31536000, immutable' },
    });
  });
}

function registerIpc() {
  const handle = (channel, fn) => ipcMain.handle(channel, (_event, ...args) => fn(...args));

  handle('terrariums:list', () => store.list());
  handle('terrariums:create', (data) => store.create(data));
  handle('terrariums:update', (id, data) => store.update(id, data));
  handle('terrariums:settle', (id, outcome) => store.settle(id, outcome));
  handle('terrariums:unsell', (id) => store.unsell(id));
  handle('terrariums:delete', (id) => store.remove(id));
  handle('photos:set', (id, bytes, mime) => store.setPhoto(id, bytes, mime));

  handle('jars:list', () => store.listLots());
  handle('jars:create', (items) => store.createLots(items));
  handle('jars:update', (id, data) => store.updateLot(id, data));
  handle('jars:delete', (id) => store.removeLot(id));

  handle('buyers:list', () => store.listBuyers());
  handle('buyers:update', (id, data) => store.updateBuyer(id, data));
  handle('buyers:delete', (id) => store.removeBuyer(id));

  // Opens a WhatsApp chat with a Brazilian number (DDD + number) in the default browser.
  handle('contact:whatsapp', (phone) => {
    const digits = String(phone ?? '').replace(/\D/g, '');
    if (!/^\d{10,11}$/.test(digits)) throw new Error('Número de celular inválido.');
    return shell.openExternal(`https://wa.me/55${digits}`);
  });

  // Opens an Instagram profile in the default browser.
  handle('contact:instagram', (handle) => {
    const name = String(handle ?? '').replace(/^@/, '');
    if (!/^[\w.]{1,30}$/.test(name)) throw new Error('Perfil do Instagram inválido.');
    return shell.openExternal(`https://www.instagram.com/${name}/`);
  });

  handle('settings:get', () => store.getSettings());
  handle('settings:set', (key, value) => {
    store.setSetting(key, value);
    if (key === 'theme') applyTheme();
  });

  handle('data:info', () => {
    const backups = fs.existsSync(backupDir())
      ? fs.readdirSync(backupDir()).filter((f) => f.endsWith('.db')).sort()
      : [];
    return {
      dbFile: dbFile(),
      sizeBytes: fs.statSync(dbFile()).size,
      backupDir: backupDir(),
      lastAutoBackup: backups.at(-1) ?? null,
      version: app.getVersion(),
    };
  });

  handle('data:openFolder', () => shell.openPath(dataDir()));

  handle('data:backup', async () => {
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: 'Salvar um backup',
      defaultPath: path.join(app.getPath('documents'), `backup-terrarios-${today()}.db`),
      filters: [{ name: 'Backup do Terrarium Manager', extensions: ['db'] }],
    });
    if (canceled || !filePath) return null;
    await store.backupInBackground(filePath);
    return filePath;
  });

  handle('data:restore', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: 'Restaurar um backup',
      properties: ['openFile'],
      filters: [{ name: 'Backup do Terrarium Manager', extensions: ['db'] }],
    });
    if (canceled || !filePaths.length) return null;
    const source = filePaths[0];
    if (path.resolve(source) === path.resolve(dbFile())) {
      throw new Error('Esse é o banco de dados que o aplicativo já está usando.');
    }
    const { response } = await dialog.showMessageBox(win, {
      type: 'warning',
      buttons: ['Substituir meus dados', 'Cancelar'],
      defaultId: 1,
      cancelId: 1,
      title: 'Restaurar backup',
      message: 'Substituir tudo o que está no aplicativo por este backup?',
      detail: `${source}\n\nAntes disso, seus dados atuais serão salvos na pasta de backups, então dá para desfazer.`,
    });
    if (response !== 0) return null;
    fs.mkdirSync(backupDir(), { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    await store.restoreFrom(source, path.join(backupDir(), `before-restore-${stamp}.db`));
    applyTheme();
    return source;
  });

  // Importing the "Controle Terrários" spreadsheet takes two steps: the preview reads the
  // file and says what would be added; nothing is saved until the renderer confirms with
  // the preview's token. The plan waits here, so the renderer never hands back file paths.
  const importPlans = new Map();
  handle('data:importSheetPreview', async () => {
    checkNotImported(store);
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: 'Importar a planilha Controle Terrários',
      defaultPath: app.getPath('downloads'),
      properties: ['openFile'],
      filters: [{ name: 'Planilha do Excel', extensions: ['xlsx'] }],
    });
    if (canceled || !filePaths.length) return null;
    const plan = planImport(readXlsx(filePaths[0]));
    const token = String(Date.now());
    importPlans.clear();
    importPlans.set(token, plan);
    return {
      token,
      file: path.basename(filePaths[0]),
      summary: plan.summary,
      warnings: plan.warnings,
      existing: store.list().length,
      knownBuyers: plan.buyerNames.filter((name) => store.findBuyer(name)).length,
    };
  });

  handle('data:importSheetApply', async (token) => {
    const plan = importPlans.get(token);
    if (!plan) throw new Error('A prévia da importação expirou. Escolha a planilha de novo.');
    fs.mkdirSync(backupDir(), { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    await store.backupInBackground(path.join(backupDir(), `before-import-${stamp}.db`));
    applyImport(store, plan);
    importPlans.clear();
    return { summary: plan.summary, warnings: plan.warnings };
  });

  // Prints the catalog pages the renderer has placed in its print-only area (see exportPdf in
  // renderer/js/views/catalog.js). They're a copy of the live preview, so the PDF always
  // matches it page for page; the page size comes from the pages' CSS (@page).
  ipcMain.handle('catalog:export', async (event) => {
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: 'Salvar catálogo',
      defaultPath: path.join(app.getPath('documents'), `catalogo-terrarios-${today()}.pdf`),
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (canceled || !filePath) return null;
    const pdf = await event.sender.printToPDF({
      printBackground: true,
      preferCSSPageSize: true,
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
    });
    fs.writeFileSync(filePath, pdf);
    shell.openPath(filePath);
    return filePath;
  });
}

// Saves one copy of the database per day into the backups folder and keeps the newest few.
async function dailyBackup() {
  try {
    fs.mkdirSync(backupDir(), { recursive: true });
    // Copies left unfinished when the app was closed in the middle of a backup.
    for (const f of fs.readdirSync(backupDir())) if (f.endsWith('.partial')) fs.rmSync(path.join(backupDir(), f));
    const target = path.join(backupDir(), `terrariums-${today()}.db`);
    if (!fs.existsSync(target)) await store.backupInBackground(target);
    const daily = fs.readdirSync(backupDir()).filter((f) => /^terrariums-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort();
    for (const old of daily.slice(0, -DAILY_BACKUPS_KEPT)) fs.rmSync(path.join(backupDir(), old));
  } catch (err) {
    console.error('Daily backup failed:', err);
  }
}

app.on('window-all-closed', () => {
  store?.close();
  app.quit();
});
