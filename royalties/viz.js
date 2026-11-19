// Royalties cockpit — hand-built SVG/HTML charts. Exposes window.V.
// Rules (dataviz skill): one y-axis per chart, thin marks, 4px rounded bar ends
// on the baseline, 2px lines, legend for ≥ 2 series, hover layer on every chart,
// text in ink tokens (never the series colour), status = icon + label + colour.
(function () {
  const C = {
    blue: '#3987e5', orange: '#d95926', aqua: '#199e70',
    ink: '#f0efec', ink2: '#c3c2b7', muted: '#898781', grid: '#2c2c2a', axis: '#383835', surface: '#0c0c10',
  };
  const SEQ = ['#13253f', '#104281', '#1c5cab', '#2a78d6', '#3987e5', '#6da7ec', '#9ec5f4', '#cde2fb'];
  const NS = 'http://www.w3.org/2000/svg';
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------- tooltip (one per page) ----------
  let tip;
  function tipShow(html, x, y) {
    if (!tip) { tip = document.createElement('div'); tip.className = 'viz-tip'; document.body.appendChild(tip); }
    tip.innerHTML = html;
    tip.style.display = 'block';
    const r = tip.getBoundingClientRect();
    let left = x + 14, top = y + 14;
    if (left + r.width > window.innerWidth - 8) left = x - r.width - 14;
    if (top + r.height > window.innerHeight - 8) top = y - r.height - 14;
    tip.style.left = Math.max(8, left) + 'px';
    tip.style.top = Math.max(8, top) + 'px';
  }
  function tipHide() { if (tip) tip.style.display = 'none'; }
  const tipRow = (color, name, value, mark = 'sq') =>
    `<div class="tip-row"><span class="sw ${mark}" style="background:${color}"></span><span class="tip-name">${esc(name)}</span><span class="tip-val">${esc(value)}</span></div>`;

  // ---------- scales ----------
  // Axis range and tick step: step in {1, 2, 2.5, 5} × 10^n so labels read cleanly.
  // Negative values (a margin, a variation) extend the axis below zero.
  function niceStep(raw) {
    const p = Math.pow(10, Math.floor(Math.log10(raw)));
    const f = raw / p;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
  }
  function niceScale(hi, lo = 0, target = 4) {
    hi = Math.max(0, hi || 0); lo = Math.min(0, lo || 0);
    if (!(hi - lo > 0)) return { min: 0, max: 1, step: 0.25 };
    const step = niceStep((hi - lo) / target);
    return { min: Math.floor(lo / step + 1e-9) * step, max: Math.ceil(hi / step - 1e-9) * step, step };
  }
  const niceMax = (v) => niceScale(v).max;
  function svg(tag, attrs = {}, parent) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function legend(items) {
    return `<div class="legend">${items.map((i) => `<span class="lg"><span class="sw ${i.mark || 'sq'}" style="background:${i.color}"></span>${esc(i.name)}</span>`).join('')}</div>`;
  }

  // Common frame: axes, gridlines, x labels, shaded "partial" zone.
  function frame(el, o, sc) {
    const W = Math.max(320, el.clientWidth || 640);
    const H = o.h || 240;
    const m = { l: 60, r: 14, t: 14, b: 26 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const s = svg('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': o.label || '' });
    const y = (v) => m.t + ih - ((v - sc.min) / (sc.max - sc.min)) * ih;
    const ticks = Math.round((sc.max - sc.min) / sc.step);
    for (let i = 0; i <= ticks; i++) {
      const v = sc.min + sc.step * i;
      const zero = Math.abs(v) < sc.step / 1e6;
      svg('line', { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), stroke: zero ? C.axis : C.grid, 'stroke-width': zero ? 1 : 0.5 }, s);
      const t = svg('text', { x: m.l - 8, y: y(v) + 3.5, 'text-anchor': 'end', class: 'ax' }, s);
      t.textContent = o.yFmt(v);
    }
    return { s, W, H, m, iw, ih, y };
  }
  function xLabels(f, months, xAt, fmt) {
    const every = Math.max(1, Math.ceil(months.length / Math.max(1, Math.floor(f.iw / 70))));
    const last = months.length - 1;
    months.forEach((mo, i) => {
      if (i !== last && (i % every !== 0 || last - i < every)) return;
      const x = xAt(i);
      const anchor = x > f.W - f.m.r - 24 ? 'end' : x < f.m.l + 10 ? 'start' : 'middle';
      const t = svg('text', { x: anchor === 'end' ? Math.min(x + 4, f.W - 2) : anchor === 'start' ? x - 4 : x, y: f.H - 8, 'text-anchor': anchor, class: 'ax' }, f.s);
      t.textContent = fmt(mo);
    });
  }
  function shade(f, months, from, step, xAt, label) {
    if (!from) return;
    const i0 = months.findIndex((mo) => mo > from);
    if (i0 < 0) return;
    const x0 = xAt(i0) - step / 2;
    const id = 'h' + Math.random().toString(36).slice(2, 8);
    const defs = svg('defs', {}, f.s);
    const p = svg('pattern', { id, width: 6, height: 6, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, defs);
    svg('line', { x1: 0, y1: 0, x2: 0, y2: 6, stroke: C.axis, 'stroke-width': 1.5 }, p);
    svg('rect', { x: x0, y: f.m.t, width: f.W - f.m.r - x0, height: f.ih, fill: `url(#${id})`, opacity: 0.55 }, f.s);
    const t = svg('text', { x: f.W - f.m.r - 4, y: f.m.t + 11, 'text-anchor': 'end', class: 'ax' }, f.s);
    t.textContent = label || 'partiel';
  }

  // ---------- line chart (crosshair + tooltip) ----------
  // o: { months, series:[{name,color,values,dash}], yFmt, xFmt, h, shadeFrom, shadeLabel, markers:[{m,label}] }
  function line(el, o) {
    const draw = () => {
      const n = o.months.length;
      const vals = o.series.flatMap((s) => s.values);
      const sc = niceScale(Math.max(0, ...vals), Math.min(0, ...vals));
      const f = frame(el, o, sc);
      const step = n > 1 ? f.iw / (n - 1) : f.iw;
      const xAt = (i) => f.m.l + (n > 1 ? i * step : f.iw / 2);
      shade(f, o.months, o.shadeFrom, step, xAt, o.shadeLabel);
      for (const mk of o.markers || []) {
        const i = o.months.indexOf(mk.m);
        if (i < 0) continue;
        svg('line', { x1: xAt(i), x2: xAt(i), y1: f.m.t, y2: f.m.t + f.ih, stroke: C.ink2, 'stroke-width': 1, 'stroke-dasharray': '2 3' }, f.s);
        const t = svg('text', { x: xAt(i) + 5, y: f.m.t + 11, class: 'ax ink' }, f.s);
        t.textContent = mk.label;
      }
      for (const s of o.series) {
        const d = s.values.map((v, i) => `${i ? 'L' : 'M'}${xAt(i).toFixed(1)},${f.y(v).toFixed(1)}`).join('');
        svg('path', { d, fill: 'none', stroke: s.color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round', 'stroke-dasharray': s.dash || '' }, f.s);
      }
      xLabels(f, o.months, xAt, o.xFmt);
      // hover layer
      const g = svg('g', { style: 'pointer-events:none', opacity: 0 }, f.s);
      const vline = svg('line', { y1: f.m.t, y2: f.m.t + f.ih, stroke: C.muted, 'stroke-width': 1 }, g);
      const dots = o.series.map((s) => svg('circle', { r: 4.5, fill: s.color, stroke: C.surface, 'stroke-width': 2 }, g));
      const hit = svg('rect', { x: f.m.l - step / 2, y: f.m.t, width: f.iw + step, height: f.ih, fill: 'transparent' }, f.s);
      hit.addEventListener('pointermove', (ev) => {
        const r = f.s.getBoundingClientRect();
        const mx = (ev.clientX - r.left) * (f.W / r.width);
        const i = Math.max(0, Math.min(n - 1, Math.round((mx - f.m.l) / (step || 1))));
        g.setAttribute('opacity', 1);
        vline.setAttribute('x1', xAt(i)); vline.setAttribute('x2', xAt(i));
        o.series.forEach((s, k) => { dots[k].setAttribute('cx', xAt(i)); dots[k].setAttribute('cy', f.y(s.values[i])); });
        const partial = o.note ? o.note(i) : o.shadeFrom && o.months[i] > o.shadeFrom ? `<div class="tip-note">${esc(o.shadeLabel || 'partiel')}</div>` : '';
        tipShow(`<div class="tip-h">${esc(o.tipFmt ? o.tipFmt(o.months[i]) : o.months[i])}</div>${o.series.map((s) => tipRow(s.color, s.name, o.yTip ? o.yTip(s.values[i]) : o.yFmt(s.values[i]), 'ln')).join('')}${o.extra ? o.extra(i) : ''}${partial}`, ev.clientX, ev.clientY);
      });
      hit.addEventListener('pointerleave', () => { g.setAttribute('opacity', 0); tipHide(); });
      el.innerHTML = (o.series.length > 1 ? legend(o.series.map((s) => ({ ...s, mark: 'ln' }))) : '');
      el.appendChild(f.s);
    };
    mount(el, draw);
  }

  // ---------- grouped bars per month ----------
  // o: { months, series:[{name,color,values}], yFmt, xFmt, h, shadeFrom, shadeLabel }
  function bars(el, o) {
    const draw = () => {
      const n = o.months.length, k = o.series.length;
      const vals = o.series.flatMap((s) => s.values);
      const sc = niceScale(Math.max(0, ...vals), Math.min(0, ...vals));
      const f = frame(el, o, sc);
      const band = f.iw / n;
      const bw = Math.max(2, Math.min(14, (band * 0.72 - (k - 1) * 2) / k));
      const groupW = k * bw + (k - 1) * 2;
      const xAt = (i) => f.m.l + band * i + band / 2;
      shade(f, o.months, o.shadeFrom, band, xAt, o.shadeLabel);
      const base = f.y(0);
      o.series.forEach((s, j) => {
        s.values.forEach((v, i) => {
          if (!v) return;
          const x = xAt(i) - groupW / 2 + j * (bw + 2);
          const end = f.y(v);
          const h = Math.abs(base - end);
          const r = Math.min(4, bw / 2, h);
          // Rounded corners on the data end only, square on the zero line.
          const d = v > 0
            ? `M${x},${base}V${end + r}Q${x},${end} ${x + r},${end}H${x + bw - r}Q${x + bw},${end} ${x + bw},${end + r}V${base}Z`
            : `M${x},${base}V${end - r}Q${x},${end} ${x + r},${end}H${x + bw - r}Q${x + bw},${end} ${x + bw},${end - r}V${base}Z`;
          svg('path', { d, fill: s.color, opacity: s.dim && s.dim(i) ? 0.4 : 1 }, f.s);
        });
      });
      xLabels(f, o.months, xAt, o.xFmt);
      const hl = svg('rect', { y: f.m.t, height: f.ih, width: band, fill: '#ffffff', opacity: 0, style: 'pointer-events:none' }, f.s);
      f.s.insertBefore(hl, f.s.firstChild.nextSibling);
      const hit = svg('rect', { x: f.m.l, y: f.m.t, width: f.iw, height: f.ih, fill: 'transparent' }, f.s);
      hit.addEventListener('pointermove', (ev) => {
        const r = f.s.getBoundingClientRect();
        const mx = (ev.clientX - r.left) * (f.W / r.width);
        const i = Math.max(0, Math.min(n - 1, Math.floor((mx - f.m.l) / band)));
        hl.setAttribute('x', f.m.l + band * i); hl.setAttribute('opacity', 0.04);
        const partial = o.note ? o.note(i) : o.shadeFrom && o.months[i] > o.shadeFrom ? `<div class="tip-note">${esc(o.shadeLabel || 'partiel')}</div>` : '';
        tipShow(`<div class="tip-h">${esc(o.tipFmt ? o.tipFmt(o.months[i]) : o.months[i])}</div>${o.series.map((s) => tipRow(s.color, s.name, o.yTip ? o.yTip(s.values[i]) : o.yFmt(s.values[i]))).join('')}${o.extra ? o.extra(i) : ''}${partial}`, ev.clientX, ev.clientY);
      });
      hit.addEventListener('pointerleave', () => { hl.setAttribute('opacity', 0); tipHide(); });
      el.innerHTML = (k > 1 ? legend(o.series) : '');
      el.appendChild(f.s);
    };
    mount(el, draw);
  }

  // ---------- paired horizontal bars (one row per title) ----------
  // o: { rows:[{label, a, b, href, pre, note}], a:{name,color}, b:{name,color}, fmt, valueText(row) }
  function pairs(el, o) {
    const max = niceMax(Math.max(0, ...o.rows.flatMap((r) => [r.a, r.b])));
    const w = (v) => (v > 0 ? Math.max(0.6, (v / max) * 100) : 0);
    el.innerHTML = legend([o.a, o.b]) + `<div class="pairs">${o.rows.map((r, i) => `
      <a class="pr" ${r.href ? `href="${r.href}"` : ''} data-i="${i}">
        <span class="pr-label">${r.pre || ''}<span class="pr-t">${esc(r.label)}</span></span>
        <span class="pr-bars">
          <span class="pr-bar" style="width:${w(r.a)}%;background:${o.a.color}"></span>
          <span class="pr-bar" style="width:${w(r.b)}%;background:${o.b.color}"></span>
        </span>
        <span class="pr-val">${o.valueText(r)}</span>
      </a>`).join('')}</div>`;
    el.querySelectorAll('.pr').forEach((node) => {
      const r = o.rows[+node.dataset.i];
      node.addEventListener('pointermove', (ev) => tipShow(`<div class="tip-h">${esc(r.label)}</div>${tipRow(o.a.color, o.a.name, o.fmt(r.a))}${tipRow(o.b.color, o.b.name, o.fmt(r.b))}${r.note ? `<div class="tip-note">${esc(r.note)}</div>` : ''}`, ev.clientX, ev.clientY));
      node.addEventListener('pointerleave', tipHide);
    });
  }

  // ---------- heatmap: rows × months, single blue hue (sequential) ----------
  // o: { rows:[{label, href, values, total}], months, fmt, totalFmt, xFmt, shadeFrom }
  function seqColor(t) {
    const x = Math.max(0, Math.min(1, t)) * (SEQ.length - 1);
    const i = Math.floor(x), f = x - i;
    if (i >= SEQ.length - 1) return SEQ[SEQ.length - 1];
    const a = SEQ[i], b = SEQ[i + 1];
    const c = (h, o) => parseInt(h.slice(o, o + 2), 16);
    const mix = (o) => Math.round(c(a, o) + (c(b, o) - c(a, o)) * f).toString(16).padStart(2, '0');
    return '#' + mix(1) + mix(3) + mix(5);
  }
  function heat(el, o) {
    const max = Math.max(0, ...o.rows.flatMap((r) => r.values));
    const every = Math.max(1, Math.ceil(o.months.length / 9));
    const head = o.months.map((m, i) => `<th class="${o.shadeFrom && m > o.shadeFrom ? 'part' : ''}">${i % every === 0 || i === o.months.length - 1 ? esc(o.xFmt(m)) : ''}</th>`).join('');
    const body = o.rows.map((r, ri) => `<tr>
        <td class="hm-l"><a ${r.href ? `href="${r.href}"` : ''}>${esc(r.label)}</a></td>
        ${r.values.map((v, ci) => `<td class="hm-c" data-r="${ri}" data-c="${ci}"><span style="background:${v > 0 ? seqColor(Math.sqrt(v / max)) : 'transparent'}" class="${v > 0 ? '' : 'z'}${o.shadeFrom && o.months[ci] > o.shadeFrom ? ' part' : ''}"></span></td>`).join('')}
        <td class="hm-t">${esc(o.totalFmt(r.total))}</td></tr>`).join('');
    el.innerHTML = `<div class="hm-wrap"><table class="hm"><thead><tr><th></th>${head}<th class="hm-t">Total</th></tr></thead><tbody>${body}</tbody></table></div>
      <div class="hm-scale"><span>0</span><span class="hm-grad" style="background:linear-gradient(90deg,${SEQ.join(',')})"></span><span>${esc(o.fmt(max))}</span><span class="hm-note">échelle racine carrée</span></div>`;
    el.querySelectorAll('.hm-c').forEach((td) => {
      td.addEventListener('pointermove', (ev) => {
        const r = o.rows[+td.dataset.r], c = +td.dataset.c, m = o.months[c];
        tipShow(`<div class="tip-h">${esc(r.label)}</div><div class="tip-row"><span class="tip-name">${esc(o.tipFmt ? o.tipFmt(m) : m)}</span><span class="tip-val">${esc(o.fmt(r.values[c]))}</span></div>${o.shadeFrom && m > o.shadeFrom ? '<div class="tip-note">mois partiel (reporting distributeur incomplet)</div>' : ''}`, ev.clientX, ev.clientY);
      });
      td.addEventListener('pointerleave', tipHide);
    });
  }

  // ---------- many lines, focus + context ----------
  // Every row is drawn thin and grey; up to 3 selected rows take the first three
  // categorical slots (the only ones that stay distinct all-pairs). Hover a line or a
  // name to read it. o: { months, rows:[{label, values, total, href}], yFmt, yTip, xFmt,
  // tipFmt, totalFmt, h, shadeFrom, shadeLabel, selected:[i] }
  const PICK = [C.blue, C.orange, C.aqua];
  function lines(el, o) {
    let sel = (o.selected || [0, 1, 2]).filter((i) => i < o.rows.length).slice(0, 3);
    let hot = -1;
    const colorOf = (i) => { const k = sel.indexOf(i); return k >= 0 ? PICK[k] : null; };
    el.innerHTML = `<div class="ml"><div class="ml-chart"></div><ol class="ml-list"></ol></div>
      <p class="ml-hint">Clique un titre pour le mettre en couleur (3 au maximum). Survole une courbe pour la lire.</p>`;
    const box = el.querySelector('.ml-chart'), list = el.querySelector('.ml-list');
    const drawList = () => {
      list.innerHTML = o.rows.map((r, i) => {
        const c = colorOf(i);
        return `<li><button type="button" data-i="${i}" class="${c ? 'on' : ''}${hot === i ? ' hot' : ''}" aria-pressed="${!!c}">
          <span class="ml-rank">${i + 1}</span><span class="sw ln" style="background:${c || C.muted}"></span>
          <span class="ml-t">${esc(r.label)}</span><span class="ml-v">${esc(o.totalFmt(r.total))}</span></button></li>`;
      }).join('');
      list.querySelectorAll('button').forEach((b) => {
        const i = +b.dataset.i;
        b.addEventListener('click', () => {
          if (sel.includes(i)) sel = sel.filter((x) => x !== i);
          else { sel.push(i); if (sel.length > 3) sel.shift(); }
          drawList(); draw();
        });
        b.addEventListener('mouseenter', () => { hot = i; draw(); });
        b.addEventListener('mouseleave', () => { hot = -1; draw(); });
      });
    };
    const draw = () => {
      const n = o.months.length;
      const sc = niceScale(Math.max(0, ...o.rows.flatMap((r) => r.values)));
      const f = frame(box, o, sc);
      const step = n > 1 ? f.iw / (n - 1) : f.iw;
      const xAt = (i) => f.m.l + (n > 1 ? i * step : f.iw / 2);
      shade(f, o.months, o.shadeFrom, step, xAt, o.shadeLabel);
      const path = (r) => r.values.map((v, i) => `${i ? 'L' : 'M'}${xAt(i).toFixed(1)},${f.y(v).toFixed(1)}`).join('');
      // grey context first, then the selected and hovered rows on top
      o.rows.forEach((r, i) => {
        if (colorOf(i) || i === hot) return;
        svg('path', { d: path(r), fill: 'none', stroke: C.muted, 'stroke-opacity': hot >= 0 ? 0.18 : 0.35, 'stroke-width': 1.25, 'stroke-linejoin': 'round' }, f.s);
      });
      sel.forEach((i) => svg('path', { d: path(o.rows[i]), fill: 'none', stroke: colorOf(i), 'stroke-width': 2.25, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, f.s));
      if (hot >= 0 && !colorOf(hot)) svg('path', { d: path(o.rows[hot]), fill: 'none', stroke: C.ink, 'stroke-width': 2, 'stroke-linejoin': 'round' }, f.s);
      xLabels(f, o.months, xAt, o.xFmt);
      const g = svg('g', { style: 'pointer-events:none', opacity: 0 }, f.s);
      const vline = svg('line', { y1: f.m.t, y2: f.m.t + f.ih, stroke: C.muted, 'stroke-width': 1 }, g);
      const dot = svg('circle', { r: 4.5, fill: C.ink, stroke: C.surface, 'stroke-width': 2 }, g);
      const hit = svg('rect', { x: f.m.l - step / 2, y: f.m.t, width: f.iw + step, height: f.ih, fill: 'transparent' }, f.s);
      hit.addEventListener('pointermove', (ev) => {
        const r = f.s.getBoundingClientRect();
        const mx = (ev.clientX - r.left) * (f.W / r.width), my = (ev.clientY - r.top) * (f.H / r.height);
        const i = Math.max(0, Math.min(n - 1, Math.round((mx - f.m.l) / (step || 1))));
        // nearest line to the pointer at this month
        let best = 0, bd = Infinity;
        o.rows.forEach((row, k) => { const d = Math.abs(f.y(row.values[i]) - my); if (d < bd) { bd = d; best = k; } });
        g.setAttribute('opacity', 1);
        vline.setAttribute('x1', xAt(i)); vline.setAttribute('x2', xAt(i));
        dot.setAttribute('cx', xAt(i)); dot.setAttribute('cy', f.y(o.rows[best].values[i]));
        dot.setAttribute('fill', colorOf(best) || C.ink);
        const others = sel.filter((k) => k !== best).map((k) => tipRow(colorOf(k), o.rows[k].label, (o.yTip || o.yFmt)(o.rows[k].values[i]), 'ln')).join('');
        const partial = o.shadeFrom && o.months[i] > o.shadeFrom ? `<div class="tip-note">${esc(o.shadeLabel || 'partiel')}</div>` : '';
        tipShow(`<div class="tip-h">${esc(o.tipFmt ? o.tipFmt(o.months[i]) : o.months[i])}</div>${tipRow(colorOf(best) || C.ink, o.rows[best].label, (o.yTip || o.yFmt)(o.rows[best].values[i]), 'ln')}${others}${partial}`, ev.clientX, ev.clientY);
      });
      hit.addEventListener('pointerleave', () => { g.setAttribute('opacity', 0); tipHide(); });
      box.innerHTML = '';
      box.appendChild(f.s);
    };
    drawList();
    mount(box, draw);
  }

  // Redraw on resize (charts are measured in pixels).
  const mounted = new Map();
  function mount(el, draw) { mounted.set(el, draw); draw(); }
  let rt;
  window.addEventListener('resize', () => {
    clearTimeout(rt);
    rt = setTimeout(() => { for (const [el, draw] of mounted) { if (document.body.contains(el)) draw(); else mounted.delete(el); } }, 150);
  });

  // Synchronous redraw of every chart, e.g. at print width before printing.
  function redraw() { for (const [el, draw] of mounted) { if (document.body.contains(el)) draw(); else mounted.delete(el); } }

  window.V = { C, line, bars, pairs, heat, lines, legend, redraw, tipShow, tipHide };
})();
