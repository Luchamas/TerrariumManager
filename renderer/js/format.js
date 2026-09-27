// Formatting for money and dates. Numbers and dates follow the system locale;
// words (month and currency names) follow the app's language.

export const locale = navigator.language || 'pt-BR';
const UI_LANG = 'pt-BR';

// For sorting names: one shared collator is much faster than localeCompare on every comparison.
export const compareText = new Intl.Collator(locale).compare;

let currency = 'BRL';
let moneyFmt;
let wholeFmt;

export function setCurrency(code) {
  currency = code;
  moneyFmt = new Intl.NumberFormat(locale, { style: 'currency', currency });
  wholeFmt = new Intl.NumberFormat(locale, { style: 'currency', currency, minimumFractionDigits: 0, maximumFractionDigits: 0 });
}
setCurrency(currency);

export const getCurrency = () => currency;

// "R$", "US$", "€"… as the selected currency is written in this locale.
export function currencySymbol() {
  return moneyFmt.formatToParts(0).find((p) => p.type === 'currency')?.value ?? currency;
}

// Best guess at the user's currency from their system region, used until they pick one.
export function guessCurrency() {
  const region = new Intl.Locale(locale).maximize().region;
  const byRegion = {
    BR: 'BRL', US: 'USD', GB: 'GBP', CA: 'CAD', AU: 'AUD', NZ: 'NZD', MX: 'MXN', AR: 'ARS',
    CL: 'CLP', CO: 'COP', PE: 'PEN', UY: 'UYU', JP: 'JPY', CH: 'CHF', SE: 'SEK', NO: 'NOK',
    DK: 'DKK', PL: 'PLN', IN: 'INR', ZA: 'ZAR',
  };
  const euro = ['PT', 'ES', 'FR', 'DE', 'IT', 'NL', 'BE', 'AT', 'IE', 'FI', 'GR', 'LU', 'SK', 'SI', 'EE', 'LV', 'LT', 'HR', 'CY', 'MT'];
  if (byRegion[region]) return byRegion[region];
  if (euro.includes(region)) return 'EUR';
  return 'BRL';
}

const currencyNames = new Intl.DisplayNames(UI_LANG, { type: 'currency' });
export const CURRENCIES = [
  'BRL', 'USD', 'EUR', 'GBP', 'CAD', 'AUD', 'NZD', 'MXN', 'ARS', 'CLP',
  'COP', 'JPY', 'CHF', 'SEK', 'NOK', 'DKK', 'PLN', 'INR', 'ZAR',
].map((code) => [code, capitalize(currencyNames.of(code))]);

export function money(cents) {
  if (cents == null) return '–';
  return moneyFmt.format(cents / 100);
}

// No decimals, for chart axes.
export function moneyWhole(cents) {
  return wholeFmt.format(cents / 100);
}

// Plain number for form fields, e.g. "1234,50" in pt-BR.
export function moneyPlain(cents) {
  if (cents == null) return '';
  return (cents / 100).toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false });
}

// ---- dates (stored as YYYY-MM-DD) -----------------------------------------

export const todayISO = () => new Date().toLocaleDateString('sv-SE');

export function parseISO(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

const dateFmt = new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', year: 'numeric' });
const monthFmt = new Intl.DateTimeFormat(UI_LANG, { month: 'short' });
const monthYearFmt = new Intl.DateTimeFormat(UI_LANG, { month: 'long', year: 'numeric' });
const monthNameFmt = new Intl.DateTimeFormat(UI_LANG, { month: 'long' });

export function date(iso) {
  return iso ? dateFmt.format(parseISO(iso)) : '–';
}

export const monthShort = (d) => monthFmt.format(d);
export const monthYear = (d) => capitalize(monthYearFmt.format(d));
export const monthName = (monthIndex) => capitalize(monthNameFmt.format(new Date(2000, monthIndex, 1)));

// Brazilian phone, formatted as far as it's been typed: (11) 98765-4321 or (11) 3456-7890.
export function formatPhone(digits) {
  const d = String(digits ?? '').replace(/\D/g, '');
  if (!d) return '';
  if (d.length <= 2) return `(${d}`;
  const ddd = d.slice(0, 2);
  const rest = d.slice(2);
  if (rest.length <= 4) return `(${ddd}) ${rest}`;
  const split = rest.length === 9 ? 5 : 4;
  return `(${ddd}) ${rest.slice(0, split)}-${rest.slice(split)}`;
}

// Instagram, as stored: usually one handle ("beltaparo"), sometimes several ("ana / bia") or
// just a name. The handles in it, to link to; a name has none.
export function instagramHandles(text) {
  return String(text ?? '').split(/\s*[/,;]\s*/).map((part) => part.replace(/^@/, '')).filter((part) => /^[\w.]{1,30}$/.test(part));
}

// "beltaparo" → "@beltaparo", "ana / bia" → "@ana / @bia"; a name stays as it is.
export function instagramLabel(text) {
  if (!text) return '';
  return text.split(/\s*[/,;]\s*/).map((part) => (/^@?[\w.]{1,30}$/.test(part) ? `@${part.replace(/^@/, '')}` : part)).join(' / ');
}

export function plural(n, one, many) {
  return `${n.toLocaleString(locale)} ${n === 1 ? one : many}`;
}

function capitalize(text) {
  return text.charAt(0).toLocaleUpperCase(UI_LANG) + text.slice(1);
}
