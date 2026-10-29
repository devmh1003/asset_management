import { createBackend, isFirebaseConfigured, COLLECTIONS } from './store.js';
import * as M from './model.js';
import { exportWorkbook, parseWorkbook } from './excel.js';
import { fetchRates, isStale } from './fx.js';

const S = {
  be: null,
  user: null,
  data: Object.fromEntries(COLLECTIONS.map((c) => [c, []])),
  settings: structuredClone(M.DEFAULT_SETTINGS),
  page: 'dashboard',
  basis: null,
  cfYear: null,
  kpiYear: null,
  plan: null,
  charts: [],
  pendingCharts: [],
  focusFid: null,
  fxBusy: false,
  // 관리자
  admin: false,
  viewing: null,      // 관리자가 열람 중인 사용자 프로필
  readOnly: false,
  profiles: null,
  admins: null,
  // 그리드 상태
  sort: {},           // { [tableKey]: { key, dir } }
  filter: '',
};
const BOOTSTRAP_ADMINS = ['devmh1003@gmail.com'];
const THEME_KEY = 'asset-theme';

const PAGES = [
  ['dashboard', '대시보드', '◎'],
  ['assets', '자산', '▤'],
  ['liabilities', '부채', '▼'],
  ['cashflow', '현금흐름', '⇅'],
  ['kpi', 'KPI', '◎'],
  ['history', '연도별 추이', '↗'],
  ['portfolio', '포트폴리오', '◔'],
  ['simulate', '시뮬레이션', '∿'],
  ['settings', '설정', '⚙'],
  ['admin', '관리자', '★'],
];
const PAGE_TITLE = { dashboard: '대시보드', assets: '자산 (Balance Sheet)', liabilities: '부채 (Debt & Liability)', cashflow: '현금흐름 (Cash Flow)', kpi: '핵심 KPI', history: '연도별 추이', portfolio: '포트폴리오', simulate: '시뮬레이션', settings: '설정', admin: '관리자' };

const PALETTE = ['#3b6ff0', '#17a883', '#f39c3d', '#8e5cf0', '#e5484d', '#38bdf8', '#c6b42c', '#9a7b6a', '#ec6fb2', '#64748b'];
const RATINGS = ['매우좋음', '긍정', '보통', '나쁨', '매우나쁨'];
const PROGRESS = ['진행중', '완료', '지속', '보류'];

// ---------- DOM helpers ----------
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') for (const [sk, sv] of Object.entries(v)) { if (sv == null) continue; sk.startsWith('--') ? el.style.setProperty(sk, sv) : (el.style[sk] = sv); }
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
  setTimeout(() => t.classList.add('out'), 2800);
  setTimeout(() => t.remove(), 3200);
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
  body.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.tagName !== 'SELECT') body.closest('.modal').querySelector('.btn.primary').click(); });
  const ok = await modal({ title, body, okText });
  if (!ok) return null;
  return Object.fromEntries(Object.entries(inputs).map(([k, el]) => [k, el.type === 'checkbox' ? el.checked : el.value.trim()]));
}

const confirmBox = (title, text, okText = '삭제') => modal({ title, body: h('p', {}, text), okText, danger: true });

// ---------- 데이터 조작 ----------
async function guard(fn, okMsg) {
  if (S.readOnly) { toast('읽기 전용 열람 모드입니다', 'err'); return; }
  try { await fn(); if (okMsg) toast(okMsg); }
  catch (e) { console.error(e); toast(`저장 실패: ${e.message || e}`, 'err'); }
}

// 행 순서 이동 / 복제 (order 값 교환)
async function moveRow(coll, rows, idx, dir) {
  const a = rows[idx], b = rows[idx + dir];
  if (!a || !b) return;
  let oa = M.num(a.order), ob = M.num(b.order);
  if (oa === ob) { ob = oa + dir; }
  a.order = ob; b.order = oa;
  S.focusFid = document.activeElement?.dataset?.fid || null;
  render();
  await guard(() => S.be.putMany(coll, [a, b]));
}
async function duplicateRow(coll, row) {
  const copy = { ...structuredClone(row), id: M.uid(), order: M.num(row.order) + 0.5 };
  if (copy.name !== undefined) copy.name = `${copy.name} (복사)`;
  S.data[coll].push(copy);
  render();
  await saveRow(coll, copy);
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
  // 추천 분류 템플릿(관리자 편집본 또는 기본값)을 기존 설정에 비파괴적으로 병합
  try { S.taxTemplate = (await S.be.getTaxonomyTemplate()) || null; } catch { S.taxTemplate = null; }
  const merged = M.mergeTaxonomy(S.settings.taxonomy, S.taxTemplate || M.DEFAULT_TAXONOMY);
  S.settings.taxonomy = merged.taxonomy;
  if (!all.settings || merged.changed) await S.be.saveSettings(S.settings);
  syncSelections();
}

function syncSelections() {
  const bs = M.bases(S.data.assets);
  if (!bs.includes(S.basis)) S.basis = bs[bs.length - 1] || null;
  const ys = cfYears();
  if (!ys.includes(S.cfYear)) S.cfYear = ys.includes(thisYear()) ? thisYear() : ys[ys.length - 1] ?? null;
  const ks = kpiYears();
  if (!ks.includes(S.kpiYear)) S.kpiYear = ks.includes(thisYear()) ? thisYear() : ks[ks.length - 1] ?? null;
  const ps = plans();
  if (!ps.includes(S.plan)) S.plan = ps[0] ?? null;
}

const thisYear = () => new Date().getFullYear();
const cfYears = () => [...new Set(S.data.cashflow.map((r) => M.num(r.year)))].sort();
const kpiYears = () => [...new Set(S.data.kpis.map((r) => M.num(r.year)))].sort();
const plans = () => [...new Set(S.data.portfolio.map((r) => r.plan).filter(Boolean))].sort();
const basisAssets = (b = S.basis) => S.data.assets.filter((a) => a.basis === b);
const summary = (b = S.basis) => M.summarize(basisAssets(b), S.data.liabilities, S.settings);
const kpiCtx = () => ({ assets: S.data.assets, liabilities: S.data.liabilities, cashflow: S.data.cashflow, settings: S.settings });

function templateRows(coll, { basis = M.today(), year = thisYear(), plan = '기본안' } = {}) {
  const stamp = (rows) => rows.map((r, i) => ({ ...structuredClone(r), id: M.uid() + i, order: i }));
  switch (coll) {
    case 'assets': return stamp(M.TEMPLATE_ASSETS).map((r) => ({ ...r, basis }));
    case 'liabilities': return stamp(M.TEMPLATE_LIABILITIES);
    case 'cashflow': return stamp(M.TEMPLATE_CASHFLOW).map((r) => ({ ...r, year }));
    case 'portfolio': return stamp(M.TEMPLATE_PORTFOLIO).map((r) => ({ ...r, plan }));
    case 'goals': return stamp(M.TEMPLATE_GOALS);
    case 'kpis': return stamp(M.TEMPLATE_KPIS(year));
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
  }, '기본 항목을 만들었습니다');
}

// ---------- 환율 ----------
async function refreshFx({ silent = false } = {}) {
  if (S.fxBusy) return;
  S.fxBusy = true;
  try {
    const codes = Object.keys(S.settings.fx);
    const { rates, updatedAt } = await fetchRates(codes);
    const missing = codes.filter((c) => !(c in rates));
    Object.assign(S.settings.fx, rates);
    S.settings.fxUpdatedAt = updatedAt;
    await S.be.saveSettings(S.settings);
    if (!silent) toast(`환율을 갱신했습니다${missing.length ? ` (미지원: ${missing.join(', ')})` : ''}`);
  } catch (e) {
    console.warn('환율 갱신 실패', e);
    if (!silent) toast(`환율 갱신 실패: ${e.message}`, 'err');
  } finally {
    S.fxBusy = false;
    render();
  }
}

const fxStamp = () => (S.settings.fxUpdatedAt ? new Date(S.settings.fxUpdatedAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '수동');

// ---------- 편집 그리드 ----------
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
    if (c.type === 'num' && c.amount) {
      // "1.2억", "500만", "$1,000" 등 자연어 금액 파싱 + 통화 힌트
      const p = M.parseAmount(val);
      v = val === '' ? 0 : p.value;
      if (p.currency && c.amount.currencyKey && row[c.amount.currencyKey] !== p.currency) { row[c.amount.currencyKey] = p.currency; toast(`통화를 ${p.currency} 로 설정했습니다`); }
    } else if (c.type === 'num') v = val === '' ? (c.nullable ? null : 0) : M.num(val);
    if (c.type === 'pct') v = val === '' ? (c.nullable ? null : 0) : M.num(val) / 100;
    if (c.set) c.set(row, v); else row[c.key] = v;
    c.after?.(row);
    saveRow(coll, row);
    setTimeout(render, 0);
  };
  if (c.type === 'select') return select(c.options(row), raw, commit, { 'data-fid': fid });
  let display = raw ?? '';
  if (c.type === 'num') display = raw === '' || raw == null ? '' : M.fmtNum(raw, 6);
  if (c.type === 'pct') display = raw === '' || raw == null ? '' : String(+(M.num(raw) * 100).toFixed(4));
  const neg = (c.type === 'num' || c.type === 'pct') && M.num(raw) < 0;
  const input = h('input', {
    type: c.type === 'date' ? 'date' : 'text',
    value: display,
    placeholder: c.placeholder || null,
    list: c.list || null,
    autocomplete: c.list ? 'off' : null,
    'data-fid': fid,
    class: `${c.type} ${neg ? 'neg' : ''}`,
    inputmode: c.type === 'num' || c.type === 'pct' ? 'decimal' : null,
    onchange: (e) => commit(e.target.value),
    onkeydown: (e) => { if (e.key === 'Enter') e.target.blur(); },
  });
  return c.type === 'pct' ? h('span', { class: 'pct-wrap' }, input, h('i', {}, '%')) : input;
}

// 엑셀처럼: 헤더 클릭 정렬, Enter/↑↓ 로 행 이동, 행 순서 이동·복제, 대분류 색상, 비중 데이터바
function grid({ cols, rows, coll, foot = [], label, rowClass, rowColor, sticky = true, tableKey = coll, reorder = true }) {
  const isNum = (c) => ['num', 'pct'].includes(c.type) || (c.type === 'calc');
  const sort = S.sort[tableKey];
  let view = rows;
  if (sort) {
    const c = cols.find((x) => x.key === sort.key);
    if (c) {
      const val = (r) => (c.type === 'calc' ? c.calc(r) : c.get ? c.get(r) : r[c.key]);
      view = [...rows].sort((a, b) => {
        const va = val(a), vb = val(b);
        const na = typeof va === 'number', nb = typeof vb === 'number';
        const cmp = na && nb ? va - vb : String(va ?? '').localeCompare(String(vb ?? ''), 'ko');
        return sort.dir === 'asc' ? cmp : -cmp;
      });
    }
  }
  const canReorder = reorder && !sort;
  const cellValue = (c, r) => (c.type === 'calc' ? c.calc(r) : null);
  const onKey = (e) => {
    const t = e.target;
    if (!t.dataset?.fid || t.tagName !== 'INPUT') return;
    if (!['Enter', 'ArrowDown', 'ArrowUp'].includes(e.key)) return;
    const tr = t.closest('tr');
    const key = t.dataset.fid.split(':').slice(1).join(':');
    const next = e.key === 'ArrowUp' ? tr.previousElementSibling : tr.nextElementSibling;
    if (e.key === 'Enter') t.blur();
    const target = next?.querySelector(`[data-fid$=":${CSS.escape(key)}"]`);
    if (target) { e.preventDefault(); S.focusFid = target.dataset.fid; setTimeout(() => { const el = document.querySelector(`[data-fid="${CSS.escape(target.dataset.fid)}"]`); el?.focus(); el?.select?.(); S.focusFid = null; }, 0); }
  };
  return h('div', { class: 'table-wrap' },
    h('table', { class: `grid ${sticky ? 'sticky-first' : ''}` },
      h('thead', {}, h('tr', {}, cols.map((c) => h('th', {
        class: `${isNum(c) ? 'r' : ''} ${c.type !== 'custom' ? 'sortable' : ''}`, style: c.w ? { minWidth: c.w } : null, title: c.type !== 'custom' ? '클릭하여 정렬' : null,
        onclick: c.type === 'custom' ? null : () => { const cur = S.sort[tableKey]; S.sort[tableKey] = cur?.key === c.key ? (cur.dir === 'asc' ? { key: c.key, dir: 'desc' } : null) : { key: c.key, dir: 'asc' }; render(); },
      }, c.label, sort?.key === c.key ? h('span', { class: 'sort-ind' }, sort.dir === 'asc' ? '▲' : '▼') : null)), h('th', { class: 'act' }))),
      h('tbody', { onkeydown: onKey }, view.length ? view.map((r, i) => h('tr', { class: rowClass?.(r) || '', style: rowColor ? { '--row-c': rowColor(r) } : null },
        cols.map((c) => {
          const v = cellValue(c, r);
          const databar = c.databar && typeof v === 'number' && v > 0;
          return h('td', { class: `${isNum(c) ? 'r' : ''} ${c.type === 'calc' ? 'calc' : ''} ${c.cls?.(r) || ''} ${databar ? 'databar' : ''}`, style: databar ? { '--w': Math.min(1, v / (c.databarMax || 1)) } : null },
            c.type === 'calc' ? fmtCalc(c, v) : c.type === 'custom' ? c.render(r) : cellEditor(c, r, coll));
        }),
        h('td', { class: 'act' }, h('span', { class: 'row-tools' },
          canReorder ? h('button', { class: 'icon-btn', title: '위로', disabled: i === 0, onclick: () => moveRow(coll, view, i, -1) }, '↑') : null,
          canReorder ? h('button', { class: 'icon-btn', title: '아래로', disabled: i === view.length - 1, onclick: () => moveRow(coll, view, i, 1) }, '↓') : null,
          h('button', { class: 'icon-btn', title: '복제', onclick: () => duplicateRow(coll, r) }, '⧉'),
          h('button', { class: 'icon-btn del', title: '삭제', onclick: () => removeRow(coll, r, label?.(r)) }, '✕')))))
        : h('tr', {}, h('td', { class: 'empty', colspan: cols.length + 1 }, '항목이 없습니다. “+ 항목 추가” 로 추가하세요.'))),
      foot.length ? h('tfoot', {}, foot.map((f) => h('tr', { class: f.cls || '' },
        f.cells.map((v, i) => h('td', { class: cols[i] && isNum(cols[i]) ? 'r' : '' }, v ?? '')), h('td', {})))) : null));
}

function searchBox() {
  return h('label', { class: 'search' }, '🔍', h('input', { type: 'search', placeholder: '검색 (이름·분류·메모)', value: S.filter, 'data-fid': 'search', oninput: (e) => { S.filter = e.target.value; S.focusFid = 'search'; render(); } }));
}
const matchFilter = (r, keys) => !S.filter || keys.some((k) => String(r[k] ?? '').toLowerCase().includes(S.filter.toLowerCase()));

// ---------- 공통 UI ----------
const kpi = (label, value, sub, tone) => h('div', { class: `kpi ${tone || ''}` }, h('div', { class: 'kpi-label' }, label), h('div', { class: 'kpi-value' }, value), sub ? h('div', { class: 'kpi-sub' }, sub) : null);
const card = (title, ...kids) => h('section', { class: 'card' }, title ? (typeof title === 'string' ? h('h2', {}, title) : title) : null, ...kids);
const cardHead = (title, sub, right) => h('div', { class: 'card-head' }, h('div', {}, h('h2', {}, title), sub ? h('p', { class: 'muted small' }, sub) : null), right || null);
const toolbar = (...kids) => h('div', { class: 'toolbar' }, ...kids);
const btn = (text, onclick, cls = '', props = {}) => h('button', { class: `btn ${cls}`, onclick, ...props }, text);
const diff = (cur, prev) => {
  if (prev == null) return null;
  const d = cur - prev;
  const r = prev ? d / Math.abs(prev) : 0;
  return h('span', { class: d >= 0 ? 'up' : 'down' }, `${d >= 0 ? '▲' : '▼'} ${M.fmtEok(Math.abs(d))} (${M.fmtPct(r)})`);
};

function chart(canvasId, config, height) {
  S.pendingCharts.push(() => {
    const el = document.getElementById(canvasId);
    if (!el || !window.Chart) return;
    S.charts.push(new Chart(el, config));
  });
  return h('div', { class: 'chart-box', style: height ? { height } : null }, h('canvas', { id: canvasId }));
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

function yearSelect(years, value, onchange) {
  return select(years.map(String), String(value), (v) => onchange(Number(v)), { placeholder: false });
}

const achvChip = (a) => {
  if (a == null) return h('span', { class: 'chip-s muted' }, '—');
  const cls = a >= 1 ? 'ok' : a >= 0.8 ? 'warn' : 'bad';
  return h('span', { class: `chip-s ${cls}` }, M.fmtPct(Math.min(a, 9.99), 0));
};

// ---------- 페이지: 대시보드 ----------
function pageDashboard() {
  const allEmpty = COLLECTIONS.every((c) => !S.data[c].length);
  if (allEmpty) {
    return card('시작하기',
      h('p', { class: 'muted' }, '아직 데이터가 없습니다. 기존 엑셀(개인자산현황)의 구조로 기본 항목을 만들거나, 엑셀 파일을 업로드해 시작하세요. 금액은 모두 0 으로 생성되니 실제 값만 입력하면 됩니다.'),
      h('div', { class: 'row' },
        btn('엑셀 구조로 기본 항목 만들기', () => seed(COLLECTIONS), 'primary'),
        btn('빈 엑셀 양식 다운로드', downloadTemplate),
        btn('엑셀 업로드', pickUpload)));
  }
  if (!S.basis) return card('대시보드', emptyState('자산 데이터가 없습니다.', [btn('자산 기본 항목 만들기', () => seed(['assets']), 'primary')]));

  const bs = M.bases(S.data.assets);
  const idx = bs.indexOf(S.basis);
  const sum = summary();
  const prev = idx > 0 ? summary(bs[idx - 1]) : null;
  const year = Number(S.basis.slice(0, 4));
  const hist = [...S.data.history].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const majors = Object.entries(sum.byMajor).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const kpis = S.data.kpis.filter((k) => M.num(k.year) === year).sort((a, b) => M.num(a.order) - M.num(b.order));
  const q = M.quarterOf(S.basis);

  return h('div', { class: 'stack' },
    toolbar(basisSelect(), prev ? h('span', { class: 'muted small' }, `전 기준일 ${bs[idx - 1]} 대비`) : null,
      h('span', { class: 'spacer' }), h('span', { class: 'muted small' }, `환율 ${fxStamp()}`)),
    h('section', { class: 'hero' },
      h('div', { class: 'hero-main' },
        h('div', { class: 'kpi-label' }, '순자산'),
        h('div', { class: 'hero-value' }, M.fmtKRW(sum.net), h('small', {}, '원')),
        h('div', { class: 'hero-sub' }, diff(sum.net, prev?.net) || h('span', { class: 'muted' }, M.fmtEok(sum.net)))),
      h('div', { class: 'hero-grid' },
        heroStat('총자산', `${M.fmtEok(sum.total)}원`, diff(sum.total, prev?.total)),
        heroStat('총부채', `${M.fmtEok(sum.debt)}원`, `연이자 ${M.fmtEok(sum.interest)}원`),
        heroStat('부채비율', M.fmtPct(sum.debtRatio), `유동비율 ${M.fmtPct(sum.liquidity)}`),
        heroStat('기대수익률', M.fmtPct(sum.expRate), `기대이익 ${M.fmtEok(sum.profit)}원`))),
    insightsRow(sum, year, q, bs),
    h('div', { class: 'grid-2 wide-left' },
      card(cardHead('자산 변동 이력', '기준일별 대분류 구성 (원화 환산)'), bs.length > 1 ? chart('c-trend', trendChartConfig(bs), '300px') : h('p', { class: 'muted' }, '기준일이 2개 이상이면 추이가 표시됩니다. 자산 페이지에서 “새 기준일로 복사” 하세요.')),
      card(cardHead('자산 구성', S.basis), majors.length ? h('div', { class: 'donut-wrap' }, chart('c-major', {
        type: 'doughnut',
        data: { labels: majors.map(([k]) => k), datasets: [{ data: majors.map(([, v]) => Math.round(v)), backgroundColor: majors.map(([k]) => colorOf(k)), borderWidth: 0, hoverOffset: 6 }] },
        options: { maintainAspectRatio: false, cutout: '68%', plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ` ${c.label}: ${M.fmtKRW(c.raw)}원 (${M.fmtPct(c.raw / sum.total)})` } } } },
      }, '200px'), h('ul', { class: 'legend' }, majors.map(([k, v]) => h('li', {}, h('i', { style: { background: colorOf(k) } }), h('span', {}, k), h('b', {}, M.fmtPct(v / sum.total)))))) : h('p', { class: 'muted' }, '공정가치를 입력하면 비중이 표시됩니다.'))),
    h('div', { class: 'grid-2' },
      card(cardHead(`${year}년 핵심 KPI`, `${q}분기 기준 · 자동 계산`, btn('KPI 관리 →', () => go('kpi'), 'small')),
        kpis.length ? h('div', { class: 'kpi-list' }, kpis.map((k) => {
          const { value } = M.kpiValue(k, q, kpiCtx());
          const a = M.achievement(k, value);
          const info = M.metricInfo(k.metric);
          return h('div', { class: 'kpi-row' },
            h('div', { class: 'kpi-row-head' }, h('b', {}, k.name), h('span', {}, M.fmtUnit(value, info.unit), h('span', { class: 'muted' }, ` / ${M.fmtUnit(k.target, info.unit)}`)), achvChip(a)),
            h('div', { class: 'bar' }, h('i', { class: a == null ? '' : a >= 1 ? 'ok' : a >= 0.8 ? 'warn' : 'bad', style: { width: `${Math.min(100, (a || 0) * 100)}%` } })));
        })) : emptyState(`${year}년 KPI 가 없습니다.`, [btn('기본 KPI 만들기', () => seedKpis(year), 'primary small')])),
      card(cardHead('그룹별 구성', 'Var 현금성 · Risk 위험자산 · Fixed 고정수익/안전'), h('div', { class: 'group-bars' }, [['Var', '현금성'], ['Risk', '위험자산'], ['Fixed', '고정수익·안전']].map(([g, label], i) => {
        const v = sum.byGroup[g] || 0;
        const r = sum.total ? v / sum.total : 0;
        return h('div', { class: 'gbar' },
          h('div', { class: 'gbar-head' }, h('b', {}, g, h('span', { class: 'muted' }, ` ${label}`)), h('span', {}, `${M.fmtEok(v)} · ${M.fmtPct(r)}`)),
          h('div', { class: 'bar' }, h('i', { style: { width: `${r * 100}%`, background: PALETTE[i] } })),
          h('small', { class: 'muted' }, S.settings.taxonomy.filter((t) => t.group === g).map((t) => t.major).join(' · ')));
      })))),
    card(cardHead(`${year}년 기준일별 자산 비중`, '분기별 Balance Sheet 비교'), quarterTable(String(year))),
    h('div', { class: 'grid-2' },
      card(cardHead('연도별 순자산 추이', '연도별 추이 페이지의 기록'), hist.length ? chart('c-hist', historyChartConfig(hist)) : h('p', { class: 'muted' }, '연도별 추이 페이지에서 기록을 추가하세요.')),
      card(cardHead(`${S.cfYear ?? ''} 현금흐름`, '단위: 만원'), S.cfYear != null ? chart('c-cf', cashflowChartConfig()) : h('p', { class: 'muted' }, '현금흐름 데이터가 없습니다.'))));
}

// 인사이트: 연말 예상 순자산(현금흐름 + 기대이익 비례), 분기 스냅샷 안내, 부채 만기
function insightsRow(sum, year, q, bs) {
  const items = [];
  const now = new Date();
  const curY = now.getFullYear(), curQ = Math.ceil((now.getMonth() + 1) / 3);
  // 연말 예상: 남은 달 평균 순이익(만원) + 기대이익 × 남은 비율
  const cfRows = S.data.cashflow.filter((r) => M.num(r.year) === year);
  if (cfRows.length && year === curY) {
    const cf = M.cashflowSummary(cfRows);
    const m = now.getMonth(); // 0-based, 이번 달 포함 남은 달 = 12 - m
    const remainNet = cf.net.slice(m).reduce((a, b) => a + b, 0) * 10000;
    const remainProfit = sum.profit * ((12 - m) / 12);
    const est = sum.net + remainNet + remainProfit;
    items.push(kpi(`${year}년 연말 예상 순자산`, `${M.fmtEok(est)}원`, `현재 + 남은 현금흐름 ${M.fmtEok(remainNet)} + 기대이익 ${M.fmtEok(remainProfit)}`));
  }
  // 이번 분기 스냅샷 없음 → 안내
  if (year === curY || bs[bs.length - 1] < M.quarterEnd(curY, curQ)) {
    const hasQ = bs.some((b) => b.startsWith(String(curY)) && M.quarterOf(b) === curQ);
    if (!hasQ) items.push(h('div', { class: 'kpi' }, h('div', { class: 'kpi-label' }, `${curY}년 ${curQ}분기 스냅샷`), h('div', { class: 'kpi-value', style: { fontSize: '15px' } }, '아직 기준일이 없습니다'), h('div', { class: 'kpi-sub' }, btn('현재 자산으로 분기 기준일 만들기', () => { go('assets'); newBasis(); }, 'small link'))));
  }
  // 90일 내 만기 부채
  const soon = S.data.liabilities.filter((l) => l.maturity && (new Date(l.maturity) - now) / 86400e3 <= 90 && new Date(l.maturity) >= now);
  if (soon.length) items.push(kpi('90일 내 만기 부채', `${soon.length}건 · ${M.fmtEok(soon.reduce((s, l) => s + M.num(l.amount), 0))}원`, soon.map((l) => `${l.creditor} ${l.maturity}`).join(', ')));
  // 위험자산 경고
  if (sum.riskRatio > 0.6) items.push(kpi('위험자산 비중 높음', M.fmtPct(sum.riskRatio), 'Risk 그룹이 총자산의 60% 를 넘습니다'));
  return items.length ? h('div', { class: 'kpis' }, items) : null;
}

const heroStat = (label, value, sub) => h('div', { class: 'hero-stat' }, h('div', { class: 'kpi-label' }, label), h('div', { class: 'hero-stat-value' }, value), sub ? h('div', { class: 'kpi-sub' }, sub) : null);

function colorOf(major) {
  const i = S.settings.taxonomy.findIndex((t) => t.major === major);
  return PALETTE[(i < 0 ? 9 : i) % PALETTE.length];
}

function trendChartConfig(bs) {
  const sums = bs.map((b) => summary(b));
  const majors = S.settings.taxonomy.map((t) => t.major).filter((m) => sums.some((s) => (s.byMajor[m] || 0) > 0));
  return {
    type: 'bar',
    data: {
      labels: bs,
      datasets: [
        ...majors.map((m) => ({ label: m, data: sums.map((s) => Math.round(s.byMajor[m] || 0)), backgroundColor: colorOf(m), stack: 'a', borderRadius: 2, borderSkipped: false })),
        { type: 'line', label: '순자산', data: sums.map((s) => Math.round(s.net)), borderColor: cssVar('--text'), backgroundColor: cssVar('--text'), borderWidth: 2, pointRadius: 3, tension: 0.25, order: -1 },
      ],
    },
    options: {
      maintainAspectRatio: false, animation: false, interaction: { mode: 'index', intersect: false },
      scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, ticks: { callback: (v) => M.fmtEok(v) }, grid: { color: cssVar('--line') } } },
      plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, boxHeight: 10, usePointStyle: true, pointStyle: 'rectRounded' } }, tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${M.fmtKRW(c.raw)}원` } } },
    },
  };
}

function quarterTable(year) {
  const bs = M.bases(S.data.assets).filter((b) => b.startsWith(year));
  const sums = bs.map((b) => summary(b));
  const rows = [];
  const seen = new Set();
  for (const t of S.settings.taxonomy) for (const m of t.mids) {
    const k = `${t.major}|${m}`;
    if (sums.some((s) => s.byMid[k])) { rows.push([t.group, t.major, m]); seen.add(k); }
  }
  for (const a of S.data.assets) {
    const k = `${a.major}|${a.mid}`;
    if (!seen.has(k) && bs.includes(a.basis)) { seen.add(k); rows.push(['-', a.major, a.mid]); }
  }
  if (!rows.length) return h('p', { class: 'muted' }, '금액을 입력하면 비중이 표시됩니다.');
  return h('div', { class: 'table-wrap' }, h('table', { class: 'grid compact' },
    h('thead', {}, h('tr', {}, h('th', {}, '그룹'), h('th', {}, '대분류'), h('th', {}, '중분류'),
      bs.map((b) => [h('th', { class: 'r' }, `${M.quarterOf(b)}Q · ${b.slice(5)}`), h('th', { class: 'r' }, '비중')]))),
    h('tbody', {}, rows.map(([g, major, mid]) => h('tr', {}, h('td', { class: 'muted' }, g), h('td', {}, h('i', { class: 'dot', style: { background: colorOf(major) } }), major), h('td', {}, mid),
      sums.map((s) => { const v = s.byMid[`${major}|${mid}`] || 0; return [h('td', { class: 'r' }, M.fmtKRW(v)), h('td', { class: 'r muted' }, s.total ? M.fmtPct(v / s.total) : '')]; })))),
    h('tfoot', {}, h('tr', {}, h('td', { colspan: 3 }, '합계'), sums.map((s) => [h('td', { class: 'r' }, M.fmtKRW(s.total)), h('td', { class: 'r' }, '100%')])))));
}

function historyChartConfig(hist) {
  return {
    type: 'bar',
    data: {
      labels: hist.map((r) => r.date),
      datasets: [
        { type: 'bar', label: '순자산', data: hist.map((r) => M.num(r.netWorth)), backgroundColor: PALETTE[0], borderRadius: 6, borderSkipped: false, maxBarThickness: 36 },
        { type: 'line', label: '목표치', data: hist.map((r) => M.num(r.target) || null), borderColor: PALETTE[2], backgroundColor: PALETTE[2], borderDash: [5, 4], tension: 0.2, pointRadius: 3 },
      ],
    },
    options: { maintainAspectRatio: false, animation: false, scales: { x: { grid: { display: false } }, y: { ticks: { callback: (v) => M.fmtEok(v) }, grid: { color: cssVar('--line') } } }, plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, usePointStyle: true } }, tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${M.fmtKRW(c.raw)}원` } } } },
  };
}

function cashflowChartConfig() {
  const cf = M.cashflowSummary(S.data.cashflow.filter((r) => M.num(r.year) === S.cfYear));
  return {
    type: 'bar',
    data: {
      labels: Array.from({ length: 12 }, (_, i) => `${i + 1}월`),
      datasets: [
        { label: '수입', data: cf.inc, backgroundColor: PALETTE[1], borderRadius: 4, borderSkipped: false },
        { label: '지출', data: cf.out, backgroundColor: PALETTE[4], borderRadius: 4, borderSkipped: false },
        { type: 'line', label: '누적 순이익', data: cf.cum, borderColor: PALETTE[0], backgroundColor: PALETTE[0], yAxisID: 'y2', tension: 0.25, pointRadius: 2 },
      ],
    },
    options: { maintainAspectRatio: false, animation: false, interaction: { mode: 'index', intersect: false }, scales: { x: { grid: { display: false } }, y: { grid: { color: cssVar('--line') } }, y2: { position: 'right', grid: { display: false } } }, plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, usePointStyle: true } } } },
  };
}

// ---------- 페이지: 자산 ----------
function pageAssets() {
  const bs = M.bases(S.data.assets);
  if (!bs.length) {
    return card('자산 (Balance Sheet)', emptyState('자산 데이터가 없습니다.', [
      btn('엑셀 구조로 기본 항목 만들기', () => seed(['assets']), 'primary'),
      btn('빈 기준일 만들기', async () => { const v = await ask('새 기준일', [{ key: 'd', label: '기준일', type: 'date', value: M.today() }]); if (v?.d) { S.basis = v.d; addRow('assets', { basis: v.d, major: '현금', mid: '입출금', name: '', currency: 'KRW', value: 0, rate: 0 }, 'name'); } }),
    ]));
  }
  const all = M.sortAssets(basisAssets(), S.settings);
  const rows = all.filter((r) => matchFilter(r, ['name', 'major', 'mid', 'manager', 'note', 'currency']));
  const sum = summary();
  const fx = S.settings.fx;
  const tax = S.settings.taxonomy;
  const maxKrw = Math.max(1, ...all.map((r) => M.toKRW(r, fx)));
  // 자동완성 목록: 모든 기준일의 항목명 + 템플릿, 운용위임사
  const nameList = [...new Set([...S.data.assets.map((a) => a.name), ...M.TEMPLATE_ASSETS.map((a) => a.name)].filter(Boolean))].sort();
  const mgrList = [...new Set([...S.data.assets.map((a) => a.manager), ...M.TEMPLATE_ASSETS.map((a) => a.manager)].filter(Boolean))].sort();
  const isDefaultClass = (r) => !r.major || !r.mid || (r.major === tax[0]?.major && r.mid === tax[0]?.mids[0]);
  const autoClassify = (r) => {
    if (!isDefaultClass(r)) return;
    const cls = M.classifyName(r.name);
    if (cls && (cls[0] !== r.major || cls[1] !== r.mid)) {
      r.major = cls[0]; r.mid = cls[1];
      ensureMid(cls[0], cls[1]);
      toast(`자동 분류: ${cls[0]} › ${cls[1]} (수정 가능)`);
    }
    const cur = M.currencyHint(r.name);
    if (cur && r.currency === 'KRW' && !M.num(r.value)) r.currency = cur;
  };
  const cols = [
    { key: 'major', label: '대분류', type: 'select', options: () => tax.map((t) => t.major), w: '100px', after: (r) => { const t = tax.find((x) => x.major === r.major); if (t && !t.mids.includes(r.mid)) r.mid = t.mids[0] || ''; } },
    { key: 'mid', label: '중분류', type: 'select', options: (r) => tax.find((t) => t.major === r.major)?.mids || [], w: '100px' },
    { key: 'name', label: '소분류', type: 'text', w: '140px', list: 'dl-names', after: autoClassify },
    { key: 'currency', label: '통화', type: 'select', options: () => Object.keys(fx), w: '72px' },
    { key: 'value', label: '공정가치', type: 'num', w: '120px', amount: { currencyKey: 'currency' }, placeholder: '예: 1.2억, 500만, $1000' },
    { key: 'krw', label: '원화환산', type: 'calc', calc: (r) => M.toKRW(r, fx), databar: true, databarMax: maxKrw },
    { key: 'ratio', label: '비중', type: 'calc', fmt: 'pct', calc: (r) => (sum.total ? M.toKRW(r, fx) / sum.total : 0) },
    { key: 'rate', label: '기대이익률', type: 'pct', w: '84px' },
    { key: 'profit', label: '기대이익', type: 'calc', calc: (r) => M.toKRW(r, fx) * M.num(r.rate) },
    { key: 'nrv', label: 'NRV', type: 'calc', calc: (r) => M.toKRW(r, fx) * (1 + M.num(r.rate)) },
    { key: 'manager', label: '운용위임사', type: 'text', w: '110px', list: 'dl-managers' },
    { key: 'note', label: '기타사항', type: 'text', w: '130px' },
  ];
  const foot = [{ cls: 'total', cells: ['합계', '', '', '', '', M.fmtKRW(sum.total), '100%', M.fmtPct(sum.expRate), M.fmtKRW(sum.profit), M.fmtKRW(sum.nrv), '', ''] }];
  const dupNames = Object.entries(all.reduce((m, r) => { const k = (r.name || '').trim(); if (k) m[k] = (m[k] || 0) + 1; return m; }, {})).filter(([, n]) => n > 1).map(([k]) => k);
  return h('div', { class: 'stack' },
    h('datalist', { id: 'dl-names' }, nameList.map((n) => h('option', { value: n }))),
    h('datalist', { id: 'dl-managers' }, mgrList.map((n) => h('option', { value: n }))),
    toolbar(basisSelect(),
      btn('+ 항목 추가', () => addRow('assets', { basis: S.basis, major: tax[0]?.major || '', mid: tax[0]?.mids[0] || '', name: '', currency: 'KRW', value: 0, rate: 0, manager: '', note: '' }, 'name'), 'primary'),
      btn('새 기준일로 복사', newBasis),
      btn('기준일 변경', renameBasis),
      btn('✨ 자동 정리', tidyAssets, '', { title: '공백 정리 · 미분류 항목 키워드 자동 분류 · 통화 보정' }),
      btn('기준일 삭제', deleteBasis, 'ghost-danger'),
      h('span', { class: 'spacer' }), searchBox()),
    dupNames.length ? h('div', { class: 'banner' }, `중복 이름: ${dupNames.join(', ')} — 같은 항목이면 합치는 것을 권장합니다`) : null,
    h('div', { class: 'kpis' },
      kpi('총자산', `${M.fmtKRW(sum.total)}원`, M.fmtEok(sum.total), 'accent'),
      kpi('기대이익 / NRV', `${M.fmtEok(sum.profit)}원`, `NRV ${M.fmtEok(sum.nrv)}원 · 가중 ${M.fmtPct(sum.expRate)}`),
      kpi('Var / Risk / Fixed', `${M.fmtPct(sum.liquidity, 0)} / ${M.fmtPct(sum.riskRatio, 0)} / ${M.fmtPct(sum.total ? (sum.byGroup.Fixed || 0) / sum.total : 0, 0)}`, '그룹별 비중'),
      kpi('항목 수', `${rows.length}개`, `${Object.keys(sum.byMajor).length}개 대분류`)),
    h('div', { class: 'chips' }, Object.entries(sum.byMajor).sort((a, b) => b[1] - a[1]).map(([k, v]) => h('span', { class: 'chip' }, h('i', { class: 'dot', style: { background: colorOf(k) } }), h('b', {}, k), ` ${M.fmtEok(v)} · ${M.fmtPct(sum.total ? v / sum.total : 0)}`))),
    card(null, grid({ cols, rows, coll: 'assets', foot, rowColor: (r) => colorOf(r.major) }),
      S.filter ? h('p', { class: 'muted small' }, `검색 결과 ${rows.length} / ${all.length} 항목 (합계는 전체 기준)`) : null),
    h('p', { class: 'muted small' }, `환율(${fxStamp()}): ${Object.entries(fx).filter(([k]) => k !== 'KRW').map(([k, v]) => `${k} ${M.fmtNum(v)}`).join(' · ')} `, btn('지금 갱신', () => refreshFx(), 'small link')));
}

// 분류체계에 없는 대/중분류를 자동 분류가 제안하면 설정에 추가
function ensureMid(major, mid) {
  const tax = S.settings.taxonomy;
  let t = tax.find((x) => x.major === major);
  let changed = false;
  if (!t) { t = { major, group: 'Risk', mids: [] }; tax.push(t); changed = true; }
  if (!t.mids.includes(mid)) { t.mids.push(mid); changed = true; }
  if (changed) saveSettings();
}

async function tidyAssets() {
  const rows = basisAssets();
  const changed = M.tidyAssets(rows, S.settings.taxonomy);
  for (const r of changed) ensureMid(r.major, r.mid);
  if (!changed.length) return toast('정리할 항목이 없습니다 — 이미 깔끔합니다');
  render();
  await guard(() => S.be.putMany('assets', changed), `${changed.length}개 항목을 자동 정리했습니다`);
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
    { key: 'monthly', label: '월이자', type: 'calc', calc: (r) => M.num(r.amount) * M.num(r.rate) / 12 },
    { key: 'repay', label: '상환방식', type: 'text', w: '100px' },
    { key: 'note', label: '기타사항', type: 'text', w: '160px' },
  ];
  const sum = S.basis ? summary() : null;
  return h('div', { class: 'stack' },
    toolbar(btn('+ 항목 추가', () => addRow('liabilities', { creditor: '', amount: 0, maturity: '', rate: 0, repay: '급여', note: '' }, 'creditor'), 'primary'),
      !rows.length ? btn('엑셀 구조로 기본 항목 만들기', () => seed(['liabilities'])) : null),
    h('div', { class: 'kpis' },
      kpi('총부채', `${M.fmtKRW(total)}원`, M.fmtEok(total), 'accent'),
      kpi('연이자 합계', `${M.fmtKRW(interest)}원`, `월 ${M.fmtKRW(interest / 12)}원`),
      kpi('평균 금리 (가중)', total ? M.fmtPct(interest / total, 2) : '—'),
      sum ? kpi('부채비율 (부채/총자산)', M.fmtPct(sum.debtRatio), `부채/순자산 ${sum.net ? M.fmtPct(total / sum.net) : '—'} · ${S.basis}`) : null),
    card('Debt & Liability', grid({ cols, rows, coll: 'liabilities', foot: [{ cls: 'total', cells: ['합계', M.fmtKRW(total), '', total ? M.fmtPct(interest / total, 2) : '', M.fmtKRW(interest), M.fmtKRW(interest / 12), '', ''] }] })));
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
      h('label', { class: 'inline' }, '연도', yearSelect(years, S.cfYear, (y) => { S.cfYear = y; render(); })),
      btn('+ 수입', () => addRow('cashflow', { year: S.cfYear, type: '수입', group: '급여', name: '', m: Array(12).fill(0) }, 'name'), 'primary'),
      btn('+ 지출', () => addRow('cashflow', { year: S.cfYear, type: '지출', group: '고정비', name: '', m: Array(12).fill(0) }, 'name'), 'primary'),
      btn('새 연도', newCfYear),
      btn('연도 삭제', deleteCfYear, 'ghost-danger'),
      h('span', { class: 'muted small' }, '단위: 만원')),
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
    { key: 'y', label: '연도', type: 'number', value: (last ?? thisYear() - 1) + 1 },
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

// ---------- 페이지: KPI ----------
function metricOptions() {
  const auto = Object.keys(M.KPI_METRICS).filter((k) => k !== '수동입력');
  const ratios = S.settings.taxonomy.map((t) => `비중:${t.major}`);
  return [...auto, ...ratios, '수동입력'];
}

async function seedKpis(year) {
  const rows = templateRows('kpis', { year });
  await guard(async () => { await S.be.putMany('kpis', rows); S.data.kpis.push(...rows); S.kpiYear = year; render(); }, `${year}년 기본 KPI 를 만들었습니다`);
}

function pageKpi() {
  const years = kpiYears();
  const ctx = kpiCtx();
  const goalsCard = goalsSection();
  if (!years.length) {
    return h('div', { class: 'stack' },
      card('연도별 핵심 KPI', emptyState('KPI 가 없습니다. 연도별 목표를 정하고 분기마다 자동 계산된 실적과 비교합니다.', [
        btn(`${thisYear()}년 기본 KPI 만들기`, () => seedKpis(thisYear()), 'primary'),
        btn('다른 연도', async () => { const v = await ask('연도', [{ key: 'y', label: '연도', type: 'number', value: thisYear() }]); if (v?.y) seedKpis(Number(v.y)); }),
      ])), goalsCard);
  }
  const year = S.kpiYear;
  const rows = S.data.kpis.filter((k) => M.num(k.year) === year).sort((a, b) => M.num(a.order) - M.num(b.order));
  const curQ = year === thisYear() ? Math.ceil((new Date().getMonth() + 1) / 3) : year < thisYear() ? 4 : 0;
  const qCol = (q) => ({
    key: `q${q}`, label: `${q}Q${q === curQ ? ' ●' : ''}`, type: 'custom', w: '120px',
    cls: () => 'r',
    render: (k) => {
      const { value, manual } = M.kpiValue(k, q, ctx);
      const info = M.metricInfo(k.metric);
      const a = M.achievement(k, value);
      const input = h('input', {
        class: 'num q-input', inputmode: 'decimal', 'data-fid': `${k.id}:q${q}`,
        value: manual && value != null ? (info.unit === 'pct' ? +(value * 100).toFixed(2) : M.fmtNum(value, 4)) : '',
        placeholder: value == null ? '—' : M.fmtUnit(value, info.unit),
        title: manual ? '수동 입력값 (지우면 자동 계산)' : `자동 계산: ${info.desc}`,
        onchange: (e) => {
          const raw = e.target.value.trim();
          (k.q ||= [null, null, null, null])[q - 1] = raw === '' ? null : info.unit === 'pct' ? M.num(raw) / 100 : M.num(raw);
          saveRow('kpis', k); setTimeout(render, 0);
        },
        onkeydown: (e) => { if (e.key === 'Enter') e.target.blur(); },
      });
      return h('div', { class: `qcell ${manual ? 'manual' : ''}` }, input, achvChip(a));
    },
  });
  const cols = [
    { key: 'name', label: 'KPI', type: 'text', w: '120px' },
    { key: 'metric', label: '지표', type: 'select', options: () => metricOptions(), w: '130px', after: (k) => { k.dir = M.metricInfo(k.metric).dir; } },
    { key: 'dir', label: '방향', type: 'select', options: () => [{ value: 'up', label: '↑ 높을수록' }, { value: 'down', label: '↓ 낮을수록' }], w: '100px' },
    { key: 'target', label: '목표', type: 'custom', w: '110px', cls: () => 'r', render: (k) => {
      const info = M.metricInfo(k.metric);
      return cellEditor(info.unit === 'pct' ? { key: 'target', type: 'pct' } : { key: 'target', type: 'num' }, k, 'kpis');
    } },
    qCol(1), qCol(2), qCol(3), qCol(4),
    { key: 'note', label: '메모', type: 'text', w: '150px' },
  ];
  const summaryRow = (q) => {
    const vals = rows.map((k) => M.achievement(k, M.kpiValue(k, q, ctx).value)).filter((a) => a != null);
    return vals.length ? `${vals.filter((a) => a >= 1).length}/${vals.length} 달성` : '—';
  };
  return h('div', { class: 'stack' },
    toolbar(
      h('label', { class: 'inline' }, '연도', yearSelect(years, year, (y) => { S.kpiYear = y; render(); })),
      btn('+ KPI 추가', () => addRow('kpis', { year, name: '', metric: '순자산', dir: 'up', target: 0, q: [null, null, null, null], note: '' }, 'name'), 'primary'),
      btn('새 연도', newKpiYear),
      btn('연도 삭제', deleteKpiYear, 'ghost-danger'),
      h('span', { class: 'spacer' }),
      h('span', { class: 'muted small' }, '분기 칸은 자동 계산되며, 값을 입력하면 수동값이 우선합니다 (● 현재 분기)')),
    h('div', { class: 'kpis' }, [1, 2, 3, 4].map((q) => kpi(`${q}분기`, summaryRow(q), M.quarterEnd(year, q), q === curQ ? 'accent' : ''))),
    card(cardHead(`${year}년 핵심 KPI`, '지표를 고르면 분기말 기준일의 자산·현금흐름에서 자동 계산됩니다'), grid({ cols, rows, coll: 'kpis', label: (k) => k.name })),
    rows.length ? card(cardHead('분기별 달성률', '목표 대비 (%) · 100% 이상이면 달성'), chart('c-kpi', kpiChartConfig(rows, ctx), '280px')) : null,
    card(cardHead('지표 설명'), h('ul', { class: 'desc-list' }, Object.entries(M.KPI_METRICS).map(([k, v]) => h('li', {}, h('b', {}, k), ` — ${v.desc}`)), h('li', {}, h('b', {}, '비중:대분류'), ' — 해당 대분류 ÷ 총자산'))),
    goalsCard);
}

function kpiChartConfig(rows, ctx) {
  return {
    type: 'bar',
    data: {
      labels: rows.map((k) => k.name || k.metric),
      datasets: [1, 2, 3, 4].map((q, i) => ({ label: `${q}Q`, data: rows.map((k) => { const a = M.achievement(k, M.kpiValue(k, q, ctx).value); return a == null ? null : Math.round(Math.min(a, 2) * 100); }), backgroundColor: [PALETTE[5], PALETTE[0], PALETTE[3], PALETTE[1]][i], borderRadius: 4, borderSkipped: false })),
    },
    options: { maintainAspectRatio: false, animation: false, scales: { x: { grid: { display: false } }, y: { min: 0, suggestedMax: 120, ticks: { callback: (v) => `${v}%` }, grid: { color: cssVar('--line') } } }, plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, usePointStyle: true } }, tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${c.raw == null ? '—' : c.raw + '%'}` } } } },
  };
}

async function newKpiYear() {
  const last = kpiYears().slice(-1)[0];
  const v = await ask('새 연도 KPI', [
    { key: 'y', label: '연도', type: 'number', value: (last ?? thisYear() - 1) + 1 },
    { key: 'copy', label: `${S.kpiYear}년 KPI 항목·목표 복사 (해제 시 기본 KPI)`, type: 'checkbox', value: true },
  ], '만들기');
  const y = Number(v?.y);
  if (!y) return;
  if (kpiYears().includes(y)) return toast('이미 있는 연도입니다', 'err');
  const src = S.data.kpis.filter((r) => M.num(r.year) === S.kpiYear);
  const rows = (v.copy && src.length ? src : templateRows('kpis', { year: y })).map((r, i) => ({ ...r, id: M.uid() + i, year: y, q: [null, null, null, null] }));
  await guard(async () => { await S.be.putMany('kpis', rows); S.data.kpis.push(...rows); S.kpiYear = y; render(); }, `${y}년 KPI 를 만들었습니다`);
}

async function deleteKpiYear() {
  const rows = S.data.kpis.filter((r) => M.num(r.year) === S.kpiYear);
  if (!(await confirmBox('연도 삭제', `${S.kpiYear}년 KPI ${rows.length}건을 모두 삭제할까요?`))) return;
  await guard(async () => {
    await S.be.removeMany('kpis', rows.map((r) => r.id));
    S.data.kpis = S.data.kpis.filter((r) => !rows.includes(r));
    syncSelections(); render();
  }, '삭제했습니다');
}

function goalsSection() {
  const sum = S.basis ? summary() : null;
  const rows = [...S.data.goals].sort((a, b) => M.num(a.order) - M.num(b.order));
  const metricValue = (metric) => {
    if (!sum) return '';
    if (String(metric).startsWith('비중:')) return sum.total ? M.fmtPct((sum.byMajor[metric.slice(3)] || 0) / sum.total) : '';
    return { 부채비율: M.fmtPct(sum.debtRatio), 유동비율: M.fmtPct(sum.liquidity), 기대수익률: M.fmtPct(sum.expRate), 안전자산비율: M.fmtPct(sum.safeRatio), 위험자산비율: M.fmtPct(sum.riskRatio), 순자산: `${M.fmtEok(sum.net)}원`, 총자산: `${M.fmtEok(sum.total)}원` }[metric] ?? '';
  };
  const cols = [
    { key: 'item', label: '항목', type: 'text', w: '110px' },
    { key: 'target', label: '목표', type: 'text', w: '130px' },
    { key: 'metric', label: '지표', type: 'select', options: () => ['부채비율', '유동비율', '기대수익률', '안전자산비율', '위험자산비율', '순자산', '총자산', ...S.settings.taxonomy.map((t) => `비중:${t.major}`), '없음'], w: '110px' },
    { key: 'auto', label: '현재값(자동)', type: 'calc', fmt: (v) => v, calc: (r) => metricValue(r.metric) },
    { key: 'status', label: '현 상황', type: 'text', w: '130px' },
    { key: 'strategy', label: '전략', type: 'text', w: '220px' },
    { key: 'progress', label: '진행', type: 'select', options: () => PROGRESS, w: '90px' },
  ];
  return card(cardHead('중점 관리사항', '결산 시트의 관리 항목 · 전략 메모', h('div', { class: 'row' },
    btn('+ 항목', () => addRow('goals', { item: '', target: '', metric: '없음', status: '', strategy: '', progress: '진행중' }, 'item'), 'small'),
    !rows.length ? btn('기본 항목', () => seed(['goals']), 'small') : null)),
    grid({ cols, rows, coll: 'goals', label: (r) => r.item }));
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
  const last = rows[rows.length - 1];
  const first = rows[0];
  const cagr = rows.length > 1 && M.num(first.netWorth) > 0 ? Math.pow(M.num(last.netWorth) / M.num(first.netWorth), 1 / (rows.length - 1)) - 1 : null;
  return h('div', { class: 'stack' },
    toolbar(
      btn('+ 항목 추가', () => addRow('history', { date: M.today(), rating: '보통', netWorth: 0, debtRatio: 0, target: 0, age: 0, note: '' }, 'date'), 'primary'),
      S.basis ? btn(`현재 기준일(${S.basis}) 순자산 기록`, recordHistory) : null),
    rows.length ? h('div', { class: 'kpis' },
      kpi('최근 순자산', `${M.fmtEok(last.netWorth)}원`, last.date, 'accent'),
      kpi('최근 증가율', growth[last.id] != null ? M.fmtPct(growth[last.id]) : '—', '직전 기록 대비'),
      kpi('연평균 성장률 (CAGR)', cagr != null ? M.fmtPct(cagr) : '—', `${first.date} → ${last.date}`),
      kpi('목표 달성률', M.num(last.target) ? M.fmtPct(M.num(last.netWorth) / M.num(last.target)) : '—', `목표 ${M.fmtEok(last.target)}원`)) : null,
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
        data: { labels: parts.map((r) => `${r.mid}(${r.form})`), datasets: [{ data: parts.map((r) => M.num(r.amount)), backgroundColor: PALETTE, borderWidth: 0, hoverOffset: 6 }] },
        options: { maintainAspectRatio: false, cutout: '66%', plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, usePointStyle: true } } } },
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

// ---------- 페이지: 시뮬레이션 ----------
function simDefaults() {
  const sum = S.basis ? summary() : null;
  const cfRows = S.data.cashflow.filter((r) => M.num(r.year) === (S.cfYear ?? thisYear()));
  const cf = M.cashflowSummary(cfRows);
  const months = cf.net.filter((v, i) => cf.inc[i] || cf.out[i]).length || 12;
  const monthlySave = Math.round((cf.net.reduce((a, b) => a + b, 0) / months) * 10000) || 0;
  const hist = [...S.data.history].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  return {
    net: sum ? Math.round(sum.net) : 0,
    monthlySave,
    annualRate: sum ? +sum.expRate.toFixed(4) : 0.07,
    spread: 0.05,
    years: 10,
    inflation: 0.025,
    saveGrowth: 0.03,
    target: hist.length ? M.num(hist[hist.length - 1].target) : 0,
  };
}

function slider(label, key, obj, { min, max, step, fmt, pct, onchange }) {
  const val = obj[key];
  const display = fmt ? fmt(val) : pct ? M.fmtPct(val) : M.fmtKRW(val);
  const input = h('input', {
    type: 'text', class: 'num sim-val', inputmode: 'decimal', 'data-fid': `sim:${key}`,
    value: pct ? +(val * 100).toFixed(2) : M.fmtNum(val),
    onchange: (e) => { const p = M.parseAmount(e.target.value); obj[key] = pct ? M.num(e.target.value) / 100 : p.value; onchange(); },
    onkeydown: (e) => { if (e.key === 'Enter') e.target.blur(); },
  });
  const range = h('input', {
    type: 'range', min, max, step, value: pct ? val * 100 : val, 'data-fid': `simr:${key}`,
    oninput: (e) => { obj[key] = pct ? Number(e.target.value) / 100 : Number(e.target.value); S.focusFid = `simr:${key}`; onchange(); },
  });
  return h('div', { class: 'sim-field' }, h('div', { class: 'sim-field-head' }, h('span', {}, label), h('b', {}, display)), range, h('div', { class: 'pct-wrap' }, input, pct ? h('i', {}, '%') : h('i', {}, '원')));
}

function pageSimulate() {
  // 기준일이 바뀌었거나 데이터 입력 전(순자산 0)에 만들어진 기본값이면 다시 계산
  if (!S.sim || S.simBasis !== S.basis || (S.sim.net === 0 && S.basis)) { S.sim = simDefaults(); S.simBasis = S.basis; }
  if (!S.simTab) S.simTab = 'project';
  const tabs = [['project', '순자산 전망'], ['rebalance', '리밸런싱'], ['debt', '부채 상환']];
  const tabBar = h('div', { class: 'tabs' }, tabs.map(([id, label]) => h('button', { class: `tab ${S.simTab === id ? 'active' : ''}`, onclick: () => { S.simTab = id; render(); } }, label)));
  const body = S.simTab === 'project' ? simProject() : S.simTab === 'rebalance' ? simRebalance() : simDebt();
  return h('div', { class: 'stack' }, tabBar, body);
}

function simProject() {
  const p = S.sim;
  const rerender = () => render();
  const scen = [
    ['비관', p.annualRate - p.spread, PALETTE[4]],
    ['기본', p.annualRate, PALETTE[0]],
    ['낙관', p.annualRate + p.spread, PALETTE[1]],
  ].map(([label, rate, color]) => ({ label, rate, color, series: M.projectNetWorth({ ...p, annualRate: rate }) }));
  const base = scen[1].series;
  const last = base[base.length - 1];
  const reach = scen.map((s) => M.yearsToReach(s.series, p.target));
  const saved = [...S.data.scenarios].filter((s) => s.kind === 'project').sort((a, b) => M.num(a.order) - M.num(b.order));
  const chartCfg = {
    type: 'line',
    data: {
      labels: base.map((r) => (r.year === 0 ? '현재' : `${thisYear() + r.year}`)),
      datasets: [
        ...scen.map((s) => ({ label: `${s.label} (${M.fmtPct(s.rate)})`, data: s.series.map((r) => Math.round(r.nominal)), borderColor: s.color, backgroundColor: s.color, tension: 0.3, pointRadius: 2, borderWidth: s.label === '기본' ? 3 : 1.5, borderDash: s.label === '기본' ? [] : [4, 3] })),
        { label: '기본 (실질가치)', data: base.map((r) => Math.round(r.real)), borderColor: cssVar('--muted'), backgroundColor: cssVar('--muted'), tension: 0.3, pointRadius: 0, borderWidth: 1.5, borderDash: [2, 3] },
        p.target ? { label: '목표', data: base.map(() => p.target), borderColor: PALETTE[2], backgroundColor: PALETTE[2], pointRadius: 0, borderWidth: 1.5, borderDash: [6, 4] } : null,
      ].filter(Boolean),
    },
    options: { maintainAspectRatio: false, animation: false, interaction: { mode: 'index', intersect: false }, scales: { x: { grid: { display: false } }, y: { ticks: { callback: (v) => M.fmtEok(v) }, grid: { color: cssVar('--line') } } }, plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, usePointStyle: true } }, tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${M.fmtKRW(c.raw)}원` } } } },
  };
  return h('div', { class: 'stack' },
    h('div', { class: 'grid-2 wide-right' },
      card(cardHead('가정', '슬라이더를 움직이면 즉시 반영됩니다', btn('현재 데이터로 초기화', () => { S.sim = simDefaults(); render(); }, 'small')),
        h('div', { class: 'sim-fields' },
          slider('시작 순자산', 'net', p, { min: 0, max: 2e9, step: 1e6, onchange: rerender }),
          slider('월 저축액', 'monthlySave', p, { min: -2e6, max: 1e7, step: 1e5, onchange: rerender }),
          slider('연 수익률 (기본)', 'annualRate', p, { min: -10, max: 30, step: 0.5, pct: true, onchange: rerender }),
          slider('낙관/비관 폭 (±)', 'spread', p, { min: 0, max: 20, step: 0.5, pct: true, onchange: rerender }),
          slider('기간 (년)', 'years', p, { min: 1, max: 30, step: 1, fmt: (v) => `${v}년`, onchange: rerender }),
          slider('물가상승률', 'inflation', p, { min: 0, max: 10, step: 0.1, pct: true, onchange: rerender }),
          slider('저축액 연 증가율', 'saveGrowth', p, { min: 0, max: 20, step: 0.5, pct: true, onchange: rerender }),
          slider('목표 금액', 'target', p, { min: 0, max: 5e9, step: 1e7, onchange: rerender })),
        h('div', { class: 'row', style: { marginTop: '12px' } },
          btn('시나리오 저장', async () => {
            const v = await ask('시나리오 저장', [{ key: 'name', label: '이름', value: `${thisYear()} 전망 (${M.fmtPct(p.annualRate)} · 월 ${M.fmtEok(p.monthlySave)})` }], '저장');
            if (!v?.name) return;
            await addRow('scenarios', { kind: 'project', name: v.name, ...p, note: '' });
          }, 'primary'))),
      h('div', { class: 'stack' },
        h('div', { class: 'kpis' },
          kpi(`${p.years}년 후 예상 순자산 (기본)`, `${M.fmtEok(last.nominal)}원`, `실질가치 ${M.fmtEok(last.real)}원`, 'accent'),
          kpi('비관 ~ 낙관', `${M.fmtEok(scen[0].series[p.years].nominal)} ~ ${M.fmtEok(scen[2].series[p.years].nominal)}`, `수익률 ${M.fmtPct(scen[0].rate)} ~ ${M.fmtPct(scen[2].rate)}`),
          kpi('총 저축 원금', `${M.fmtEok(base.reduce((s, r, i) => (i ? s + p.monthlySave * 12 * Math.pow(1 + p.saveGrowth, i - 1) : s), 0))}원`, `수익 기여 ${M.fmtEok(last.nominal - p.net - base.reduce((s, r, i) => (i ? s + p.monthlySave * 12 * Math.pow(1 + p.saveGrowth, i - 1) : s), 0))}원`),
          kpi('목표 도달', p.target ? (reach[1] != null ? `${reach[1]}년 후 (${thisYear() + reach[1]})` : `${p.years}년 내 미달`) : '목표 미설정', p.target ? `비관 ${reach[0] ?? '—'}년 · 낙관 ${reach[2] ?? '—'}년` : '목표 금액을 입력하세요')),
        card(cardHead('연도별 예상 순자산', `현재 ${M.fmtEok(p.net)}원 → 기본 시나리오 ${M.fmtEok(last.nominal)}원`), chart('c-sim', chartCfg, '320px')),
        card(cardHead('연도별 표'), h('div', { class: 'table-wrap' }, h('table', { class: 'grid compact' },
          h('thead', {}, h('tr', {}, h('th', {}, '연도'), h('th', { class: 'r' }, '비관'), h('th', { class: 'r' }, '기본'), h('th', { class: 'r' }, '낙관'), h('th', { class: 'r' }, '기본 실질가치'), h('th', { class: 'r' }, '목표 대비'))),
          h('tbody', {}, base.map((r, i) => h('tr', { class: p.target && r.nominal >= p.target ? 'inc' : '' },
            h('td', {}, r.year === 0 ? '현재' : `${thisYear() + r.year} (${r.year}년)`),
            h('td', { class: 'r muted' }, M.fmtKRW(scen[0].series[i].nominal)),
            h('td', { class: 'r' }, h('b', {}, M.fmtKRW(r.nominal))),
            h('td', { class: 'r muted' }, M.fmtKRW(scen[2].series[i].nominal)),
            h('td', { class: 'r muted' }, M.fmtKRW(r.real)),
            h('td', { class: 'r' }, p.target ? achvChip(r.nominal / p.target) : '—'))))))))),
    saved.length ? card(cardHead('저장된 시나리오', '불러오면 위 가정에 적용됩니다'), grid({
      coll: 'scenarios', rows: saved, label: (r) => r.name, reorder: false,
      cols: [
        { key: 'name', label: '이름', type: 'text', w: '180px' },
        { key: 'net', label: '시작 순자산', type: 'num', w: '120px' },
        { key: 'monthlySave', label: '월 저축', type: 'num', w: '100px' },
        { key: 'annualRate', label: '수익률', type: 'pct', w: '70px' },
        { key: 'years', label: '기간', type: 'num', w: '60px' },
        { key: 'inflation', label: '물가', type: 'pct', w: '70px' },
        { key: 'target', label: '목표', type: 'num', w: '120px' },
        { key: 'result', label: `결과`, type: 'calc', calc: (r) => { const s = M.projectNetWorth({ net: M.num(r.net), monthlySave: M.num(r.monthlySave), annualRate: M.num(r.annualRate), years: M.num(r.years) || 1, inflation: M.num(r.inflation), saveGrowth: M.num(r.saveGrowth) }); return s[s.length - 1].nominal; } },
        { key: 'load', label: '', type: 'custom', render: (r) => btn('불러오기', () => { S.sim = { net: M.num(r.net), monthlySave: M.num(r.monthlySave), annualRate: M.num(r.annualRate), spread: M.num(r.spread) || 0.05, years: M.num(r.years) || 10, inflation: M.num(r.inflation), saveGrowth: M.num(r.saveGrowth), target: M.num(r.target) }; render(); }, 'small') },
      ],
    })) : null);
}

function simRebalance() {
  if (!S.basis) return card('리밸런싱', emptyState('자산 데이터가 필요합니다.', []));
  const sum = summary();
  const majors = S.settings.taxonomy.map((t) => t.major).filter((m) => (sum.byMajor[m] || 0) > 0 || S.rebal?.[m]);
  if (!S.rebal || S.rebalBasis !== S.basis) { S.rebal = Object.fromEntries(majors.map((m) => [m, +((sum.byMajor[m] || 0) / sum.total * 100).toFixed(1)])); S.rebalBasis = S.basis; }
  const tgtSum = majors.reduce((s, m) => s + M.num(S.rebal[m]), 0);
  const rows = M.rebalance(sum.byMajor, S.rebal, sum.total).filter((r) => majors.includes(r.major));
  const groupOf = Object.fromEntries(S.settings.taxonomy.map((t) => [t.major, t.group]));
  const rateOf = (m) => { const as = basisAssets().filter((a) => a.major === m); const k = as.reduce((s, a) => s + M.toKRW(a, S.settings.fx), 0); return k ? as.reduce((s, a) => s + M.toKRW(a, S.settings.fx) * M.num(a.rate), 0) / k : 0; };
  const after = rows.reduce((acc, r) => { acc.profit += r.target * rateOf(r.major); if (groupOf[r.major] === 'Risk') acc.risk += r.target; if (groupOf[r.major] === 'Var') acc.var += r.target; return acc; }, { profit: 0, risk: 0, var: 0 });
  const presets = {
    '보수적 (현금 50 · 투자 30 · 가상 5 · 고정 15)': { 현금: 50, 투자: 30, 가상자산: 5, 채권형자산: 10, '연금/보험': 5 },
    '균형 (현금 30 · 투자 45 · 가상 10 · 고정 15)': { 현금: 30, 투자: 45, 가상자산: 10, 채권형자산: 10, '연금/보험': 5 },
    '공격적 (현금 15 · 투자 55 · 가상 20 · 고정 10)': { 현금: 15, 투자: 55, 가상자산: 20, 채권형자산: 5, '연금/보험': 5 },
  };
  return h('div', { class: 'stack' },
    toolbar(h('label', { class: 'inline' }, '프리셋', select(Object.keys(presets), '', (v) => { if (!presets[v]) return; S.rebal = Object.fromEntries(majors.map((m) => [m, presets[v][m] ?? 0])); render(); })),
      btn('현재 비중으로 초기화', () => { S.rebal = null; render(); }, 'small'),
      h('span', { class: 'spacer' }), h('span', { class: `chip-s ${Math.abs(tgtSum - 100) < 0.05 ? 'ok' : 'bad'}` }, `목표 합계 ${tgtSum.toFixed(1)}%`)),
    h('div', { class: 'kpis' },
      kpi('가중 기대수익률', `${M.fmtPct(sum.expRate)} → ${M.fmtPct(sum.total ? after.profit / sum.total : 0)}`, `기대이익 ${M.fmtEok(sum.profit)} → ${M.fmtEok(after.profit)}원`, 'accent'),
      kpi('위험자산 비율', `${M.fmtPct(sum.riskRatio)} → ${M.fmtPct(sum.total ? after.risk / sum.total : 0)}`),
      kpi('유동비율', `${M.fmtPct(sum.liquidity)} → ${M.fmtPct(sum.total ? after.var / sum.total : 0)}`),
      kpi('총 거래 필요액', `${M.fmtEok(rows.reduce((s, r) => s + Math.abs(r.delta), 0) / 2)}원`, '매수·매도 한쪽 기준')),
    card(cardHead('대분류별 목표 비중', '목표 % 를 입력하면 매수/매도 금액이 계산됩니다'),
      h('div', { class: 'table-wrap' }, h('table', { class: 'grid compact' },
        h('thead', {}, h('tr', {}, h('th', {}, '대분류'), h('th', { class: 'r' }, '현재 금액'), h('th', { class: 'r' }, '현재 비중'), h('th', { class: 'r' }, '목표 비중'), h('th', { class: 'r' }, '목표 금액'), h('th', { class: 'r' }, '매수(+) / 매도(−)'), h('th', {}, ''))),
        h('tbody', {}, rows.map((r) => h('tr', { style: { '--row-c': colorOf(r.major) } },
          h('td', {}, h('i', { class: 'dot', style: { background: colorOf(r.major) } }), r.major, h('span', { class: 'muted small' }, ` ${groupOf[r.major] || ''}`)),
          h('td', { class: 'r' }, M.fmtKRW(r.current)),
          h('td', { class: 'r muted' }, M.fmtPct(r.curPct)),
          h('td', { class: 'r' }, h('span', { class: 'pct-wrap' }, h('input', { class: 'num', inputmode: 'decimal', style: { width: '70px' }, value: S.rebal[r.major], 'data-fid': `rb:${r.major}`, onchange: (e) => { S.rebal[r.major] = M.num(e.target.value); render(); } }), h('i', {}, '%'))),
          h('td', { class: 'r' }, M.fmtKRW(r.target)),
          h('td', { class: `r ${r.delta > 0 ? 'up' : r.delta < 0 ? 'down' : ''}` }, h('b', {}, `${r.delta > 0 ? '+' : ''}${M.fmtKRW(r.delta)}`)),
          h('td', {}, h('div', { class: 'bar', style: { width: '120px', marginTop: 0 } }, h('i', { style: { width: `${Math.min(100, r.targetPct * 100)}%`, background: colorOf(r.major) } })))))),
        h('tfoot', {}, h('tr', {}, h('td', {}, '합계'), h('td', { class: 'r' }, M.fmtKRW(sum.total)), h('td', { class: 'r' }, '100%'), h('td', { class: 'r' }, `${tgtSum.toFixed(1)}%`), h('td', { class: 'r' }, M.fmtKRW(sum.total * tgtSum / 100)), h('td', { class: 'r' }, M.fmtKRW(rows.reduce((s, r) => s + r.delta, 0))), h('td', {})))))),
    card(cardHead('현재 vs 목표 구성'), chart('c-rebal', {
      type: 'bar',
      data: { labels: rows.map((r) => r.major), datasets: [{ label: '현재', data: rows.map((r) => +(r.curPct * 100).toFixed(1)), backgroundColor: PALETTE[9], borderRadius: 4 }, { label: '목표', data: rows.map((r) => +(r.targetPct * 100).toFixed(1)), backgroundColor: PALETTE[0], borderRadius: 4 }] },
      options: { maintainAspectRatio: false, animation: false, scales: { x: { grid: { display: false } }, y: { ticks: { callback: (v) => `${v}%` }, grid: { color: cssVar('--line') } } }, plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, usePointStyle: true } } } },
    }, '240px')));
}

function simDebt() {
  const debts = S.data.liabilities.filter((l) => M.num(l.amount) > 0);
  const total = debts.reduce((s, l) => s + M.num(l.amount), 0);
  if (!S.debtSim || S.debtSim.forTotal !== total) S.debtSim = { monthly: Math.max(100000, Math.round(total / 36 / 10000) * 10000), forTotal: total };
  const d = S.debtSim;
  const wRate = total ? debts.reduce((s, l) => s + M.num(l.amount) * M.num(l.rate), 0) / total : 0;
  const res = M.debtPayoff(total, wRate, d.monthly);
  const per = debts.map((l) => ({ l, share: total ? M.num(l.amount) / total : 0 })).map(({ l, share }) => ({ l, res: M.debtPayoff(M.num(l.amount), M.num(l.rate), d.monthly * share) }));
  const altMonthly = [0.8, 1, 1.25, 1.5, 2].map((k) => ({ k, m: Math.round(d.monthly * k), r: M.debtPayoff(total, wRate, Math.round(d.monthly * k)) }));
  return h('div', { class: 'stack' },
    h('div', { class: 'grid-2 wide-right' },
      card(cardHead('가정'), h('div', { class: 'sim-fields' },
        slider('월 상환액 (전체)', 'monthly', d, { min: 0, max: 5e6, step: 5e4, onchange: () => render() })),
        h('p', { class: 'muted small' }, `총부채 ${M.fmtKRW(total)}원 · 가중 금리 ${M.fmtPct(wRate, 2)} · 월 이자만 ${M.fmtKRW(total * wRate / 12)}원`)),
      h('div', { class: 'stack' },
        h('div', { class: 'kpis' },
          res ? kpi('완납까지', `${Math.floor(res.months / 12)}년 ${res.months % 12}개월`, `${new Date(Date.now() + res.months * 30.4 * 86400e3).toISOString().slice(0, 7)} 예상`, 'accent') : kpi('완납 불가', '월 상환액 < 월 이자', '상환액을 올리세요', 'accent'),
          kpi('총 이자', res ? `${M.fmtKRW(res.interest)}원` : '—', res ? `원금의 ${M.fmtPct(total ? res.interest / total : 0)}` : ''),
          kpi('총 상환액', res ? `${M.fmtKRW(total + res.interest)}원` : '—'),
          kpi('부채 건수', `${debts.length}건`, `총 ${M.fmtEok(total)}원`)),
        card(cardHead('상환액별 비교', '월 상환액을 늘리면 이자가 얼마나 줄어드는지'), h('div', { class: 'table-wrap' }, h('table', { class: 'grid compact' },
          h('thead', {}, h('tr', {}, h('th', {}, '월 상환액'), h('th', { class: 'r' }, '완납 기간'), h('th', { class: 'r' }, '총 이자'), h('th', { class: 'r' }, '이자 절감'))),
          h('tbody', {}, altMonthly.map(({ k, m, r }) => h('tr', { class: k === 1 ? 'inc' : '' },
            h('td', {}, `${M.fmtKRW(m)}원`, k === 1 ? h('span', { class: 'chip-s ok', style: { marginLeft: '6px' } }, '현재') : null),
            h('td', { class: 'r' }, r ? `${Math.floor(r.months / 12)}년 ${r.months % 12}개월` : '완납 불가'),
            h('td', { class: 'r' }, r ? M.fmtKRW(r.interest) : '—'),
            h('td', { class: `r ${r && res && r.interest < res.interest ? 'up' : ''}` }, r && res ? M.fmtKRW(res.interest - r.interest) : '—'))))))),
        card(cardHead('부채별 (상환액을 잔액 비례 배분)'), h('div', { class: 'table-wrap' }, h('table', { class: 'grid compact' },
          h('thead', {}, h('tr', {}, h('th', {}, '채권자'), h('th', { class: 'r' }, '잔액'), h('th', { class: 'r' }, '금리'), h('th', { class: 'r' }, '월 배분'), h('th', { class: 'r' }, '완납'), h('th', { class: 'r' }, '이자'))),
          h('tbody', {}, per.map(({ l, res: r }) => h('tr', {}, h('td', {}, l.creditor), h('td', { class: 'r' }, M.fmtKRW(l.amount)), h('td', { class: 'r' }, M.fmtPct(l.rate, 2)), h('td', { class: 'r' }, M.fmtKRW(d.monthly * (total ? M.num(l.amount) / total : 0))), h('td', { class: 'r' }, r ? `${r.months}개월` : '불가'), h('td', { class: 'r' }, r ? M.fmtKRW(r.interest) : '—'))))))),
        res ? card(cardHead('잔액 추이'), chart('c-debt', {
          type: 'line',
          data: { labels: ['현재', ...res.schedule.map((s) => `${s.month}개월`)], datasets: [{ label: '잔액', data: [total, ...res.schedule.map((s) => Math.round(s.balance))], borderColor: PALETTE[4], backgroundColor: 'rgba(229,72,77,0.12)', fill: true, tension: 0.3, pointRadius: 2 }] },
          options: { maintainAspectRatio: false, animation: false, scales: { x: { grid: { display: false } }, y: { ticks: { callback: (v) => M.fmtEok(v) }, grid: { color: cssVar('--line') } } }, plugins: { legend: { display: false } } },
        }, '220px')) : null)));
}

// ---------- 페이지: 설정 ----------
function pageSettings() {
  const fx = S.settings.fx;
  const fxTable = h('table', { class: 'grid compact' },
    h('thead', {}, h('tr', {}, h('th', {}, '통화'), h('th', { class: 'r' }, '원화 환율'), h('th', { class: 'act' }))),
    h('tbody', {}, Object.entries(fx).map(([cur, rate]) => h('tr', {},
      h('td', {}, h('b', {}, cur)),
      h('td', { class: 'r' }, cur === 'KRW' ? '1' : h('input', { class: 'num', value: M.fmtNum(rate, 6), inputmode: 'decimal', 'data-fid': `fx:${cur}`, onchange: (e) => { fx[cur] = M.num(e.target.value); S.settings.fxUpdatedAt = null; saveSettings(); render(); } })),
      h('td', { class: 'act' }, cur === 'KRW' ? '' : h('button', { class: 'icon-btn', onclick: async () => {
        if (S.data.assets.some((a) => a.currency === cur)) return toast(`${cur} 를 사용하는 자산이 있어 삭제할 수 없습니다`, 'err');
        delete fx[cur]; await saveSettings(); render();
      } }, '✕'))))));
  const taxTable = h('table', { class: 'grid compact' },
    h('thead', {}, h('tr', {}, h('th', {}, '대분류'), h('th', {}, '그룹'), h('th', {}, '중분류 (쉼표로 구분)'), h('th', { class: 'act' }))),
    h('tbody', {}, S.settings.taxonomy.map((t, i) => h('tr', {},
      h('td', {}, h('span', { class: 'row-inline' }, h('i', { class: 'dot', style: { background: PALETTE[i % PALETTE.length] } }), h('input', { value: t.major, 'data-fid': `tx:${i}:major`, onchange: async (e) => {
        const old = t.major; t.major = e.target.value.trim();
        const rows = S.data.assets.filter((a) => a.major === old); rows.forEach((a) => { a.major = t.major; });
        await saveSettings(); if (rows.length) await guard(() => S.be.putMany('assets', rows)); render();
      } }))),
      h('td', {}, select(['Var', 'Risk', 'Fixed'], t.group, async (v) => { t.group = v; await saveSettings(); render(); }, { placeholder: false })),
      h('td', {}, h('input', { value: t.mids.join(', '), 'data-fid': `tx:${i}:mids`, onchange: async (e) => { t.mids = e.target.value.split(',').map((s) => s.trim()).filter(Boolean); await saveSettings(); render(); } })),
      h('td', { class: 'act' }, h('div', { class: 'row-inline' },
        h('button', { class: 'icon-btn', title: '위로', disabled: i === 0, onclick: async () => { const tx = S.settings.taxonomy; [tx[i - 1], tx[i]] = [tx[i], tx[i - 1]]; await saveSettings(); render(); } }, '↑'),
        h('button', { class: 'icon-btn', title: '삭제', onclick: async () => {
          if (S.data.assets.some((a) => a.major === t.major)) return toast('이 대분류를 사용하는 자산이 있어 삭제할 수 없습니다', 'err');
          S.settings.taxonomy.splice(i, 1); await saveSettings(); render();
        } }, '✕')))))));

  return h('div', { class: 'stack' },
    h('div', { class: 'grid-2' },
      card(cardHead('환율 (원화 환산)', `마지막 갱신: ${fxStamp()} · 출처 open.er-api.com`),
        fxTable,
        h('div', { class: 'row' },
          btn(S.fxBusy ? '갱신 중…' : '지금 자동 갱신', () => refreshFx(), 'primary', { disabled: S.fxBusy }),
          btn('+ 통화 추가', async () => {
            const v = await ask('통화 추가', [{ key: 'c', label: '통화 코드 (예: GBP, HKD, CNY)' }, { key: 'r', label: '원화 환율 (비우면 자동 조회)', type: 'number' }], '추가');
            if (!v?.c) return;
            fx[v.c.toUpperCase()] = M.num(v.r); await saveSettings();
            if (!M.num(v.r)) await refreshFx(); else render();
          }),
          h('label', { class: 'check inline' }, h('input', { type: 'checkbox', checked: S.settings.fxAuto !== false, onchange: async (e) => { S.settings.fxAuto = e.target.checked; await saveSettings(); } }), ' 앱 시작 시 자동 갱신 (12시간 경과 시)'))),
      card(cardHead('분류체계', 'Var = 현금성 · Risk = 위험자산 · Fixed = 고정수익/안전 (대시보드 그룹 비중에 사용)'), taxTable,
        h('div', { class: 'row' }, btn('+ 대분류 추가', async () => {
          const v = await ask('대분류 추가', [{ key: 'major', label: '대분류' }, { key: 'group', label: '그룹', type: 'select', options: ['Var', 'Risk', 'Fixed'], value: 'Risk' }, { key: 'mids', label: '중분류 (쉼표로 구분)' }], '추가');
          if (!v?.major) return;
          S.settings.taxonomy.push({ major: v.major, group: v.group, mids: v.mids.split(',').map((s) => s.trim()).filter(Boolean) });
          await saveSettings(); render();
        }), btn('추천 분류 다시 병합', async () => { const m = M.mergeTaxonomy(S.settings.taxonomy, S.taxTemplate || M.DEFAULT_TAXONOMY); S.settings.taxonomy = m.taxonomy; await saveSettings(); render(); toast(m.changed ? '추천 분류를 추가했습니다' : '이미 모두 포함되어 있습니다'); }),
        h('span', { class: 'muted small' }, S.taxTemplate ? '관리자가 편집한 추천 템플릿 사용 중' : '기본 추천 템플릿 사용 중')))),
    card(cardHead('엑셀', '시트: 자산(B.S) · 부채(D.L) · 현금흐름(C.F) · 연도별추이 · 포트폴리오 · KPI · 관리목표 · 환율 · 분류체계'),
      h('div', { class: 'row' }, btn('엑셀 다운로드', downloadExcel, 'primary'), btn('엑셀 업로드', pickUpload), btn('빈 양식 다운로드', downloadTemplate))),
    card(cardHead('데이터', S.be.kind === 'firebase' ? `Firebase Firestore 에 저장 중 · ${S.user?.email || ''}` : '로컬 모드: 이 브라우저(localStorage)에만 저장됩니다.'),
      h('div', { class: 'row' },
        btn('JSON 전체 백업', downloadJson), btn('JSON 복원', pickJson),
        btn('비어있는 항목에 기본 구조 채우기', () => seed(COLLECTIONS)),
        btn('전체 데이터 초기화', resetAll, 'ghost-danger'))),
    card(cardHead('화면'), h('div', { class: 'row' },
      btn('라이트 / 다크 전환', toggleTheme),
      btn('시스템 설정 따르기', () => { applyTheme(null); render(); }),
      btn('현재 화면 인쇄 / PDF', () => window.print()))));
}

// ---------- 페이지: 관리자 ----------
async function loadAdminData() {
  const [profiles, admins] = await Promise.all([S.be.listProfiles(), S.be.listAdmins()]);
  S.profiles = profiles.sort((a, b) => String(b.lastLogin || '').localeCompare(String(a.lastLogin || '')));
  S.admins = admins;
}

function pageAdmin() {
  if (S.be.kind !== 'firebase') return card('관리자', h('p', { class: 'muted' }, '관리자 기능은 Firebase 모드에서만 사용할 수 있습니다 (계정은 Firebase Authentication 에 저장됩니다).'));
  if (!S.admin) return card('관리자', h('p', { class: 'muted' }, '관리자 권한이 없는 계정입니다.'));
  if (!S.profiles) {
    loadAdminData().then(render).catch((e) => toast(`불러오기 실패: ${e.message}`, 'err'));
    return card('관리자', h('p', { class: 'muted' }, '계정 목록 불러오는 중…'));
  }
  const adminEmails = new Set([...BOOTSTRAP_ADMINS, ...S.admins.map((a) => a.email)]);
  const fmtD = (iso) => (iso ? new Date(iso).toLocaleString('ko-KR', { year: '2-digit', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
  const profiles = S.profiles.filter((p) => matchFilter(p, ['email', 'name', 'uid']));
  const active = S.profiles.filter((p) => !p.disabled).length;
  const recent = S.profiles.filter((p) => p.lastLogin && Date.now() - new Date(p.lastLogin).getTime() < 7 * 86400e3).length;

  const userRow = (p) => {
    const isMe = p.uid === S.user?.uid;
    const isAdm = adminEmails.has(p.email);
    return h('div', { class: `admin-user ${p.disabled ? 'disabled' : ''}` },
      h('div', { class: 'avatar' }, (p.name || p.email || '?')[0].toUpperCase()),
      h('div', {},
        h('div', {}, h('b', {}, p.name || '(이름 없음)'), ' ', h('span', { class: 'muted' }, p.email),
          isMe ? h('span', { class: 'chip-s ok', style: { marginLeft: '6px' } }, '나') : null,
          isAdm ? h('span', { class: 'chip-s warn', style: { marginLeft: '6px' } }, '관리자') : null,
          p.disabled ? h('span', { class: 'chip-s bad', style: { marginLeft: '6px' } }, '비활성') : null),
        h('div', { class: 'meta' }, `가입 ${fmtD(p.createdAt)} · 최근 로그인 ${fmtD(p.lastLogin)} · ${p.provider || ''}`,
          p.stats ? ` · 자산 ${p.stats.assets} · 부채 ${p.stats.liabilities} · 현금흐름 ${p.stats.cashflow} · KPI ${p.stats.kpis}` : null,
          p.memo ? h('div', {}, '메모: ', p.memo) : null)),
      h('div', { class: 'row' },
        btn('통계', async () => { p.stats = await S.be.userStats(p.uid); render(); }, 'small'),
        btn('데이터 열람', () => viewAs(p), 'small', { disabled: isMe }),
        btn('메모', async () => { const v = await ask('관리자 메모', [{ key: 'm', label: p.email, value: p.memo || '' }], '저장'); if (v) { await S.be.updateProfile(p.uid, { memo: v.m }); p.memo = v.m; render(); } }, 'small'),
        btn(p.disabled ? '활성화' : '비활성화', async () => {
          if (isMe) return toast('본인 계정은 비활성화할 수 없습니다', 'err');
          if (!p.disabled && !(await confirmBox('계정 비활성화', `${p.email} 의 데이터 쓰기를 막을까요? (로그인은 가능하지만 저장이 거부됩니다)`, '비활성화'))) return;
          await S.be.updateProfile(p.uid, { disabled: !p.disabled }); p.disabled = !p.disabled; render();
        }, `small ${p.disabled ? '' : 'ghost-danger'}`),
        isAdm
          ? btn('관리자 해제', async () => { if (BOOTSTRAP_ADMINS.includes(p.email)) return toast('기본 관리자는 해제할 수 없습니다', 'err'); await S.be.removeAdmin(p.email); await loadAdminData(); render(); }, 'small', { disabled: isMe })
          : btn('관리자 지정', async () => { if (!(await confirmBox('관리자 지정', `${p.email} 에게 모든 계정 데이터 열람·관리 권한을 줄까요?`, '지정'))) return; await S.be.addAdmin(p.email, S.user.email); await loadAdminData(); render(); }, 'small'),
        btn('데이터 삭제', async () => {
          if (!(await confirmBox('데이터 삭제', `${p.email} 의 자산·부채·현금흐름·KPI 등 모든 데이터를 삭제합니다. 되돌릴 수 없습니다.`, '전체 삭제'))) return;
          await S.be.deleteUserData(p.uid); p.stats = null; toast('삭제했습니다'); render();
        }, 'small ghost-danger', { disabled: isMe })));
  };

  return h('div', { class: 'stack' },
    h('div', { class: 'kpis' },
      kpi('전체 계정', `${S.profiles.length}명`, `활성 ${active} · 비활성 ${S.profiles.length - active}`, 'accent'),
      kpi('최근 7일 로그인', `${recent}명`),
      kpi('관리자', `${adminEmails.size}명`, [...adminEmails].join(', ')),
      kpi('Firebase 프로젝트', 'asset-management-6c342', 'Spark 무료 플랜')),
    card(cardHead('계정 목록', 'Firebase Auth 계정은 로그인 시 profiles 에 자동 등록됩니다. Auth 계정 자체의 삭제는 Firebase 콘솔에서만 가능합니다.',
      h('div', { class: 'row' }, searchBox(), btn('새로고침', async () => { await loadAdminData(); render(); }, 'small'))),
      profiles.length ? h('div', { class: 'admin-list' }, profiles.map(userRow)) : h('p', { class: 'muted' }, '계정이 없습니다.')),
    card(cardHead('관리자 추가', '이메일로 관리자 권한을 부여합니다 (해당 계정이 로그인하면 관리자 메뉴가 보입니다)'),
      h('div', { class: 'row' }, btn('+ 이메일로 관리자 추가', async () => {
        const v = await ask('관리자 추가', [{ key: 'e', label: '이메일', type: 'email' }], '추가');
        if (!v?.e) return;
        await S.be.addAdmin(v.e.toLowerCase(), S.user.email); await loadAdminData(); render(); toast('추가했습니다');
      }), h('span', { class: 'muted small' }, `현재: ${[...adminEmails].join(', ')}`))),
    taxonomyTemplateCard(),
    card(cardHead('Firebase 콘솔 바로가기'), h('div', { class: 'row' },
      h('a', { class: 'btn', href: 'https://console.firebase.google.com/project/asset-management-6c342/authentication/users', target: '_blank' }, 'Authentication 사용자'),
      h('a', { class: 'btn', href: 'https://console.firebase.google.com/project/asset-management-6c342/firestore', target: '_blank' }, 'Firestore 데이터'),
      h('a', { class: 'btn', href: 'https://console.firebase.google.com/project/asset-management-6c342/usage', target: '_blank' }, '사용량'))));
}

// 관리자가 편집하는 추천 분류 템플릿 — 모든 사용자의 설정에 병합됨
function taxonomyTemplateCard() {
  if (!S.taxDraft) S.taxDraft = structuredClone(S.taxTemplate || M.DEFAULT_TAXONOMY);
  const d = S.taxDraft;
  const rows = d.map((t, i) => h('div', { class: 'tax-row' },
    h('input', { value: t.major, placeholder: '대분류', 'data-fid': `tt:${i}:major`, onchange: (e) => { t.major = e.target.value.trim(); } }),
    select(['Var', 'Risk', 'Fixed'], t.group, (v) => { t.group = v; }, { placeholder: false }),
    h('input', { value: t.mids.join(', '), placeholder: '중분류 (쉼표로 구분)', 'data-fid': `tt:${i}:mids`, onchange: (e) => { t.mids = e.target.value.split(',').map((s) => s.trim()).filter(Boolean); } }),
    h('span', { class: 'row-inline' },
      h('button', { class: 'icon-btn', disabled: i === 0, onclick: () => { [d[i - 1], d[i]] = [d[i], d[i - 1]]; render(); } }, '↑'),
      h('button', { class: 'icon-btn', disabled: i === d.length - 1, onclick: () => { [d[i + 1], d[i]] = [d[i], d[i + 1]]; render(); } }, '↓'),
      h('button', { class: 'icon-btn del', onclick: () => { d.splice(i, 1); render(); } }, '✕'))));
  return card(cardHead('추천 분류 템플릿 (전체 사용자)', '저장하면 모든 사용자의 분류체계에 새 대/중분류가 병합됩니다 (기존 사용자 분류는 삭제되지 않음)',
    h('div', { class: 'row' },
      btn('+ 대분류', () => { d.push({ major: '', group: 'Risk', mids: [] }); render(); }, 'small'),
      btn('기본값으로', () => { S.taxDraft = structuredClone(M.DEFAULT_TAXONOMY); render(); }, 'small'))),
    h('div', { class: 'tax-editor' }, rows),
    h('div', { class: 'row', style: { marginTop: '12px' } },
      btn('템플릿 저장 (전체 적용)', async () => {
        const clean = d.filter((t) => t.major).map((t) => ({ major: t.major, group: t.group, mids: t.mids }));
        try {
          await S.be.setTaxonomyTemplate(clean, S.user?.email || 'local');
          S.taxTemplate = clean;
          const m = M.mergeTaxonomy(S.settings.taxonomy, clean); S.settings.taxonomy = m.taxonomy; await saveSettings();
          toast('템플릿을 저장했습니다. 사용자들이 다음 접속 시 병합됩니다');
        } catch (e) { toast(`저장 실패: ${e.message}`, 'err'); }
      }, 'primary'),
      btn('되돌리기', () => { S.taxDraft = null; render(); }),
      h('span', { class: 'muted small' }, S.taxTemplate ? '현재: 편집된 템플릿' : '현재: 기본 템플릿')));
}

function viewAs(p) {
  S.viewing = p; S.readOnly = true; S.be.viewAs(p.uid);
  reload().then(() => { toast(`${p.email} 데이터를 읽기 전용으로 열람합니다`); go('dashboard'); buildShell(); }).catch((e) => { toast(`열람 실패: ${e.message}`, 'err'); exitView(); });
}
function exitView() {
  S.viewing = null; S.readOnly = false; S.be.viewAs(null);
  reload().then(() => { buildShell(); go('admin'); });
}

// ---------- 추가 기능: 테마 / JSON 백업 / 인쇄 ----------
function applyTheme(t) {
  if (t) document.documentElement.setAttribute('data-theme', t); else document.documentElement.removeAttribute('data-theme');
  try { t ? localStorage.setItem(THEME_KEY, t) : localStorage.removeItem(THEME_KEY); } catch {}
}
function toggleTheme() {
  const cur = document.documentElement.getAttribute('data-theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  applyTheme(cur === 'dark' ? 'light' : 'dark');
  render();
}
function downloadJson() {
  const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), settings: S.settings, data: S.data }, null, 1)], { type: 'application/json' });
  const a = h('a', { href: URL.createObjectURL(blob), download: stampName('자산관리_백업').replace('.xlsx', '.json') });
  a.click();
}
function pickJson() {
  const input = h('input', { type: 'file', accept: '.json', onchange: async () => {
    const f = input.files[0]; if (!f) return;
    let j; try { j = JSON.parse(await f.text()); } catch { return toast('JSON 파일을 읽지 못했습니다', 'err'); }
    if (!j?.data) return toast('이 앱의 백업 파일이 아닙니다', 'err');
    if (!(await confirmBox('JSON 복원', `${f.name} (${j.exportedAt?.slice(0, 16) || ''}) 의 내용으로 전체 데이터를 교체할까요?`, '복원'))) return;
    await guard(async () => {
      for (const c of COLLECTIONS) await S.be.replace(c, j.data[c] || []);
      if (j.settings) { S.settings = { ...structuredClone(M.DEFAULT_SETTINGS), ...j.settings }; await S.be.saveSettings(S.settings); }
      await reload(); render();
    }, '복원했습니다');
  } });
  input.click();
}

async function resetAll() {
  if (!(await confirmBox('전체 초기화', '모든 데이터를 삭제합니다. 먼저 엑셀로 백업하는 것을 권장합니다. 계속할까요?', '전체 삭제'))) return;
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
    return modal({ title: '인식할 수 있는 시트가 없습니다', body: h('p', {}, `이 플랫폼의 양식이 아닙니다. "빈 양식 다운로드" 로 받은 파일 형식에 맞춰 업로드하세요. 파일의 시트: ${parsed.unknown.join(', ')}`), okText: '닫기', cancelText: null });
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
window.__assetApp = { handleUpload, state: S, refreshFx };

// ---------- 렌더 ----------
const PAGE_FN = { dashboard: pageDashboard, assets: pageAssets, liabilities: pageLiabilities, cashflow: pageCashflow, kpi: pageKpi, history: pageHistory, portfolio: pagePortfolio, simulate: pageSimulate, settings: pageSettings, admin: pageAdmin };

function go(page) { S.page = page; render(); window.scrollTo(0, 0); }

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
    Chart.defaults.font.size = 11;
  }
  $('#page-title').textContent = PAGE_TITLE[S.page] || '';
  document.querySelectorAll('#nav button').forEach((b) => b.classList.toggle('active', b.dataset.page === S.page));
  const page = PAGE_FN[S.page]();
  main.replaceChildren(S.viewing
    ? h('div', { class: 'stack' }, h('div', { class: 'banner' }, `★ 관리자 열람 모드 — ${S.viewing.email} 의 데이터 (읽기 전용)`, h('span', { class: 'spacer' }), btn('열람 종료', exitView, 'small')), page)
    : page);
  main.querySelectorAll('.table-wrap').forEach((el, i) => { if (scrolls[i]) el.scrollLeft = scrolls[i]; });
  S.pendingCharts.forEach((fn) => fn());
  if (fid) {
    const el = main.querySelector(`[data-fid="${CSS.escape(fid)}"]`);
    if (el) { el.focus({ preventScroll: true }); if (S.focusFid) el.select?.(); }
  }
  S.focusFid = null;
}

function buildShell() {
  $('#nav').replaceChildren(...PAGES.filter(([id]) => id !== 'admin' || S.admin).map(([id, label, icon]) =>
    h('button', { 'data-page': id, class: id === 'admin' ? 'admin' : '', onclick: () => go(id) }, h('span', { class: 'ico' }, icon), h('span', {}, label))));
  $('#mode').textContent = S.be.kind === 'firebase' ? (S.admin ? 'Firebase · 관리자' : 'Firebase') : '로컬 모드';
  $('#mode').className = `badge ${S.be.kind === 'firebase' ? 'ok' : 'warn'}`;
  $('#btn-down').onclick = downloadExcel;
  $('#btn-up').onclick = pickUpload;
  $('#btn-theme').onclick = toggleTheme;
  $('#user').replaceChildren(S.user
    ? h('span', { class: 'user' }, h('span', { class: 'muted email' }, S.user.email || S.user.displayName || ''), btn('로그아웃', () => S.be.signOut(), 'small'))
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
    h('p', { class: 'muted' }, '개인 자산현황 · 부채 · 현금흐름 · KPI'),
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
    if (S.settings.fxAuto !== false && isStale(S.settings.fxUpdatedAt)) refreshFx({ silent: true });
  };
  if (S.be.kind === 'firebase') {
    S.be.onAuth(async (user) => {
      S.user = user;
      $('#boot').hidden = true;
      if (!user) { S.admin = false; S.viewing = null; S.readOnly = false; return showLogin(); }
      try {
        const profile = await S.be.touchProfile(user);
        if (profile.disabled) toast('이 계정은 관리자에 의해 비활성화되어 저장이 제한됩니다', 'err');
      } catch (e) { console.warn('프로필 갱신 실패', e); }
      const email = (user.email || '').toLowerCase();
      S.admin = BOOTSTRAP_ADMINS.includes(email) || (await S.be.isAdmin(email));
      enter();
    });
  } else {
    await enter();
  }
}

try { const t = localStorage.getItem(THEME_KEY); if (t) applyTheme(t); } catch {}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (!$('#app').hidden) render(); });
start();

export { isFirebaseConfigured };
