// One-time import of the "Controle Terrários" spreadsheet the app replaces.
//
// "Frascos de vidro" has one row per purchase of jars (a lot): what the jar is, how many were
// bought, what one cost, and when they were made into terrariums. What became of each unit was
// shown by the row's colour and free-text notes. "VENDIDOS" lists the sales, but names the jar
// in free text only. Which lot each sale came from, and what happened to the units no sale
// covers, was worked out by hand from the models, capacities, dates, prices, notes and colours
// (SALE_LOTS and OTHER_OUTCOMES below). Rows are checked against what was analysed, so a
// spreadsheet that has changed since is refused rather than imported wrongly. Anything that
// couldn't be settled for sure goes in `warnings`, for the user to review afterwards.

const { excelDate } = require('./xlsx');
const { assignCodes } = require('./codes');

const LOTS = 'Frascos de vidro';
const SALES = 'VENDIDOS';

// VENDIDOS row → the Frascos de vidro row its jar came from. `model` must appear in the sale's
// Modelo ('' = the Modelo is empty); `lot: null` means no lot could be told.
const SALE_LOTS = {
  2: { lot: 4, model: 'jarro' },
  3: { lot: 13, model: '80' },
  4: { lot: 13, model: '80' },
  5: { lot: 14, model: '50' },
  6: { lot: 14, model: '50' },
  7: { lot: 15, model: '20' },
  8: { lot: 12, model: '100' },
  9: { lot: 15, model: '20' },
  10: { lot: 5, model: 'baleiro' },
  11: { lot: 12, model: '100' },
  12: { lot: 12, model: '100' },
  13: { lot: 19, model: 'aluminio' },
  14: { lot: 11, model: '1000' },
  15: { lot: 20, model: 'garrafa' },
  16: { lot: 20, model: 'garrafa' },
  17: { lot: 7, model: '700' },
  18: { lot: 27, model: 'balao' },
  19: { lot: 32, model: '250' },
  20: {
    lot: 21, model: '250',
    guess: 'a data de montagem (02/06/2026) é a da linha 32, mas as duas unidades dela já foram vendidas, '
      + 'segundo a observação daquela linha. Ligada à linha 21 (mesmo frasco, Coleção 2).',
  },
  21: { lot: 25, model: '500' },
  22: { lot: 32, model: '250' },
  23: { lot: 22, model: 'erlenmeyer' },
  24: { lot: 36, model: '250' },
  25: { lot: 41, model: '125' },
  26: { lot: 29, model: '2000' },
  27: {
    lot: 43, model: '125',
    guess: 'o modelo diz 125 mL, mas o valor (82,00) é o preço pedido do frasco de 60 mL (linha 42). '
      + 'Ligada à linha 43 (125 mL), pelo modelo.',
  },
  28: {
    lot: 30, model: 'erlenmeyer',
    guess: 'não há Erlenmeyer de 1000 mL na planilha. Ligada à linha 30 (Erlenmeyer boca estreita 500 mL), '
      + 'que tem a mesma data de montagem e a observação “Vendi 1 peça”.',
  },
  29: { lot: 46, model: '190' },
  30: {
    lot: null, model: '',
    guess: 'não tem modelo nem data da compra. Entrou como um terrário avulso, sem frasco do estoque e sem data de venda.',
  },
};

// What happened to units that aren't in VENDIDOS, from the row colours and notes.
const OTHER_OUTCOMES = {
  2: [{ status: 'donated', note: 'Marcado como doado/publicidade na planilha.' }],
  3: [{ status: 'personal' }],
  5: [
    { status: 'donated', note: 'Planilha: “Vendi 1, doei 1, outro morreu”.' },
    { status: 'lost', note: 'Morreu. Planilha: “Vendi 1, doei 1, outro morreu”.' },
  ],
  6: [{ status: 'lost', note: 'Marcado como perda na planilha (morreu ou quebrou).' }],
  8: [{ status: 'lost', note: 'Marcado como perda na planilha (morreu ou quebrou).' }],
  9: [{ status: 'personal' }],
  10: [{ status: 'personal' }],
  16: [{ status: 'personal' }],
  17: [{ status: 'personal' }],
  18: [{ status: 'personal' }],
};

// Things the colours and notes say that the import can't act on.
const LOT_REVIEW = {
  4: 'a linha está pintada como vendida, mas a aba VENDIDOS só tem 2 das 3 unidades. A terceira ficou como disponível.',
  5: 'a observação diz “Vendi 1, doei 1, outro morreu”. A quarta unidade ficou como disponível.',
  13: 'a observação diz “Vendi 3 uni”, mas a aba VENDIDOS só tem 2 vendas. As outras 2 unidades ficaram como disponíveis.',
  27: 'estava pintada como Acervo pessoal, mas aparece na aba VENDIDOS: entrou como vendida.',
  32: 'estava pintada como Acervo pessoal, mas as duas unidades aparecem na aba VENDIDOS: entraram como vendidas.',
};

// Words each row used here must contain (model + capacity), so rows that moved are noticed.
const LOT_CHECKS = {
  2: ['redondo', '800'], 3: ['quadrado', '750'], 4: ['jarro', '140'], 5: ['baleiro', '180'],
  6: ['cil', '500'], 7: ['cil', '700'], 8: ['cil', '900'], 9: ['cil', '1300'], 10: ['cil', '1800'],
  11: ['garrafa', '1000'], 12: ['potinho', '100'], 13: ['potinho', '80'], 14: ['potinho', '50'],
  15: ['potinho', '20'], 16: ['quadrado', '80'], 17: ['garrafa', '500'], 18: ['floreira'],
  19: ['azeitona'], 20: ['garrafa', '1000'], 21: ['frasco', '250'], 22: ['erlenmeyer', '500'],
  25: ['frasco', '500'], 27: ['balao', '500'], 29: ['frasco', '2000'], 30: ['erlenmeyer', '500'],
  32: ['frasco', '250'], 36: ['frasco', '250'], 41: ['erlenmeyer', '125'], 43: ['frasco', '125'],
  46: ['pote', '190'],
};

// The two "Complementação" groups were told apart only by capital letters.
const COLLECTIONS = {
  'coleção 1': 'Coleção 1',
  'coleção 2': 'Coleção 2',
  'COMPLEMENTAÇÃO': 'Complementação 1',
  'Complementação': 'Complementação 2',
  '5° lote': '5º Lote',
};

// Typos fixed in names, lids, glass and suppliers.
const TYPOS = [
  [/\bCilidric/g, 'Cilíndric'], [/\bcilidric/g, 'cilíndric'],
  [/\bCilindric/g, 'Cilíndric'], [/\bcilindric/g, 'cilíndric'],
  [/\bcilindrig/g, 'cilíndric'], [/\bColindro\b/g, 'Cilindro'],
  [/\bcizal\b/g, 'sisal'], [/\balumn[ií]nio\b/gi, 'alumínio'], [/\bAluminio\b/g, 'Alumínio'], [/\baluminio\b/g, 'alumínio'],
  [/\bAcrilico\b/g, 'Acrílico'], [/\benbalagens\b/g, 'embalagens'],
  [/\brp de cortiça\s*(\d)/g, 'tp de cortiça $1'],
  [/\bBorosilicato\b/gi, 'Borossilicato'], [/^Boro 3\.3$/i, 'Borossilicato 3.3'],
  [/\bbamboo\b/gi, 'bambu'],
];

// ---- plan -------------------------------------------------------------------------------

// Reads the workbook (from readXlsx) and works out everything the import will save, without
// saving anything: { lots, terrariums, buyerNames, warnings, summary }.
function planImport(book, { today = new Date().toISOString().slice(0, 10) } = {}) {
  const lotsSheet = book[LOTS];
  const salesSheet = book[SALES];
  if (!lotsSheet || !salesSheet) {
    throw new Error(`Essa não é a planilha “Controle Terrários”: ela precisa das abas “${LOTS}” e “${SALES}”.`);
  }
  checkHeaders(lotsSheet, LOTS, { C1: 'Modelo', F1: 'Unidades', K1: 'Valor unitário', N1: 'Valor líquido da venda' });
  checkHeaders(salesSheet, SALES, { B1: 'Modelo', D1: 'Unidades', E1: 'Valor total', F1: 'Cliente' });

  const warnings = [];
  const lots = readLots(lotsSheet, warnings);
  const lotByRow = new Map(lots.map((l) => [l.row, l]));

  for (const [row, words] of Object.entries(LOT_CHECKS)) {
    const lot = lotByRow.get(Number(row));
    const text = lot && fold(`${lot.raw.C} ${lot.raw.G ?? ''}`);
    if (!lot || !words.every((w) => text.includes(w))) changed(`${LOTS}, linha ${row}`);
  }

  // Every unit of every lot made into terrariums starts out available; sales and the other
  // outcomes then claim units in turn.
  const units = new Map(lots.filter((l) => l.madeOn).map((l) => [l.row, []]));
  const claim = (lot, count) => {
    const list = units.get(lot.row);
    return !!list && list.length + count <= lot.data.quantity;
  };

  const terrariums = [];
  const loose = []; // sales tied to no lot, added after the lots' terrariums
  let skippedPhones = 0;
  let futureMontagem = 0;

  for (const sale of readSales(salesSheet)) {
    const map = SALE_LOTS[sale.row];
    if (map && !fold(sale.model ?? '').includes(map.model)) changed(`${SALES}, linha ${sale.row}`);
    if (map && map.model === '' && sale.model) changed(`${SALES}, linha ${sale.row}`);
    const ref = `${SALES}, linha ${sale.row} (${sale.units} × “${sale.model ?? 'sem modelo'}”${sale.client ? `, ${sale.client}` : ''})`;

    if (sale.montagem && sale.montagem > today) futureMontagem += 1;
    const soldOn = saleDate(sale.raw.A, `${ref}: data da compra`, warnings);
    const delivered = saleDate(sale.raw.I, `${ref}: data da entrega`, warnings);
    if (soldOn && delivered && delivered < soldOn) {
      warnings.push(`${ref}: a data da entrega (${br(delivered)}) é anterior à da compra (${br(soldOn)}).`);
    }
    if (!sale.raw.A && !map?.guess) warnings.push(`${ref}: sem data da compra. A venda ficou sem data.`);

    const phones = salePhones(sale.raw.G, `${ref}: celular`, warnings);
    if (sale.raw.G && !phones.length) skippedPhones += 1;
    const instagram = tidy(sale.raw.H) === '//' ? null : tidy(sale.raw.H);

    const price = salePrice(sale.raw.E);
    const donated = price.courtesy;
    const notes = [
      donated ? 'Cortesia/publicidade.' : null,
      !donated && sale.units > 1 && price.cents != null ? `${sale.units} vendidos juntos por ${real(price.cents)}.` : null,
      price.text ? `Valor na planilha: ${price.text}.` : null,
    ].filter(Boolean).join('\n');

    let lot = map?.lot ? lotByRow.get(map.lot) : null;
    if (map?.guess) warnings.push(`${ref}: ${map.guess}`);
    if (lot && !claim(lot, sale.units)) {
      warnings.push(`${ref}: o lote da linha ${lot.row} não tem unidades suficientes. Entrou como terrário avulso.`);
      lot = null;
    }
    if (!map) warnings.push(`${ref}: essa venda não estava na planilha analisada. Entrou como terrário avulso, sem frasco do estoque.`);

    const shares = split(price.cents, sale.units);
    for (let i = 0; i < sale.units; i++) {
      const data = {
        status: donated ? 'donated' : 'sold',
        sold_on: soldOn,
        sold_price_cents: donated ? null : shares[i],
        buyer_name: sale.client,
        buyer_phone: phones[0] ?? null,
        buyer_phone2: phones[1] ?? null,
        buyer_instagram: sale.client ? instagram : null,
        channel: tidy(sale.raw.J),
        delivered_on: delivered,
        sale_notes: notes,
      };
      if (lot) units.get(lot.row).push(data);
      else loose.push({ lotRow: null, data: { ...looseTerrarium(sale), ...data } });
    }
  }

  const undated = [];
  for (const [row, outcomes] of Object.entries(OTHER_OUTCOMES)) {
    const lot = lotByRow.get(Number(row));
    if (!lot || !claim(lot, outcomes.length)) changed(`${LOTS}, linha ${row}`);
    for (const o of outcomes) {
      units.get(lot.row).push({ status: o.status, sale_notes: o.note ?? null });
      if (o.status !== 'personal') undated.push(`linha ${row} (${lot.label}, ${o.status === 'lost' ? 'perda' : 'doação'})`);
    }
  }
  if (undated.length) {
    warnings.push(`Doações e perdas sem data na planilha, que ficaram sem data: ${undated.join('; ')}.`);
  }

  for (const [row, text] of Object.entries(LOT_REVIEW)) {
    const lot = lotByRow.get(Number(row));
    if (lot) warnings.push(`${LOTS}, linha ${row} (${lot.label}): ${text}`);
  }
  if (futureMontagem) {
    warnings.push(`A coluna “Data da montagem” da aba ${SALES} não foi usada (${futureMontagem} linhas tinham uma data futura). `
      + 'Cada terrário leva a data de montagem do seu frasco, da aba Frascos de vidro.');
  }
  if (skippedPhones) {
    warnings.push(`${skippedPhones} celulares da aba ${SALES} não foram importados por não serem números completos `
      + '(por exemplo “(99) 999999999” ou “//”). Dá para adicioná-los na página de cada comprador.');
  }

  // Lots with an assembly date become terrariums: first the claimed units, then the rest
  // as available.
  for (const lot of lots) {
    const claimed = units.get(lot.row);
    if (!claimed) continue;
    for (let i = 0; i < lot.data.quantity; i++) {
      terrariums.push({ lotRow: lot.row, data: { ...lotTerrarium(lot), status: 'available', ...claimed[i] } });
    }
  }
  terrariums.push(...loose);

  const count = (status) => terrariums.filter((t) => t.data.status === status).length;
  const used = new Map();
  for (const t of terrariums) if (t.lotRow) used.set(t.lotRow, (used.get(t.lotRow) ?? 0) + 1);
  const buyers = new Set(terrariums.map((t) => t.data.buyer_name && fold(t.data.buyer_name)).filter(Boolean));

  return {
    lots,
    terrariums,
    buyerNames: [...new Set(terrariums.map((t) => t.data.buyer_name).filter(Boolean))],
    warnings,
    summary: {
      lots: lots.length,
      jarsBought: lots.reduce((sum, l) => sum + l.data.quantity, 0),
      jarsInStock: lots.reduce((sum, l) => sum + l.data.quantity - (used.get(l.row) ?? 0), 0),
      terrariums: terrariums.length,
      available: count('available'),
      personal: count('personal'),
      sold: count('sold'),
      donated: count('donated'),
      lost: count('lost'),
      buyers: buyers.size,
      revenueCents: terrariums.reduce((sum, t) => sum + (t.data.sold_price_cents ?? 0), 0),
    },
  };
}

// Saves a plan from planImport, all at once: if anything fails, nothing is saved.
function applyImport(store, plan) {
  checkNotImported(store);
  return store.transaction(() => {
    const lotIds = new Map();
    for (const lot of plan.lots) {
      const [saved] = store.createLots([lot.data]);
      lotIds.set(lot.row, saved.id);
    }
    for (const t of plan.terrariums) {
      store.create({ ...t.data, lot_id: t.lotRow ? lotIds.get(t.lotRow) : null });
    }
    assignCodes(store);
    store.setSetting('sheet_imported_at', new Date().toISOString());
  });
}

// ---- reading the sheets -------------------------------------------------------------------

function readLots(sheet, warnings) {
  const lots = [];
  let collection = null;
  for (let row = 1; row <= lastRow(sheet); row++) {
    const raw = rowOf(sheet, row, 'ABCDEFGHIJKLMNOP');
    if (raw.A != null) collection = collectionName(raw.A);
    if (row === 1 || raw.C == null) continue;

    const model = fixText(raw.C);
    const capacity = capacityOf(raw.G);
    const label = lotLabel(model, capacity);
    const where = `${LOTS}, linha ${row} (${label})`;
    const notes = [];

    const quantity = typeof raw.F === 'number' ? Math.round(raw.F) : Number(digits(raw.F));
    if (!(quantity > 0)) throw new Error(`${where}: a quantidade (“${raw.F ?? ''}”) não é um número.`);

    let boughtOn = typeof raw.J === 'number' ? excelDate(raw.J) : null;
    if (raw.J != null && !boughtOn && !notApplicable(raw.J)) {
      warnings.push(`${where}: a data da compra “${tidy(raw.J)}” não é uma data válida e ficou em branco.`);
      notes.push(`Data da compra na planilha: ${tidy(raw.J)}.`);
    }

    const cost = unitCost(raw.K);
    if (cost.note) notes.push(cost.note);
    const shipping = typeof raw.L === 'number' ? cents(raw.L) : null;
    let unit = cost.unit;
    // The sheet's own total per unit wins when it doesn't add up: it's what was used for pricing.
    if (typeof raw.M === 'number') {
      const sum = (unit ?? 0) + (cost.lid ?? 0) + (shipping ?? 0);
      if (Math.abs(cents(raw.M) - sum) > 1) {
        const before = unit;
        unit = cents(raw.M) - (cost.lid ?? 0) - (shipping ?? 0);
        warnings.push(`${where}: o valor total por unidade (${real(cents(raw.M))}) não é a soma do valor unitário `
          + `(${real(before)}) com o transporte (${real(shipping)}). Valeu o total: o frasco ficou com ${real(unit)}.`);
        notes.push(`Na planilha: valor unitário ${real(before)}, transporte ${real(shipping)}, total ${real(cents(raw.M))}.`);
      }
    }

    let price = typeof raw.N === 'number' ? cents(raw.N) : null;
    if (raw.N != null && price == null) notes.push(`${tidy(raw.N)}.`);
    if (raw.P != null) notes.push(tidy(raw.P));

    lots.push({
      row,
      raw,
      label,
      madeOn: typeof raw.B === 'number' ? excelDate(raw.B) : null,
      data: {
        collection,
        model,
        capacity_ml: capacity,
        lid: lidName(raw.D),
        glass: unknownToNull(fixText(raw.E)),
        dimensions: tidy(raw.H),
        supplier: fixText(raw.I),
        bought_on: boughtOn,
        quantity,
        unit_cost_cents: unit,
        lid_cost_cents: cost.lid,
        shipping_cents: shipping,
        price_cents: price,
        description: fixText(raw.O),
        notes: notes.join('\n') || null,
      },
    });
  }
  return lots;
}

function readSales(sheet) {
  const sales = [];
  for (let row = 2; row <= lastRow(sheet); row++) {
    const raw = rowOf(sheet, row, 'ABCDEFGHIJ');
    if (Object.values(raw).every((v) => v == null)) continue;
    sales.push({
      row,
      raw,
      model: tidy(raw.B),
      montagem: typeof raw.C === 'number' ? excelDate(raw.C) : null,
      units: typeof raw.D === 'number' && raw.D > 0 ? Math.round(raw.D) : 1,
      client: tidy(raw.F),
    });
  }
  return sales;
}

// A terrarium made from a lot's jar.
function lotTerrarium(lot) {
  return {
    name: lot.data.description ?? lot.label,
    size: sizeFor(lot.data.capacity_ml),
    container: lot.label,
    made_on: lot.madeOn,
    cost_cents: lotCost(lot.data),
    price_cents: lot.data.price_cents,
    description: lot.data.description,
  };
}

// A sale that couldn't be tied to a lot.
function looseTerrarium(sale) {
  const model = fixText(sale.model);
  const capacity = capacityOf(sale.model);
  return {
    name: model ?? 'Terrário (modelo não informado na planilha)',
    size: sizeFor(capacity),
    container: model,
    made_on: sale.montagem,
  };
}

const lotCost = (lot) => (lot.unit_cost_cents == null && lot.lid_cost_cents == null && lot.shipping_cents == null
  ? null
  : (lot.unit_cost_cents ?? 0) + (lot.lid_cost_cents ?? 0) + (lot.shipping_cents ?? 0));

// ---- values -----------------------------------------------------------------------------

function unitCost(value) {
  if (typeof value === 'number') return { unit: cents(value), lid: null, note: null };
  const text = tidy(value);
  if (!text || notApplicable(text)) return { unit: null, lid: null, note: null };
  const plus = /^([\d.,]+)\s*\+\s*([\d.,]+)$/.exec(text);
  if (plus) return { unit: amount(plus[1]), lid: amount(plus[2]), note: null }; // jar + lid bought separately
  const aside = /^([\d.,]+)\s*\((.+)\)$/.exec(text);
  if (aside) return { unit: amount(aside[1]), lid: null, note: `Valor unitário: ${aside[2]}.` };
  return { unit: amount(text), lid: null, note: `Valor unitário na planilha: ${text}.` };
}

// "80" → 80,00; "Cortesia/publicidade" → a gift; "92,00 (89,26 c/desconto)" → 89,26, the
// amount actually received, keeping the original text.
function salePrice(value) {
  if (typeof value === 'number') return { cents: cents(value), courtesy: false, text: null };
  const text = tidy(value);
  if (!text) return { cents: null, courtesy: false, text: null };
  if (/cortesia|publicidade|brinde/i.test(text)) return { cents: null, courtesy: true, text: null };
  const discounted = /\(([\d.,]+)\s*c\/\s*desconto\)/i.exec(text);
  return { cents: amount(discounted ? discounted[1] : text), courtesy: false, text };
}

// A phone cell: one number, or two separated by "/" (the second becomes the buyer's Celular 2).
// A DDD typed twice, like "(16)16992026214", is fixed and noted; placeholders like
// "(99) 999999999" or "//" aren't numbers.
function salePhones(value, where, warnings) {
  const phones = [];
  for (const part of String(value ?? '').split(/[/;]/)) {
    let number = digits(part);
    if (number.length >= 12 && number.length <= 13 && number.slice(0, 2) === number.slice(2, 4)) {
      number = number.slice(2);
      warnings.push(`${where} “${tidy(part)}” foi lido como ${phoneText(number)} (DDD repetido).`);
    }
    if (number.length >= 10 && number.length <= 11 && !/^9+$/.test(number)) phones.push(number);
  }
  if (phones.length > 2) warnings.push(`${where}: só os dois primeiros números de “${tidy(value)}” foram importados.`);
  return phones.slice(0, 2);
}

// A date cell: an Excel date, or dd/mm/yyyy typed as text. Obvious typos are fixed and noted.
function saleDate(value, where, warnings) {
  if (value == null) return null;
  if (typeof value === 'number') return excelDate(value);
  const text = tidy(value);
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4,5})$/.exec(text);
  if (m) {
    let [, d, mo, y] = m;
    // A year typed with a digit twice, like 20226 for 2026.
    if (y.length === 5 && /^20[23]\d$/.test(y.replace(/(\d)\1/, '$1'))) y = y.replace(/(\d)\1/, '$1');
    const iso = `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
    if (y.length === 4 && validDate(iso)) {
      if (m[3] !== y) warnings.push(`${where} “${text}” foi lida como ${br(iso)}.`);
      return iso;
    }
  }
  warnings.push(`${where} “${text}” não é uma data válida e ficou em branco.`);
  return null;
}

// The import adds everything it reads, so a second run would add it all again.
function checkNotImported(store) {
  const at = store.getSettings().sheet_imported_at;
  if (at) {
    const day = new Date(at).toLocaleDateString('pt-BR');
    throw new Error(`A planilha já foi importada em ${day}. Importar de novo duplicaria tudo.`);
  }
}

function checkHeaders(sheet, name, expected) {
  for (const [cell, label] of Object.entries(expected)) {
    if (fold(sheet[cell] ?? '') !== fold(label)) {
      throw new Error(`Essa não é a planilha “Controle Terrários”: a aba “${name}” não tem a coluna “${label}” em ${cell}.`);
    }
  }
}

function changed(where) {
  throw new Error(`A planilha mudou desde que foi analisada (${where} não é o que era esperado), `
    + 'então a importação foi cancelada para não misturar os dados. Nada foi alterado.');
}

// ---- helpers ----------------------------------------------------------------------------

const lastRow = (sheet) => Math.max(0, ...Object.keys(sheet).map((ref) => Number(/\d+$/.exec(ref)[0])));
const rowOf = (sheet, row, cols) => Object.fromEntries([...cols].map((c) => [c, sheet[`${c}${row}`] ?? null]));

const tidy = (value) => {
  if (value == null) return null;
  const text = String(value).replace(/\s+/g, ' ').trim();
  return text || null;
};
const fold = (text) => String(text).normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('pt-BR').replace(/\s+/g, ' ').trim();
const digits = (value) => String(value ?? '').replace(/\D/g, '');
const notApplicable = (value) => /n[aã]o (se aplica|informado)/i.test(String(value));
const unknownToNull = (text) => (text && /^n[aã]o especifi/i.test(text) ? null : text);

// Typos fixed, "ml"/"Ml" written as "mL", and the first letter in capitals.
function fixText(value) {
  let text = tidy(value);
  if (!text) return null;
  for (const [pattern, fix] of TYPOS) text = text.replace(pattern, fix);
  text = text.replace(/(\d)\s*ml\b/gi, '$1 mL');
  return text.charAt(0).toLocaleUpperCase('pt-BR') + text.slice(1);
}

// " tampa de vidro (31,00)" → "Vidro": the field is already the lid, and its price is kept
// as the lot's lid cost.
const lidName = (value) => fixText(tidy(value)?.replace(/\s*\([\d.,]+\)\s*$/, '').replace(/^tampa de\s+/i, ''));

function collectionName(value) {
  const text = tidy(value);
  if (!text) return null;
  return COLLECTIONS[text] ?? COLLECTIONS[text.toLocaleLowerCase('pt-BR')] ?? text;
}

function capacityOf(value) {
  const m = /(\d+(?:[.,]\d+)?)\s*m?l\b/i.exec(String(value ?? ''));
  return m ? Math.round(Number(m[1].replace(',', '.'))) : null;
}

// "Frasco boca larga" + 250 → "Frasco boca larga 250 mL"; a model that already says its
// capacity is left as it is.
function lotLabel(model, capacity) {
  if (capacity == null || /\d\s*m?l\b/i.test(model)) return model;
  return `${model} ${capacity} mL`;
}

// Assumed from the capacity: the spreadsheet has no size.
const sizeFor = (ml) => (ml == null ? null : ml < 250 ? 'Pequeno' : ml < 1000 ? 'Médio' : 'Grande');

const cents = (reais) => Math.round(reais * 100);
function amount(text) {
  const m = /\d+(?:[.,]\d+)?/.exec(String(text));
  return m ? cents(Number(m[0].replace(',', '.'))) : null;
}

// Splits a total over `n` units; leftover cents go to the first ones.
function split(total, n) {
  if (total == null) return Array(n).fill(null);
  const base = Math.floor(total / n);
  return Array.from({ length: n }, (_, i) => base + (i < total - base * n ? 1 : 0));
}

const real = (c) => (c == null ? '–' : `R$ ${(c / 100).toFixed(2).replace('.', ',')}`);
const br = (iso) => iso.split('-').reverse().join('/');
const phoneText = (d) => `(${d.slice(0, 2)}) ${d.slice(2, -4)}-${d.slice(-4)}`;
function validDate(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso;
}

module.exports = { planImport, applyImport, checkNotImported };
