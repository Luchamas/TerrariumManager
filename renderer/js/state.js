// The app's in-memory copy of the database, refreshed after every change.

export const state = {
  items: [],
  buyers: [],
  settings: {},
};

const listeners = new Set();

export function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export async function reload() {
  [state.items, state.buyers] = await Promise.all([window.api.terrariums.list(), window.api.buyers.list()]);
  for (const fn of listeners) fn(state);
}

export const onShelf = () => state.items.filter((t) => t.status === 'available');
export const sold = () => state.items.filter((t) => t.status === 'sold');

export function profit(t) {
  return t.sold_price_cents != null && t.cost_cents != null ? t.sold_price_cents - t.cost_cents : null;
}

// Buyers with what they bought (newest first), total spent and first/last purchase dates.
export function buyerList() {
  const salesByBuyer = new Map();
  for (const t of sold()) {
    if (t.buyer_id == null) continue;
    if (!salesByBuyer.has(t.buyer_id)) salesByBuyer.set(t.buyer_id, []);
    salesByBuyer.get(t.buyer_id).push(t);
  }
  return state.buyers.map((b) => {
    const purchases = (salesByBuyer.get(b.id) ?? [])
      .sort((x, y) => (y.sold_on ?? '').localeCompare(x.sold_on ?? '') || y.id - x.id);
    return {
      ...b,
      purchases,
      total: purchases.reduce((sum, t) => sum + (t.sold_price_cents ?? 0), 0),
      last: purchases[0]?.sold_on ?? null,
      first: purchases.at(-1)?.sold_on ?? null,
    };
  });
}

// The buyer with this name, ignoring capitalisation and extra spaces.
export function findBuyer(name) {
  const key = foldName(name);
  return key ? state.buyers.find((b) => foldName(b.name) === key) : undefined;
}

// Must match foldName in src/db.js.
const foldName = (name) => String(name ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('pt-BR');
