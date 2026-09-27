import { h, debounce } from '../ui.js';
import { money, date, plural, locale } from '../format.js';
import { state, lotCost, lotStock, lotLabel } from '../state.js';
import { showLot, purchaseDialog } from '../jar-lot.js';
import { compareContainers } from '../containers.js';
import { sortHeader, sortRows, moreRows, ROWS_PER_PAGE } from '../table.js';

// Kept between visits.
const filters = { query: '', collection: '', inStock: false, sort: { key: 'bought_on', dir: -1 } };

const COLUMNS = [
  { key: 'collection', label: 'Coleção', value: (l) => l.collection ?? '' },
  { key: 'jar', label: 'Frasco', value: (l) => lotLabel(l) },
  { key: 'supplier', label: 'Fornecedor', value: (l) => l.supplier ?? '' },
  { key: 'bought_on', label: 'Comprado em', desc: true, value: (l) => l.bought_on ?? '' },
  { key: 'quantity', label: 'Qtd', num: true, desc: true, value: (l) => l.quantity },
  { key: 'stock', label: 'Em estoque', num: true, desc: true, value: (l) => lotStock(l) },
  { key: 'cost', label: 'Custo/un', num: true, desc: true, value: (l) => lotCost(l) ?? -Infinity },
  { key: 'price', label: 'Preço sugerido', num: true, desc: true, value: (l) => l.price_cents ?? -Infinity },
];

export function mount(root) {
  const search = h('input', {
    type: 'search', class: 'search', placeholder: 'Buscar por frasco, fornecedor, coleção…', value: filters.query,
    'aria-label': 'Buscar frascos', dataset: { shortcut: 'search' },
  });
  const collectionSelect = h('select', { 'aria-label': 'Filtrar por coleção' });
  const stockToggle = h('input', { type: 'checkbox', checked: filters.inStock });
  const summary = h('p', { class: 'view-summary' });
  const toolbar = h('div', { class: 'toolbar' }, search, collectionSelect,
    h('label', { class: 'check check-compact toolbar-check' }, stockToggle, ' Só com estoque'));
  const table = h('table', { class: 'sales jars' });
  let limit = ROWS_PER_PAGE;
  const more = moreRows(() => { limit += ROWS_PER_PAGE; update(); }, ['lote', 'lotes']);
  const tableWrap = h('div', { class: 'table-wrap' }, table, more.el);
  const empty = h('div', { class: 'empty' },
    h('h2', {}, 'Nenhum frasco no estoque'),
    h('p', {}, 'Registre cada compra de frascos: o que custou cada um, com a tampa e o frete. '
      + 'Ao montar um terrário, escolha o frasco e o estoque diminui sozinho.'),
    h('button', { type: 'button', class: 'btn btn-primary', onclick: purchaseDialog }, 'Registrar a primeira compra'));

  search.addEventListener('input', debounce(() => { filters.query = search.value; update(); }));
  collectionSelect.addEventListener('change', () => { filters.collection = collectionSelect.value; update(); });
  stockToggle.addEventListener('change', () => { filters.inStock = stockToggle.checked; update(); });

  root.replaceChildren(
    h('header', { class: 'view-head' },
      h('div', {}, h('h1', {}, 'Frascos'), summary),
      h('div', { class: 'head-actions' },
        h('button', { type: 'button', class: 'btn btn-primary', onclick: purchaseDialog }, 'Registrar compra'),
      ),
    ),
    toolbar,
    tableWrap,
    empty,
  );

  function update() {
    const all = state.lots;
    const hasLots = all.length > 0;
    for (const el of [toolbar, tableWrap, summary]) el.hidden = !hasLots;
    empty.hidden = hasLots;
    if (!hasLots) return;

    const inStock = all.reduce((sum, l) => sum + Math.max(0, lotStock(l)), 0);
    const stockValue = all.reduce((sum, l) => sum + Math.max(0, lotStock(l)) * (lotCost(l) ?? 0), 0);
    summary.textContent = `${plural(inStock, 'frasco em estoque', 'frascos em estoque')}, `
      + `que custaram ${money(stockValue)} · ${plural(all.length, 'lote comprado', 'lotes comprados')}`;

    const collections = [...new Set(all.map((l) => l.collection).filter(Boolean))].sort(compareContainers);
    if (filters.collection && !collections.includes(filters.collection)) filters.collection = '';
    collectionSelect.replaceChildren(
      h('option', { value: '' }, 'Todas as coleções'),
      ...collections.map((c) => h('option', { value: c }, c)),
    );
    collectionSelect.value = filters.collection;
    collectionSelect.hidden = collections.length === 0;

    const q = filters.query.trim().toLocaleLowerCase(locale);
    const shown = sortRows(
      all
        .filter((l) => !filters.collection || l.collection === filters.collection)
        .filter((l) => !filters.inStock || lotStock(l) > 0)
        .filter((l) => !q || [lotLabel(l), l.supplier, l.collection, l.lid, l.glass, l.description, l.notes]
          .some((v) => v?.toLocaleLowerCase(locale).includes(q))),
      COLUMNS, filters.sort,
    );

    const rows = shown.slice(0, limit).map((l) => {
      const stock = lotStock(l);
      const row = h('tr', { tabindex: 0, onclick: () => showLot(l.id) },
        h('td', {}, l.collection ?? h('span', { class: 'muted' }, '–')),
        h('td', {}, h('span', { class: 'lot-name' }, lotLabel(l), l.lid ? h('small', {}, `Tampa: ${l.lid}`) : null)),
        h('td', {}, l.supplier ?? ''),
        h('td', { class: 'nowrap' }, date(l.bought_on)),
        h('td', { class: 'num' }, l.quantity),
        h('td', { class: 'num' }, stock > 0 ? h('span', { class: 'stock-pill' }, stock) : h('span', { class: 'muted' }, '0')),
        h('td', { class: 'num' }, money(lotCost(l))),
        h('td', { class: 'num strong' }, money(l.price_cents)),
      );
      row.addEventListener('keydown', (e) => { if (e.key === 'Enter') showLot(l.id); });
      return row;
    });

    table.replaceChildren(
      h('thead', {}, sortHeader(COLUMNS, filters.sort, update)),
      h('tbody', {}, rows.length
        ? rows
        : h('tr', {}, h('td', { colspan: COLUMNS.length, class: 'no-match' }, 'Nenhum lote corresponde a esses filtros.'))),
    );
    more.update(rows.length, shown.length);
  }

  update();
  return { update };
}
