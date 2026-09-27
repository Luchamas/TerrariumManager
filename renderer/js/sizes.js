// Terrarium sizes: suggested values, their natural order and how they're labelled.
import { compareText } from './format.js';

// Suggested sizes, smallest first. Any other text (e.g. "30 cm") is fine too.
export const SIZES = ['Pequeno', 'Médio', 'Grande'];

// Pequeno < Médio < Grande, then any other sizes alphabetically.
export function compareSizes(a, b) {
  const rank = (s) => (SIZES.includes(s) ? SIZES.indexOf(s) : SIZES.length);
  return rank(a) - rank(b) || compareText(a, b);
}

export const sizeLabel = (size) => (size ? `Tamanho ${size}` : null);
