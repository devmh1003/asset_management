import { createBackend, isFirebaseConfigured, COLLECTIONS } from './store.js';
import * as M from './model.js';
import { exportWorkbook, parseWorkbook } from './excel.js';

const S = {
  be: null,
  user: null,
  data: Object.fromEntries(COLLECTIONS.map((c) => [c, []])),
  settings: structuredClone(M.DEFAULT_SETTINGS),
  page: 'dashboard',
  basis: null,
  cfYear: null,
  plan: null,
  charts: [],
  pendingCharts: [],
  focusFid: null,
};

const PAGES = [
  ['dashboard', '대시보드', '◎'],
  ['assets', '자산 (B.S)', '▤'],
  ['liabilities', '부채 (D.L)', '▼'],
  ['cashflow', '현금흐름 (C.F)', '⇅'],
  ['history', '연도별 추이', '↗'],
  ['portfolio', '포트폴리오', '◔'],
  ['goals', '관리목표', '✓'],
  ['settings', '설정', '⚙'],
];

const PALETTE = ['#2f6fed', '#13a383', '#f2994a', '#9b51e0', '#eb5757', '#56ccf2', '#bdbd2a', '#8d6e63'];
const RATINGS = ['매우좋음', '긍정', '보통', '나쁨', '매우나쁨'];
const PROGRESS = ['진행중', '완료', '지속', '보류'];
const METRICS = ['부채비율', '유동비율', '기대수익률', '안전자산비율', '순자산', '총자산', '없음'];

// ---------- DOM helpers ----------
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'value' || k === 'checked' || k === 'disabled') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(Infinity)) if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}
const $ = (sel) => document.querySelector(sel);

function toast(msg, kind = 'ok') {
  const t = h('div', { class: `toast ${kind}` }, msg);
  $('#toasts').append(t);
  setTimeout(() => t.classList.add('out'), 2600);
  setTimeout(() => t.remove(), 3000);
}

function select(options, value, onchange, props = {}) {
  const opts = [...new Set([...options, value].filter((v) => v !== undefined && v !== null && v !== ''))];
  const el = h('select', { ...props, onchange: (e) => onchange(e.target.value) },
    props.placeholder !== false ? h('option', { value: '' }, '—') : null,
    opts.map((o) => (typeof o === 'object' ? h('option', { value: o.value }, o.label) : h('option', { value: o }, o))));
  el.value = value ?? '';
  return el;
}

function modal({ title, body, okText = '확인', cancelText = '취소', danger = false, wide = false }) {
  return new Promise((resolve) => {
    const close = (v) => { root.remove(); resolve(v); };
    const content = typeof body === 'function' ? body() : body;
    const root = h('div', { class: 'modal-back', onmousedown: (e) => { if (e.target === root) close(false); } },
      h('div', { class: `modal ${wide ? 'wide' : ''}`, role: 'dialog' },
        h('h3', {}, title),
        h('div', { class: 'modal-body' }, content),
        h('div', { class: 'modal-actions' },
          cancelText ? h('button', { class: 'btn', onclick: () => close(false) }, cancelText) : null,
          h('button', { class: `btn ${danger ? 'danger' : 'primary'}`, onclick: () => close(true) }, okText))));
    document.body.append(root);
    root.querySelector('input,select,button.primary,button.danger')?.focus();
    root.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(false); });
  });
}

async function ask(title, fields, okText = '확인') {
  const inputs = {};
  const body = h('div', { class: 'form' }, fields.map((f) => {
    let el;
    if (f.type === 'select') el = select(f.options, f.value, () => {}, { placeholder: false });
    else if (f.type === 'checkbox') el = h('input', { type: 'checkbox', checked: !!f.value });
    else el = h('input', { type: f.type || 'text', value: f.value ?? '' });
    inputs[f.key] = el;
    return h('label', { class: f.type === 'checkbox' ? 'check' : '' }, h('span', {}, f.label), el);
  }));
  body.addEventListener('keydown', (e) => { if (e.key === 'Enter') body.closest('.modal').querySelector('.btn.primary').click(); });
  const ok = await modal({ title, body, okText });
  if (!ok) return null;
  return Object.fromEntries(Object.entries(inputs).map(([k, el]) => [k, el.type === 'checkbox' ? el.checked : el.value.trim()]));
}

const confirmBox = (title, text, okText = '삭제') => modal({ title, body: h('p', {}, text), okText, danger: true });

// ---------- 데이터 조작 ----------
async function guard(fn, okMsg) {
  try { await fn(); if (okMsg) toast(okMsg); }
  catch (e) { console.error(e); toast(`저장 실패: ${e.message || e}`, 'err'); }
}

function saveRow(coll, row) { return guard(() => S.be.put(coll, row.id, row)); }

async function addRow(coll, obj, focusKey) {
  const row = { ...obj, id: M.uid(), order: Date.now() };
  S.data[coll].push(row);
  if (focusKey) S.focusFid = `${row.id}:${focusKey}`;
  render();
  await saveRow(coll, row);
}

async function removeRow(coll, row, label) {
  if (!(await confirmBox('행 삭제', `"${label || row.name || row.creditor || row.item || '이 항목'}" 을(를) 삭제할까요?`))) return;
  S.data[coll] = S.data[coll].filter((r) => r !== row);
  render();
  await guard(() => S.be.remove(coll, row.id));
}

async function saveSettings() { await guard(() => S.be.saveSettings(S.settings)); }

async function reload() {
  const all = await S.be.loadAll();
  for (const c of COLLECTIONS) S.data[c] = all[c] || [];
  if (all.settings) S.settings = { ...structuredClone(M.DEFAULT_SETTINGS), ...all.settings };
  else await S.be.saveSettings(S.settings);
  syncSelections();
}

function syncSelections() {
  const bs = M.bases(S.data.assets);
  if (!bs.includes(S.basis)) S.basis = bs[bs.length - 1] || null;
  const ys = cfYears();
  if (!ys.includes(S.cfYear)) S.cfYear = ys.includes(new Date().getFullYear()) ? new Date().getFullYear() : ys[ys.length - 1] ?? null;
  const ps = plans();
  if (!ps.includes(S.plan)) S.plan = ps[0] ?? null;
}

const cfYears = () => [...new Set(S.data.cashflow.map((r) => M.num(r.year)))].sort();
const plans = () => [...new Set(S.data.portfolio.map((r) => r.plan).filter(Boolean))].sort();
const basisAssets = (b = S.basis) => S.data.assets.filter((a) => a.basis === b);
const summary = (b = S.basis) => M.summarize(basisAssets(b), S.data.liabilities, S.settings);

function templateRows(coll, { basis = M.today(), year = new Date().getFullYear(), plan = '기본안' } = {}) {
  const stamp = (rows) => rows.map((r, i) => ({ ...structuredClone(r), id: M.uid() + i, order: i }));
  switch (coll) {
    case 'assets': return stamp(M.TEMPLATE_ASSETS).map((r) => ({ ...r, basis }));
    case 'liabilities': return stamp(M.TEMPLATE_LIABILITIES);
    case 'cashflow': return stamp(M.TEMPLATE_CASHFLOW).map((r) => ({ ...r, year }));
    case 'portfolio': return stamp(M.TEMPLATE_PORTFOLIO).map((r) => ({ ...r, plan }));
    case 'goals': return stamp(M.TEMPLATE_GOALS);
    default: return [];
  }
}

async function seed(colls) {
  await guard(async () => {
    for (const c of colls) {
      if (S.data[c].length) continue;
      const rows = templateRows(c);
      await S.be.putMany(c, rows);
      S.data[c] = rows;
    }
    syncSelections();
    render();
  }, '엑셀 구조 기반 기본 항목을 만들었습니다');
}

// ---------- 편집 그리드 ----------
// col: { key, label, type: text|num|pct|date|select|calc, options(row), get(row), set(row,v), calc(row), fmt, w, after(row) }
function fmtCalc(c, v) {
  if (v === '' || v == null) return '';
  if (typeof c.fmt === 'function') return c.fmt(v);
  if (c.fmt === 'pct') return M.fmtPct(v);
  if (c.fmt === 'num') return M.fmtNum(v);
  return M.fmtKRW(v);
}

function cellEditor(c, row, coll) {
  const fid = `${row.id}:${c.key}`;
  const raw = c.get ? c.get(row) : row[c.key];
  const commit = (val) => {
    let v = val;
    if (c.type === 'num') v = val === '' ? 0 : M.num(val);
    if (c.type === 'pct') v = val === '' ? 0 : M.num(val) / 100;
    if (c.set) c.set(row, v); else row[c.key] = v;
    c.after?.(row);
    saveRow(coll, row);
    setTimeout(render, 0);
  };
  if (c.type === 'select') return select(c.options(row), raw, commit, { 'data-fid': fid });
  let display = raw ?? '';
  if (c.type === 'num') display = raw === '' || raw == null ? '' : M.fmtNum(raw, 6);
  if (c.type === 'pct') display = raw === '' || raw == null ? '' : String(+(M.num(raw) * 100).toFixed(4));
  const input = h('input', {
    type: c.type === 'date' ? 'date' : 'text',
    value: display,
    'data-fid': fid,
    class: c.type,
    inputmode: c.type === 'num' || c.type === 'pct' ? 'decimal' : null,
    onchange: (e) => commit(e.target.value),
    onkeydown: (e) => { if (e.key === 'Enter') e.target.blur(); },
  });
  return c.type === 'pct' ? h('span', { class: 'pct-wrap' }, input, h('i', {}, '%')) : input;
}

function grid({ cols, rows, coll, foot = [], label, rowClass }) {
  const isNum = (c) => ['num', 'pct'].includes(c.type) || (c.type === 'calc');
  return h('div', { class: 'table-wrap' },
    h('table', { class: 'grid' },
      h('thead', {}, h('tr', {}, cols.map((c) => h('th', { class: isNum(c) ? 'r' : '', style: c.w ? { minWidth: c.w } : null }, c.label)), h('th', { class: 'act' }))),
      h('tbody', {}, rows.length ? rows.map((r) => h('tr', { class: rowClass?.(r) || '' },
        cols.map((c) => h('td', { class: `${isNum(c) ? 'r' : ''} ${c.type === 'calc' ? 'calc' : ''}` },
          c.type === 'calc' ? fmtCalc(c, c.calc(r)) : cellEditor(c, r, coll))),
        h('td', { class: 'act' }, h('button', { class: 'icon-btn', title: '삭제', onclick: () => removeRow(coll, r, label?.(r)) }, '✕'))))
        : h('tr', {}, h('td', { class: 'empty', colspan: cols.length + 1 }, '항목이 없습니다. 위의 “+ 항목 추가” 로 추가하세요.'))),
      foot.length ? h('tfoot', {}, foot.map((f) => h('tr', { class: f.cls || '' },
        f.cells.map((v, i) => h('td', { class: cols[i] && isNum(cols[i]) ? 'r' : '' }, v ?? '')), h('td', {})))) : null));
}

// ---------- 공통 UI ----------
const kpi = (label, value, sub, tone) => h('div', { class: `kpi ${tone || ''}` }, h('div', { class: 'kpi-label' }, label), h('div', { class: 'kpi-value' }, value), sub ? h('div', { class: 'kpi-sub' }, sub) : null);
const card = (title, ...kids) => h('section', { class: 'card' }, title ? h('h2', {}, title) : null, ...kids);
const toolbar = (...kids) => h('div', { class: 'toolbar' }, ...kids);
const btn = (text, onclick, cls = '') => h('button', { class: `btn ${cls}`, onclick }, text);
const diff = (cur, prev) => {
  if (prev == null) return null;
  const d = cur - prev;
  const r = prev ? d / Math.abs(prev) : 0;
  return h('span', { class: d >= 0 ? 'up' : 'down' }, `${d >= 0 ? '▲' : '▼'} ${M.fmtEok(Math.abs(d))} (${M.fmtPct(r)})`);
};

function chart(canvasId, config) {
  S.pendingCharts.push(() => {
    const el = document.getElementById(canvasId);
    if (!el || !window.Chart) return;
    S.charts.push(new Chart(el, config));
  });
  return h('div', { class: 'chart-box' }, h('canvas', { id: canvasId }));
}

function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

function emptyState(text, actions) {
  return h('div', { class: 'empty-state' }, h('p', {}, text), h('div', { class: 'row' }, actions));
}

function basisSelect() {
  const bs = M.bases(S.data.assets);
  return h('label', { class: 'inline' }, '기준일',
    select(bs.map((b) => ({ value: b, label: b })).reverse(), S.basis, (v) => { S.basis = v; render(); }, { placeholder: false }));
}

// ---------- 페이지: 대시보드 ----------
function pageDashboard() {
  const allEmpty = COLLECTIONS.every((c) => !S.data[c].length);
  if (allEmpty) {
    return h('div', {},
      card('시작하기',
        h('p', { class: 'muted' }, '아직 데이터가 없습니다. 기존 엑셀(2026 개인자산현황)의 구조로 기본 항목을 만들거나, 엑셀 파일을 업로드해 시작하세요. 금액은 모두 0 으로 생성되니 실제 값만 입력하면 됩니다.'),
        h('div', { class: 'row' },
          btn('엑셀 구조로 기본 항목 만들기', () => seed(COLLECTIONS), 'primary'),
          btn('빈 엑셀 양식 다운로드', downloadTemplate),
          btn('엑셀 업로드', pickUpload))));
  }
  if (!S.basis) return card('대시보드', emptyState('자산 데이터가 없습니다.', [btn('자산 기본 항목 만들기', () => seed(['assets']), 'primary')]));

  const bs = M.bases(S.data.assets);
  const idx = bs.indexOf(S.basis);
  const sum = summary();
  const prev = idx > 0 ? summary(bs[idx - 1]) : null;
  const year = S.basis.slice(0, 4);
  const hist = [...S.data.history].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const goalRow = hist.find((r) => String(r.date).startsWith(year)) || hist[hist.length - 1];
  const target = goalRow ? M.num(goalRow.target) : 0;

  const majors = Object.entries(sum.byMajor).filter(([, v]) => v > 0);
  const content = h('div', { class: 'stack' },
    toolbar(basisSelect(), prev ? h('span', { class: 'muted' }, `비교: ${bs[idx - 1]}`) : null),
    h('div', { class: 'kpis' },
      kpi('순자산', `${M.fmtKRW(sum.net)}원`, diff(sum.net, prev?.net), 'accent'),
      kpi('총자산', `${M.fmtKRW(sum.total)}원`, diff(sum.total, prev?.total)),
      kpi('총부채', `${M.fmtKRW(sum.debt)}원`, `연이자 ${M.fmtKRW(sum.interest)}원`),
      kpi('부채비율 (부채/총자산)', M.fmtPct(sum.debtRatio), `유동비율 ${M.fmtPct(sum.liquidity)}`),
      kpi('기대이익', `${M.fmtKRW(sum.profit)}원`, `가중 기대수익률 ${M.fmtPct(sum.expRate)} · NRV ${M.fmtEok(sum.nrv)}`),
      kpi(`${year}년 목표 달성률`, target ? M.fmtPct(sum.net / target) : '—',
        target ? h('div', { class: 'bar' }, h('i', { style: { width: `${Math.min(100, (sum.net / target) * 100)}%` } })) : '연도별 추이에서 목표치를 입력하세요')),
    h('div', { class: 'grid-2' },
      card('대분류별 자산 비중', majors.length ? chart('c-major', {
        type: 'doughnut',
        data: { labels: majors.map(([k]) => k), datasets: [{ data: majors.map(([, v]) => Math.round(v)), backgroundColor: PALETTE, borderWidth: 0 }] },
        options: { maintainAspectRatio: false, cutout: '62%', plugins: { legend: { position: 'right' }, tooltip: { callbacks: { label: (c) => ` ${c.label}: ${M.fmtKRW(c.raw)}원 (${M.fmtPct(c.raw / sum.total)})` } } } },
      }) : h('p', { class: 'muted' }, '공정가치를 입력하면 비중이 표시됩니다.')),
      card('그룹별 (Var / Risk / Fixed)', h('div', { class: 'group-bars' }, ['Var', 'Risk', 'Fixed'].map((g, i) => {
        const v = sum.byGroup[g] || 0;
        const r = sum.total ? v / sum.total : 0;
        return h('div', { class: 'gbar' },
          h('div', { class: 'gbar-head' }, h('b', {}, g), h('span', {}, `${M.fmtEok(v)} · ${M.fmtPct(r)}`)),
          h('div', { class: 'bar' }, h('i', { style: { width: `${r * 100}%`, background: PALETTE[i] } })),
          h('small', { class: 'muted' }, S.settings.taxonomy.filter((t) => t.group === g).map((t) => t.major).join(', ')));
      })))),
    card(`${year}년 기준일별 자산 비중`, quarterTable(year)),
    h('div', { class: 'grid-2' },
      card('연도별 순자산 추이', hist.length ? chart('c-hist', historyChartConfig(hist)) : h('p', { class: 'muted' }, '연도별 추이 페이지에서 기록을 추가하세요.')),
      card(`${S.cfYear ?? ''} 현금흐름 (만원)`, S.cfYear != null ? chart('c-cf', cashflowChartConfig()) : h('p', { class: 'muted' }, '현금흐름 데이터가 없습니다.'))));
  return content;
}

function quarterTable(year) {
  const bs = M.bases(S.data.assets).filter((b) => b.startsWith(year));
  const sums = bs.map((b) => summary(b));
  const rows = [];
  const seen = new Set();
  for (const t of S.settings.taxonomy) for (const m of t.mids) { rows.push([t.group, t.major, m]); seen.add(`${t.major}|${m}`); }
  for (const a of S.data.assets) {
    const k = `${a.major}|${a.mid}`;
    if (!seen.has(k) && bs.includes(a.basis)) { seen.add(k); rows.push(['-', a.major, a.mid]); }
  }
  return h('div', { class: 'table-wrap' }, h('table', { class: 'grid compact' },
    h('thead', {}, h('tr', {}, h('th', {}, '그룹'), h('th', {}, '대분류'), h('th', {}, '중분류'),
      bs.map((b) => [h('th', { class: 'r' }, b), h('th', { class: 'r' }, '비중')]))),
    h('tbody', {}, rows.map(([g, major, mid]) => h('tr', {}, h('td', { class: 'muted' }, g), h('td', {}, major), h('td', {}, mid),
      sums.map((s) => { const v = s.byMid[`${major}|${mid}`] || 0; return [h('td', { class: 'r' }, M.fmtKRW(v)), h('td', { class: 'r muted' }, s.total ? M.fmtPct(v / s.total) : '')]; })))),
    h('tfoot', {}, h('tr', {}, h('td', { colspan: 3 }, '합계'), sums.map((s) => [h('td', { class: 'r' }, M.fmtKRW(s.total)), h('td', { class: 'r' }, '100%')])))));
}

function historyChartConfig(hist) {
  return {
    type: 'bar',
    data: {
      labels: hist.map((r) => r.date),
      datasets: [
        { type: 'bar', label: '순자산', data: hist.map((r) => M.num(r.netWorth)), backgroundColor: PALETTE[0], borderRadius: 4 },
        { type: 'line', label: '목표치', data: hist.map((r) => M.num(r.target) || null), borderColor: PALETTE[2], backgroundColor: PALETTE[2], tension: 0.2 },
      ],
    },
    options: { maintainAspectRatio: false, animation: false, scales: { y: { ticks: { callback: (v) => M.fmtEok(v) } } }, plugins: { tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${M.fmtKRW(c.raw)}원` } } } },
  };
}

function cashflowChartConfig() {
  const cf = M.cashflowSummary(S.data.cashflow.filter((r) => M.num(r.year) === S.cfYear));
  return {
    type: 'bar',
    data: {
      labels: Array.from({ length: 12 }, (_, i) => `${i + 1}월`),
      datasets: [
        { label: '수입', data: cf.inc, backgroundColor: PALETTE[1], borderRadius: 3 },
        { label: '지출', data: cf.out, backgroundColor: PALETTE[4], borderRadius: 3 },
        { type: 'line', label: '누적 순이익', data: cf.cum, borderColor: PALETTE[0], backgroundColor: PALETTE[0], yAxisID: 'y2', tension: 0.2 },
      ],
    },
    options: { maintainAspectRatio: false, animation: false, scales: { y2: { position: 'right', grid: { display: false } } } },
  };
}

// ---------- 페이지: 자산 ----------
function pageAssets() {
  const bs = M.bases(S.data.assets);
  if (!bs.length) {
    return card('자산 (Balance Sheet)', emptyState('자산 데이터가 없습니다.', [
      btn('엑셀 구조로 기본 항목 만들기', () => seed(['assets']), 'primary'),
      btn('빈 기준일 만들기', async () => { const v = await ask('새 기준일', [{ key: 'd', label: '기준일', type: 'date', value: M.today() }]); if (v?.d) { S.basis = v.d; addRow('assets', { basis: v.d, major: '현금', mid: '예금', name: '', currency: 'KRW', value: 0, rate: 0 }, 'name'); } }),
    ]));
  }
  const rows = M.sortAssets(basisAssets(), S.settings);
  const sum = summary();
  const fx = S.settings.fx;
  const tax = S.settings.taxonomy;
  const cols = [
    { key: 'major', label: '대분류', type: 'select', options: () => tax.map((t) => t.major), w: '96px', after: (r) => { const t = tax.find((x) => x.major === r.major); if (t && !t.mids.includes(r.mid)) r.mid = t.mids[0] || ''; } },
    { key: 'mid', label: '중분류', type: 'select', options: (r) => tax.find((t) => t.major === r.major)?.mids || [], w: '90px' },
    { key: 'name', label: '소분류', type: 'text', w: '140px' },
    { key: 'currency', label: '통화', type: 'select', options: () => Object.keys(fx), w: '72px' },
    { key: 'value', label: '공정가치', type: 'num', w: '120px' },
    { key: 'krw', label: '원화환산', type: 'calc', calc: (r) => M.toKRW(r, fx) },
    { key: 'ratio', label: '비중', type: 'calc', fmt: 'pct', calc: (r) => (sum.total ? M.toKRW(r, fx) / sum.total : 0) },
    { key: 'rate', label: '기대이익률', type: 'pct', w: '84px' },
    { key: 'profit', label: '기대이익', type: 'calc', calc: (r) => M.toKRW(r, fx) * M.num(r.rate) },
    { key: 'nrv', label: 'NRV', type: 'calc', calc: (r) => M.toKRW(r, fx) * (1 + M.num(r.rate)) },
    { key: 'manager', label: '운용위임사', type: 'text', w: '110px' },
    { key: 'note', label: '기타사항', type: 'text', w: '130px' },
  ];
  const foot = [{ cls: 'total', cells: ['합계', '', '', '', '', M.fmtKRW(sum.total), '100%', M.fmtPct(sum.expRate), M.fmtKRW(sum.profit), M.fmtKRW(sum.nrv), '', ''] }];
  return h('div', { class: 'stack' },
    toolbar(basisSelect(),
      btn('+ 항목 추가', () => addRow('assets', { basis: S.basis, major: tax[0]?.major || '', mid: tax[0]?.mids[0] || '', name: '', currency: 'KRW', value: 0, rate: 0, manager: '', note: '' }, 'name'), 'primary'),
      btn('새 기준일로 복사', newBasis),
      btn('기준일 변경', renameBasis),
      btn('기준일 삭제', deleteBasis, 'ghost-danger')),
    h('div', { class: 'chips' }, Object.entries(sum.byMajor).map(([k, v]) => h('span', { class: 'chip' }, h('b', {}, k), ` ${M.fmtEok(v)} · ${M.fmtPct(sum.total ? v / sum.total : 0)}`))),
    card(null, grid({ cols, rows, coll: 'assets', foot, rowClass: (r) => `maj-${tax.findIndex((t) => t.major === r.major) % 2 ? 'odd' : 'even'}` })),
    h('p', { class: 'muted small' }, `환율: ${Object.entries(fx).filter(([k]) => k !== 'KRW').map(([k, v]) => `${k} ${M.fmtNum(v)}`).join(' · ')} (설정에서 변경)`));
}

async function newBasis() {
  const v = await ask('새 기준일로 복사', [
    { key: 'd', label: '새 기준일', type: 'date', value: M.today() },
    { key: 'keep', label: '현재 금액도 함께 복사', type: 'checkbox', value: true },
  ], '만들기');
  if (!v?.d) return;
  if (M.bases(S.data.assets).includes(v.d)) return toast('이미 있는 기준일입니다', 'err');
  const rows = basisAssets().map((a, i) => ({ ...a, id: M.uid() + i, basis: v.d, value: v.keep ? a.value : 0 }));
  await guard(async () => { await S.be.putMany('assets', rows); S.data.assets.push(...rows); S.basis = v.d; render(); }, `${v.d} 기준일을 만들었습니다`);
}

async function renameBasis() {
  const v = await ask('기준일 변경', [{ key: 'd', label: '새 기준일', type: 'date', value: S.basis }], '변경');
  if (!v?.d || v.d === S.basis) return;
  if (M.bases(S.data.assets).includes(v.d)) return toast('이미 있는 기준일입니다', 'err');
  const rows = basisAssets();
  rows.forEach((r) => { r.basis = v.d; });
  await guard(async () => { await S.be.putMany('assets', rows); S.basis = v.d; render(); }, '기준일을 변경했습니다');
}

async function deleteBasis() {
  const rows = basisAssets();
  if (!(await confirmBox('기준일 삭제', `${S.basis} 기준일의 자산 ${rows.length}건을 모두 삭제할까요?`))) return;
  await guard(async () => {
    await S.be.removeMany('assets', rows.map((r) => r.id));
    S.data.assets = S.data.assets.filter((a) => a.basis !== S.basis);
    syncSelections(); render();
  }, '삭제했습니다');
}

// ---------- 페이지: 부채 ----------
function pageLiabilities() {
  const rows = [...S.data.liabilities].sort((a, b) => M.num(a.order) - M.num(b.order));
  const total = rows.reduce((s, r) => s + M.num(r.amount), 0);
  const interest = rows.reduce((s, r) => s + M.num(r.amount) * M.num(r.rate), 0);
  const cols = [
    { key: 'creditor', label: '채권자', type: 'text', w: '140px' },
    { key: 'amount', label: '금액', type: 'num', w: '130px' },
    { key: 'maturity', label: '만기일', type: 'date', w: '130px' },
    { key: 'rate', label: '금리', type: 'pct', w: '80px' },
    { key: 'interest', label: '연이자', type: 'calc', calc: (r) => M.num(r.amount) * M.num(r.rate) },
    { key: 'repay', label: '상환방식', type: 'text', w: '100px' },
    { key: 'note', label: '기타사항', type: 'text', w: '160px' },
  ];
  const sum = S.basis ? summary() : null;
  return h('div', { class: 'stack' },
    toolbar(btn('+ 항목 추가', () => addRow('liabilities', { creditor: '', amount: 0, maturity: '', rate: 0, repay: '급여', note: '' }, 'creditor'), 'primary'),
      !rows.length ? btn('엑셀 구조로 기본 항목 만들기', () => seed(['liabilities'])) : null),
    h('div', { class: 'kpis' },
      kpi('총부채', `${M.fmtKRW(total)}원`),
      kpi('연이자 합계', `${M.fmtKRW(interest)}원`, `월 ${M.fmtKRW(interest / 12)}원`),
      kpi('평균 금리 (가중)', total ? M.fmtPct(interest / total, 2) : '—'),
      sum ? kpi('부채비율 (부채/총자산)', M.fmtPct(sum.debtRatio), `기준일 ${S.basis}`) : null),
    card('Debt & Liability', grid({ cols, rows, coll: 'liabilities', foot: [{ cls: 'total', cells: ['합계', M.fmtKRW(total), '', total ? M.fmtPct(interest / total, 2) : '', M.fmtKRW(interest), '', ''] }] })));
}

// ---------- 페이지: 현금흐름 ----------
function pageCashflow() {
  const years = cfYears();
  if (!years.length) {
    return card('현금흐름 (Cash Flow)', emptyState('현금흐름 데이터가 없습니다.', [btn('엑셀 구조로 기본 항목 만들기', () => seed(['cashflow']), 'primary')]));
  }
  const rows = S.data.cashflow.filter((r) => M.num(r.year) === S.cfYear)
    .sort((a, b) => (a.type === b.type ? 0 : a.type === '수입' ? -1 : 1) || M.num(a.order) - M.num(b.order));
  const cf = M.cashflowSummary(rows);
  const tot = (arr) => arr.reduce((s, v) => s + v, 0);
  const cols = [
    { key: 'type', label: '구분', type: 'select', options: () => ['수입', '지출'], w: '72px', after: (r) => { if (!M.CF_GROUPS[r.type]?.includes(r.group)) r.group = M.CF_GROUPS[r.type]?.[0] || ''; } },
    { key: 'group', label: '그룹', type: 'select', options: (r) => M.CF_GROUPS[r.type] || [], w: '90px' },
    { key: 'name', label: '항목', type: 'text', w: '110px' },
    ...Array.from({ length: 12 }, (_, i) => ({ key: `m${i}`, label: `${i + 1}월`, type: 'num', w: '64px', get: (r) => M.num(r.m?.[i]), set: (r, v) => { (r.m ||= Array(12).fill(0))[i] = v; } })),
    { key: 'sum', label: '합계', type: 'calc', fmt: 'num', calc: (r) => tot((r.m || []).map(M.num)) },
  ];
  const line = (label, arr, cls) => ({ cls, cells: [label, '', '', ...arr.map((v) => M.fmtNum(v)), M.fmtNum(tot(arr))] });
  return h('div', { class: 'stack' },
    toolbar(
      h('label', { class: 'inline' }, '연도', select(years.map(String), String(S.cfYear), (v) => { S.cfYear = Number(v); render(); }, { placeholder: false })),
      btn('+ 수입 항목', () => addRow('cashflow', { year: S.cfYear, type: '수입', group: '급여', name: '', m: Array(12).fill(0) }, 'name'), 'primary'),
      btn('+ 지출 항목', () => addRow('cashflow', { year: S.cfYear, type: '지출', group: '고정비', name: '', m: Array(12).fill(0) }, 'name'), 'primary'),
      btn('새 연도 만들기', newCfYear),
      btn('연도 삭제', deleteCfYear, 'ghost-danger'),
      h('span', { class: 'muted' }, '단위: 만원')),
    h('div', { class: 'kpis' },
      kpi('연간 수입', `${M.fmtNum(tot(cf.inc))}만원`),
      kpi('연간 지출', `${M.fmtNum(tot(cf.out))}만원`),
      kpi('연간 순이익', `${M.fmtNum(tot(cf.net))}만원`, `저축률 ${tot(cf.inc) ? M.fmtPct(tot(cf.net) / tot(cf.inc)) : '—'}`, 'accent'),
      kpi('월평균 지출', `${M.fmtNum(tot(cf.out) / 12, 1)}만원`)),
    card(`${S.cfYear} Cash Flow`, grid({
      cols, rows, coll: 'cashflow', label: (r) => r.name,
      rowClass: (r) => (r.type === '수입' ? 'inc' : 'out'),
      foot: [line('수입 합계 (A)', cf.inc), line('지출 합계 (B)', cf.out), line('Net Income (A-B)', cf.net, 'total'), { cls: 'muted-row', cells: ['누적 순이익', '', '', ...cf.cum.map((v) => M.fmtNum(v)), M.fmtNum(cf.cum[11])] }],
    })),
    card('월별 현금흐름', chart('c-cf2', cashflowChartConfig())));
}

async function newCfYear() {
  const last = cfYears().slice(-1)[0];
  const v = await ask('새 연도 만들기', [
    { key: 'y', label: '연도', type: 'number', value: (last ?? new Date().getFullYear() - 1) + 1 },
    { key: 'keep', label: `${S.cfYear}년 금액도 복사 (해제 시 항목만)`, type: 'checkbox', value: false },
  ], '만들기');
  const y = Number(v?.y);
  if (!y) return;
  if (cfYears().includes(y)) return toast('이미 있는 연도입니다', 'err');
  const src = S.data.cashflow.filter((r) => M.num(r.year) === S.cfYear);
  const rows = (src.length ? src : templateRows('cashflow')).map((r, i) => ({ ...r, id: M.uid() + i, year: y, m: v.keep ? [...(r.m || [])] : Array(12).fill(0) }));
  await guard(async () => { await S.be.putMany('cashflow', rows); S.data.cashflow.push(...rows); S.cfYear = y; render(); }, `${y}년을 만들었습니다`);
}

async function deleteCfYear() {
  const rows = S.data.cashflow.filter((r) => M.num(r.year) === S.cfYear);
  if (!(await confirmBox('연도 삭제', `${S.cfYear}년 현금흐름 ${rows.length}건을 모두 삭제할까요?`))) return;
  await guard(async () => {
    await S.be.removeMany('cashflow', rows.map((r) => r.id));
    S.data.cashflow = S.data.cashflow.filter((r) => !rows.includes(r));
    syncSelections(); render();
  }, '삭제했습니다');
}

// ---------- 페이지: 연도별 추이 ----------
function pageHistory() {
  const rows = [...S.data.history].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const growth = {};
  rows.forEach((r, i) => { const p = rows[i - 1]; if (p && M.num(p.netWorth)) growth[r.id] = (M.num(r.netWorth) - M.num(p.netWorth)) / M.num(p.netWorth); });
  const cols = [
    { key: 'date', label: '기준일', type: 'date', w: '130px' },
    { key: 'rating', label: '평가', type: 'select', options: () => RATINGS, w: '90px' },
    { key: 'netWorth', label: '순자산평가금액', type: 'num', w: '140px' },
    { key: 'debtRatio', label: '부채비율', type: 'pct', w: '80px' },
    { key: 'growth', label: '총자산증가율', type: 'calc', fmt: 'pct', calc: (r) => growth[r.id] ?? '' },
    { key: 'target', label: '목표치', type: 'num', w: '140px' },
    { key: 'achv', label: '달성률', type: 'calc', fmt: 'pct', calc: (r) => (M.num(r.target) ? M.num(r.netWorth) / M.num(r.target) : '') },
    { key: 'age', label: '나이(만)', type: 'num', w: '64px' },
    { key: 'note', label: '메모', type: 'text', w: '160px' },
  ];
  return h('div', { class: 'stack' },
    toolbar(
      btn('+ 항목 추가', () => addRow('history', { date: M.today(), rating: '보통', netWorth: 0, debtRatio: 0, target: 0, age: 0, note: '' }, 'date'), 'primary'),
      S.basis ? btn(`현재 기준일(${S.basis}) 순자산 기록`, recordHistory) : null),
    card('연도별 자산증가율', grid({ cols, rows, coll: 'history', label: (r) => r.date })),
    rows.length ? card('순자산 vs 목표', chart('c-hist2', historyChartConfig(rows))) : null);
}

async function recordHistory() {
  const sum = summary();
  const sorted = [...S.data.history].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const last = sorted[sorted.length - 1];
  let row = S.data.history.find((r) => r.date === S.basis);
  if (row) {
    if (!(await modal({ title: '기록 갱신', body: h('p', {}, `${S.basis} 기록이 이미 있습니다. 순자산과 부채비율을 현재 값으로 갱신할까요?`), okText: '갱신' }))) return;
    Object.assign(row, { netWorth: Math.round(sum.net), debtRatio: sum.debtRatio });
    await saveRow('history', row);
  } else {
    row = { id: M.uid(), order: Date.now(), date: S.basis, rating: '보통', netWorth: Math.round(sum.net), debtRatio: sum.debtRatio, target: last ? M.num(last.target) : 0, age: last ? M.num(last.age) + 1 : 0, note: '' };
    S.data.history.push(row);
    await saveRow('history', row);
  }
  toast('순자산을 기록했습니다');
  render();
}

// ---------- 페이지: 포트폴리오 ----------
function pagePortfolio() {
  const ps = plans();
  if (!ps.length) return card('투자 Portfolio 구성', emptyState('포트폴리오 안이 없습니다.', [btn('엑셀 구조로 기본 안 만들기', () => seed(['portfolio']), 'primary')]));
  const rows = S.data.portfolio.filter((r) => r.plan === S.plan).sort((a, b) => M.num(a.order) - M.num(b.order));
  const total = rows.reduce((s, r) => s + M.num(r.amount), 0);
  const avg = (k) => (rows.length ? rows.reduce((s, r) => s + M.num(r[k]), 0) / rows.length : 0);
  const gain = rows.reduce((s, r) => s + M.num(r.amount) * M.num(r.avgRate), 0);
  const cols = [
    { key: 'group', label: '구분', type: 'select', options: () => ['투자자산', '안전자산'], w: '90px' },
    { key: 'major', label: '대분류', type: 'text', w: '90px' },
    { key: 'mid', label: '중분류', type: 'text', w: '100px' },
    { key: 'form', label: '형태', type: 'text', w: '64px' },
    { key: 'amount', label: '금액', type: 'num', w: '120px' },
    { key: 'ratio', label: '비중', type: 'calc', fmt: 'pct', calc: (r) => (total ? M.num(r.amount) / total : 0) },
    { key: 'maxRate', label: '최대수익률', type: 'pct', w: '76px' },
    { key: 'minRate', label: '최소수익률', type: 'pct', w: '76px' },
    { key: 'avgRate', label: '평균수익률', type: 'pct', w: '76px' },
    { key: 'gain', label: '순자산 증감', type: 'calc', calc: (r) => M.num(r.amount) * M.num(r.avgRate) },
    { key: 'fv', label: 'FV', type: 'calc', calc: (r) => M.num(r.amount) * (1 + M.num(r.avgRate)) },
    { key: 'note', label: '메모', type: 'text', w: '140px' },
  ];
  const parts = rows.filter((r) => M.num(r.amount) > 0);
  return h('div', { class: 'stack' },
    toolbar(
      h('label', { class: 'inline' }, '안', select(ps, S.plan, (v) => { S.plan = v; render(); }, { placeholder: false })),
      btn('+ 항목 추가', () => addRow('portfolio', { plan: S.plan, group: '투자자산', major: '', mid: '', form: '', amount: 0, maxRate: 0, minRate: 0, avgRate: 0, note: '' }, 'major'), 'primary'),
      btn('새 안으로 복사', newPlan), btn('안 이름 변경', renamePlan), btn('안 삭제', deletePlan, 'ghost-danger')),
    h('div', { class: 'kpis' },
      kpi('총 투자금액', `${M.fmtKRW(total)}원`),
      kpi('예상 순자산 증감', `${M.fmtKRW(gain)}원`, `가중 평균수익률 ${total ? M.fmtPct(gain / total) : '—'}`, 'accent'),
      kpi('예상 FV', `${M.fmtKRW(total + gain)}원`),
      kpi('수익률 범위 (단순평균)', `${M.fmtPct(avg('minRate'))} ~ ${M.fmtPct(avg('maxRate'))}`)),
    h('div', { class: 'grid-2 wide-left' },
      card(S.plan, grid({ cols, rows, coll: 'portfolio', label: (r) => `${r.major} ${r.mid}`, foot: [{ cls: 'total', cells: ['합계', '', '', '', M.fmtKRW(total), '100%', M.fmtPct(avg('maxRate')), M.fmtPct(avg('minRate')), M.fmtPct(avg('avgRate')), M.fmtKRW(gain), M.fmtKRW(total + gain), ''] }] })),
      card('구성 비중', parts.length ? chart('c-pf', {
        type: 'doughnut',
        data: { labels: parts.map((r) => `${r.mid}(${r.form})`), datasets: [{ data: parts.map((r) => M.num(r.amount)), backgroundColor: PALETTE, borderWidth: 0 }] },
        options: { maintainAspectRatio: false, cutout: '60%', plugins: { legend: { position: 'bottom' } } },
      }) : h('p', { class: 'muted' }, '금액을 입력하면 비중이 표시됩니다.'))));
}

async function newPlan() {
  const v = await ask('새 포트폴리오 안', [{ key: 'name', label: '안 이름', value: `${M.today()} 투자안` }], '만들기');
  if (!v?.name) return;
  if (plans().includes(v.name)) return toast('이미 있는 이름입니다', 'err');
  const rows = S.data.portfolio.filter((r) => r.plan === S.plan).map((r, i) => ({ ...r, id: M.uid() + i, plan: v.name }));
  await guard(async () => { await S.be.putMany('portfolio', rows); S.data.portfolio.push(...rows); S.plan = v.name; render(); }, '새 안을 만들었습니다');
}
async function renamePlan() {
  const v = await ask('안 이름 변경', [{ key: 'name', label: '안 이름', value: S.plan }], '변경');
  if (!v?.name || v.name === S.plan) return;
  const rows = S.data.portfolio.filter((r) => r.plan === S.plan);
  rows.forEach((r) => { r.plan = v.name; });
  await guard(async () => { await S.be.putMany('portfolio', rows); S.plan = v.name; render(); });
}
async function deletePlan() {
  const rows = S.data.portfolio.filter((r) => r.plan === S.plan);
  if (!(await confirmBox('안 삭제', `"${S.plan}" 안(${rows.length}건)을 삭제할까요?`))) return;
  await guard(async () => {
    await S.be.removeMany('portfolio', rows.map((r) => r.id));
    S.data.portfolio = S.data.portfolio.filter((r) => !rows.includes(r));
    syncSelections(); render();
  }, '삭제했습니다');
}

// ---------- 페이지: 관리목표 ----------
function metricValue(metric, sum) {
  if (!sum) return '';
  return {
    부채비율: M.fmtPct(sum.debtRatio), 유동비율: M.fmtPct(sum.liquidity), 기대수익률: M.fmtPct(sum.expRate),
    안전자산비율: M.fmtPct(sum.safeRatio), 순자산: `${M.fmtEok(sum.net)}원`, 총자산: `${M.fmtEok(sum.total)}원`,
  }[metric] ?? '';
}

function pageGoals() {
  const sum = S.basis ? summary() : null;
  const rows = [...S.data.goals].sort((a, b) => M.num(a.order) - M.num(b.order));
  const cols = [
    { key: 'item', label: '항목', type: 'text', w: '110px' },
    { key: 'target', label: '목표', type: 'text', w: '130px' },
    { key: 'metric', label: '지표', type: 'select', options: () => METRICS, w: '110px' },
    { key: 'auto', label: '현재값(자동)', type: 'calc', fmt: (v) => v, calc: (r) => metricValue(r.metric, sum) },
    { key: 'status', label: '현 상황', type: 'text', w: '130px' },
    { key: 'strategy', label: '전략', type: 'text', w: '220px' },
    { key: 'progress', label: '진행', type: 'select', options: () => PROGRESS, w: '90px' },
  ];
  return h('div', { class: 'stack' },
    toolbar(btn('+ 항목 추가', () => addRow('goals', { item: '', target: '', metric: '없음', status: '', strategy: '', progress: '진행중' }, 'item'), 'primary'),
      !rows.length ? btn('엑셀 구조로 기본 항목 만들기', () => seed(['goals'])) : null,
      sum ? h('span', { class: 'muted' }, `현재값 기준일: ${S.basis}`) : null),
    card('중점 관리사항', grid({ cols, rows, coll: 'goals', label: (r) => r.item })),
    sum ? card('재무 안정성 지표',
      h('div', { class: 'kpis' },
        kpi('부채 / 총자산', M.fmtPct(sum.debtRatio)),
        kpi('부채 / 순자산', sum.net ? M.fmtPct(sum.debt / sum.net) : '—'),
        kpi('유동비율 (현금/총자산)', M.fmtPct(sum.liquidity)),
        kpi('안전자산비율 (Var+Fixed)', M.fmtPct(sum.safeRatio)),
        kpi('연이자 / 기대이익', sum.profit ? M.fmtPct(sum.interest / sum.profit) : '—'))) : null);
}

// ---------- 페이지: 설정 ----------
function pageSettings() {
  const fx = S.settings.fx;
  const fxTable = h('table', { class: 'grid compact' },
    h('thead', {}, h('tr', {}, h('th', {}, '통화'), h('th', { class: 'r' }, '원화 환율'), h('th', { class: 'act' }))),
    h('tbody', {}, Object.entries(fx).map(([cur, rate]) => h('tr', {},
      h('td', {}, h('b', {}, cur)),
      h('td', { class: 'r' }, cur === 'KRW' ? '1' : h('input', { class: 'num', value: M.fmtNum(rate, 6), inputmode: 'decimal', 'data-fid': `fx:${cur}`, onchange: (e) => { fx[cur] = M.num(e.target.value); saveSettings(); render(); } })),
      h('td', { class: 'act' }, cur === 'KRW' ? '' : h('button', { class: 'icon-btn', onclick: async () => {
        if (S.data.assets.some((a) => a.currency === cur)) return toast(`${cur} 를 사용하는 자산이 있어 삭제할 수 없습니다`, 'err');
        delete fx[cur]; await saveSettings(); render();
      } }, '✕'))))));
  const taxTable = h('table', { class: 'grid compact' },
    h('thead', {}, h('tr', {}, h('th', {}, '대분류'), h('th', {}, '그룹'), h('th', {}, '중분류 (쉼표로 구분)'), h('th', { class: 'act' }))),
    h('tbody', {}, S.settings.taxonomy.map((t, i) => h('tr', {},
      h('td', {}, h('input', { value: t.major, 'data-fid': `tx:${i}:major`, onchange: async (e) => {
        const old = t.major; t.major = e.target.value.trim();
        const rows = S.data.assets.filter((a) => a.major === old); rows.forEach((a) => { a.major = t.major; });
        await saveSettings(); if (rows.length) await guard(() => S.be.putMany('assets', rows)); render();
      } })),
      h('td', {}, select(['Var', 'Risk', 'Fixed'], t.group, async (v) => { t.group = v; await saveSettings(); render(); }, { placeholder: false })),
      h('td', {}, h('input', { value: t.mids.join(', '), 'data-fid': `tx:${i}:mids`, onchange: async (e) => { t.mids = e.target.value.split(',').map((s) => s.trim()).filter(Boolean); await saveSettings(); render(); } })),
      h('td', { class: 'act' }, h('button', { class: 'icon-btn', onclick: async () => {
        if (S.data.assets.some((a) => a.major === t.major)) return toast('이 대분류를 사용하는 자산이 있어 삭제할 수 없습니다', 'err');
        S.settings.taxonomy.splice(i, 1); await saveSettings(); render();
      } }, '✕'))))));

  return h('div', { class: 'stack' },
    h('div', { class: 'grid-2' },
      card('환율 (원화 환산)', fxTable, h('div', { class: 'row' }, btn('+ 통화 추가', async () => {
        const v = await ask('통화 추가', [{ key: 'c', label: '통화 코드 (예: GBP)' }, { key: 'r', label: '원화 환율', type: 'number' }], '추가');
        if (!v?.c) return;
        fx[v.c.toUpperCase()] = M.num(v.r); await saveSettings(); render();
      }))),
      card('분류체계', h('p', { class: 'muted small' }, 'Var = 현금성, Risk = 위험자산, Fixed = 고정수익/기타 (Main 시트의 구분)'), taxTable,
        h('div', { class: 'row' }, btn('+ 대분류 추가', async () => {
          const v = await ask('대분류 추가', [{ key: 'major', label: '대분류' }, { key: 'group', label: '그룹', type: 'select', options: ['Var', 'Risk', 'Fixed'], value: 'Risk' }, { key: 'mids', label: '중분류 (쉼표로 구분)' }], '추가');
          if (!v?.major) return;
          S.settings.taxonomy.push({ major: v.major, group: v.group, mids: v.mids.split(',').map((s) => s.trim()).filter(Boolean) });
          await saveSettings(); render();
        })))),
    card('엑셀',
      h('p', { class: 'muted' }, '현재 데이터를 엑셀로 내려받아 편집한 뒤 다시 업로드할 수 있습니다. 시트 구성: 자산(B.S) · 부채(D.L) · 현금흐름(C.F) · 연도별추이 · 포트폴리오 · 관리목표 · 환율 · 분류체계'),
      h('div', { class: 'row' }, btn('엑셀 다운로드', downloadExcel, 'primary'), btn('엑셀 업로드', pickUpload), btn('빈 양식 다운로드', downloadTemplate))),
    card('데이터',
      h('p', { class: 'muted' }, S.be.kind === 'firebase'
        ? `Firebase Firestore 에 저장 중 · ${S.user?.email || ''}`
        : '로컬 모드: 이 브라우저(localStorage)에만 저장됩니다. Firebase 설정 방법은 README.md 를 참고하세요.'),
      h('div', { class: 'row' },
        btn('비어있는 항목에 기본 구조 채우기', () => seed(COLLECTIONS)),
        btn('전체 데이터 초기화', resetAll, 'ghost-danger'))));
}

async function resetAll() {
  if (!(await confirmBox('전체 초기화', '모든 자산·부채·현금흐름·추이·포트폴리오·목표 데이터를 삭제합니다. 먼저 엑셀로 백업하는 것을 권장합니다. 계속할까요?', '전체 삭제'))) return;
  await guard(async () => {
    for (const c of COLLECTIONS) { await S.be.replace(c, []); S.data[c] = []; }
    syncSelections(); render();
  }, '초기화했습니다');
}

// ---------- 엑셀 ----------
function stampName(prefix) {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${prefix}_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}.xlsx`;
}

function downloadExcel() {
  if (!window.XLSX) return toast('엑셀 라이브러리를 불러오지 못했습니다', 'err');
  exportWorkbook(S.data, S.settings, stampName('자산관리'));
}

function downloadTemplate() {
  if (!window.XLSX) return toast('엑셀 라이브러리를 불러오지 못했습니다', 'err');
  const data = Object.fromEntries(COLLECTIONS.map((c) => [c, templateRows(c)]));
  exportWorkbook(data, S.settings, '자산관리_양식.xlsx');
}

function pickUpload() {
  const input = h('input', { type: 'file', accept: '.xlsx,.xls', onchange: async () => {
    const f = input.files[0];
    if (f) await handleUpload(await f.arrayBuffer(), f.name);
  } });
  input.click();
}

async function handleUpload(buffer, name = '업로드 파일') {
  if (!window.XLSX) return toast('엑셀 라이브러리를 불러오지 못했습니다', 'err');
  let parsed;
  try { parsed = parseWorkbook(buffer); } catch (e) { console.error(e); return toast(`엑셀을 읽지 못했습니다: ${e.message}`, 'err'); }
  if (!parsed.counts.length) {
    return modal({ title: '인식할 수 있는 시트가 없습니다', body: h('p', {}, `이 플랫폼의 양식(자산(B.S), 부채(D.L) 등 시트)이 아닙니다. "빈 양식 다운로드" 로 받은 파일 형식에 맞춰 업로드하세요. 파일의 시트: ${parsed.unknown.join(', ')}`), okText: '닫기', cancelText: null });
  }
  let mode = 'replace';
  const body = h('div', {},
    h('p', {}, h('b', {}, name)),
    h('table', { class: 'grid compact' },
      h('thead', {}, h('tr', {}, h('th', {}, '시트'), h('th', { class: 'r' }, '행 수'), h('th', {}, '비고'))),
      h('tbody', {}, parsed.counts.map((c) => h('tr', {}, h('td', {}, c.sheet), h('td', { class: 'r' }, c.rows),
        h('td', { class: c.missing.length ? 'warn' : 'muted' }, c.missing.length ? `없는 열: ${c.missing.join(', ')}` : '정상'))))),
    parsed.unknown.length ? h('p', { class: 'muted small' }, `무시되는 시트: ${parsed.unknown.join(', ')}`) : null,
    h('div', { class: 'radio-group' },
      h('label', {}, h('input', { type: 'radio', name: 'mode', checked: true, onchange: () => { mode = 'replace'; } }),
        h('span', {}, h('b', {}, '교체'), ' — 파일에 있는 시트의 데이터로 전부 바꿉니다 (엑셀이 원본일 때)')),
      h('label', {}, h('input', { type: 'radio', name: 'mode', onchange: () => { mode = 'merge'; } }),
        h('span', {}, h('b', {}, '병합'), ' — ID 가 같은 행은 수정, 새 행은 추가, 기존 행은 유지'))));
  if (!(await modal({ title: '엑셀 업로드', body, okText: '가져오기', wide: true }))) return;
  await guard(async () => {
    for (const [c, rows] of Object.entries(parsed.collections)) {
      if (mode === 'replace') await S.be.replace(c, rows);
      else await S.be.putMany(c, rows);
    }
    if (Object.keys(parsed.settings).length) {
      Object.assign(S.settings, parsed.settings);
      await S.be.saveSettings(S.settings);
    }
    await reload();
    render();
  }, '엑셀 데이터를 가져왔습니다');
}
// 디버깅/테스트용: 콘솔에서 ArrayBuffer 로 업로드 흐름 실행
window.__assetApp = { handleUpload, state: S };

// ---------- 렌더 ----------
const PAGE_FN = { dashboard: pageDashboard, assets: pageAssets, liabilities: pageLiabilities, cashflow: pageCashflow, history: pageHistory, portfolio: pagePortfolio, goals: pageGoals, settings: pageSettings };

function render() {
  const main = $('#main');
  const fid = S.focusFid || document.activeElement?.dataset?.fid;
  const scrolls = [...main.querySelectorAll('.table-wrap')].map((el) => el.scrollLeft);
  S.charts.forEach((c) => c.destroy());
  S.charts = [];
  S.pendingCharts = [];
  if (window.Chart) {
    Chart.defaults.color = cssVar('--muted');
    Chart.defaults.borderColor = cssVar('--line');
    Chart.defaults.font.family = cssVar('--font');
  }
  const title = PAGES.find((p) => p[0] === S.page)?.[1] || '';
  $('#page-title').textContent = title;
  document.querySelectorAll('#nav button').forEach((b) => b.classList.toggle('active', b.dataset.page === S.page));
  main.replaceChildren(PAGE_FN[S.page]());
  main.querySelectorAll('.table-wrap').forEach((el, i) => { if (scrolls[i]) el.scrollLeft = scrolls[i]; });
  S.pendingCharts.forEach((fn) => fn());
  if (fid) {
    const el = main.querySelector(`[data-fid="${CSS.escape(fid)}"]`);
    if (el) { el.focus({ preventScroll: true }); if (S.focusFid) el.select?.(); }
  }
  S.focusFid = null;
}

function buildShell() {
  $('#nav').replaceChildren(...PAGES.map(([id, label, icon]) =>
    h('button', { 'data-page': id, onclick: () => { S.page = id; render(); window.scrollTo(0, 0); } }, h('span', { class: 'ico' }, icon), h('span', {}, label))));
  $('#mode').textContent = S.be.kind === 'firebase' ? 'Firebase' : '로컬 모드';
  $('#mode').className = `badge ${S.be.kind === 'firebase' ? 'ok' : 'warn'}`;
  $('#btn-down').onclick = downloadExcel;
  $('#btn-up').onclick = pickUpload;
  $('#user').replaceChildren(S.user
    ? h('span', { class: 'user' }, h('span', { class: 'muted' }, S.user.email || S.user.displayName || ''), btn('로그아웃', () => S.be.signOut(), 'small'))
    : '');
}

function showLogin() {
  $('#app').hidden = true;
  const login = $('#login');
  login.hidden = false;
  const email = h('input', { type: 'email', placeholder: '이메일', autocomplete: 'username' });
  const pw = h('input', { type: 'password', placeholder: '비밀번호 (6자 이상)', autocomplete: 'current-password' });
  const err = h('p', { class: 'err' });
  const run = (fn) => async () => { err.textContent = ''; try { await fn(); } catch (e) { err.textContent = authMessage(e); } };
  login.replaceChildren(h('div', { class: 'login-card' },
    h('div', { class: 'logo' }, '₩'),
    h('h1', {}, '자산관리'),
    h('p', { class: 'muted' }, '개인 자산현황 · 부채 · 현금흐름 관리'),
    btn('Google 계정으로 로그인', run(() => S.be.signInGoogle()), 'primary block'),
    h('div', { class: 'sep' }, '또는'),
    email, pw,
    h('div', { class: 'row' }, btn('이메일 로그인', run(() => S.be.signInEmail(email.value, pw.value)), 'block'), btn('회원가입', run(() => S.be.signUpEmail(email.value, pw.value)), 'block')),
    err));
}

function authMessage(e) {
  const m = {
    'auth/invalid-credential': '이메일 또는 비밀번호가 올바르지 않습니다.',
    'auth/invalid-email': '이메일 형식이 올바르지 않습니다.',
    'auth/email-already-in-use': '이미 가입된 이메일입니다.',
    'auth/weak-password': '비밀번호는 6자 이상이어야 합니다.',
    'auth/operation-not-allowed': 'Firebase 콘솔에서 해당 로그인 방식을 사용 설정하세요.',
    'auth/popup-closed-by-user': '로그인 창이 닫혔습니다.',
    'auth/unauthorized-domain': '이 도메인이 Firebase 인증의 승인된 도메인에 없습니다.',
  };
  return m[e.code] || e.message;
}

async function start() {
  $('#app').hidden = true;
  try {
    S.be = await createBackend();
  } catch (e) {
    console.error(e);
    $('#boot').textContent = `Firebase 초기화 실패: ${e.message}`;
    return;
  }
  const enter = async () => {
    $('#boot').hidden = false;
    $('#boot').textContent = '데이터 불러오는 중…';
    try { await reload(); } catch (e) { console.error(e); toast(`데이터를 불러오지 못했습니다: ${e.message}`, 'err'); }
    $('#boot').hidden = true;
    $('#login').hidden = true;
    $('#app').hidden = false;
    buildShell();
    render();
  };
  if (S.be.kind === 'firebase') {
    S.be.onAuth((user) => {
      S.user = user;
      $('#boot').hidden = true;
      if (user) enter(); else showLogin();
    });
  } else {
    await enter();
  }
}

matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (!$('#app').hidden) render(); });
start();

export { isFirebaseConfigured };
