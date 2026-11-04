/* AlphaNet Hyperliquid 综合看板 — 纯静态前端，数据来自 data/*.json，可选浏览器直连 Hyperliquid API 实时刷新 */
(() => {
'use strict';

const API = 'https://api.hyperliquid.xyz/info';
const FILES = ['meta', 'daily_total', 'addr_daily', 'addr_summary', 'positions', 'alerts', 'alert_rules', 'coin_daily', 'exposure_daily', 'health', 'run_log', 'strategies', 'deployments', 'strategy_catalog'];
const VIEWS = {
  overview: { t: '公司总览', s: '公司整体经营：资金规模、盈亏、交易量与成本' },
  weekly:   { t: '周报 / 月报', s: '按 ISO 周（周一至周日）与自然月汇总，UTC 口径' },
  ops:      { t: '运营分析', s: '地址活跃度、交易量贡献、成交结构与费率' },
  address:  { t: '地址分析', s: '每个监控地址的表现、明细与盈亏热力图' },
  coins:    { t: '币种分析', s: '各币种成交、盈亏、Maker/Taker 与多空方向' },
  strategy: { t: '策略分析', s: '总策略 → 大类（Archimedes PI / Archimedes / Hackworth）→ 策略（大类 + 币种）→ 部署' },
  risk:     { t: '风控与持仓', s: '风险提醒、持仓敞口、杠杆、强平距离与回撤' },
  devops:   { t: '运维监控', s: '数据新鲜度、采集管道健康、数据质量检查与 API 探测' },
};
const S = { range: 30, view: 'overview', sorts: {}, charts: [], live: null, sel: null, week: null, liveBusy: false };
const $ = (q, el = document) => el.querySelector(q);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sum = (a, f = x => x) => a.reduce((s, x) => s + (+f(x) || 0), 0);
const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const SERIES = () => [1, 2, 3, 4, 5, 6, 7, 8].map(i => css('--s' + i));

/* ---------- formatting ---------- */
function usd(v, opt = {}) {
  if (v == null || isNaN(v)) return '—';
  const a = Math.abs(v), s = v < 0 ? '-' : (opt.sign && v > 0 ? '+' : '');
  let t;
  if (a >= 1e9) t = (a / 1e9).toFixed(2) + 'B';
  else if (a >= 1e6) t = (a / 1e6).toFixed(2) + 'M';
  else if (a >= 1e4) t = (a / 1e3).toFixed(1) + 'K';
  else t = a.toLocaleString('en-US', { maximumFractionDigits: a < 100 ? 2 : 0 });
  return s + '$' + t;
}
const usdFull = (v, sign) => v == null ? '—' : (v < 0 ? '-' : (sign && v > 0 ? '+' : '')) + '$' + Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 });
const pct = (v, d = 2, sign) => v == null || !isFinite(v) ? '—' : ((sign && v > 0 ? '+' : '') + (v * 100).toFixed(d) + '%');
const int = v => v == null ? '—' : Math.round(v).toLocaleString('en-US');
const cls = v => v > 0 ? 'pos' : v < 0 ? 'neg' : '';
const sp = (v, f = usd) => `<span class="${cls(v)}">${f(v, { sign: true })}</span>`;
const spp = (v, d = 2) => `<span class="${cls(v)}">${pct(v, d, true)}</span>`;
const short = a => a.slice(0, 6) + '…' + a.slice(-4);
const ago = iso => { const h = (Date.now() - Date.parse(iso)) / 36e5; return h < 1 ? Math.round(h * 60) + ' 分钟前' : h < 48 ? h.toFixed(1) + ' 小时前' : (h / 24).toFixed(1) + ' 天前'; };
const bj = iso => { const d = new Date(Date.parse(iso) + 8 * 36e5); return d.toISOString().slice(0, 16).replace('T', ' ') + ' 北京'; };
const LV = { '严重': 'crit', '警告': 'warn', '提示': 'info', '正常': 'ok', '通过': 'ok' };
const LVI = { '严重': '!', '警告': '!', '提示': 'i', '正常': '✓', '通过': '✓' };
const chip = (lv, txt) => `<span class="chip ${LV[lv] || 'mute'}">${LVI[lv] ? LVI[lv] + ' ' : ''}${esc(txt ?? lv)}</span>`;

/* ---------- data ---------- */
async function loadAll() {
  const out = {};
  await Promise.all(FILES.map(async f => {
    try {
      const r = await fetch(`data/${f}.json?t=${Date.now()}`, { cache: 'no-store' });
      out[f] = r.ok ? await r.json() : null;
    } catch { out[f] = null; }
  }));
  return out;
}

function prep(D) {
  S.D = D;
  const meta = D.meta || { addresses: [] };
  S.addrs = meta.addresses.length ? meta.addresses : (D.addr_summary || []).map(s => ({ addr: s.addr, label: s.label, group: '未分组' }));
  S.label = Object.fromEntries(S.addrs.map(a => [a.addr, a.label]));
  S.group = Object.fromEntries(S.addrs.map(a => [a.addr, a.group || '未分组']));
  S.dt = (D.daily_total || []).filter(r => !r.partial);
  S.days = S.dt.map(r => r.day);
  S.ad = (D.addr_daily || []).filter(r => !r.partial);
  S.adBy = {};
  for (const r of S.ad) (S.adBy[r.addr] ||= []).push(r);
  S.cd = D.coin_daily || [];
  S.summaryFile = D.addr_summary || [];
  S.positionsFile = D.positions || [];
  S.alerts = D.alerts || [];
  const ST = D.strategies || { combos: [] };
  S.stratMeta = ST;
  S.strat = Object.fromEntries((ST.combos || []).map(c => [c.addr + '|' + c.coin, c]));
  S.depsAll = (D.deployments || []).filter(d => d.usdc != null);
  S.deps = S.depsAll.filter(d => d.watched !== false && S.label[d.addr]);
  S.catalog = D.strategy_catalog || [];
  S.hasDep = S.deps.length > 0;
  S.today = new Date().toISOString().slice(0, 10);
  applyLive();
}

function rangeDays() {
  return S.range && S.days.length > S.range ? S.days.slice(-S.range) : S.days.slice();
}

/* ---------- deployed amount (内部部署接口) ---------- */
const STOPPED = /stop|inactive|ended|closed|cancel|停止|结束|已停/i;
function depActive(d, day) {
  if (d.start && d.start > day) return false;
  if (d.stop) return day < d.stop;
  if (d.status && STOPPED.test(String(d.status))) return day < S.today;
  return true;
}
const depOn = (day, f = () => true) => sum(S.deps.filter(d => f(d) && depActive(d, day)), d => d.usdc);
const depNow = (f = () => true) => depOn(S.today, f);
const depAvg = (days, f = () => true) => days.length ? sum(days, d => depOn(d, f)) / days.length : 0;
const byAddr = a => d => d.addr === a;
const NA_DEP = '<span class="muted" title="部署金额来自内部部署接口，尚未接入">—</span>';
const depCell = v => S.hasDep ? usd(v) : NA_DEP;
const depKpi = (v, sub) => kpi('部署金额', S.hasDep ? usd(v) : '<span class="muted">—</span>', S.hasDep ? sub : '待接入内部部署接口', '内部部署接口的部署 USDC 合计（当前生效的部署）');

/* ---------- live refresh ---------- */
function posFromState(a, st, eqNow) {
  const out = [];
  for (const p of st.assetPositions || []) {
    const q = p.position, szi = +q.szi, val = Math.abs(+q.positionValue);
    if (val < 1) continue;
    const mark = szi ? val / Math.abs(szi) : 0;
    const liq = q.liquidationPx ? +q.liquidationPx : null;
    const dist = liq && mark ? Math.abs(liq - mark) / mark : null;
    out.push({ key: a + '|' + q.coin, addr: a, label: S.label[a], coin: q.coin, side: szi < 0 ? '空' : '多', size: Math.abs(szi), notional: val,
      entry_px: +q.entryPx, mark_px: mark, unrealized_pnl: +q.unrealizedPnl, roe: +(q.returnOnEquity || 0), liq_px: liq, liq_distance: dist,
      leverage: `${q.leverage.value}x ${q.leverage.type === 'cross' ? '全仓' : '逐仓'}`, funding_since_open: -(+(q.cumFunding?.sinceOpen || 0)),
      pct_of_equity: eqNow > 1 ? val / eqNow : 0 });
  }
  return out;
}

function applyLive() {
  const L = S.live;
  S.summary = S.summaryFile.map(s => ({ ...s }));
  S.positions = S.positionsFile.slice();
  if (!L) return;
  const pos = [];
  for (const s of S.summary) {
    const st = L.states[s.addr];
    if (!st) { pos.push(...S.positionsFile.filter(p => p.addr === s.addr)); continue; }
    const ms = st.marginSummary || {};
    const pe = L.port && L.port[s.addr] && L.port[s.addr].eq;
    const eq = pe != null ? pe : (+ms.accountValue || 0);
    const ps = posFromState(s.addr, st, eq);
    pos.push(...ps);
    const upnl = sum(ps, p => p.unrealized_pnl), ntl = +ms.totalNtlPos || 0;
    const liq = ps.filter(p => p.liq_distance != null).sort((a, b) => a.liq_distance - b.liq_distance)[0];
    Object.assign(s, { equity_now: eq, unrealized_pnl: upnl, unrealized_pct: eq > 1 ? upnl / eq : 0, position_ntl: ntl,
      margin_used: +ms.totalMarginUsed || 0, leverage: eq > 1 ? ntl / eq : 0, positions_count: ps.length,
      liq_distance_min: liq ? liq.liq_distance : null, _live: true,
      live_pnl_24h: L.port && L.port[s.addr] ? L.port[s.addr].pnl : null, live_vlm_24h: L.port && L.port[s.addr] ? L.port[s.addr].vlm : null });
  }
  S.positions = pos;
}

async function post(body, tries = 4) {
  for (let i = 0; ; i++) {
    const r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (r.ok) return r.json();
    if (r.status !== 429 || i >= tries - 1) throw new Error('HTTP ' + r.status);
    await new Promise(res => setTimeout(res, 800 * 2 ** i));
  }
}

async function liveRefresh() {
  if (S.liveBusy) return;
  S.liveBusy = true;
  const btn = $('#live-btn'); btn.disabled = true; btn.textContent = '⟳ 拉取中…';
  const states = {}, port = {}, lat = [], errs = [];
  const queue = S.summaryFile.map(s => s.addr), queue0 = queue.length;
  const worker = async () => {
    while (queue.length) {
      const a = queue.shift(), t0 = performance.now();
      try {
        const st = await post({ type: 'clearinghouseState', user: a });
        const pf = await post({ type: 'portfolio', user: a }).catch(() => null);
        states[a] = st;
        const day = pf && (pf.find(x => x[0] === 'day') || [])[1];
        if (day) {
          const h = day.pnlHistory || [], av = day.accountValueHistory || [];
          // portfolio 的账户价值 = 永续 + 现货（统一账户的 USDC 可能在现货里，clearinghouseState 看不到）
          port[a] = { pnl: h.length ? +h[h.length - 1][1] - +h[0][1] : 0, vlm: +day.vlm || 0, eq: av.length ? +av[av.length - 1][1] : null };
        }
        lat.push(performance.now() - t0);
      } catch (e) { errs.push(S.label[a] + '：' + e.message); }
    }
  };
  await Promise.all([1, 2].map(worker));
  S.live = { at: new Date().toISOString(), states, port, lat, errs };
  applyLive();
  S.liveBusy = false;
  render(true);
  btn.disabled = false;
  btn.textContent = errs.length ? `⚠ 已更新 ${Object.keys(states).length}/${queue0}` : `✓ 已更新 ${bj(S.live.at).slice(11, 16)}`;
  clearTimeout(S.liveBtnT); S.liveBtnT = setTimeout(() => { btn.textContent = '⟳ 实时刷新'; }, 4000);
}

/* ---------- charts ---------- */
function baseOpts(o = {}) {
  const grid = css('--grid'), tick = css('--text-3');
  const fmt = o.fmt || usd;
  return {
    responsive: true, maintainAspectRatio: false, animation: false,
    interaction: { mode: o.mode || 'index', intersect: false, axis: o.horizontal ? 'y' : 'x' },
    indexAxis: o.horizontal ? 'y' : 'x',
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: css('--text'), titleColor: css('--bg'), bodyColor: css('--bg'), padding: 8, cornerRadius: 6, boxPadding: 4,
        callbacks: { label: c => ` ${c.dataset.label ? c.dataset.label + '：' : ''}${(o.tipFmt || fmt)(o.horizontal ? c.parsed.x : c.parsed.y)}`, ...(o.tipCb || {}) },
      },
      thresh: o.thresh,
    },
    scales: {
      x: { stacked: !!o.stacked, grid: { display: !!o.horizontal, color: grid, drawTicks: false }, border: { display: false },
        ticks: { color: tick, maxRotation: 0, autoSkipPadding: 12, font: { size: 11 }, padding: 6, ...(o.horizontal ? { callback: v => fmt(v) } : {}) },
        min: o.xmin, max: o.xmax },
      y: { stacked: !!o.stacked, grid: { display: !o.horizontal, color: grid, drawTicks: false }, border: { display: false },
        ticks: { color: tick, font: { size: 11 }, padding: 6, ...(o.horizontal ? {} : { callback: v => fmt(v) }), autoSkip: !o.horizontal },
        beginAtZero: o.zero !== false, min: o.ymin, max: o.ymax },
    },
  };
}

const threshPlugin = {
  id: 'thresh',
  afterDatasetsDraw(ch, args, opt) {
    if (!opt || opt.value == null) return;
    const { ctx, chartArea: a } = ch;
    const horiz = ch.options.indexAxis === 'y';
    const sc = horiz ? ch.scales.x : ch.scales.y;
    const p = sc.getPixelForValue(opt.value);
    ctx.save();
    ctx.strokeStyle = css('--neg'); ctx.setLineDash([4, 4]); ctx.lineWidth = 1.5;
    ctx.beginPath();
    if (horiz) { ctx.moveTo(p, a.top); ctx.lineTo(p, a.bottom); } else { ctx.moveTo(a.left, p); ctx.lineTo(a.right, p); }
    ctx.stroke();
    ctx.setLineDash([]); ctx.fillStyle = css('--neg'); ctx.font = '11px sans-serif';
    if (opt.label) { if (horiz) ctx.fillText(opt.label, p + 4, a.top + 10); else ctx.fillText(opt.label, a.left + 4, p - 4); }
    ctx.restore();
  },
};
if (window.Chart) Chart.register(threshPlugin);

function mk(id, type, labels, datasets, o = {}) {
  const el = document.getElementById(id);
  if (!el || !window.Chart) return;
  const cv = document.createElement('canvas'); el.innerHTML = ''; el.appendChild(cv);
  S.charts.push(new Chart(cv, { type, data: { labels, datasets }, options: baseOpts(o) }));
}
const lineDs = (label, data, color, fill) => ({ label, data, borderColor: color, backgroundColor: fill ? color + '22' : color, fill: !!fill,
  borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, pointHoverBorderWidth: 2, pointHoverBorderColor: css('--surface'), tension: .25 });
const barDs = (label, data, color) => ({ label, data, backgroundColor: color, borderRadius: 4, borderSkipped: 'start', maxBarThickness: 28, borderWidth: 0 });
const pnColors = data => data.map(v => v >= 0 ? css('--pos') : css('--neg'));
const shortDay = d => d.slice(5);
const legend = items => `<div class="legend">${items.map(([c, t]) => `<span><i style="background:${c}"></i>${esc(t)}</span>`).join('')}</div>`;

/* ---------- components ---------- */
const kpi = (l, v, s = '', title = '') => `<div class="kpi" ${title ? `title="${esc(title)}"` : ''}><div class="kpi-l">${l}</div><div class="kpi-v">${v}</div><div class="kpi-s">${s}</div></div>`;
const card = (t, hint, body, extra = '') => `<div class="card"><div class="card-h"><div><h3>${t}</h3>${hint ? `<div class="hint">${hint}</div>` : ''}</div>${extra}</div>${body}</div>`;
const chartBox = (id, size = '') => `<div class="chart ${size}" id="${id}"></div>`;

function table(id, cols, rows, o = {}) {
  const st = S.sorts[id] || (o.sort ? { k: o.sort, asc: !!o.asc } : null);
  let rs = rows.slice();
  if (st) {
    const c = cols.find(c => c.k === st.k);
    const val = c?.v || (r => r[st.k]);
    rs.sort((a, b) => { const x = val(a), y = val(b); const r = (x == null) - (y == null) || (typeof x === 'string' ? x.localeCompare(y) : x - y); return st.asc ? r : -r; });
  }
  if (o.limit) rs = rs.slice(0, o.limit);
  const th = cols.map(c => `<th class="${c.n ? 'n' : ''} ${c.nosort ? '' : 'sortable'} ${st && st.k === c.k ? 'sorted' + (st.asc ? ' asc' : '') : ''}" data-k="${c.k}" ${c.tip ? `title="${esc(c.tip)}"` : ''}>${c.t}</th>`).join('');
  const body = rs.length ? rs.map(r => `<tr class="${o.click ? 'click' : ''} ${o.selKey && r[o.selKey] === S.sel ? 'sel' : ''}" ${o.click ? `data-id="${esc(r[o.click])}"` : ''}>${cols.map(c => `<td class="${c.n ? 'n' : ''}">${c.f ? c.f(r) : esc(r[c.k])}</td>`).join('')}</tr>`).join('')
    : `<tr><td colspan="${cols.length}" class="empty">${o.empty || '暂无数据'}</td></tr>`;
  return `<div class="tbl-wrap ${o.flush ? 'flush' : ''} ${o.scroll ? 'tbl-scroll' : ''}"><table data-tbl="${id}" data-asc="${o.asc ? 1 : 0}"><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function heatmap(rowsKeys, rowLabel, cols, cell, o = {}) {
  // cell(rowKey, col) -> {v, t}; diverging around 0 with o.scale
  let max = 0;
  const grid = rowsKeys.map(k => cols.map(c => { const x = cell(k, c); if (x && x.v != null) max = Math.max(max, Math.abs(x.v)); return x; }));
  max = o.max || max || 1;
  const head = `<tr><th></th>${cols.map(c => `<th class="dh">${esc(o.colFmt ? o.colFmt(c) : c)}</th>`).join('')}</tr>`;
  const body = rowsKeys.map((k, i) => `<tr><th>${esc(rowLabel(k))}</th>${grid[i].map(x => {
    if (!x || x.v == null) return `<td class="c" data-t="${esc(x?.t || '无数据')}"></td>`;
    const p = Math.min(100, Math.round(Math.sqrt(Math.abs(x.v) / max) * 100));
    const col = o.mono ? 'var(--s1)' : x.v >= 0 ? 'var(--pos)' : 'var(--neg)';
    const bg = x.v === 0 ? 'var(--surface-2)' : `color-mix(in srgb, ${col} ${Math.max(12, p)}%, var(--surface-2))`;
    return `<td class="c" style="background:${bg}" data-t="${esc(x.t)}"></td>`;
  }).join('')}</tr>`).join('');
  return `<div class="hm"><table>${head}${body}</table></div>`;
}

/* ---------- aggregations ---------- */
function aggAddr(days) {
  const set = new Set(days), m = {};
  for (const r of S.ad) {
    if (!set.has(r.day)) continue;
    const g = m[r.addr] ||= { addr: r.addr, label: S.label[r.addr] || r.label, group: S.group[r.addr], volume: 0, fills: 0, realized_pnl: 0, fees: 0, funding: 0, pnl: 0, net_flow: 0, active_days: 0, days: 0, start_eq: null, end_eq: 0, win: 0, loss: 0 };
    g.volume += r.volume; g.fills += r.fills; g.realized_pnl += r.realized_pnl; g.fees += r.fees; g.funding += r.funding || 0; g.pnl += r.pnl_day; g.net_flow += r.net_flow;
    g.days++; if (r.fills > 0) g.active_days++;
    if (g.start_eq == null) g.start_eq = r.equity - r.pnl_day - r.net_flow;
    g.end_eq = r.equity;
    if (r.pnl_day > 0) g.win++; else if (r.pnl_day < 0) g.loss++;
  }
  for (const g of Object.values(m)) { const base = (g.start_eq || 0) + Math.max(0, g.net_flow); g.roi = base > 1 ? g.pnl / base : 0; }
  return m;
}
function aggCoin(days) {
  const set = new Set(days), m = {};
  for (const r of S.cd) {
    if (!set.has(r.day)) continue;
    const g = m[r.coin] ||= { coin: r.coin, volume: 0, fills: 0, realized_pnl: 0, fees: 0, funding: 0, maker_volume: 0, taker_volume: 0, open_long: 0, open_short: 0, wins: 0, losses: 0, addrs: new Set(), days: new Set() };
    for (const k of ['volume', 'fills', 'realized_pnl', 'fees', 'funding', 'maker_volume', 'taker_volume', 'open_long', 'open_short', 'wins', 'losses']) g[k] += r[k] || 0;
    if (r.fills > 0) { g.addrs.add(r.addr); g.days.add(r.day); }
  }
  return Object.values(m).map(g => ({ ...g, n_addrs: g.addrs.size, n_days: g.days.size, net: g.realized_pnl - g.fees + g.funding }));
}
function isoWeek(day) {
  const d = new Date(day + 'T00:00:00Z'); const wd = (d.getUTCDay() + 6) % 7;
  const th = new Date(d); th.setUTCDate(d.getUTCDate() - wd + 3);
  const y = th.getUTCFullYear(), jan4 = new Date(Date.UTC(y, 0, 4));
  const w = 1 + Math.round(((th - jan4) / 864e5 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
  const mon = new Date(d); mon.setUTCDate(d.getUTCDate() - wd);
  const sun = new Date(mon); sun.setUTCDate(mon.getUTCDate() + 6);
  return { key: `${y}-W${String(w).padStart(2, '0')}`, start: mon.toISOString().slice(0, 10), end: sun.toISOString().slice(0, 10) };
}
function periodRows(keyFn) {
  const m = {}; const order = [];
  S.dt.forEach((r, i) => {
    const k = keyFn(r.day);
    if (!m[k.key]) { m[k.key] = { ...k, days: [], volume: 0, fills: 0, pnl: 0, realized: 0, fees: 0, funding: 0, net_flow: 0, start_eq: (i ? S.dt[i - 1].equity : r.equity - r.pnl_day - r.net_flow), end_eq: 0, win: 0, loss: 0 }; order.push(k.key); }
    const g = m[k.key];
    g.days.push(r.day); g.volume += r.volume; g.fills += r.fills; g.pnl += r.pnl_day; g.realized += r.realized_pnl; g.fees += r.fees; g.funding += r.funding || 0; g.net_flow += r.net_flow; g.end_eq = r.equity;
    if (r.pnl_day > 0) g.win++; else if (r.pnl_day < 0) g.loss++;
  });
  const rows = order.map(k => m[k]);
  rows.forEach(g => { if (g.month) { g.end = g.days[g.days.length - 1]; } });
  rows.forEach((g, i) => {
    const set = new Set(g.days);
    g.active = new Set(S.ad.filter(r => set.has(r.day) && r.fills > 0).map(r => r.addr)).size;
    g.ret = g.start_eq + Math.max(0, g.net_flow) > 1 ? g.pnl / (g.start_eq + Math.max(0, g.net_flow)) : 0;
    const lastDay = S.days[S.days.length - 1];
    g.partial_start = i === 0 && g.days[0] > g.start;
    g.complete = g.month ? (i < rows.length - 1 && !g.partial_start) : (g.days.length === 7);
    g.status = g.complete ? '' : (i === rows.length - 1 ? '进行中' : '不完整');
  });
  rows.forEach((g, i) => { const p = rows[i - 1]; g.vol_chg = p && p.complete && g.complete && p.volume ? g.volume / p.volume - 1 : null; });
  return rows;
}

/* ================= VIEWS ================= */

function vOverview() {
  const days = rangeDays(), set = new Set(days);
  const R = S.dt.filter(r => set.has(r.day));
  if (!R.length) return '<div class="empty">暂无数据</div>';
  const last = R[R.length - 1], prev = S.dt[S.dt.indexOf(last) - 1];
  const all = S.range === 0 || S.days.length <= S.range;
  const pnl = sum(R, r => r.pnl_day), vol = sum(R, r => r.volume), fees = sum(R, r => r.fees), real = sum(R, r => r.realized_pnl), fund = sum(R, r => r.funding), flow = sum(R, r => r.net_flow);
  const startEq = S.dt.indexOf(R[0]) > 0 ? S.dt[S.dt.indexOf(R[0]) - 1].equity : R[0].equity - R[0].pnl_day - R[0].net_flow;
  const roi = all ? last.cum_roi : (startEq + Math.max(0, flow) > 1 ? pnl / (startEq + Math.max(0, flow)) : 0);
  const upnl = sum(S.summary, s => s.unrealized_pnl), eqNow = sum(S.summary, s => s.equity_now);
  const win = R.filter(r => r.pnl_day > 0).length, loss = R.filter(r => r.pnl_day < 0).length;
  const volChg = prev && prev.volume ? last.volume / prev.volume - 1 : null;
  const n = S.addrs.length;
  const A = Object.values(aggAddr(days)).sort((a, b) => b.pnl - a.pnl);
  const winners = A.filter(a => a.pnl > 0).slice(0, 5), losers = A.filter(a => a.pnl < 0).slice(-5).reverse();
  const rlab = all ? '本期' : `近 ${days.length} 天`;

  const html = `
  <div class="kpis">
    ${S.live ? kpi('账户总资金 · 实时', usd(eqNow), `较 ${last.day.slice(5)} 日终 ${sp(eqNow - last.equity)} · ${rlab}净流入 ${sp(flow)}`, '实时 = 刚才从 Hyperliquid clearinghouseState 拉取的账户价值合计')
      : kpi('账户总资金', usd(last.equity), `较前日 ${sp(prev ? last.equity - prev.equity : 0)} · ${rlab}净流入 ${sp(flow)}`)}
    ${S.live ? kpi('近 24 小时 · 实时', sp(sum(S.summary, s => s.live_pnl_24h || 0)), `交易量 ${usd(sum(S.summary, s => s.live_vlm_24h || 0))} · ${bj(S.live.at).slice(11, 16)} 拉取`, 'Hyperliquid portfolio 的 day 窗口（滚动 24 小时，不是 UTC 自然日）') : ''}
    ${depKpi(depNow(), `资金利用率 ${pct(last.equity ? depNow() / last.equity : 0, 0)} · 较${rlab}初 ${sp(depNow() - depOn(R[0].day))}`)}
    ${kpi(`${rlab}官方盈亏`, sp(pnl), `收益率 ${spp(roi)}`, '官方口径 = Hyperliquid portfolio 的盈亏历史，含持仓浮动盈亏变化')}
    ${kpi(`昨日盈亏 · ${last.day.slice(5)}`, sp(last.pnl_day), `占前日资金 ${spp(last.pnl_pct, 3)}`)}
    ${kpi(`${rlab}交易量`, usd(vol), `日均 ${usd(vol / R.length)} · 累计 ${usd(last.volume_cum)}`)}
    ${kpi('昨日交易量', usd(last.volume), `较前日 ${volChg == null ? '—' : spp(volChg, 1)}`)}
    ${kpi(`${rlab}手续费`, usd(fees), `费率 ${(vol ? fees / vol * 1e4 : 0).toFixed(2)} bps`)}
    ${kpi(`${rlab}已实现盈亏`, sp(real), `资金费 ${sp(fund)} · 交易净额 ${sp(real - fees + fund)}`)}
    ${kpi('当前浮动盈亏', sp(upnl), `占资金 ${spp(eqNow ? upnl / eqNow : 0, 2)}${S.live ? ' · 实时' : ''}`)}
    ${kpi('昨日活跃地址', `${last.active_addrs} <span class="muted" style="font-size:14px">/ ${n}</span>`, `${rlab}日均 ${(sum(R, r => r.active_addrs) / R.length).toFixed(1)} 个`)}
    ${kpi('盈利 / 亏损天数', `<span class="pos">${win}</span> <span class="muted">/</span> <span class="neg">${loss}</span>`, `日胜率 ${pct(win / Math.max(1, win + loss), 0)}`)}
  </div>
  <div class="grid g2">
    ${card('资金规模与部署金额', S.hasDep ? '账户资金（日终）与内部接口的部署金额' : '所有监控地址的日终账户资金合计；部署金额待接入内部接口', (S.hasDep ? legend([[css('--s1'), '账户资金'], [css('--s2'), '部署金额']]) : '') + chartBox('c-eq'))}
    ${card(`累计官方盈亏 · ${rlab}`, '从区间第一天起逐日累计', chartBox('c-cum'))}
  </div>
  <div class="grid g2">
    ${card('每日官方盈亏', '绿色盈利，红色亏损', chartBox('c-pnl'))}
    ${card('每日交易量', '全部监控地址成交额合计', chartBox('c-vol'))}
  </div>
  <div class="grid g32">
    ${card('每日盈亏构成', '已实现盈亏、手续费（负）、资金费逐日堆叠；与官方盈亏的差额主要是持仓浮动盈亏变化', legend([[css('--s1'), '已实现盈亏'], [css('--s2'), '手续费'], [css('--s3'), '资金费']]) + chartBox('c-attr'))}
    ${card(`盈亏归因 · ${rlab}`, '成交口径 vs 官方口径', `
      <table><tbody>
        <tr><td>已实现盈亏</td><td class="n">${sp(real, usdFull)}</td></tr>
        <tr><td>− 手续费</td><td class="n">${sp(-fees, usdFull)}</td></tr>
        <tr><td>+ 资金费</td><td class="n">${sp(fund, usdFull)}</td></tr>
        <tr><td><b>= 交易净盈亏</b></td><td class="n"><b>${sp(real - fees + fund, usdFull)}</b></td></tr>
        <tr><td>官方盈亏</td><td class="n">${sp(pnl, usdFull)}</td></tr>
        <tr><td class="muted">差额（浮盈变化等）</td><td class="n">${sp(pnl - (real - fees + fund), usdFull)}</td></tr>
        <tr><td>手续费 / 交易量</td><td class="n">${(vol ? fees / vol * 1e4 : 0).toFixed(2)} bps</td></tr>
        <tr><td>手续费 / |已实现|</td><td class="n">${pct(Math.abs(real) ? fees / Math.abs(real) : 0, 1)}</td></tr>
      </tbody></table>`)}
  </div>
  <div class="grid g3">
    ${card('每日净流入', '入金 − 出金（资金变化 − 官方盈亏）', chartBox('c-flow', 'short'))}
    ${card(`盈利 Top 5 · ${rlab}`, '', table('ov-win', [
      { k: 'label', t: '地址', f: r => `<a href="#address/${r.addr}">${esc(r.label)}</a>`, nosort: 1 },
      { k: 'pnl', t: '盈亏', n: 1, f: r => sp(r.pnl), nosort: 1 }, { k: 'roi', t: '收益率', n: 1, f: r => spp(r.roi), nosort: 1 }], winners, { empty: '无盈利地址' }))}
    ${card(`亏损 Top 5 · ${rlab}`, '', table('ov-loss', [
      { k: 'label', t: '地址', f: r => `<a href="#address/${r.addr}">${esc(r.label)}</a>`, nosort: 1 },
      { k: 'pnl', t: '盈亏', n: 1, f: r => sp(r.pnl), nosort: 1 }, { k: 'roi', t: '收益率', n: 1, f: r => spp(r.roi), nosort: 1 }], losers, { empty: '无亏损地址' }))}
  </div>`;
  const after = () => {
    const L = R.map(r => shortDay(r.day));
    mk('c-eq', 'line', L, [lineDs('账户资金', R.map(r => r.equity), css('--s1'), true)].concat(S.hasDep ? [lineDs('部署金额', R.map(r => depOn(r.day)), css('--s2'))] : []), { zero: false });
    let c = 0; const cum = R.map(r => (c += r.pnl_day));
    mk('c-cum', 'line', L, [{ ...lineDs('累计盈亏', cum, css('--s1'), true), segment: { borderColor: x => x.p1.parsed.y < 0 ? css('--neg') : css('--pos') } }], { zero: false });
    const pd = R.map(r => r.pnl_day);
    mk('c-pnl', 'bar', L, [{ ...barDs('官方盈亏', pd), backgroundColor: pnColors(pd) }]);
    mk('c-vol', 'bar', L, [barDs('交易量', R.map(r => r.volume), css('--s1'))]);
    mk('c-attr', 'bar', L, [barDs('已实现盈亏', R.map(r => r.realized_pnl), css('--s1')), barDs('手续费', R.map(r => -r.fees), css('--s2')), barDs('资金费', R.map(r => r.funding || 0), css('--s3'))], { stacked: true });
    const fl = R.map(r => r.net_flow);
    mk('c-flow', 'bar', L, [{ ...barDs('净流入', fl), backgroundColor: fl.map(v => v >= 0 ? css('--s1') : css('--s2')) }]);
  };
  return [html, after];
}

function vWeekly() {
  const W = periodRows(d => isoWeek(d)).reverse();
  const M = periodRows(d => ({ key: d.slice(0, 7), month: 1, start: d.slice(0, 7) + '-01', end: '' })).reverse();
  if (!W.length) return '<div class="empty">暂无数据</div>';
  const sel = W.find(w => w.key === S.week) || W.find(w => w.complete) || W[0];
  S.week = sel.key;
  const days = new Set(sel.days);
  const A = Object.values(aggAddr(sel.days)).sort((a, b) => b.pnl - a.pnl);
  const C = aggCoin(sel.days).sort((a, b) => b.volume - a.volume);
  const prevW = W[W.indexOf(sel) + 1];
  const D = S.dt.filter(r => days.has(r.day));
  const cols = [
    { k: 'key', t: '周', f: r => `<b>${r.key}</b>${r.status ? ` <span class="chip mute">${r.status}</span>` : ''}` },
    { k: 'start', t: '起止', f: r => `${r.start.slice(5)} ~ ${r.end.slice(5)}` },
    { k: 'volume', t: '交易量', n: 1, f: r => usd(r.volume) },
    { k: 'vol_chg', t: '环比', n: 1, f: r => r.vol_chg == null ? '—' : spp(r.vol_chg, 1) },
    { k: 'pnl', t: '官方盈亏', n: 1, f: r => sp(r.pnl) },
    { k: 'ret', t: '收益率', n: 1, f: r => spp(r.ret) },
    { k: 'realized', t: '已实现', n: 1, f: r => sp(r.realized) },
    { k: 'fees', t: '手续费', n: 1, f: r => usd(r.fees) },
    { k: 'funding', t: '资金费', n: 1, f: r => sp(r.funding) },
    { k: 'net_flow', t: '净流入', n: 1, f: r => sp(r.net_flow) },
    { k: 'end_eq', t: '期末资金', n: 1, f: r => usd(r.end_eq) },
    { k: 'end_dep', t: '期末部署', n: 1, v: r => depOn(r.days[r.days.length - 1]), f: r => depCell(depOn(r.days[r.days.length - 1])) },
    { k: 'active', t: '活跃地址', n: 1 },
    { k: 'win', t: '盈/亏天', n: 1, f: r => `<span class="pos">${r.win}</span>/<span class="neg">${r.loss}</span>` },
  ];
  const mcols = cols.filter(c => !['start'].includes(c.k)).map(c => c.k === 'key' ? { ...c, t: '月份' } : c);
  const d = (a, b) => b ? (b ? a / b - 1 : null) : null;
  const html = `
  ${card('周度汇总', '点击某一周查看当周详情', table('wk', cols, W, { click: 'key', selKey: 'key' }))}
  <div class="sec-t">${sel.key} · ${sel.start} ~ ${sel.end}${sel.status ? `（${sel.status}）` : ''}</div>
  <div class="kpis">
    ${kpi('周交易量', usd(sel.volume), prevW ? `环比 ${spp(d(sel.volume, prevW.volume), 1)}` : '')}
    ${kpi('周官方盈亏', sp(sel.pnl), `收益率 ${spp(sel.ret)}${prevW ? ` · 上周 ${sp(prevW.pnl)}` : ''}`)}
    ${kpi('资金变动', sp(sel.end_eq - sel.start_eq), `期初 ${usd(sel.start_eq)} → 期末 ${usd(sel.end_eq)}`)}
    ${depKpi(depOn(sel.days[sel.days.length - 1]), `期初 ${usd(depOn(sel.days[0]))} → 期末 ${usd(depOn(sel.days[sel.days.length - 1]))}`)}
    ${kpi('净流入', sp(sel.net_flow), '入金 − 出金')}
    ${kpi('活跃地址', `${sel.active} / ${S.addrs.length}`, prevW ? `上周 ${prevW.active}` : '')}
    ${kpi('手续费', usd(sel.fees), `${(sel.volume ? sel.fees / sel.volume * 1e4 : 0).toFixed(2)} bps`)}
  </div>
  <div class="grid g2">
    ${card('当周每日', '', table('wk-d', [
      { k: 'day', t: '日期' }, { k: 'volume', t: '交易量', n: 1, f: r => usd(r.volume) }, { k: 'pnl_day', t: '官方盈亏', n: 1, f: r => sp(r.pnl_day) },
      { k: 'pnl_pct', t: '收益率', n: 1, f: r => spp(r.pnl_pct, 3) }, { k: 'net_flow', t: '净流入', n: 1, f: r => sp(r.net_flow) },
      { k: 'active_addrs', t: '活跃地址', n: 1 }, { k: 'equity', t: '日终资金', n: 1, f: r => usd(r.equity) }, { k: 'dep', t: '部署金额', n: 1, v: r => depOn(r.day), f: r => depCell(depOn(r.day)) }], D, { sort: 'day', asc: true }))}
    ${card('当周币种', '按成交额排序', table('wk-c', [
      { k: 'coin', t: '币种', f: r => `<b>${esc(r.coin)}</b>` }, { k: 'volume', t: '交易量', n: 1, f: r => usd(r.volume) },
      { k: 'net', t: '交易净盈亏', n: 1, f: r => sp(r.net) }, { k: 'n_addrs', t: '地址数', n: 1 }], C, { sort: 'volume', limit: 10 }))}
  </div>
  <div class="grid g2">
    ${card('当周地址表现 · 盈利', '', table('wk-w', addrMiniCols(), A.filter(a => a.pnl > 0).slice(0, 8), { empty: '无' }))}
    ${card('当周地址表现 · 亏损', '', table('wk-l', addrMiniCols(), A.filter(a => a.pnl < 0).reverse().slice(0, 8), { empty: '无' }))}
  </div>
  ${card('月度汇总', '自然月（UTC）', table('mo', mcols, M))}`;
  const after = () => {
    document.querySelectorAll('[data-tbl="wk"] tbody tr').forEach(tr => tr.onclick = () => { S.week = tr.dataset.id; render(); });
  };
  return [html, after];
}
const addrMiniCols = () => [
  { k: 'label', t: '地址', f: r => `<a href="#address/${r.addr}">${esc(r.label)}</a>`, nosort: 1 },
  { k: 'pnl', t: '官方盈亏', n: 1, f: r => sp(r.pnl), nosort: 1 }, { k: 'roi', t: '收益率', n: 1, f: r => spp(r.roi), nosort: 1 },
  { k: 'volume', t: '交易量', n: 1, f: r => usd(r.volume), nosort: 1 }];

function vOps() {
  const days = rangeDays(), set = new Set(days);
  const R = S.dt.filter(r => set.has(r.day));
  const A = aggAddr(days);
  const list = S.addrs.map(a => {
    const g = A[a.addr] || { volume: 0, fills: 0, fees: 0, active_days: 0, days: 0 };
    const s = S.summary.find(x => x.addr === a.addr) || {};
    const rows = S.adBy[a.addr] || [];
    let idle = 0; for (let i = rows.length - 1; i >= 0 && rows[i].fills === 0; i--) idle++;
    return { addr: a.addr, label: a.label, group: a.group, status: s.status || '—', first: s.first_trade, last: s.last_trade, added: a.added,
      volume: g.volume, fills: g.fills, fees: g.fees, active_days: g.active_days, days: g.days, idle, equity: s.equity_now || 0,
      bps: g.volume ? g.fees / g.volume * 1e4 : 0, dep: depNow(byAddr(a.addr)), turnover: s.equity_now > 1 ? g.volume / s.equity_now / Math.max(1, g.days) : 0 };
  });
  const totVol = sum(list, x => x.volume);
  list.forEach(x => x.share = totVol ? x.volume / totVol : 0);
  const C = aggCoin(days).sort((a, b) => b.volume - a.volume);
  const maker = sum(C, c => c.maker_volume), taker = sum(C, c => c.taker_volume);
  const last = R[R.length - 1] || {};
  const newAddr = list.filter(x => x.first && set.has(x.first));
  const idleAddr = list.filter(x => x.idle >= 3 || x.status === '闲置');
  const tiers = [['< $1K', 0, 1e3], ['$1K – 10K', 1e3, 1e4], ['$10K – 100K', 1e4, 1e5], ['≥ $100K', 1e5, Infinity]].map(([t, lo, hi]) => {
    const xs = list.filter(x => x.equity >= lo && x.equity < hi);
    return { t, n: xs.length, eq: sum(xs, x => x.equity), dep: sum(xs, x => x.dep), vol: sum(xs, x => x.volume) };
  });
  const totEq = sum(tiers, t => t.eq);
  const top5share = sum(list.slice().sort((a, b) => b.volume - a.volume).slice(0, 5), x => x.share);
  const groups = {}; list.forEach(x => { const g = groups[x.group] ||= { group: x.group, n: 0, volume: 0, equity: 0, dep: 0, active: 0 }; g.n++; g.volume += x.volume; g.equity += x.equity; g.dep += x.dep; if (x.active_days) g.active++; });
  const statusCnt = {}; list.forEach(x => statusCnt[x.status] = (statusCnt[x.status] || 0) + 1);

  const html = `
  <div class="kpis">
    ${kpi('昨日活跃地址', `${last.active_addrs ?? '—'} / ${S.addrs.length}`, `活跃率 ${pct((last.active_addrs || 0) / S.addrs.length, 0)}`)}
    ${kpi('日均成交笔数', int(sum(R, r => r.fills) / Math.max(1, R.length)), `区间合计 ${int(sum(R, r => r.fills))} 笔`)}
    ${kpi('单地址日均交易量', usd(totVol / Math.max(1, R.length) / Math.max(1, S.addrs.length)), `区间 ${usd(totVol)}`)}
    ${kpi('Maker 成交占比', pct(maker + taker ? maker / (maker + taker) : 0, 1), `Taker ${pct(maker + taker ? taker / (maker + taker) : 0, 1)}${maker === 0 && taker > 0 ? ' · 全部吃单' : ''}`, 'Maker = 挂单成交（crossed=false）；全部吃单时改为挂单可降低手续费')}
    ${kpi('综合费率', `${(totVol ? sum(list, x => x.fees) / totVol * 1e4 : 0).toFixed(2)} bps`, `手续费 ${usd(sum(list, x => x.fees))}`)}
    ${kpi('Top5 地址交易量占比', pct(top5share, 1), '集中度')}
    ${kpi('区间新开始交易', `${newAddr.length} 个`, newAddr.slice(0, 3).map(x => x.label.split(' ')[0]).join(' ') || '—')}
    ${kpi('闲置地址', `${idleAddr.length} 个`, '连续 ≥3 天无成交或无持仓')}
  </div>
  <div class="grid g2">
    ${card('每日活跃地址数', '当日有成交的地址', chartBox('o-act', 'short'))}
    ${card('每日成交笔数', '', chartBox('o-fills', 'short'))}
  </div>
  <div class="grid g2">
    ${card('地址交易量贡献', '区间交易量占比，按地址排序', chartBox('o-share', 'tall'))}
    ${card('币种交易量分布', '区间成交额，前 7 个币种 + 其他', chartBox('o-coin', 'tall'))}
  </div>
  <div class="grid g2">
    ${card('Maker / Taker 每日结构', '成交额占比', legend([[css('--s1'), 'Maker 挂单'], [css('--s2'), 'Taker 吃单']]) + chartBox('o-mt', 'short'))}
    ${card('开仓方向', '每日开多 vs 开空成交额', legend([[css('--s3'), '开多'], [css('--s2'), '开空']]) + chartBox('o-dir', 'short'))}
  </div>
  <div class="grid g3">
    ${card('资金分层', '按当前账户资金', table('o-tier', [{ k: 't', t: '层级', nosort: 1 }, { k: 'n', t: '地址数', n: 1, nosort: 1 },
      { k: 'eq', t: '资金', n: 1, nosort: 1, f: r => usd(r.eq) }, { k: 'dep', t: '部署金额', n: 1, nosort: 1, f: r => depCell(r.dep) }, { k: 'p', t: '资金占比', n: 1, nosort: 1, f: r => pct(totEq ? r.eq / totEq : 0, 1) },
      { k: 'vol', t: '区间交易量', n: 1, nosort: 1, f: r => usd(r.vol) }], tiers))}
    ${card('地址状态', '基于最近一个完整日', table('o-st', [{ k: 's', t: '状态', nosort: 1 }, { k: 'n', t: '地址数', n: 1, nosort: 1 }],
      Object.entries(statusCnt).map(([s, n]) => ({ s, n }))))}
    ${card('分组', '在 watchlist.json 中给地址加 "group" 字段即可分组', table('o-grp', [{ k: 'group', t: '分组' }, { k: 'n', t: '地址', n: 1 },
      { k: 'active', t: '活跃', n: 1 }, { k: 'equity', t: '资金', n: 1, f: r => usd(r.equity) }, { k: 'dep', t: '部署金额', n: 1, f: r => depCell(r.dep) }, { k: 'volume', t: '交易量', n: 1, f: r => usd(r.volume) }], Object.values(groups), { sort: 'equity' }))}
  </div>
  ${card('地址运营明细', '区间口径；点击地址进入详情', table('o-list', [
    { k: 'label', t: '地址', f: r => `<a href="#address/${r.addr}">${esc(r.label)}</a>` },
    { k: 'group', t: '分组' },
    { k: 'status', t: '状态', f: r => `<span class="chip ${r.status === '活跃' ? 'ok' : r.status === '闲置' ? 'mute' : 'info'}">${esc(r.status)}</span>` },
    { k: 'added', t: '加入名单' }, { k: 'first', t: '首次交易' }, { k: 'last', t: '最近交易' },
    { k: 'active_days', t: '活跃天数', n: 1, f: r => `${r.active_days}/${r.days}` },
    { k: 'idle', t: '连续闲置', n: 1, f: r => r.idle ? `<span class="${r.idle >= 3 ? 'neg' : ''}">${r.idle} 天</span>` : '—' },
    { k: 'volume', t: '交易量', n: 1, f: r => usd(r.volume) },
    { k: 'share', t: '占比', n: 1, f: r => `${pct(r.share, 1)}<span class="bar-in"><i style="width:${Math.min(100, r.share * 100 / Math.max(.01, top5share / 2))}%"></i></span>` },
    { k: 'fills', t: '笔数', n: 1, f: r => int(r.fills) },
    { k: 'turnover', t: '日均换手', n: 1, f: r => r.turnover.toFixed(2) + 'x', tip: '日均交易量 ÷ 当前资金' },
    { k: 'fees', t: '手续费', n: 1, f: r => usd(r.fees) },
    { k: 'bps', t: '费率', n: 1, f: r => r.bps ? r.bps.toFixed(2) + ' bps' : '—' },
    { k: 'equity', t: '资金', n: 1, f: r => usd(r.equity) }, { k: 'dep', t: '部署金额', n: 1, f: r => depCell(r.dep) }], list, { sort: 'volume' }))}`;
  const after = () => {
    const L = R.map(r => shortDay(r.day));
    mk('o-act', 'bar', L, [barDs('活跃地址', R.map(r => r.active_addrs), css('--s1'))], { fmt: v => Math.round(v), tipFmt: v => v + ' 个' });
    mk('o-fills', 'bar', L, [barDs('成交笔数', R.map(r => r.fills), css('--s1'))], { fmt: v => int(v), tipFmt: v => int(v) + ' 笔' });
    const ls = list.filter(x => x.volume > 0).sort((a, b) => b.volume - a.volume);
    mk('o-share', 'bar', ls.map(x => x.label.split(' ')[0] + ' ' + x.label.split(' ').slice(-1)[0].slice(0, 6)), [barDs('交易量', ls.map(x => x.volume), css('--s1'))],
      { horizontal: true, tipCb: { afterLabel: c => ` 占比 ${pct(ls[c.dataIndex].share, 1)}` } });
    const top = C.slice(0, 7), other = sum(C.slice(7), c => c.volume);
    const cl = top.map(c => c.coin).concat(other > 0 ? ['其他'] : []), cv = top.map(c => c.volume).concat(other > 0 ? [other] : []);
    const cc = SERIES().slice(0, top.length).concat([css('--other')]);
    mk('o-coin', 'bar', cl, [{ ...barDs('交易量', cv), backgroundColor: cc }], { horizontal: true, tipCb: { afterLabel: c => ` 占比 ${pct(cv[c.dataIndex] / sum(cv), 1)}` } });
    const byDay = {}; S.cd.forEach(r => { if (!set.has(r.day)) return; const g = byDay[r.day] ||= { m: 0, t: 0, ol: 0, os: 0 }; g.m += r.maker_volume || 0; g.t += r.taker_volume || 0; g.ol += r.open_long || 0; g.os += r.open_short || 0; });
    const dd = days.filter(d => byDay[d]);
    mk('o-mt', 'bar', dd.map(shortDay), [barDs('Maker', dd.map(d => { const g = byDay[d]; return g.m + g.t ? g.m / (g.m + g.t) : 0; }), css('--s1')),
      barDs('Taker', dd.map(d => { const g = byDay[d]; return g.m + g.t ? g.t / (g.m + g.t) : 0; }), css('--s2'))], { stacked: true, fmt: v => pct(v, 0), ymax: 1 });
    mk('o-dir', 'bar', dd.map(shortDay), [barDs('开多', dd.map(d => byDay[d].ol), css('--s3')), barDs('开空', dd.map(d => byDay[d].os), css('--s2'))]);
  };
  return [html, after];
}

function vAddress(param) {
  const days = rangeDays();
  const A = aggAddr(days);
  const rows = S.summary.map(s => ({ ...s, group: S.group[s.addr], r: A[s.addr] || { pnl: 0, volume: 0, roi: 0, fees: 0, active_days: 0 } }));
  if (param && S.label[param]) S.sel = param;
  if (!S.sel || !S.label[S.sel]) S.sel = rows.slice().sort((a, b) => b.equity_now - a.equity_now)[0]?.addr;
  const html = `
  ${card('地址总览', `区间（${days[0]?.slice(5)} ~ ${days[days.length - 1]?.slice(5)}）口径的盈亏与交易量；资金、浮盈、杠杆为${S.live ? '实时' : '最近快照'}。点击行查看详情`,
    `<div class="toolbar"><input id="addr-q" placeholder="搜索地址 / 备注 / 分组" value="${esc(S.q || '')}"></div>` +
    table('addr', [
      { k: 'label', t: '地址', f: r => `<b>${esc(r.label)}</b>`, v: r => +(r.label.match(/#(\d+)/)?.[1] || 999) },
      { k: 'alert_level', t: '预警', f: r => r.alert_count ? chip(r.alert_level, `${r.alert_level} ${r.alert_count}`) : chip('正常'), v: r => ({ '严重': 3, '警告': 2, '提示': 1 }[r.alert_level] || 0) },
      { k: 'equity_now', t: '资金', n: 1, f: r => usd(r.equity_now) },
      { k: 'dep', t: '部署金额', n: 1, v: r => depNow(byAddr(r.addr)), f: r => depCell(depNow(byAddr(r.addr))) },
      { k: 'rp', t: '区间盈亏', n: 1, f: r => sp(r.r.pnl), v: r => r.r.pnl },
      { k: 'rr', t: '收益率', n: 1, f: r => spp(r.r.roi), v: r => r.r.roi },
      { k: 'pnl_day', t: '昨日盈亏', n: 1, f: r => sp(r.pnl_day) },
      { k: 'rv', t: '区间交易量', n: 1, f: r => usd(r.r.volume), v: r => r.r.volume },
      { k: 'unrealized_pnl', t: '浮动盈亏', n: 1, f: r => sp(r.unrealized_pnl) },
      { k: 'leverage', t: '杠杆', n: 1, f: r => r.leverage ? r.leverage.toFixed(2) + 'x' : '—' },
      { k: 'drawdown_pct', t: '当前回撤', n: 1, f: r => r.drawdown_pct ? `<span class="${r.drawdown_pct > .1 ? 'neg' : ''}">${pct(r.drawdown_pct, 1)}</span>` : '—' },
      { k: 'positions', t: '持仓', f: r => `<span class="muted">${esc(r.positions)}</span>` },
    ], rows.filter(r => !S.q || (r.label + r.addr + r.group).toLowerCase().includes(S.q.toLowerCase())), { sort: 'equity_now', click: 'addr', selKey: 'addr', scroll: 1 }))}
  <div id="addr-detail"></div>
  ${card('地址 × 日期 盈亏热力图', '每格为当日官方盈亏占前日资金的比例；颜色越深幅度越大', heatmap(
    S.addrs.map(a => a.addr), a => S.label[a],
    days, (a, d) => { const r = (S.adBy[a] || []).find(x => x.day === d); return r ? { v: r.pnl_pct, t: `${S.label[a]}\n${d}\n盈亏 ${usd(r.pnl_day, { sign: true })}（${pct(r.pnl_pct, 2, true)}）\n交易量 ${usd(r.volume)}` } : null; },
    { colFmt: shortDay, max: .05 }))}`;
  const after = () => {
    const q = $('#addr-q');
    if (q) q.oninput = () => { S.q = q.value; const pos = q.selectionStart; render(); const q2 = $('#addr-q'); q2.focus(); q2.setSelectionRange(pos, pos); };
    document.querySelectorAll('[data-tbl="addr"] tbody tr').forEach(tr => tr.onclick = () => { S.sel = tr.dataset.id; history.replaceState(null, '', '#address/' + S.sel); render(); $('#addr-detail')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
    addrDetail(days);
  };
  return [html, after];
}

function addrDetail(days) {
  const a = S.sel, box = $('#addr-detail');
  if (!a || !box) return;
  const s = S.summary.find(x => x.addr === a) || {};
  const set = new Set(days);
  const R = (S.adBy[a] || []).filter(r => set.has(r.day));
  const g = aggAddr(days)[a] || { pnl: 0, roi: 0, volume: 0, fees: 0, realized_pnl: 0, funding: 0 };
  const C = S.cd.filter(r => r.addr === a && set.has(r.day));
  const cm = {}; C.forEach(r => { const x = cm[r.coin] ||= { coin: r.coin, volume: 0, fills: 0, realized_pnl: 0, fees: 0, funding: 0 }; x.volume += r.volume; x.fills += r.fills; x.realized_pnl += r.realized_pnl; x.fees += r.fees; x.funding += r.funding; });
  const coins = Object.values(cm).map(x => ({ ...x, net: x.realized_pnl - x.fees + x.funding }));
  const P = S.positions.filter(p => p.addr === a);
  const AL = S.alerts.filter(x => x.addr === a);
  box.innerHTML = `
  <div class="sec-t">${esc(s.label)} <span class="addr">${a}</span>
    <a href="https://app.hyperliquid.xyz/explorer/address/${a}" target="_blank" rel="noopener">HL Explorer ↗</a>
    <a href="https://hypurrscan.io/address/${a}" target="_blank" rel="noopener">Hypurrscan ↗</a></div>
  ${AL.length ? `<div class="checks">${AL.map(x => `<div class="check"><span class="ic ${LV[x.level]}">!</span><div>${chip(x.level, x.rule)} ${esc(x.message)}</div></div>`).join('')}</div>` : ''}
  <div class="kpis">
    ${kpi('资金', usd(s.equity_now), `较前日 ${sp(s.equity_change_day)}`)}
    ${depKpi(depNow(byAddr(a)), [...new Set(S.deps.filter(d => d.addr === a && depActive(d, S.today)).map(d => d.coin))].join(' / ') + ` · 利用率 ${pct(s.equity_now ? depNow(byAddr(a)) / s.equity_now : 0, 0)}`)}
    ${kpi('区间官方盈亏', sp(g.pnl), `收益率 ${spp(g.roi)}`)}
    ${kpi('本期累计盈亏', sp(s.pnl_period), `收益率 ${spp(s.pnl_period_pct)}`)}
    ${kpi('区间交易量', usd(g.volume), `手续费 ${usd(g.fees)}`)}
    ${kpi('交易净盈亏', sp(g.realized_pnl - g.fees + g.funding), `已实现 ${sp(g.realized_pnl)} · 资金费 ${sp(g.funding)}`)}
    ${kpi('浮动盈亏', sp(s.unrealized_pnl), `占资金 ${spp(s.unrealized_pct)}`)}
    ${kpi('杠杆 / 名义', `${(s.leverage || 0).toFixed(2)}x`, usd(s.position_ntl))}
    ${kpi('最大回撤', usd(s.max_drawdown), `当前 ${pct(s.drawdown_pct, 1)}`)}
  </div>
  <div class="grid g2">
    ${card(S.hasDep ? '资金与部署金额' : '资金曲线', '', (S.hasDep ? legend([[css('--s1'), '账户资金'], [css('--s2'), '部署金额']]) : '') + chartBox('d-eq', 'short'))}
    ${card('每日官方盈亏', '', chartBox('d-pnl', 'short'))}
  </div>
  <div class="grid g2">
    ${card('币种贡献', '区间成交口径', table('d-coin', [{ k: 'coin', t: '币种', f: r => `<b>${esc(r.coin)}</b>` }, { k: 'st', t: '策略', v: r => stratOf(a, r.coin).strategy, f: r => { const c = stratOf(a, r.coin); return `<a href="#strategy/${encodeURIComponent(c.strategy)}">${esc(c.name || c.strategy)}</a>`; } }, { k: 'dep', t: '部署金额', n: 1, v: r => depNow(d => d.addr === a && d.coin === r.coin), f: r => depCell(depNow(d => d.addr === a && d.coin === r.coin)) }, { k: 'volume', t: '交易量', n: 1, f: r => usd(r.volume) },
      { k: 'fills', t: '笔数', n: 1, f: r => int(r.fills) }, { k: 'realized_pnl', t: '已实现', n: 1, f: r => sp(r.realized_pnl) }, { k: 'fees', t: '手续费', n: 1, f: r => usd(r.fees) },
      { k: 'net', t: '净盈亏', n: 1, f: r => sp(r.net) }], coins, { sort: 'volume' }))}
    ${card('当前持仓', S.live ? '实时' : '最近快照', posTable('d-pos', P, true))}
  </div>
  ${card('每日明细', '', table('d-daily', [{ k: 'day', t: '日期' }, { k: 'volume', t: '交易量', n: 1, f: r => usd(r.volume) }, { k: 'fills', t: '笔数', n: 1 },
    { k: 'realized_pnl', t: '已实现', n: 1, f: r => sp(r.realized_pnl) }, { k: 'fees', t: '手续费', n: 1, f: r => usd(r.fees) }, { k: 'funding', t: '资金费', n: 1, f: r => sp(r.funding) },
    { k: 'pnl_day', t: '官方盈亏', n: 1, f: r => sp(r.pnl_day) }, { k: 'pnl_pct', t: '收益率', n: 1, f: r => spp(r.pnl_pct, 3) },
    { k: 'equity', t: '日终资金', n: 1, f: r => usd(r.equity) }, { k: 'dep', t: '部署金额', n: 1, v: r => depOn(r.day, byAddr(a)), f: r => depCell(depOn(r.day, byAddr(a))) }, { k: 'net_flow', t: '净流入', n: 1, f: r => sp(r.net_flow) }], R, { sort: 'day', scroll: 1 }))}`;
  const L = R.map(r => shortDay(r.day));
  mk('d-eq', 'line', L, [lineDs('账户资金', R.map(r => r.equity), css('--s1'), true)].concat(S.hasDep ? [lineDs('部署金额', R.map(r => depOn(r.day, byAddr(a))), css('--s2'))] : []), { zero: false });
  const pd = R.map(r => r.pnl_day);
  mk('d-pnl', 'bar', L, [{ ...barDs('官方盈亏', pd), backgroundColor: pnColors(pd) }]);
  bindSort(box);
}

function posTable(id, P, compact) {
  const cols = [
    ...(compact ? [] : [{ k: 'label', t: '地址', f: r => `<a href="#address/${r.addr}">${esc(r.label)}</a>` }]),
    { k: 'coin', t: '币种', f: r => `<b>${esc(r.coin)}</b>` },
    { k: 'strat', t: '策略', v: r => stratOf(r.addr, r.coin).strategy, f: r => { const c = stratOf(r.addr, r.coin); return `<a href="#strategy/${encodeURIComponent(c.strategy)}">${esc(c.name || c.strategy)}</a>`; } },
    { k: 'side', t: '方向', f: r => `<span class="chip ${r.side === '多' ? 'ok' : 'crit'}">${r.side}</span>` },
    { k: 'notional', t: '名义价值', n: 1, f: r => usd(r.notional) },
    { k: 'dep', t: '部署金额', n: 1, v: r => depNow(d => d.addr === r.addr && d.coin === r.coin), f: r => depCell(depNow(d => d.addr === r.addr && d.coin === r.coin)) },
    { k: 'entry_px', t: '开仓价', n: 1, f: r => (+r.entry_px).toPrecision(6) },
    { k: 'mark_px', t: '标记价', n: 1, f: r => (+r.mark_px).toPrecision(6) },
    { k: 'unrealized_pnl', t: '浮动盈亏', n: 1, f: r => sp(r.unrealized_pnl) },
    { k: 'roe', t: 'ROE', n: 1, f: r => spp(r.roe) },
    { k: 'leverage', t: '杠杆', v: r => parseFloat(r.leverage) },
    { k: 'liq_distance', t: '距强平', n: 1, f: r => r.liq_distance == null ? '<span class="muted">无</span>' : `<span class="${r.liq_distance < .15 ? 'neg' : ''}">${pct(r.liq_distance, 1)}</span>` },
    ...(compact ? [] : [{ k: 'funding_since_open', t: '持仓资金费', n: 1, f: r => sp(r.funding_since_open) }, { k: 'pct_of_equity', t: '占资金', n: 1, f: r => pct(r.pct_of_equity, 1) }]),
  ];
  return table(id, cols, P, { sort: 'notional', empty: '无持仓', scroll: !compact });
}

function vCoins() {
  const days = rangeDays(), set = new Set(days);
  const C = aggCoin(days).sort((a, b) => b.volume - a.volume);
  const tot = sum(C, c => c.volume);
  const top = C.slice(0, 5).map(c => c.coin);
  const P = S.positions;
  const exp = {}; P.forEach(p => { const e = exp[p.coin] ||= { long: 0, short: 0, upnl: 0 }; e[p.side === '多' ? 'long' : 'short'] += p.notional; e.upnl += p.unrealized_pnl; });
  const html = `
  <div class="kpis">
    ${kpi('交易币种数', C.filter(c => c.fills).length, `区间 ${days.length} 天`)}
    ${kpi('第一大币种', C[0] ? esc(C[0].coin) : '—', C[0] ? `占交易量 ${pct(C[0].volume / tot, 1)}` : '')}
    ${kpi('前 3 币种占比', pct(sum(C.slice(0, 3), c => c.volume) / (tot || 1), 1), C.slice(0, 3).map(c => c.coin).join(' / '))}
    ${kpi('最赚钱币种', C.length ? esc(C.slice().sort((a, b) => b.net - a.net)[0].coin) : '—', C.length ? sp(C.slice().sort((a, b) => b.net - a.net)[0].net) : '')}
    ${kpi('最亏钱币种', C.length ? esc(C.slice().sort((a, b) => a.net - b.net)[0].coin) : '—', C.length ? sp(C.slice().sort((a, b) => a.net - b.net)[0].net) : '')}
    ${kpi('当前持仓币种', Object.keys(exp).length, `名义 ${usd(sum(P, p => p.notional))}`)}
  </div>
  ${card('每日币种交易量', '前 5 个币种 + 其他，堆叠', legend(top.map((c, i) => [SERIES()[i], c]).concat([[css('--other'), '其他']])) + chartBox('cn-stk', 'tall'))}
  ${card('币种明细', '区间成交口径；交易净盈亏 = 已实现 − 手续费 + 资金费', table('cn', [
    { k: 'coin', t: '币种', f: r => `<b>${esc(r.coin)}</b>` },
    { k: 'volume', t: '交易量', n: 1, f: r => usd(r.volume) },
    { k: 'share', t: '占比', n: 1, v: r => r.volume, f: r => `${pct(r.volume / (tot || 1), 1)}<span class="bar-in"><i style="width:${r.volume / (C[0]?.volume || 1) * 100}%"></i></span>` },
    { k: 'fills', t: '笔数', n: 1, f: r => int(r.fills) },
    { k: 'n_addrs', t: '交易地址', n: 1 }, { k: 'n_days', t: '交易天数', n: 1 },
    { k: 'realized_pnl', t: '已实现', n: 1, f: r => sp(r.realized_pnl) },
    { k: 'fees', t: '手续费', n: 1, f: r => usd(r.fees) },
    { k: 'funding', t: '资金费', n: 1, f: r => sp(r.funding) },
    { k: 'net', t: '交易净盈亏', n: 1, f: r => sp(r.net) },
    { k: 'wr', t: '平仓胜率', n: 1, v: r => r.wins / Math.max(1, r.wins + r.losses), f: r => r.wins + r.losses ? pct(r.wins / (r.wins + r.losses), 0) : '—', tip: '有平仓盈亏的成交中，盈利成交占比' },
    { k: 'mk', t: 'Maker', n: 1, v: r => r.maker_volume / Math.max(1, r.volume), f: r => pct(r.maker_volume / Math.max(1, r.volume), 0) },
    { k: 'ls', t: '开多/开空', n: 1, v: r => r.open_long / Math.max(1, r.open_long + r.open_short), f: r => r.open_long + r.open_short ? `${pct(r.open_long / (r.open_long + r.open_short), 0)} 多` : '—' },
    { k: 'pos', t: '当前持仓', n: 1, v: r => (exp[r.coin]?.long || 0) - (exp[r.coin]?.short || 0), f: r => exp[r.coin] ? `${exp[r.coin].long ? '<span class="pos">多 ' + usd(exp[r.coin].long) + '</span> ' : ''}${exp[r.coin].short ? '<span class="neg">空 ' + usd(exp[r.coin].short) + '</span>' : ''}` : '—' },
  ], C, { sort: 'volume' }))}
  ${card('币种 × 日期 交易净盈亏热力图', '每格为当日该币种 已实现 − 手续费 + 资金费', heatmap(C.slice(0, 15).map(c => c.coin), c => c, days, (c, d) => {
    const rs = S.cd.filter(r => r.coin === c && r.day === d); if (!rs.length) return null;
    const net = sum(rs, r => r.realized_pnl - r.fees + r.funding), v = sum(rs, r => r.volume);
    return { v: net, t: `${c} · ${d}\n交易净盈亏 ${usd(net, { sign: true })}\n交易量 ${usd(v)}\n地址 ${new Set(rs.filter(r => r.fills).map(r => r.addr)).size} 个` };
  }, { colFmt: shortDay }))}`;
  const after = () => {
    const by = {}; S.cd.forEach(r => { if (!set.has(r.day)) return; const g = by[r.day] ||= {}; const k = top.includes(r.coin) ? r.coin : '其他'; g[k] = (g[k] || 0) + r.volume; });
    const dd = days.filter(d => by[d]);
    const cols = SERIES();
    mk('cn-stk', 'bar', dd.map(shortDay), top.map((c, i) => barDs(c, dd.map(d => by[d][c] || 0), cols[i])).concat([barDs('其他', dd.map(d => by[d]['其他'] || 0), css('--other'))]), { stacked: true });
  };
  return [html, after];
}

function vRisk() {
  const rules = Object.fromEntries((S.D.alert_rules || []).map(r => [r.key, r.threshold]));
  const A = S.alerts, P = S.positions, sm = S.summary;
  const cnt = lv => A.filter(a => a.level === lv).length;
  const eq = sum(sm, s => s.equity_now), ntl = sum(P, p => p.notional);
  const long = sum(P.filter(p => p.side === '多'), p => p.notional), short = sum(P.filter(p => p.side === '空'), p => p.notional);
  const upnl = sum(P, p => p.unrealized_pnl);
  const liq = P.filter(p => p.liq_distance != null).sort((a, b) => a.liq_distance - b.liq_distance)[0];
  const exp = {}; P.forEach(p => { const e = exp[p.coin] ||= { coin: p.coin, long: 0, short: 0, upnl: 0, n: 0 }; e[p.side === '多' ? 'long' : 'short'] += p.notional; e.upnl += p.unrealized_pnl; e.n++; });
  const E = Object.values(exp).sort((a, b) => (b.long + b.short) - (a.long + a.short));
  const topCoin = E[0]; const topAddr = sm.slice().sort((a, b) => b.equity_now - a.equity_now).slice(0, 3);
  const levs = sm.filter(s => s.position_ntl > 0).sort((a, b) => b.leverage - a.leverage);
  const dds = sm.filter(s => s.drawdown_pct > 0).sort((a, b) => b.drawdown_pct - a.drawdown_pct);
  const html = `
  <div class="kpis">
    ${kpi('严重提醒', `<span class="${cnt('严重') ? 'neg' : ''}">${cnt('严重')}</span>`, '当日亏损 / 持仓浮亏 / 接近强平')}
    ${kpi('警告', `<span style="color:var(--warn)">${cnt('警告')}</span>`, '回撤 / 累计亏损 / 杠杆')}
    ${kpi('提示', cnt('提示'), '大额流出 / 停止交易')}
    ${kpi('持仓名义价值', usd(ntl), `组合杠杆 ${(eq ? ntl / eq : 0).toFixed(2)}x`)}
    ${kpi('净敞口', sp(long - short), `多 ${usd(long)} · 空 ${usd(short)}`)}
    ${kpi('浮动盈亏', sp(upnl), `占资金 ${spp(eq ? upnl / eq : 0)}`)}
    ${kpi('最近强平距离', liq ? `<span class="${liq.liq_distance < (rules.liq_distance_pct || 15) / 100 ? 'neg' : ''}">${pct(liq.liq_distance, 1)}</span>` : '无', liq ? `${esc(liq.label.split(' ')[0])} ${esc(liq.coin)}` : '全部持仓无强平价（低杠杆全仓）')}
    ${kpi('最大单币敞口', topCoin ? esc(topCoin.coin) : '—', topCoin ? `${usd(topCoin.long + topCoin.short)} · 占持仓 ${pct((topCoin.long + topCoin.short) / (ntl || 1), 0)}` : '')}
    ${kpi('资金集中度', pct(sum(topAddr, s => s.equity_now) / (eq || 1), 0), '前 3 大地址资金占比')}
    ${depKpi(depNow(), `账户资金 ${usd(eq)} · 持仓名义 ÷ 部署 ${(depNow() ? ntl / depNow() : 0).toFixed(2)}x`)}
  </div>
  ${card('风险提醒', `按 alert_rules 阈值生成；${S.live ? '持仓为实时数据，提醒仍为最近一次采集结果' : '最近一次采集结果'}`, table('rk-al', [
    { k: 'level', t: '级别', f: r => chip(r.level), v: r => ({ '严重': 3, '警告': 2, '提示': 1 }[r.level]) },
    { k: 'label', t: '地址', f: r => `<a href="#address/${r.addr}">${esc(r.label)}</a>` },
    { k: 'rule', t: '规则' }, { k: 'message', t: '说明', f: r => `<span style="white-space:normal">${esc(r.message)}</span>` }, { k: 'day', t: '日期' }],
    A, { sort: 'level', empty: '无提醒' }))}
  <div class="grid g2">
    ${card('币种多空敞口', '多头为正、空头为负的名义价值', legend([[css('--s3'), '多头'], [css('--s2'), '空头']]) + chartBox('rk-exp', 'tall'))}
    ${card('地址杠杆', `持仓名义 ÷ 资金；虚线为警告阈值 ${rules.leverage_max ?? 3}x`, chartBox('rk-lev', 'tall'))}
  </div>
  <div class="grid g2">
    ${card('地址当前回撤', `本期盈亏从高点回落 ÷ 当前资金；虚线为阈值 ${rules.drawdown_pct ?? 10}%`, chartBox('rk-dd', 'tall'))}
    ${card('持仓集中度', '按币种', table('rk-ex', [{ k: 'coin', t: '币种', f: r => `<b>${esc(r.coin)}</b>` },
      { k: 'long', t: '多头', n: 1, f: r => r.long ? usd(r.long) : '—' }, { k: 'short', t: '空头', n: 1, f: r => r.short ? usd(r.short) : '—' },
      { k: 'net', t: '净敞口', n: 1, v: r => r.long - r.short, f: r => sp(r.long - r.short) }, { k: 'gross', t: '占持仓', n: 1, v: r => r.long + r.short, f: r => pct((r.long + r.short) / (ntl || 1), 1) },
      { k: 'upnl', t: '浮动盈亏', n: 1, f: r => sp(r.upnl) }, { k: 'n', t: '仓位数', n: 1 }], E, { sort: 'gross' }))}
  </div>
  ${card('持仓明细', S.live ? `实时 · ${bj(S.live.at)}` : `快照 · ${S.summaryFile[0]?.snapshot_at || ''}`, posTable('rk-pos', P))}
  ${card('预警规则', '阈值在 pipeline/watchlist.json 的 alerts 中修改', table('rk-rules', [{ k: 'level', t: '级别', f: r => r.level === '—' ? '—' : chip(r.level) }, { k: 'rule', t: '规则' },
    { k: 'threshold', t: '阈值', n: 1, f: r => r.threshold + r.unit }, { k: 'description', t: '说明', f: r => `<span style="white-space:normal">${esc(r.description)}</span>` }], S.D.alert_rules || []))}`;
  const after = () => {
    mk('rk-exp', 'bar', E.map(e => e.coin), [barDs('多头', E.map(e => e.long), css('--s3')), barDs('空头', E.map(e => -e.short), css('--s2'))], { horizontal: true, stacked: true });
    mk('rk-lev', 'bar', levs.map(s => s.label.split(' ')[0]), [{ ...barDs('杠杆', levs.map(s => s.leverage)), backgroundColor: levs.map(s => s.leverage > (rules.leverage_max ?? 3) ? css('--neg') : css('--s1')) }],
      { horizontal: true, fmt: v => (+v).toFixed(1) + 'x', thresh: { value: rules.leverage_max ?? 3, label: '阈值' }, xmax: Math.max((rules.leverage_max ?? 3) * 1.2, ...levs.map(s => s.leverage)) });
    mk('rk-dd', 'bar', dds.map(s => s.label.split(' ')[0]), [{ ...barDs('回撤', dds.map(s => s.drawdown_pct)), backgroundColor: dds.map(s => s.drawdown_pct > (rules.drawdown_pct ?? 10) / 100 ? css('--neg') : css('--s1')) }],
      { horizontal: true, fmt: v => pct(v, 0), thresh: { value: (rules.drawdown_pct ?? 10) / 100, label: '阈值' } });
  };
  return [html, after];
}

function vDevops() {
  const H = S.D.health || {}, LOG = (S.D.run_log || []).slice().reverse(), meta = S.D.meta || {};
  const ageH = H.generated_at ? (Date.now() - Date.parse(H.generated_at)) / 36e5 : null;
  const fresh = ageH == null ? 'unknown' : ageH <= 26 ? 'ok' : ageH <= 50 ? 'warn' : 'crit';
  const failed = (H.checks || []).filter(c => !c.ok);
  const crit = failed.filter(c => c.level === '严重').length, warn = failed.filter(c => c.level === '警告').length;
  const overall = H.status === 'failed' || crit || fresh === 'crit' ? ['crit', '异常', 'var(--neg)'] : warn || fresh === 'warn' ? ['warn', '需关注', 'var(--warn)'] : ['ok', '健康', 'var(--pos)'];
  const next = (() => { const n = new Date(); const t = new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate(), 0, 7)); if (t <= n) t.setUTCDate(t.getUTCDate() + 1); return t; })();
  const F = H.fetch || {};
  const files = Object.entries(H.files || {}).map(([n, f]) => ({ n, ...f }));
  const days = rangeDays();
  const lv = S.live;
  const html = `
  <div class="card"><div class="status-hero" style="color:${overall[2]}"><span class="status-dot"></span>
    <div style="color:var(--text)"><div style="font-size:18px;font-weight:650">数据管道 ${overall[1]}</div>
    <div class="muted" style="font-size:13px">最近更新 ${H.generated_at ? bj(H.generated_at) + '（' + ago(H.generated_at) + '）' : '未知'} · 最后数据日 ${H.last_day || '—'} · 下次计划 ${bj(next.toISOString())}</div></div>
    <div style="margin-left:auto"><button class="btn" id="probe-btn">探测 API</button></div></div>
    <div id="probe-out" class="note"></div></div>
  <div class="kpis">
    ${kpi('数据新鲜度', ageH == null ? '—' : `<span class="${fresh === 'ok' ? 'pos' : 'neg'}">${ageH.toFixed(1)} h</span>`, '超过 26 小时视为过期')}
    ${kpi('上次运行耗时', H.duration_s != null ? H.duration_s + ' s' : '—', `抓取 ${F.seconds ?? '—'} s`)}
    ${kpi('API 调用次数', int(F.calls), `下载 ${F.bytes ? (F.bytes / 1048576).toFixed(1) + ' MB' : '—'}`)}
    ${kpi('限流 / 错误重试', `${F.retries_429 ?? 0} / ${F.retries_err ?? 0}`, `最慢请求 ${F.slowest_ms ?? '—'} ms`)}
    ${kpi('检查项', `${(H.checks || []).length - failed.length} / ${(H.checks || []).length} 通过`, failed.length ? `${crit} 严重 · ${warn} 警告 · ${failed.length - crit - warn} 提示` : '全部通过')}
    ${kpi('监控地址', (meta.addresses || S.addrs).length, `起始日 ${meta.since || '—'}`)}
    ${kpi('数据文件', files.length, `合计 ${(sum(files, f => f.bytes) / 1024).toFixed(0)} KB`)}
    ${kpi('部署接口', S.hasDep ? `<span class="pos">已接入</span>` : '<span class="muted">未接入</span>', esc(S.stratMeta.api || '未配置') + (S.hasDep ? ` · ${S.deps.length} 条部署` : ''), 'GitHub Secret：ALPHANET_API_KEY（Internal-API-Key）')}
    ${kpi('浏览器实时拉取', lv ? `${Object.keys(lv.states).length}/${S.summaryFile.length}` : '未执行', lv ? `平均 ${(sum(lv.lat) / Math.max(1, lv.lat.length)).toFixed(0)} ms · 失败 ${lv.errs.length}` : '点右上角「实时刷新」')}
  </div>
  <div class="grid g2">
    ${card('数据质量检查', '每次运行后由 pipeline/extras.py 生成', `<div class="checks">${(H.checks || []).map(c => `<div class="check"><span class="ic ${c.ok ? 'ok' : LV[c.level]}">${c.ok ? '✓' : '!'}</span><div><div>${esc(c.name)} ${c.ok ? '' : chip(c.level)}</div><div class="d">${esc(c.detail)}</div></div></div>`).join('') || '<div class="empty">无 health.json</div>'}</div>`)}
    ${card('运行记录', '最近 90 次（GitHub Actions 每日 00:07 UTC）', chartBox('dv-run', 'short') + table('dv-log', [{ k: 'at', t: '时间', f: r => bj(r.at) },
      { k: 'status', t: '状态', f: r => r.status === 'ok' ? chip('通过', '成功') : chip('严重', '失败') }, { k: 'last_day', t: '数据日' },
      { k: 'duration_s', t: '耗时', n: 1, f: r => r.duration_s + ' s' }, { k: 'calls', t: '调用', n: 1 }, { k: 'fills', t: '成交', n: 1, f: r => int(r.fills) },
      { k: 'failed_checks', t: '未通过', f: r => `<span class="muted">${esc((r.failed_checks || []).join('、') || '—')}</span>` }], LOG, { limit: 10 }))}
  </div>
  ${card('数据覆盖矩阵', '地址 × 日期：深色 = 当日有成交，浅色 = 有记录无成交，空白 = 无记录', heatmap(S.addrs.map(a => a.addr), a => S.label[a], days, (a, d) => {
    const r = (S.adBy[a] || []).find(x => x.day === d); return r ? { v: r.fills > 0 ? 1 : 0.15, t: `${S.label[a]} · ${d}\n成交 ${r.fills} 笔\n资金 ${usd(r.equity)}` } : null;
  }, { colFmt: shortDay, max: 1, mono: 1 }))}
  <div class="grid g2">
    ${card('各地址抓取统计', '上次运行', table('dv-fa', [{ k: 'label', t: '地址' }, { k: 'from', t: '增量起点' }, { k: 'fills', t: '成交', n: 1, f: r => int(r.fills) }, { k: 'funding', t: '资金费记录', n: 1, f: r => int(r.funding) }], H.fetch_addresses || [], { scroll: 1 }))}
    ${card('数据文件', 'data/ 目录', table('dv-files', [{ k: 'n', t: '文件', f: r => `<a href="data/${r.n}" target="_blank">${esc(r.n)}</a>` }, { k: 'rows', t: '行数', n: 1, f: r => r.rows == null ? '—' : int(r.rows) }, { k: 'bytes', t: '大小', n: 1, f: r => (r.bytes / 1024).toFixed(1) + ' KB' }], files))}
  </div>
  ${(H.volume_gaps || []).length ? card('成交额口径偏差', '成交明细汇总 vs Hyperliquid portfolio allTime vlm（官方含监控起始日之前的历史）', table('dv-gap', [{ k: 'label', t: '地址' }, { k: 'official', t: '官方 allTime', n: 1, f: r => usd(r.official) }, { k: 'computed', t: '本看板（起始日以来）', n: 1, f: r => usd(r.computed) }, { k: 'gap_pct', t: '偏差', n: 1, f: r => spp(r.gap_pct, 1) }], H.volume_gaps)) : ''}
  ${(() => { const un = {}; S.depsAll.filter(d => !S.label[d.addr] && depActive(d, S.today)).forEach(d => { const x = un[d.addr] ||= { addr: d.addr, coins: new Set(), usdc: 0 }; x.coins.add(d.coin); x.usdc += d.usdc; });
    const L = Object.values(un).map(x => ({ ...x, coins: [...x.coins].join(' / ') }));
    return L.length ? card(`未纳入监控的部署钱包（${L.length}）`, '内部接口里有正在运行的部署、但不在 pipeline/watchlist.json 里的钱包；需要的话加入名单，下次运行会自动补齐历史', table('dv-un', [{ k: 'addr', t: '钱包', f: r => `<span class="addr">${esc(r.addr)}</span>` }, { k: 'coins', t: '币种' }, { k: 'usdc', t: '部署金额', n: 1, f: r => usd(r.usdc) }], L, { sort: 'usdc', scroll: 1 })) : ''; })()}
  ${lv && lv.errs.length ? card('实时拉取错误', '', `<div class="checks">${lv.errs.map(e => `<div class="check"><span class="ic crit">!</span>${esc(e)}</div>`).join('')}</div>`) : ''}`;
  const after = () => {
    const L = LOG.slice().reverse();
    mk('dv-run', 'bar', L.map(r => r.at.slice(5, 10)), [{ ...barDs('耗时', L.map(r => r.duration_s)), backgroundColor: L.map(r => r.status === 'ok' ? css('--s1') : css('--neg')) }], { fmt: v => v + 's' });
    $('#probe-btn').onclick = probe;
  };
  return [html, after];
}

/* ---------- strategy ---------- */
const FAM_ORDER = () => (S.stratMeta.families || []).map(f => f.name).concat(['未分类']);
const famColor = f => { const i = FAM_ORDER().indexOf(f); return i >= 0 && i < 8 ? SERIES()[i] : css('--other'); };
function famRule(coin) {
  for (const f of S.stratMeta.families || []) if (f.coins === '*' || (f.coins || []).includes(coin)) return { family: f.name, strategy: `${f.prefix || f.name} ${coin}` };
  return { family: '未分类', strategy: coin };
}
const stratOf = (addr, coin) => S.strat[addr + '|' + coin] || { ...famRule(coin), get name() { return this.strategy; }, source: '规则', key: addr + '|' + coin, coin };
const famChip = f => `<span class="chip" style="background:color-mix(in srgb, ${famColor(f)} 18%, transparent);color:var(--text)"><i style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${famColor(f)}"></i>${esc(f)}</span>`;

function maxDD(series) { let c = 0, pk = 0, dd = 0; for (const v of series) { c += v; pk = Math.max(pk, c); dd = Math.max(dd, pk - c); } return dd; }
function newAgg(o) { return { ...o, deps: new Set(), addrs: new Set(), active: new Set(), volume: 0, fills: 0, realized: 0, fees: 0, funding: 0, wins: 0, losses: 0, open_long: 0, open_short: 0, daily: {}, dvol: {}, dact: {} }; }
function addRow(g, r) {
  const net = r.realized_pnl - r.fees + (r.funding || 0);
  g.deps.add(r.addr + '|' + r.coin); g.addrs.add(r.addr);
  g.volume += r.volume; g.fills += r.fills; g.realized += r.realized_pnl; g.fees += r.fees; g.funding += r.funding || 0;
  g.wins += r.wins || 0; g.losses += r.losses || 0; g.open_long += r.open_long || 0; g.open_short += r.open_short || 0;
  g.daily[r.day] = (g.daily[r.day] || 0) + net; g.dvol[r.day] = (g.dvol[r.day] || 0) + r.volume;
  if (r.fills > 0) { g.active.add(r.addr); (g.dact[r.day] ||= new Set()).add(r.addr + '|' + r.coin); }
}
function finish(g, days, posFilter) {
  g.net = g.realized - g.fees + g.funding;
  const dv = days.map(d => g.daily[d] || 0), traded = days.filter(d => g.daily[d] != null).map(d => g.daily[d]);
  const wd = traded.filter(v => v > 0), ld = traded.filter(v => v < 0);
  g.winDays = wd.length; g.lossDays = ld.length;
  g.worstDay = traded.length ? Math.min(...traded) : 0; g.bestDay = traded.length ? Math.max(...traded) : 0;
  g.pf = ld.length && wd.length ? (sum(wd) / wd.length) / Math.abs(sum(ld) / ld.length) : null;
  g.mdd = maxDD(dv);
  const mean = traded.length ? sum(traded) / traded.length : 0, sd = traded.length > 1 ? Math.sqrt(sum(traded, v => (v - mean) ** 2) / (traded.length - 1)) : 0;
  g.sharpe = sd ? mean / sd * Math.sqrt(365) : null;
  g.bps = g.volume ? g.net / g.volume * 1e4 : 0;
  g.wr = g.wins + g.losses ? g.wins / (g.wins + g.losses) : null;
  g.longPct = g.open_long + g.open_short ? g.open_long / (g.open_long + g.open_short) : null;
  const P = S.positions.filter(posFilter);
  g.long = sum(P.filter(p => p.side === '多'), p => p.notional); g.short = sum(P.filter(p => p.side === '空'), p => p.notional); g.upnl = sum(P, p => p.unrealized_pnl); g.npos = P.length;
  return g;
}

function stratModel(days) {
  const set = new Set(days), fam = {}, st = {}, tot = newAgg({ id: '总策略' });
  for (const f of FAM_ORDER()) fam[f] = newAgg({ id: f, family: f });
  for (const c of S.stratMeta.combos || []) {
    const s = st[c.strategy] ||= newAgg({ id: c.strategy, family: c.family, coin: c.coin, source: c.source, usdc: 0, hasUsdc: false });
    s.deps.add(c.key); s.addrs.add(c.addr); fam[c.family]?.deps.add(c.key); fam[c.family]?.addrs.add(c.addr); tot.deps.add(c.key); tot.addrs.add(c.addr);
    if (c.usdc != null) { s.usdc += +c.usdc; s.hasUsdc = true; }
  }
  for (const r of S.cd) {
    if (!set.has(r.day)) continue;
    const c = stratOf(r.addr, r.coin);
    const s = st[c.strategy] ||= newAgg({ id: c.strategy, family: c.family, coin: r.coin, source: c.source, usdc: 0, hasUsdc: false });
    addRow(s, r); addRow(fam[c.family] ||= newAgg({ id: c.family, family: c.family }), r); addRow(tot, r);
  }
  const dep = (g, f) => { g.depNow = depNow(f); g.depAvg = depAvg(days, f); g.roi = g.depAvg > 0 ? g.net / g.depAvg : null; };
  Object.values(st).forEach(g => { finish(g, days, p => stratOf(p.addr, p.coin).strategy === g.id); dep(g, d => d.strategy === g.id); });
  Object.values(fam).forEach(g => { finish(g, days, p => stratOf(p.addr, p.coin).family === g.id); dep(g, d => d.family === g.id); });
  finish(tot, days, () => true); dep(tot, () => true);
  return { fam, st, tot };
}

const SMALL_VOL = 10000;
function mergeSmall(list, days, fam) {
  const g = newAgg({ id: `其他 ${list.length} 个小币种`, family: fam, _small: 1, coins: list.map(s => s.coin).join('、') });
  for (const s of list) {
    s.deps.forEach(x => g.deps.add(x)); s.addrs.forEach(x => g.addrs.add(x)); s.active.forEach(x => g.active.add(x));
    for (const k of ['volume', 'fills', 'realized', 'fees', 'funding', 'wins', 'losses', 'open_long', 'open_short']) g[k] += s[k];
    for (const d in s.daily) { g.daily[d] = (g.daily[d] || 0) + s.daily[d]; g.dvol[d] = (g.dvol[d] || 0) + (s.dvol[d] || 0); }
  }
  finish(g, days, () => false);
  const ids = new Set(list.map(x => x.id)); g.depNow = depNow(d => ids.has(d.strategy)); g.depAvg = depAvg(days, d => ids.has(d.strategy)); g.roi = g.depAvg > 0 ? g.net / g.depAvg : null;
  return g;
}
function stratCols(totVol, opt = {}) {
  return [
    { k: 'id', t: opt.first || '策略', nosort: 1, f: r => r._fam ? `<b>${famChip(r.id)}</b>` : r._tot ? '<b>总策略</b>' : r._small ? `<span style="padding-left:14px" class="muted" title="${esc(r.coins)}">${esc(r.id)}</span>` : `<span style="padding-left:14px">${opt.link === false ? esc(r.id) : `<a href="#strategy/${encodeURIComponent(r.id)}">${esc(r.id)}</a>`}</span>` },
    { k: 'deps', t: '部署', n: 1, nosort: 1, f: r => r.deps.size, tip: '地址 × 币种 部署组合数' },
    { k: 'act', t: '活跃地址', n: 1, nosort: 1, f: r => r.active.size },
    { k: 'dep', t: '部署金额', n: 1, nosort: 1, f: r => depCell(r.depNow), tip: '内部部署接口：当前生效的部署 USDC' },
    { k: 'volume', t: '交易量', n: 1, nosort: 1, f: r => usd(r.volume) },
    { k: 'share', t: '量占比', n: 1, nosort: 1, f: r => pct(totVol ? r.volume / totVol : 0, 1) },
    { k: 'realized', t: '已实现', n: 1, nosort: 1, f: r => sp(r.realized) },
    { k: 'fees', t: '手续费', n: 1, nosort: 1, f: r => usd(r.fees) },
    { k: 'funding', t: '资金费', n: 1, nosort: 1, f: r => sp(r.funding) },
    { k: 'net', t: '交易净盈亏', n: 1, nosort: 1, f: r => `<b>${sp(r.net)}</b>` },
    { k: 'bps', t: 'bps', n: 1, nosort: 1, f: r => `<span class="${cls(r.bps)}">${r.bps.toFixed(1)}</span>`, tip: '交易净盈亏 ÷ 交易量 × 10000' },
    ...(opt.roi ? [{ k: 'roi', t: '收益率', n: 1, nosort: 1, f: r => r.roi == null ? '<span class="muted">—</span>' : spp(r.roi), tip: '交易净盈亏 ÷ 区间平均部署金额' }] : []),
    { k: 'wr', t: '平仓胜率', n: 1, nosort: 1, f: r => r.wr == null ? '—' : pct(r.wr, 0) },
    { k: 'wd', t: '盈/亏天', n: 1, nosort: 1, f: r => `<span class="pos">${r.winDays}</span>/<span class="neg">${r.lossDays}</span>` },
    { k: 'pf', t: '盈亏比', n: 1, nosort: 1, f: r => r.pf == null ? '—' : r.pf.toFixed(2), tip: '平均盈利日 ÷ 平均亏损日' },
    { k: 'worst', t: '最大日亏', n: 1, nosort: 1, f: r => sp(r.worstDay) },
    { k: 'mdd', t: '最大回撤', n: 1, nosort: 1, f: r => r.mdd ? `<span class="neg">-${usd(r.mdd)}</span>` : '—', tip: '区间累计交易净盈亏从高点的最大回落' },
    { k: 'sharpe', t: '夏普', n: 1, nosort: 1, f: r => r.sharpe == null ? '—' : r.sharpe.toFixed(2), tip: '日交易净盈亏 均值 ÷ 标准差 × √365（以金额计，仅作相对比较）' },
    { k: 'lp', t: '开多占比', n: 1, nosort: 1, f: r => r.longPct == null ? '—' : pct(r.longPct, 0) },
    { k: 'pos', t: '当前持仓', n: 1, nosort: 1, f: r => (r.long ? `<span class="pos">多 ${usd(r.long)}</span> ` : '') + (r.short ? `<span class="neg">空 ${usd(r.short)}</span>` : '') || '—' },
    { k: 'upnl', t: '浮动盈亏', n: 1, nosort: 1, f: r => r.npos ? sp(r.upnl) : '—' },
  ];
}

function vStrategy(param) {
  const days = rangeDays();
  const M = stratModel(days);
  const fams = FAM_ORDER().filter(f => M.fam[f] && (M.fam[f].volume > 0 || M.fam[f].deps.size));
  const T = M.tot, totVol = T.volume;
  const ff = S.famF && fams.includes(S.famF) ? S.famF : '全部';
  if (param) { const id = decodeURIComponent(param); if (M.st[id]) S.strSel = id; }
  const strats = Object.values(M.st).filter(s => s.volume > 0 || s.npos);
  const isSmall = s => s.volume < SMALL_VOL && !s.npos;
  if (!S.strSel || !M.st[S.strSel]) S.strSel = strats.slice().sort((a, b) => b.volume - a.volume)[0]?.id;
  // table rows: family subtotal then strategies
  const rows = [];
  for (const f of fams) {
    if (ff !== '全部' && f !== ff) continue;
    rows.push({ ...M.fam[f], _fam: 1 });
    const fs = strats.filter(s => s.family === f).sort((a, b) => b.volume - a.volume);
    const small = fs.filter(isSmall);
    fs.filter(s => !isSmall(s)).forEach(s => rows.push(s));
    if (small.length === 1) rows.push(small[0]);
    else if (small.length) rows.push(mergeSmall(small, days, f));
  }
  if (ff === '全部') rows.push({ ...T, _tot: 1 });
  const lastDay = days[days.length - 1];
  const famCard = f => {
    const g = M.fam[f], n = strats.filter(s => s.family === f);
    const best = n.slice().sort((a, b) => b.net - a.net)[0], worst = n.slice().sort((a, b) => a.net - b.net)[0];
    return `<div class="card" style="border-top:3px solid ${famColor(f)}">
      <div class="card-h"><div><h3>${esc(f)}</h3><div class="hint">${n.map(s => esc(s.coin)).join(' · ')}</div></div><a href="#strategy" data-fam="${esc(f)}" class="btn">只看此类</a></div>
      <div class="kpi-v ${cls(g.net)}">${usd(g.net, { sign: true })}</div>
      <div class="kpi-s">交易净盈亏 · ${g.bps.toFixed(1)} bps · 占总量 ${pct(totVol ? g.volume / totVol : 0, 1)}</div>
      <dl class="kv" style="margin-top:12px">
        <dt>部署金额</dt><dd>${depCell(g.depNow)}${S.hasDep && g.roi != null ? ` · 收益率 ${spp(g.roi)}` : ''}</dd>
        <dt>交易量</dt><dd>${usd(g.volume)}（${int(g.fills)} 笔）</dd>
        <dt>已实现 / 手续费 / 资金费</dt><dd>${sp(g.realized)} / ${usd(g.fees)} / ${sp(g.funding)}</dd>
        <dt>部署 / 活跃地址</dt><dd>${g.deps.size} / ${g.active.size}</dd>
        <dt>盈 / 亏天 · 胜率</dt><dd><span class="pos">${g.winDays}</span> / <span class="neg">${g.lossDays}</span> · ${g.wr == null ? '—' : pct(g.wr, 0)}</dd>
        <dt>最大回撤</dt><dd>${g.mdd ? '-' + usd(g.mdd) : '—'}</dd>
        <dt>当前持仓</dt><dd>${g.long ? `<span class="pos">多 ${usd(g.long)}</span> ` : ''}${g.short ? `<span class="neg">空 ${usd(g.short)}</span>` : ''}${!g.long && !g.short ? '无' : ` · 浮盈 ${sp(g.upnl)}`}</dd>
        <dt>最好 / 最差</dt><dd>${best ? `<a href="#strategy/${encodeURIComponent(best.id)}">${esc(best.coin)}</a> ${sp(best.net)}` : '—'} / ${worst ? `<a href="#strategy/${encodeURIComponent(worst.id)}">${esc(worst.coin)}</a> ${sp(worst.net)}` : '—'}</dd>
      </dl></div>`;
  };
  // weekly × family
  const wk = {}; days.forEach(d => { const w = isoWeek(d); (wk[w.key] ||= { key: w.key, start: w.start, end: w.end, days: [] }).days.push(d); });
  const wkRows = Object.values(wk).reverse().map(w => { const r = { ...w }; fams.forEach(f => { r['n_' + f] = sum(w.days, d => M.fam[f].daily[d] || 0); r['v_' + f] = sum(w.days, d => M.fam[f].dvol[d] || 0); }); r.n = sum(fams, f => r['n_' + f]); r.v = sum(fams, f => r['v_' + f]); return r; });
  // address × family
  const set = new Set(days), af = {};
  S.cd.forEach(r => { if (!set.has(r.day)) return; const f = stratOf(r.addr, r.coin).family; const x = af[r.addr] ||= { addr: r.addr, label: S.label[r.addr], n: 0, v: 0 }; const net = r.realized_pnl - r.fees + (r.funding || 0); x['n_' + f] = (x['n_' + f] || 0) + net; x['v_' + f] = (x['v_' + f] || 0) + r.volume; x.n += net; x.v += r.volume; });
  const afRows = Object.values(af);
  const visStrats = strats.filter(s => (ff === '全部' || s.family === ff) && !isSmall(s)).sort((a, b) => FAM_ORDER().indexOf(a.family) - FAM_ORDER().indexOf(b.family) || b.volume - a.volume);

  const html = `
  <div class="toolbar"><div class="seg" id="fam-seg">${['全部'].concat(fams).map(f => `<button data-f="${esc(f)}" class="${f === ff ? 'on' : ''}">${esc(f)}</button>`).join('')}</div>
    <span class="muted" style="font-size:12px">分类按币种：${(S.stratMeta.families || []).map(f => `${esc(f.name)} = ${f.coins === '*' ? '其余币种' : f.coins.join('/')}`).join('；')}</span></div>
  <div class="sec-t">总策略</div>
  <div class="kpis">
    ${kpi('总交易净盈亏', sp(T.net), `${T.bps.toFixed(1)} bps · 已实现 − 手续费 + 资金费`)}
    ${kpi('已实现盈亏', sp(T.realized), `手续费 ${usd(T.fees)} · 资金费 ${sp(T.funding)}`)}
    ${depKpi(T.depNow, `区间平均 ${usd(T.depAvg)}${T.roi != null ? ' · 收益率 ' + pct(T.roi, 2, true) : ''}`)}
    ${kpi('交易量', usd(T.volume), `${int(T.fills)} 笔 · 日均 ${usd(T.volume / Math.max(1, days.length))}`)}
    ${kpi('策略 / 部署', `${strats.length} / ${T.deps.size}`, `${fams.length} 个大类 · ${T.addrs.size} 个地址`)}
    ${kpi('昨日活跃部署', T.dact[lastDay]?.size || 0, lastDay ? lastDay.slice(5) : '')}
    ${kpi('盈 / 亏天', `<span class="pos">${T.winDays}</span> / <span class="neg">${T.lossDays}</span>`, `盈亏比 ${T.pf == null ? '—' : T.pf.toFixed(2)} · 最大日亏 ${usd(T.worstDay)}`)}
    ${kpi('最大回撤', T.mdd ? `<span class="neg">-${usd(T.mdd)}</span>` : '—', '区间累计交易净盈亏')}
    ${kpi('当前持仓', usd(T.long + T.short), `净 ${sp(T.long - T.short)} · 浮盈 ${sp(T.upnl)}`)}
  </div>
  <div class="grid g3">${fams.map(famCard).join('')}</div>
  <div class="grid g2">
    ${card('累计交易净盈亏 · 大类', '虚线为总策略', legend(fams.map(f => [famColor(f), f]).concat([[css('--text-2'), '总策略']])) + chartBox('sf-cum', 'tall'))}
    ${card('每日交易净盈亏 · 大类', '按大类堆叠', legend(fams.map(f => [famColor(f), f])) + chartBox('sf-day', 'tall'))}
  </div>
  <div class="grid g2">
    ${card('每日交易量 · 大类', '按大类堆叠', legend(fams.map(f => [famColor(f), f])) + chartBox('sf-vol'))}
    ${card('盈亏构成 · 大类', '已实现、手续费（负）、资金费', legend([[css('--s1'), '已实现'], [css('--s2'), '手续费'], [css('--s3'), '资金费']]) + chartBox('sf-attr'))}
  </div>
  ${card('策略明细', `大类小计 → 各策略（大类 + 币种）。交易净盈亏为成交口径，不含持仓浮盈；区间交易量不足 ${usd(SMALL_VOL)} 且无持仓的币种合并为「其他小币种」；点击策略名看详情`, table('sf-tbl', stratCols(totVol, { roi: S.hasDep }), rows))}
  <div class="grid g2">
    ${card('策略净盈亏排行', '区间交易净盈亏', chartBox('sf-rank', 'tall'))}
    ${card('策略交易效率', '净盈亏 / 交易量（bps），越高越好', chartBox('sf-bps', 'tall'))}
  </div>
  ${card('策略 × 日期 交易净盈亏', '按大类排列；颜色越深金额越大', heatmap(visStrats.map(s => s.id), id => id, days, (id, d) => {
    const s = M.st[id], v = s.daily[d]; return v == null ? null : { v, t: `${id} · ${d}\n交易净盈亏 ${usd(v, { sign: true })}\n交易量 ${usd(s.dvol[d] || 0)}\n下单部署 ${s.dact[d]?.size || 0} 个` };
  }, { colFmt: shortDay }))}
  ${platformCard(fams)}
  <div id="st-detail"></div>
  <div class="grid g2">
    ${card('周度 × 大类', 'ISO 周；交易净盈亏', table('sf-wk', [{ k: 'key', t: '周', nosort: 1, f: r => `<b>${r.key}</b> <span class="muted">${r.start.slice(5)}~${r.end.slice(5)}</span>` }]
      .concat(fams.map(f => ({ k: 'n_' + f, t: esc(f), n: 1, nosort: 1, f: r => sp(r['n_' + f]) })))
      .concat([{ k: 'n', t: '合计', n: 1, nosort: 1, f: r => `<b>${sp(r.n)}</b>` }, { k: 'v', t: '交易量', n: 1, nosort: 1, f: r => usd(r.v) }]), wkRows))}
    ${card('地址 × 大类', '每个地址在各大类上的交易净盈亏（可排序）', table('sf-af', [{ k: 'label', t: '地址', f: r => `<a href="#address/${r.addr}">${esc(r.label)}</a>` }]
      .concat(fams.map(f => ({ k: 'n_' + f, t: esc(f), n: 1, f: r => r['v_' + f] ? sp(r['n_' + f] || 0) : '<span class="muted">—</span>', v: r => r['n_' + f] ?? -1e15 })))
      .concat([{ k: 'n', t: '合计', n: 1, f: r => `<b>${sp(r.n)}</b>` }, { k: 'dep', t: '部署金额', n: 1, v: r => depNow(byAddr(r.addr)), f: r => depCell(depNow(byAddr(r.addr))) }, { k: 'v', t: '交易量', n: 1, f: r => usd(r.v) }]), afRows, { sort: 'v', scroll: 1 }))}
  </div>`;
  const after = () => {
    const L = days.map(shortDay);
    mk('sf-cum', 'line', L, fams.map(f => { let c = 0; return lineDs(f, days.map(d => (c += M.fam[f].daily[d] || 0)), famColor(f)); })
      .concat([{ ...(() => { let c = 0; return lineDs('总策略', days.map(d => (c += T.daily[d] || 0)), css('--text-2')); })(), borderDash: [5, 4] }]), { zero: false });
    mk('sf-day', 'bar', L, fams.map(f => barDs(f, days.map(d => M.fam[f].daily[d] || 0), famColor(f))), { stacked: true });
    mk('sf-vol', 'bar', L, fams.map(f => barDs(f, days.map(d => M.fam[f].dvol[d] || 0), famColor(f))), { stacked: true });
    mk('sf-attr', 'bar', fams, [barDs('已实现', fams.map(f => M.fam[f].realized), css('--s1')), barDs('手续费', fams.map(f => -M.fam[f].fees), css('--s2')), barDs('资金费', fams.map(f => M.fam[f].funding), css('--s3'))]);
    const rk = visStrats.filter(s => s.volume > 0).sort((a, b) => b.net - a.net);
    mk('sf-rank', 'bar', rk.map(s => s.id), [{ ...barDs('交易净盈亏', rk.map(s => s.net)), backgroundColor: rk.map(s => famColor(s.family)) }], { horizontal: true, tipCb: { afterLabel: c => ' ' + rk[c.dataIndex].family } });
    const bk = visStrats.filter(s => s.volume > 1000).sort((a, b) => b.bps - a.bps);
    mk('sf-bps', 'bar', bk.map(s => s.id), [{ ...barDs('bps', bk.map(s => s.bps)), backgroundColor: bk.map(s => famColor(s.family)) }], { horizontal: true, fmt: v => (+v).toFixed(0), tipFmt: v => v.toFixed(1) + ' bps' });
    document.querySelectorAll('#fam-seg button').forEach(b => b.onclick = () => { S.famF = b.dataset.f; render(true); });
    document.querySelectorAll('[data-fam]').forEach(a => a.onclick = e => { e.preventDefault(); S.famF = a.dataset.fam; render(true); });
    stratDetail(days, M);
  };
  return [html, after];
}

function platformCard(fams) {
  if (!S.depsAll.length && !S.catalog.length) return '';
  const all = S.depsAll.filter(d => depActive(d, S.today)), mine = all.filter(d => S.label[d.addr]);
  const rowsF = fams.map(f => ({ f, all: sum(all.filter(d => d.family === f), d => d.usdc), mine: sum(mine.filter(d => d.family === f), d => d.usdc),
    wal: new Set(all.filter(d => d.family === f).map(d => d.addr)).size, cat: sum(S.catalog.filter(c => c.family === f), c => c.usdc || 0) }));
  const tot = { f: '合计', all: sum(rowsF, r => r.all), mine: sum(rowsF, r => r.mine), wal: new Set(all.map(d => d.addr)).size, cat: sum(rowsF, r => r.cat), _tot: 1 };
  const body = table('pf-fam', [{ k: 'f', t: '大类', nosort: 1, f: r => r._tot ? '<b>合计</b>' : famChip(r.f) },
    ...(S.depsAll.length ? [{ k: 'all', t: '全平台部署', n: 1, nosort: 1, f: r => usd(r.all) }, { k: 'wal', t: '钱包数', n: 1, nosort: 1 },
      { k: 'mine', t: '监控地址部署', n: 1, nosort: 1, f: r => usd(r.mine) }, { k: 'cov', t: '监控覆盖', n: 1, nosort: 1, f: r => pct(r.all ? r.mine / r.all : 0, 0) }] : []),
    ...(S.catalog.length ? [{ k: 'cat', t: '策略目录部署', n: 1, nosort: 1, f: r => usd(r.cat), tip: '/internal/v1/strategies 返回的策略级部署金额' }] : [])], rowsF.concat([tot]));
  const cat = S.catalog.length ? table('pf-cat', [{ k: 'api_strategy', t: '接口策略名', f: r => esc(r.api_strategy || '—') }, { k: 'family', t: '大类', f: r => famChip(r.family) },
    { k: 'strategy', t: '看板策略', f: r => `<a href="#strategy/${encodeURIComponent(r.strategy)}">${esc(r.strategy)}</a>` },
    { k: 'usdc', t: '部署金额', n: 1, f: r => r.usdc == null ? '—' : usd(r.usdc) }, { k: 'count', t: '部署数', n: 1, f: r => r.count == null ? '—' : int(r.count) }, { k: 'status', t: '状态', f: r => esc(r.status || '') }],
    S.catalog, { sort: 'usdc', flush: 1 }) : '';
  return card('全平台部署（内部接口）', '内部接口 /internal/v1/deployments 与 /internal/v1/strategies 的当前部署金额，含不在监控名单里的钱包', `<div style="margin-bottom:${cat ? 28 : 0}px">${body}</div>` + (cat ? '<div class="hint" style="margin-top:4px">策略目录（/internal/v1/strategies）</div>' + cat : ''));
}

function stratDetail(days, M) {
  const g = M.st[S.strSel], box = $('#st-detail');
  if (!g || !box) return;
  const set = new Set(days);
  const keys = new Set([...g.deps]);
  const mem = [...keys].map(k => {
    const [addr, coin] = k.split('|'), c = S.strat[k] || {};
    const rs = S.cd.filter(r => r.addr === addr && r.coin === coin && set.has(r.day));
    const P = S.positions.filter(p => p.addr === addr && p.coin === coin);
    const net = sum(rs, r => r.realized_pnl - r.fees + (r.funding || 0)), vol = sum(rs, r => r.volume), w = sum(rs, r => r.wins), l = sum(rs, r => r.losses);
    const daily = {}; rs.forEach(r => daily[r.day] = (daily[r.day] || 0) + r.realized_pnl - r.fees + (r.funding || 0));
    return { key: k, addr, label: S.label[addr], first: c.first, last: c.last, days: rs.filter(r => r.fills).length, volume: vol, fills: sum(rs, r => r.fills), fees: sum(rs, r => r.fees),
      net, bps: vol ? net / vol * 1e4 : 0, wr: w + l ? w / (w + l) : null, usdc: depNow(d => d.addr === addr && d.coin === coin), usdcAvg: depAvg(days, d => d.addr === addr && d.coin === coin), sg: c.signal_group || '', daily,
      pos: P.map(p => `${p.side} ${usd(p.notional)}`).join(' / '), upnl: sum(P, p => p.unrealized_pnl), hasPos: P.length > 0 };
  }).filter(m => m.volume > 0 || m.hasPos).sort((a, b) => b.volume - a.volume);
  const bpsList = mem.filter(m => m.volume > 1000).map(m => m.bps);
  const spread = bpsList.length > 1 ? Math.max(...bpsList) - Math.min(...bpsList) : 0;
  const top = mem.slice(0, 8);
  const sgs = [...new Set(mem.map(m => m.sg).filter(x => x && !x.includes('独立')))];
  box.innerHTML = `
  <div class="sec-t">策略详情 · ${esc(g.id)} ${famChip(g.family)} <span class="chip mute">${esc(g.source)}</span></div>
  <div class="kpis">
    ${kpi('交易净盈亏', sp(g.net), `${g.bps.toFixed(1)} bps${g.roi != null ? ' · 收益率 ' + pct(g.roi, 2, true) : ''}`)}
    ${depKpi(g.depNow, `区间平均 ${usd(g.depAvg)}`)}
    ${kpi('交易量', usd(g.volume), `${int(g.fills)} 笔 · 占总量 ${pct(M.tot.volume ? g.volume / M.tot.volume : 0, 1)}`)}
    ${kpi('已实现 / 手续费', sp(g.realized), `手续费 ${usd(g.fees)} · 资金费 ${sp(g.funding)}`)}
    ${kpi('部署 / 活跃地址', `${g.deps.size} / ${g.active.size}`, '')}
    ${kpi('胜率 / 盈亏比', `${g.wr == null ? '—' : pct(g.wr, 0)} / ${g.pf == null ? '—' : g.pf.toFixed(2)}`, `盈 ${g.winDays} 天 · 亏 ${g.lossDays} 天`)}
    ${kpi('最大回撤', g.mdd ? `<span class="neg">-${usd(g.mdd)}</span>` : '—', `最大日亏 ${sp(g.worstDay)} · 最大日盈 ${sp(g.bestDay)}`)}
    ${kpi('部署间差异', `${spread.toFixed(1)} bps`, '各部署 净盈亏/交易量 的最大差', '同一策略在不同地址上的结果差异；越大说明仓位、时点或滑点越不一致')}
    ${kpi('当前持仓', (g.long ? usd(g.long) + ' 多 ' : '') + (g.short ? usd(g.short) + ' 空' : '') || '无', g.npos ? `浮盈 ${sp(g.upnl)}` : '')}
  </div>
  ${sgs.length > 1 ? `<div class="bn info"><b>ⓘ 同一策略下有 ${sgs.length} 组不同的下单节奏</b><span>${sgs.map(s => `${esc(s)}：${mem.filter(m => m.sg === s).map(m => esc(m.label.split(' ')[0])).join(' ')}`).join('；')}。可能是同一策略的不同参数或不同批次部署，可在下方部署明细的「信号组」列对比表现。</span></div>` : ''}
  <div class="grid g2">
    ${card('每日交易净盈亏', '', chartBox('sd-pnl', 'short'))}
    ${card('各部署累计净盈亏', `交易量前 ${top.length} 个部署`, legend(top.map((m, i) => [SERIES()[i], m.label.split(' ')[0]])) + chartBox('sd-cum', 'short'))}
  </div>
  ${card('部署明细', '该策略在每个地址上的表现', table('sd-mem', [
    { k: 'label', t: '地址', f: r => `<a href="#address/${r.addr}">${esc(r.label)}</a>` },
    { k: 'first', t: '首次' }, { k: 'last', t: '最后成交' }, { k: 'days', t: '交易天数', n: 1 },
    { k: 'volume', t: '交易量', n: 1, f: r => usd(r.volume) }, { k: 'fills', t: '笔数', n: 1, f: r => int(r.fills) }, { k: 'fees', t: '手续费', n: 1, f: r => usd(r.fees) },
    { k: 'net', t: '交易净盈亏', n: 1, f: r => sp(r.net) }, { k: 'bps', t: 'bps', n: 1, f: r => `<span class="${cls(r.bps)}">${r.bps.toFixed(1)}</span>` },
    { k: 'wr', t: '平仓胜率', n: 1, f: r => r.wr == null ? '—' : pct(r.wr, 0) },
    { k: 'usdc', t: '部署金额', n: 1, f: r => depCell(r.usdc) },
    { k: 'roi', t: '收益率', n: 1, f: r => r.usdcAvg > 0 ? spp(r.net / r.usdcAvg) : '—', tip: '交易净盈亏 ÷ 区间平均部署金额' },
    { k: 'sg', t: '信号组', f: r => r.sg && !r.sg.includes('独立') ? esc(r.sg) : '<span class="muted">—</span>', tip: '最近 21 天与其它地址同步下单的分组' },
    { k: 'pos', t: '持仓', f: r => r.pos || '<span class="muted">无</span>' }, { k: 'upnl', t: '浮动盈亏', n: 1, f: r => r.hasPos ? sp(r.upnl) : '—' }], mem, { sort: 'volume' }))}
  ${card('部署 × 日期 交易净盈亏', '', heatmap(mem.map(m => m.key), k => S.label[k.split('|')[0]], days, (k, d) => {
    const m = mem.find(x => x.key === k); const v = m.daily[d];
    return v == null ? null : { v, t: `${m.label} · ${d}\n交易净盈亏 ${usd(v, { sign: true })}` };
  }, { colFmt: shortDay }))}`;
  const pd = days.map(d => g.daily[d] || 0);
  mk('sd-pnl', 'bar', days.map(shortDay), [{ ...barDs('交易净盈亏', pd), backgroundColor: pnColors(pd) }]);
  mk('sd-cum', 'line', days.map(shortDay), top.map((m, i) => { let c = 0; return lineDs(m.label.split(' ')[0], days.map(d => (c += m.daily[d] || 0)), SERIES()[i]); }), { zero: false });
  bindSort(box);
}

async function probe() {
  const out = $('#probe-out'); out.textContent = '探测中…';
  const tests = [['meta', { type: 'meta' }], ['allMids', { type: 'allMids' }], ['clearinghouseState', { type: 'clearinghouseState', user: S.addrs[0]?.addr }]];
  const res = [];
  for (const [n, body] of tests) {
    const t0 = performance.now();
    try { const r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); await r.text(); res.push(`${n}：HTTP ${r.status} · ${(performance.now() - t0).toFixed(0)} ms`); }
    catch (e) { res.push(`${n}：失败 ${e.message}`); }
  }
  out.innerHTML = 'api.hyperliquid.xyz → ' + res.map(esc).join(' ｜ ');
}

/* ---------- shell ---------- */
function bindSort(root = document) {
  root.querySelectorAll('table[data-tbl] th.sortable').forEach(th => th.onclick = () => {
    const id = th.closest('table').dataset.tbl, k = th.dataset.k;
    const cur = S.sorts[id];
    S.sorts[id] = cur && cur.k === k ? { k, asc: !cur.asc } : { k, asc: false };
    render(true);
  });
}

function banners() {
  const b = [], H = S.D.health || {};
  const crit = S.alerts.filter(a => a.level === '严重');
  if (H.generated_at && (Date.now() - Date.parse(H.generated_at)) / 36e5 > 26) b.push(`<div class="bn warn"><b>⚠ 数据已过期</b><span>最近一次更新是 ${ago(H.generated_at)}，请到「运维监控」检查 GitHub Actions 运行状态。</span></div>`);
  if (H.status === 'failed') b.push(`<div class="bn crit"><b>✕ 数据检查未通过</b><span>${esc((H.checks || []).filter(c => !c.ok && c.level === '严重').map(c => c.name + '：' + c.detail).join('；'))}</span></div>`);
  if (crit.length && ['overview', 'risk'].includes(S.view)) b.push(`<div class="bn crit"><b>! ${crit.length} 条严重提醒</b><span>${crit.map(a => `<a href="#address/${a.addr}">${esc(a.label)}</a> ${esc(a.message)}`).join('；')}</span></div>`);
  if (S.live && !S.live.errs.length) b.push(`<div class="bn info"><b>● 实时数据 ${bj(S.live.at).slice(11)}</b><span>已更新：账户资金、持仓、浮动盈亏、杠杆、近 24 小时盈亏与交易量。每日图表、日度盈亏和风险提醒仍为每天 08:07 的数据。</span></div>`);
  if (S.live && S.live.errs.length) b.push(`<div class="bn warn"><b>实时拉取部分失败</b><span>${S.live.errs.length} 个地址失败，已使用快照数据代替。</span></div>`);
  $('#banner').innerHTML = b.join('');
}

function render(keepScroll) {
  const y = window.scrollY;
  S.charts.forEach(c => c.destroy()); S.charts = [];
  const [view, param] = (location.hash.slice(1) || 'overview').split('/');
  S.view = VIEWS[view] ? view : 'overview';
  document.querySelectorAll('#nav a').forEach(a => a.classList.toggle('on', a.dataset.v === S.view));
  $('#page-title').textContent = VIEWS[S.view].t;
  const H = S.D.health || {};
  $('#page-sub').innerHTML = `${VIEWS[S.view].s} · 数据截至 ${S.days[S.days.length - 1] || '—'}（UTC）${S.live ? ` · <span class="pos">● 实时 ${bj(S.live.at).slice(11)}</span>` : ''}`;
  document.querySelectorAll('#range button').forEach(b => b.classList.toggle('on', +b.dataset.r === S.range));
  $('#range').style.visibility = ['risk', 'weekly'].includes(S.view) ? 'hidden' : '';
  banners();
  const fn = { overview: vOverview, weekly: vWeekly, ops: vOps, address: vAddress, coins: vCoins, strategy: vStrategy, risk: vRisk, devops: vDevops }[S.view];
  let out;
  try { out = fn(param); } catch (e) { console.error(e); out = `<div class="bn crit">渲染出错：${esc(e.message)}</div>`; }
  const [html, after] = Array.isArray(out) ? out : [out, null];
  $('#view').innerHTML = html;
  if (after) try { after(); } catch (e) { console.error(e); }
  bindSort();
  if (keepScroll) window.scrollTo(0, y);
  // nav badges
  const c = S.alerts.filter(a => a.level === '严重').length, w = S.alerts.filter(a => a.level === '警告').length;
  const nb = $('#nav-alerts'); nb.textContent = c || w || ''; nb.className = 'badge ' + (c ? 'crit' : 'warn');
  const failed = (H.checks || []).filter(x => !x.ok && x.level !== '提示').length;
  const stale = H.generated_at && (Date.now() - Date.parse(H.generated_at)) / 36e5 > 26;
  const hb = $('#nav-health'); hb.textContent = H.status === 'failed' || stale ? '!' : failed ? failed : '✓'; hb.className = 'badge ' + (H.status === 'failed' || stale ? 'crit' : failed ? 'warn' : 'ok');
  $('#side-foot').innerHTML = `监控 <b>${S.addrs.length}</b> 个地址<br>更新 <b>${H.generated_at ? ago(H.generated_at) : '—'}</b><br>起始 <b>${S.D.meta?.since || '—'}</b>`;
  $('#foot').innerHTML = `数据来源：Hyperliquid 公开 API（userFillsByTime / userFunding / portfolio / clearinghouseState）。日期均为 UTC；官方盈亏取 portfolio 盈亏历史，包含持仓浮动盈亏变化。生成于 ${H.generated_at ? bj(H.generated_at) : '—'}。`;
}

function bindShell() {
  window.addEventListener('hashchange', () => { $('#side').classList.remove('open'); render(); window.scrollTo(0, 0); });
  $('#range').onclick = e => { const b = e.target.closest('button'); if (!b) return; S.range = +b.dataset.r; try { localStorage.setItem('hl-range', S.range); } catch {} render(true); };
  $('#live-btn').onclick = liveRefresh;
  $('#menu').onclick = () => $('#side').classList.toggle('open');
  $('#theme-btn').onclick = () => {
    const root = document.documentElement;
    const dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    root.dataset.theme = dark ? 'light' : 'dark';
    try { localStorage.setItem('hl-theme', root.dataset.theme); } catch {}
    render(true);
  };
  const tip = $('#tip');
  document.addEventListener('mousemove', e => {
    const t = e.target.closest && e.target.closest('[data-t]');
    if (!t) { tip.classList.remove('on'); return; }
    tip.textContent = t.dataset.t; tip.classList.add('on');
    const x = Math.min(e.clientX + 14, innerWidth - tip.offsetWidth - 8), y = Math.min(e.clientY + 14, innerHeight - tip.offsetHeight - 8);
    tip.style.left = x + 'px'; tip.style.top = y + 'px';
  });
  let rt; window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => S.charts.forEach(c => c.resize()), 150); });
}

(async function init() {
  try { const t = localStorage.getItem('hl-theme'); if (t) document.documentElement.dataset.theme = t; const r = localStorage.getItem('hl-range'); if (r != null) S.range = +r; } catch {}
  bindShell();
  const D = await loadAll();
  if (!D.daily_total) { $('#view').innerHTML = '<div class="bn crit">无法加载 data/daily_total.json。请先运行 <code>bash pipeline/run.sh</code> 生成数据。</div>'; return; }
  prep(D);
  render();
  if (new URLSearchParams(location.search).has('live')) liveRefresh();
})();
})();
