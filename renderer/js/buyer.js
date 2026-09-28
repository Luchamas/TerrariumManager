// Buyer details panel, buyer editing, and the Comprador + Celular + Instagram fields used when selling.
import { h, openDialog, confirmDialog, field, setFieldError, toast, showError } from './ui.js';
import { money, date, formatPhone, plural, instagramHandles, instagramLabel } from './format.js';
import { jar } from './photo.js';
import { phoneInput, phoneDigits, setPhone } from './phone-input.js';
import { combobox } from './combobox.js';
import { state, reload, buyerList, findBuyer } from './state.js';
import { showDetails } from './terrarium.js';

const canWhatsApp = (phone) => /^\d{10,11}$/.test(phone ?? '');

// ---- details --------------------------------------------------------------------

export function showBuyer(id) {
  const b = buyerList().find((x) => x.id === id);
  if (!b) return;
  const handles = instagramHandles(b.instagram);
  // Where they first came from: the oldest purchase or gift that says.
  const firstChannel = [...b.purchases, ...b.gifts]
    .filter((t) => t.channel)
    .sort((x, y) => (x.sold_on ?? '9').localeCompare(y.sold_on ?? '9') || x.id - y.id)[0]?.channel;
  const phones = [b.phone, b.phone2].filter(Boolean);
  const missing = [!b.phone && 'celular', !b.instagram && 'Instagram'].filter(Boolean);

  openDialog('drawer buyer-drawer', (close) => [
    h('div', { class: 'drawer-head' },
      h('button', { type: 'button', class: 'btn btn-quiet btn-icon', 'aria-label': 'Fechar', onclick: () => close() }, '✕'),
    ),
    h('div', { class: 'drawer-body' },
      h('h2', { class: 'drawer-title' }, b.name),
      h('p', { class: 'drawer-sub' }, b.first ? `Cliente desde ${date(b.first)}` : 'Nenhuma compra registrada'),

      h('section', { class: 'contact' },
        phones.length
          ? phones.map((phone) => h('div', { class: 'contact-number' },
              h('p', { class: 'contact-phone' }, formatPhone(phone)),
              h('div', { class: 'button-row' },
                canWhatsApp(phone)
                  ? h('button', { type: 'button', class: 'btn btn-primary', onclick: () => window.api.contact.whatsapp(phone).catch(showError) }, 'Abrir no WhatsApp')
                  : null,
                h('button', { type: 'button', class: 'btn', onclick: () => copyPhone(phone) }, 'Copiar número'),
              )))
          : h('p', { class: 'contact-empty' }, 'Sem celular cadastrado.'),
        b.instagram
          ? h('div', { class: 'contact-instagram' },
              h('p', { class: 'contact-handle' }, instagramLabel(b.instagram)),
              handles.length
                ? h('div', { class: 'button-row' }, handles.map((handle) => h('button', {
                    type: 'button', class: 'btn', onclick: () => window.api.contact.instagram(handle).catch(showError),
                  }, handles.length > 1 ? `Abrir @${handle}` : 'Abrir no Instagram')))
                : null)
          : null,
        missing.length
          ? h('div', { class: 'button-row' },
              h('button', { type: 'button', class: 'btn', onclick: () => { close(); editBuyer(b.id); } }, `Adicionar ${missing.join(' ou ')}`))
          : null,
      ),

      h('dl', { class: 'facts' },
        firstChannel ? [h('dt', {}, 'Chegou por'), h('dd', {}, firstChannel)] : null,
        h('dt', {}, 'Compras'), h('dd', {}, plural(b.purchases.length, 'terrário', 'terrários')),
        b.purchases.length ? [h('dt', {}, 'Total gasto'), h('dd', {}, money(b.total))] : null,
        b.gifts.length ? [h('dt', {}, 'Cortesias recebidas'), h('dd', {}, plural(b.gifts.length, 'terrário', 'terrários'))] : null,
        b.notes ? [h('dt', {}, 'Observações'), h('dd', {}, b.notes)] : null,
      ),

      b.purchases.length || b.gifts.length
        ? [
            h('h3', { class: 'drawer-section' }, b.gifts.length ? 'Terrários comprados e recebidos' : 'Terrários comprados'),
            h('ul', { class: 'recent' }, [...b.purchases, ...b.gifts]
              .sort((x, y) => (y.sold_on ?? '').localeCompare(x.sold_on ?? '') || y.id - x.id)
              .map((t) => h('li', {},
                h('button', { type: 'button', class: 'recent-item', onclick: () => { close(); showDetails(t.id); } },
                  jar(t, { size: 'jar-tiny' }),
                  h('span', { class: 'recent-name' }, t.name,
                    h('small', {}, `${t.status === 'donated' ? 'Cortesia' : 'Vendido'}${t.sold_on ? ` em ${date(t.sold_on)}` : ''}`)),
                  t.status === 'donated'
                    ? h('span', { class: 'tag tag-donated' }, 'Cortesia')
                    : h('span', { class: 'recent-price' }, money(t.sold_price_cents)),
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
  const phone2 = phoneInput('phone2', b.phone2);
  const instagram = instagramInput('instagram', b.instagram);
  const notes = h('textarea', { name: 'notes', rows: 3, value: b.notes ?? '', placeholder: 'Ex.: prefere retirar no fim de semana' });

  openDialog('modal modal-small', (close) => {
    const form = h('form', { class: 'modal-body', novalidate: true },
      h('h2', { class: 'modal-title' }, 'Editar comprador'),
      h('div', { class: 'form-grid' },
        h('div', { class: 'span-2' }, field('Nome', name, 'Muda o nome em todas as vendas deste comprador')),
        field('Celular', phone),
        field('Celular 2', phone2),
        h('div', { class: 'span-2' }, field('Instagram', instagram)),
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
      const digits2 = phoneDigits(phone2);
      setFieldError(name, name.value.trim() ? null : 'Dê um nome ao comprador');
      for (const [input, d] of [[phone, digits], [phone2, digits2]]) {
        setFieldError(input, d && d.length < 10 ? 'Número incompleto: DDD + número' : null);
      }
      const invalid = form.querySelector('[aria-invalid=true]');
      if (invalid) { invalid.focus(); return; }
      try {
        await window.api.buyers.update(b.id, {
          name: name.value, phone: digits, phone2: digits2, instagram: instagram.value, notes: notes.value,
        });
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

// The Instagram field: the handle, with or without @, or a pasted profile link.
function instagramInput(name, value) {
  return h('input', {
    type: 'text', name, autocomplete: 'off', spellcheck: false, value: value ? instagramLabel(value) : '',
    placeholder: '@usuario', maxLength: 120,
  });
}

// Comprador + Celular + Instagram inputs. Typing the name of someone who bought before fills in
// their phone and Instagram. `label` names the person, e.g. "Para quem" for a gift.
export function buyerFields({ name, phone, instagram, label = 'Comprador' } = {}) {
  const nameInput = h('input', { type: 'text', name: 'buyer', autocomplete: 'off', value: name ?? '', maxLength: 120 });
  const phoneEl = phoneInput('buyer_phone', phone);
  const instagramEl = instagramInput('buyer_instagram', instagram);
  const known = state.buyers.map((b) => ({
    value: b.name, label: b.phone ? formatPhone(b.phone) : b.instagram ? instagramLabel(b.instagram) : null,
  }));
  const nameField = field(label, combobox(nameInput, known), 'Opcional');
  const phoneField = field('Celular', phoneEl);
  const instagramField = field('Instagram', instagramEl);
  const hint = nameField.querySelector('.field-hint');

  // What was filled in from a known buyer, so it can be taken back if the name changes.
  const saved = findBuyer(name);
  let autoPhone = saved?.phone === phone ? phone : null;
  let autoInstagram = saved?.instagram && saved.instagram === instagram ? instagramLabel(instagram) : null;
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
    const typedInstagram = instagramEl.value.trim();
    if (match?.instagram && (!typedInstagram || typedInstagram === autoInstagram)) {
      instagramEl.value = autoInstagram = instagramLabel(match.instagram);
    } else if (!match && autoInstagram && typedInstagram === autoInstagram) {
      instagramEl.value = '';
      autoInstagram = null;
    }
  }
  nameInput.addEventListener('input', sync);
  sync();

  return {
    nameField,
    phoneField,
    instagramField,
    validate() {
      const digits = phoneDigits(phoneEl);
      const missingName = !nameInput.value.trim() && (digits || instagramEl.value.trim());
      const shortPhone = digits && digits.length < 10;
      setFieldError(nameInput, missingName ? 'Informe o nome do comprador' : null);
      setFieldError(phoneEl, shortPhone ? 'Número incompleto: DDD + número' : null);
      return !missingName && !shortPhone;
    },
    value: () => ({ buyer_name: nameInput.value, buyer_phone: phoneDigits(phoneEl), buyer_instagram: instagramEl.value }),
  };
}
