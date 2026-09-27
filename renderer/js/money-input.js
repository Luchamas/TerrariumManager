// Price field with a 9999,99 mask and the currency symbol in front.
// Digits fill in from the right, like a banking app: typing 8, 5, 0, 0 gives 85,00.
import { h } from './ui.js';
import { currencySymbol, moneyPlain } from './format.js';

const MAX_DIGITS = 6; // 9999,99

const digitsOf = (text) => text.replace(/\D/g, '').replace(/^0+/, '');

export function moneyInput(name, cents) {
  const input = h('input', {
    type: 'text', name, inputmode: 'numeric', autocomplete: 'off',
    value: moneyPlain(cents), placeholder: moneyPlain(0),
  });
  let previous = input.value;

  const caretToEnd = () => input.setSelectionRange(input.value.length, input.value.length);

  input.addEventListener('input', (e) => {
    const raw = input.value.replace(/\D/g, '');
    const digits = digitsOf(input.value);
    if (digits.length > MAX_DIGITS && digits.length > digitsOf(previous).length) {
      input.value = previous; // already at 9999,99: ignore the extra digit
    } else if (digits) {
      input.value = moneyPlain(Number(digits));
    } else {
      // Only zeros: typing 0 shows 0,00; deleting down to nothing clears the field.
      input.value = raw && !e.inputType?.startsWith('delete') ? moneyPlain(0) : '';
    }
    previous = input.value;
    caretToEnd();
  });
  // Typing always happens at the end, so keep the caret there unless text is being selected.
  input.addEventListener('click', () => {
    if (input.selectionStart === input.selectionEnd) caretToEnd();
  });

  const box = h('div', { class: 'money-field', onclick: () => input.focus() },
    h('span', { class: 'money-prefix', 'aria-hidden': 'true' }, currencySymbol()),
    input,
  );
  return box;
}

// Fills in a moneyInput, as if the amount had been typed (null empties it).
export function setMoney(box, cents) {
  const input = box.querySelector('input');
  input.value = moneyPlain(cents);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

// Cents typed in a moneyInput, or null when it's empty.
export function moneyCents(box) {
  const digits = box.querySelector('input').value.replace(/\D/g, '');
  return digits ? Number(digits) : null;
}
