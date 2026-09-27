import { h, debounce } from '../ui.js';
import { money, date, plural, monthName, locale } from '../format.js';
import { jar } from '../photo.js';
import { sold, donated, lost, profit } from '../state.js';
import { showDetails } from '../terrarium.js';
import { sizeLabel } from '../sizes.js';
import { sortHeader, sortRows, moreRows, ROWS_PER_PAGE } from '../table.js';

const filters = { tab: 'sold', query: '', year: '', month: '', channel: '', sort: { key: 'sold_on', dir: -1 } };

// Filters by "De onde veio a venda"; this value picks the ones where it wasn't filled in.
const NO_CHANNEL = '\u0000';
const channelColumn = { key: 'channel', label: 'Origem', value: (t) => t.channel ?? '' };
const channelCell = (t) => h('td', {}, t.channel ?? h('span', { class: 'muted' }, '–'));

const dateColumn = (label) => ({ key: 'sold_on', label, desc: true, value: (t) => t.sold_on ?? '' });
const nameColumn = { key: 'name', label: 'Terrário', value: (t) => t.name };
const costColumn = (label) => ({ key: 'cost', label, num: true, desc: true, value: (t) => t.cost_cents ?? -Infinity });

// Terrariums that left the shelf, one tab per way they left.
const TABS = {
  sold: {
    label: 'Vendas',
    list: sold,
    columns: [
      dateColumn('Vendido em'),
      nameColumn,
      { key: 'buyer', label: 'Comprador', value: (t) => t.buyer ?? '' },
      channelColumn,
      costColumn('Custo'),
      { key: 'price', label: 'Valor da venda', num: true, desc: true, value: (t) => t.sold_price_cents ?? -Infinity },
      { key: 'profit', label: 'Lucro', num: true, desc: true, value: (t) => profit(t) ?? -Infinity },
    ],
    cells: (t) => {
      const p = profit(t);
      return [
        h('td', {}, t.buyer ?? ''),
        channelCell(t),
        h('td', { class: 'num' }, money(t.cost_cents)),
        h('td', { class: 'num strong' }, money(t.sold_price_cents)),
        h('td', { class: p != null && p < 0 ? 'num loss' : 'num' }, p == null ? '–' : money(p)),
      ];
    },
    totals(shown) {
      const revenue = shown.reduce((sum, t) => sum + (t.sold_price_cents ?? 0), 0);
      const profits = shown.map(profit).filter((p) => p != null);
      return {
        figures: [
          ['Vendidos', shown.length.toLocaleString(locale)],
          ['Faturamento', money(revenue)],
          ['Lucro', profits.length ? money(profits.reduce((sum, p) => sum + p, 0)) : '–'],
          shown.length ? ['Venda média', money(Math.round(revenue / shown.length))] : null,
        ],
        note: profits.length < shown.length
          ? `O lucro só considera ${plural(profits.length, 'venda', 'vendas')} com custo do material preenchido.`
          : '',
      };
    },
    search: (t) => [t.code, t.name, t.buyer, t.size, t.channel],
    byChannel: true,
    empty: ['Nenhuma venda ainda', 'Quando vender um terrário, abra-o na prateleira e escolha “Marcar como vendido”.'],
    noun: ['venda', 'vendas'],
  },
  donated: {
    label: 'Cortesias',
    list: donated,
    columns: [
      dateColumn('Doado em'),
      nameColumn,
      { key: 'buyer', label: 'Para quem', value: (t) => t.buyer ?? '' },
      channelColumn,
      costColumn('Custo do material'),
      { key: 'notes', label: 'Motivo', value: (t) => t.sale_notes ?? '' },
    ],
    cells: (t) => [
      h('td', {}, t.buyer ?? ''),
      channelCell(t),
      h('td', { class: 'num' }, money(t.cost_cents)),
      h('td', { class: 'notes-cell' }, t.sale_notes ?? ''),
    ],
    totals: (shown) => ({
      figures: [
        ['Cortesias', shown.length.toLocaleString(locale)],
        ['Custo em material', money(shown.reduce((sum, t) => sum + (t.cost_cents ?? 0), 0))],
      ],
      note: 'Terrários dados de presente, para publicidade ou para agradar um cliente.',
    }),
    search: (t) => [t.code, t.name, t.buyer, t.channel, t.sale_notes],
    byChannel: true,
    empty: ['Nenhuma cortesia', 'Para registrar um terrário dado de presente ou para publicidade, abra-o na prateleira e escolha “Doar”.'],
    noun: ['cortesia', 'cortesias'],
  },
  lost: {
    label: 'Perdas',
    list: lost,
    columns: [
      dateColumn('Data da perda'),
      nameColumn,
      costColumn('Custo perdido'),
      { key: 'notes', label: 'Motivo', value: (t) => t.sale_notes ?? '' },
    ],
    cells: (t) => [
      h('td', { class: 'num' }, money(t.cost_cents)),
      h('td', { class: 'notes-cell' }, t.sale_notes ?? ''),
    ],
    totals: (shown) => ({
      figures: [
        ['Perdas', shown.length.toLocaleString(locale)],
        ['Custo perdido', money(shown.reduce((sum, t) => sum + (t.cost_cents ?? 0), 0))],
      ],
      note: 'Terrários que morreram ou quebraram.',
    }),
    search: (t) => [t.code, t.name, t.sale_notes],
    empty: ['Nenhuma perda', 'Se um terrário morrer ou quebrar, abra-o na prateleira e escolha “Registrar perda”.'],
    noun: ['perda', 'perdas'],
  },
};

export function mount(root) {
  const search = h('input', {
    type: 'search', class: 'search', value: filters.query, dataset: { shortcut: 'search' },
  });
  const yearSelect = h('select', { 'aria-label': 'Ano' });
  const monthSelect = h('select', { 'aria-label': 'Mês' },
    h('option', { value: '' }, 'Todos os meses'),
    Array.from({ length: 12 }, (_, i) => h('option', { value: String(i + 1).padStart(2, '0') }, monthName(i))));
  monthSelect.value = filters.month;

  const tabs = h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Tipo de saída' });
  const channelSelect = h('select', { 'aria-label': 'De onde veio a venda' });
  const toolbar = h('div', { class: 'toolbar' }, search, yearSelect, monthSelect, channelSelect);
  const totals = h('dl', { class: 'totals' });
  const table = h('table', { class: 'sales' });
  let limit = ROWS_PER_PAGE;
  const more = moreRows(() => { limit += ROWS_PER_PAGE; update(); }, ['linha', 'linhas']);
  const tableWrap = h('div', { class: 'table-wrap' }, table, more.el);
  const empty = h('div', { class: 'empty' });

  search.addEventListener('input', debounce(() => { filters.query = search.value; update(); }));
  yearSelect.addEventListener('change', () => { filters.year = yearSelect.value; update(); });
  channelSelect.addEventListener('change', () => { filters.channel = channelSelect.value; update(); });
  monthSelect.addEventListener('change', () => { filters.month = monthSelect.value; update(); });

  root.replaceChildren(
    h('header', { class: 'view-head' }, h('div', {}, h('h1', {}, 'Vendidos'))),
    tabs,
    toolbar,
    totals,
    tableWrap,
    empty,
  );

  function update() {
    // The tabs only show once something was given away or lost.
    const counts = Object.fromEntries(Object.entries(TABS).map(([key, tab]) => [key, tab.list().length]));
    const showTabs = counts.donated > 0 || counts.lost > 0;
    if (!showTabs) filters.tab = 'sold';
    tabs.hidden = !showTabs;
    tabs.replaceChildren(...Object.entries(TABS).map(([key, tab]) => h('button', {
      type: 'button', role: 'tab', class: 'tab', 'aria-selected': String(key === filters.tab),
      onclick: () => {
        if (filters.tab === key) return;
        filters.tab = key;
        limit = ROWS_PER_PAGE;
        update();
      },
    }, tab.label, h('span', { class: 'tab-count' }, counts[key]))));

    const tab = TABS[filters.tab];
    const all = tab.list();
    const hasRows = all.length > 0;
    for (const el of [toolbar, totals, tableWrap]) el.hidden = !hasRows;
    empty.hidden = hasRows;
    if (!hasRows) {
      empty.replaceChildren(h('h2', {}, tab.empty[0]), h('p', {}, tab.empty[1]));
      return;
    }
    search.placeholder = filters.tab === 'lost' ? 'Buscar por nome ou motivo…' : `Buscar por nome ou ${filters.tab === 'sold' ? 'comprador' : 'pessoa'}…`;
    search.setAttribute('aria-label', `Buscar ${tab.noun[1]}`);

    // Where they came from, the most common first.
    const perChannel = new Map();
    for (const t of all) if (t.channel) perChannel.set(t.channel, (perChannel.get(t.channel) ?? 0) + 1);
    const channels = [...perChannel.keys()].sort((a, b) => perChannel.get(b) - perChannel.get(a) || a.localeCompare(b, 'pt-BR'));
    if (!tab.byChannel || (filters.channel && filters.channel !== NO_CHANNEL && !perChannel.has(filters.channel))) filters.channel = '';
    channelSelect.replaceChildren(
      h('option', { value: '' }, 'Todas as origens'),
      ...channels.map((c) => h('option', { value: c }, `${c} (${perChannel.get(c)})`)),
      h('option', { value: NO_CHANNEL }, 'Sem origem informada'),
    );
    channelSelect.value = filters.channel;
    channelSelect.hidden = !tab.byChannel || channels.length === 0;

    const years = [...new Set(all.map((t) => t.sold_on?.slice(0, 4)).filter(Boolean))].sort().reverse();
    if (filters.year && !years.includes(filters.year)) filters.year = '';
    yearSelect.replaceChildren(h('option', { value: '' }, 'Todos os anos'), ...years.map((y) => h('option', { value: y }, y)));
    yearSelect.value = filters.year;

    const columns = tab.columns;
    if (!columns.some((c) => c.key === filters.sort.key)) Object.assign(filters.sort, { key: 'sold_on', dir: -1 });
    const q = filters.query.trim().toLocaleLowerCase(locale);
    const shown = sortRows(
      all
        .filter((t) => !filters.year || t.sold_on?.startsWith(filters.year))
        .filter((t) => !filters.month || t.sold_on?.slice(5, 7) === filters.month)
        .filter((t) => !filters.channel || (filters.channel === NO_CHANNEL ? !t.channel : t.channel === filters.channel))
        .filter((t) => !q || tab.search(t).some((v) => v?.toLocaleLowerCase(locale).includes(q))),
      columns, filters.sort,
    );

    const { figures, note } = tab.totals(shown);
    totals.replaceChildren(...figures.filter(Boolean).map(([label, value]) => h('div', {}, h('dt', {}, label), h('dd', {}, value))));
    totals.title = note;

    const rows = shown.slice(0, limit).map((t) => {
      const row = h('tr', { tabindex: 0, onclick: () => showDetails(t.id) },
        h('td', { class: 'nowrap' }, date(t.sold_on),
          t.delivered_on
            ? h('small', { class: 'cell-sub' }, t.delivered_on === t.sold_on ? 'Entregue no dia' : `Entregue ${date(t.delivered_on)}`)
            : null),
        h('td', {}, h('span', { class: 'row-name' },
          jar(t, { size: 'jar-tiny' }),
          h('span', {}, t.name, t.code || t.size ? h('small', {}, [t.code, sizeLabel(t.size)].filter(Boolean).join(' · ')) : null))),
        tab.cells(t),
      );
      row.addEventListener('keydown', (e) => { if (e.key === 'Enter') showDetails(t.id); });
      return row;
    });

    table.replaceChildren(
      h('thead', {}, sortHeader(columns, filters.sort, update)),
      h('tbody', {}, rows.length
        ? rows
        : h('tr', {}, h('td', { colspan: columns.length, class: 'no-match' }, `Nenhuma ${tab.noun[0]} corresponde a esses filtros.`))),
    );
    more.update(rows.length, shown.length);
  }

  update();
  return { update };
}
