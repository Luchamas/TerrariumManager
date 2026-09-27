// Catálogo Rápido tab: choose what goes in the catalog and how it looks, with a live
// preview that matches the PDF page for page. Changes are saved as you make them.
import { h, toast, showError, confirmDialog, field } from '../ui.js';
import { money, plural, compareText } from '../format.js';
import { jar, preparePhoto } from '../photo.js';
import { state } from '../state.js';
import {
  PALETTES, COLOR_KEYS, DEFAULT_CATALOG, CATALOG_SORTS,
  loadCatalogConfig, renderCatalog, applyCatalogColors,
} from '../catalog-render.js';

const COLOR_LABELS = {
  page: 'Fundo da página',
  text: 'Texto',
  heading: 'Títulos',
  accent: 'Destaque e preços',
  soft: 'Fundo de cartões e contato',
};

// Which sections are open, kept between visits.
const openSections = new Set(['items', 'header']);

export function mount(root) {
  let cfg = loadCatalogConfig(state.settings);
  let logo = state.settings.catalog_logo || null;
  let pageCount = 0;

  // ---- saving -------------------------------------------------------------------

  let saveTimer;
  async function save() {
    clearTimeout(saveTimer);
    const json = JSON.stringify(cfg);
    if (json === state.settings.catalog_config) return;
    await window.api.settings.set('catalog_config', json);
    state.settings.catalog_config = json;
  }
  const saveSoon = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => save().catch(showError), 400);
  };
  // Every redraw lays out all the pages again, so while typing it waits for a pause.
  const changed = ({ typing = false } = {}) => {
    saveSoon();
    refreshSummary();
    previewSoon(typing ? 350 : 120);
  };
  // Colors don't move anything on the page, so they're applied without a redraw. Still,
  // each change restyles every page: while a color picker is dragged, apply at most every
  // 100 ms (always ending with the latest color).
  let colorTimer = null;
  const colorsChanged = () => {
    saveSoon();
    colorTimer ??= setTimeout(() => {
      colorTimer = null;
      applyCatalogColors(doc, cfg);
    }, 100);
  };

  // ---- page layout ------------------------------------------------------------------

  const summary = h('p', { class: 'view-summary' });
  const exportBtn = h('button', { type: 'button', class: 'btn btn-primary', onclick: exportPdf }, 'Gerar PDF');
  const resetBtn = h('button', { type: 'button', class: 'btn', onclick: resetLook }, 'Restaurar visual padrão');
  const form = h('div', { class: 'designer-form' });
  const doc = h('div', { class: 'catalog-doc is-preview' });
  const sizer = h('div', { class: 'preview-sizer' }, doc);
  const frame = h('div', { class: 'preview-frame', 'aria-label': 'Prévia do catálogo' }, sizer);

  root.replaceChildren(
    h('header', { class: 'view-head' },
      h('div', {}, h('h1', {}, 'Catálogo Rápido'), summary),
      h('div', { class: 'head-actions' }, resetBtn, exportBtn),
    ),
    h('div', { class: 'designer' }, form, frame),
  );

  // ---- controls -------------------------------------------------------------------

  const section = (id, title, ...children) => {
    const el = h('details', { class: 'designer-section', open: openSections.has(id) },
      h('summary', {}, title),
      h('div', { class: 'section-body' }, ...children));
    el.addEventListener('toggle', () => (el.open ? openSections.add(id) : openSections.delete(id)));
    return el;
  };

  const textField = (label, key, { multiline = false, placeholder = '', hint } = {}) => {
    const input = multiline
      ? h('textarea', { rows: 2, value: cfg[key], placeholder })
      : h('input', { type: 'text', value: cfg[key], placeholder, autocomplete: 'off' });
    input.addEventListener('input', () => { cfg[key] = input.value; changed({ typing: true }); });
    return field(label, input, hint);
  };

  const selectField = (label, key, options) => {
    const select = h('select', {}, options.map(([value, text]) => h('option', { value }, text)));
    select.value = cfg[key];
    select.addEventListener('change', () => { cfg[key] = select.value; changed(); });
    return field(label, select);
  };

  const toggle = (label, get, set) => {
    const box = h('input', { type: 'checkbox', checked: get() });
    box.addEventListener('change', () => { set(box.checked); changed(); });
    return h('label', { class: 'check check-compact' }, box, ` ${label}`);
  };

  let choiceSeq = 0;
  // A row of buttons where exactly one is picked.
  const choice = (label, key, options) => {
    const name = `catalog-choice-${++choiceSeq}`;
    return h('fieldset', { class: 'choice' },
      h('legend', {}, label),
      h('div', { class: 'segmented' }, options.map(([value, text, textClass]) => {
        const radio = h('input', { type: 'radio', name, value: String(value), checked: String(cfg[key]) === String(value) });
        radio.addEventListener('change', () => {
          cfg[key] = typeof DEFAULT_CATALOG[key] === 'number' ? Number(value) : value;
          changed();
        });
        return h('label', {}, radio, h('span', { class: textClass }, text));
      })),
    );
  };

  // ---- terrariums -------------------------------------------------------------------

  // Only what's for sale: the personal collection (Acervo pessoal) stays out of the catalog.
  const available = () => state.items.filter((t) => t.status === 'available');
  const pickList = h('div', { class: 'pick-list' });

  function renderPicker() {
    const excluded = new Set(cfg.excluded);
    const items = available().sort((a, b) => compareText(a.name, b.name));
    pickList.replaceChildren(...(items.length
      ? items.map((t) => {
          const box = h('input', { type: 'checkbox', checked: !excluded.has(t.id) });
          box.addEventListener('change', () => {
            const set = new Set(cfg.excluded);
            if (box.checked) set.delete(t.id); else set.add(t.id);
            cfg.excluded = [...set];
            changed();
          });
          return h('label', { class: 'pick' },
            box,
            jar(t, { size: 'jar-tiny' }),
            h('span', { class: 'pick-name' }, t.name,
              h('small', {}, [t.size, t.price_cents != null ? money(t.price_cents) : 'sem preço'].filter(Boolean).join(', '))),
            t.photo_version ? null : h('span', { class: 'pick-flag' }, 'sem foto'),
          );
        })
      : [h('p', { class: 'muted' }, 'Nenhum terrário na prateleira.')]));
  }

  const includeAll = (include) => {
    cfg.excluded = include ? [] : available().map((t) => t.id);
    renderPicker();
    changed();
  };

  // ---- logo -------------------------------------------------------------------------

  const logoBox = h('div', { class: 'logo-box' });
  const logoInput = h('input', { type: 'file', accept: 'image/*', hidden: true });
  logoInput.addEventListener('change', async () => {
    const file = logoInput.files[0];
    logoInput.value = '';
    if (!file) return;
    try {
      const img = await preparePhoto(file, { maxSide: 600, type: 'image/png', background: null });
      URL.revokeObjectURL(img.url);
      await setLogo(await blobToDataUrl(img.blob));
    } catch (err) { showError(err); }
  });

  function renderLogo() {
    logoBox.replaceChildren(
      h('div', { class: 'logo-thumb' }, logo ? h('img', { src: logo, alt: 'Logo' }) : h('span', {}, 'Sem logo')),
      h('div', { class: 'logo-actions' },
        h('button', { type: 'button', class: 'btn btn-small', onclick: () => logoInput.click() }, logo ? 'Trocar logo…' : 'Escolher logo…'),
        logo ? h('button', { type: 'button', class: 'btn btn-quiet btn-small btn-danger-text', onclick: () => setLogo(null).catch(showError) }, 'Remover') : null,
      ),
      logoInput,
    );
  }

  async function setLogo(dataUrl) {
    await window.api.settings.set('catalog_logo', dataUrl);
    state.settings.catalog_logo = dataUrl;
    logo = dataUrl;
    renderLogo();
    previewSoon();
  }

  // ---- colors -----------------------------------------------------------------------

  const paletteButtons = Object.entries(PALETTES).map(([key, p]) => {
    const dots = ['page', 'heading', 'accent', 'soft'].map((k) => {
      const dot = h('i');
      dot.style.background = p[k];
      return dot;
    });
    return h('button', {
      type: 'button', class: 'palette-btn', dataset: { key },
      onclick: () => {
        cfg.palette = key;
        cfg.colors = Object.fromEntries(COLOR_KEYS.map((k) => [k, p[k]]));
        syncColors();
        colorsChanged();
      },
    }, h('span', { class: 'swatches' }, dots), h('span', {}, p.name));
  });

  const colorInputs = Object.fromEntries(COLOR_KEYS.map((k) => {
    const input = h('input', { type: 'color', 'aria-label': COLOR_LABELS[k] });
    input.addEventListener('input', () => {
      cfg.colors[k] = input.value.toUpperCase();
      cfg.palette = 'custom';
      syncPaletteButtons();
      colorsChanged();
    });
    return [k, input];
  }));

  function syncPaletteButtons() {
    for (const b of paletteButtons) b.setAttribute('aria-pressed', String(b.dataset.key === cfg.palette));
  }
  function syncColors() {
    for (const k of COLOR_KEYS) colorInputs[k].value = cfg.colors[k].toLowerCase();
    syncPaletteButtons();
  }

  // ---- form -------------------------------------------------------------------------

  // "Agrupar por tamanho", plus its page-break option that only applies while grouping.
  function groupingControls() {
    const newPageBox = h('input', { type: 'checkbox', checked: cfg.groupNewPage, disabled: !cfg.groupBySize });
    newPageBox.addEventListener('change', () => { cfg.groupNewPage = newPageBox.checked; changed(); });
    const groupBox = h('input', { type: 'checkbox', checked: cfg.groupBySize });
    groupBox.addEventListener('change', () => {
      cfg.groupBySize = groupBox.checked;
      newPageBox.disabled = !groupBox.checked;
      changed();
    });
    return h('div', { class: 'toggle-group' },
      h('label', { class: 'check check-compact' }, groupBox, ' Agrupar por tamanho'),
      h('label', { class: 'check check-compact sub-option' }, newPageBox, ' Começar cada tamanho em uma página nova'),
      h('p', { class: 'field-hint' }, 'Pequeno, Médio e Grande primeiro; terrários sem tamanho ficam em “Outros”. O tamanho aparece no título de cada grupo.'),
    );
  }

  const showToggle = (label, key) => toggle(label, () => cfg.show[key], (v) => { cfg.show[key] = v; });
  const flagToggle = (label, key) => toggle(label, () => cfg[key], (v) => { cfg[key] = v; });

  function buildForm() {
    form.replaceChildren(
      section('items', 'Terrários',
        h('div', { class: 'button-row tight' },
          h('button', { type: 'button', class: 'btn btn-small', onclick: () => includeAll(true) }, 'Marcar todos'),
          h('button', { type: 'button', class: 'btn btn-small', onclick: () => includeAll(false) }, 'Desmarcar todos'),
        ),
        pickList,
        h('p', { class: 'field-hint' }, 'Terrários novos entram no catálogo automaticamente.'),
        selectField('Ordem', 'sort', Object.entries(CATALOG_SORTS).map(([key, [label]]) => [key, label])),
        groupingControls(),
      ),
      section('header', 'Cabeçalho',
        h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Logo'), logoBox),
        choice('Posição do logo', 'logoPosition', [['left', 'Ao lado do título'], ['top', 'Acima, centralizado']]),
        choice('Tamanho do logo', 'logoSize', [['small', 'Pequeno'], ['medium', 'Médio'], ['large', 'Grande']]),
        textField('Título', 'title'),
        textField('Subtítulo', 'subtitle', { placeholder: 'Ex.: Coleção de primavera' }),
        textField('Contato', 'contact', { multiline: true, placeholder: 'Ex.: Encomendas pelo WhatsApp (11) 98765-4321' }),
        flagToggle('Mostrar quantidade e data', 'showMeta'),
        flagToggle('Linha abaixo do cabeçalho', 'headerLine'),
        flagToggle('Repetir o cabeçalho em todas as páginas', 'repeatHeader'),
      ),
      section('layout', 'Layout',
        choice('Orientação', 'orientation', [['portrait', 'Retrato'], ['landscape', 'Paisagem']]),
        choice('Colunas', 'columns', [[2, '2'], [3, '3'], [4, '4']]),
        choice('Margens', 'margins', [['narrow', 'Estreitas'], ['normal', 'Normais'], ['wide', 'Largas']]),
        choice('Formato da foto', 'photoShape', [['jar', 'Pote'], ['rounded', 'Arredondada'], ['square', 'Reta']]),
        choice('Proporção da foto', 'photoRatio', [['portrait', 'Vertical'], ['square', 'Quadrada'], ['landscape', 'Horizontal']]),
        choice('Estilo dos cartões', 'cardStyle', [['plain', 'Simples'], ['outlined', 'Com borda'], ['filled', 'Com fundo']]),
        choice('Alinhamento do texto', 'align', [['left', 'À esquerda'], ['center', 'Centralizado']]),
        choice('Tamanho do texto', 'textSize', [['small', 'Pequeno'], ['normal', 'Normal'], ['large', 'Grande']]),
      ),
      section('info', 'Informações de cada terrário',
        showToggle('Tamanho', 'size'),
        showToggle('Recipiente', 'container'),
        showToggle('Descrição', 'description'),
        showToggle('Plantas', 'plants'),
        showToggle('Preço', 'price'),
        textField('Texto quando não há preço', 'noPriceText', { hint: 'Deixe em branco para não mostrar nada.' }),
      ),
      section('colors', 'Cores e fontes',
        h('div', { class: 'palette-grid' }, paletteButtons),
        h('div', { class: 'color-list' },
          COLOR_KEYS.map((k) => h('label', { class: 'color-row' }, h('span', {}, COLOR_LABELS[k]), colorInputs[k]))),
        choice('Fontes', 'fonts', [
          ['classic', 'Clássica', 'font-classic'], ['modern', 'Moderna', 'font-modern'], ['elegant', 'Elegante', 'font-elegant'],
        ]),
      ),
      section('footer', 'Rodapé',
        textField('Texto do rodapé', 'footerText', { multiline: true, placeholder: 'Ex.: @terrariosdalu, entregamos em toda a cidade' }),
        flagToggle('Numerar as páginas', 'pageNumbers'),
      ),
    );
    syncColors();
    renderPicker();
    renderLogo();
  }

  // ---- preview ----------------------------------------------------------------------

  async function refreshPreview() {
    try {
      pageCount = await renderCatalog(doc, { config: cfg, logo, items: state.items, preview: true });
    } catch (err) {
      showError(err);
      return;
    }
    fitPreview();
    refreshSummary();
  }
  let previewTimer;
  const previewSoon = (ms = 120) => {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(refreshPreview, ms);
  };

  // Scales the A4 pages down to fit the preview column.
  function fitPreview() {
    const first = doc.firstElementChild;
    if (!first) return;
    const scale = Math.min(1, (frame.clientWidth - 36) / first.offsetWidth);
    doc.style.transform = `scale(${scale})`;
    sizer.style.width = `${first.offsetWidth * scale}px`;
    sizer.style.height = `${doc.offsetHeight * scale}px`;
  }
  const resize = new ResizeObserver(fitPreview);
  resize.observe(frame);

  function refreshSummary() {
    const excluded = new Set(cfg.excluded);
    const shelf = available();
    const total = shelf.length;
    const count = shelf.filter((t) => !excluded.has(t.id)).length;
    summary.textContent = total
      ? `${count} de ${plural(total, 'terrário disponível', 'terrários disponíveis')} no catálogo`
        + (count && pageCount ? `, ${plural(pageCount, 'página', 'páginas')}` : '')
      : 'Nenhum terrário na prateleira.';
    exportBtn.disabled = count === 0;
  }

  // ---- actions ----------------------------------------------------------------------

  // Prints a copy of the preview pages, so the PDF is exactly what the preview shows.
  // The copy sits in a print-only area (.print-root) that's hidden on screen.
  async function exportPdf() {
    exportBtn.disabled = true;
    exportBtn.textContent = 'Gerando…';
    const appTitle = document.title;
    let printRoot;
    try {
      await save();
      await refreshPreview();
      const copy = doc.cloneNode(true);
      copy.classList.remove('is-preview');
      copy.style.transform = '';
      for (const img of copy.querySelectorAll('img[data-full]')) img.src = img.dataset.full;
      printRoot = h('div', { class: 'print-root' }, copy);
      document.body.append(printRoot);
      // Waits for the photos to load, but doesn't decode them: printing passes the JPEGs
      // straight into the PDF, and decoding them all at once could take hundreds of MB.
      await Promise.all([...copy.querySelectorAll('img')].map(loaded));
      document.title = cfg.title.trim() || 'Catálogo'; // becomes the PDF's title
      const file = await window.api.catalog.export();
      if (file) toast(`Catálogo salvo em ${file}`);
    } catch (err) {
      showError(err);
    } finally {
      printRoot?.remove();
      document.title = appTitle;
    }
    exportBtn.textContent = 'Gerar PDF';
    refreshSummary();
  }

  async function resetLook() {
    const ok = await confirmDialog({
      title: 'Restaurar o visual padrão?',
      message: 'Layout, cores, fontes e informações exibidas voltam ao padrão. Os textos, o logo e a escolha dos terrários continuam como estão.',
      confirmLabel: 'Restaurar',
    });
    if (!ok) return;
    const { excluded, sort, groupBySize, groupNewPage, title, subtitle, contact, footerText, noPriceText } = cfg;
    cfg = {
      ...structuredClone(DEFAULT_CATALOG),
      excluded, sort, groupBySize, groupNewPage, title, subtitle, contact, footerText, noPriceText,
    };
    buildForm();
    changed();
  }

  buildForm();
  refreshSummary();
  refreshPreview();

  return {
    update() {
      renderPicker();
      refreshSummary();
      previewSoon();
    },
    destroy() {
      resize.disconnect();
      clearTimeout(previewTimer);
      clearTimeout(colorTimer);
      save().catch(showError);
    },
  };
}

function loaded(img) {
  if (img.complete) return null;
  return new Promise((resolve) => {
    img.addEventListener('load', resolve, { once: true });
    img.addEventListener('error', resolve, { once: true });
  });
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
