// Dialogs for a single terrarium: details, add/edit, and sold / given away / lost.
import { h, openDialog, confirmDialog, field, setFieldError, toast, showError } from './ui.js';
import { money, date, todayISO, formatPhone, instagramLabel } from './format.js';
import { jar, preparePhoto, photoUrl, sprout } from './photo.js';
import { moneyInput, moneyCents, setMoney } from './money-input.js';
import { buyerFields, showBuyer } from './buyer.js';
import { SIZES, compareSizes, sizeLabel } from './sizes.js';
import { containerOptions, compareContainers } from './containers.js';
import { combobox } from './combobox.js';
import { showLot, lotOptionLabel } from './jar-lot.js';
import {
  state, reload, profit as profitOf, STATUS_LABELS, leftShelf, lotById, lotCost, lotLabel, lotStock, channelOptions,
} from './state.js';


const byId = (id) => state.items.find((t) => t.id === id);

// "Vendido", "Doado", "Perda"… as a coloured tag.
export function statusTag(t) {
  return h('span', { class: `tag tag-${t.status}` }, STATUS_LABELS[t.status]);
}

const LOSS_REASONS = ['Morreu', 'Quebrou'];

// "Entregue em": blank until it's delivered, with a shortcut for delivering on the day it was
// sold (or given), which is the usual case.
function deliveryField(input, saleDate) {
  const el = field('Entregue em', input, 'Em branco enquanto não for entregue. ');
  el.querySelector('.field-hint').append(h('button', {
    type: 'button', class: 'link', onclick: () => { input.value = saleDate.value; },
  }, 'No mesmo dia'));
  return el;
}

// A delivery can't come before the sale. `saved` is what's already on file, which may be
// wrong (the spreadsheet had some) without stopping other edits.
function deliveryError(soldOn, deliveredOn, saved) {
  if (!soldOn || !deliveredOn || deliveredOn >= soldOn) return null;
  if (saved && saved.sold_on === soldOn && saved.delivered_on === deliveredOn) return null;
  return 'A entrega não pode ser antes da data da venda';
}

// "De onde veio a venda": a text field suggesting the channels already used.
function channelField(label, value) {
  const input = h('input', { type: 'text', name: 'channel', autocomplete: 'off', value: value ?? '', maxLength: 80 });
  return { input, field: field(label, combobox(input, channelOptions()), 'Ex.: Instagram, amigos, feira') };
}

// ---- details --------------------------------------------------------------------

export function showDetails(id) {
  const t = byId(id);
  if (!t) return;
  const out = leftShelf(t);
  const profit = profitOf(t);
  const lot = lotById(t.lot_id);

  const fact = (label, value) => (value ? [h('dt', {}, label), h('dd', {}, value)] : null);

  const outcome = (close) => h('section', { class: `sale-block sale-${t.status}` },
    h('p', { class: 'sale-line' },
      statusTag(t),
      t.sold_on ? ` em ${date(t.sold_on)}` : ' (sem data)',
      t.buyer && t.status !== 'lost'
        ? [' para ', h('button', { type: 'button', class: 'link', onclick: () => { close(); showBuyer(t.buyer_id); } }, t.buyer)]
        : null,
    ),
    h('dl', { class: 'facts' },
      t.status === 'sold' ? fact('Valor da venda', money(t.sold_price_cents)) : null,
      t.status === 'sold' ? fact('Lucro', profit == null ? null : money(profit)) : null,
      t.status !== 'sold' ? fact(t.status === 'lost' ? 'Custo perdido' : 'Custo da cortesia', t.cost_cents != null && money(t.cost_cents)) : null,
      t.status !== 'lost' ? fact('Entregue em', t.delivered_on ? date(t.delivered_on) : 'Ainda não entregue') : null,
      fact('De onde veio', t.channel),
      fact('Celular', t.buyer_phone && formatPhone(t.buyer_phone)),
      fact('Instagram', t.buyer_instagram && instagramLabel(t.buyer_instagram)),
      fact({ sold: 'Observações da venda', donated: 'Observações', lost: 'Motivo' }[t.status], t.sale_notes),
    ),
  );

  const setStatus = async (status, message, close) => {
    try {
      await window.api.terrariums.update(t.id, { status });
      await reload();
      close();
      toast(message);
    } catch (err) { showError(err); }
  };

  openDialog('drawer', (close) => [
    h('div', { class: 'drawer-head' },
      h('button', { type: 'button', class: 'btn btn-quiet btn-icon', 'aria-label': 'Fechar', onclick: () => close() }, '✕'),
    ),
    h('div', { class: 'drawer-body' },
      jar(t, { size: 'jar-large' }),
      h('h2', { class: 'drawer-title' }, t.name),
      h('p', { class: 'drawer-sub' }, [sizeLabel(t.size), t.container].filter(Boolean).join(', ') || 'Sem tamanho ou recipiente informado'),
      t.status === 'personal'
        ? h('p', { class: 'status-note' }, statusTag(t), ' Pode ser vendido, mas não aparece no catálogo.')
        : null,
      out ? outcome(close) : null,
      h('dl', { class: 'facts' },
        fact('Feito em', t.made_on && date(t.made_on)),
        fact('Frasco', lot && h('button', { type: 'button', class: 'link', onclick: () => { close(); showLot(lot.id); } },
          [lotLabel(lot), lot.collection].filter(Boolean).join(', '))),
        fact('Custo do material', t.cost_cents != null && money(t.cost_cents)),
        fact('Preço pedido', t.price_cents != null && money(t.price_cents)),
        fact('Descrição', t.description),
        fact('Plantas e conteúdo', t.plants),
        fact('Observações', t.notes),
      ),
    ),
    h('div', { class: 'drawer-actions' },
      out
        ? h('button', { type: 'button', class: 'btn', onclick: async () => {
            const ok = await confirmDialog({
              title: 'Voltar para a prateleira?',
              message: {
                sold: `A venda de “${t.name}” (data, valor e comprador) será apagada.`,
                donated: `A doação de “${t.name}” (data e para quem foi) será apagada.`,
                lost: `A perda de “${t.name}” será apagada.`,
              }[t.status],
              confirmLabel: 'Voltar para a prateleira',
            });
            if (!ok) return;
            try {
              await window.api.terrariums.unsell(t.id);
              await reload();
              close();
              toast('Voltou para a prateleira');
            } catch (err) { showError(err); }
          } }, 'Voltar para a prateleira')
        : [
            h('button', { type: 'button', class: 'btn btn-primary', onclick: () => { close(); outcomeDialog(t.id, 'sold'); } }, 'Marcar como vendido'),
            h('button', { type: 'button', class: 'btn', onclick: () => { close(); outcomeDialog(t.id, 'donated'); } }, 'Doar'),
            h('button', { type: 'button', class: 'btn', onclick: () => { close(); outcomeDialog(t.id, 'lost'); } }, 'Registrar perda'),
            t.status === 'personal'
              ? h('button', { type: 'button', class: 'btn', onclick: () => setStatus('available', 'Colocado à venda', close) }, 'Colocar à venda')
              : h('button', {
                  type: 'button', class: 'btn', title: 'Continua na prateleira, mas sai do catálogo',
                  onclick: () => setStatus('personal', 'Movido para o acervo pessoal', close),
                }, 'Mover para o acervo'),
          ],
      h('button', { type: 'button', class: 'btn', onclick: () => { close(); editDialog(t.id); } }, 'Editar'),
      h('button', { type: 'button', class: 'btn btn-quiet btn-danger-text', onclick: async () => {
        const ok = await confirmDialog({
          title: `Excluir “${t.name}”?`,
          message: `Isso apaga o terrário, a foto e o registro de venda.${lot ? ' O frasco volta para o estoque.' : ''} Não dá para desfazer.`,
          confirmLabel: 'Excluir',
          danger: true,
        });
        if (!ok) return;
        try {
          await window.api.terrariums.remove(t.id);
          await reload();
          close();
          toast('Terrário excluído');
        } catch (err) { showError(err); }
      } }, 'Excluir'),
    ),
  ]);
}

// ---- add / edit -----------------------------------------------------------------

// `lot`: the id of the jar lot to start from (Frascos → Montar terrário).
export function addDialog({ lot } = {}) {
  terrariumForm(null, { lot });
}

export function editDialog(id) {
  const t = byId(id);
  if (t) terrariumForm(t);
}

// The "Frasco do estoque" choices: lots with jars left (and the terrarium's own lot),
// grouped by collection, newest collection first.
function lotSelect(currentId) {
  const select = h('select', { name: 'lot_id' });
  const lots = state.lots.filter((l) => lotStock(l) > 0 || l.id === currentId);
  const groups = new Map();
  for (const l of lots) {
    const key = l.collection ?? 'Sem coleção';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(l);
  }
  select.append(
    h('option', { value: '' }, lots.length ? 'Nenhum: não veio do estoque' : 'Nenhum frasco no estoque'),
    ...[...groups].map(([label, list]) => h('optgroup', { label },
      list.sort((a, b) => compareContainers(lotLabel(a), lotLabel(b)))
        .map((l) => h('option', { value: String(l.id) }, lotOptionLabel(l))))),
  );
  select.value = currentId != null ? String(currentId) : '';
  return select;
}

function terrariumForm(t, { lot: startLot } = {}) {
  const isNew = !t;
  const sizes = [...new Set([...SIZES, ...state.items.map((i) => i.size).filter(Boolean)])].sort(compareSizes);
  const containers = containerOptions();
  const status = t?.status ?? 'available';

  // Photo state: undefined = unchanged, null = removed, object = new photo.
  let newPhoto;

  const input = (name, attrs = {}) => h('input', { name, type: 'text', autocomplete: 'off', ...attrs });

  const f = {
    name: input('name', { value: t?.name ?? '', required: true, maxLength: 120 }),
    size: input('size', { value: t?.size ?? '', placeholder: 'Ex.: Pequeno, Médio, Grande' }),
    lot: lotSelect(t?.lot_id ?? null),
    container: input('container', { value: t?.container ?? '', placeholder: 'Ex.: pote de vidro, garrafa, cúpula' }),
    made_on: input('made_on', { type: 'date', value: t?.made_on ?? (isNew ? todayISO() : '') }),
    cost: moneyInput('cost', t?.cost_cents),
    price: moneyInput('price', t?.price_cents),
    description: h('textarea', {
      name: 'description', rows: 2, value: t?.description ?? '',
      placeholder: 'Ex.: Ecossistema fechado que quase não precisa de rega. Ideal para escritório.',
    }),
    plants: h('textarea', { name: 'plants', rows: 2, value: t?.plants ?? '', placeholder: 'Ex.: fitônia, musgo, colêmbolos' }),
    notes: h('textarea', { name: 'notes', rows: 2, value: t?.notes ?? '' }),
    status: h('select', { name: 'status' },
      h('option', { value: 'available' }, 'Disponível'),
      h('option', { value: 'personal' }, 'Acervo pessoal'),
      h('option', { value: 'sold' }, 'Vendido'),
      h('option', { value: 'donated' }, 'Doado / cortesia'),
      h('option', { value: 'lost' }, 'Perda (morreu ou quebrou)'),
    ),
    // An outcome already saved without a date (e.g. from the spreadsheet) stays without one.
    sold_on: input('sold_on', { type: 'date', value: t?.sold_on ?? (t && leftShelf(t) ? '' : todayISO()) }),
    delivered_on: input('delivered_on', { type: 'date', value: t?.delivered_on ?? '' }),
    sold_price: moneyInput('sold_price', t?.sold_price_cents),
    buyer: buyerFields({ name: t?.buyer, phone: t?.buyer_phone, instagram: t?.buyer_instagram }),
    sale_notes: h('textarea', { name: 'sale_notes', rows: 2, value: status !== 'lost' ? t?.sale_notes ?? '' : '' }),
    reason: input('reason', { value: status === 'lost' ? t?.sale_notes ?? '' : '', placeholder: 'Ex.: morreu, quebrou' }),
  };
  f.status.value = status;

  // ---- jar from stock: fills in what it knows, without overwriting what was typed
  const costField = field('Custo do material', f.cost);
  const costHint = h('small', { class: 'field-hint' });
  costField.append(costHint);
  let lotBefore = lotById(t?.lot_id);
  const untouched = (value, fromLot) => value == null || value === '' || (lotBefore && value === fromLot(lotBefore));
  function syncLotHint() {
    const lot = lotById(Number(f.lot.value));
    const cost = lot && lotCost(lot);
    costHint.textContent = cost != null
      ? `O frasco custou ${money(cost)}. Some as plantas, o substrato e os enfeites.`
      : 'Quanto você gastou com pote, plantas e substrato';
  }
  function pickLot() {
    const lot = lotById(Number(f.lot.value));
    if (lot) {
      if (untouched(f.name.value.trim(), (l) => l.description ?? lotLabel(l)) && isNew) f.name.value = lot.description ?? lotLabel(lot);
      if (untouched(f.container.value.trim(), lotLabel)) f.container.value = lotLabel(lot);
      if (untouched(moneyCents(f.cost), lotCost) && lotCost(lot) != null) setMoney(f.cost, lotCost(lot));
      if (untouched(moneyCents(f.price), (l) => l.price_cents) && lot.price_cents != null) setMoney(f.price, lot.price_cents);
      if (untouched(f.description.value.trim(), (l) => l.description) && lot.description) f.description.value = lot.description;
    }
    lotBefore = lot;
    syncLotHint();
  }
  f.lot.addEventListener('change', pickLot);
  if (startLot != null) {
    f.lot.value = String(startLot);
    pickLot();
  }
  syncLotHint();

  // ---- photo picker
  const preview = h('div', { class: 'jar jar-large photo-drop' });
  const fileInput = h('input', { type: 'file', accept: 'image/*', hidden: true });
  const removeBtn = h('button', { type: 'button', class: 'btn btn-quiet btn-small' }, 'Remover foto');

  function renderPreview() {
    const url = newPhoto === undefined ? (t && photoUrl(t)) : newPhoto?.url;
    preview.replaceChildren(url ? h('img', { src: url, alt: '' }) : sprout());
    preview.classList.toggle('has-photo', !!url);
    removeBtn.hidden = !url;
  }

  async function takeFile(file) {
    if (!file) return;
    try {
      if (newPhoto?.url) URL.revokeObjectURL(newPhoto.url);
      newPhoto = await preparePhoto(file);
      renderPreview();
    } catch (err) { showError(err); }
  }

  fileInput.addEventListener('change', () => takeFile(fileInput.files[0]));
  removeBtn.addEventListener('click', () => { newPhoto = null; renderPreview(); });
  preview.addEventListener('click', () => fileInput.click());
  preview.addEventListener('dragover', (e) => { e.preventDefault(); preview.classList.add('dragging'); });
  preview.addEventListener('dragleave', () => preview.classList.remove('dragging'));
  preview.addEventListener('drop', (e) => {
    e.preventDefault();
    preview.classList.remove('dragging');
    takeFile(e.dataTransfer.files[0]);
  });
  preview.tabIndex = 0;
  preview.setAttribute('role', 'button');
  preview.setAttribute('aria-label', 'Escolher uma foto');
  preview.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
  });
  renderPreview();

  // ---- what became of it: each status shows its own fields
  const dateField = field('Vendido em', f.sold_on);
  const deliveredField = deliveryField(f.delivered_on, f.sold_on);
  const priceField = field('Valor da venda', f.sold_price);
  const notesField = h('div', { class: 'span-2' }, field('Observações da venda', f.sale_notes));
  const reasonField = h('div', { class: 'span-2' }, field('Motivo', combobox(f.reason, LOSS_REASONS)));
  const channel = channelField('De onde veio a venda', t?.channel);
  // The person always starts a row, whether or not the price sits beside the date.
  f.buyer.nameField.classList.add('row-start');
  const personFields = [f.buyer.nameField, f.buyer.phoneField, f.buyer.instagramField, channel.field];
  const outcomeFields = h('div', { class: 'form-grid sale-fields' },
    dateField, deliveredField, priceField, personFields, notesField, reasonField);
  const statusHint = h('small', { class: 'field-hint' });
  const label = (el, text) => { el.querySelector('label').textContent = text; };
  function syncStatus() {
    const s = f.status.value;
    outcomeFields.hidden = !['sold', 'donated', 'lost'].includes(s);
    outcomeFields.dataset.status = s;
    priceField.hidden = s !== 'sold';
    deliveredField.hidden = s === 'lost';
    for (const el of personFields) el.hidden = s === 'lost';
    notesField.hidden = s === 'lost';
    reasonField.hidden = s !== 'lost';
    label(dateField, { sold: 'Vendido em', donated: 'Doado em', lost: 'Data da perda' }[s] ?? 'Data');
    label(f.buyer.nameField, s === 'donated' ? 'Para quem' : 'Comprador');
    label(channel.field, s === 'donated' ? 'De onde veio' : 'De onde veio a venda');
    label(notesField, s === 'donated' ? 'Motivo e observações' : 'Observações da venda');
    statusHint.textContent = {
      available: 'Na prateleira e no catálogo.',
      personal: 'Na prateleira e pode ser vendido, mas não aparece no catálogo.',
    }[s] ?? '';
  }
  f.status.addEventListener('change', syncStatus);
  const statusField = field('Situação', f.status);
  statusField.append(statusHint);
  syncStatus();

  const dialog = openDialog('modal', (close) => {
    const form = h('form', { class: 'modal-body', novalidate: true },
      h('h2', { class: 'modal-title' }, isNew ? 'Adicionar terrário' : `Editar “${t.name}”`),
      h('div', { class: 'form-layout' },
        h('div', { class: 'photo-col' },
          preview,
          h('p', { class: 'photo-hint' }, 'Clique, arraste ou cole uma foto'),
          removeBtn,
          fileInput,
        ),
        h('div', { class: 'fields-col' },
          h('div', { class: 'form-grid' },
            field('Nome', f.name),
            field('Feito em', f.made_on),
            h('div', { class: 'span-2' }, field('Frasco do estoque', f.lot, 'Preenche o recipiente, o custo, o preço e a descrição. O estoque diminui sozinho.')),
            field('Tamanho', combobox(f.size, sizes)),
            field('Recipiente', combobox(f.container, containers)),
            costField,
            field('Preço pedido', f.price),
            h('div', { class: 'span-2' }, field('Descrição', f.description, 'Aparece no Catálogo rápido, junto com as plantas')),
            h('div', { class: 'span-2' }, field('Plantas e conteúdo', f.plants)),
            h('div', { class: 'span-2' }, field('Observações', f.notes, 'Só para você. Não aparece no catálogo.')),
            h('div', { class: 'span-2 status-row' }, statusField),
          ),
          outcomeFields,
        ),
      ),
      h('div', { class: 'modal-actions' },
        h('button', { type: 'button', class: 'btn btn-quiet', onclick: () => close() }, 'Cancelar'),
        h('button', { type: 'submit', class: 'btn btn-primary' }, isNew ? 'Adicionar terrário' : 'Salvar alterações'),
      ),
    );

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const data = collect();
      if (!data) return;
      const submit = form.querySelector('[type=submit]');
      submit.disabled = true;
      try {
        let saved = isNew ? await window.api.terrariums.create(data) : await window.api.terrariums.update(t.id, data);
        if (newPhoto !== undefined) {
          saved = await window.api.photos.set(saved.id, newPhoto?.bytes ?? null, newPhoto?.mime);
        }
        await reload();
        close();
        toast(isNew ? `“${saved.name}” adicionado` : 'Alterações salvas');
      } catch (err) {
        showError(err);
        submit.disabled = false;
      }
    });
    return form;
  });

  dialog.addEventListener('paste', (e) => {
    const file = [...e.clipboardData.files].find((x) => x.type.startsWith('image/'));
    if (file) { e.preventDefault(); takeFile(file); }
  });
  dialog.addEventListener('close', () => { if (newPhoto?.url) URL.revokeObjectURL(newPhoto.url); });
  f.name.focus();

  function collect() {
    let ok = true;
    const check = (el, message) => { setFieldError(el, message); if (message) ok = false; };

    check(f.name, f.name.value.trim() ? null : 'Dê um nome ao terrário');
    const s = f.status.value;
    const out = s === 'sold' || s === 'donated' || s === 'lost';
    const hasBuyer = s === 'sold' || s === 'donated';
    const data = {
      name: f.name.value,
      size: f.size.value,
      lot_id: f.lot.value ? Number(f.lot.value) : null,
      container: f.container.value,
      made_on: f.made_on.value,
      cost_cents: moneyCents(f.cost),
      price_cents: moneyCents(f.price),
      description: f.description.value,
      plants: f.plants.value,
      notes: f.notes.value,
      status: s,
      sold_on: out ? f.sold_on.value : null,
      sold_price_cents: s === 'sold' ? moneyCents(f.sold_price) : null,
      ...(hasBuyer ? f.buyer.value() : { buyer_name: null, buyer_phone: null, buyer_instagram: null }),
      channel: hasBuyer ? channel.input.value : null,
      delivered_on: hasBuyer ? f.delivered_on.value : null,
      sale_notes: s === 'lost' ? f.reason.value : out ? f.sale_notes.value : null,
    };
    // A new sale needs its date and value; one already saved without them (from the
    // spreadsheet) can still be edited.
    const newSale = s === 'sold' && t?.status !== 'sold';
    check(f.sold_on, newSale && !f.sold_on.value ? 'Escolha a data da venda' : null);
    check(f.sold_price, newSale && data.sold_price_cents == null ? 'Informe o valor da venda' : null);
    check(f.delivered_on, hasBuyer ? deliveryError(data.sold_on, data.delivered_on, t) : null);
    if (hasBuyer && !f.buyer.validate()) ok = false;
    if (!ok) dialog.querySelector('[aria-invalid=true]')?.focus();
    return ok ? data : null;
  }
}

// ---- sold, given away or lost ---------------------------------------------------------

const OUTCOMES = {
  sold: { title: 'Marcar como vendido', date: 'Vendido em', submit: 'Marcar como vendido' },
  donated: { title: 'Doar / cortesia', date: 'Doado em', submit: 'Registrar doação' },
  lost: { title: 'Registrar perda', date: 'Data da perda', submit: 'Registrar perda' },
};

export function outcomeDialog(id, status = 'sold') {
  const t = byId(id);
  const o = OUTCOMES[status];
  if (!t || !o) return;

  const when = h('input', { type: 'date', name: 'sold_on', value: todayISO(), required: true });
  const delivered = h('input', { type: 'date', name: 'delivered_on' });
  const price = moneyInput('price', t.price_cents);
  const buyer = buyerFields({ label: status === 'donated' ? 'Para quem' : 'Comprador' });
  buyer.nameField.classList.add('row-start');
  const channel = channelField(status === 'donated' ? 'De onde veio' : 'De onde veio a venda');
  const notes = h('textarea', { name: 'sale_notes', rows: 2 });
  const reason = h('input', { type: 'text', name: 'reason', autocomplete: 'off', placeholder: 'Ex.: morreu, quebrou' });

  openDialog('modal modal-small', (close) => {
    const form = h('form', { class: 'modal-body', novalidate: true },
      h('div', { class: 'sell-head' },
        jar(t, { size: 'jar-small' }),
        h('div', {},
          h('h2', { class: 'modal-title' }, o.title),
          h('p', { class: 'modal-text' }, t.name),
        ),
      ),
      h('div', { class: `form-grid outcome-${status}` },
        field(o.date, when),
        status === 'lost' ? null : deliveryField(delivered, when),
        status === 'sold'
          ? field('Valor da venda', price, t.price_cents != null ? `Preço pedido: ${money(t.price_cents)}` : null)
          : null,
        status === 'lost'
          ? h('div', { class: 'span-2' }, field('Motivo', combobox(reason, LOSS_REASONS)))
          : [buyer.nameField, buyer.phoneField, buyer.instagramField, channel.field],
        status === 'lost'
          ? null
          : h('div', { class: 'span-2' }, field(status === 'donated' ? 'Motivo e observações' : 'Observações', notes,
              status === 'donated' ? 'Ex.: publicidade, presente para cliente' : 'Opcional. Ex.: entregue em casa, pago no Pix')),
        status !== 'sold' && t.cost_cents != null
          ? h('p', { class: 'modal-text span-2' }, `${status === 'lost' ? 'Perde-se' : 'A cortesia custou'} ${money(t.cost_cents)} em material.`)
          : null,
      ),
      h('div', { class: 'modal-actions' },
        h('button', { type: 'button', class: 'btn btn-quiet', onclick: () => close() }, 'Cancelar'),
        h('button', { type: 'submit', class: 'btn btn-primary' }, o.submit),
      ),
    );
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const cents = moneyCents(price);
      if (status === 'sold') setFieldError(price, cents == null ? 'Informe o valor da venda' : null);
      setFieldError(when, when.value ? null : 'Escolha a data');
      if (status !== 'lost') {
        buyer.validate();
        setFieldError(delivered, deliveryError(when.value, delivered.value));
      }
      const invalid = form.querySelector('[aria-invalid=true]');
      if (invalid) { invalid.focus(); return; }
      try {
        await window.api.terrariums.settle(t.id, {
          status,
          sold_on: when.value,
          sold_price_cents: status === 'sold' ? cents : null,
          ...(status === 'lost' ? {} : buyer.value()),
          channel: status === 'lost' ? null : channel.input.value,
          delivered_on: status === 'lost' ? null : delivered.value,
          sale_notes: status === 'lost' ? reason.value : notes.value,
        });
        await reload();
        close();
        toast({
          sold: `“${t.name}” vendido por ${money(cents)}`,
          donated: `Doação de “${t.name}” registrada`,
          lost: `Perda de “${t.name}” registrada`,
        }[status]);
      } catch (err) { showError(err); }
    });
    return form;
  });
  if (status === 'sold') {
    const priceInput = price.querySelector('input');
    priceInput.focus();
    priceInput.select();
  } else if (status === 'lost') {
    reason.focus();
  } else {
    buyer.nameField.querySelector('input').focus();
  }
}
