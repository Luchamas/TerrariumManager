// Cellphone field with a (99) 99999-9999 mask. Landlines (99) 9999-9999 also fit.
import { h } from './ui.js';
import { formatPhone } from './format.js';

const MAX_DIGITS = 11; // DDD + 9 digits

export function phoneInput(name, digits) {
  const input = h('input', {
    type: 'tel', name, autocomplete: 'off', inputmode: 'tel',
    value: formatPhone(digits), placeholder: '(11) 98765-4321',
  });
  input.addEventListener('input', () => {
    input.value = formatPhone(input.value.replace(/\D/g, '').slice(0, MAX_DIGITS));
  });
  return input;
}

export function setPhone(input, digits) {
  input.value = formatPhone(digits);
}

export const phoneDigits = (input) => input.value.replace(/\D/g, '');
