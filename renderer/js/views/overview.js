import { h, s } from '../ui.js';
import { money, moneyWhole, monthShort, monthYear, plural, locale, todayISO, date } from '../format.js';
import { onShelf, sold, profit } from '../state.js';
import { showDetails } from '../terrarium.js';
import { compareSizes } from '../sizes.js';
import { jar } from '../photo.js';

export function mount(root) {
  const figures = h('div', { class: 'figures' });
  const chartBox = h('div', { class: 'chart' });
  const sizesBox = h('div', {});
  const recentBox = h('div', {});

  root.replaceChildren(
    h('header', { class: 'view-head' }, h('div', {}, h('h1', {}, 'Visão geral'))),
    figures,
    h('section', { class: 'panel' },
      h('h2', { class: 'panel-title' }, 'Vendas por mês'),
      h('p', { class: 'panel-sub' }, 'Faturamento dos últimos 12 meses'),
      chartBox,
    ),
    h('div', { class: 'two-col' },
      h('section', { class: 'panel' }, h('h2', { class: 'panel-title' }, 'Por tamanho'), sizesBox),
      h('section', { class: 'panel' }, h('h2', { class: 'panel-title' }, 'Últimas vendas'), recentBox),
    ),
  );

  let months = [];
  const resize = new ResizeObserver(() => drawChart(chartBox, months));
  resize.observe(chartBox);

  function update() {
    const shelf = onShelf();
    const sales = sold();
    const today = todayISO();
    const thisMonth = today.slice(0, 7);
    const thisYear = today.slice(0, 4);

    const sum = (list, fn) => list.reduce((acc, t) => acc + (fn(t) ?? 0), 0);
    const monthSales = sales.filter((t) => t.sold_on?.startsWith(thisMonth));
    const yearSales = sales.filter((t) => t.sold_on?.startsWith(thisYear));

    const figure = (label, value, detail) =>
      h('div', { class: 'figure' },
        h('span', { class: 'figure-label' }, label),
        h('span', { class: 'figure-value' }, value),
        h('span', { class: 'figure-detail' }, detail));

    figures.replaceChildren(
      figure('Na prateleira', shelf.length.toLocaleString(locale), `somando ${money(sum(shelf, (t) => t.price_cents))} em preço pedido`),
      figure('Vendido este mês', money(sum(monthSales, (t) => t.sold_price_cents)), plural(monthSales.length, 'terrário', 'terrários')),
      figure(`Vendido em ${thisYear}`, money(sum(yearSales, (t) => t.sold_price_cents)), `${money(sum(yearSales, profit))} de lucro`),
      figure('Desde o início', money(sum(sales, (t) => t.sold_price_cents)), plural(sales.length, 'terrário vendido', 'terrários vendidos')),
    );

    // Last 12 months, oldest first.
    const now = new Date();
    months = Array.from({ length: 12 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - 11 + i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const inMonth = sales.filter((t) => t.sold_on?.startsWith(key));
      return { date: d, key, count: inMonth.length, revenue: sum(inMonth, (t) => t.sold_price_cents) };
    });
    drawChart(chartBox, months);

    // By size: everything ever made, smallest size first, terrariums without a size last.
    const groups = new Map();
    for (const t of [...shelf, ...sales]) {
      const key = t.size ?? '';
      const g = groups.get(key) ?? { size: key, sold: 0, revenue: 0, shelf: 0 };
      if (t.status === 'sold') { g.sold += 1; g.revenue += t.sold_price_cents ?? 0; } else g.shelf += 1;
      groups.set(key, g);
    }
    const rows = [...groups.values()].sort((a, b) => !a.size - !b.size || compareSizes(a.size, b.size));
    const hasSizes = rows.some((g) => g.size);
    sizesBox.replaceChildren(hasSizes
      ? h('table', { class: 'mini' },
          h('thead', {}, h('tr', {},
            h('th', { scope: 'col' }, 'Tamanho'),
            h('th', { scope: 'col', class: 'num' }, 'Vendidos'),
            h('th', { scope: 'col', class: 'num' }, 'Venda média'),
            h('th', { scope: 'col', class: 'num' }, 'Na prateleira'))),
          h('tbody', {}, rows.map((g) => h('tr', {},
            h('td', {}, g.size || h('span', { class: 'muted' }, 'Sem tamanho')),
            h('td', { class: 'num' }, g.sold),
            h('td', { class: 'num' }, g.sold ? money(Math.round(g.revenue / g.sold)) : '–'),
            h('td', { class: 'num' }, g.shelf)))))
      : h('p', { class: 'panel-empty' }, 'Preencha o tamanho dos terrários (pequeno, médio, grande…) para compará-los aqui.'));

    const recent = [...sales].sort((a, b) => (b.sold_on ?? '').localeCompare(a.sold_on ?? '') || b.id - a.id).slice(0, 6);
    recentBox.replaceChildren(recent.length
      ? h('ul', { class: 'recent' }, recent.map((t) => h('li', {},
          h('button', { type: 'button', class: 'recent-item', onclick: () => showDetails(t.id) },
            jar(t, { size: 'jar-tiny' }),
            h('span', { class: 'recent-name' }, t.name, h('small', {}, `${date(t.sold_on)}${t.buyer ? `, ${t.buyer}` : ''}`)),
            h('span', { class: 'recent-price' }, money(t.sold_price_cents))))))
      : h('p', { class: 'panel-empty' }, 'As vendas que você registrar aparecem aqui.'));
  }

  update();
  return { update, destroy: () => resize.disconnect() };
}


// Single-series bar chart: one bar per month, hover/focus for the exact figures.
function drawChart(box, months) {
  const width = box.clientWidth;
  if (!width || !months.length) return;
  const height = 240;
  const pad = { top: 12, right: 8, bottom: 28, left: 80 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;

  const max = Math.max(...months.map((m) => m.revenue));
  const ticks = niceTicks(max);
  const top = ticks.at(-1) || 1;
  const y = (v) => pad.top + innerH - (v / top) * innerH;
  const band = innerW / months.length;
  const barW = Math.min(40, band * 0.56);

  const tooltip = h('div', { class: 'chart-tip', role: 'status' });
  const svg = s('svg', {
    width, height, viewBox: `0 0 ${width} ${height}`, role: 'img',
    'aria-label': `Faturamento por mês. ${months.map((m) => `${monthYear(m.date)}: ${money(m.revenue)}`).join('; ')}`,
  });

  for (const t of ticks) {
    svg.append(
      s('line', { class: t === 0 ? 'axis' : 'grid', x1: pad.left, x2: width - pad.right, y1: y(t), y2: y(t) }),
      s('text', { class: 'tick', x: pad.left - 10, y: y(t), 'text-anchor': 'end', 'dominant-baseline': 'middle' }, t ? moneyWhole(t) : '0'),
    );
  }

  months.forEach((m, i) => {
    const cx = pad.left + band * i + band / 2;
    const barH = m.revenue ? Math.max(2, innerH - (y(m.revenue) - pad.top)) : 0;
    const x = cx - barW / 2;
    const yTop = pad.top + innerH - barH;
    const r = Math.min(4, barW / 2, barH);
    const group = s('g', { class: 'bar-group', tabindex: 0 });
    if (barH) {
      group.append(s('path', {
        class: 'bar',
        d: `M${x},${yTop + barH} V${yTop + r} Q${x},${yTop} ${x + r},${yTop} H${x + barW - r} Q${x + barW},${yTop} ${x + barW},${yTop + r} V${yTop + barH} Z`,
      }));
    }
    group.append(s('rect', { class: 'hit', x: cx - band / 2, y: pad.top, width: band, height: innerH }));
    const label = m.date.getMonth() === 0 || i === 0 ? `${monthShort(m.date)} ${String(m.date.getFullYear()).slice(2)}` : monthShort(m.date);
    svg.append(group, s('text', { class: 'tick', x: cx, y: height - 8, 'text-anchor': 'middle' }, label));

    const show = () => {
      group.classList.add('active');
      tooltip.replaceChildren(
        h('strong', {}, monthYear(m.date)),
        h('span', {}, money(m.revenue)),
        h('span', { class: 'muted' }, m.count ? plural(m.count, 'terrário vendido', 'terrários vendidos') : 'Nenhuma venda'),
      );
      tooltip.classList.add('show');
      const tipX = Math.min(Math.max(cx, 80), width - 80);
      tooltip.style.left = `${tipX}px`;
      tooltip.style.top = `${Math.min(yTop, pad.top + innerH) - 8}px`;
    };
    const hide = () => { group.classList.remove('active'); tooltip.classList.remove('show'); };
    group.addEventListener('mouseenter', show);
    group.addEventListener('focus', show);
    group.addEventListener('mouseleave', hide);
    group.addEventListener('blur', hide);
  });

  box.replaceChildren(svg, tooltip);
}

// 0 plus 3–5 round steps covering `max` (values in cents).
function niceTicks(max) {
  if (!max) return [0];
  const rough = max / 4;
  const mag = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((st) => st >= rough);
  const ticks = [];
  for (let v = 0; v < max + step; v += step) ticks.push(v);
  return ticks;
}
