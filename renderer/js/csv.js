// The app's data as spreadsheets (CSV), laid out the way Excel and LibreOffice open them in
// Portuguese: semicolons between columns, decimal commas, dd/mm/yyyy dates, and a byte-order
// mark so accents come out right.
import { formatPhone, instagramLabel } from './format.js';
import { state, buyerList, lotById, lotCost, lotStock, lotLabel, profit, STATUS_LABELS } from './state.js';

const BOM = '\uFEFF';

const cell = (value) => {
  if (value == null) return '';
  const text = String(value);
  return /[";\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};
const amount = (cents) => (cents == null ? '' : (cents / 100).toFixed(2).replace('.', ','));
const day = (iso) => (iso ? iso.split('-').reverse().join('/') : '');

// `columns` are [header, value(row)] pairs.
export function toCsv(columns, rows) {
  const lines = [
    columns.map(([header]) => cell(header)).join(';'),
    ...rows.map((row) => columns.map(([, value]) => cell(value(row))).join(';')),
  ];
  return BOM + lines.join('\r\n') + '\r\n';
}

const LOT_COLUMNS = [
  ['Coleção', (l) => l.collection],
  ['Frasco', (l) => lotLabel(l)],
  ['Capacidade (mL)', (l) => l.capacity_ml],
  ['Tampa', (l) => l.lid],
  ['Composição do vidro', (l) => l.glass],
  ['Dimensões', (l) => l.dimensions],
  ['Local da compra', (l) => l.supplier],
  ['Data da compra', (l) => day(l.bought_on)],
  ['Unidades', (l) => l.quantity],
  ['Viraram terrários', (l) => l.used],
  ['Em estoque', (l) => lotStock(l)],
  ['Valor unitário', (l) => amount(l.unit_cost_cents)],
  ['Tampa à parte', (l) => amount(l.lid_cost_cents)],
  ['Frete por unidade', (l) => amount(l.shipping_cents)],
  ['Custo por unidade', (l) => amount(lotCost(l))],
  ['Preço sugerido', (l) => amount(l.price_cents)],
  ['Descrição', (l) => l.description],
  ['Observações', (l) => l.notes],
];

const TERRARIUM_COLUMNS = [
  ['Nome', (t) => t.name],
  ['Situação', (t) => STATUS_LABELS[t.status]],
  ['Tamanho', (t) => t.size],
  ['Recipiente', (t) => t.container],
  ['Coleção', (t) => lotById(t.lot_id)?.collection],
  ['Feito em', (t) => day(t.made_on)],
  ['Custo do material', (t) => amount(t.cost_cents)],
  ['Preço pedido', (t) => amount(t.price_cents)],
  ['Data da saída', (t) => day(t.sold_on)],
  ['Data da entrega', (t) => day(t.delivered_on)],
  ['Valor da venda', (t) => amount(t.sold_price_cents)],
  ['Lucro', (t) => amount(profit(t))],
  ['Comprador ou destinatário', (t) => t.buyer],
  ['De onde veio a venda', (t) => t.channel],
  ['Celular', (t) => formatPhone(t.buyer_phone)],
  ['Instagram', (t) => instagramLabel(t.buyer_instagram)],
  ['Observações da saída', (t) => t.sale_notes],
  ['Descrição', (t) => t.description],
  ['Plantas e conteúdo', (t) => t.plants],
  ['Observações', (t) => t.notes],
];

const BUYER_COLUMNS = [
  ['Nome', (b) => b.name],
  ['Celular', (b) => formatPhone(b.phone)],
  ['Instagram', (b) => instagramLabel(b.instagram)],
  ['Compras', (b) => b.purchases.length],
  ['Total gasto', (b) => amount(b.total)],
  ['Primeira compra', (b) => day(b.first)],
  ['Última compra', (b) => day(b.last)],
  ['Cortesias recebidas', (b) => b.gifts.length],
  ['Observações', (b) => b.notes],
];

// The three files, oldest records first (the order they were entered, like a spreadsheet).
export function exportFiles() {
  const byId = (a, b) => a.id - b.id;
  return [
    { name: 'frascos.csv', content: toCsv(LOT_COLUMNS, [...state.lots].sort(byId)) },
    { name: 'terrarios.csv', content: toCsv(TERRARIUM_COLUMNS, [...state.items].sort(byId)) },
    { name: 'compradores.csv', content: toCsv(BUYER_COLUMNS, buyerList()) },
  ];
}
