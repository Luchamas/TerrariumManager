import { h, toast, showError } from '../ui.js';
import { CURRENCIES, getCurrency, setCurrency, locale } from '../format.js';
import { state, reload } from '../state.js';

export function mount(root) {
  const currency = h('select', { id: 'currency' },
    CURRENCIES.map(([code, name]) => h('option', { value: code }, `${name} (${code})`)));
  currency.value = getCurrency();
  currency.addEventListener('change', async () => {
    try {
      await window.api.settings.set('currency', currency.value);
      state.settings.currency = currency.value;
      setCurrency(currency.value);
      await reload();
      toast('Moeda alterada');
    } catch (err) { showError(err); }
  });

  const dataFile = h('code', { class: 'path' });
  const dataSize = h('span', {});
  const lastBackup = h('span', {});
  const version = h('span', {});

  async function refreshInfo() {
    const info = await window.api.data.info();
    dataFile.textContent = info.dbFile;
    dataSize.textContent = `${(info.sizeBytes / 1024 / 1024).toLocaleString(locale, { maximumFractionDigits: 1 })} MB`;
    lastBackup.textContent = info.lastAutoBackup
      ? `Cópia automática mais recente: ${info.lastAutoBackup}.`
      : 'Ainda não há cópia automática.';
    version.textContent = info.version;
  }

  const action = (label, fn, cls = 'btn') => h('button', { type: 'button', class: cls, onclick: fn }, label);

  root.replaceChildren(
    h('header', { class: 'view-head' }, h('div', {}, h('h1', {}, 'Configurações'))),

    h('section', { class: 'panel settings' },
      h('h2', { class: 'panel-title' }, 'Valores'),
      h('div', { class: 'setting-row' },
        h('label', { for: 'currency' }, 'Moeda'),
        currency,
      ),
      h('p', { class: 'panel-sub' }, 'Trocar a moeda muda só o símbolo. Os valores já cadastrados continuam os mesmos.'),
    ),

    h('section', { class: 'panel settings' },
      h('h2', { class: 'panel-title' }, 'Seus dados'),
      h('p', {}, 'Tudo fica salvo neste computador, em um único arquivo:'),
      h('p', {}, dataFile, ' ', dataSize),
      h('div', { class: 'button-row' },
        action('Abrir pasta dos dados', () => window.api.data.openFolder()),
      ),
    ),

    h('section', { class: 'panel settings' },
      h('h2', { class: 'panel-title' }, 'Backup'),
      h('p', {}, 'O aplicativo guarda uma cópia dos seus dados de cada um dos últimos 14 dias em que foi aberto. ', lastBackup),
      h('p', {}, 'Para não perder nada se o computador der problema, salve de vez em quando um backup em um pen drive ou numa pasta na nuvem.'),
      h('div', { class: 'button-row' },
        action('Salvar um backup…', async () => {
          try {
            const file = await window.api.data.backup();
            if (file) toast(`Backup salvo em ${file}`);
          } catch (err) { showError(err); }
        }, 'btn btn-primary'),
        action('Restaurar um backup…', async () => {
          try {
            const file = await window.api.data.restore();
            if (!file) return;
            state.settings = await window.api.settings.get();
            if (state.settings.currency) setCurrency(state.settings.currency);
            currency.value = getCurrency();
            await reload();
            await refreshInfo();
            toast('Backup restaurado');
          } catch (err) { showError(err); }
        }),
      ),
    ),

    h('p', { class: 'about' }, 'Terrarium Manager ', version),
  );

  refreshInfo().catch(showError);
  return { update: () => refreshInfo().catch(showError) };
}
