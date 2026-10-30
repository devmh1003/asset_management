import { createBackend, isFirebaseConfigured, COLLECTIONS } from './store.js';
import * as M from './model.js';
import { exportWorkbook, parseWorkbook, parseStatement, exportTransactions } from './excel.js';
import { fetchRates, isStale } from './fx.js';
import { AI_MODELS, DEFAULT_AI, loadAiConfig, saveAiConfig, aiReady, maskKey, loadChat, saveChat, chatStream, chatJson, testConnection, SYSTEM_PROMPT, QUICK_PROMPTS } from './ai.js';

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
  profile: null,      // 로그인한 본인 프로필
  appConfig: null,    // 공지 · 가입 정책
  myLogs: null,
  adminLogs: null,
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
  ['realestate', '부동산', '⌂'],
  ['cashflow', '현금흐름', '⇅'],
  ['transactions', '소비내역', '▦'],
  ['kpi', 'KPI', '◎'],
  ['history', '연도별 추이', '↗'],
  ['portfolio', '포트폴리오', '◔'],
  ['simulate', '시뮬레이션', '∿'],
  ['strategy', '전략 추천', '▲'],
  ['advisor', 'AI 어드바이저', '✦'],
  ['settings', '설정', '⚙'],
  ['admin', '관리자', '★'],
];
const PAGE_TITLE = { dashboard: '대시보드', assets: '자산 (Balance Sheet)', liabilities: '부채 (Debt & Liability)', realestate: '부동산', cashflow: '현금흐름 (Cash Flow)', transactions: '소비내역', kpi: '핵심 KPI', history: '연도별 추이', portfolio: '포트폴리오', simulate: '시뮬레이션', strategy: '자산 증식 전략 추천', advisor: 'AI 어드바이저', settings: '설정', admin: '관리자' };

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
  const has = value === undefined || value === null || value === '' || options.some((o) => (typeof o === 'object' ? o.value : o) === value);
  const opts = has ? options : [...options, value];
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

// ---------- 변경 이력 (감사 로그) ----------
const COLL_LABEL = { assets: '자산', liabilities: '부채', cashflow: '현금흐름', history: '연도별추이', portfolio: '포트폴리오', goals: '관리목표', kpis: 'KPI', scenarios: '시나리오', reports: 'AI리포트', transactions: '소비내역', realestate: '부동산', settings: '설정' };
const FIELD_LABEL = {
  value: '금액/시세', rate: '이익률', name: '이름', major: '대분류', mid: '중분류', currency: '통화', fee: '연보수율', manager: '운용위임사', note: '메모', basis: '기준일',
  amount: '금액', creditor: '채권자', maturity: '만기일', repay: '상환방식', budget: '월예산', m: '', q: '분기실적', target: '목표', metric: '지표', dir: '방향', year: '연도',
  type: '유형', use: '용도', address: '주소', area: '면적', share: '지분', acqDate: '취득일', acqPrice: '취득가', acqCost: '부대비용', valuedAt: '시세기준일', loanId: '담보대출', deposit: '보증금', rent: '월세', holdCost: '보유비용',
  date: '날짜', desc: '내용', category: '카테고리', method: '결제수단', netWorth: '순자산', debtRatio: '부채비율', age: '나이', rating: '평가', item: '항목', status: '현황', strategy: '전략', progress: '진행', plan: '안', title: '제목',
  fx: '환율', taxonomy: '분류체계', fxAuto: '환율 자동갱신', birthYear: '출생연도', fxUpdatedAt: null,
};
const ACTION_LABEL = { login: '로그인', signup: '가입', create: '추가', update: '수정', delete: '삭제', bulk: '일괄 작업', import: '가져오기', export: '내보내기', settings: '설정', account: '계정', admin: '관리자' };
const ACTION_TONE = { delete: 'bad', admin: 'warn', import: 'warn', bulk: 'warn', account: 'warn', create: 'ok', signup: 'ok' };
const rowLabel = (r) => r?.name || r?.creditor || r?.item || r?.title || r?.desc || r?.date || r?.basis || '(새 항목)';
S.snap = new Map();

function audit(action, target, detail = '', extra = {}) {
  if (S.readOnly || !S.be?.log) return;
  S.be.log({ action, target, detail, ...extra }).catch((e) => console.warn('이력 기록 실패', e.message || e));
}
function snapRows(coll, rows) { for (const r of rows) S.snap.set(`${coll}:${r.id}`, JSON.stringify(r)); }
function snapAll() {
  S.snap.clear();
  for (const c of COLLECTIONS) snapRows(c, S.data[c]);
  S.snap.set('settings:settings', JSON.stringify(S.settings));
}
const PCT_KEYS = new Set(['rate', 'fee', 'share', 'debtRatio', 'maxRate', 'minRate', 'avgRate', 'annualRate', 'inflation', 'saveGrowth']);
const fmtLogVal = (v, key) => {
  if (v == null || v === '') return '(빈칸)';
  if (key === 'loanId') return S.data.liabilities.find((l) => l.id === v)?.creditor || '(삭제된 대출)';
  if (PCT_KEYS.has(key) && typeof v === 'number') return M.fmtPct(v, 2);
  if (['year', 'birthYear', 'age'].includes(key)) return String(v);
  if (typeof v === 'number') return Number.isInteger(v) || Math.abs(v) >= 100 ? M.fmtKRW(v) : String(+v.toFixed(4));
  if (typeof v === 'boolean') return v ? '켬' : '끔';
  if (typeof v === 'object') return '…';
  return String(v).slice(0, 60);
};
// 한 단계 깊이까지 바뀐 필드 목록: [[라벨, 이전, 이후]]
function diffFields(before, after) {
  const out = [];
  for (const k of new Set([...Object.keys(before || {}), ...Object.keys(after || {})])) {
    if (['id', 'order', 'valuations', 'reId'].includes(k) || FIELD_LABEL[k] === null) continue;
    const a = before?.[k], b = after?.[k];
    if (JSON.stringify(a ?? null) === JSON.stringify(b ?? null)) continue;
    const label = FIELD_LABEL[k] ?? k;
    if (Array.isArray(a) && Array.isArray(b) && k !== 'taxonomy') {
      b.forEach((v, i) => { if (JSON.stringify(a[i] ?? null) !== JSON.stringify(v ?? null)) out.push([k === 'm' ? `${i + 1}월` : `${label}[${i + 1}]`, a[i], v, k]); });
    } else if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && k !== 'taxonomy') {
      for (const sk of new Set([...Object.keys(a), ...Object.keys(b)])) if (JSON.stringify(a[sk] ?? null) !== JSON.stringify(b[sk] ?? null)) out.push([`${label}.${sk}`, a[sk], b[sk], k]);
    } else out.push([label, k === 'taxonomy' ? `${(a || []).length}개 대분류` : a, k === 'taxonomy' ? `${(b || []).length}개 대분류` : b, k]);
  }
  return out;
}
const pendingLogs = new Map();
let logTimer = null;
// 셀 단위 수정은 4초간 모아서 행당 1건으로 기록 (Firestore 쓰기 절약)
function trackChange(coll, row) {
  const key = `${coll}:${row.id}`;
  const prev = S.snap.get(key);
  S.snap.set(key, JSON.stringify(row));
  if (!prev) return;
  const p = pendingLogs.get(key) || { coll, before: JSON.parse(prev) };
  p.after = JSON.parse(JSON.stringify(row));
  pendingLogs.set(key, p);
  clearTimeout(logTimer);
  logTimer = setTimeout(flushLogs, 4000);
}
function flushLogs() {
  clearTimeout(logTimer);
  for (const p of pendingLogs.values()) {
    const d = diffFields(p.before, p.after);
    if (!d.length) continue;
    audit(p.coll === 'settings' ? 'settings' : 'update', p.coll === 'settings' ? '설정' : `${COLL_LABEL[p.coll] || p.coll} · ${rowLabel(p.after)}`,
      d.slice(0, 12).map(([l, a, b, k]) => `${l}: ${fmtLogVal(a, k)} → ${fmtLogVal(b, k)}`).join(' | ') + (d.length > 12 ? ` 외 ${d.length - 12}건` : ''));
  }
  pendingLogs.clear();
}
addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushLogs(); });
addEventListener('pagehide', flushLogs);
// 일괄 쓰기 후에는 스냅샷만 갱신 (개별 수정 이력에 섞이지 않도록)
function instrumentBackend(be) {
  const putMany = be.putMany.bind(be), replace = be.replace.bind(be), removeMany = be.removeMany.bind(be);
  be.putMany = async (c, rows) => { await putMany(c, rows); snapRows(c, rows); };
  be.replace = async (c, rows) => { await replace(c, rows); for (const k of [...S.snap.keys()]) if (k.startsWith(`${c}:`)) S.snap.delete(k); snapRows(c, rows); };
  be.removeMany = async (c, ids) => { await removeMany(c, ids); ids.forEach((id) => S.snap.delete(`${c}:${id}`)); };
}

// ---------- 데이터 조작 ----------
async function guard(fn, okMsg) {
  if (S.readOnly) { toast('읽기 전용 열람 모드입니다', 'err'); return false; }
  try { await fn(); if (okMsg) toast(okMsg); return true; }
  catch (e) { console.error(e); toast(`저장 실패: ${e.message || e}`, 'err'); return false; }
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
  if (await saveRow(coll, copy)) audit('create', `${COLL_LABEL[coll] || coll} · ${rowLabel(copy)}`, '복제');
}

// 저장에 성공한 경우에만 변경 이력에 반영
async function saveRow(coll, row) {
  const ok = await guard(() => S.be.put(coll, row.id, row));
  if (ok) trackChange(coll, row);
  return ok;
}

async function addRow(coll, obj, focusKey) {
  const row = { ...obj, id: M.uid(), order: Date.now() };
  S.data[coll].push(row);
  if (focusKey) S.focusFid = `${row.id}:${focusKey}`;
  render();
  if (await saveRow(coll, row)) audit('create', `${COLL_LABEL[coll] || coll} · ${rowLabel(row)}`, coll === 'assets' ? `기준일 ${row.basis}` : '');
}

async function removeRow(coll, row, label) {
  if (!(await confirmBox('행 삭제', `"${label || row.name || row.creditor || row.item || '이 항목'}" 을(를) 삭제할까요?`))) return;
  S.data[coll] = S.data[coll].filter((r) => r !== row);
  render();
  if (await guard(() => S.be.remove(coll, row.id))) {
    S.snap.delete(`${coll}:${row.id}`);
    const keyVals = ['value', 'amount', 'acqPrice', 'basis', 'year', 'date', 'major', 'mid'].filter((k) => row[k] != null && row[k] !== '').map((k) => `${FIELD_LABEL[k] || k}: ${fmtLogVal(row[k], k)}`);
    audit('delete', `${COLL_LABEL[coll] || coll} · ${rowLabel(row)}`, keyVals.join(' | '));
  }
}

async function saveSettings() {
  if (await guard(() => S.be.saveSettings(S.settings))) trackChange('settings', { ...S.settings, id: 'settings' });
}
const snapSettings = () => S.snap.set('settings:settings', JSON.stringify({ ...S.settings, id: 'settings' }));

async function reload() {
  const all = await S.be.loadAll();
  for (const c of COLLECTIONS) S.data[c] = all[c] || [];
  if (all.settings) S.settings = { ...structuredClone(M.DEFAULT_SETTINGS), ...all.settings };
  // 추천 분류 템플릿(관리자 편집본 또는 기본값)을 기존 설정에 비파괴적으로 병합
  try { S.taxTemplate = (await S.be.getTaxonomyTemplate()) || null; } catch { S.taxTemplate = null; }
  const merged = M.mergeTaxonomy(S.settings.taxonomy, S.taxTemplate || M.DEFAULT_TAXONOMY);
  S.settings.taxonomy = merged.taxonomy;
  if ((!all.settings || merged.changed) && !S.readOnly) {
    try { await S.be.saveSettings(S.settings); } catch (e) { console.warn('설정 저장 실패 (비활성/승인 대기 계정일 수 있음)', e.message || e); }
  }
  M.setBirthYear(S.settings.birthYear);
  snapAll();
  S.snap.set('settings:settings', JSON.stringify({ ...S.settings, id: 'settings' }));
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
  const done = [];
  await guard(async () => {
    for (const c of colls) {
      if (S.data[c].length) continue;
      const rows = templateRows(c);
      if (!rows.length) continue;
      await S.be.putMany(c, rows);
      S.data[c] = rows;
      done.push(COLL_LABEL[c] || c);
    }
    if (done.length) audit('bulk', '기본 항목 생성', done.join(', '));
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
    snapSettings();
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
    const nm = S.profile?.name || S.user?.displayName;
    return card(`${nm ? `${nm}님, ` : ''}환영합니다 👋`,
      h('p', { class: 'muted' }, '아직 데이터가 없습니다. 기본 항목(통장·증권·연금·대출·현금흐름·KPI 틀)을 만들어 금액만 입력하거나, 엑셀 파일을 업로드해 시작하세요.'),
      h('ol', { class: 'steps' },
        h('li', {}, h('b', {}, '기본 항목 만들기'), ' — 금액은 모두 0 으로 생성되며 이름·분류는 자유롭게 바꿀 수 있습니다.'),
        h('li', {}, h('b', {}, '자산 · 부채 · 부동산'), ' 금액을 입력하면 대시보드에 순자산과 재무 건강 점수가 계산됩니다.'),
        h('li', {}, h('b', {}, '매 분기'), ' 자산 페이지에서 “새 기준일로 복사” 하면 추이와 KPI 가 쌓입니다.')),
      h('div', { class: 'row' },
        btn('기본 항목 만들기', () => seed(COLLECTIONS), 'primary'),
        btn('부동산부터 등록', () => go('realestate')),
        btn('엑셀 업로드', pickUpload),
        btn('빈 엑셀 양식 다운로드', downloadTemplate)));
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
    healthRow(sum, year, q, bs),
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
  // 이번 달 예산 (현금흐름 지출 행의 월 예산)
  const bud = M.budgetStatus(S.data.cashflow.filter((r) => M.num(r.year) === curY), now.getMonth());
  if (bud.length) {
    const tb = bud.reduce((s, b) => s + b.budget, 0), ta = bud.reduce((s, b) => s + b.actual, 0);
    const over = bud.filter((b) => b.ratio > 1);
    items.push(h('div', { class: 'kpi' }, h('div', { class: 'kpi-label' }, `${now.getMonth() + 1}월 예산 사용`), h('div', { class: 'kpi-value' }, `${M.fmtNum(ta)} / ${M.fmtNum(tb)}만원`),
      h('div', { class: 'bar' }, h('i', { class: ta > tb ? 'bad' : ta > tb * 0.85 ? 'warn' : 'ok', style: { width: `${Math.min(100, tb ? (ta / tb) * 100 : 0)}%` } })),
      h('div', { class: 'kpi-sub' }, over.length ? `초과: ${over.map((b) => b.name).join(', ')}` : `${bud.length}개 항목 예산 내`)));
  }
  return items.length ? h('div', { class: 'kpis' }, items) : null;
}

// 벤치마크 기능 공통 컨텍스트 (건강 점수·알림·AI 요약에 사용)
function analysisCtx(sum = summary(), year = Number(String(S.basis).slice(0, 4)), q = M.quarterOf(S.basis), bs = M.bases(S.data.assets)) {
  const cfYear = cfYears().includes(year) ? year : S.cfYear;
  return {
    sum, q, bases: bs, cfYear,
    cashflowRows: S.data.cashflow.filter((r) => M.num(r.year) === cfYear),
    cashflowRowsNow: S.data.cashflow.filter((r) => M.num(r.year) === thisYear()),
    kpis: S.data.kpis.filter((k) => M.num(k.year) === year).sort((a, b) => M.num(a.order) - M.num(b.order)),
    kpiCtx: kpiCtx(), history: S.data.history, liabilities: S.data.liabilities, assets: basisAssets(), settings: S.settings,
    realestate: S.data.realestate,
  };
}

// 재무 건강 점수 + 알림 센터 (뱅크샐러드 금융건강점수 · Mint/Betterment 알림 벤치마크)
function healthRow(sum, year, q, bs) {
  const ctx = analysisCtx(sum, year, q, bs);
  const hs = M.healthScore(ctx);
  const alerts = M.buildAlerts(ctx);
  const tone = (s) => (s == null ? '' : s >= 70 ? 'ok' : s >= 40 ? 'warn' : 'bad');
  return h('div', { class: 'grid-2' },
    card(cardHead('재무 건강 점수', '비상자금 · 부채 · 저축률 · 분산 · 연령 대비 위험 · KPI', h('div', { class: 'row' }, btn('전략 추천 →', () => go('strategy'), 'small'), btn('AI 진단 →', () => { go('advisor'); aiSend(QUICK_PROMPTS[0][1]); }, 'small'))),
      h('div', { class: 'health' },
        h('div', { class: `score-ring ${tone(hs.score)}`, style: { '--p': hs.score ?? 0 } }, h('b', {}, hs.score ?? '—'), h('small', {}, hs.grade)),
        h('div', { class: 'health-parts' }, hs.parts.map((p) => h('div', { class: 'hpart', title: p.hint },
          h('div', { class: 'hpart-head' }, h('span', {}, p.label), h('span', { class: 'muted' }, p.value), h('b', { class: tone(p.score) }, p.score == null ? '—' : Math.round(p.score))),
          h('div', { class: 'bar' }, h('i', { class: tone(p.score), style: { width: `${p.score ?? 0}%` } }))))))),
    card(cardHead('알림 센터', alerts.length ? `${alerts.length}건 — 클릭하면 해당 페이지로 이동합니다` : '주의할 항목이 없습니다 👍'),
      alerts.length ? h('ul', { class: 'alerts' }, alerts.slice(0, 8).map((a) => h('li', { class: a.level, onclick: () => go(a.page) },
        h('span', { class: 'alert-dot' }), h('div', {}, h('b', {}, a.title), h('p', { class: 'muted small' }, a.text))))) : h('p', { class: 'muted' }, '부채 만기, 비상자금, 집중도, 위험 비중, 수수료, KPI, 예산을 자동으로 점검합니다.')));
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
      btn('기본 항목 만들기', () => seed(['assets']), 'primary'),
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
    { key: 'fee', label: '연보수율', type: 'pct', w: '78px', nullable: true, placeholder: '0.5' },
    { key: 'manager', label: '운용위임사', type: 'text', w: '110px', list: 'dl-managers' },
    { key: 'note', label: '기타사항', type: 'text', w: '130px' },
  ];
  const fee = M.feeDrag(all, fx);
  const foot = [{ cls: 'total', cells: ['합계', '', '', '', '', M.fmtKRW(sum.total), '100%', M.fmtPct(sum.expRate), M.fmtKRW(sum.profit), M.fmtKRW(sum.nrv), fee.annual ? `연 ${M.fmtEok(fee.annual)}` : '', '', ''] }];
  const dupNames = Object.entries(all.reduce((m, r) => { const k = (r.name || '').trim(); if (k) m[k] = (m[k] || 0) + 1; return m; }, {})).filter(([, n]) => n > 1).map(([k]) => k);
  return h('div', { class: 'stack' },
    h('datalist', { id: 'dl-names' }, nameList.map((n) => h('option', { value: n }))),
    h('datalist', { id: 'dl-managers' }, mgrList.map((n) => h('option', { value: n }))),
    toolbar(basisSelect(),
      btn('+ 항목 추가', () => addRow('assets', { basis: S.basis, major: tax[0]?.major || '', mid: tax[0]?.mids[0] || '', name: '', currency: 'KRW', value: 0, rate: 0, manager: '', note: '' }, 'name'), 'primary'),
      btn('새 기준일로 복사', newBasis),
      btn('기준일 변경', renameBasis),
      btn('✨ 자동 정리', tidyAssets, '', { title: '공백 정리 · 미분류 항목 키워드 자동 분류 · 통화 보정' }),
      aiReady(aiState().cfg) ? btn('🤖 AI 분류', aiClassify, '', { title: '미분류 항목을 OpenAI 로 분류' }) : null,
      btn('기준일 삭제', deleteBasis, 'ghost-danger'),
      h('span', { class: 'spacer' }), searchBox()),
    dupNames.length ? h('div', { class: 'banner' }, `중복 이름: ${dupNames.join(', ')} — 같은 항목이면 합치는 것을 권장합니다`) : null,
    h('div', { class: 'kpis' },
      kpi('총자산', `${M.fmtKRW(sum.total)}원`, M.fmtEok(sum.total), 'accent'),
      kpi('기대이익 / NRV', `${M.fmtEok(sum.profit)}원`, `NRV ${M.fmtEok(sum.nrv)}원 · 가중 ${M.fmtPct(sum.expRate)}`),
      kpi('Var / Risk / Fixed', `${M.fmtPct(sum.liquidity, 0)} / ${M.fmtPct(sum.riskRatio, 0)} / ${M.fmtPct(sum.total ? (sum.byGroup.Fixed || 0) / sum.total : 0, 0)}`, '그룹별 비중'),
      fee.annual ? kpi('연간 보수·수수료', `${M.fmtEok(fee.annual)}원`, `평균 ${M.fmtPct(fee.avgFee, 2)} · 10년 복리 영향 ${M.fmtEok(fee.drag10)}원`) : kpi('항목 수', `${rows.length}개`, `${Object.keys(sum.byMajor).length}개 대분류 · 연보수율을 입력하면 수수료 분석`)),
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

// OpenAI 로 미분류(기본값) 항목 분류 — 분류체계에 있는 값만 적용
async function aiClassify() {
  const ai = aiState();
  if (!aiReady(ai.cfg)) { toast('설정에서 OpenAI API 키를 먼저 등록하세요', 'err'); return go('settings'); }
  const tax = S.settings.taxonomy;
  const candidates = basisAssets().filter((r) => r.name && (!r.major || !r.mid || (r.major === tax[0]?.major && r.mid === tax[0]?.mids[0])));
  if (!candidates.length) return toast('분류할 항목이 없습니다 — 이미 모두 분류되어 있습니다');
  // 키워드 규칙이 맞는 항목은 규칙을 우선 적용하고, 규칙이 없는 항목만 AI 에 보낸다
  const changed = [], rows = [];
  for (const r of candidates) {
    const cls = M.classifyName(r.name) || M.classifyName(r.manager);
    if (cls) { if (cls[0] !== r.major || cls[1] !== r.mid) { r.major = cls[0]; r.mid = cls[1]; ensureMid(cls[0], cls[1]); changed.push(r); } }
    else rows.push(r);
  }
  if (rows.length) toast(`${rows.length}개 항목을 AI 로 분류하는 중…`);
  const taxonomyText = tax.map((t) => `${t.major}: ${t.mids.join(', ')}`).join('\n');
  try {
    const j = rows.length ? await chatJson({ cfg: ai.cfg, messages: [
      { role: 'system', content: `한국 개인 자산 항목을 아래 분류체계로 분류하라. 반드시 JSON {"items":[{"id":"...","major":"...","mid":"...","currency":"KRW"}]} 형식만 출력하고 major/mid 는 분류체계에 있는 값만 사용한다. 각 항목의 current 는 현재 분류이며 더 적합한 분류가 분명할 때만 바꾼다. 생활비·월급통장은 '현금 > 입출금', 대기자금·파킹은 '현금 > 파킹/CMA'. 통화는 이름에서 명확할 때만 KRW 외 값을 쓴다.\n분류체계:\n${taxonomyText}` },
      { role: 'user', content: JSON.stringify(rows.map((r) => ({ id: r.id, name: r.name, manager: r.manager || '', note: r.note || '', current: `${r.major} > ${r.mid}` }))) },
    ] }) : { items: [] };
    for (const it of j.items || []) {
      const r = rows.find((x) => x.id === it.id), t = tax.find((x) => x.major === it.major);
      if (!r || !t || !t.mids.includes(it.mid)) continue;
      if (r.major !== it.major || r.mid !== it.mid) { r.major = it.major; r.mid = it.mid; changed.push(r); }
      if (it.currency && it.currency !== r.currency && S.settings.fx[it.currency] && !M.num(r.value)) { r.currency = it.currency; if (!changed.includes(r)) changed.push(r); }
    }
    if (!changed.length) return toast('AI 가 변경할 분류를 찾지 못했습니다');
    render();
    await guard(() => S.be.putMany('assets', changed), `${changed.length}개 항목을 AI 가 분류했습니다 (수정 가능)`);
  } catch (e) { console.error(e); toast(`AI 분류 실패: ${e.message}`, 'err'); }
}

async function tidyAssets() {
  const rows = basisAssets();
  const changed = M.tidyAssets(rows, S.settings.taxonomy);
  for (const r of changed) ensureMid(r.major, r.mid);
  if (!changed.length) return toast('정리할 항목이 없습니다 — 이미 깔끔합니다');
  render();
  await guard(() => S.be.putMany('assets', changed), `${changed.length}개 항목을 자동 정리했습니다`);
  audit('bulk', '자산 자동 정리', `${S.basis} · ${changed.length}건: ${changed.slice(0, 10).map((r) => `${r.name}→${r.major}›${r.mid}`).join(', ')}`);
}

async function newBasis() {
  const v = await ask('새 기준일로 복사', [
    { key: 'd', label: '새 기준일', type: 'date', value: M.today() },
    { key: 'keep', label: '현재 금액도 함께 복사', type: 'checkbox', value: true },
  ], '만들기');
  if (!v?.d) return;
  if (M.bases(S.data.assets).includes(v.d)) return toast('이미 있는 기준일입니다', 'err');
  const rows = basisAssets().map((a, i) => ({ ...a, id: M.uid() + i, basis: v.d, value: v.keep ? a.value : 0 }));
  await guard(async () => { await S.be.putMany('assets', rows); S.data.assets.push(...rows); S.basis = v.d; render(); audit('bulk', '새 기준일 복사', `${v.d} · ${rows.length}건${v.keep ? ' (금액 포함)' : ' (금액 0)'}`); }, `${v.d} 기준일을 만들었습니다`);
}

async function renameBasis() {
  const v = await ask('기준일 변경', [{ key: 'd', label: '새 기준일', type: 'date', value: S.basis }], '변경');
  if (!v?.d || v.d === S.basis) return;
  if (M.bases(S.data.assets).includes(v.d)) return toast('이미 있는 기준일입니다', 'err');
  const rows = basisAssets();
  const old = S.basis;
  rows.forEach((r) => { r.basis = v.d; });
  await guard(async () => { await S.be.putMany('assets', rows); S.basis = v.d; render(); audit('bulk', '기준일 변경', `${old} → ${v.d} · ${rows.length}건`); }, '기준일을 변경했습니다');
}

async function deleteBasis() {
  const rows = basisAssets();
  if (!(await confirmBox('기준일 삭제', `${S.basis} 기준일의 자산 ${rows.length}건을 모두 삭제할까요?`))) return;
  await guard(async () => {
    await S.be.removeMany('assets', rows.map((r) => r.id));
    audit('delete', `자산 기준일 ${S.basis}`, `${rows.length}건 삭제 · 합계 ${M.fmtKRW(summary().total)}원`);
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
    { key: 'amount', label: '금액', type: 'num', w: '130px', amount: {}, placeholder: '예: 3억, 5000만' },
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
      !rows.length ? btn('기본 항목 만들기', () => seed(['liabilities'])) : null),
    h('div', { class: 'kpis' },
      kpi('총부채', `${M.fmtKRW(total)}원`, M.fmtEok(total), 'accent'),
      kpi('연이자 합계', `${M.fmtKRW(interest)}원`, `월 ${M.fmtKRW(interest / 12)}원`),
      kpi('평균 금리 (가중)', total ? M.fmtPct(interest / total, 2) : '—'),
      sum ? kpi('부채비율 (부채/총자산)', M.fmtPct(sum.debtRatio), `부채/순자산 ${sum.net ? M.fmtPct(total / sum.net) : '—'} · ${S.basis}`) : null),
    card('Debt & Liability', grid({ cols, rows, coll: 'liabilities', foot: [{ cls: 'total', cells: ['합계', M.fmtKRW(total), '', total ? M.fmtPct(interest / total, 2) : '', M.fmtKRW(interest), M.fmtKRW(interest / 12), '', ''] }] })));
}


// ---------- 페이지: 부동산 ----------
const RE_LINKS = [['KB부동산 시세', 'https://kbland.kr/'], ['국토부 실거래가', 'https://rt.molit.go.kr/'], ['공시가격 알리미', 'https://www.realtyprice.kr/'], ['호갱노노', 'https://hogangnono.com/']];
const reRows = () => [...S.data.realestate].sort((a, b) => M.num(a.order) - M.num(b.order));

// 부동산 → 현재 기준일 자산 / 받은 임대보증금 → 부채 반영 계획
const latestBasis = () => M.bases(S.data.assets).at(-1) || null;
function rePlan() {
  const props = reRows();
  const libs = S.data.liabilities;
  const target = latestBasis();
  const assets = target ? basisAssets(target) : [];
  const assetOps = [], liabOps = [];
  for (const p of props) {
    const m = M.reMetrics(p, libs);
    const want = { major: '부동산', mid: M.reMid(p), name: p.name || '부동산', currency: 'KRW', value: Math.round(m.value) };
    const a = assets.find((x) => x.reId === p.id);
    if (target && !a) assetOps.push({ kind: 'add', p, want });
    else if (a && ['major', 'mid', 'name', 'currency', 'value'].some((k) => String(a[k]) !== String(want[k]))) assetOps.push({ kind: 'upd', p, a, want });
    const dep = Math.round(m.deposit);
    const l = libs.find((x) => x.reId === p.id);
    const lw = { creditor: `임대보증금 · ${p.name || '부동산'}`, amount: dep };
    if (dep && !l) liabOps.push({ kind: 'add', p, want: lw });
    else if (dep && l && (M.num(l.amount) !== dep || l.creditor !== lw.creditor)) liabOps.push({ kind: 'upd', p, l, want: lw });
    else if (!dep && l) liabOps.push({ kind: 'del', p, l });
  }
  const ids = new Set(props.map((p) => p.id));
  for (const a of assets) if (a.reId && !ids.has(a.reId)) assetOps.push({ kind: 'del', a });
  for (const l of libs) if (l.reId && !ids.has(l.reId)) liabOps.push({ kind: 'del', l });
  return { assetOps, liabOps, count: assetOps.length + liabOps.length, target };
}

async function syncRealestate() {
  const plan = rePlan();
  if (!plan.target) return toast('자산 기준일이 없습니다. 자산 페이지에서 기준일을 먼저 만드세요', 'err');
  if (!plan.count) return toast('이미 자산·부채에 모두 반영되어 있습니다');
  const line = (op, isAsset) => {
    const name = op.p?.name || op.a?.name || op.l?.creditor || '';
    if (isAsset) return op.kind === 'del' ? `자산 삭제: ${name} (부동산 목록에 없음)` : `자산 ${op.kind === 'add' ? '추가' : '갱신'}: ${name} → ${M.fmtKRW(op.want.value)}원 (부동산 › ${op.want.mid})`;
    return op.kind === 'del' ? `부채 삭제: ${name}` : `부채 ${op.kind === 'add' ? '추가' : '갱신'}: ${op.want.creditor} ${M.fmtKRW(op.want.amount)}원`;
  };
  const ok = await modal({ title: `부동산 → ${plan.target} 기준일 반영`, okText: '반영', body: h('div', {},
    h('p', { class: 'muted small' }, '가장 최근 기준일에만 반영합니다 (과거 기준일 기록은 그대로 유지). 시세(지분 반영)를 자산 페이지의 “부동산” 대분류로, 받은 임대보증금은 부채로 반영합니다. 담보대출은 부채 페이지의 대출과 연결만 하므로 중복되지 않습니다.'),
    h('ul', { class: 'plain-list' }, plan.assetOps.map((op) => h('li', { class: op.kind === 'del' ? 'down' : '' }, line(op, true))), plan.liabOps.map((op) => h('li', { class: op.kind === 'del' ? 'down' : '' }, line(op, false))))) });
  if (!ok) return;
  await guard(async () => {
    const aPut = [], aDel = [], lPut = [], lDel = [];
    for (const op of plan.assetOps) {
      if (op.kind === 'del') { aDel.push(op.a.id); continue; }
      ensureMid('부동산', op.want.mid);
      if (op.kind === 'add') {
        const row = { ...op.want, id: M.uid(), basis: plan.target, rate: op.p.rate == null || op.p.rate === '' ? 0.03 : M.num(op.p.rate), manager: op.p.type || '', note: op.p.address || '', reId: op.p.id, order: Date.now() };
        S.data.assets.push(row); aPut.push(row);
      } else { Object.assign(op.a, op.want); aPut.push(op.a); }
    }
    for (const op of plan.liabOps) {
      if (op.kind === 'del') { lDel.push(op.l.id); continue; }
      if (op.kind === 'add') {
        const row = { ...op.want, id: M.uid(), maturity: '', rate: 0, repay: '임대 만기 반환', note: '부동산 페이지에서 자동 생성', reId: op.p.id, order: Date.now() };
        S.data.liabilities.push(row); lPut.push(row);
      } else { Object.assign(op.l, op.want); lPut.push(op.l); }
    }
    if (aPut.length) await S.be.putMany('assets', aPut);
    if (aDel.length) { await S.be.removeMany('assets', aDel); S.data.assets = S.data.assets.filter((a) => !aDel.includes(a.id)); }
    if (lPut.length) await S.be.putMany('liabilities', lPut);
    if (lDel.length) { await S.be.removeMany('liabilities', lDel); S.data.liabilities = S.data.liabilities.filter((l) => !lDel.includes(l.id)); }
    await S.be.saveSettings(S.settings);
    audit('bulk', '부동산 → 자산·부채 반영', `${plan.target} 기준 · 자산 ${aPut.length + aDel.length}건 · 부채 ${lPut.length + lDel.length}건`);
    render();
  }, '자산·부채에 반영했습니다');
}

async function addRealestate() {
  const v = await ask('부동산 추가', [
    { key: 'name', label: '명칭 (예: ○○아파트 101동)' },
    { key: 'type', label: '유형', type: 'select', options: M.RE_TYPES, value: '아파트' },
    { key: 'use', label: '용도', type: 'select', options: M.RE_USES, value: '자가 거주' },
    { key: 'acqDate', label: '취득일', type: 'date', value: '' },
    { key: 'acqPrice', label: '취득가 (예: 8.5억)' },
    { key: 'value', label: '현재 시세 (예: 10억)' },
  ], '추가');
  if (!v) return;
  const amt = (s) => (s ? M.parseAmount(s).value : 0);
  const row = { name: v.name, type: v.type, use: v.use, address: '', area: null, share: null, acqDate: v.acqDate, acqPrice: amt(v.acqPrice), acqCost: 0, value: amt(v.value), loanId: '', deposit: 0, rent: 0, holdCost: 0, rate: null, note: '', valuations: [] };
  if (row.value) M.addValuation(row, row.value);
  await addRow('realestate', row);
}

function pageRealestate() {
  const all = reRows();
  const rows = all.filter((r) => matchFilter(r, ['name', 'type', 'use', 'address', 'note']));
  const libs = S.data.liabilities;
  const rs = M.reSummary(all, libs);
  const mm = new Map(rs.items.map((x) => [x.p.id, x]));
  const m = (r) => mm.get(r.id) || M.reMetrics(r, libs);
  const loanOpts = (row) => libs.filter((l) => !l.reId && !all.some((p) => p.id !== row.id && p.loanId === l.id)).map((l) => ({ value: l.id, label: `${l.creditor || '(이름 없음)'} · ${M.fmtEok(l.amount)}` }));
  const amount = {};
  const cols = [
    { key: 'name', label: '명칭', type: 'text', w: '130px', placeholder: '예: ○○아파트' },
    { key: 'type', label: '유형', type: 'select', options: () => M.RE_TYPES, w: '100px' },
    { key: 'use', label: '용도', type: 'select', options: () => M.RE_USES, w: '96px' },
    { key: 'address', label: '주소', type: 'text', w: '150px' },
    { key: 'area', label: '전용㎡', type: 'num', w: '64px', nullable: true },
    { key: 'share', label: '지분', type: 'pct', w: '64px', nullable: true, placeholder: '100' },
    { key: 'acqDate', label: '취득일', type: 'date', w: '124px' },
    { key: 'acqPrice', label: '취득가', type: 'num', w: '112px', amount, placeholder: '예: 8.5억' },
    { key: 'acqCost', label: '부대비용', type: 'num', w: '96px', amount, placeholder: '취득세·중개' },
    { key: 'value', label: '현재 시세', type: 'num', w: '112px', amount, placeholder: '예: 10억', after: (r) => M.addValuation(r, r.value) },
    { key: 'loanId', label: '담보대출', type: 'select', options: loanOpts, w: '140px' },
    { key: 'deposit', label: '받은 보증금', type: 'num', w: '104px', amount },
    { key: 'rent', label: '월세 수입', type: 'num', w: '90px', amount },
    { key: 'holdCost', label: '연 보유비용', type: 'num', w: '100px', amount, placeholder: '재산세·관리비' },
    { key: 'gain', label: '평가손익', type: 'calc', calc: (r) => m(r).gain, cls: (r) => (m(r).gain < 0 ? 'down' : m(r).gain > 0 ? 'up' : '') },
    { key: 'gainRate', label: '수익률', type: 'calc', fmt: 'pct', calc: (r) => m(r).gainRate ?? '' },
    { key: 'ltv', label: 'LTV', type: 'calc', fmt: 'pct', calc: (r) => m(r).ltv, cls: (r) => (m(r).ltv > 0.7 ? 'over' : '') },
    { key: 'equity', label: '순지분', type: 'calc', calc: (r) => m(r).equity, databar: true, databarMax: Math.max(1, ...rs.items.map((x) => x.equity)) },
    { key: 'yield', label: '임대수익률', type: 'calc', fmt: 'pct', calc: (r) => m(r).grossYield ?? '' },
    { key: 'note', label: '메모', type: 'text', w: '120px' },
  ];
  const foot = [{ cls: 'total', cells: ['합계', '', '', '', '', '', '', M.fmtKRW(rs.cost), '', M.fmtKRW(rs.value), M.fmtKRW(rs.loan), M.fmtKRW(rs.deposit), M.fmtKRW(rs.annualRent / 12), M.fmtKRW(rs.holdCost), M.fmtKRW(rs.gain), rs.gainRate == null ? '' : M.fmtPct(rs.gainRate), M.fmtPct(rs.ltv), M.fmtKRW(rs.equity), rs.grossYield == null ? '' : M.fmtPct(rs.grossYield), ''] }];
  const plan = all.length ? rePlan() : null;
  const sum = S.basis ? summary() : null;

  // 시세 추이 (억원, 지분 반영, 취득가 포함)
  const isDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || '');
  const dates = [...new Set(all.flatMap((p) => [p.acqDate, ...(p.valuations || []).map((v) => v.date)]).filter(isDate))].sort();
  const series = all.map((p, i) => {
    const pts = new Map((p.valuations || []).map((v) => [v.date, M.num(v.value)]));
    if (isDate(p.acqDate) && M.num(p.acqPrice) && !pts.has(p.acqDate)) pts.set(p.acqDate, M.num(p.acqPrice));
    const c = PALETTE[i % PALETTE.length];
    return { label: p.name || `부동산 ${i + 1}`, data: dates.map((d) => (pts.has(d) ? +((pts.get(d) * M.reShare(p)) / 1e8).toFixed(3) : null)), borderColor: c, backgroundColor: c, spanGaps: true, tension: 0.2, pointRadius: 3 };
  });
  const analysis = h('table', { class: 'grid compact' },
    h('thead', {}, h('tr', {}, ['명칭', '보유기간', '연환산 상승률', '연 임대수입', '연 보유비용', '연 대출이자', '연 순수익', '자기자본 수익률'].map((t, i) => h('th', { class: i ? 'r' : '' }, t)))),
    h('tbody', {}, rs.items.map((x) => h('tr', {},
      h('td', {}, h('b', {}, x.p.name || '—'), h('div', { class: 'muted small' }, [x.p.type, x.p.use, x.loanName ? `대출: ${x.loanName}` : ''].filter(Boolean).join(' · '))),
      h('td', { class: 'r' }, x.years == null ? '—' : `${x.years.toFixed(1)}년`),
      h('td', { class: `r ${x.cagr == null ? '' : x.cagr >= 0 ? 'up' : 'down'}` }, x.cagr == null ? '—' : M.fmtPct(x.cagr)),
      h('td', { class: 'r' }, M.fmtKRW(x.annualRent)),
      h('td', { class: 'r' }, M.fmtKRW(x.holdCost)),
      h('td', { class: 'r' }, x.loan ? `${M.fmtKRW(x.interest)} (${M.fmtPct(x.loanRate, 2)})` : '0'),
      h('td', { class: `r ${x.netIncome < 0 ? 'down' : ''}` }, M.fmtKRW(x.netIncome)),
      h('td', { class: 'r' }, x.cashOnCash == null ? '—' : M.fmtPct(x.cashOnCash))))));

  return h('div', { class: 'stack' },
    toolbar(btn('+ 부동산 추가', addRealestate, 'primary'),
      btn(`자산·부채에 반영${plan?.count ? ` (${plan.count})` : ''}`, syncRealestate, '', { disabled: !all.length, title: '시세 → 자산(부동산), 받은 보증금 → 부채' }),
      h('span', { class: 'spacer' }), searchBox()),
    plan?.count && plan.target ? h('div', { class: 'banner' }, `최근 자산 기준일 ${plan.target} 과 다른 항목이 ${plan.count}건 있습니다 — “자산·부채에 반영” 을 누르면 순자산에 포함됩니다`) : null,
    all.length && !plan?.target ? h('div', { class: 'banner' }, '자산 기준일이 없어 순자산에 반영할 수 없습니다. 자산 페이지에서 기준일을 먼저 만드세요.') : null,
    h('div', { class: 'kpis' },
      kpi('부동산 시세 합계', `${M.fmtEok(rs.value)}원`, `${rs.count}건 · 취득원가 ${M.fmtEok(rs.cost)}원${sum?.total ? ` · 총자산의 ${M.fmtPct((sum.byMajor['부동산'] || 0) / sum.total)}` : ''}`, 'accent'),
      kpi('순지분', `${M.fmtEok(rs.equity)}원`, `시세 − 담보대출 ${M.fmtEok(rs.loan)} − 보증금 ${M.fmtEok(rs.deposit)}`),
      kpi('평가손익', `${M.fmtEok(rs.gain)}원`, rs.gainRate == null ? '취득가를 입력하면 계산됩니다' : `수익률 ${M.fmtPct(rs.gainRate)}`),
      kpi('LTV (대출 ÷ 시세)', M.fmtPct(rs.ltv), rs.ltv > 0.7 ? '⚠ 70% 초과 — 금리 상승에 취약' : '담보대출 연결 시 계산'),
      kpi('연 임대 순수익', `${M.fmtEok(rs.netIncome)}원`, `월세 ${M.fmtEok(rs.annualRent / 12)} · 보유비용 ${M.fmtEok(rs.holdCost)} · 이자 ${M.fmtEok(rs.interest)}`)),
    card(cardHead('보유 부동산', '금액은 “10억”, “8.5억”, “3000만” 처럼 입력할 수 있습니다. 시세를 바꾸면 그날 날짜로 시세 이력이 쌓입니다. 공동명의는 지분(%)을, 담보대출은 부채 페이지에 등록한 뒤 연결하세요.'),
      grid({ cols, rows, coll: 'realestate', foot, label: (r) => r.name })),
    all.length ? h('div', { class: 'grid-2' },
      card(cardHead('시세 추이', '억원 · 지분 반영 · 취득가 포함'), dates.length > 1 ? chart('c-re-trend', { type: 'line', data: { labels: dates, datasets: series }, options: { maintainAspectRatio: false, plugins: { tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${c.raw}억` } } }, scales: { y: { ticks: { callback: (v) => `${v}억` } } } } }, '260px') : h('p', { class: 'muted' }, '취득일·취득가를 입력하거나 시세를 두 번 이상 갱신하면 추이가 표시됩니다.')),
      card(cardHead('자본 구조', '물건별 순지분 · 담보대출 · 받은 보증금 (억원)'), chart('c-re-cap', { type: 'bar', data: { labels: rs.items.map((x) => x.p.name || '—'), datasets: [
        { label: '순지분', data: rs.items.map((x) => +(Math.max(0, x.equity) / 1e8).toFixed(3)), backgroundColor: PALETTE[1] },
        { label: '담보대출', data: rs.items.map((x) => +(x.loan / 1e8).toFixed(3)), backgroundColor: PALETTE[4] },
        { label: '받은 보증금', data: rs.items.map((x) => +(x.deposit / 1e8).toFixed(3)), backgroundColor: PALETTE[2] }] },
        options: { indexAxis: 'y', maintainAspectRatio: false, scales: { x: { stacked: true }, y: { stacked: true } } } }, `${Math.max(160, rs.count * 46 + 60)}px`))) : null,
    all.length ? card(cardHead('투자 분석', '연환산 상승률 = (시세 ÷ 취득원가)^(1/보유연수) − 1 · 자기자본 수익률 = 연 순수익 ÷ 순지분'), analysis) : null,
    card(cardHead('시세 확인 바로가기', '외부 사이트에서 시세를 확인한 뒤 “현재 시세” 칸에 입력하세요'), h('div', { class: 'row' }, RE_LINKS.map(([t, u]) => h('a', { class: 'btn small', href: u, target: '_blank', rel: 'noopener' }, t)))));
}

// ---------- 페이지: 현금흐름 ----------
function pageCashflow() {
  const years = cfYears();
  if (!years.length) {
    return card('현금흐름 (Cash Flow)', emptyState('현금흐름 데이터가 없습니다.', [btn('기본 항목 만들기', () => seed(['cashflow']), 'primary')]));
  }
  const rows = S.data.cashflow.filter((r) => M.num(r.year) === S.cfYear)
    .sort((a, b) => (a.type === b.type ? 0 : a.type === '수입' ? -1 : 1) || M.num(a.order) - M.num(b.order));
  const cf = M.cashflowSummary(rows);
  const tot = (arr) => arr.reduce((s, v) => s + v, 0);
  const cols = [
    { key: 'type', label: '구분', type: 'select', options: () => ['수입', '지출'], w: '72px', after: (r) => { if (!M.CF_GROUPS[r.type]?.includes(r.group)) r.group = M.CF_GROUPS[r.type]?.[0] || ''; } },
    { key: 'group', label: '그룹', type: 'select', options: (r) => M.CF_GROUPS[r.type] || [], w: '90px' },
    { key: 'name', label: '항목', type: 'text', w: '110px' },
    { key: 'budget', label: '월예산', type: 'num', w: '66px', placeholder: '지출' },
    ...Array.from({ length: 12 }, (_, i) => ({ key: `m${i}`, label: `${i + 1}월`, type: 'num', w: '64px', get: (r) => M.num(r.m?.[i]), set: (r, v) => { (r.m ||= Array(12).fill(0))[i] = v; } })),
    { key: 'sum', label: '합계', type: 'calc', fmt: 'num', calc: (r) => tot((r.m || []).map(M.num)) },
    { key: 'vsBudget', label: '예산대비', type: 'calc', fmt: 'pct', calc: (r) => { const b = M.num(r.budget); if (!b) return ''; const ms = (r.m || []).map(M.num).filter((v, i) => cf.inc[i] || cf.out[i]); return ms.length ? ms.reduce((a, c) => a + c, 0) / ms.length / b : ''; }, cls: (r) => { const b = M.num(r.budget); if (!b) return ''; const ms = (r.m || []).map(M.num).filter((v, i) => cf.inc[i] || cf.out[i]); return ms.length && ms.reduce((a, c) => a + c, 0) / ms.length > b ? 'over' : ''; } },
  ];
  const line = (label, arr, cls) => ({ cls, cells: [label, '', '', '', ...arr.map((v) => M.fmtNum(v)), M.fmtNum(tot(arr)), ''] });
  const monthIdx = S.cfYear === thisYear() ? new Date().getMonth() : 11;
  const bud = M.budgetStatus(rows, monthIdx);
  const budTotal = bud.reduce((s, b) => s + b.budget, 0), budActual = bud.reduce((s, b) => s + b.actual, 0);
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
      bud.length ? kpi(`${monthIdx + 1}월 예산 대비`, `${M.fmtNum(budActual)} / ${M.fmtNum(budTotal)}만원`, bud.filter((b) => b.ratio > 1).length ? `초과 ${bud.filter((b) => b.ratio > 1).map((b) => b.name).join(', ')}` : '모든 항목 예산 내') : kpi('월평균 지출', `${M.fmtNum(tot(cf.out) / 12, 1)}만원`, '지출 행에 월예산을 넣으면 예산 대비 분석')),
    card(`${S.cfYear} Cash Flow`, grid({
      cols, rows, coll: 'cashflow', label: (r) => r.name,
      rowClass: (r) => (r.type === '수입' ? 'inc' : 'out'),
      foot: [line('수입 합계 (A)', cf.inc), line('지출 합계 (B)', cf.out), line('Net Income (A-B)', cf.net, 'total'), { cls: 'muted-row', cells: ['누적 순이익', '', '', '', ...cf.cum.map((v) => M.fmtNum(v)), M.fmtNum(cf.cum[11]), ''] }],
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
      kpi('연평균 성장률 (CAGR)', Number.isFinite(cagr) ? M.fmtPct(cagr) : '—', `${first.date} → ${last.date}`),
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
    onchange: (e) => {
      const p = M.parseAmount(e.target.value);
      let v = pct ? M.num(e.target.value) / 100 : p.value;
      // 정수 슬라이더(연수·나이)는 정수로, 범위 밖 값은 범위 안으로
      if (!pct && Number.isInteger(step) && step >= 1) v = Math.max(min, Math.min(max, Math.round(v)));
      if (!Number.isFinite(v)) v = min;
      obj[key] = v; onchange();
    },
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
  if (!S.sim || S.simBasis !== S.basis || (S.sim.net === 0 && simDefaults().net)) { S.sim = simDefaults(); S.simBasis = S.basis; }
  if (!S.simTab) S.simTab = 'project';
  const tabs = [['project', '순자산 전망'], ['rebalance', '리밸런싱'], ['debt', '부채 상환'], ['fire', '은퇴 · FIRE']];
  const tabBar = h('div', { class: 'tabs' }, tabs.map(([id, label]) => h('button', { class: `tab ${S.simTab === id ? 'active' : ''}`, onclick: () => { S.simTab = id; render(); } }, label)));
  const body = S.simTab === 'project' ? simProject() : S.simTab === 'rebalance' ? simRebalance() : S.simTab === 'debt' ? simDebt() : simFire();
  return h('div', { class: 'stack' }, tabBar, body);
}

// 은퇴 · FIRE 계산기 (Wealthfront Path / Empower Retirement Planner 벤치마크)
function fireDefaults() {
  const d = simDefaults();
  const cfRows = S.data.cashflow.filter((r) => M.num(r.year) === (S.cfYear ?? thisYear()));
  return { net: d.net, monthlySave: d.monthlySave, annualRate: d.annualRate || 0.06, annualExpense: Math.round(M.monthlyExpense(cfRows) * 12) || 36000000, swr: 0.04, inflation: 0.025, saveGrowth: 0.03, age: M.currentAge(S.data.history) || 30, retireAge: 55 };
}
// 목표 나이까지 도달하려면 필요한 월 저축액 (이분 탐색)
function requiredSave(f, years) {
  if (years <= 0) return null;
  const ok = (s) => M.fireSim({ ...f, monthlySave: s, years }).reach != null;
  if (ok(f.monthlySave)) return f.monthlySave;
  let lo = 0, hi = 5e7;
  if (!ok(hi)) return null;
  for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; ok(mid) ? (hi = mid) : (lo = mid); }
  return Math.ceil(hi / 1e4) * 1e4;
}
function simFire() {
  if (!S.fire || S.fireBasis !== S.basis || (S.fire.net === 0 && simDefaults().net)) { S.fire = fireDefaults(); S.fireBasis = S.basis; }
  const f = S.fire;
  const rerender = () => render();
  const r = M.fireSim({ ...f, years: 45 });
  const toRetire = Math.max(0, f.retireAge - f.age);
  const need = requiredSave(f, toRetire);
  const variants = [['Lean FIRE', 0.7], ['FIRE', 1], ['Fat FIRE', 1.5]];
  const swrs = [0.03, 0.035, 0.04, 0.05];
  const span = Math.min(45, Math.max(10, (r.reach ?? 30) + 5));
  const series = r.series.slice(0, span + 1);
  const chartCfg = {
    type: 'line',
    data: {
      labels: series.map((p) => (p.year === 0 ? '현재' : `${thisYear() + p.year} (${f.age + p.year}세)`)),
      datasets: [
        { label: '예상 순자산', data: series.map((p) => Math.round(p.nominal)), borderColor: PALETTE[0], backgroundColor: 'rgba(59,111,240,0.12)', fill: true, tension: 0.3, pointRadius: 0, borderWidth: 2.5 },
        { label: 'FIRE 목표 (물가 반영)', data: series.map((p) => Math.round(r.fireNumber * Math.pow(1 + f.inflation, p.year))), borderColor: PALETTE[2], backgroundColor: PALETTE[2], borderDash: [6, 4], pointRadius: 0, borderWidth: 1.5 },
      ],
    },
    options: { maintainAspectRatio: false, animation: false, interaction: { mode: 'index', intersect: false }, scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 10 } }, y: { ticks: { callback: (v) => M.fmtEok(v) }, grid: { color: cssVar('--line') } } }, plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, usePointStyle: true } }, tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${M.fmtKRW(c.raw)}원` } } } },
  };
  return h('div', { class: 'stack' },
    h('div', { class: 'grid-2 wide-right' },
      card(cardHead('가정', '연 생활비 ÷ 인출률 = 은퇴에 필요한 자산', btn('현재 데이터로 초기화', () => { S.fire = fireDefaults(); render(); }, 'small')),
        h('div', { class: 'sim-fields' },
          slider('은퇴 후 연 생활비', 'annualExpense', f, { min: 1e7, max: 2e8, step: 1e6, onchange: rerender }),
          slider('안전 인출률 (SWR)', 'swr', f, { min: 2, max: 6, step: 0.25, pct: true, onchange: rerender }),
          slider('시작 순자산', 'net', f, { min: 0, max: 2e9, step: 1e6, onchange: rerender }),
          slider('월 저축액', 'monthlySave', f, { min: 0, max: 1e7, step: 1e5, onchange: rerender }),
          slider('연 수익률', 'annualRate', f, { min: 0, max: 15, step: 0.5, pct: true, onchange: rerender }),
          slider('물가상승률', 'inflation', f, { min: 0, max: 6, step: 0.1, pct: true, onchange: rerender }),
          slider('현재 나이', 'age', f, { min: 18, max: 70, step: 1, fmt: (v) => `${v}세`, onchange: rerender }),
          slider('목표 은퇴 나이', 'retireAge', f, { min: 30, max: 80, step: 1, fmt: (v) => `${v}세`, onchange: rerender }))),
      h('div', { class: 'stack' },
        h('div', { class: 'kpis' },
          kpi('FIRE 목표 자산', `${M.fmtEok(r.fireNumber)}원`, `연 ${M.fmtEok(f.annualExpense)}원 ÷ ${M.fmtPct(f.swr, 2)} · 현재 ${M.fmtPct(r.coverage, 0)} 달성`, 'accent'),
          kpi('경제적 자유 도달', r.reach == null ? '45년 내 미달' : r.reach === 0 ? '지금 가능' : `${r.reach}년 후 · ${f.age + r.reach}세`, r.reach != null ? `${thisYear() + r.reach}년 예상` : '저축액이나 수익률을 조정해 보세요'),
          kpi(`${f.retireAge}세 은퇴에 필요한 월 저축`, need == null ? (toRetire ? '월 5천만원으로도 불가' : '—') : `${M.fmtEok(need)}원`, need != null && need > f.monthlySave ? `현재보다 ${M.fmtEok(need - f.monthlySave)}원 더` : need != null ? '현재 저축으로 충분' : `남은 기간 ${toRetire}년`),
          kpi('코스트 FIRE', r.coastYears == null ? '해당 없음' : r.coastYears === 0 ? '달성' : `${r.coastYears}년 후`, '추가 저축 없이 현재 자산의 성장만으로 목표에 도달하는 시점')),
        card(cardHead('순자산 vs FIRE 목표', `목표선은 물가상승률 ${M.fmtPct(f.inflation)} 을 반영해 매년 오릅니다`), chart('c-fire', chartCfg, '300px')),
        card(cardHead('생활비 수준 × 인출률 매트릭스', '칸: 필요 자산 / 도달 시점'), h('div', { class: 'table-wrap' }, h('table', { class: 'grid compact' },
          h('thead', {}, h('tr', {}, h('th', {}, '시나리오'), swrs.map((s) => h('th', { class: 'r' }, `SWR ${M.fmtPct(s, 1)}`)))),
          h('tbody', {}, variants.map(([label, k]) => h('tr', { class: k === 1 ? 'inc' : '' }, h('td', {}, h('b', {}, label), h('span', { class: 'muted small' }, ` 연 ${M.fmtEok(f.annualExpense * k)}`)),
            swrs.map((s) => { const v = M.fireSim({ ...f, annualExpense: f.annualExpense * k, swr: s, years: 45 }); return h('td', { class: 'r' }, h('div', {}, M.fmtEok(v.fireNumber)), h('small', { class: v.reach == null ? 'down' : 'muted' }, v.reach == null ? '미달' : v.reach === 0 ? '달성' : `${v.reach}년 · ${f.age + v.reach}세`)); }))))))),
        h('p', { class: 'muted small' }, '4% 규칙(Trinity Study)은 미국 주식·채권 기준의 경험칙입니다. 한국 거주자는 국민연금·퇴직연금 수령액을 생활비에서 차감해 계산하면 더 현실적입니다.'))));
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
  if (!S.rebal || S.rebalBasis !== S.basis) { S.rebal = Object.fromEntries(S.settings.taxonomy.map((t) => t.major).filter((m) => (sum.byMajor[m] || 0) > 0).map((m) => [m, sum.total ? +(((sum.byMajor[m] || 0) / sum.total) * 100).toFixed(1) : 0])); S.rebalBasis = S.basis; }
  const majors = S.settings.taxonomy.map((t) => t.major).filter((m) => (sum.byMajor[m] || 0) > 0 || S.rebal?.[m]);
  const tgtSum = majors.reduce((s, m) => s + M.num(S.rebal[m]), 0);
  const rows = M.rebalance(sum.byMajor, S.rebal, sum.total).filter((r) => majors.includes(r.major));
  const groupOf = Object.fromEntries(S.settings.taxonomy.map((t) => [t.major, t.group]));
  const rateOf = (m) => { const as = basisAssets().filter((a) => a.major === m); const k = as.reduce((s, a) => s + M.toKRW(a, S.settings.fx), 0); return k ? as.reduce((s, a) => s + M.toKRW(a, S.settings.fx) * M.num(a.rate), 0) / k : 0; };
  const after = rows.reduce((acc, r) => { acc.profit += r.target * rateOf(r.major); if (groupOf[r.major] === 'Risk') acc.risk += r.target; if (groupOf[r.major] === 'Var') acc.var += r.target; return acc; }, { profit: 0, risk: 0, var: 0 });
  const age = M.currentAge(S.data.history);
  const gt = M.glideTarget(age) * 100;
  const presets = {
    [`연령 기준 (${age ? `만 ${age}세` : '나이 미상'} · 위험 ${Math.round(gt)}%)`]: { 투자: Math.round(gt * 0.7), 가상자산: Math.round(gt * 0.2), 대체투자: Math.round(gt * 0.1), 현금: Math.round((100 - gt) * 0.5), 채권형자산: Math.round((100 - gt) * 0.25), '연금/보험': 100 - Math.round(gt * 0.7) - Math.round(gt * 0.2) - Math.round(gt * 0.1) - Math.round((100 - gt) * 0.5) - Math.round((100 - gt) * 0.25) },
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
    accountCard(),
    aiSettingsCard(),
    card(cardHead('엑셀', '시트: 자산(B.S) · 부채(D.L) · 부동산 · 현금흐름(C.F) · 연도별추이 · 포트폴리오 · KPI · 시나리오 · AI리포트 · 소비내역 · 관리목표 · 환율 · 분류체계'),
      h('div', { class: 'row' }, btn('엑셀 다운로드', downloadExcel, 'primary'), btn('엑셀 업로드', pickUpload), btn('빈 양식 다운로드', downloadTemplate))),
    card(cardHead('데이터', S.be.kind === 'firebase' ? `Firebase Firestore 에 저장 중 · ${S.user?.email || ''}` : '로컬 모드: 이 브라우저(localStorage)에만 저장됩니다.'),
      h('div', { class: 'row' },
        btn('JSON 전체 백업', downloadJson), btn('JSON 복원', pickJson),
        btn('비어있는 항목에 기본 구조 채우기', () => seed(COLLECTIONS)),
        btn('전체 데이터 초기화', resetAll, 'ghost-danger'))),
    card(cardHead('화면'), h('div', { class: 'row' },
      btn('라이트 / 다크 전환', toggleTheme),
      btn('시스템 설정 따르기', () => { applyTheme(null); render(); }),
      btn('현재 화면 인쇄 / PDF', () => window.print()))),
    myLogsCard());
}

// ---------- 페이지: 소비내역 ----------
const txMonths = () => [...new Set(S.data.transactions.map((r) => String(r.date).slice(0, 7)).filter((m) => /^\d{4}-\d{2}$/.test(m)))].sort();
const curMonth = () => M.today().slice(0, 7);

function pageTransactions() {
  const months = txMonths();
  if (!S.txMonth || !(months.includes(S.txMonth) || S.txMonth === curMonth())) S.txMonth = months.includes(curMonth()) ? curMonth() : months[months.length - 1] || curMonth();
  const year = Number(S.txMonth.slice(0, 4)), mi = Number(S.txMonth.slice(5, 7)) - 1;
  const all = S.data.transactions.filter((r) => String(r.date).startsWith(S.txMonth)).sort((a, b) => String(b.date).localeCompare(String(a.date)) || M.num(b.order) - M.num(a.order));
  const rows = all.filter((r) => matchFilter(r, ['desc', 'category', 'method', 'note', 'date']));
  const ts = M.txSummary(S.data.transactions, year);
  const spent = ts.byMonth[mi];
  const prevSpent = mi > 0 ? ts.byMonth[mi - 1] : M.txSummary(S.data.transactions, year - 1).byMonth[11];
  const cats = Object.entries(ts.byMonthCat[mi] || {}).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const daysInMonth = new Date(year, mi + 1, 0).getDate();
  const isCur = S.txMonth === curMonth();
  const dayN = isCur ? new Date().getDate() : daysInMonth;
  const income = all.filter((r) => r.type === '수입').reduce((s, r) => s + Math.abs(M.num(r.amount)), 0);
  const ready = aiReady(aiState().cfg);
  const catList = [...new Set([...M.TX_CATEGORIES, ...S.data.transactions.map((r) => r.category).filter(Boolean)])];
  const descList = [...new Set(S.data.transactions.map((r) => r.desc).filter(Boolean))].sort();
  const methodList = [...new Set(S.data.transactions.map((r) => r.method).filter(Boolean))].sort();
  const autoCat = (r) => { if (r.category && r.category !== '기타') return; const c = M.classifyTx(r.desc); if (c) { r.category = c; if (c === '급여') r.type = '수입'; } };
  const cols = [
    { key: 'date', label: '날짜', type: 'date', w: '126px' },
    { key: 'type', label: '구분', type: 'select', options: () => ['지출', '수입'], w: '70px' },
    { key: 'desc', label: '내용', type: 'text', w: '180px', list: 'dl-tx-desc', after: autoCat },
    { key: 'category', label: '카테고리', type: 'select', options: () => catList, w: '110px' },
    { key: 'amount', label: '금액', type: 'num', w: '110px', amount: {}, placeholder: '예: 1.2만' },
    { key: 'method', label: '결제수단', type: 'text', w: '100px', list: 'dl-tx-method' },
    { key: 'note', label: '메모', type: 'text', w: '140px' },
  ];
  // 일별 누적 (이번 달 vs 전월)
  const daily = (ym) => { const arr = Array(31).fill(0); for (const r of S.data.transactions) if (String(r.date).startsWith(ym) && r.type !== '수입') arr[Number(String(r.date).slice(8, 10)) - 1] += Math.abs(M.num(r.amount)); let c = 0; return arr.map((v) => (c += v)); };
  const prevYm = mi > 0 ? `${year}-${String(mi).padStart(2, '0')}` : `${year - 1}-12`;
  const cumCur = daily(S.txMonth).slice(0, dayN), cumPrev = daily(prevYm);
  const monthSel = select([...new Set([...months, curMonth()])].sort().reverse().map((m) => ({ value: m, label: m })), S.txMonth, (v) => { S.txMonth = v; render(); }, { placeholder: false });
  return h('div', { class: 'stack' },
    h('datalist', { id: 'dl-tx-desc' }, descList.slice(0, 500).map((n) => h('option', { value: n }))),
    h('datalist', { id: 'dl-tx-method' }, methodList.map((n) => h('option', { value: n }))),
    toolbar(h('label', { class: 'inline' }, '월', monthSel),
      btn('+ 지출', () => addRow('transactions', { date: isCur ? M.today() : `${S.txMonth}-01`, type: '지출', desc: '', category: '기타', amount: 0, method: '', note: '' }, 'desc'), 'primary'),
      btn('+ 수입', () => addRow('transactions', { date: isCur ? M.today() : `${S.txMonth}-01`, type: '수입', desc: '', category: '급여', amount: 0, method: '', note: '' }, 'desc')),
      btn('⬆ 명세 가져오기', pickStatement, '', { title: '카드사·은행 이용내역(엑셀/CSV)을 올리면 열을 자동 인식해 추가합니다' }),
      btn('⬇ 소비내역 다운로드', () => exportTransactions(S.data.transactions, stampName('소비내역'))),
      btn('현금흐름에 반영', syncTxToCashflow, '', { title: `${S.txMonth} 카테고리별 합계를 현금흐름(C.F) 지출 행에 기록` }),
      btn('✨ 자동 분류', autoClassifyTx, '', { title: '키워드로 카테고리 자동 지정' }),
      ready ? btn('🤖 AI 분류', aiClassifyTx, '', { title: '미분류 거래를 OpenAI 로 분류' }) : null,
      all.length ? btn('이 달 삭제', deleteTxMonth, 'ghost-danger') : null,
      h('span', { class: 'spacer' }), searchBox()),
    h('div', { class: 'kpis' },
      kpi(`${S.txMonth} 지출`, `${M.fmtKRW(spent)}원`, diff(spent, prevSpent || null) || `전월 ${M.fmtEok(prevSpent)}원`, 'accent'),
      kpi('일평균 · 월말 예상', `${M.fmtEok(dayN ? spent / dayN : 0)}원`, isCur ? `이 추세면 월말 ${M.fmtEok((spent / dayN) * daysInMonth)}원` : `${daysInMonth}일 기준`),
      kpi('최다 카테고리', cats[0] ? cats[0][0] : '—', cats[0] ? `${M.fmtEok(cats[0][1])}원 · ${M.fmtPct(spent ? cats[0][1] / spent : 0)}` : '거래를 추가하세요'),
      kpi('거래 · 수입', `${all.length}건`, income ? `수입 ${M.fmtEok(income)}원 · 저축 가능 ${M.fmtEok(income - spent)}원` : '수입 거래 없음')),
    h('div', { class: 'grid-2' },
      card(cardHead('카테고리별 지출', S.txMonth), cats.length ? h('div', { class: 'donut-wrap' }, chart('c-txcat', {
        type: 'doughnut',
        data: { labels: cats.map(([k]) => k), datasets: [{ data: cats.map(([, v]) => Math.round(v)), backgroundColor: cats.map((_, i) => PALETTE[i % PALETTE.length]), borderWidth: 0, hoverOffset: 6 }] },
        options: { maintainAspectRatio: false, cutout: '66%', plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ` ${c.label}: ${M.fmtKRW(c.raw)}원 (${M.fmtPct(c.raw / spent)})` } } } },
      }, '200px'), h('ul', { class: 'legend' }, cats.map(([k, v], i) => h('li', {}, h('i', { style: { background: PALETTE[i % PALETTE.length] } }), h('span', {}, k), h('b', {}, `${M.fmtEok(v)} · ${M.fmtPct(v / spent, 0)}`))))) : h('p', { class: 'muted' }, '이 달 지출 거래가 없습니다. “명세 가져오기” 로 카드 내역을 올려 보세요.')),
      card(cardHead('일별 누적 지출', `${S.txMonth} vs 전월 ${prevYm}`), chart('c-txcum', {
        type: 'line',
        data: { labels: Array.from({ length: daysInMonth }, (_, i) => `${i + 1}일`), datasets: [
          { label: S.txMonth, data: cumCur.map(Math.round), borderColor: PALETTE[0], backgroundColor: 'rgba(59,111,240,0.12)', fill: true, tension: 0.2, pointRadius: 0, borderWidth: 2.5 },
          { label: `전월 ${prevYm}`, data: cumPrev.map(Math.round), borderColor: PALETTE[9], backgroundColor: PALETTE[9], borderDash: [4, 3], tension: 0.2, pointRadius: 0, borderWidth: 1.5 },
        ] },
        options: { maintainAspectRatio: false, animation: false, interaction: { mode: 'index', intersect: false }, scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 8 } }, y: { ticks: { callback: (v) => M.fmtEok(v) }, grid: { color: cssVar('--line') } } }, plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, usePointStyle: true } }, tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${M.fmtKRW(c.raw)}원` } } } },
      }, '240px'))),
    card(null, grid({ cols, rows, coll: 'transactions', label: (r) => r.desc, rowClass: (r) => (r.type === '수입' ? 'inc' : ''), reorder: false, foot: [{ cls: 'total', cells: ['합계', '', '', '', M.fmtKRW(rows.filter((r) => r.type !== '수입').reduce((s, r) => s + Math.abs(M.num(r.amount)), 0)), '', ''] }] }),
      S.filter ? h('p', { class: 'muted small' }, `검색 결과 ${rows.length} / ${all.length} 건`) : null),
    card(cardHead(`${year}년 월별 지출 추이`, '소비내역 합계 (원)'), chart('c-txyear', {
      type: 'bar',
      data: { labels: Array.from({ length: 12 }, (_, i) => `${i + 1}월`), datasets: [{ label: '지출', data: ts.byMonth.map(Math.round), backgroundColor: ts.byMonth.map((_, i) => (i === mi ? PALETTE[0] : PALETTE[9])), borderRadius: 5, borderSkipped: false, maxBarThickness: 40 }] },
      options: { maintainAspectRatio: false, animation: false, scales: { x: { grid: { display: false } }, y: { ticks: { callback: (v) => M.fmtEok(v) }, grid: { color: cssVar('--line') } } }, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ` ${M.fmtKRW(c.raw)}원` } } } },
    }, '200px')));
}

function pickStatement() {
  const input = h('input', { type: 'file', accept: '.xlsx,.xls,.csv' });
  input.onchange = async () => {
    const f = input.files[0];
    if (!f) return;
    try {
      const parsed = parseStatement(await f.arrayBuffer(), f.name);
      if (!parsed) return toast('날짜·금액 열을 찾지 못했습니다. 첫 행에 “날짜/이용일”, “금액/이용금액” 같은 헤더가 있어야 합니다.', 'err');
      const existing = new Set(S.data.transactions.map(M.txKey));
      const fresh = parsed.rows.filter((r) => !existing.has(M.txKey(r)));
      const dup = parsed.rows.length - fresh.length;
      const auto = h('input', { type: 'checkbox', checked: true });
      const ok = await modal({ title: '명세 가져오기', okText: `${fresh.length}건 추가`, body: h('div', { class: 'stack', style: { gap: '8px' } },
        h('p', {}, h('b', {}, f.name), ` · 시트 “${parsed.sheet}” 에서 ${parsed.rows.length}건 인식 (건너뜀 ${parsed.skipped}행)`),
        h('p', { class: 'muted small' }, `열 인식: 날짜=${parsed.mapping.date} · 금액=${parsed.mapping.amount} · 내용=${parsed.mapping.desc || '없음'} · 입금=${parsed.mapping.income || '없음'} · 결제수단=${parsed.mapping.method || '파일명'}`),
        dup ? h('p', { class: 'warn small' }, `이미 있는 거래 ${dup}건은 제외합니다 (날짜+내용+금액 기준)`) : null,
        h('label', { class: 'check' }, auto, ' 내용 키워드로 카테고리 자동 분류'),
        h('div', { class: 'table-wrap' }, h('table', { class: 'grid compact' }, h('thead', {}, h('tr', {}, h('th', {}, '날짜'), h('th', {}, '내용'), h('th', { class: 'r' }, '금액'))),
          h('tbody', {}, fresh.slice(0, 8).map((r) => h('tr', {}, h('td', {}, r.date), h('td', {}, r.desc), h('td', { class: 'r' }, `${r.type === '수입' ? '+' : ''}${M.fmtKRW(r.amount)}`)))))),
        fresh.length > 8 ? h('p', { class: 'muted small' }, `… 외 ${fresh.length - 8}건`) : null) });
      if (!ok || !fresh.length) return;
      const rows = fresh.map((r, i) => ({ id: M.uid() + i, order: Date.now() + i, date: r.date, type: r.type, desc: r.desc, category: r.category || (auto.checked && M.classifyTx(r.desc)) || (r.type === '수입' ? '급여' : '기타'), amount: r.amount, method: r.method || '', note: '' }));
      await guard(async () => { await S.be.putMany('transactions', rows); S.data.transactions.push(...rows); S.txMonth = rows.map((r) => r.date.slice(0, 7)).sort().pop(); render(); }, `${rows.length}건을 추가했습니다`);
    } catch (e) { console.error(e); toast(`가져오기 실패: ${e.message}`, 'err'); }
  };
  input.click();
}

async function autoClassifyTx() {
  const rows = S.data.transactions.filter((r) => String(r.date).startsWith(S.txMonth));
  const changed = [];
  for (const r of rows) { if (r.category && r.category !== '기타') continue; const c = M.classifyTx(r.desc); if (c && c !== r.category) { r.category = c; changed.push(r); } }
  if (!changed.length) return toast('분류할 거래가 없습니다');
  render();
  await guard(() => S.be.putMany('transactions', changed), `${changed.length}건을 자동 분류했습니다`);
}

async function aiClassifyTx() {
  const ai = aiState();
  if (!aiReady(ai.cfg)) { toast('설정에서 OpenAI API 키를 먼저 등록하세요', 'err'); return go('settings'); }
  const rows = S.data.transactions.filter((r) => String(r.date).startsWith(S.txMonth) && r.desc && (!r.category || r.category === '기타')).slice(0, 150);
  if (!rows.length) return toast('AI 로 분류할 미분류 거래가 없습니다');
  toast(`${rows.length}건을 AI 로 분류하는 중…`);
  try {
    const j = await chatJson({ cfg: ai.cfg, messages: [
      { role: 'system', content: `한국 카드/은행 거래 내용을 카테고리로 분류하라. 카테고리는 다음 중 하나만: ${M.TX_CATEGORIES.join(', ')}. 반드시 JSON {"items":[{"id":"...","category":"..."}]} 만 출력.` },
      { role: 'user', content: JSON.stringify(rows.map((r) => ({ id: r.id, desc: r.desc, amount: r.amount }))) },
    ] });
    const changed = [];
    for (const it of j.items || []) { const r = rows.find((x) => x.id === it.id); if (r && M.TX_CATEGORIES.includes(it.category) && it.category !== r.category) { r.category = it.category; changed.push(r); } }
    if (!changed.length) return toast('AI 가 변경할 분류를 찾지 못했습니다');
    render();
    await guard(() => S.be.putMany('transactions', changed), `${changed.length}건을 AI 가 분류했습니다`);
  } catch (e) { console.error(e); toast(`AI 분류 실패: ${e.message}`, 'err'); }
}

// 이 달 카테고리별 지출 합계를 현금흐름(C.F) 지출 행에 기록 (만원 단위, 이체·투자 제외)
async function syncTxToCashflow() {
  const year = Number(S.txMonth.slice(0, 4)), mi = Number(S.txMonth.slice(5, 7)) - 1;
  const ts = M.txSummary(S.data.transactions, year);
  const cats = Object.entries(ts.byMonthCat[mi] || {}).filter(([k]) => !['이체', '투자', '급여'].includes(k));
  if (!cats.length) return toast('이 달에 반영할 지출이 없습니다', 'err');
  const cfRows = S.data.cashflow.filter((r) => M.num(r.year) === year);
  const plan = cats.map(([cat, v]) => { const row = cfRows.find((r) => r.type === '지출' && r.name === cat); return { cat, man: Math.round(v / 1e4), row, cur: row ? M.num(row.m?.[mi]) : null }; });
  const ok = await modal({ title: `${S.txMonth} 지출을 현금흐름에 반영`, okText: '반영', body: h('div', {},
    h('p', { class: 'muted small' }, `${year}년 현금흐름의 ${mi + 1}월 열에 카테고리 이름과 같은 지출 행을 찾아 덮어씁니다. 없는 행은 “변동비” 그룹으로 새로 만듭니다 (단위: 만원).`),
    h('div', { class: 'table-wrap' }, h('table', { class: 'grid compact' }, h('thead', {}, h('tr', {}, h('th', {}, '카테고리'), h('th', { class: 'r' }, '소비내역 합계'), h('th', { class: 'r' }, '현재 값'), h('th', {}, ''))),
      h('tbody', {}, plan.map((p) => h('tr', {}, h('td', {}, p.cat), h('td', { class: 'r' }, `${M.fmtNum(p.man)}만원`), h('td', { class: 'r muted' }, p.cur == null ? '행 없음' : `${M.fmtNum(p.cur)}만원`), h('td', { class: 'muted small' }, p.row ? '덮어씀' : '새 행'))))))) });
  if (!ok) return;
  const upd = [], add = [];
  for (const p of plan) {
    if (p.row) { (p.row.m ||= Array(12).fill(0))[mi] = p.man; upd.push(p.row); }
    else { const row = { id: M.uid() + add.length, order: Date.now() + add.length, year, type: '지출', group: '변동비', name: p.cat, m: Array(12).fill(0) }; row.m[mi] = p.man; add.push(row); }
  }
  await guard(async () => { await S.be.putMany('cashflow', [...upd, ...add]); S.data.cashflow.push(...add); if (!cfYears().includes(year)) syncSelections(); render(); }, `${plan.length}개 카테고리를 현금흐름에 반영했습니다`);
}

async function deleteTxMonth() {
  const rows = S.data.transactions.filter((r) => String(r.date).startsWith(S.txMonth));
  if (!(await confirmBox('이 달 삭제', `${S.txMonth} 거래 ${rows.length}건을 모두 삭제할까요?`))) return;
  await guard(async () => { await S.be.removeMany('transactions', rows.map((r) => r.id)); S.data.transactions = S.data.transactions.filter((r) => !rows.includes(r)); S.txMonth = null; render(); }, '삭제했습니다');
}

// ---------- 페이지: 자산 증식 전략 추천 ----------
function pageStrategy() {
  if (!S.basis) return card('전략 추천', emptyState('자산 데이터가 있어야 전략을 추천할 수 있습니다.', [btn('자산 기본 항목 만들기', () => seed(['assets']), 'primary')]));
  const ctx = analysisCtx();
  const sum = ctx.sum;
  const recs = M.recommendStrategies(ctx);
  const ready = aiReady(aiState().cfg);
  const expense = M.monthlyExpense(ctx.cashflowRows);
  // 포트폴리오 통계 (대분류별 기대수익·변동성 가정)
  const groupOf = Object.fromEntries(S.settings.taxonomy.map((t) => [t.major, t.group]));
  const majors = Object.keys(sum.byMajor).filter((m) => sum.byMajor[m] > 0);
  const vols = Object.fromEntries(majors.map((m) => [m, M.VOL_BY_MAJOR[m] ?? M.VOL_BY_GROUP[groupOf[m]] ?? 0.15]));
  const rets = Object.fromEntries(majors.map((m) => { const as = ctx.assets.filter((a) => a.major === m); const k = as.reduce((s, a) => s + M.toKRW(a, S.settings.fx), 0); const r = k ? as.reduce((s, a) => s + M.toKRW(a, S.settings.fx) * M.num(a.rate), 0) / k : 0; return [m, r > 0 ? Math.min(r, 0.3) : (M.RET_BY_MAJOR[m] ?? 0.05)]; }));
  const w = Object.fromEntries(majors.map((m) => [m, sum.byMajor[m] / sum.total]));
  const cur = M.portfolioStats(w, rets, vols);
  const minCash = expense ? Math.min(0.3, (3 * expense) / sum.total) : 0.05;
  const opt = M.optimizePortfolio(majors, rets, vols, { maxW: 0.6, minCash });
  // 몬테카를로
  const d = simDefaults();
  if (!S.mc || S.mcBasis !== S.basis || (S.mc.net === 0 && d.net)) { S.mc = { net: d.net, monthlySave: d.monthlySave, years: 20, target: d.target, inflation: 0.025, saveGrowth: 0.03 }; S.mcBasis = S.basis; }
  const mc = M.monteCarlo({ ...S.mc, mu: cur.mu, sigma: cur.sigma, n: 800 });
  const mcOpt = opt.maxSharpe ? M.monteCarlo({ ...S.mc, mu: opt.maxSharpe.stats.mu, sigma: opt.maxSharpe.stats.sigma, n: 800 }) : null;
  const last = mc.years[mc.years.length - 1];
  const impactSum = recs.reduce((s, r) => s + r.impact, 0);
  const lvl = { high: ['우선', 'bad'], medium: ['권장', 'warn'], low: ['참고', 'ok'] };
  const applyRebal = (weights, name) => { S.rebal = Object.fromEntries(Object.entries(weights).map(([m, v]) => [m, +(v * 100).toFixed(1)])); S.rebalBasis = S.basis; S.simTab = 'rebalance'; toast(`${name} 비중을 리밸런싱 탭에 적용했습니다`); go('simulate'); };
  const wRow = (label, weights, stats, cls) => h('tr', { class: cls || '' }, h('td', {}, h('b', {}, label)), majors.map((m) => h('td', { class: 'r' }, M.fmtPct(weights[m] || 0, 0))), h('td', { class: 'r' }, M.fmtPct(stats.mu)), h('td', { class: 'r' }, M.fmtPct(stats.sigma)), h('td', { class: 'r' }, h('b', {}, stats.sharpe.toFixed(2))));
  const mcCfg = {
    type: 'line',
    data: { labels: mc.years.map((p) => (p.year === 0 ? '현재' : `${thisYear() + p.year}`)), datasets: [
      { label: '비관 (하위 10%)', data: mc.years.map((p) => Math.round(p.p10)), borderColor: PALETTE[4], backgroundColor: 'rgba(59,111,240,0.10)', pointRadius: 0, borderWidth: 1, borderDash: [3, 3] },
      { label: '낙관 (상위 10%)', data: mc.years.map((p) => Math.round(p.p90)), borderColor: PALETTE[1], backgroundColor: 'rgba(59,111,240,0.10)', pointRadius: 0, borderWidth: 1, borderDash: [3, 3], fill: '-1' },
      { label: '중앙값', data: mc.years.map((p) => Math.round(p.p50)), borderColor: PALETTE[0], backgroundColor: PALETTE[0], pointRadius: 0, borderWidth: 2.5, tension: 0.2 },
      mcOpt ? { label: '최적 포트폴리오 중앙값', data: mcOpt.years.map((p) => Math.round(p.p50)), borderColor: PALETTE[3], backgroundColor: PALETTE[3], pointRadius: 0, borderWidth: 1.5, borderDash: [6, 3], tension: 0.2 } : null,
      S.mc.target ? { label: '목표 (물가 반영)', data: mc.years.map((p) => Math.round(S.mc.target * Math.pow(1 + S.mc.inflation, p.year))), borderColor: PALETTE[2], backgroundColor: PALETTE[2], pointRadius: 0, borderWidth: 1.5, borderDash: [8, 4] } : null,
    ].filter(Boolean) },
    options: { maintainAspectRatio: false, animation: false, interaction: { mode: 'index', intersect: false }, scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 10 } }, y: { ticks: { callback: (v) => M.fmtEok(v) }, grid: { color: cssVar('--line') } } }, plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, usePointStyle: true } }, tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${M.fmtKRW(c.raw)}원` } } } },
  };
  return h('div', { class: 'stack' },
    h('div', { class: 'kpis' },
      kpi('추천 전략', `${recs.length}건`, `우선 ${recs.filter((r) => r.level === 'high').length} · 권장 ${recs.filter((r) => r.level === 'medium').length} · 참고 ${recs.filter((r) => r.level === 'low').length}`, 'accent'),
      kpi('연간 예상 효과 합계', `${M.fmtEok(impactSum)}원`, '세액공제·이자 절감·수수료 절감·기회비용 추정치'),
      kpi('현재 포트폴리오', `${M.fmtPct(cur.mu)} / ${M.fmtPct(cur.sigma)}`, `기대수익 / 변동성 · 샤프 ${cur.sharpe.toFixed(2)}`),
      kpi(`${S.mc.years}년 후 중앙값`, `${M.fmtEok(last.p50)}원`, `하위10% ${M.fmtEok(last.p10)} ~ 상위10% ${M.fmtEok(last.p90)}`)),
    card(cardHead('자동 추천 전략', '데이터 규칙(비상자금·부채·세제·비용·배분·자동화)으로 산출 · 우선순위와 연간 효과 추정', h('div', { class: 'row' }, ready ? btn('✦ AI 실행 계획 받기', () => { go('advisor'); aiSend(QUICK_PROMPTS.find((p) => p[0] === '자산 증식 전략')[1]); }, 'small primary') : btn('AI 연동하면 실행 계획까지', () => go('settings'), 'small'))),
      recs.length ? h('div', { class: 'strat-list' }, recs.map((r) => h('div', { class: `strat ${r.level}` },
        h('div', { class: 'strat-head' }, h('span', { class: `chip-s ${lvl[r.level][1]}` }, lvl[r.level][0]), h('b', {}, r.title), r.impact ? h('span', { class: 'strat-impact' }, `연 +${M.fmtEok(r.impact)}원`) : null),
        h('p', { class: 'strat-why' }, r.why),
        h('p', { class: 'strat-action' }, '→ ', r.action),
        h('div', { class: 'strat-foot' }, r.tags.map((t) => h('span', { class: 'chip' }, `#${t}`)), h('span', { class: 'spacer' }),
          r.tags.some((t) => ['자산배분', '분산', '위험관리'].includes(t)) ? btn('리밸런싱 →', () => { S.simTab = 'rebalance'; go('simulate'); }, 'small link') : null,
          r.tags.includes('부채') ? btn('상환 시뮬 →', () => { S.simTab = 'debt'; go('simulate'); }, 'small link') : null,
          ready ? btn('AI 에게 자세히', () => { go('advisor'); aiSend(`"${r.title}" 전략을 내 데이터 기준으로 구체화해 주세요: 왜 필요한지, 얼마를·언제·어떤 상품으로 실행할지, 주의할 세금·비용·리스크.`); }, 'small link') : null)))) : h('p', { class: 'muted' }, '자산·부채·현금흐름 데이터를 입력하면 전략이 생성됩니다.')),
    h('div', { class: 'grid-2' },
      card(cardHead('몬테카를로 전망', `현재 배분의 기대수익 ${M.fmtPct(cur.mu)} · 변동성 ${M.fmtPct(cur.sigma)} 으로 800개 경로 시뮬레이션`),
        h('div', { class: 'sim-fields', style: { marginBottom: '10px' } },
          slider('기간 (년)', 'years', S.mc, { min: 1, max: 40, step: 1, fmt: (v) => `${v}년`, onchange: () => render() }),
          slider('월 저축액', 'monthlySave', S.mc, { min: 0, max: 1e7, step: 1e5, onchange: () => render() }),
          slider('목표 금액', 'target', S.mc, { min: 0, max: 5e9, step: 1e7, onchange: () => render() })),
        chart('c-mc', mcCfg, '260px'),
        h('div', { class: 'kpis', style: { marginTop: '10px' } },
          kpi('목표 도달 확률 (현재 배분)', mc.probTarget == null ? '목표 미설정' : M.fmtPct(mc.probTarget, 0)),
          mcOpt ? kpi('목표 도달 확률 (최적 배분)', mcOpt.probTarget == null ? '—' : M.fmtPct(mcOpt.probTarget, 0), `${S.mc.years}년 후 중앙값 ${M.fmtEok(mcOpt.years[mcOpt.years.length - 1].p50)}원`) : null)),
      card(cardHead('포트폴리오 최적화', '평균-분산(최대 샤프) · 리스크 패리티 — 대분류별 기대수익·변동성 가정 기반'),
        h('div', { class: 'table-wrap' }, h('table', { class: 'grid compact' },
          h('thead', {}, h('tr', {}, h('th', {}, '배분'), majors.map((m) => h('th', { class: 'r' }, m)), h('th', { class: 'r' }, '기대수익'), h('th', { class: 'r' }, '변동성'), h('th', { class: 'r' }, '샤프'))),
          h('tbody', {}, wRow('현재', w, cur), opt.maxSharpe ? wRow('최대 샤프', opt.maxSharpe.weights, opt.maxSharpe.stats, 'inc') : null, wRow('리스크 패리티', opt.riskParity.weights, opt.riskParity.stats)))),
        h('div', { class: 'row', style: { marginTop: '10px' } },
          opt.maxSharpe ? btn('최대 샤프 비중을 리밸런싱에 적용', () => applyRebal(opt.maxSharpe.weights, '최대 샤프'), 'primary small') : null,
          btn('리스크 패리티 적용', () => applyRebal(opt.riskParity.weights, '리스크 패리티'), 'small')),
        h('p', { class: 'muted small', style: { marginTop: '10px' } }, `가정 — 변동성: ${majors.map((m) => `${m} ${M.fmtPct(vols[m], 0)}`).join(' · ')}. 기대수익은 자산별 기대이익률(없으면 대분류 기본값). 상관계수 0.35, 무위험 3%, 종목당 상한 60%, 현금 하한 ${M.fmtPct(minCash, 0)}(비상자금 3개월). 과거 통계가 아닌 가정이므로 방향성 참고용입니다.`))));
}

// ---------- AI 어드바이저 (OpenAI) ----------
function aiState() {
  if (!S.ai) S.ai = { cfg: loadAiConfig(), messages: loadChat(), busy: false, abort: null, showCtx: false, draft: '', liveEl: null };
  return S.ai;
}

function aiSettingsCard() {
  const ai = aiState();
  // 입력 중인 값은 S.ai.form 에 보관 (환율 갱신 등 다른 렌더에 지워지지 않도록)
  const d = (ai.form ||= { ...ai.cfg });
  const key = h('input', { type: 'password', value: d.key, placeholder: 'sk-…', autocomplete: 'off', 'data-fid': 'ai:key', oninput: (e) => { d.key = e.target.value.trim(); } });
  const model = h('input', { type: 'text', value: d.model, list: 'dl-ai-models', autocomplete: 'off', 'data-fid': 'ai:model', oninput: (e) => { d.model = e.target.value.trim(); } });
  const endpoint = h('input', { type: 'text', value: d.endpoint, placeholder: DEFAULT_AI.endpoint, 'data-fid': 'ai:endpoint', oninput: (e) => { d.endpoint = e.target.value.trim() || DEFAULT_AI.endpoint; } });
  const status = h('span', { class: `chip-s ${aiReady(ai.cfg) ? 'ok' : ''}` }, aiReady(ai.cfg) ? `연결됨 · ${ai.cfg.model} · ${ai.cfg.key ? maskKey(ai.cfg.key) : '프록시'}` : '미설정');
  const save = async (test) => {
    if (!d.key && d.endpoint === DEFAULT_AI.endpoint) return toast('API 키를 입력하세요', 'err');
    saveAiConfig(d); ai.cfg = loadAiConfig(); ai.form = null;
    if (test) {
      status.textContent = '테스트 중…';
      try { const m = await testConnection(ai.cfg); toast(`연결 성공 (${m})`); } catch (e) { toast(`연결 실패: ${e.message}`, 'err'); }
    } else toast('AI 설정을 저장했습니다 (이 브라우저에만 저장)');
    render();
  };
  return card(cardHead('AI 어드바이저 (OpenAI API)', '키는 이 브라우저(localStorage)에만 저장되며 Firestore 나 다른 서버로 보내지 않습니다', status),
    h('datalist', { id: 'dl-ai-models' }, AI_MODELS.map((m) => h('option', { value: m }))),
    h('div', { class: 'form ai-form' },
      h('label', {}, h('span', {}, 'OpenAI API 키'), key),
      h('label', {}, h('span', {}, '모델'), model),
      h('label', {}, h('span', {}, '엔드포인트 (프록시를 쓸 때만 변경)'), endpoint)),
    h('div', { class: 'row', style: { marginTop: '10px' } },
      btn('저장', () => save(false), 'primary'), btn('저장 후 연결 테스트', () => save(true)),
      ai.cfg.key ? btn('키 삭제', () => { saveAiConfig({ ...DEFAULT_AI }); ai.cfg = loadAiConfig(); ai.form = null; render(); toast('키를 삭제했습니다'); }, 'ghost-danger') : null,
      h('a', { href: 'https://platform.openai.com/api-keys', target: '_blank', rel: 'noopener', class: 'btn link' }, 'API 키 발급 ↗')),
    h('p', { class: 'muted small', style: { marginTop: '10px' } }, '질문할 때 자산·부채·현금흐름·KPI 의 요약(이름·금액·분류)이 OpenAI 로 전송됩니다. 비용은 OpenAI 계정에서 모델별 토큰 단가로 청구되며, gpt-4o-mini 기준 질문 1회 ≈ 1~3원 수준입니다. 공용 PC 에서는 사용 후 키를 삭제하세요.'));
}

// 마크다운 축약 렌더 (제목·목록·굵게·코드) — innerHTML 미사용
function mdInline(s) {
  const out = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0, m;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push(s.slice(last, m.index));
    out.push(m[0].startsWith('**') ? h('b', {}, m[0].slice(2, -2)) : h('code', {}, m[0].slice(1, -1)));
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}
function md(text) {
  const nodes = [];
  let list = null, para = [];
  const flushP = () => { if (para.length) { nodes.push(h('p', {}, mdInline(para.join(' ')))); para = []; } };
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trimEnd();
    const hm = line.match(/^(#{1,6})\s+(.*)/);
    const lm = line.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)/);
    if (hm) { flushP(); list = null; nodes.push(h(hm[1].length <= 2 ? 'h3' : 'h4', {}, mdInline(hm[2]))); }
    else if (lm) {
      flushP();
      const tag = /^\s*\d/.test(line) ? 'OL' : 'UL';
      if (!list || list.tagName !== tag) { list = h(tag.toLowerCase(), {}); nodes.push(list); }
      list.append(h('li', {}, mdInline(lm[1])));
    } else if (!line.trim()) { flushP(); list = null; }
    else { list = null; para.push(line.replace(/^>\s?/, '').replace(/^---+$/, '')); }
  }
  flushP();
  return nodes;
}

function buildAiContext() {
  if (!S.basis) return { 안내: '자산 데이터가 아직 없습니다' };
  const ctx = analysisCtx();
  const health = M.healthScore(ctx);
  const alerts = M.buildAlerts(ctx);
  const strategies = M.recommendStrategies(ctx);
  return M.aiContext({ basis: S.basis, assets: ctx.assets, liabilities: ctx.liabilities, cashflowRows: ctx.cashflowRows, cfYear: ctx.cfYear, kpis: ctx.kpis, kpiCtx: ctx.kpiCtx, q: ctx.q, history: ctx.history, settings: S.settings, health, alerts, strategies, transactions: S.data.transactions, realestate: S.data.realestate });
}

async function aiSend(text) {
  const ai = aiState();
  text = String(text || '').trim();
  if (!text) return;
  if (!aiReady(ai.cfg)) { toast('설정에서 OpenAI API 키를 먼저 등록하세요', 'err'); return go('settings'); }
  if (ai.busy) return toast('답변을 생성하는 중입니다', 'err');
  ai.messages.push({ role: 'user', content: text, at: Date.now() });
  const reply = { role: 'assistant', content: '', at: Date.now(), model: ai.cfg.model };
  ai.messages.push(reply);
  ai.busy = true; ai.abort = new AbortController(); ai.draft = '';
  render();
  const history = ai.messages.slice(0, -1).slice(-12).map((m) => ({ role: m.role, content: m.content }));
  const messages = [{ role: 'system', content: `${SYSTEM_PROMPT}\n\n오늘: ${M.today()}\n[사용자 데이터 JSON]\n${JSON.stringify(buildAiContext())}` }, ...history];
  try {
    await chatStream({ cfg: ai.cfg, messages, signal: ai.abort.signal, onDelta: (d, full) => { reply.content = full; if (ai.liveEl) { ai.liveEl.replaceChildren(...md(full)); const log = ai.liveEl.closest('.chat-log'); if (log) log.scrollTop = log.scrollHeight; } } });
  } catch (e) {
    if (e.name !== 'AbortError') { reply.content += `\n\n⚠️ 오류: ${e.message}`; toast(e.message, 'err'); }
    else reply.content += '\n\n(중지됨)';
  }
  ai.busy = false; ai.abort = null; ai.liveEl = null;
  saveChat(ai.messages);
  render();
}

function pageAdvisor() {
  const ai = aiState();
  const ready = aiReady(ai.cfg);
  const reports = [...S.data.reports].sort((a, b) => String(b.date).localeCompare(String(a.date)) || M.num(b.order) - M.num(a.order));
  const input = h('textarea', { class: 'chat-input', rows: 2, placeholder: ready ? '질문을 입력하세요 (Enter 전송 · Shift+Enter 줄바꿈)' : '설정에서 OpenAI API 키를 등록하면 사용할 수 있습니다', 'data-fid': 'ai:input', disabled: !ready,
    oninput: (e) => { ai.draft = e.target.value; },
    onkeydown: (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); const v = e.target.value; e.target.value = ''; ai.draft = ''; aiSend(v); } } });
  input.value = ai.draft || '';
  const saveReport = async (m) => {
    const first = m.content.split('\n').find((l) => l.trim())?.replace(/^#+\s*/, '').slice(0, 60) || 'AI 리포트';
    const v = await ask('리포트 저장', [{ key: 'title', label: '제목', value: first }], '저장');
    if (!v?.title) return;
    await addRow('reports', { date: M.today(), title: v.title, model: m.model || ai.cfg.model, content: m.content });
  };
  const bubble = (m, i) => {
    const live = ai.busy && i === ai.messages.length - 1 && m.role === 'assistant';
    const body = h('div', { class: 'msg-body' }, m.role === 'assistant' ? md(m.content || (live ? '…' : '')) : m.content);
    if (live) ai.liveEl = body;
    return h('div', { class: `msg ${m.role}` },
      h('div', { class: 'msg-meta' }, m.role === 'assistant' ? `✦ ${m.model || 'AI'}` : '나', h('span', { class: 'muted' }, ` · ${new Date(m.at || Date.now()).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}`)),
      body,
      m.role === 'assistant' && !live && m.content ? h('div', { class: 'msg-tools' },
        btn('리포트로 저장', () => saveReport(m), 'small'),
        btn('복사', () => navigator.clipboard?.writeText(m.content).then(() => toast('복사했습니다')), 'small link')) : null);
  };
  const openReport = (r) => modal({ title: r.title, wide: true, cancelText: null, okText: '닫기', body: h('div', { class: 'report-body' }, h('p', { class: 'muted small' }, `${r.date} · ${r.model || ''}`), md(r.content)) });
  setTimeout(() => { const el = document.querySelector('.chat-log'); if (el) el.scrollTop = el.scrollHeight; }, 0);
  return h('div', { class: 'stack' },
    !ready ? h('div', { class: 'banner' }, 'OpenAI API 키가 없습니다. 설정 페이지에서 키를 등록하면 데이터 기반 자산운용 조언을 받을 수 있습니다.', h('span', { class: 'spacer' }), btn('설정으로 이동', () => go('settings'), 'small primary')) : null,
    toolbar(
      h('span', { class: `chip-s ${ready ? 'ok' : ''}` }, ready ? `${ai.cfg.model}` : '미연결'),
      btn('데이터 요약 ' + (ai.showCtx ? '숨기기' : '보기'), () => { ai.showCtx = !ai.showCtx; render(); }, 'small'),
      h('span', { class: 'spacer' }),
      ai.messages.length ? btn('새 대화', async () => { if (ai.busy) ai.abort?.abort(); if (!(await confirmBox('새 대화', '현재 대화를 지우고 새로 시작할까요? (저장한 리포트는 유지)', '새로 시작'))) return; ai.messages = []; saveChat([]); render(); }, 'small') : null),
    ai.showCtx ? card(cardHead('AI 에게 전달되는 데이터 요약', '개인 식별 정보 없이 금액·분류·비율만 보냅니다 (억원 단위)'), h('pre', { class: 'ctx-pre' }, JSON.stringify(buildAiContext(), null, 1))) : null,
    h('div', { class: 'grid-2 wide-right advisor' },
      h('div', { class: 'stack' },
        card(cardHead('빠른 질문', '현재 데이터를 바탕으로 바로 분석합니다'), h('div', { class: 'quick-list' }, QUICK_PROMPTS.map(([label, prompt]) => btn(label, () => aiSend(prompt), '', { disabled: !ready || ai.busy })))),
        card(cardHead('저장된 리포트', `${reports.length}건 · 엑셀 AI리포트 시트로도 내려받습니다`), reports.length ? h('ul', { class: 'report-list' }, reports.slice(0, 12).map((r) => h('li', {},
          h('button', { class: 'report-item', onclick: () => openReport(r) }, h('b', {}, r.title), h('span', { class: 'muted small' }, `${r.date} · ${r.model || ''}`)),
          h('button', { class: 'icon-btn del', title: '삭제', onclick: () => removeRow('reports', r, r.title) }, '✕')))) : h('p', { class: 'muted small' }, '답변 아래 “리포트로 저장” 을 누르면 여기에 보관됩니다.')),
        h('p', { class: 'muted small' }, '⚠️ AI 의 답변은 일반적인 자산배분 원칙에 따른 참고 정보이며 투자 권유가 아닙니다. 판단과 책임은 본인에게 있습니다.')),
      card(null, h('div', { class: 'chat' },
        h('div', { class: 'chat-log' }, ai.messages.length ? ai.messages.map(bubble) : h('div', { class: 'empty-state' }, h('p', {}, '왼쪽의 빠른 질문을 누르거나 아래에 직접 질문하세요.'), h('p', { class: 'muted small' }, '예: “가상자산 비중이 적절한가요?”, “연금저축과 IRP 중 어디에 먼저 넣을까요?”, “이번 분기 KPI 를 맞추려면?”'))),
        h('div', { class: 'chat-compose' }, input,
          ai.busy ? btn('■ 중지', () => ai.abort?.abort(), 'ghost-danger') : btn('전송', () => { const v = input.value; input.value = ''; ai.draft = ''; aiSend(v); }, 'primary', { disabled: !ready }))))));
}

// ---------- 변경 이력 표 (설정·관리자 공용) ----------
const fmtDT = (iso) => { if (!iso) return '—'; const d = new Date(iso); return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleString('ko-KR', { year: '2-digit', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }); };
const daysAgo = (iso) => (iso ? (Date.now() - new Date(iso).getTime()) / 864e5 : Infinity);

function logTable(rows, { showUser = true, limit = 300 } = {}) {
  if (!rows.length) return h('p', { class: 'muted' }, '조건에 맞는 기록이 없습니다.');
  return h('div', {},
    h('div', { class: 'table-wrap' }, h('table', { class: 'grid compact log-table' },
      h('thead', {}, h('tr', {}, h('th', {}, '시각'), showUser ? h('th', {}, '사용자') : null, h('th', {}, '유형'), h('th', {}, '대상'), h('th', {}, '내용'))),
      h('tbody', {}, rows.slice(0, limit).map((l) => h('tr', {},
        h('td', { class: 'nowrap muted' }, fmtDT(l.at)),
        showUser ? h('td', { class: 'nowrap' }, l.email || l.uid) : null,
        h('td', {}, h('span', { class: `chip-s ${ACTION_TONE[l.action] || ''}` }, ACTION_LABEL[l.action] || l.action)),
        h('td', {}, l.target || ''),
        h('td', { class: 'log-detail' }, l.detail || '')))))),
    rows.length > limit ? h('p', { class: 'muted small' }, `${rows.length}건 중 최근 ${limit}건 표시 — 전체는 엑셀로 내려받으세요`) : null);
}

function exportLogs(rows, prefix) {
  if (!window.XLSX) return toast('엑셀 라이브러리를 불러오지 못했습니다', 'err');
  const aoa = [['시각', '사용자', '유형', '대상', '내용', 'UID', '대상 UID']];
  for (const l of rows) aoa.push([fmtDT(l.at), l.email || '', ACTION_LABEL[l.action] || l.action, l.target || '', l.detail || '', l.uid || '', l.subject || '']);
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 20 }, { wch: 26 }, { wch: 10 }, { wch: 30 }, { wch: 80 }, { wch: 30 }, { wch: 30 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '변경이력');
  XLSX.writeFile(wb, stampName(prefix));
}

// ---------- 페이지: 관리자 ----------
const STATUS = { active: ['활성', 'ok'], pending: ['승인 대기', 'warn'], disabled: ['비활성', 'bad'] };
const userStatus = (p) => (p.disabled ? 'disabled' : p.pending ? 'pending' : 'active');
const providerName = (p) => ({ 'google.com': 'Google', password: '이메일' }[p] || p || '—');
const adminEmailSet = () => new Set([...BOOTSTRAP_ADMINS, ...(S.admins || []).map((a) => a.email)]);

async function loadAdminData() {
  const [profiles, admins, cfg] = await Promise.all([S.be.listProfiles(), S.be.listAdmins(), S.be.getAppConfig()]);
  S.profiles = profiles.sort((a, b) => String(b.lastLogin || '').localeCompare(String(a.lastLogin || '')));
  S.admins = admins;
  S.appConfig = cfg;
}
async function loadAdminLogs() {
  const f = S.logFilter;
  const key = `${f.uid}|${f.max}`;
  try { S.adminLogs = await S.be.listLogs({ uid: f.uid || undefined, max: f.max }); S.logError = null; }
  catch (e) { S.adminLogs = []; S.logError = e.message || String(e); }
  // 불러오는 동안 사용자/건수 조건이 바뀌었으면 다시 불러오도록
  if (`${S.logFilter.uid}|${S.logFilter.max}` !== key) S.adminLogs = null;
}
const localYmd = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

// 관리자 작업 실행 + 이력 기록
async function adminDo(p, label, fn) {
  try { await fn(); audit('admin', p?.email || '전체', label, p?.uid ? { subject: p.uid } : {}); render(); }
  catch (e) { console.error(e); toast(`실패: ${e.message || e}`, 'err'); }
}

async function approveUser(p) {
  await adminDo(p, '가입 승인', async () => { const patch = { pending: false, approvedAt: new Date().toISOString(), approvedBy: S.user.email }; await S.be.updateProfile(p.uid, patch); Object.assign(p, patch); toast(`${p.email} 을(를) 승인했습니다`); });
}
async function rejectUser(p) {
  if (!(await confirmBox('가입 거절', `${p.email} 의 가입을 거절하고 계정을 비활성화할까요?`, '거절'))) return;
  await adminDo(p, '가입 거절(비활성화)', async () => { const patch = { pending: false, disabled: true }; await S.be.updateProfile(p.uid, patch); Object.assign(p, patch); });
}
async function backupUser(p) {
  await adminDo(p, '데이터 백업 다운로드', async () => {
    const d = await S.be.loadAllFor(p.uid);
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), user: p.email, settings: d.settings, data: Object.fromEntries(COLLECTIONS.map((c) => [c, d[c] || []])) }, null, 1)], { type: 'application/json' });
    h('a', { href: URL.createObjectURL(blob), download: stampName(`백업_${(p.email || p.uid).replace(/[^\w.-]/g, '_')}`).replace('.xlsx', '.json') }).click();
  });
}

function pageAdmin() {
  if (S.be.kind !== 'firebase') return card('관리자', h('p', { class: 'muted' }, '관리자 기능은 Firebase 모드에서만 사용할 수 있습니다 (계정은 Firebase Authentication 에 저장됩니다).'));
  if (!S.admin) return card('관리자', h('p', { class: 'muted' }, '관리자 권한이 없는 계정입니다.'));
  if (!S.profiles) {
    loadAdminData().then(render).catch((e) => toast(`불러오기 실패: ${e.message}`, 'err'));
    return card('관리자', h('p', { class: 'muted' }, '계정 목록 불러오는 중…'));
  }
  S.adminTab ||= 'overview';
  S.logFilter ||= { uid: '', action: '', from: '', to: '', q: '', max: 500 };
  const pending = S.profiles.filter((p) => userStatus(p) === 'pending').length;
  const tabs = [['overview', '개요'], ['users', `사용자 ${S.profiles.length}`], ['logs', '이력 관리'], ['ops', '운영 설정']];
  const tabBar = h('div', { class: 'row' },
    h('div', { class: 'tabs' }, tabs.map(([id, label]) => h('button', { class: `tab ${S.adminTab === id ? 'active' : ''}`, onclick: () => { S.adminTab = id; S.filter = ''; render(); } }, label, id === 'users' && pending ? h('span', { class: 'tab-badge' }, pending) : null))),
    h('span', { class: 'spacer' }),
    btn('새로고침', async () => { S.adminLogs = null; await loadAdminData(); render(); toast('새로 불러왔습니다'); }, 'small'));
  const body = { overview: adminOverview, users: adminUsers, logs: adminLogsTab, ops: adminOps }[S.adminTab]();
  return h('div', { class: 'stack' }, tabBar, body);
}

function adminOverview() {
  const ps = S.profiles;
  const by = (st) => ps.filter((p) => userStatus(p) === st);
  const a7 = ps.filter((p) => daysAgo(p.lastLogin) < 7).length;
  const a30 = ps.filter((p) => daysAgo(p.lastLogin) < 30).length;
  const new30 = ps.filter((p) => daysAgo(p.createdAt) < 30).length;
  const today = ps.filter((p) => daysAgo(p.lastLogin) < 1).length;
  // 최근 12개월 가입자
  const now = new Date();
  const months = Array.from({ length: 12 }, (_, i) => { const d = new Date(now.getFullYear(), now.getMonth() - 11 + i, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; });
  const signups = months.map((m) => ps.filter((p) => String(p.createdAt || '').startsWith(m)).length);
  let acc = ps.filter((p) => String(p.createdAt || '') < `${months[0]}-01`).length;
  const cumulative = signups.map((n) => (acc += n));
  const providers = ps.reduce((m, p) => { const k = providerName(p.provider); m[k] = (m[k] || 0) + 1; return m; }, {});
  if (!S.adminLogs && !S.logLoading) { S.logLoading = true; loadAdminLogs().then(() => { S.logLoading = false; render(); }); }
  const pend = by('pending');
  return h('div', { class: 'stack' },
    h('div', { class: 'kpis' },
      kpi('전체 계정', `${ps.length}명`, `활성 ${by('active').length} · 대기 ${pend.length} · 비활성 ${by('disabled').length}`, 'accent'),
      kpi('오늘 / 7일 / 30일 활성', `${today} / ${a7} / ${a30}명`, '최근 로그인 기준'),
      kpi('최근 30일 신규 가입', `${new30}명`, S.appConfig?.approvalRequired ? '가입 승인제 사용 중' : '자유 가입'),
      kpi('관리자', `${adminEmailSet().size}명`, [...adminEmailSet()].join(', '))),
    pend.length ? card(cardHead(`승인 대기 ${pend.length}명`, '승인하면 바로 데이터를 저장할 수 있습니다'), h('div', { class: 'admin-list' }, pend.map((p) => h('div', { class: 'admin-user' },
      h('div', { class: 'avatar' }, (p.name || p.email || '?')[0].toUpperCase()),
      h('div', {}, h('b', {}, p.name || '(이름 없음)'), ' ', h('span', { class: 'muted' }, p.email), h('div', { class: 'meta' }, `가입 ${fmtDT(p.createdAt)} · ${providerName(p.provider)}`)),
      h('div', { class: 'row' }, btn('승인', () => approveUser(p), 'small primary'), btn('거절', () => rejectUser(p), 'small ghost-danger')))))) : null,
    h('div', { class: 'grid-2 wide-left' },
      card(cardHead('가입자 추이', '최근 12개월 · 막대 = 월 신규, 선 = 누적'), chart('c-signups', {
        type: 'bar',
        data: { labels: months.map((m) => `${m.slice(2, 4)}.${m.slice(5)}`), datasets: [
          { type: 'bar', label: '신규 가입', data: signups, backgroundColor: PALETTE[0], yAxisID: 'y' },
          { type: 'line', label: '누적', data: cumulative, borderColor: PALETTE[1], backgroundColor: PALETTE[1], tension: 0.25, yAxisID: 'y1' }] },
        options: { maintainAspectRatio: false, scales: { y: { beginAtZero: true, ticks: { precision: 0 } }, y1: { position: 'right', beginAtZero: true, grid: { display: false }, ticks: { precision: 0 } } } },
      }, '240px')),
      card(cardHead('로그인 방식'), h('ul', { class: 'legend' }, Object.entries(providers).map(([k, v], i) => h('li', {}, h('i', { style: { background: PALETTE[i] } }), h('span', {}, k), h('b', {}, `${v}명`)))))),
    card(cardHead('최근 활동', '모든 사용자의 최근 변경 이력', btn('이력 관리 →', () => { S.adminTab = 'logs'; render(); }, 'small')),
      S.logError ? h('p', { class: 'down small' }, `이력을 불러오지 못했습니다: ${S.logError}`) : S.adminLogs ? logTable(S.adminLogs, { limit: 12 }) : h('p', { class: 'muted' }, '불러오는 중…')));
}

function adminUsers() {
  const adm = adminEmailSet();
  S.userFilter ||= 'all';
  S.userSort ||= 'lastLogin';
  const filters = [['all', '전체'], ['active', '활성'], ['pending', '승인 대기'], ['disabled', '비활성'], ['admin', '관리자']];
  const pass = (p) => (S.userFilter === 'all' ? true : S.userFilter === 'admin' ? adm.has(p.email) : userStatus(p) === S.userFilter);
  const sorters = { lastLogin: (a, b) => String(b.lastLogin || '').localeCompare(String(a.lastLogin || '')), createdAt: (a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')), email: (a, b) => String(a.email).localeCompare(String(b.email)) };
  const list = S.profiles.filter((p) => pass(p) && matchFilter(p, ['email', 'name', 'uid', 'memo'])).sort(sorters[S.userSort]);

  const userRow = (p) => {
    const isMe = p.uid === S.user?.uid;
    const isAdm = adm.has(p.email);
    const st = userStatus(p);
    return h('div', { class: `admin-user ${st === 'disabled' ? 'disabled' : ''}` },
      h('div', { class: 'avatar' }, (p.name || p.email || '?')[0].toUpperCase()),
      h('div', {},
        h('div', {}, h('b', {}, p.name || '(이름 없음)'), ' ', h('span', { class: 'muted' }, p.email),
          isMe ? h('span', { class: 'chip-s ok', style: { marginLeft: '6px' } }, '나') : null,
          isAdm ? h('span', { class: 'chip-s warn', style: { marginLeft: '6px' } }, '관리자') : null,
          h('span', { class: `chip-s ${STATUS[st][1]}`, style: { marginLeft: '6px' } }, STATUS[st][0])),
        h('div', { class: 'meta' }, `가입 ${fmtDT(p.createdAt)} · 최근 로그인 ${fmtDT(p.lastLogin)} · ${providerName(p.provider)} · 로그인 ${p.loginCount || 1}회`,
          p.approvedBy ? ` · 승인 ${p.approvedBy}` : null,
          p.stats ? ` · 자산 ${p.stats.assets} · 부동산 ${p.stats.realestate} · 부채 ${p.stats.liabilities} · 현금흐름 ${p.stats.cashflow} · 소비 ${p.stats.transactions} · KPI ${p.stats.kpis}` : null,
          p.memo ? h('div', {}, '메모: ', p.memo) : null)),
      h('div', { class: 'row' },
        st === 'pending' ? btn('승인', () => approveUser(p), 'small primary') : null,
        st === 'pending' ? btn('거절', () => rejectUser(p), 'small ghost-danger') : null,
        btn('통계', async () => { try { p.stats = await S.be.userStats(p.uid); render(); } catch (e) { toast(e.message, 'err'); } }, 'small'),
        btn('이력', () => { S.logFilter = { ...S.logFilter, uid: p.uid }; S.adminLogs = null; S.adminTab = 'logs'; render(); }, 'small'),
        btn('데이터 열람', () => viewAs(p), 'small', { disabled: isMe }),
        btn('백업', () => backupUser(p), 'small', { title: '이 사용자의 전체 데이터를 JSON 으로 내려받기' }),
        btn('메모', async () => { const v = await ask('관리자 메모', [{ key: 'm', label: p.email, value: p.memo || '' }], '저장'); if (v) await adminDo(p, `메모: ${v.m}`, async () => { await S.be.updateProfile(p.uid, { memo: v.m }); p.memo = v.m; }); }, 'small'),
        st !== 'pending' ? btn(p.disabled ? '활성화' : '비활성화', async () => {
          if (isMe) return toast('본인 계정은 비활성화할 수 없습니다', 'err');
          if (!p.disabled && !(await confirmBox('계정 비활성화', `${p.email} 의 데이터 쓰기를 막을까요? (로그인은 가능하지만 저장이 거부됩니다)`, '비활성화'))) return;
          await adminDo(p, p.disabled ? '계정 활성화' : '계정 비활성화', async () => { await S.be.updateProfile(p.uid, { disabled: !p.disabled }); p.disabled = !p.disabled; });
        }, `small ${p.disabled ? '' : 'ghost-danger'}`) : null,
        isAdm
          ? btn('관리자 해제', async () => { if (BOOTSTRAP_ADMINS.includes(p.email)) return toast('기본 관리자는 해제할 수 없습니다', 'err'); await adminDo(p, '관리자 해제', async () => { await S.be.removeAdmin(p.email); await loadAdminData(); }); }, 'small', { disabled: isMe })
          : btn('관리자 지정', async () => { if (!(await confirmBox('관리자 지정', `${p.email} 에게 모든 계정 데이터 열람·관리 권한을 줄까요?`, '지정'))) return; await adminDo(p, '관리자 지정', async () => { await S.be.addAdmin(p.email, S.user.email); await loadAdminData(); }); }, 'small'),
        btn('데이터 삭제', async () => {
          if (!(await confirmBox('데이터 삭제', `${p.email} 의 자산·부채·현금흐름·KPI 등 모든 데이터를 삭제합니다. 되돌릴 수 없습니다. 먼저 “백업” 을 권장합니다.`, '전체 삭제'))) return;
          await adminDo(p, '사용자 데이터 전체 삭제', async () => { await S.be.deleteUserData(p.uid); p.stats = null; toast('삭제했습니다'); });
        }, 'small ghost-danger', { disabled: isMe })));
  };
  const exportUsers = () => {
    if (!window.XLSX) return toast('엑셀 라이브러리를 불러오지 못했습니다', 'err');
    const aoa = [['이메일', '이름', '상태', '관리자', '로그인 방식', '가입일', '최근 로그인', '로그인 횟수', '승인자', '메모', 'UID']];
    for (const p of list) aoa.push([p.email, p.name || '', STATUS[userStatus(p)][0], adm.has(p.email) ? 'Y' : '', providerName(p.provider), fmtDT(p.createdAt), fmtDT(p.lastLogin), p.loginCount || 1, p.approvedBy || '', p.memo || '', p.uid]);
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [{ wch: 28 }, { wch: 14 }, { wch: 9 }, { wch: 6 }, { wch: 9 }, { wch: 20 }, { wch: 20 }, { wch: 8 }, { wch: 24 }, { wch: 30 }, { wch: 30 }];
    XLSX.utils.book_append_sheet(wb, ws, '계정목록');
    XLSX.writeFile(wb, stampName('계정목록'));
    audit('export', '계정 목록 엑셀', `${list.length}명`);
  };
  return h('div', { class: 'stack' },
    toolbar(
      h('div', { class: 'seg' }, filters.map(([id, label]) => h('button', { class: S.userFilter === id ? 'active' : '', onclick: () => { S.userFilter = id; render(); } }, label))),
      h('label', { class: 'inline' }, '정렬', select([{ value: 'lastLogin', label: '최근 로그인' }, { value: 'createdAt', label: '가입일' }, { value: 'email', label: '이메일' }], S.userSort, (v) => { S.userSort = v; render(); }, { placeholder: false })),
      h('span', { class: 'spacer' }), searchBox(), btn('엑셀 내보내기', exportUsers, 'small')),
    card(cardHead(`계정 ${list.length}명`, 'Firebase Auth 계정은 로그인 시 자동 등록됩니다. 인증 계정 자체의 삭제는 Firebase 콘솔에서만 가능합니다.'),
      list.length ? h('div', { class: 'admin-list' }, list.map(userRow)) : h('p', { class: 'muted' }, '조건에 맞는 계정이 없습니다.')));
}

function adminLogsTab() {
  const f = S.logFilter;
  if (!S.adminLogs && !S.logLoading) { S.logLoading = true; loadAdminLogs().then(() => { S.logLoading = false; render(); }); }
  const all = S.adminLogs || [];
  const q = f.q.toLowerCase();
  const rows = all.filter((l) => (!f.action || l.action === f.action)
    && (!f.from || localYmd(l.at) >= f.from) && (!f.to || localYmd(l.at) <= f.to)
    && (!q || `${l.email} ${l.target} ${l.detail}`.toLowerCase().includes(q)));
  const counts = rows.reduce((m, l) => { m[l.action] = (m[l.action] || 0) + 1; return m; }, {});
  const userOpts = [{ value: '', label: '전체 사용자' }, ...S.profiles.map((p) => ({ value: p.uid, label: p.email || p.uid }))];
  const setF = (patch, reload) => { Object.assign(f, patch); if (reload) S.adminLogs = null; render(); };
  return h('div', { class: 'stack' },
    toolbar(
      h('label', { class: 'inline' }, '사용자', select(userOpts, f.uid, (v) => setF({ uid: v }, true), { placeholder: false })),
      h('label', { class: 'inline' }, '유형', select([{ value: '', label: '전체' }, ...Object.entries(ACTION_LABEL).map(([value, label]) => ({ value, label }))], f.action, (v) => setF({ action: v }), { placeholder: false })),
      h('label', { class: 'inline' }, '기간', h('input', { type: 'date', value: f.from, onchange: (e) => setF({ from: e.target.value }) }), '~', h('input', { type: 'date', value: f.to, onchange: (e) => setF({ to: e.target.value }) })),
      h('label', { class: 'search' }, '🔍', h('input', { type: 'search', placeholder: '대상·내용 검색', value: f.q, 'data-fid': 'logq', oninput: (e) => { f.q = e.target.value; S.focusFid = 'logq'; render(); } })),
      h('span', { class: 'spacer' }),
      btn('필터 초기화', () => setF({ uid: '', action: '', from: '', to: '', q: '' }, !!f.uid), 'small')),
    h('div', { class: 'chips' }, Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k, v]) => h('span', { class: 'chip' }, h('b', {}, ACTION_LABEL[k] || k), ` ${v}건`))),
    card(cardHead('변경 이력', `${S.logLoading ? '불러오는 중… ' : ''}불러온 ${all.length}건 중 ${rows.length}건 · ${f.uid ? '선택 사용자' : '전체 사용자'} 최신순`,
      h('div', { class: 'row' },
        all.length >= f.max && f.max < 5000 ? btn(`더 불러오기 (+500)`, () => setF({ max: f.max + 500 }, true), 'small') : null,
        btn('엑셀 다운로드', () => { exportLogs(rows, '변경이력'); audit('export', '변경 이력 엑셀', `${rows.length}건`); }, 'small', { disabled: !rows.length }))),
      S.logError ? h('p', { class: 'down' }, `이력을 불러오지 못했습니다: ${S.logError} — Firestore 규칙이 최신인지 확인하세요.`) : logTable(rows, { limit: 500 })),
    card(cardHead('이력 정리', 'Firestore 무료 한도(저장 1GB)를 아끼려면 오래된 이력을 주기적으로 정리하세요. 정리 작업도 이력에 남습니다.'),
      h('div', { class: 'row' }, btn('오래된 이력 삭제…', async () => {
        const v = await ask('오래된 이력 삭제', [{ key: 'd', label: '며칠 이전 기록을 삭제할까요?', type: 'number', value: 180 }], '다음');
        const days = Math.round(M.num(v?.d));
        if (!days || days < 7) return v && toast('7일 이상으로 입력하세요', 'err');
        const before = new Date(Date.now() - days * 864e5).toISOString();
        if (!(await confirmBox('이력 삭제', `${before.slice(0, 10)} 이전의 모든 사용자 이력을 삭제합니다. 되돌릴 수 없습니다.`, '삭제'))) return;
        try { const n = await S.be.deleteLogsBefore(before); audit('admin', '변경 이력', `${before.slice(0, 10)} 이전 이력 ${n}건 삭제`); S.adminLogs = null; toast(`${n}건 삭제했습니다`); render(); }
        catch (e) { toast(`삭제 실패: ${e.message}`, 'err'); }
      }, 'ghost-danger'))));
}

function adminOps() {
  const cfg = S.appConfig || {};
  const n = cfg.notice || {};
  const text = h('textarea', { rows: 3, placeholder: '예: 11/5(수) 02:00~03:00 점검 예정입니다.', 'data-fid': 'notice:text' }, n.text || '');
  const level = select([{ value: 'info', label: '안내 (파랑)' }, { value: 'warn', label: '주의 (주황)' }], n.level || 'info', () => {}, { placeholder: false });
  const enabled = h('input', { type: 'checkbox', checked: !!n.enabled });
  const saveCfg = async (patch, label) => {
    try { await S.be.setAppConfig(patch); S.appConfig = { ...cfg, ...patch }; audit('admin', '운영 설정', label); toast('저장했습니다'); render(); }
    catch (e) { toast(`저장 실패: ${e.message}`, 'err'); }
  };
  return h('div', { class: 'stack' },
    h('div', { class: 'grid-2' },
      card(cardHead('가입 정책', '승인제를 켜면 새로 가입한 계정은 관리자가 승인할 때까지 데이터를 저장할 수 없습니다 (기존 계정은 영향 없음)'),
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: !!cfg.approvalRequired, onchange: (e) => saveCfg({ approvalRequired: e.target.checked }, `가입 승인제 ${e.target.checked ? '켬' : '끔'}`) }), h('span', {}, h('b', {}, '가입 승인제 사용'), h('span', { class: 'muted small' }, ' — 대기 계정은 개요·사용자 탭에서 승인'))),
        h('p', { class: 'muted small' }, '꺼져 있으면 누구나 Google 또는 이메일로 가입해 바로 사용할 수 있습니다. 문제가 있는 계정은 사용자 탭에서 비활성화하세요.')),
      card(cardHead('전체 공지', '켜 두면 모든 사용자의 화면 상단에 표시됩니다 (사용자가 닫으면 내용이 바뀔 때까지 숨김)'),
        h('div', { class: 'form' }, h('label', {}, h('span', {}, '내용'), text), h('label', {}, h('span', {}, '종류'), level), h('label', { class: 'check' }, enabled, h('span', {}, '공지 표시'))),
        h('div', { class: 'row', style: { marginTop: '10px' } },
          btn('공지 저장', () => saveCfg({ notice: { text: text.value.trim(), level: level.value, enabled: enabled.checked && !!text.value.trim(), updatedAt: new Date().toISOString(), by: S.user.email } }, `공지 ${enabled.checked ? '게시' : '저장(숨김)'}: ${text.value.trim().slice(0, 80)}`), 'primary'),
          n.updatedAt ? h('span', { class: 'muted small' }, `마지막 수정 ${fmtDT(n.updatedAt)} · ${n.by || ''}`) : null))),
    card(cardHead('관리자 추가', '이메일로 관리자 권한을 부여합니다 (해당 계정이 이메일 인증된 상태로 로그인하면 관리자 메뉴가 보입니다)'),
      h('div', { class: 'row' }, btn('+ 이메일로 관리자 추가', async () => {
        const v = await ask('관리자 추가', [{ key: 'e', label: '이메일', type: 'email' }], '추가');
        if (!v?.e) return;
        const email = v.e.toLowerCase();
        await adminDo({ email }, '관리자 지정', async () => { await S.be.addAdmin(email, S.user.email); await loadAdminData(); toast('추가했습니다'); });
      }), h('span', { class: 'muted small' }, `현재: ${[...adminEmailSet()].join(', ')}`))),
    taxonomyTemplateCard(),
    card(cardHead('Firebase 콘솔 바로가기', '프로젝트 asset-management-6c342 · Spark 무료 플랜 (일 읽기 5만·쓰기 2만건)'), h('div', { class: 'row' },
      h('a', { class: 'btn', href: 'https://console.firebase.google.com/project/asset-management-6c342/authentication/users', target: '_blank', rel: 'noopener' }, 'Authentication 사용자'),
      h('a', { class: 'btn', href: 'https://console.firebase.google.com/project/asset-management-6c342/firestore', target: '_blank', rel: 'noopener' }, 'Firestore 데이터'),
      h('a', { class: 'btn', href: 'https://console.firebase.google.com/project/asset-management-6c342/firestore/rules', target: '_blank', rel: 'noopener' }, '보안 규칙'),
      h('a', { class: 'btn', href: 'https://console.firebase.google.com/project/asset-management-6c342/usage', target: '_blank', rel: 'noopener' }, '사용량'))));
}

// ---------- 계정 · 공지 · 개인정보 안내 ----------
const NOTICE_KEY = 'asset-notice-dismissed';
const PRIVACY = [
  ['저장하는 정보', '로그인 이메일·이름(Google 표시명), 가입·로그인 시각, 그리고 직접 입력한 자산·부채·부동산·현금흐름·소비내역 등의 데이터입니다.'],
  ['저장 위치', 'Google Firebase(Firestore, 서울 리전)에 계정별로 분리 저장되며, 보안 규칙상 본인과 서비스 관리자만 읽을 수 있습니다.'],
  ['관리자 열람', '서비스 관리자는 오류 확인·계정 관리 목적으로 데이터를 읽기 전용으로 열람하거나 백업할 수 있으며, 이런 관리자 작업은 모두 변경 이력에 기록됩니다.'],
  ['변경 이력', '로그인과 데이터 추가·수정·삭제·가져오기 기록(언제, 무엇을, 어떻게 바꿨는지)이 남습니다. 본인 기록은 설정 › 내 변경 이력에서 볼 수 있습니다.'],
  ['AI 기능', 'OpenAI API 키와 AI 대화는 이 브라우저에만 저장되며 서버에 올라가지 않습니다. AI 에 질문하면 자산 요약(개인 식별 정보 제외)이 OpenAI 로 전송됩니다.'],
  ['탈퇴', '설정 › 내 계정 › 회원 탈퇴를 누르면 모든 데이터와 계정이 즉시 삭제됩니다. 변경 이력은 감사 목적으로 관리자가 정리할 때까지 보관됩니다.'],
  ['유의사항', '이 서비스의 분석·추천·AI 답변은 참고용이며 투자 권유가 아닙니다. 중요한 금융 결정은 전문가와 상의하세요.'],
];
const showPrivacy = () => modal({ title: '개인정보 처리 안내', cancelText: null, okText: '닫기', wide: true, body: h('dl', { class: 'privacy' }, PRIVACY.map(([t, d]) => [h('dt', {}, t), h('dd', {}, d)])) });

function noticeBanner() {
  const n = S.appConfig?.notice;
  if (!n?.enabled || !n.text) return null;
  let dismissed = null;
  try { dismissed = localStorage.getItem(NOTICE_KEY); } catch {}
  if (dismissed && dismissed === n.updatedAt) return null;
  return h('div', { class: `notice ${n.level === 'warn' ? 'warn' : 'info'}` }, h('b', {}, '📢 공지'), h('span', { class: 'notice-text' }, n.text), h('span', { class: 'spacer' }),
    btn('닫기', () => { try { localStorage.setItem(NOTICE_KEY, n.updatedAt || ''); } catch {} render(); }, 'small'));
}

function showPending(profile) {
  $('#app').hidden = true;
  $('#boot').hidden = true;
  const login = $('#login');
  login.hidden = false;
  login.replaceChildren(h('div', { class: 'login-card' },
    h('div', { class: 'logo' }, '⏳'),
    h('h1', {}, '가입 승인 대기 중'),
    h('p', { class: 'muted' }, `${profile.email} 계정은 관리자가 승인한 뒤 사용할 수 있습니다. 승인되면 “다시 확인” 을 누르세요.`),
    btn('다시 확인', async () => {
      try {
        const p = await S.be.getProfile();
        if (p && !p.pending && !p.disabled) { S.profile = p; enterApp(); } else toast(p?.disabled ? '가입이 거절되었습니다' : '아직 승인되지 않았습니다', 'err');
      } catch (e) { toast(e.message, 'err'); }
    }, 'primary block'),
    btn('개인정보 처리 안내', showPrivacy, 'block'),
    btn('로그아웃', () => S.be.signOut(), 'block')));
}

async function onboarding() {
  const name = h('input', { value: S.profile?.name || S.user?.displayName || '', placeholder: '표시 이름' });
  const birth = h('input', { type: 'number', placeholder: '예: 1990', min: 1900, max: thisYear() });
  let start = 'template';
  const body = h('div', { class: 'form' },
    h('p', { class: 'muted' }, '몇 가지만 정하면 바로 시작할 수 있습니다. 모두 나중에 설정에서 바꿀 수 있습니다.'),
    h('label', {}, h('span', {}, '표시 이름'), name),
    h('label', {}, h('span', {}, '출생연도 (선택 · 연령별 자산배분/은퇴 계산에 사용)'), birth),
    h('div', { class: 'radio-group' },
      h('label', {}, h('input', { type: 'radio', name: 'start', checked: true, onchange: () => { start = 'template'; } }),
        h('span', {}, h('b', {}, '기본 항목으로 시작'), ' — 통장·증권·연금·대출·현금흐름·KPI 틀을 만들어 두고 금액만 입력')),
      h('label', {}, h('input', { type: 'radio', name: 'start', onchange: () => { start = 'empty'; } }),
        h('span', {}, h('b', {}, '빈 상태로 시작'), ' — 직접 추가하거나 엑셀을 업로드'))));
  if (!(await modal({ title: '환영합니다 👋', body, okText: '시작하기', cancelText: '나중에' }))) return;
  const nm = name.value.trim();
  if (nm && S.be.setDisplayName) { try { await S.be.setDisplayName(nm); S.profile = { ...S.profile, name: nm }; } catch (e) { console.warn(e); } }
  const y = Math.round(M.num(birth.value));
  if (y > 1900 && y <= thisYear()) { S.settings.birthYear = y; M.setBirthYear(y); await saveSettings(); }
  if (start === 'template') await seed(COLLECTIONS);
  else render();
}

async function deleteAccountFlow() {
  const u = S.user;
  const hasPw = u?.providerData?.some((p) => p.providerId === 'password');
  const fields = [{ key: 'c', label: `확인을 위해 이메일(${u.email})을 입력하세요` }];
  if (hasPw) fields.push({ key: 'pw', label: '비밀번호 (본인 확인)', type: 'password' });
  const v = await ask('회원 탈퇴', fields, '다음');
  if (!v) return;
  if (v.c.toLowerCase() !== String(u.email).toLowerCase()) return toast('이메일이 일치하지 않습니다', 'err');
  if (!(await confirmBox('회원 탈퇴', '자산·부채·부동산·현금흐름 등 모든 데이터와 계정이 삭제되며 되돌릴 수 없습니다. 먼저 엑셀로 백업하는 것을 권장합니다.', '탈퇴'))) return;
  // 데이터를 지우기 전에 재인증 — 인증 계정 삭제 실패로 데이터만 사라지는 일을 막음
  try { await S.be.reauth(hasPw ? v.pw : null); }
  catch (e) { return toast(`본인 확인 실패: ${authMessage(e)}`, 'err'); }
  try {
    flushLogs();
    await S.be.log({ action: 'account', target: '회원 탈퇴', detail: u.email }).catch(() => {});
    await S.be.deleteAccount();
    toast('탈퇴했습니다. 이용해 주셔서 감사합니다');
  } catch (e) { console.error(e); toast(`탈퇴 실패: ${authMessage(e)}`, 'err'); }
}

function accountCard() {
  const fb = S.be.kind === 'firebase';
  const u = S.user;
  const hasPw = fb && u?.providerData?.some((p) => p.providerId === 'password');
  const nameIn = h('input', { value: S.profile?.name || u?.displayName || '', placeholder: '표시 이름', 'data-fid': 'acct:name' });
  const birthIn = h('input', { type: 'number', value: S.settings.birthYear || '', placeholder: '예: 1990', min: 1900, max: thisYear(), 'data-fid': 'acct:birth', class: 'w-110' });
  const age = M.currentAge(S.data.history);
  return card(cardHead('내 계정', fb ? `${u?.email || ''} · ${providerName(u?.providerData?.[0]?.providerId)} 로그인${S.profile?.createdAt ? ` · 가입 ${S.profile.createdAt.slice(0, 10)}` : ''}` : '로컬 모드 (이 브라우저에만 저장)'),
    h('div', { class: 'form' },
      fb ? h('label', {}, h('span', {}, '표시 이름'), h('div', { class: 'row' }, nameIn, btn('저장', async () => {
        const nm = nameIn.value.trim();
        try { await S.be.setDisplayName(nm); S.profile = { ...S.profile, name: nm }; audit('account', '표시 이름 변경', nm); toast('저장했습니다'); } catch (e) { toast(e.message, 'err'); }
      }, 'small'))) : null,
      h('label', {}, h('span', {}, `출생연도${age ? ` (현재 만 ${age}세 기준으로 계산 중)` : ''}`), h('div', { class: 'row' }, birthIn, btn('저장', async () => {
        const y = Math.round(M.num(birthIn.value));
        if (birthIn.value && !(y > 1900 && y <= thisYear())) return toast('올바른 연도를 입력하세요', 'err');
        S.settings.birthYear = y || null; M.setBirthYear(y); await saveSettings(); render(); toast('저장했습니다');
      }, 'small'), h('span', { class: 'muted small' }, '연령별 자산배분·은퇴 계산에 사용 (연도별 추이에 나이가 있으면 그 값이 우선)')))),
    fb ? h('div', { class: 'row', style: { marginTop: '10px' } },
      u?.emailVerified ? h('span', { class: 'chip-s ok' }, '이메일 인증됨') : h('span', { class: 'chip-s warn' }, '이메일 미인증'),
      !u?.emailVerified ? btn('인증 메일 보내기', async () => { try { await S.be.sendVerify(); toast('인증 메일을 보냈습니다. 메일함을 확인하세요'); } catch (e) { toast(authMessage(e), 'err'); } }, 'small') : null,
      hasPw ? btn('비밀번호 재설정 메일', async () => { try { await S.be.resetPassword(u.email); audit('account', '비밀번호 재설정 메일 요청', u.email); toast('비밀번호 재설정 메일을 보냈습니다'); } catch (e) { toast(authMessage(e), 'err'); } }, 'small') : null,
      btn('개인정보 처리 안내', showPrivacy, 'small'),
      h('span', { class: 'spacer' }),
      btn('회원 탈퇴', deleteAccountFlow, 'small ghost-danger')) : h('div', { class: 'row', style: { marginTop: '10px' } }, btn('개인정보 처리 안내', showPrivacy, 'small')));
}

function myLogsCard() {
  const load = async () => {
    try { S.myLogs = await S.be.listLogs({ uid: S.be.kind === 'firebase' ? S.user?.uid : undefined, max: 300 }); }
    catch (e) { S.myLogs = []; toast(`이력을 불러오지 못했습니다: ${e.message}`, 'err'); }
    render();
  };
  if (!S.myLogs) {
    return card(cardHead('내 변경 이력', '로그인 · 항목 추가/수정/삭제 · 엑셀 가져오기 등 최근 300건'),
      h('div', { class: 'row' }, btn('이력 불러오기', () => { flushLogs(); setTimeout(load, 300); }, 'primary small')));
  }
  return card(cardHead('내 변경 이력', `최근 ${S.myLogs.length}건 · 수정은 4초 단위로 묶여 기록됩니다`,
    h('div', { class: 'row' }, btn('새로고침', () => { flushLogs(); setTimeout(load, 300); }, 'small'), btn('엑셀', () => exportLogs(S.myLogs, '내_변경이력'), 'small', { disabled: !S.myLogs.length }))),
    logTable(S.myLogs, { showUser: false, limit: 100 }));
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
  audit('admin', p.email, '데이터 열람(읽기 전용) 시작', { subject: p.uid });
  flushLogs();
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
  audit('export', 'JSON 전체 백업', '');
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
      audit('import', 'JSON 복원', `${f.name} · ${COLLECTIONS.map((c) => `${COLL_LABEL[c]} ${(j.data[c] || []).length}`).join(', ')}`);
      await reload(); render();
    }, '복원했습니다');
  } });
  input.click();
}

async function resetAll() {
  if (!(await confirmBox('전체 초기화', '모든 데이터를 삭제합니다. 먼저 엑셀로 백업하는 것을 권장합니다. 계속할까요?', '전체 삭제'))) return;
  await guard(async () => {
    for (const c of COLLECTIONS) { await S.be.replace(c, []); S.data[c] = []; }
    audit('bulk', '전체 데이터 초기화', '모든 컬렉션 삭제');
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
  audit('export', '엑셀 다운로드', COLLECTIONS.map((c) => `${COLL_LABEL[c]} ${S.data[c].length}`).join(', '));
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
  // 부동산ID 열이 없는 예전 양식: 같은 ID 행의 부동산 연결 유지
  for (const c of ['assets', 'liabilities']) for (const r of parsed.collections[c] || []) {
    if (!r.reId) { const old = S.data[c].find((x) => x.id === r.id); if (old?.reId) r.reId = old.reId; }
  }
  await guard(async () => {
    for (const [c, rows] of Object.entries(parsed.collections)) {
      if (mode === 'replace') await S.be.replace(c, rows);
      else await S.be.putMany(c, rows);
    }
    if (Object.keys(parsed.settings).length) {
      Object.assign(S.settings, parsed.settings);
      await S.be.saveSettings(S.settings);
    }
    audit('import', `엑셀 업로드 (${mode === 'replace' ? '교체' : '병합'})`, `${name} · ${parsed.counts.map((c) => `${c.sheet} ${c.rows}`).join(', ')}`);
    await reload();
    render();
  }, '엑셀 데이터를 가져왔습니다');
}
window.__assetApp = { handleUpload, state: S, refreshFx, go: (p) => go(p), render: () => render() };

// ---------- 렌더 ----------
const PAGE_FN = { dashboard: pageDashboard, assets: pageAssets, liabilities: pageLiabilities, realestate: pageRealestate, cashflow: pageCashflow, transactions: pageTransactions, kpi: pageKpi, history: pageHistory, portfolio: pagePortfolio, simulate: pageSimulate, strategy: pageStrategy, advisor: pageAdvisor, settings: pageSettings, admin: pageAdmin };

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
  const tops = [
    noticeBanner(),
    S.profile?.disabled && !S.viewing ? h('div', { class: 'banner bad' }, '이 계정은 관리자에 의해 비활성화되어 저장이 제한됩니다. 문의는 관리자에게 하세요.') : null,
    S.viewing ? h('div', { class: 'banner' }, `★ 관리자 열람 모드 — ${S.viewing.email} 의 데이터 (읽기 전용)`, h('span', { class: 'spacer' }), btn('열람 종료', exitView, 'small')) : null,
  ].filter(Boolean);
  main.replaceChildren(tops.length ? h('div', { class: 'stack' }, ...tops, page) : page);
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
    ? h('span', { class: 'user' }, h('span', { class: 'muted email', title: S.user.email || '' }, S.profile?.name || S.user.displayName || S.user.email || ''), btn('로그아웃', () => { flushLogs(); S.be.signOut(); }, 'small'))
    : '');
}

const FEATURES = [
  ['자산 · 부채 · 부동산', '엑셀처럼 입력하고 기준일별로 순자산 추이 관리'],
  ['현금흐름 · 소비내역', '카드·은행 명세 업로드, 예산 대비 실적'],
  ['KPI · 재무 건강 점수', '부채비율·유동성·저축률 자동 계산과 알림'],
  ['시뮬레이션 · 전략 추천', '몬테카를로, FIRE, 리밸런싱, 절세 전략'],
  ['AI 어드바이저', '내 OpenAI 키로 포트폴리오 진단 (선택)'],
];
function showLogin() {
  $('#app').hidden = true;
  const login = $('#login');
  login.hidden = false;
  const email = h('input', { type: 'email', placeholder: '이메일', autocomplete: 'username' });
  const pw = h('input', { type: 'password', placeholder: '비밀번호 (6자 이상)', autocomplete: 'current-password' });
  const err = h('p', { class: 'err' });
  const info = h('p', { class: 'ok-msg' });
  const run = (fn) => async () => { err.textContent = ''; info.textContent = ''; try { await fn(); } catch (e) { err.textContent = authMessage(e); } };
  login.replaceChildren(h('div', { class: 'login-wrap' },
    h('div', { class: 'login-intro' },
      h('div', { class: 'logo' }, '₩'),
      h('h1', {}, '자산관리'),
      h('p', { class: 'muted' }, '엑셀처럼 쉬운 개인 자산관리 플랫폼 — 누구나 무료로 가입해 사용할 수 있습니다.'),
      h('ul', { class: 'feature-list' }, FEATURES.map(([t, d]) => h('li', {}, h('b', {}, t), h('span', { class: 'muted' }, d))))),
    h('div', { class: 'login-card' },
      h('h2', {}, '로그인 / 가입'),
      btn('Google 계정으로 계속하기', run(() => S.be.signInGoogle()), 'primary block'),
      h('div', { class: 'sep' }, '또는 이메일'),
      email, pw,
      h('div', { class: 'row' },
        btn('이메일 로그인', run(() => S.be.signInEmail(email.value.trim(), pw.value)), 'block'),
        btn('회원가입', run(async () => {
          await S.be.signUpEmail(email.value.trim(), pw.value);
          try { await S.be.sendVerify(); } catch {}
        }), 'block')),
      btn('비밀번호를 잊으셨나요?', run(async () => {
        if (!email.value.trim()) throw { code: 'need-email' };
        await S.be.resetPassword(email.value.trim());
        info.textContent = '비밀번호 재설정 메일을 보냈습니다. 메일함을 확인하세요.';
      }), 'link small'),
      err, info,
      h('p', { class: 'muted small consent' }, '계속하면 ', h('a', { href: '#', onclick: (e) => { e.preventDefault(); showPrivacy(); } }, '개인정보 처리 안내'), '에 동의하는 것으로 봅니다. 입력한 데이터는 내 계정에만 저장됩니다.'))));
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
    'auth/missing-email': '이메일을 입력하세요.',
    'auth/user-not-found': '가입되지 않은 이메일입니다.',
    'auth/too-many-requests': '요청이 너무 많습니다. 잠시 후 다시 시도하세요.',
    'auth/requires-recent-login': '보안을 위해 다시 로그인한 뒤 시도하세요.',
    'auth/network-request-failed': '네트워크 연결을 확인하세요.',
    'need-email': '위 칸에 이메일을 먼저 입력하세요.',
    'auth/wrong-password': '비밀번호가 올바르지 않습니다.',
    'auth/popup-blocked': '팝업이 차단되었습니다. 팝업을 허용한 뒤 다시 시도하세요.',
    'auth/user-mismatch': '현재 로그인한 계정으로 본인 확인을 해 주세요.',
  };
  return m[e.code] || e.message;
}

async function enterApp() {
  $('#boot').hidden = false;
  $('#boot').textContent = '데이터 불러오는 중…';
  try { await reload(); } catch (e) { console.error(e); toast(`데이터를 불러오지 못했습니다: ${e.message}`, 'err'); }
  $('#boot').hidden = true;
  $('#login').hidden = true;
  $('#app').hidden = false;
  buildShell();
  render();
  if (S.settings.fxAuto !== false && isStale(S.settings.fxUpdatedAt)) refreshFx({ silent: true });
  if (S.profile?.isNew && COLLECTIONS.every((c) => !S.data[c].length)) setTimeout(onboarding, 300);
}

async function start() {
  $('#app').hidden = true;
  try {
    S.be = await createBackend();
    instrumentBackend(S.be);
  } catch (e) {
    console.error(e);
    $('#boot').textContent = `Firebase 초기화 실패: ${e.message}`;
    return;
  }
  if (S.be.kind === 'firebase') {
    S.be.onAuth(async (user) => {
      S.user = user;
      $('#boot').hidden = true;
      if (!user) {
        Object.assign(S, { admin: false, viewing: null, readOnly: false, profile: null, appConfig: null, myLogs: null, adminLogs: null, profiles: null, admins: null });
        return showLogin();
      }
      const email = (user.email || '').toLowerCase();
      S.admin = (BOOTSTRAP_ADMINS.includes(email) && user.emailVerified) || (await S.be.isAdmin(email));
      try { S.profile = await S.be.touchProfile(user, { admin: S.admin }); } catch (e) { console.warn('프로필 갱신 실패', e); S.profile = null; }
      try { S.appConfig = await S.be.getAppConfig(); } catch { S.appConfig = {}; }
      // 세션당 한 번 로그인 이력
      let first = false;
      try { const k = `asset-login-${user.uid}`; if (!sessionStorage.getItem(k)) { sessionStorage.setItem(k, '1'); first = true; } } catch { first = true; }
      if (first) audit(S.profile?.isNew ? 'signup' : 'login', providerName(S.profile?.provider || user.providerData?.[0]?.providerId), navigator.userAgent.replace(/\s+/g, ' ').slice(0, 160));
      if (S.profile?.pending && !S.admin) return showPending(S.profile);
      if (S.profile?.disabled) toast('이 계정은 관리자에 의해 비활성화되어 저장이 제한됩니다', 'err');
      enterApp();
    });
  } else {
    await enterApp();
  }
}

try { const t = localStorage.getItem(THEME_KEY); if (t) applyTheme(t); } catch {}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (!$('#app').hidden) render(); });
start();

export { isFirebaseConfigured };
