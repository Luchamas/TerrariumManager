import { h, debounce, openDialog } from '../ui.js';
import { money, date, plural, locale, compareText, getCurrency } from '../format.js';
import { jar } from '../photo.js';
import { state, onShelf, lotLabel } from '../state.js';
import { addDialog, showDetails } from '../terrarium.js';
import { compareSizes, sizeLabel } from '../sizes.js';
import { codeLetters, modelLabel } from '../code.js';

// Kept between visits so the shelf looks the way you left it.
const filters = { query: '', size: '', status: '', sort: 'newest' };

const SORTS = {
  newest: ['Mais recentes', (a, b) => (b.made_on ?? '').localeCompare(a.made_on ?? '') || b.id - a.id],
  oldest: ['Mais antigos', (a, b) => (a.made_on ?? '9').localeCompare(b.made_on ?? '9') || a.id - b.id],
  name: ['Nome', (a, b) => compareText(a.name, b.name)],
  priceHigh: ['Maior preço', (a, b) => (b.price_cents ?? -1) - (a.price_cents ?? -1)],
  priceLow: ['Menor preço', (a, b) => (a.price_cents ?? Infinity) - (b.price_cents ?? Infinity)],
};

export function mount(root) {
  const search = h('input', {
    type: 'search', class: 'search', placeholder: 'Buscar por código, nome, plantas, observações…', value: filters.query,
    'aria-label': 'Buscar na prateleira', dataset: { shortcut: 'search' },
  });
  const sizeSelect = h('select', { 'aria-label': 'Filtrar por tamanho' });
  const statusSelect = h('select', { 'aria-label': 'À venda ou acervo pessoal' },
    h('option', { value: '' }, 'À venda e acervo'),
    h('option', { value: 'available' }, 'Só à venda'),
    h('option', { value: 'personal' }, 'Só acervo pessoal'));
  const sortSelect = h('select', { 'aria-label': 'Ordenar' },
    Object.entries(SORTS).map(([key, [label]]) => h('option', { value: key }, label)));
  sortSelect.value = filters.sort;

  const summary = h('p', { class: 'view-summary' });
  const toolbar = h('div', { class: 'toolbar' }, search, statusSelect, sizeSelect, sortSelect);
  const grid = h('div', { class: 'shelf' });
  const catalogBtn = h('button', {
    type: 'button', class: 'btn', onclick: () => { location.hash = '#catalog'; },
    title: 'PDF com os terrários disponíveis, para enviar a clientes',
  }, 'Catálogo Rápido');

  // Terrariums are grouped by their code's letters, i.e. by jar model: one card per model.
  // Cards are kept between updates, so searching and sorting only rearrange them and their
  // photos don't load again. A card is rebuilt when something it shows changes.
  const cards = new Map();
  const cardFor = (group) => {
    const key = [
      group.label, group.total, group.members[0].photo_version, getCurrency(),
      ...group.members.map((t) => [t.id, t.price_cents, t.status].join(':')),
    ].join('\n');
    let entry = cards.get(group.letters);
    if (entry?.key !== key) {
      entry = { key, el: card(group) };
      cards.set(group.letters, entry);
    }
    return entry.el;
  };

  search.addEventListener('input', debounce(() => { filters.query = search.value; update(); }));
  sizeSelect.addEventListener('change', () => { filters.size = sizeSelect.value; update(); });
  statusSelect.addEventListener('change', () => { filters.status = statusSelect.value; update(); });
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
    const totals = new Map(); // terrariums on the shelf per code letters
    for (const t of all) totals.set(codeLetters(t.code), (totals.get(codeLetters(t.code)) ?? 0) + 1);
    for (const letters of cards.keys()) if (!totals.has(letters)) cards.delete(letters);
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

    // The personal collection (Acervo pessoal) is on the shelf too, and can be shown on its own.
    const personal = all.filter((t) => t.status === 'personal').length;
    if (!personal) filters.status = '';
    statusSelect.value = filters.status;
    statusSelect.hidden = personal === 0;
    const worth = all.reduce((sum, t) => sum + (t.price_cents ?? 0), 0);
    const models = [...totals.keys()].filter(Boolean).length;
    summary.textContent = all.length
      ? `${plural(all.length, 'terrário', 'terrários')}${models ? ` de ${plural(models, 'modelo', 'modelos')}` : ''}, `
        + `somando ${money(worth)} em preço pedido`
        + (personal ? ` · ${personal} no acervo pessoal` : '')
      : '';

    const q = filters.query.trim().toLocaleLowerCase(locale);
    const shown = all
      .filter((t) => !filters.status || t.status === filters.status)
      .filter((t) => !filters.size || t.size === filters.size)
      .filter((t) => !q || [t.code, t.name, t.size, t.container, t.description, t.plants, t.notes]
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
    // A model comes where its first terrarium does in the chosen order; those without a code last.
    const groups = new Map();
    for (const t of shown) {
      const letters = codeLetters(t.code);
      if (!groups.has(letters)) groups.set(letters, { letters, members: [], total: totals.get(letters) });
      groups.get(letters).members.push(t);
    }
    const ordered = [...groups.values()].sort((a, b) => !a.letters - !b.letters);
    for (const g of ordered) g.label = g.letters ? groupLabel(g.letters) : null;
    grid.replaceChildren(...ordered.map(cardFor));
  }

  update();
  return { update };
}

// The jar model a code's letters stand for ("Frasco boca larga 250 mL"): the jar lots with those
// letters, or else what their terrariums (on the shelf or not) were made in. The most common, if
// they differ.
function groupLabel(letters) {
  const counts = new Map();
  const add = (label) => { if (label) counts.set(label, (counts.get(label) ?? 0) + 1); };
  for (const l of state.lots) if (l.code === letters) add(lotLabel(l));
  if (!counts.size) for (const t of state.items) if (codeLetters(t.code) === letters) add(modelLabel(t));
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

const groupTitle = (g) => (g.letters ? g.label ?? `Modelo ${g.letters}` : 'Sem código');

// "R$ 80,00", or "R$ 80,00 – R$ 120,00" when the prices differ.
function priceRange(list) {
  const prices = list.map((t) => t.price_cents).filter((c) => c != null);
  if (!prices.length) return 'Sem preço';
  const [low, high] = [Math.min(...prices), Math.max(...prices)];
  return low === high ? money(low) : `${money(low)} – ${money(high)}`;
}

function personalNote(list) {
  const personal = list.filter((t) => t.status === 'personal').length;
  if (!personal) return null;
  return personal === list.length ? 'Acervo pessoal' : `${personal} no acervo pessoal`;
}

// One jar model on the shelf: its first terrarium's photo, with the others stacked behind it.
function card(g) {
  const { members } = g;
  const front = jar(members[0]);
  if (members.length > 1) front.append(h('span', { class: 'stack-count', 'aria-hidden': 'true' }, members.length));
  const personal = personalNote(members);
  return h('button', {
    type: 'button', class: `specimen specimen-group stack-${Math.min(members.length, 3)}`, onclick: () => showGroup(g),
  },
    front,
    personal ? h('span', { class: 'tag tag-personal specimen-tag' }, personal) : null,
    g.letters ? h('span', { class: 'code-tag specimen-code' }, g.letters) : null,
    h('span', { class: 'specimen-name' }, groupTitle(g)),
    h('span', { class: 'specimen-meta' }, plural(members.length, 'terrário', 'terrários')),
    h('span', { class: 'specimen-price' }, priceRange(members)),
  );
}

// The side panel with the terrariums of one model (those the shelf's filters let through).
function showGroup(g) {
  const { members } = g;
  const worth = members.reduce((sum, t) => sum + (t.price_cents ?? 0), 0);
  openDialog('drawer group-drawer', (close) => [
    h('div', { class: 'drawer-head' },
      h('button', { type: 'button', class: 'btn btn-quiet btn-icon', 'aria-label': 'Fechar', onclick: () => close() }, '✕'),
    ),
    h('div', { class: 'drawer-body' },
      g.letters ? h('p', { class: 'drawer-code' }, h('span', { class: 'code-tag' }, g.letters)) : null,
      h('h2', { class: 'drawer-title' }, groupTitle(g)),
      h('p', { class: 'drawer-sub' },
        members.length < g.total
          ? `${members.length} de ${plural(g.total, 'terrário', 'terrários')} correspondem aos filtros da prateleira`
          : `${plural(members.length, 'terrário', 'terrários')} na prateleira`,
        worth ? `, somando ${money(worth)} em preço pedido` : ''),
      g.letters
        ? null
        : h('p', { class: 'status-note' }, 'Estes terrários são de antes dos códigos. Edite cada um para dar um código: '
            + 'o aplicativo sugere um a partir do frasco.'),
      h('ul', { class: 'group-list' }, members.map((t) => h('li', {},
        h('button', { type: 'button', class: 'group-item', onclick: () => { close(); showDetails(t.id); } },
          jar(t, { size: 'jar-small' }),
          h('span', { class: 'group-item-name' },
            t.code ? h('span', { class: 'code-tag' }, t.code) : null,
            h('strong', {}, t.name),
            h('small', {}, [sizeLabel(t.size), t.made_on && `feito em ${date(t.made_on)}`].filter(Boolean).join(', ') || null),
            t.status === 'personal' ? h('span', { class: 'tag tag-personal' }, 'Acervo pessoal') : null,
          ),
          h('span', { class: 'group-item-price' }, t.price_cents != null ? money(t.price_cents) : 'Sem preço'),
        )))),
    ),
  ]);
}
