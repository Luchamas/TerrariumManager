// Codes for jars and terrariums. A jar model has 3 letters (FBL for Frasco boca larga 250 mL),
// kept on each of its lots; a terrarium's code is its model's letters and a serial number within
// that model (FBL-0001, FBL-0002…). A model is the jar's name and capacity: Frasco boca larga
// 250 mL and 500 mL are different models, with different letters.
// The names → letters rules must match renderer/js/code.js, which suggests codes in the app.

const STOP_WORDS = new Set(['a', 'o', 'e', 'de', 'da', 'do', 'das', 'dos', 'com', 'em', 'para', 'tp', 'tampa']);
const UNITS = /^(ml|l|cl|cm|mm|g|kg)$/;
const CAPACITY = /\s*\b\d+(?:[.,]\d+)*\s*m?l\b/gi;
const MAX_NUMBER = 9999;
// Letters for terrariums whose jar isn't known at all (the spreadsheet had some).
const NO_MODEL = 'SEM';

const unaccent = (text) => String(text ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');

// "Frasco boca larga 250 mL" → "Frasco boca larga"; "Pote de farmácia, 3 L" → "Pote de farmácia".
const modelName = (text) => String(text ?? '').replace(CAPACITY, '').replace(/[\s,;–-]+$/, '').trim().replace(/\s+/g, ' ');

// The capacity written in a name, in mL: "Pote de farmácia, 3 L" → 3000, "Frasco 1.000 mL" → 1000.
function capacityIn(text) {
  const match = /\b(\d+(?:[.,]\d+)*)\s*(m?l)\b/i.exec(String(text ?? ''));
  if (!match) return null;
  const amount = Number(match[1].replace(/\.(?=\d{3}\b)/g, '').replace(',', '.'));
  return Math.round(match[2].toLowerCase() === 'l' ? amount * 1000 : amount);
}

// A model as { name, capacity }: a lot's model and capacity, or the capacity in its name.
const lotModel = (lot) => ({ name: lot.model, capacity: lot.capacity_ml ?? capacityIn(lot.model) });
const textModel = (text) => ({ name: text, capacity: capacityIn(text) });
const modelKey = ({ name, capacity }) => `${unaccent(modelName(name)).toLowerCase()}|${capacity ?? ''}`;
const modelLabel = ({ name, capacity }) =>
  [modelName(name), capacity != null && `${capacity.toLocaleString('pt-BR')} mL`].filter(Boolean).join(' ');

// Letters from a model's name: "Frasco boca larga" gives FBL, "Garrafa" GAR, "Jarro redondo" JRE.
// If those already name another model (another capacity, say), the next three different letters
// from the name, first letter kept: FRA, FRS, FRC…
function lettersFromName(name, taken) {
  const words = unaccent(name).toLowerCase().split(/[^a-z0-9]+/)
    .filter((w) => w && !STOP_WORDS.has(w) && !UNITS.test(w) && !/\d/.test(w))
    .map((w) => w.toUpperCase());
  if (!words.length) return null;
  const initials = words.map((w) => w[0]).join('');
  const first = (initials + words.at(-1).slice(1) + 'XXX').slice(0, 3);
  if (!taken.has(first)) return first;
  const letters = words.join('');
  for (let i = 1; i < letters.length; i++) {
    for (let j = i + 1; j < letters.length; j++) {
      const pick = letters[0] + letters[i] + letters[j];
      if (new Set(pick).size === 3 && !taken.has(pick)) return pick;
    }
  }
  return first;
}

// Gives a code to every lot and terrarium without one, keeping the codes already given. Models
// get letters in the order their first lot was registered; terrariums are numbered in the order
// they were made. Returns what was given, per letters.
function assignCodes(store) {
  return store.transaction(() => {
    const lots = store.listLots().sort((a, b) => a.id - b.id);
    const lotById = new Map(lots.map((l) => [l.id, l]));
    const items = store.list().sort((a, b) => (a.made_on ?? '9').localeCompare(b.made_on ?? '9') || a.id - b.id);
    const modelOfItem = (t) => (lotById.has(t.lot_id) ? lotModel(lotById.get(t.lot_id)) : textModel(t.container));

    const lettersOf = new Map(); // model key → letters
    const modelOf = new Map(); // letters → model key
    const claim = (key, letters) => {
      if (!lettersOf.has(key)) lettersOf.set(key, letters);
      if (!modelOf.has(letters)) modelOf.set(letters, key);
    };
    for (const l of lots) if (l.code) claim(modelKey(lotModel(l)), l.code);
    for (const t of items) if (t.code) claim(modelKey(modelOfItem(t)), t.code.slice(0, 3));
    const lettersFor = (model) => {
      const key = modelKey(model);
      if (!lettersOf.has(key)) {
        const taken = new Set([...modelOf].filter(([, k]) => k !== key).map(([letters]) => letters));
        const letters = modelName(model.name) ? lettersFromName(modelName(model.name), taken) : null;
        claim(key, letters ?? (taken.has(NO_MODEL) ? lettersFromName('Sem modelo', taken) : NO_MODEL));
      }
      return lettersOf.get(key);
    };

    const given = new Map(); // letters → { model, lots, terrariums }
    const tally = (letters, model) => {
      if (!given.has(letters)) given.set(letters, { model: modelLabel(model) || null, lots: 0, terrariums: [] });
      return given.get(letters);
    };

    for (const l of lots) {
      if (l.code) continue;
      const code = lettersFor(lotModel(l));
      store.updateLot(l.id, { code });
      l.code = code;
      tally(code, lotModel(l)).lots++;
    }

    const last = new Map(); // letters → highest number used
    for (const t of items) {
      if (!t.code) continue;
      const letters = t.code.slice(0, 3);
      last.set(letters, Math.max(last.get(letters) ?? 0, Number(t.code.slice(4))));
    }
    for (const t of items) {
      if (t.code) continue;
      const letters = lotById.get(t.lot_id)?.code ?? lettersFor(modelOfItem(t));
      const n = (last.get(letters) ?? 0) + 1;
      if (n > MAX_NUMBER) throw new Error(`Não há mais números livres para ${letters}.`);
      last.set(letters, n);
      const code = `${letters}-${String(n).padStart(4, '0')}`;
      store.update(t.id, { code });
      tally(letters, modelOfItem(t)).terrariums.push(code);
    }
    return given;
  });
}

module.exports = { assignCodes };
