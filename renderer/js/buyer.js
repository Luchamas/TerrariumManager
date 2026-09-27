// Buyer details panel, buyer editing, and the Comprador + Celular fields used when selling.
import { h, openDialog, confirmDialog, field, setFieldError, toast, showError } from './ui.js';
import { money, date, formatPhone, plural } from './format.js';
import { jar } from './photo.js';
import { phoneInput, phoneDigits, setPhone } from './phone-input.js';
import { state, reload, buyerList, findBuyer } from './state.js';
import { showDetails } from './terrarium.js';

const canWhatsApp = (phone) => /^\d{10,11}$/.test(phone ?? '');

// ---- details --------------------------------------------------------------------

export function showBuyer(id) {
  const b = buyerList().find((x) => x.id === id);
  if (!b) return;

  openDialog('drawer buyer-drawer', (close) => [
    h('div', { class: 'drawer-head' },
      h('button', { type: 'button', class: 'btn btn-quiet btn-icon', 'aria-label': 'Fechar', onclick: () => close() }, '✕'),
    ),
    h('div', { class: 'drawer-body' },
      h('h2', { class: 'drawer-title' }, b.name),
      h('p', { class: 'drawer-sub' }, b.first ? `Cliente desde ${date(b.first)}` : 'Nenhuma compra registrada'),

      h('section', { class: 'contact' },
        b.phone
          ? [
              h('p', { class: 'contact-phone' }, formatPhone(b.phone)),
              h('div', { class: 'button-row' },
                canWhatsApp(b.phone)
                  ? h('button', { type: 'button', class: 'btn btn-primary', onclick: () => window.api.contact.whatsapp(b.phone).catch(showError) }, 'Abrir no WhatsApp')
                  : null,
                h('button', { type: 'button', class: 'btn', onclick: () => copyPhone(b.phone) }, 'Copiar número'),
              ),
            ]
          : [
              h('p', { class: 'contact-empty' }, 'Sem celular cadastrado.'),
              h('div', { class: 'button-row' },
                h('button', { type: 'button', class: 'btn', onclick: () => { close(); editBuyer(b.id); } }, 'Adicionar celular'),
              ),
            ],
      ),

      h('dl', { class: 'facts' },
        h('dt', {}, 'Compras'), h('dd', {}, plural(b.purchases.length, 'terrário', 'terrários')),
        b.purchases.length ? [h('dt', {}, 'Total gasto'), h('dd', {}, money(b.total))] : null,
        b.notes ? [h('dt', {}, 'Observações'), h('dd', {}, b.notes)] : null,
      ),

      b.purchases.length
        ? [
            h('h3', { class: 'drawer-section' }, 'Terrários comprados'),
            h('ul', { class: 'recent' }, b.purchases.map((t) => h('li', {},
              h('button', { type: 'button', class: 'recent-item', onclick: () => { close(); showDetails(t.id); } },
                jar(t, { size: 'jar-tiny' }),
                h('span', { class: 'recent-name' }, t.name, h('small', {}, `Vendido em ${date(t.sold_on)}`)),
                h('span', { class: 'recent-price' }, money(t.sold_price_cents)),
              )))),
          ]
        : null,
    ),
    h('div', { class: 'drawer-actions' },
      h('button', { type: 'button', class: 'btn', onclick: () => { close(); editBuyer(b.id); } }, 'Editar'),
      h('button', { type: 'button', class: 'btn btn-quiet btn-danger-text', onclick: async () => {
        const ok = await confirmDialog({
          title: `Excluir “${b.name}”?`,
          message: b.purchases.length
            ? `O contato será apagado. ${b.purchases.length === 1 ? 'A venda continua registrada' : 'As vendas continuam registradas'}, mas sem comprador. Não dá para desfazer.`
            : 'O contato será apagado. Não dá para desfazer.',
          confirmLabel: 'Excluir',
          danger: true,
        });
        if (!ok) return;
        try {
          await window.api.buyers.remove(b.id);
          await reload();
          close();
          toast('Comprador excluído');
        } catch (err) { showError(err); }
      } }, 'Excluir'),
    ),
  ]);
}

async function copyPhone(phone) {
  try {
    await navigator.clipboard.writeText(formatPhone(phone));
    toast('Número copiado');
  } catch (err) { showError(err); }
}

// ---- edit ---------------------------------------------------------------------------

export function editBuyer(id) {
  const b = state.buyers.find((x) => x.id === id);
  if (!b) return;
  const name = h('input', { type: 'text', name: 'name', value: b.name, autocomplete: 'off', maxLength: 120 });
  const phone = phoneInput('phone', b.phone);
  const notes = h('textarea', { name: 'notes', rows: 3, value: b.notes ?? '', placeholder: 'Ex.: prefere retirar no fim de semana' });

  openDialog('modal modal-small', (close) => {
    const form = h('form', { class: 'modal-body', novalidate: true },
      h('h2', { class: 'modal-title' }, 'Editar comprador'),
      h('div', { class: 'form-grid' },
        h('div', { class: 'span-2' }, field('Nome', name, 'Muda o nome em todas as vendas deste comprador')),
        h('div', { class: 'span-2' }, field('Celular', phone)),
        h('div', { class: 'span-2' }, field('Observações', notes)),
      ),
      h('div', { class: 'modal-actions' },
        h('button', { type: 'button', class: 'btn btn-quiet', onclick: () => close() }, 'Cancelar'),
        h('button', { type: 'submit', class: 'btn btn-primary' }, 'Salvar alterações'),
      ),
    );
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const digits = phoneDigits(phone);
      setFieldError(name, name.value.trim() ? null : 'Dê um nome ao comprador');
      setFieldError(phone, digits && digits.length < 10 ? 'Número incompleto: DDD + número' : null);
      const invalid = form.querySelector('[aria-invalid=true]');
      if (invalid) { invalid.focus(); return; }
      try {
        await window.api.buyers.update(b.id, { name: name.value, phone: digits, notes: notes.value });
        await reload();
        close();
        toast('Comprador atualizado');
        showBuyer(b.id);
      } catch (err) { showError(err); }
    });
    return form;
  });
  name.focus();
}

// ---- fields for a sale --------------------------------------------------------------

let listSeq = 0;

// Comprador + Celular inputs. Typing the name of someone who bought before fills in their phone.
export function buyerFields({ name, phone } = {}) {
  const listId = `buyer-options-${++listSeq}`;
  const nameInput = h('input', { type: 'text', name: 'buyer', list: listId, autocomplete: 'off', value: name ?? '', maxLength: 120 });
  const phoneEl = phoneInput('buyer_phone', phone);
  const nameField = field('Comprador', nameInput, 'Opcional');
  const phoneField = field('Celular', phoneEl);
  const hint = nameField.querySelector('.field-hint');
  const options = h('datalist', { id: listId },
    state.buyers.map((b) => h('option', { value: b.name, label: b.phone ? formatPhone(b.phone) : '' })));

  let autoPhone = findBuyer(name)?.phone === phone ? phone : null;
  function sync() {
    const match = findBuyer(nameInput.value);
    hint.textContent = match ? 'Cliente já cadastrado' : 'Opcional';
    const typed = phoneDigits(phoneEl);
    if (match?.phone && (!typed || typed === autoPhone)) {
      setPhone(phoneEl, match.phone);
      autoPhone = match.phone;
    } else if (!match && autoPhone && typed === autoPhone) {
      setPhone(phoneEl, '');
      autoPhone = null;
    }
  }
  nameInput.addEventListener('input', sync);
  sync();

  return {
    nameField,
    phoneField,
    options,
    validate() {
      const digits = phoneDigits(phoneEl);
      const missingName = !nameInput.value.trim() && digits;
      const shortPhone = digits && digits.length < 10;
      setFieldError(nameInput, missingName ? 'Informe o nome do comprador' : null);
      setFieldError(phoneEl, shortPhone ? 'Número incompleto: DDD + número' : null);
      return !missingName && !shortPhone;
    },
    value: () => ({ buyer_name: nameInput.value, buyer_phone: phoneDigits(phoneEl) }),
  };
}
