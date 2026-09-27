// Terrarium containers: suggested values for the Recipiente field and their order.
import { locale } from './format.js';
import { state, lotLabel } from './state.js';

// Alphabetical, with numbers in numeric order: 20 mL < 80 mL < 100 mL.
export const compareContainers = new Intl.Collator(locale, { numeric: true }).compare;

// The jars bought (see Frascos) and every container already typed, each listed once.
// Case and spacing don't make a new one.
export function containerOptions() {
  const byKey = new Map();
  for (const c of [...state.lots.map(lotLabel), ...state.items.map((t) => t.container)].filter(Boolean)) {
    const key = c.trim().replace(/\s+/g, ' ').toLocaleLowerCase(locale);
    if (!byKey.has(key)) byKey.set(key, c);
  }
  return [...byKey.values()].sort(compareContainers);
}
