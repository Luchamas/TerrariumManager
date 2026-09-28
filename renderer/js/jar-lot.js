// Jar lots (Frascos): a lot's details panel, registering a purchase and editing a lot.
import { h, openDialog, confirmDialog, field, setFieldError, toast, showError } from './ui.js';
import { money, date, plural, todayISO, compareText } from './format.js';
import { jar } from './photo.js';
import { moneyInput, moneyCents } from './money-input.js';
import { combobox } from './combobox.js';
import { state, reload, lotById, lotCost, lotStock, lotLabel } from './state.js';
import { addDialog, showDetails, statusTag } from './terrarium.js';
import { lettersInput, suggestLetters, lettersError } from './code.js';

// ---- details --------------------------------------------------------------------

export function showLot(id) {
  const lot = lotById(id);
  if (!lot) return;
  const stock = lotStock(lot);
  const cost = lotCost(lot);
  const made = state.items.filter((t) => t.lot_id === lot.id).sort((a, b) => (b.made_on ?? '').localeCompare(a.made_on ?? '') || b.id - a.id);
  const fact = (label, value) => (value ? [h('dt', {}, label), h('dd', {}, value)] : null);
  const parts = [
    lot.unit_cost_cents != null && `frasco ${money(lot.unit_cost_cents)}`,
    lot.lid_cost_cents != null && `tampa ${money(lot.lid_cost_cents)}`,
    lot.shipping_cents != null && `frete ${money(lot.shipping_cents)}`,
  ].filter(Boolean);

  openDialog('drawer lot-drawer', (close) => [
    h('div', { class: 'drawer-head' },
      h('button', { type: 'button', class: 'btn btn-quiet btn-icon', 'aria-label': 'Fechar', onclick: () => close() }, '✕'),
    ),
    h('div', { class: 'drawer-body' },
      lot.code ? h('p', { class: 'drawer-code' }, h('span', { class: 'code-tag' }, lot.code)) : null,
      h('h2', { class: 'drawer-title' }, lotLabel(lot)),
      h('p', { class: 'drawer-sub' }, [lot.collection, lot.supplier, lot.bought_on && `comprado em ${date(lot.bought_on)}`].filter(Boolean).join(' · ') || 'Sem coleção ou fornecedor'),

      h('section', { class: stock > 0 ? 'stock-box' : 'stock-box stock-empty' },
        h('p', { class: 'stock-count' }, stock > 0 ? plural(stock, 'frasco em estoque', 'frascos em estoque') : 'Nenhum em estoque'),
        h('p', { class: 'stock-detail' }, `${plural(lot.quantity, 'comprado', 'comprados')}, ${plural(lot.used, 'virou terrário', 'viraram terrários')}`),
      ),

      h('dl', { class: 'facts' },
        fact('Tampa', lot.lid),
        fact('Vidro', lot.glass),
        fact('Dimensões', lot.dimensions),
        fact('Custo por frasco', cost != null && `${money(cost)}${parts.length > 1 ? ` (${parts.join(' + ')})` : ''}`),
        fact('Preço sugerido', lot.price_cents != null && money(lot.price_cents)),
        fact('Lucro previsto', lot.price_cents != null && cost != null && `${money(lot.price_cents - cost)} por terrário, sem contar plantas e enfeites`),
        fact('Descrição', lot.description),
        fact('Observações', lot.notes),
      ),

      made.length
        ? [
            h('h3', { class: 'drawer-section' }, 'Terrários feitos com este frasco'),
            h('ul', { class: 'recent' }, made.map((t) => h('li', {},
              h('button', { type: 'button', class: 'recent-item', onclick: () => { close(); showDetails(t.id); } },
                jar(t, { size: 'jar-tiny' }),
                h('span', { class: 'recent-name' }, t.name,
                  h('small', {}, [t.code, t.made_on ? `Feito em ${date(t.made_on)}` : 'Sem data de montagem'].filter(Boolean).join(' · '))),
                statusTag(t),
              )))),
          ]
        : null,
    ),
    h('div', { class: 'drawer-actions' },
      h('button', {
        type: 'button', class: 'btn btn-primary', disabled: stock <= 0,
        title: stock > 0 ? 'Cadastrar um terrário feito com um destes frascos' : 'Não sobrou nenhum frasco deste lote',
        onclick: () => { close(); addDialog({ lot: lot.id }); },
      }, 'Montar terrário'),
      h('button', { type: 'button', class: 'btn', onclick: () => { close(); lotForm(lot); } }, 'Editar'),
      h('button', { type: 'button', class: 'btn btn-quiet btn-danger-text', onclick: async () => {
        const ok = await confirmDialog({
          title: `Excluir “${lotLabel(lot)}”?`,
          message: lot.used
            ? `O lote sai do estoque. ${lot.used === 1 ? 'O terrário feito com ele continua' : `Os ${lot.used} terrários feitos com ele continuam`}, só sem a ligação com o lote. Não dá para desfazer.`
            : 'O lote sai do estoque. Não dá para desfazer.',
          confirmLabel: 'Excluir',
          danger: true,
        });
        if (!ok) return;
        try {
          await window.api.jars.remove(lot.id);
          await reload();
          close();
          toast('Lote excluído');
        } catch (err) { showError(err); }
      } }, 'Excluir'),
    ),
  ]);
}

// ---- shipping ---------------------------------------------------------------------

// Splits an order's shipping among its jars, as shipping per jar for each item. `mode` is
// 'unit' (every jar the same) or 'value' (in proportion to what each jar cost, which is fairer
// when sizes differ). Each jar's share is rounded to the cent, and the leftover cents go to
// the jars that lost the most in rounding, so the shares add back up to the total whenever
// the quantities allow it.
export function splitShipping(totalCents, items, mode) {
  if (totalCents == null) return items.map(() => null);
  if (totalCents === 0) return items.map(() => 0);
  const units = items.reduce((sum, it) => sum + it.quantity, 0);
  const worth = items.reduce((sum, it) => sum + it.quantity * (it.valueCents ?? 0), 0);
  const byValue = mode === 'value' && worth > 0;
  if (!units) return items.map(() => 0);
  const exact = items.map((it) => (byValue ? (totalCents * (it.valueCents ?? 0)) / worth : totalCents / units));
  const shares = exact.map(Math.floor);
  let left = totalCents - items.reduce((sum, it, i) => sum + it.quantity * shares[i], 0);
  const order = exact.map((v, i) => i).sort((a, b) => (exact[b] - shares[b]) - (exact[a] - shares[a]));
  for (const i of order) {
    if (items[i].quantity && items[i].quantity <= left) {
      shares[i] += 1;
      left -= items[i].quantity;
    }
  }
  return shares;
}

// ---- register a purchase ------------------------------------------------------------

const unique = (values) => [...new Set(values.filter(Boolean))].sort(compareText);
const suggestions = () => ({
  models: unique(state.lots.map((l) => l.model)),
  lids: unique(state.lots.map((l) => l.lid)),
  glass: unique(state.lots.map((l) => l.glass)),
  suppliers: unique(state.lots.map((l) => l.supplier)),
  collections: unique(state.lots.map((l) => l.collection)),
});

const text = (name, attrs = {}) => h('input', { name, type: 'text', autocomplete: 'off', ...attrs });
const whole = (name, value, attrs = {}) => h('input', {
  name, type: 'text', inputmode: 'numeric', autocomplete: 'off', value: value ?? '', class: 'whole', ...attrs,
  oninput: (e) => { e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6); },
});
const wholeValue = (input) => (input.value ? Number(input.value) : null);

// Several kinds of jar bought together: shared supplier, date, collection and shipping.
export function purchaseDialog() {
  const s = suggestions();
  const head = {
    supplier: text('supplier'),
    bought_on: text('bought_on', { type: 'date', value: todayISO() }),
    // The collection of the last lot registered: usually the one still being bought for.
    collection: text('collection', { value: state.lots.find((l) => l.collection)?.collection ?? '', placeholder: 'Ex.: Coleção 3' }),
    shipping: moneyInput('shipping', null),
  };
  const modeValue = h('input', { type: 'radio', name: 'split', value: 'value', checked: true });
  const modeUnit = h('input', { type: 'radio', name: 'split', value: 'unit' });
  const mode = () => (modeUnit.checked ? 'unit' : 'value');

  const list = h('div', { class: 'purchase-items' });
  const totalLine = h('p', { class: 'purchase-total' });
  const items = [];

  function addItem() {
    const it = {
      model: text('model', { placeholder: 'Ex.: Frasco boca larga' }),
      code: lettersInput(''),
      capacity: whole('capacity_ml', null, { placeholder: 'mL' }),
      quantity: whole('quantity', 1),
      unit: moneyInput('unit_cost', null),
      lidCost: moneyInput('lid_cost', null),
      lid: text('lid', { placeholder: 'Ex.: Vidro, cortiça' }),
      glass: text('glass', { placeholder: 'Ex.: Borossilicato' }),
      dimensions: text('dimensions', { placeholder: 'Ex.: 14,5 A x 6 L cm' }),
      price: moneyInput('price', null),
      description: h('textarea', { name: 'description', rows: 2, placeholder: 'Aparece no catálogo dos terrários feitos com este frasco' }),
      computed: h('p', { class: 'item-computed' }),
    };
    const remove = h('button', {
      type: 'button', class: 'btn btn-quiet btn-icon btn-small', 'aria-label': 'Tirar este frasco da compra',
      onclick: () => {
        items.splice(items.indexOf(it), 1);
        it.el.remove();
        refresh();
      },
    }, '✕');
    // The model's letters follow what's typed as the model until they're typed themselves.
    let suggested = '';
    it.follow = () => {
      if (it.code.value && it.code.value !== suggested) return;
      suggested = suggestLetters(it.model.value, { capacity: wholeValue(it.capacity), pending: pendingBesides(it) });
      it.code.value = suggested;
    };
    // Each capacity is a model of its own, so the letters follow it too.
    const followAll = () => { for (const other of items) other.follow(); };
    it.model.addEventListener('input', followAll);
    it.capacity.addEventListener('input', followAll);
    it.el = h('div', { class: 'purchase-item' },
      h('div', { class: 'item-grid' },
        h('div', { class: 'item-model' }, field('Frasco', combobox(it.model, s.models)), field('Sigla', it.code)),
        field('Capacidade (mL)', it.capacity),
        field('Quantidade', it.quantity),
        remove,
        h('div', { class: 'item-unit' }, field('Valor de cada frasco', it.unit)),
        field('Tampa comprada à parte', it.lidCost, 'Valor de cada tampa, se veio separada'),
        h('div', { class: 'item-lid' }, field('Tampa', combobox(it.lid, s.lids))),
      ),
      h('details', { class: 'item-more' },
        h('summary', {}, 'Mais detalhes: vidro, dimensões, preço sugerido, descrição'),
        h('div', { class: 'form-grid' },
          field('Composição do vidro', combobox(it.glass, s.glass)),
          field('Dimensões', it.dimensions),
          field('Preço sugerido do terrário', it.price),
          h('div', { class: 'span-2' }, field('Descrição', it.description)),
        ),
      ),
      it.computed,
    );
    items.push(it);
    list.append(it.el);
    refresh();
    return it;
  }

  // Other jars of this purchase, whose letters count as taken: all of them for suggestions; for
  // checking, the ones above, so a clash is shown on the later jar only.
  const pending = (list) => list.map((other) => ({
    model: other.model.value, capacity: wholeValue(other.capacity), code: other.code.value,
  }));
  const pendingBesides = (it) => pending(items.filter((other) => other !== it));
  const pendingAbove = (it) => pending(items.slice(0, items.indexOf(it)));

  // Shipping per jar and cost per jar of every item, from what's typed so far.
  function refresh() {
    const rows = items.map((it) => ({
      quantity: wholeValue(it.quantity) ?? 0,
      valueCents: (moneyCents(it.unit) ?? 0) + (moneyCents(it.lidCost) ?? 0),
    }));
    const total = moneyCents(head.shipping);
    const shares = splitShipping(total, rows, mode());
    let goods = 0;
    let shipped = 0;
    items.forEach((it, i) => {
      it.shippingCents = shares[i];
      const q = rows[i].quantity;
      goods += q * rows[i].valueCents;
      shipped += q * (shares[i] ?? 0);
      const each = rows[i].valueCents + (shares[i] ?? 0);
      it.computed.textContent = total
        ? `Frete de cada frasco: ${money(shares[i])} · custo de cada frasco: ${money(each)}`
        : `Custo de cada frasco: ${money(each)}`;
    });
    const jars = rows.reduce((sum, r) => sum + r.quantity, 0);
    totalLine.textContent = `${plural(jars, 'frasco', 'frascos')} · ${money(goods + shipped)} no total`
      + (total && shipped !== total ? ` (o frete dividido soma ${money(shipped)}: sobraram centavos que não dividem por igual)` : '');
    for (const btn of list.querySelectorAll('.purchase-item .btn-icon')) btn.hidden = items.length === 1;
  }

  const dialog = openDialog('modal purchase-modal', (close) => {
    const form = h('form', { class: 'modal-body', novalidate: true },
      h('h2', { class: 'modal-title' }, 'Registrar compra de frascos'),
      h('p', { class: 'modal-text' }, 'Cada tipo de frasco vira um lote no estoque. O frete do pedido é dividido entre os frascos. '
        + 'A sigla (3 letras do modelo) abre o código dos terrários feitos com ele.'),
      h('div', { class: 'form-grid purchase-head' },
        field('Local da compra', combobox(head.supplier, s.suppliers)),
        field('Data da compra', head.bought_on),
        field('Coleção ou lote', combobox(head.collection, s.collections), 'Para agrupar os frascos, ex.: Coleção 2, 5º Lote'),
        field('Frete total do pedido', head.shipping),
        h('fieldset', { class: 'choice span-2' },
          h('legend', {}, 'Dividir o frete'),
          h('div', { class: 'segmented' },
            h('label', {}, modeValue, h('span', {}, 'Proporcional ao valor de cada frasco')),
            h('label', {}, modeUnit, h('span', {}, 'Igual para todos os frascos')),
          ),
        ),
      ),
      list,
      h('button', { type: 'button', class: 'btn btn-small add-item', onclick: () => addItem().model.focus() }, '+ Adicionar outro frasco'),
      totalLine,
      h('div', { class: 'modal-actions' },
        h('button', { type: 'button', class: 'btn btn-quiet', onclick: () => close() }, 'Cancelar'),
        h('button', { type: 'submit', class: 'btn btn-primary' }, 'Registrar compra'),
      ),
    );
    form.addEventListener('input', refresh);
    form.addEventListener('change', refresh);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      let ok = true;
      for (const it of items) {
        const missingModel = !it.model.value.trim();
        const badQty = !(wholeValue(it.quantity) > 0);
        const badCode = !missingModel && lettersError(it.code.value, it.model.value, { capacity: wholeValue(it.capacity), pending: pendingAbove(it) });
        setFieldError(it.model, missingModel ? 'Qual é o frasco?' : null);
        setFieldError(it.code, badCode || null);
        setFieldError(it.quantity, badQty ? 'Quantos?' : null);
        if (missingModel || badQty || badCode) ok = false;
      }
      if (!ok) { form.querySelector('[aria-invalid=true]')?.focus(); return; }
      refresh();
      const data = items.map((it) => ({
        collection: head.collection.value,
        supplier: head.supplier.value,
        bought_on: head.bought_on.value,
        model: it.model.value,
        code: it.code.value,
        capacity_ml: wholeValue(it.capacity),
        quantity: wholeValue(it.quantity),
        unit_cost_cents: moneyCents(it.unit),
        lid_cost_cents: moneyCents(it.lidCost),
        shipping_cents: it.shippingCents,
        lid: it.lid.value,
        glass: it.glass.value,
        dimensions: it.dimensions.value,
        price_cents: moneyCents(it.price),
        description: it.description.value,
      }));
      const submit = form.querySelector('[type=submit]');
      submit.disabled = true;
      try {
        const saved = await window.api.jars.create(data);
        await reload();
        close();
        const jars = saved.reduce((sum, l) => sum + l.quantity, 0);
        toast(`${plural(jars, 'frasco registrado', 'frascos registrados')} no estoque`);
      } catch (err) {
        showError(err);
        submit.disabled = false;
      }
    });
    return form;
  });

  addItem();
  head.supplier.focus();
  return dialog;
}

// ---- edit one lot -------------------------------------------------------------------

export function lotForm(lot) {
  const s = suggestions();
  const f = {
    model: text('model', { value: lot.model }),
    code: lettersInput(lot.code ?? suggestLetters(lot.model, { capacity: lot.capacity_ml, lotId: lot.id })),
    capacity: whole('capacity_ml', lot.capacity_ml),
    quantity: whole('quantity', lot.quantity),
    collection: text('collection', { value: lot.collection ?? '' }),
    supplier: text('supplier', { value: lot.supplier ?? '' }),
    bought_on: text('bought_on', { type: 'date', value: lot.bought_on ?? '' }),
    unit: moneyInput('unit_cost', lot.unit_cost_cents),
    lidCost: moneyInput('lid_cost', lot.lid_cost_cents),
    shipping: moneyInput('shipping', lot.shipping_cents),
    lid: text('lid', { value: lot.lid ?? '' }),
    glass: text('glass', { value: lot.glass ?? '' }),
    dimensions: text('dimensions', { value: lot.dimensions ?? '' }),
    price: moneyInput('price', lot.price_cents),
    description: h('textarea', { name: 'description', rows: 2, value: lot.description ?? '' }),
    notes: h('textarea', { name: 'notes', rows: 2, value: lot.notes ?? '' }),
  };
  const costLine = h('p', { class: 'item-computed span-2' });
  const refresh = () => {
    const parts = [moneyCents(f.unit), moneyCents(f.lidCost), moneyCents(f.shipping)];
    costLine.textContent = `Custo de cada frasco: ${money(parts.reduce((sum, c) => sum + (c ?? 0), 0))}`;
  };

  openDialog('modal', (close) => {
    const form = h('form', { class: 'modal-body', novalidate: true },
      h('h2', { class: 'modal-title' }, `Editar “${lotLabel(lot)}”`),
      h('div', { class: 'form-grid lot-grid' },
        h('div', { class: 'span-2 item-model' }, field('Frasco', combobox(f.model, s.models)), field('Sigla', f.code)),
        field('Capacidade (mL)', f.capacity),
        field('Quantidade comprada', f.quantity, lot.used ? `${plural(lot.used, 'já virou terrário', 'já viraram terrários')}` : null),
        field('Coleção ou lote', combobox(f.collection, s.collections)),
        field('Local da compra', combobox(f.supplier, s.suppliers)),
        field('Data da compra', f.bought_on),
        field('Tampa', combobox(f.lid, s.lids)),
        field('Valor de cada frasco', f.unit),
        field('Tampa comprada à parte', f.lidCost),
        field('Frete de cada frasco', f.shipping),
        field('Preço sugerido do terrário', f.price),
        costLine,
        field('Composição do vidro', combobox(f.glass, s.glass)),
        field('Dimensões', f.dimensions),
        h('div', { class: 'span-2' }, field('Descrição', f.description, 'Sugerida para os terrários feitos com este frasco')),
        h('div', { class: 'span-2' }, field('Observações', f.notes)),
      ),
      h('div', { class: 'modal-actions' },
        h('button', { type: 'button', class: 'btn btn-quiet', onclick: () => close() }, 'Cancelar'),
        h('button', { type: 'submit', class: 'btn btn-primary' }, 'Salvar alterações'),
      ),
    );
    form.addEventListener('input', refresh);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const qty = wholeValue(f.quantity);
      setFieldError(f.model, f.model.value.trim() ? null : 'Qual é o frasco?');
      setFieldError(f.code, f.model.value.trim() ? lettersError(f.code.value, f.model.value, { capacity: wholeValue(f.capacity), lotId: lot.id }) : null);
      setFieldError(f.quantity, !(qty > 0) ? 'Quantos foram comprados?'
        : qty < lot.used ? `Pelo menos ${lot.used}: é quantos já viraram terrários` : null);
      const invalid = form.querySelector('[aria-invalid=true]');
      if (invalid) { invalid.focus(); return; }
      try {
        await window.api.jars.update(lot.id, {
          model: f.model.value,
          code: f.code.value,
          capacity_ml: wholeValue(f.capacity),
          quantity: qty,
          collection: f.collection.value,
          supplier: f.supplier.value,
          bought_on: f.bought_on.value,
          unit_cost_cents: moneyCents(f.unit),
          lid_cost_cents: moneyCents(f.lidCost),
          shipping_cents: moneyCents(f.shipping),
          lid: f.lid.value,
          glass: f.glass.value,
          dimensions: f.dimensions.value,
          price_cents: moneyCents(f.price),
          description: f.description.value,
          notes: f.notes.value,
        });
        await reload();
        close();
        toast('Lote atualizado');
        showLot(lot.id);
      } catch (err) { showError(err); }
    });
    return form;
  });
  refresh();
  f.model.focus();
}

// Used by the terrarium form: a jar lot's label with what's left, e.g.
// "Frasco boca larga 250 mL — Lojalab (2 em estoque)".
export function lotOptionLabel(lot) {
  const stock = lotStock(lot);
  return `${lot.code ? `${lot.code} · ` : ''}${lotLabel(lot)}${lot.supplier ? ` — ${lot.supplier}` : ''} (${stock > 0 ? `${stock} em estoque` : 'sem estoque'})`;
}
