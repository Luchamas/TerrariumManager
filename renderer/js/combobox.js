// Text field with a dropdown of suggestions. Typing filters them; any other text is fine too.
// Used instead of <datalist>, whose popup can't be styled and can run off the screen.
import { h, s } from './ui.js';

const MAX_HEIGHT = 300; // the list scrolls past this
const GAP = 4;          // between the field and the list
const MARGIN = 8;       // kept free at the window edges

// Case and accents don't matter when matching: "cupula" finds "Cúpula".
const fold = (text) => text.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase().trim();

let seq = 0;

// Wraps `input` with a dropdown button and a list of `options`: strings, or { value, label }
// with the label shown dimmed beside the value (e.g. a buyer's phone).
// Picking an option fires an input event, as typing it would.
export function combobox(input, options) {
  const items = options.map((o) => (typeof o === 'string' ? { value: o } : o));
  const listId = `combo-${++seq}`;
  // A popover sits above everything, so the list is never clipped by a scrolling dialog.
  const list = h('ul', { id: listId, class: 'combo-list', role: 'listbox', popover: 'manual' });
  const toggle = items.length
    ? h('button', { type: 'button', class: 'combo-toggle', tabIndex: -1, 'aria-label': 'Mostrar opções' },
        s('svg', { viewBox: '0 0 12 12', 'aria-hidden': 'true' },
          s('path', { d: 'M2.5 4.5 6 8l3.5-3.5', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })))
    : null;
  const box = h('div', { class: 'combo' }, input, toggle, list);

  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-expanded', 'false');
  input.setAttribute('aria-controls', listId);

  let shown = [];  // items in the open list
  let active = -1; // highlighted index in `shown`

  const isOpen = () => list.matches(':popover-open');

  // While typing: only what matches. Otherwise everything, unless the text narrows it down.
  function matches(typing) {
    const q = fold(input.value);
    if (!q) return items;
    const hits = items.filter((it) => fold(`${it.value} ${it.label ?? ''}`).includes(q));
    const exact = hits.some((it) => fold(it.value) === q);
    if (typing) return exact && hits.length === 1 ? [] : hits;
    return exact || !hits.length ? items : hits;
  }

  function open(typing) {
    shown = matches(typing);
    if (!shown.length) return close();
    const current = fold(input.value);
    list.replaceChildren(...shown.map((it, i) =>
      h('li', {
        id: `${listId}-${i}`, role: 'option', 'aria-selected': 'false', dataset: { i },
        class: fold(it.value) === current ? 'combo-option current' : 'combo-option',
      }, h('span', {}, it.value), it.label ? h('small', {}, it.label) : null)));
    if (!isOpen()) {
      list.showPopover();
      input.setAttribute('aria-expanded', 'true');
      addEventListener('scroll', place, true);
      addEventListener('resize', place);
    }
    list.scrollTop = 0;
    place();
    highlight(typing ? -1 : shown.findIndex((it) => fold(it.value) === current));
  }

  function close() {
    removeEventListener('scroll', place, true);
    removeEventListener('resize', place);
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    active = -1;
    if (isOpen()) list.hidePopover();
  }

  // Below the field, or above it when there's more room there. At least as wide as the
  // field, and a bit wider if the options need it.
  function place() {
    if (!box.isConnected) return close();
    const r = box.getBoundingClientRect();
    const below = innerHeight - r.bottom - GAP - MARGIN;
    const above = r.top - GAP - MARGIN;
    const up = below < Math.min(list.scrollHeight, MAX_HEIGHT) && above > below;
    Object.assign(list.style, {
      left: `${r.left}px`,
      minWidth: `${r.width}px`,
      maxWidth: `${Math.max(r.width, Math.min(r.width * 1.5, innerWidth - r.left - MARGIN))}px`,
      maxHeight: `${Math.min(MAX_HEIGHT, up ? above : below)}px`,
      top: up ? 'auto' : `${r.bottom + GAP}px`,
      bottom: up ? `${innerHeight - r.top + GAP}px` : 'auto',
    });
  }

  function highlight(i, scroll = true) {
    list.children[active]?.setAttribute('aria-selected', 'false');
    active = i;
    const el = list.children[i];
    if (!el) return input.removeAttribute('aria-activedescendant');
    el.setAttribute('aria-selected', 'true');
    input.setAttribute('aria-activedescendant', el.id);
    if (!scroll) return;
    const pad = parseFloat(getComputedStyle(list).paddingTop);
    if (el.offsetTop - pad < list.scrollTop) list.scrollTop = el.offsetTop - pad;
    else if (el.offsetTop + el.offsetHeight + pad > list.scrollTop + list.clientHeight) {
      list.scrollTop = el.offsetTop + el.offsetHeight + pad - list.clientHeight;
    }
  }

  function pick(i) {
    input.value = shown[i].value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    close();
  }

  // Only real typing opens the list, not the input event fired by pick().
  input.addEventListener('input', (e) => { if (e.isTrusted) open(true); });
  input.addEventListener('click', () => { if (!isOpen()) open(false); });
  input.addEventListener('blur', close);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!isOpen()) open(false);
      else highlight(Math.min(active + 1, shown.length - 1));
    } else if (e.key === 'ArrowUp' && isOpen()) {
      e.preventDefault();
      highlight(active === -1 ? shown.length - 1 : Math.max(active - 1, 0));
    } else if (e.key === 'Enter' && isOpen()) {
      if (active === -1) return close(); // let the form submit
      e.preventDefault();
      pick(active);
    } else if (e.key === 'Escape' && isOpen()) {
      e.preventDefault(); // close only the list, not the dialog
      close();
    }
  });

  // Clicking the button or the list keeps the focus in the field.
  toggle?.addEventListener('mousedown', (e) => e.preventDefault());
  toggle?.addEventListener('click', () => {
    if (isOpen()) return close();
    input.focus();
    open(false);
  });
  list.addEventListener('mousedown', (e) => e.preventDefault());
  list.addEventListener('click', (e) => {
    const li = e.target.closest('li');
    if (li) pick(Number(li.dataset.i));
  });
  list.addEventListener('mousemove', (e) => {
    const li = e.target.closest('li');
    if (li && Number(li.dataset.i) !== active) highlight(Number(li.dataset.i), false);
  });

  return box;
}
