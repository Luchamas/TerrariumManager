import { h, debounce } from '../ui.js';
import { money, date, plural, locale, compareText, getCurrency } from '../format.js';
import { jar } from '../photo.js';
import { onShelf } from '../state.js';
import { addDialog, showDetails } from '../terrarium.js';
import { compareSizes, sizeLabel } from '../sizes.js';

// Kept between visits so the shelf looks the way you left it.
const filters = { query: '', size: '', sort: 'newest' };

const SORTS = {
  newest: ['Mais recentes', (a, b) => (b.made_on ?? '').localeCompare(a.made_on ?? '') || b.id - a.id],
  oldest: ['Mais antigos', (a, b) => (a.made_on ?? '9').localeCompare(b.made_on ?? '9') || a.id - b.id],
  name: ['Nome', (a, b) => compareText(a.name, b.name)],
  priceHigh: ['Maior preço', (a, b) => (b.price_cents ?? -1) - (a.price_cents ?? -1)],
  priceLow: ['Menor preço', (a, b) => (a.price_cents ?? Infinity) - (b.price_cents ?? Infinity)],
};

export function mount(root) {
  const search = h('input', {
    type: 'search', class: 'search', placeholder: 'Buscar por nome, plantas, observações…', value: filters.query,
    'aria-label': 'Buscar na prateleira', dataset: { shortcut: 'search' },
  });
  const sizeSelect = h('select', { 'aria-label': 'Filtrar por tamanho' });
  const sortSelect = h('select', { 'aria-label': 'Ordenar' },
    Object.entries(SORTS).map(([key, [label]]) => h('option', { value: key }, label)));
  sortSelect.value = filters.sort;

  const summary = h('p', { class: 'view-summary' });
  const toolbar = h('div', { class: 'toolbar' }, search, sizeSelect, sortSelect);
  const grid = h('div', { class: 'shelf' });
  const catalogBtn = h('button', {
    type: 'button', class: 'btn', onclick: () => { location.hash = '#catalog'; },
    title: 'PDF com os terrários disponíveis, para enviar a clientes',
  }, 'Catálogo Rápido');

  // Cards are kept between updates, so searching and sorting only rearrange them and their
  // photos don't load again. A card is rebuilt when something it shows changes.
  const cards = new Map();
  const cardFor = (t) => {
    const key = [t.name, t.size, t.made_on, t.price_cents, t.photo_version, getCurrency()].join('\n');
    let entry = cards.get(t.id);
    if (entry?.key !== key) {
      entry = { key, el: card(t) };
      cards.set(t.id, entry);
    }
    return entry.el;
  };

  search.addEventListener('input', debounce(() => { filters.query = search.value; update(); }));
  sizeSelect.addEventListener('change', () => { filters.size = sizeSelect.value; update(); });
  sortSelect.addEventListener('change', () => { filters.sort = sortSelect.value; update(); });

  root.replaceChildren(
    h('header', { class: 'view-head' },
      h('div', {},
        h('h1', {}, 'Na prateleira'),
        summary,
      ),
      h('div', { class: 'head-actions' },
        catalogBtn,
        h('button', { type: 'button', class: 'btn btn-primary', onclick: addDialog, title: 'Ctrl+N' }, 'Adicionar terrário'),
      ),
    ),
    toolbar,
    grid,
  );

  function update() {
    const all = onShelf();
    const ids = new Set(all.map((t) => t.id));
    for (const id of cards.keys()) if (!ids.has(id)) cards.delete(id);
    toolbar.hidden = all.length === 0;
    catalogBtn.hidden = all.length === 0;

    const sizes = [...new Set(all.map((t) => t.size).filter(Boolean))].sort(compareSizes);
    if (filters.size && !sizes.includes(filters.size)) filters.size = '';
    sizeSelect.replaceChildren(
      h('option', { value: '' }, 'Todos os tamanhos'),
      ...sizes.map((s) => h('option', { value: s }, s)),
    );
    sizeSelect.value = filters.size;
    sizeSelect.hidden = sizes.length === 0;

    const worth = all.reduce((sum, t) => sum + (t.price_cents ?? 0), 0);
    summary.textContent = all.length
      ? `${plural(all.length, 'terrário', 'terrários')}, somando ${money(worth)} em preço pedido`
      : '';

    const q = filters.query.trim().toLocaleLowerCase(locale);
    const shown = all
      .filter((t) => !filters.size || t.size === filters.size)
      .filter((t) => !q || [t.name, t.size, t.container, t.description, t.plants, t.notes]
        .some((v) => v?.toLocaleLowerCase(locale).includes(q)))
      .sort(SORTS[filters.sort][1]);

    if (!all.length) {
      grid.replaceChildren(
        h('div', { class: 'empty' },
          h('h2', {}, 'Sua prateleira está vazia'),
          h('p', {}, 'Cadastre cada terrário que você fizer e marque como vendido quando ele ganhar um novo lar.'),
          h('button', { type: 'button', class: 'btn btn-primary', onclick: addDialog }, 'Adicionar o primeiro terrário'),
        ),
      );
      return;
    }
    if (!shown.length) {
      grid.replaceChildren(h('div', { class: 'empty' }, h('p', {}, 'Nada na prateleira corresponde a essa busca.')));
      return;
    }
    grid.replaceChildren(...shown.map(cardFor));
  }

  update();
  return { update };
}

function card(t) {
  return h('button', { type: 'button', class: 'specimen', onclick: () => showDetails(t.id) },
    jar(t),
    h('span', { class: 'specimen-name' }, t.name),
    h('span', { class: 'specimen-meta' }, [sizeLabel(t.size), t.made_on && date(t.made_on)].filter(Boolean).join(', ') || ' '),
    h('span', { class: 'specimen-price' }, t.price_cents != null ? money(t.price_cents) : 'Sem preço'),
  );
}
