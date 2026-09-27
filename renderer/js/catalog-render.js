// Builds the Catálogo Rápido pages for the live preview in the Catálogo Rápido tab.
// The PDF is printed from a copy of these same pages, so it matches the preview page
// for page. Styles live in renderer/catalog.css.
import { h } from './ui.js';
import { money, date, todayISO, plural, compareText } from './format.js';
import { photoUrl, sprout } from './photo.js';
import { compareSizes, sizeLabel } from './sizes.js';

export const CATALOG_DEFAULT_TITLE = 'Terrários disponíveis';

export const PALETTES = {
  musgo: { name: 'Musgo', page: '#FFFFFF', text: '#1B2420', heading: '#1F3A2E', accent: '#2E6340', soft: '#E3EFE5' },
  oceano: { name: 'Oceano', page: '#FFFFFF', text: '#16232E', heading: '#0F3B57', accent: '#1B6A8F', soft: '#E1EEF4' },
  areia: { name: 'Areia', page: '#FBF8F3', text: '#2A2520', heading: '#4A3B2C', accent: '#9A6B3F', soft: '#F1E8DC' },
  flor: { name: 'Flor', page: '#FFFFFF', text: '#2B1E24', heading: '#5A2A3E', accent: '#B0476E', soft: '#F7E6EC' },
  grafite: { name: 'Grafite', page: '#FFFFFF', text: '#1A1A1A', heading: '#111111', accent: '#444444', soft: '#EFEFEF' },
  noite: { name: 'Noite', page: '#16211C', text: '#DCE5DF', heading: '#F1F7F2', accent: '#8FCB9E', soft: '#22302A' },
};
export const COLOR_KEYS = ['page', 'text', 'heading', 'accent', 'soft'];

const paletteColors = (key) => Object.fromEntries(COLOR_KEYS.map((k) => [k, PALETTES[key][k]]));

export const DEFAULT_CATALOG = {
  // Terrários
  excluded: [], // ids left out; everything else on the shelf is included, new terrariums too
  sort: 'newest',
  groupBySize: false,
  groupNewPage: false, // each size starts on a new page (only when grouping)
  // Cabeçalho
  title: CATALOG_DEFAULT_TITLE,
  subtitle: '',
  contact: '',
  showMeta: true,
  logoPosition: 'left',
  logoSize: 'medium',
  headerLine: true,
  repeatHeader: false,
  // Layout
  orientation: 'portrait',
  margins: 'normal',
  columns: 3,
  photoShape: 'jar',
  photoRatio: 'portrait',
  cardStyle: 'plain',
  align: 'left',
  textSize: 'normal',
  // Informações
  show: { size: true, container: true, description: true, plants: true, price: true },
  noPriceText: 'Preço sob consulta',
  // Cores e fontes
  palette: 'musgo', // or 'custom' once a color is changed by hand
  colors: paletteColors('musgo'),
  fonts: 'classic',
  // Rodapé
  footerText: '',
  pageNumbers: true,
};

// The saved configuration, filled in with defaults for anything missing.
export function loadCatalogConfig(settings) {
  let saved = {};
  try {
    saved = JSON.parse(settings.catalog_config || '{}');
  } catch {
    saved = {};
  }
  if (!settings.catalog_config) {
    // Title and contact typed in the earlier, simpler catalog dialog.
    if (settings.catalog_title) saved.title = settings.catalog_title;
    if (settings.catalog_contact) saved.contact = settings.catalog_contact;
  }
  return {
    ...structuredClone(DEFAULT_CATALOG),
    ...saved,
    show: { ...DEFAULT_CATALOG.show, ...saved.show },
    colors: { ...DEFAULT_CATALOG.colors, ...saved.colors },
    excluded: Array.isArray(saved.excluded) ? saved.excluded : [],
  };
}

export const CATALOG_SORTS = {
  newest: ['Mais recentes', (a, b) => (b.made_on ?? '').localeCompare(a.made_on ?? '') || b.id - a.id],
  name: ['Nome', (a, b) => compareText(a.name, b.name)],
  priceLow: ['Menor preço', (a, b) => (a.price_cents ?? Infinity) - (b.price_cents ?? Infinity)],
  priceHigh: ['Maior preço', (a, b) => (b.price_cents ?? -1) - (a.price_cents ?? -1)],
  size: ['Tamanho', (a, b) => !a.size - !b.size || compareSizes(a.size ?? '', b.size ?? '') || compareText(a.name, b.name)],
};

// The terrariums that go in the catalog, in catalog order.
export function catalogItems(items, cfg) {
  const excluded = new Set(cfg.excluded);
  const sort = (CATALOG_SORTS[cfg.sort] ?? CATALOG_SORTS.newest)[1];
  return items.filter((t) => t.status === 'available' && !excluded.has(t.id)).sort(sort);
}

// Sections of the catalog: one per size (smallest first, no size last) when grouping,
// otherwise a single untitled section. Items keep the chosen order inside each section.
function catalogSections(selected, cfg) {
  if (!cfg.groupBySize) return [{ label: null, items: selected }];
  const sizes = [...new Set(selected.map((t) => t.size).filter(Boolean))].sort(compareSizes);
  const sections = sizes.map((size) => ({ label: size, items: selected.filter((t) => t.size === size) }));
  const unsized = selected.filter((t) => !t.size);
  if (unsized.length) sections.push({ label: 'Outros', items: unsized });
  return sections;
}

// Colors are CSS variables, so changing them doesn't need the pages laid out again.
export function applyCatalogColors(doc, cfg) {
  for (const key of COLOR_KEYS) doc.style.setProperty(`--c-${key}`, cfg.colors[key]);
}

let fontsLoaded;
let logoInfo = { logo: null, ratio: null };

// The logo's proportions, so its size is fixed before it loads. Otherwise the header
// would be measured with a zero-width logo and could grow afterwards. Remembered, so
// the logo isn't decoded again every time the preview is redrawn.
async function logoRatioOf(logo) {
  if (logo && logo !== logoInfo.logo) {
    const probe = new Image();
    probe.src = logo;
    await probe.decode().catch(() => {});
    logoInfo = { logo, ratio: probe.naturalWidth ? probe.naturalWidth / probe.naturalHeight : null };
  }
  return logo ? logoInfo.ratio : null;
}

// Draws the catalog into `doc` as A4 pages and returns how many pages it took.
// Terrariums are placed one at a time; when one no longer fits, it starts a new page.
export async function renderCatalog(doc, { config: cfg, logo, items, preview = false }) {
  fontsLoaded ??= Promise.all([
    document.fonts.load('400 16px Fraunces'), document.fonts.load('600 16px Fraunces'), document.fonts.load('16px Figtree'),
  ]).catch(() => {});
  await fontsLoaded;

  const selected = catalogItems(items, cfg);
  const logoRatio = await logoRatioOf(logo);

  doc.className = [
    'catalog-doc',
    `orient-${cfg.orientation}`, `margins-${cfg.margins}`, `cols-${cfg.columns}`,
    `photo-${cfg.photoShape}`, `ratio-${cfg.photoRatio}`, `card-${cfg.cardStyle}`, `align-${cfg.align}`,
    `text-${cfg.textSize}`, `fonts-${cfg.fonts}`, `logo-${cfg.logoPosition}`, `logo-size-${cfg.logoSize}`,
    cfg.headerLine ? 'header-line' : '',
    preview ? 'is-preview' : '',
  ].filter(Boolean).join(' ');
  doc.style.setProperty('--cols', cfg.columns);
  applyCatalogColors(doc, cfg);
  doc.replaceChildren();

  const hasFooter = cfg.pageNumbers || cfg.footerText.trim();
  const pages = [];
  const newPage = () => {
    const grid = h('div', { class: 'cat-grid' });
    const body = h('div', { class: 'cat-body' }, grid);
    const pageNumber = h('span', { class: 'cat-page-number' }, cfg.pageNumbers ? 'Página 00 de 00' : '');
    const page = h('section', { class: 'cat-page' },
      pages.length === 0 || cfg.repeatHeader ? header(cfg, logo, logoRatio, selected.length) : null,
      body,
      hasFooter ? h('footer', { class: 'cat-footer' }, h('span', { class: 'cat-footer-text' }, cfg.footerText.trim()), pageNumber) : null,
    );
    doc.append(page);
    pages.push({ grid, body, pageNumber });
    return pages.at(-1);
  };

  let current = newPage();
  // Some slack, because printing lays the text out again and it can come out a hair taller.
  const overflows = () => current.grid.offsetHeight > current.body.clientHeight - 12;

  if (!selected.length) current.grid.append(h('p', { class: 'cat-empty' }, 'Nenhum terrário selecionado.'));
  catalogSections(selected, cfg).forEach((section, index) => {
    // A section heading waits for its first card, so it's never left alone at the bottom of a page.
    let heading = null;
    if (section.label) {
      if (index > 0 && cfg.groupNewPage) current = newPage();
      heading = sectionHeading(section);
      current.grid.append(heading);
    }
    for (const t of section.items) {
      const card = itemCard(t, cfg);
      current.grid.append(card);
      const moving = heading ? [heading, card] : [card];
      if (overflows() && current.grid.children.length > moving.length) {
        moving.forEach((el) => el.remove());
        current = newPage();
        if (section.label && !heading) current.grid.append(sectionHeading(section, { continued: true }));
        current.grid.append(...moving);
      }
      heading = null;
    }
  });
  pages.forEach((p, i) => {
    p.pageNumber.textContent = cfg.pageNumbers ? `Página ${i + 1} de ${pages.length}` : '';
  });
  return pages.length;
}

function header(cfg, logo, logoRatio, count) {
  let logoImg = null;
  if (logo) {
    logoImg = h('img', { class: 'cat-logo', src: logo, alt: '' });
    if (logoRatio) logoImg.style.aspectRatio = String(logoRatio);
  }
  return h('header', { class: 'cat-header' },
    logoImg,
    h('div', { class: 'cat-titles' },
      cfg.title.trim() ? h('h1', {}, cfg.title.trim()) : null,
      cfg.subtitle.trim() ? h('p', { class: 'cat-subtitle' }, cfg.subtitle.trim()) : null,
      cfg.showMeta
        ? h('p', { class: 'cat-meta' }, `${plural(count, 'terrário disponível', 'terrários disponíveis')}, atualizado em ${date(todayISO())}`)
        : null,
    ),
    cfg.contact.trim() ? h('p', { class: 'cat-contact' }, cfg.contact.trim()) : null,
  );
}

function sectionHeading(section, { continued = false } = {}) {
  return h('div', { class: 'cat-section' },
    h('h3', {}, continued ? `${section.label} (continuação)` : section.label),
    continued ? null : h('span', { class: 'cat-section-count' }, plural(section.items.length, 'terrário', 'terrários')),
  );
}

function itemCard(t, cfg) {
  const url = photoUrl(t);
  // When grouped, the size is already in the section heading.
  const showSize = cfg.show.size && !cfg.groupBySize;
  const sub = [showSize && sizeLabel(t.size), cfg.show.container && t.container].filter(Boolean).join(', ');
  let price = null;
  if (cfg.show.price) {
    if (t.price_cents != null) price = h('p', { class: 'cat-price' }, money(t.price_cents));
    else if (cfg.noPriceText.trim()) price = h('p', { class: 'cat-price ask' }, cfg.noPriceText.trim());
  }
  // The preview shows the small copy of the photo; the PDF swaps in the full one (data-full).
  return h('article', { class: 'cat-card' },
    h('div', { class: 'cat-photo' }, url ? h('img', { src: url, alt: '', dataset: { full: photoUrl(t, { full: true }) } }) : sprout()),
    h('h2', {}, t.name),
    sub ? h('p', { class: 'cat-sub' }, sub) : null,
    cfg.show.description && t.description ? h('p', { class: 'cat-desc' }, t.description) : null,
    cfg.show.plants && t.plants ? h('p', { class: 'cat-plants' }, h('strong', {}, 'Plantas: '), t.plants) : null,
    price,
  );
}
