import { h, debounce } from '../ui.js';
import { money, date, formatPhone, plural, locale, instagramLabel } from '../format.js';
import { buyerList } from '../state.js';
import { showBuyer } from '../buyer.js';
import { sortHeader, sortRows, moreRows, ROWS_PER_PAGE } from '../table.js';

const filters = { query: '', sort: { key: 'last', dir: -1 } };

const COLUMNS = [
  { key: 'name', label: 'Nome', value: (b) => b.name },
  { key: 'phone', label: 'Celular', value: (b) => b.phone ?? '' },
  { key: 'instagram', label: 'Instagram', value: (b) => b.instagram ?? '' },
  { key: 'count', label: 'Compras', num: true, desc: true, value: (b) => b.purchases.length },
  { key: 'total', label: 'Total gasto', num: true, desc: true, value: (b) => b.total },
  { key: 'last', label: 'Última compra', desc: true, value: (b) => b.last ?? '' },
];

export function mount(root) {
  const search = h('input', {
    type: 'search', class: 'search', placeholder: 'Buscar por nome, celular ou Instagram…', value: filters.query,
    'aria-label': 'Buscar compradores', dataset: { shortcut: 'search' },
  });
  const summary = h('p', { class: 'view-summary' });
  const toolbar = h('div', { class: 'toolbar' }, search);
  const table = h('table', { class: 'sales' });
  let limit = ROWS_PER_PAGE;
  const more = moreRows(() => { limit += ROWS_PER_PAGE; update(); }, ['comprador', 'compradores']);
  const tableWrap = h('div', { class: 'table-wrap' }, table, more.el);
  const empty = h('div', { class: 'empty' },
    h('h2', {}, 'Nenhum comprador ainda'),
    h('p', {}, 'Ao marcar um terrário como vendido, informe o nome e o celular de quem comprou. A pessoa aparece aqui.'));

  search.addEventListener('input', debounce(() => { filters.query = search.value; update(); }));

  root.replaceChildren(
    h('header', { class: 'view-head' }, h('div', {}, h('h1', {}, 'Compradores'), summary)),
    toolbar,
    tableWrap,
    empty,
  );

  function update() {
    const all = buyerList();
    const hasBuyers = all.length > 0;
    for (const el of [toolbar, tableWrap, summary]) el.hidden = !hasBuyers;
    empty.hidden = hasBuyers;
    if (!hasBuyers) return;

    const repeat = all.filter((b) => b.purchases.length > 1).length;
    summary.textContent = `${plural(all.length, 'comprador', 'compradores')}`
      + (repeat ? `, ${plural(repeat, 'comprou', 'compraram')} mais de uma vez` : '');

    const q = filters.query.trim().toLocaleLowerCase(locale);
    const qDigits = q.replace(/\D/g, '');
    const shown = sortRows(
      all.filter((b) => !q
        || b.name.toLocaleLowerCase(locale).includes(q)
        || b.instagram?.toLocaleLowerCase(locale).includes(q.replace(/^@/, ''))
        || (qDigits && b.phone?.includes(qDigits))),
      COLUMNS, filters.sort,
    );

    const rows = shown.slice(0, limit).map((b) => {
      const row = h('tr', { tabindex: 0, onclick: () => showBuyer(b.id) },
        h('td', {}, h('span', { class: 'buyer-name' }, b.name)),
        h('td', { class: 'nowrap' }, b.phone ? formatPhone(b.phone) : h('span', { class: 'muted' }, '–')),
        h('td', {}, b.instagram ? instagramLabel(b.instagram) : h('span', { class: 'muted' }, '–')),
        h('td', { class: 'num' }, b.purchases.length),
        h('td', { class: 'num strong' }, b.purchases.length ? money(b.total) : '–'),
        h('td', { class: 'nowrap' }, b.last ? date(b.last) : h('span', { class: 'muted' }, 'Nenhuma compra')),
      );
      row.addEventListener('keydown', (e) => { if (e.key === 'Enter') showBuyer(b.id); });
      return row;
    });

    table.replaceChildren(
      h('thead', {}, sortHeader(COLUMNS, filters.sort, update)),
      h('tbody', {}, rows.length
        ? rows
        : h('tr', {}, h('td', { colspan: COLUMNS.length, class: 'no-match' }, 'Nenhum comprador corresponde a essa busca.'))),
    );
    more.update(rows.length, shown.length);
  }

  update();
  return { update };
}
