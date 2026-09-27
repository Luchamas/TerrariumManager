import { state, reload, onChange, onShelf, sold, lotStock } from './state.js';
import { setCurrency, guessCurrency } from './format.js';
import { showError } from './ui.js';
import { addDialog } from './terrarium.js';
import * as shelfView from './views/shelf.js';
import * as jarsView from './views/jars.js';
import * as soldView from './views/sold.js';
import * as buyersView from './views/buyers.js';
import * as catalogView from './views/catalog.js';
import * as overviewView from './views/overview.js';
import * as settingsView from './views/settings.js';

const VIEWS = {
  shelf: shelfView,
  jars: jarsView,
  sold: soldView,
  buyers: buyersView,
  catalog: catalogView,
  overview: overviewView,
  settings: settingsView,
};

const root = document.getElementById('view');
let current = null;

function route() {
  const name = location.hash.slice(1) in VIEWS ? location.hash.slice(1) : 'shelf';
  current?.destroy?.();
  current = VIEWS[name].mount(root);
  root.scrollTop = 0;
  for (const link of document.querySelectorAll('.nav a')) {
    if (link.dataset.view === name) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
}

function updateCounts() {
  document.querySelector('[data-count=shelf]').textContent = onShelf().length || '';
  document.querySelector('[data-count=jars]').textContent = state.lots.reduce((sum, l) => sum + Math.max(0, lotStock(l)), 0) || '';
  document.querySelector('[data-count=sold]').textContent = sold().length || '';
  document.querySelector('[data-count=buyers]').textContent = state.buyers.length || '';
}

async function boot() {
  state.settings = await window.api.settings.get();
  if (!state.settings.currency) {
    state.settings.currency = guessCurrency();
    await window.api.settings.set('currency', state.settings.currency);
  }
  setCurrency(state.settings.currency);

  onChange(() => {
    updateCounts();
    current?.update();
  });
  await reload();
  window.addEventListener('hashchange', route);
  route();
}

document.addEventListener('keydown', (e) => {
  if (document.querySelector('dialog[open]')) return;
  const key = e.key.toLowerCase();
  if (e.ctrlKey && key === 'n') {
    e.preventDefault();
    addDialog();
  } else if (e.ctrlKey && key === 'f') {
    const search = root.querySelector('[data-shortcut=search]');
    if (search && !search.closest('[hidden]')) {
      e.preventDefault();
      search.focus();
      search.select();
    }
  }
});

window.addEventListener('unhandledrejection', (e) => showError(e.reason));

boot().catch(showError);
