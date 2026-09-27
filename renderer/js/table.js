// Sortable tables. `columns` are { key, label, value(row), num?, desc? }; `sort` is
// { key, dir } and is updated in place when a header is clicked.
import { h } from './ui.js';
import { compareText, plural, locale } from './format.js';

// Long tables show this many rows, with a button for more: laying out hundreds of rows
// at once takes a moment on modest computers, and the first rows are usually what's wanted.
export const ROWS_PER_PAGE = 100;

// "Mostrando 100 de 240" and a button that shows the next rows. Hidden when all rows show.
export function moreRows(onMore, [one, many]) {
  const note = h('span', { class: 'muted' });
  const button = h('button', { type: 'button', class: 'btn btn-small', onclick: onMore });
  const el = h('div', { class: 'table-more' }, note, button);
  return {
    el,
    update(showing, total) {
      el.hidden = showing >= total;
      note.textContent = `Mostrando ${showing.toLocaleString(locale)} de ${total.toLocaleString(locale)}`;
      button.textContent = `Mostrar mais ${plural(Math.min(ROWS_PER_PAGE, total - showing), one, many)}`;
    },
  };
}

export function sortHeader(columns, sort, onSort) {
  return h('tr', {}, columns.map((c) => {
    const active = c.key === sort.key;
    return h('th', {
      scope: 'col',
      class: c.num ? 'num' : null,
      'aria-sort': active ? (sort.dir > 0 ? 'ascending' : 'descending') : null,
    }, h('button', {
      type: 'button', class: 'th-sort', onclick: () => {
        if (active) sort.dir *= -1;
        else { sort.key = c.key; sort.dir = c.desc ? -1 : 1; } // numbers and dates start biggest/newest first
        onSort();
      },
    }, c.label, h('span', { class: 'sort-mark', 'aria-hidden': 'true' }, active ? (sort.dir > 0 ? '▲' : '▼') : '')));
  }));
}

export function sortRows(rows, columns, sort) {
  const col = columns.find((c) => c.key === sort.key);
  return rows.sort((a, b) => {
    const va = col.value(a);
    const vb = col.value(b);
    const cmp = col.num ? va - vb : compareText(String(va), String(vb));
    return cmp * sort.dir || b.id - a.id;
  });
}
