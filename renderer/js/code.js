// Codes for jars and terrariums. A jar model has 3 letters (FBL for Frasco boca larga 250 mL),
// kept on each of its lots; a terrarium's code is its model's letters and a serial number within
// that model (FBL-0001). A model is the jar's name and capacity: Frasco boca larga 250 mL and
// 500 mL are different models, with different letters. The shelf groups terrariums by the letters.
// The names → letters rules must match src/codes.js, which gives codes to imported data.
import { h } from './ui.js';
import { state, lotById, lotLabel } from './state.js';

// Must match CODE_PATTERN and LOT_CODE_PATTERN in src/db.js.
export const CODE_PATTERN = /^[A-Z]{3}-\d{4}$/;
const LETTERS_PATTERN = /^[A-Z]{3}$/;

const MAX_NUMBER = 9999;
const STOP_WORDS = new Set(['a', 'o', 'e', 'de', 'da', 'do', 'das', 'dos', 'com', 'em', 'para', 'tp', 'tampa']);
const UNITS = /^(ml|l|cl|cm|mm|g|kg)$/;
const CAPACITY = /\s*\b\d+(?:[.,]\d+)*\s*m?l\b/gi;

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
const itemModel = (t) => { const lot = lotById(t.lot_id); return lot ? lotModel(lot) : textModel(t.container); };
const modelKey = ({ name, capacity }) => `${unaccent(modelName(name)).toLowerCase()}|${capacity ?? ''}`;
const describe = ({ name, capacity }) =>
  [modelName(name), capacity != null && `${capacity.toLocaleString('pt-BR')} mL`].filter(Boolean).join(' ');

// The code's letters, which name the jar model; '' for a terrarium without a code.
export const codeLetters = (code) => code?.slice(0, 3) ?? '';

// What a terrarium was made in: its jar from stock (with the capacity), or else the Recipiente.
export function modelLabel(t) {
  const lot = lotById(t.lot_id);
  return lot ? lotLabel(lot) : t.container?.trim() || null;
}

// ---- fields -------------------------------------------------------------------------

// "fbl0001", "FBL 1"… → "FBL-0001", as far as it's been typed: 3 letters, then 4 digits.
export function formatCode(text) {
  const chars = unaccent(text).toUpperCase().replace(/[^A-Z0-9]/g, '');
  const letters = /^[A-Z]{0,3}/.exec(chars)[0];
  const digits = chars.slice(letters.length).replace(/\D/g, '').slice(0, 4);
  return letters.length === 3 && digits ? `${letters}-${digits}` : letters;
}

// Where the caret goes in `code` after `n` letters and digits (the hyphen doesn't count).
function caretAfter(code, n) {
  let seen = 0;
  for (let i = 0; i < code.length; i++) {
    if (seen === n) return i;
    if (code[i] !== '-') seen++;
  }
  return code.length;
}

// Keeps a field in `format`, putting the caret back where it was typed.
function masked(input, format) {
  input.addEventListener('input', () => {
    const caret = input.selectionStart;
    const atEnd = caret === input.value.length;
    const typed = input.value.slice(0, caret).replace(/[^A-Za-z0-9]/g, '').length;
    const value = format(input.value);
    if (value === input.value) return;
    input.value = value;
    if (!atEnd) input.setSelectionRange(caretAfter(value, typed), caretAfter(value, typed));
  });
  return input;
}

// A terrarium's code, with a ZZZ-9999 mask. Letters come out in capitals and accents are dropped.
export function codeInput(value) {
  return masked(h('input', {
    type: 'text', name: 'code', autocomplete: 'off', spellcheck: false, maxLength: 8,
    value: value ?? '', placeholder: 'Ex.: FBL-0001', class: 'code-input',
  }), formatCode);
}

// A jar model's 3 letters.
export function lettersInput(value) {
  return masked(h('input', {
    type: 'text', name: 'code', autocomplete: 'off', spellcheck: false, maxLength: 3,
    value: value ?? '', placeholder: 'FBL', class: 'code-input',
  }), (text) => unaccent(text).toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3));
}

// ---- which letters go with which model -------------------------------------------------

// Every model's letters so far, from its lots and its terrariums' codes, as model key →
// { label, letters: Map(letters → how many use them) }. `exceptLot` (with its terrariums) and
// `exceptItem` leave out the lot or terrarium being edited; `pending` adds the other jars
// ({ model, capacity, code }) of a purchase being registered.
function knownModels({ exceptLot = null, exceptItem = null, pending = [] } = {}) {
  const models = new Map();
  const add = (model, letters) => {
    const key = modelKey(model);
    if (!models.has(key)) models.set(key, { label: describe(model), letters: new Map() });
    const m = models.get(key).letters;
    m.set(letters, (m.get(letters) ?? 0) + 1);
  };
  for (const l of state.lots) if (l.code && l.id !== exceptLot) add(lotModel(l), l.code);
  for (const t of state.items) {
    if (t.code && t.id !== exceptItem && (exceptLot == null || t.lot_id !== exceptLot)) add(itemModel(t), codeLetters(t.code));
  }
  for (const p of pending) {
    if (p.code && modelName(p.model)) add({ name: p.model, capacity: p.capacity ?? capacityIn(p.model) }, p.code);
  }
  return models;
}

// The model other than `key` that already uses `letters`, if any.
function ownerOf(letters, key, models) {
  for (const [k, m] of models) if (k !== key && m.letters.has(letters)) return m;
  return null;
}

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

// The letters a model uses (the most used, if they differ), or new ones from its name.
function lettersFor(model, models) {
  const key = modelKey(model);
  const mine = models.get(key)?.letters;
  if (mine?.size) return [...mine].sort((a, b) => b[1] - a[1])[0][0];
  const taken = new Set([...models].filter(([k]) => k !== key).flatMap(([, m]) => [...m.letters.keys()]));
  return lettersFromName(modelName(model.name), taken);
}

// Letters for a jar lot of `model` and `capacity` (mL) ({ lotId } when editing one, { pending }
// in a purchase, see knownModels). '' until there's a model.
export function suggestLetters(model, { capacity = null, lotId = null, pending = [] } = {}) {
  if (!modelName(model)) return '';
  return lettersFor({ name: model, capacity: capacity ?? capacityIn(model) }, knownModels({ exceptLot: lotId, pending })) || '';
}

// What's wrong with the letters typed for a lot of `model` and `capacity`, or null if nothing.
export function lettersError(letters, model, { capacity = null, lotId = null, pending = [] } = {}) {
  if (!letters) return 'Informe as 3 letras';
  if (!LETTERS_PATTERN.test(letters)) return 'Use 3 letras';
  const key = modelKey({ name: model, capacity: capacity ?? capacityIn(model) });
  const other = ownerOf(letters, key, knownModels({ exceptLot: lotId, pending }));
  return other ? `Já são do frasco “${other.label}”` : null;
}

// ---- terrarium codes ------------------------------------------------------------------

// A code for a terrarium made in `lot` (or in `container`, when it's not from stock): the jar's
// letters and the number after the highest one with those letters. `exceptId` is the terrarium
// being edited. '' when there's no model to go by.
export function suggestCode({ lot, container }, exceptId = null) {
  const model = lot ? lotModel(lot) : textModel(container);
  const letters = lot?.code || (modelName(model.name) && lettersFor(model, knownModels({ exceptItem: exceptId })));
  if (!letters) return '';
  const used = new Set(state.items
    .filter((t) => t.id !== exceptId && codeLetters(t.code) === letters)
    .map((t) => Number(t.code.slice(4))));
  let n = Math.max(0, ...used) + 1;
  if (n > MAX_NUMBER) n = Array.from({ length: MAX_NUMBER }, (_, i) => i + 1).find((i) => !used.has(i)) ?? MAX_NUMBER;
  return `${letters}-${String(n).padStart(4, '0')}`;
}

// What's wrong with a code typed for terrarium `saved` (null when new), made in `lot`, or null
// if nothing. A code that doesn't start with its jar's letters is only let through when it was
// saved like that (the jar's letters changed afterwards).
export function codeError(code, { saved = null, lot = null, required = true } = {}) {
  if (!code) return required ? 'Informe o código do terrário' : null;
  if (!CODE_PATTERN.test(code)) return 'Use 3 letras e 4 números, como FBL-0001';
  const clash = state.items.find((t) => t.code === code && t.id !== saved?.id);
  if (clash) return `Esse código já é do terrário “${clash.name}”`;
  const unchanged = saved && saved.code === code && saved.lot_id === (lot?.id ?? null);
  if (lot?.code && codeLetters(code) !== lot.code && !unchanged) {
    return `As letras do frasco escolhido são ${lot.code}: o código começa com ${lot.code}`;
  }
  return null;
}
