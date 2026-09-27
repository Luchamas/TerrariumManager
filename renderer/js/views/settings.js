import { h, toast, showError, openDialog } from '../ui.js';
import { CURRENCIES, getCurrency, setCurrency, locale, money, plural } from '../format.js';
import { state, reload } from '../state.js';

// The `theme` setting; main.js applies it to the whole window.
const THEMES = [['system', 'Igual ao Windows'], ['light', 'Claro'], ['dark', 'Escuro']];

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

  const themeChoices = THEMES.map(([value, label]) => {
    const radio = h('input', { type: 'radio', name: 'theme', value });
    radio.addEventListener('change', async () => {
      try {
        await window.api.settings.set('theme', value);
        state.settings.theme = value;
      } catch (err) { showError(err); }
    });
    return { radio, el: h('label', {}, radio, h('span', {}, label)) };
  });
  const showTheme = () => {
    const theme = state.settings.theme ?? 'system';
    for (const { radio } of themeChoices) radio.checked = radio.value === theme;
  };
  showTheme();

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

  // The spreadsheet import is only offered until it's been done.
  const importBox = h('div', { class: 'import-box' });
  function renderImport() {
    const at = state.settings.sheet_imported_at;
    importBox.replaceChildren(...(at
      ? [h('p', {}, `A planilha “Controle Terrários” foi importada em ${new Date(at).toLocaleDateString(locale)}.`)]
      : [
          h('p', {}, 'Para trazer o que está na planilha “Controle Terrários” (abas Frascos de vidro e VENDIDOS): '
            + 'os frascos viram lotes no estoque, e cada unidade vira um terrário, vendido, doado, perdido ou na prateleira.'),
          h('div', { class: 'button-row' }, action('Importar planilha “Controle Terrários”…', importSheet)),
        ]));
  }

  async function importSheet() {
    try {
      const preview = await window.api.data.importSheetPreview();
      if (!preview || !(await confirmImport(preview))) return;
      const result = await window.api.data.importSheetApply(preview.token);
      state.settings = await window.api.settings.get();
      await reload();
      renderImport();
      await refreshInfo();
      reviewDialog(result.warnings);
    } catch (err) { showError(err); }
  }

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
      h('h2', { class: 'panel-title' }, 'Aparência'),
      h('fieldset', { class: 'choice theme-choice' },
        h('legend', {}, 'Tema'),
        h('div', { class: 'segmented' }, themeChoices.map((c) => c.el)),
      ),
      h('p', { class: 'panel-sub' }, 'Igual ao Windows: fica claro ou escuro conforme o tema do computador.'),
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
            showTheme();
            await reload();
            renderImport();
            await refreshInfo();
            toast('Backup restaurado');
          } catch (err) { showError(err); }
        }),
      ),
    ),

    h('section', { class: 'panel settings' },
      h('h2', { class: 'panel-title' }, 'Planilha'),
      importBox,
    ),

    h('p', { class: 'about' }, 'Terrarium Manager ', version),
  );

  renderImport();
  refreshInfo().catch(showError);
  return { update: () => refreshInfo().catch(showError) };
}

// What the import will add, and the points to review. Resolves true to go ahead.
function confirmImport({ file, summary: s, warnings, existing, knownBuyers }) {
  return new Promise((resolve) => {
    const dialog = openDialog('modal import-modal', (close) =>
      h('form', { method: 'dialog', class: 'modal-body' },
        h('h2', { class: 'modal-title' }, 'Importar a planilha'),
        h('p', { class: 'modal-text' }, `${file} vai acrescentar:`),
        h('ul', { class: 'import-summary' },
          h('li', {}, `${plural(s.lots, 'lote de frascos', 'lotes de frascos')} (${plural(s.jarsBought, 'frasco comprado', 'frascos comprados')}, `
            + `${plural(s.jarsInStock, 'ainda no estoque', 'ainda no estoque')})`),
          h('li', {}, `${plural(s.terrariums, 'terrário', 'terrários')}: ${s.available} disponíveis, ${s.personal} no acervo pessoal, `
            + `${s.sold} vendidos, ${s.donated} doados e ${s.lost} perdas`),
          h('li', {}, `${plural(s.buyers, 'comprador', 'compradores')}${knownBuyers ? ` (${knownBuyers} já cadastrados)` : ''}`),
          h('li', {}, `${money(s.revenueCents)} em vendas`),
        ),
        existing
          ? h('p', { class: 'import-note' }, `Você já tem ${plural(existing, 'terrário', 'terrários')} no aplicativo. `
              + 'Eles continuam como estão. Se forem os mesmos da planilha, vão aparecer duplicados.')
          : null,
        h('p', { class: 'modal-text' }, 'Antes de importar, uma cópia dos seus dados atuais é salva na pasta de backups.'),
        warnings.length
          ? h('details', { class: 'review' },
              h('summary', {}, `${plural(warnings.length, 'ponto', 'pontos')} para revisar depois de importar`),
              h('ol', { class: 'review-list' }, warnings.map((w) => h('li', {}, w))))
          : null,
        h('div', { class: 'modal-actions' },
          h('button', { type: 'button', class: 'btn btn-quiet', onclick: () => close('cancel') }, 'Cancelar'),
          h('button', { type: 'submit', value: 'ok', class: 'btn btn-primary' }, 'Importar'),
        ),
      ),
    );
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'ok'));
  });
}

// After importing: what the spreadsheet couldn't say for sure.
function reviewDialog(warnings) {
  openDialog('modal import-modal', (close) =>
    h('div', { class: 'modal-body' },
      h('h2', { class: 'modal-title' }, 'Planilha importada'),
      h('p', { class: 'modal-text' }, warnings.length
        ? 'Tudo foi importado. Estes pontos a planilha não deixava claro. Vale conferir cada um e corrigir no aplicativo:'
        : 'Tudo foi importado.'),
      warnings.length ? h('ol', { class: 'review-list' }, warnings.map((w) => h('li', {}, w))) : null,
      h('div', { class: 'modal-actions' },
        warnings.length
          ? h('button', { type: 'button', class: 'btn', onclick: async () => {
              try {
                await navigator.clipboard.writeText(warnings.map((w, i) => `${i + 1}. ${w}`).join('\n'));
                toast('Lista copiada');
              } catch (err) { showError(err); }
            } }, 'Copiar lista')
          : null,
        h('button', { type: 'button', class: 'btn btn-primary', onclick: () => close() }, 'Fechar'),
      ),
    ),
  );
}
