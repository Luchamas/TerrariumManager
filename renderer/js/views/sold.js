import { h, debounce } from '../ui.js';
import { money, date, plural, monthName, locale } from '../format.js';
import { jar } from '../photo.js';
import { sold, profit } from '../state.js';
import { showDetails } from '../terrarium.js';
import { sizeLabel } from '../sizes.js';
import { sortHeader, sortRows, moreRows, ROWS_PER_PAGE } from '../table.js';

const filters = { query: '', year: '', month: '', sort: { key: 'sold_on', dir: -1 } };

const COLUMNS = [
  { key: 'sold_on', label: 'Vendido em', desc: true, value: (t) => t.sold_on ?? '' },
  { key: 'name', label: 'Terrário', value: (t) => t.name },
  { key: 'buyer', label: 'Comprador', value: (t) => t.buyer ?? '' },
  { key: 'cost', label: 'Custo', num: true, desc: true, value: (t) => t.cost_cents ?? -Infinity },
  { key: 'price', label: 'Valor da venda', num: true, desc: true, value: (t) => t.sold_price_cents ?? -Infinity },
  { key: 'profit', label: 'Lucro', num: true, desc: true, value: (t) => profit(t) ?? -Infinity },
];

export function mount(root) {
  const search = h('input', {
    type: 'search', class: 'search', placeholder: 'Buscar por nome ou comprador…', value: filters.query,
    'aria-label': 'Buscar vendas', dataset: { shortcut: 'search' },
  });
  const yearSelect = h('select', { 'aria-label': 'Ano' });
  const monthSelect = h('select', { 'aria-label': 'Mês' },
    h('option', { value: '' }, 'Todos os meses'),
    Array.from({ length: 12 }, (_, i) => h('option', { value: String(i + 1).padStart(2, '0') }, monthName(i))));
  monthSelect.value = filters.month;

  const toolbar = h('div', { class: 'toolbar' }, search, yearSelect, monthSelect);
  const totals = h('dl', { class: 'totals' });
  const table = h('table', { class: 'sales' });
  let limit = ROWS_PER_PAGE;
  const more = moreRows(() => { limit += ROWS_PER_PAGE; update(); }, ['venda', 'vendas']);
  const tableWrap = h('div', { class: 'table-wrap' }, table, more.el);
  const empty = h('div', { class: 'empty' },
    h('h2', {}, 'Nenhuma venda ainda'),
    h('p', {}, 'Quando vender um terrário, abra-o na prateleira e escolha “Marcar como vendido”.'));

  search.addEventListener('input', debounce(() => { filters.query = search.value; update(); }));
  yearSelect.addEventListener('change', () => { filters.year = yearSelect.value; update(); });
  monthSelect.addEventListener('change', () => { filters.month = monthSelect.value; update(); });

  root.replaceChildren(
    h('header', { class: 'view-head' }, h('div', {}, h('h1', {}, 'Vendidos'))),
    toolbar,
    totals,
    tableWrap,
    empty,
  );

  function update() {
    const all = sold();
    const hasSales = all.length > 0;
    for (const el of [toolbar, totals, tableWrap]) el.hidden = !hasSales;
    empty.hidden = hasSales;
    if (!hasSales) return;

    const years = [...new Set(all.map((t) => t.sold_on?.slice(0, 4)).filter(Boolean))].sort().reverse();
    if (filters.year && !years.includes(filters.year)) filters.year = '';
    yearSelect.replaceChildren(h('option', { value: '' }, 'Todos os anos'), ...years.map((y) => h('option', { value: y }, y)));
    yearSelect.value = filters.year;

    const q = filters.query.trim().toLocaleLowerCase(locale);
    const shown = sortRows(
      all
        .filter((t) => !filters.year || t.sold_on?.startsWith(filters.year))
        .filter((t) => !filters.month || t.sold_on?.slice(5, 7) === filters.month)
        .filter((t) => !q || [t.name, t.buyer, t.size].some((v) => v?.toLocaleLowerCase(locale).includes(q))),
      COLUMNS, filters.sort,
    );

    const revenue = shown.reduce((sum, t) => sum + (t.sold_price_cents ?? 0), 0);
    const profits = shown.map(profit).filter((p) => p != null);
    const totalProfit = profits.reduce((sum, p) => sum + p, 0);
    totals.replaceChildren(
      h('div', {}, h('dt', {}, 'Vendidos'), h('dd', {}, shown.length.toLocaleString(locale))),
      h('div', {}, h('dt', {}, 'Faturamento'), h('dd', {}, money(revenue))),
      h('div', {}, h('dt', {}, 'Lucro'), h('dd', {}, profits.length ? money(totalProfit) : '–')),
      shown.length ? h('div', {}, h('dt', {}, 'Venda média'), h('dd', {}, money(Math.round(revenue / shown.length)))) : null,
    );
    totals.title = profits.length < shown.length
      ? `O lucro só considera ${plural(profits.length, 'venda', 'vendas')} com custo do material preenchido.`
      : '';

    const rows = shown.slice(0, limit).map((t) => {
      const p = profit(t);
      const row = h('tr', { tabindex: 0, onclick: () => showDetails(t.id) },
        h('td', { class: 'nowrap' }, date(t.sold_on)),
        h('td', {}, h('span', { class: 'row-name' },
          jar(t, { size: 'jar-tiny' }),
          h('span', {}, t.name, t.size ? h('small', {}, sizeLabel(t.size)) : null))),
        h('td', {}, t.buyer ?? ''),
        h('td', { class: 'num' }, money(t.cost_cents)),
        h('td', { class: 'num strong' }, money(t.sold_price_cents)),
        h('td', { class: p != null && p < 0 ? 'num loss' : 'num' }, p == null ? '–' : money(p)),
      );
      row.addEventListener('keydown', (e) => { if (e.key === 'Enter') showDetails(t.id); });
      return row;
    });

    table.replaceChildren(
      h('thead', {}, sortHeader(COLUMNS, filters.sort, update)),
      h('tbody', {}, rows.length
        ? rows
        : h('tr', {}, h('td', { colspan: COLUMNS.length, class: 'no-match' }, 'Nenhuma venda corresponde a esses filtros.'))),
    );
    more.update(rows.length, shown.length);
  }

  update();
  return { update };
}
