// Dialogs for a single terrarium: details, add/edit, mark as sold.
import { h, openDialog, confirmDialog, field, setFieldError, toast, showError } from './ui.js';
import { money, date, todayISO, formatPhone } from './format.js';
import { jar, preparePhoto, photoUrl, sprout } from './photo.js';
import { moneyInput, moneyCents } from './money-input.js';
import { buyerFields, showBuyer } from './buyer.js';
import { SIZES, compareSizes, sizeLabel } from './sizes.js';
import { state, reload, profit as profitOf } from './state.js';


const byId = (id) => state.items.find((t) => t.id === id);

// ---- details --------------------------------------------------------------------

export function showDetails(id) {
  const t = byId(id);
  if (!t) return;
  const sold = t.status === 'sold';
  const profit = profitOf(t);

  const fact = (label, value) => (value ? [h('dt', {}, label), h('dd', {}, value)] : null);

  openDialog('drawer', (close) => [
    h('div', { class: 'drawer-head' },
      h('button', { type: 'button', class: 'btn btn-quiet btn-icon', 'aria-label': 'Fechar', onclick: () => close() }, '✕'),
    ),
    h('div', { class: 'drawer-body' },
      jar(t, { size: 'jar-large' }),
      h('h2', { class: 'drawer-title' }, t.name),
      h('p', { class: 'drawer-sub' }, [sizeLabel(t.size), t.container].filter(Boolean).join(', ') || 'Sem tamanho ou recipiente informado'),
      sold
        ? h('section', { class: 'sale-block' },
            h('p', { class: 'sale-line' },
              h('span', { class: 'tag tag-sold' }, 'Vendido'),
              ` em ${date(t.sold_on)}`,
              t.buyer
                ? [' para ', h('button', { type: 'button', class: 'link', onclick: () => { close(); showBuyer(t.buyer_id); } }, t.buyer)]
                : null,
            ),
            h('dl', { class: 'facts' },
              fact('Valor da venda', money(t.sold_price_cents)),
              fact('Lucro', profit == null ? null : money(profit)),
              fact('Celular', t.buyer_phone && formatPhone(t.buyer_phone)),
              fact('Observações da venda', t.sale_notes),
            ),
          )
        : null,
      h('dl', { class: 'facts' },
        fact('Feito em', t.made_on && date(t.made_on)),
        fact('Custo do material', t.cost_cents != null && money(t.cost_cents)),
        fact('Preço pedido', t.price_cents != null && money(t.price_cents)),
        fact('Descrição', t.description),
        fact('Plantas e conteúdo', t.plants),
        fact('Observações', t.notes),
      ),
    ),
    h('div', { class: 'drawer-actions' },
      sold
        ? h('button', { type: 'button', class: 'btn', onclick: async () => {
            const ok = await confirmDialog({
              title: 'Voltar para a prateleira?',
              message: `A venda de “${t.name}” (data, valor e comprador) será apagada.`,
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
        : h('button', { type: 'button', class: 'btn btn-primary', onclick: () => { close(); sellDialog(t.id); } }, 'Marcar como vendido'),
      h('button', { type: 'button', class: 'btn', onclick: () => { close(); editDialog(t.id); } }, 'Editar'),
      h('button', { type: 'button', class: 'btn btn-quiet btn-danger-text', onclick: async () => {
        const ok = await confirmDialog({
          title: `Excluir “${t.name}”?`,
          message: 'Isso apaga o terrário, a foto e o registro de venda. Não dá para desfazer.',
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

export function addDialog() {
  terrariumForm(null);
}

export function editDialog(id) {
  const t = byId(id);
  if (t) terrariumForm(t);
}

function terrariumForm(t) {
  const isNew = !t;
  const sizes = [...new Set([...SIZES, ...state.items.map((i) => i.size).filter(Boolean)])].sort(compareSizes);

  // Photo state: undefined = unchanged, null = removed, object = new photo.
  let newPhoto;

  const input = (name, attrs = {}) => h('input', { name, type: 'text', autocomplete: 'off', ...attrs });

  const f = {
    name: input('name', { value: t?.name ?? '', required: true, maxLength: 120 }),
    size: input('size', { value: t?.size ?? '', list: 'size-options', placeholder: 'Ex.: Pequeno, Médio, Grande' }),
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
    isSold: h('input', { type: 'checkbox', name: 'isSold', checked: t?.status === 'sold' }),
    sold_on: input('sold_on', { type: 'date', value: t?.sold_on ?? todayISO() }),
    sold_price: moneyInput('sold_price', t?.sold_price_cents),
    buyer: buyerFields({ name: t?.buyer, phone: t?.buyer_phone }),
    sale_notes: h('textarea', { name: 'sale_notes', rows: 2, value: t?.sale_notes ?? '' }),
  };

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

  // ---- sale fields toggle
  const saleFields = h('div', { class: 'form-grid sale-fields' },
    field('Vendido em', f.sold_on),
    field('Valor da venda', f.sold_price),
    f.buyer.nameField,
    f.buyer.phoneField,
    h('div', { class: 'span-2' }, field('Observações da venda', f.sale_notes)),
    f.buyer.options,
  );
  const syncSale = () => { saleFields.hidden = !f.isSold.checked; };
  f.isSold.addEventListener('change', syncSale);
  syncSale();

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
            field('Tamanho', f.size),
            field('Recipiente', f.container),
            field('Custo do material', f.cost, 'Quanto você gastou com pote, plantas e substrato'),
            field('Preço pedido', f.price),
            h('div', { class: 'span-2' }, field('Descrição', f.description, 'Aparece no Catálogo rápido, junto com as plantas')),
            h('div', { class: 'span-2' }, field('Plantas e conteúdo', f.plants)),
            h('div', { class: 'span-2' }, field('Observações', f.notes, 'Só para você. Não aparece no catálogo.')),
          ),
          h('label', { class: 'check' }, f.isSold, isNew ? ' Já foi vendido' : ' Vendido'),
          saleFields,
        ),
      ),
      h('datalist', { id: 'size-options' }, sizes.map((s) => h('option', { value: s }))),
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
    const sold = f.isSold.checked;
    const data = {
      name: f.name.value,
      size: f.size.value,
      container: f.container.value,
      made_on: f.made_on.value,
      cost_cents: moneyCents(f.cost),
      price_cents: moneyCents(f.price),
      description: f.description.value,
      plants: f.plants.value,
      notes: f.notes.value,
      status: sold ? 'sold' : 'available',
      sold_on: sold ? f.sold_on.value : null,
      sold_price_cents: sold ? moneyCents(f.sold_price) : null,
      ...(sold ? f.buyer.value() : { buyer_name: null, buyer_phone: null }),
      sale_notes: sold ? f.sale_notes.value : null,
    };
    if (sold) {
      check(f.sold_on, f.sold_on.value ? null : 'Escolha a data da venda');
      check(f.sold_price, data.sold_price_cents != null ? null : 'Informe o valor da venda');
      if (!f.buyer.validate()) ok = false;
    } else {
      check(f.sold_on, null);
      check(f.sold_price, null);
    }
    if (!ok) dialog.querySelector('[aria-invalid=true]')?.focus();
    return ok ? data : null;
  }
}

// ---- mark as sold ------------------------------------------------------------------

export function sellDialog(id) {
  const t = byId(id);
  if (!t) return;

  const soldOn = h('input', { type: 'date', name: 'sold_on', value: todayISO(), required: true });
  const price = moneyInput('price', t.price_cents);
  const buyer = buyerFields();
  const notes = h('textarea', { name: 'sale_notes', rows: 2 });

  openDialog('modal modal-small', (close) => {
    const form = h('form', { class: 'modal-body', novalidate: true },
      h('div', { class: 'sell-head' },
        jar(t, { size: 'jar-small' }),
        h('div', {},
          h('h2', { class: 'modal-title' }, 'Marcar como vendido'),
          h('p', { class: 'modal-text' }, t.name),
        ),
      ),
      h('div', { class: 'form-grid' },
        field('Vendido em', soldOn),
        field('Valor da venda', price, t.price_cents != null ? `Preço pedido: ${money(t.price_cents)}` : null),
        buyer.nameField,
        buyer.phoneField,
        h('div', { class: 'span-2' }, field('Observações', notes, 'Opcional. Ex.: entregue em casa, pago no Pix')),
      ),
      buyer.options,
      h('div', { class: 'modal-actions' },
        h('button', { type: 'button', class: 'btn btn-quiet', onclick: () => close() }, 'Cancelar'),
        h('button', { type: 'submit', class: 'btn btn-primary' }, 'Marcar como vendido'),
      ),
    );
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const cents = moneyCents(price);
      setFieldError(price, cents == null ? 'Informe o valor da venda' : null);
      setFieldError(soldOn, soldOn.value ? null : 'Escolha a data da venda');
      buyer.validate();
      const invalid = form.querySelector('[aria-invalid=true]');
      if (invalid) { invalid.focus(); return; }
      try {
        await window.api.terrariums.sell(t.id, {
          sold_on: soldOn.value, sold_price_cents: cents, ...buyer.value(), sale_notes: notes.value,
        });
        await reload();
        close();
        toast(`“${t.name}” vendido por ${money(cents)}`);
      } catch (err) { showError(err); }
    });
    return form;
  });
  const priceInput = price.querySelector('input');
  priceInput.focus();
  priceInput.select();
}
