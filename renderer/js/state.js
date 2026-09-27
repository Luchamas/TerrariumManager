// The app's in-memory copy of the database, refreshed after every change.

export const state = {
  items: [],
  buyers: [],
  lots: [],
  settings: {},
};

const listeners = new Set();

export function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export async function reload() {
  [state.items, state.buyers, state.lots] = await Promise.all([
    window.api.terrariums.list(), window.api.buyers.list(), window.api.jars.list(),
  ]);
  for (const fn of listeners) fn(state);
}

// Still on the shelf: for sale, or kept in the personal collection (Acervo pessoal), which can
// be sold too but isn't advertised.
export const onShelf = () => state.items.filter((t) => t.status === 'available' || t.status === 'personal');
export const forSale = () => state.items.filter((t) => t.status === 'available');
export const sold = () => state.items.filter((t) => t.status === 'sold');
export const donated = () => state.items.filter((t) => t.status === 'donated');
export const lost = () => state.items.filter((t) => t.status === 'lost');

// Every status, in the order they're offered, with how it's written.
export const STATUS_LABELS = {
  available: 'Disponível',
  personal: 'Acervo pessoal',
  sold: 'Vendido',
  donated: 'Doado',
  lost: 'Perda',
};
export const leftShelf = (t) => t.status === 'sold' || t.status === 'donated' || t.status === 'lost';

export function profit(t) {
  return t.sold_price_cents != null && t.cost_cents != null ? t.sold_price_cents - t.cost_cents : null;
}

// Buyers with what they bought (newest first), total spent and first/last purchase dates.
// `gifts` are the terrariums they were given (cortesias); they don't count as purchases.
export function buyerList() {
  const byBuyer = (list) => {
    const map = new Map();
    for (const t of list) {
      if (t.buyer_id == null) continue;
      if (!map.has(t.buyer_id)) map.set(t.buyer_id, []);
      map.get(t.buyer_id).push(t);
    }
    return map;
  };
  const salesByBuyer = byBuyer(sold());
  const giftsByBuyer = byBuyer(donated());
  const newestFirst = (x, y) => (y.sold_on ?? '').localeCompare(x.sold_on ?? '') || y.id - x.id;
  return state.buyers.map((b) => {
    const purchases = (salesByBuyer.get(b.id) ?? []).sort(newestFirst);
    return {
      ...b,
      purchases,
      gifts: (giftsByBuyer.get(b.id) ?? []).sort(newestFirst),
      total: purchases.reduce((sum, t) => sum + (t.sold_price_cents ?? 0), 0),
      last: purchases[0]?.sold_on ?? null,
      first: purchases.at(-1)?.sold_on ?? null,
    };
  });
}

// Where sales come from ("De onde veio a venda"): a few suggestions plus every one already
// used, the most used first. Capitals and spaces don't make a new one.
const CHANNELS = ['Instagram', 'WhatsApp', 'Amigos/conhecidos', 'Indicação', 'Feira'];
export function channelOptions() {
  const byKey = new Map();
  const add = (channel, n) => {
    const key = foldName(channel);
    const entry = byKey.get(key) ?? { channel, n: 0 };
    entry.n += n;
    byKey.set(key, entry);
  };
  for (const t of state.items) if (t.channel) add(t.channel, 1);
  for (const c of CHANNELS) add(c, 0);
  return [...byKey.values()].sort((a, b) => b.n - a.n || a.channel.localeCompare(b.channel, 'pt-BR')).map((e) => e.channel);
}

// ---- jar lots ---------------------------------------------------------------------

// What one jar of the lot cost: the jar, its lid if bought separately, and its share of shipping.
export function lotCost(lot) {
  const parts = [lot.unit_cost_cents, lot.lid_cost_cents, lot.shipping_cents];
  return parts.every((c) => c == null) ? null : parts.reduce((sum, c) => sum + (c ?? 0), 0);
}

export const lotStock = (lot) => lot.quantity - lot.used;

// "Frasco boca larga" + 250 mL → "Frasco boca larga 250 mL", unless the model already says it.
export function lotLabel(lot) {
  if (lot.capacity_ml == null || /\d\s*m?l\b/i.test(lot.model)) return lot.model;
  return `${lot.model} ${lot.capacity_ml.toLocaleString('pt-BR')} mL`;
}

export const lotById = (id) => (id == null ? undefined : state.lots.find((l) => l.id === id));

// The buyer with this name, ignoring capitalisation and extra spaces.
export function findBuyer(name) {
  const key = foldName(name);
  return key ? state.buyers.find((b) => foldName(b.name) === key) : undefined;
}

// Must match foldName in src/db.js.
const foldName = (name) => String(name ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('pt-BR');
