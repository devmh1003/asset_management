// OpenAI Chat Completions 연동 (브라우저 직접 호출)
// API 키는 이 브라우저의 localStorage 에만 저장되며 Firestore 등 서버로 전송되지 않는다.
// 서버 프록시(예: Cloudflare Worker)를 쓰려면 endpoint 를 프록시 주소로 바꾸고 키는 비워 둔다.

const CFG_KEY = 'asset-manager-ai';
const CHAT_KEY = 'asset-manager-ai-chat';
// 같은 브라우저를 여러 계정이 쓰는 경우를 위해 키·대화는 로그인 계정별로 분리 저장
let scope = '';
const cfgKey = () => (scope ? `${CFG_KEY}:${scope}` : CFG_KEY);
const chatKey = () => (scope ? `${CHAT_KEY}:${scope}` : CHAT_KEY);
export function setAiUser(uid) {
  scope = uid || '';
  if (!scope) return;
  // 계정별 저장 이전에 등록한 키·대화는 처음 로그인한 계정으로 옮김
  try {
    for (const [oldKey, newKey] of [[CFG_KEY, cfgKey()], [CHAT_KEY, chatKey()]]) {
      const v = localStorage.getItem(oldKey);
      if (v != null) { if (localStorage.getItem(newKey) == null) localStorage.setItem(newKey, v); localStorage.removeItem(oldKey); }
    }
  } catch {}
}

export const AI_MODELS = ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini', 'gpt-4.1', 'gpt-5-mini', 'gpt-5', 'o4-mini'];
export const DEFAULT_AI = { key: '', model: 'gpt-4o-mini', endpoint: 'https://api.openai.com/v1' };

export function loadAiConfig() {
  try { return { ...DEFAULT_AI, ...(JSON.parse(localStorage.getItem(cfgKey()) || '{}')) }; } catch { return { ...DEFAULT_AI }; }
}
export function saveAiConfig(cfg) {
  try { localStorage.setItem(cfgKey(), JSON.stringify({ key: cfg.key || '', model: cfg.model || DEFAULT_AI.model, endpoint: (cfg.endpoint || DEFAULT_AI.endpoint).replace(/\/+$/, '') })); } catch {}
}
export const aiReady = (cfg = loadAiConfig()) => !!(cfg.key || (cfg.endpoint && cfg.endpoint !== DEFAULT_AI.endpoint));
export const maskKey = (k) => (k ? `${k.slice(0, 7)}…${k.slice(-4)}` : '');

export function loadChat() { try { return JSON.parse(localStorage.getItem(chatKey()) || '[]'); } catch { return []; } }
export function saveChat(msgs) { try { localStorage.setItem(chatKey(), JSON.stringify(msgs.slice(-40))); } catch {} }

function headers(cfg) {
  const h = { 'Content-Type': 'application/json' };
  if (cfg.key) h.Authorization = `Bearer ${cfg.key}`;
  return h;
}

async function errorOf(res) {
  let msg = `HTTP ${res.status}`;
  try { const j = await res.json(); msg = j.error?.message || msg; } catch {}
  if (res.status === 401) msg = `API 키가 올바르지 않습니다 (${msg})`;
  if (res.status === 429) msg = `요청 한도 또는 잔액 부족 (${msg})`;
  return new Error(msg);
}

// OpenAI 는 인증 오류(401) 응답에 CORS 헤더를 붙이지 않아 브라우저에서는 "Failed to fetch" 로만 보인다
async function post(cfg, body, signal) {
  try {
    return await fetch(`${cfg.endpoint}/chat/completions`, { method: 'POST', headers: headers(cfg), signal, body: JSON.stringify(body) });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new Error('OpenAI 에 연결하지 못했습니다 — API 키가 잘못되었거나(가장 흔함) 네트워크/프록시 문제입니다. 설정에서 키를 다시 확인하세요.');
  }
}

// 스트리밍 응답. onDelta(text) 로 조각을 전달하고 전체 텍스트를 반환
export async function chatStream({ cfg = loadAiConfig(), messages, onDelta, signal }) {
  const res = await post(cfg, { model: cfg.model, messages, stream: true }, signal);
  if (!res.ok) throw await errorOf(res);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '', full = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const line of lines) {
      const t = line.trim();
      if (!t.startsWith('data:')) continue;
      const data = t.slice(5).trim();
      if (data === '[DONE]') continue;
      try {
        const j = JSON.parse(data);
        const delta = j.choices?.[0]?.delta?.content || '';
        if (delta) { full += delta; onDelta?.(delta, full); }
      } catch {}
    }
  }
  return full;
}

// JSON 응답 (자동 분류 등 구조화 작업용)
export async function chatJson({ cfg = loadAiConfig(), messages, signal }) {
  const res = await post(cfg, { model: cfg.model, messages, response_format: { type: 'json_object' } }, signal);
  if (!res.ok) throw await errorOf(res);
  const j = await res.json();
  const text = j.choices?.[0]?.message?.content || '{}';
  return JSON.parse(text);
}

// 연결 테스트: 가장 짧은 요청
export async function testConnection(cfg) {
  const res = await post(cfg, { model: cfg.model, messages: [{ role: 'user', content: 'ping' }], max_completion_tokens: 5 });
  if (!res.ok) throw await errorOf(res);
  const j = await res.json();
  return j.model || cfg.model;
}

export const SYSTEM_PROMPT = `당신은 한국 개인 투자자를 돕는 자산운용 어드바이저입니다. 사용자의 자산·부채·현금흐름·KPI 데이터(JSON)가 주어집니다.
- 한국어로, 핵심부터 간결하게. 숫자는 억/만원 단위로 읽기 쉽게.
- 구체적인 행동 제안(무엇을·얼마나·왜)을 우선순위로 제시. 근거는 데이터의 수치를 인용.
- 비상자금(3~6개월 생활비), 부채비율, 분산, 연령 대비 위험자산 비중, 저축률, 수수료, 세제 혜택 계좌(ISA·연금저축·IRP) 활용을 점검.
- 특정 종목 매수/매도 지시나 수익률 보장은 하지 말고, 일반적인 자산배분 원칙에 따른 제안임을 명시. 마지막에 한 줄로 "투자 판단의 책임은 본인에게 있음" 을 안내.
- 마크다운(제목 ##, 목록 -, 굵게 **) 을 사용하되 표는 피함.`;

export const QUICK_PROMPTS = [
  ['포트폴리오 진단', '현재 자산 구성을 진단해 주세요. 강점·약점 3가지씩과 우선순위가 높은 개선 행동 3가지를 알려주세요.'],
  ['리밸런싱 제안', '내 나이와 위험 성향(중립)을 고려해 대분류별 목표 비중을 제안하고, 현재 대비 어떤 자산을 얼마나 늘리거나 줄여야 하는지 금액으로 알려주세요.'],
  ['부채 전략', '부채 현황을 보고 상환 우선순위(금리·만기 기준)와 월 상환액 제안, 투자 대비 상환이 유리한지 판단해 주세요.'],
  ['현금흐름·비상자금', '현금흐름과 비상자금 수준을 점검하고 저축률을 올릴 수 있는 지출 조정 아이디어를 제안해 주세요.'],
  ['월간 리포트', '이번 달 자산 리포트를 작성해 주세요: 요약 → 변동 요인 → KPI 진행 상황 → 알림/리스크 → 다음 달 할 일 체크리스트 순서로.'],
  ['절세·계좌 활용', '한국 세제 혜택 계좌(ISA, 연금저축, IRP)와 비과세·분리과세 관점에서 현재 자산 배치를 어떻게 바꾸면 좋을지 알려주세요.'],
  ['KPI 점검', '올해 KPI 목표 대비 진행 상황을 평가하고, 연말까지 달성하려면 분기별로 무엇을 해야 하는지 알려주세요.'],
  ['자산 증식 전략', '데이터의 자동추천전략 목록과 자산·현금흐름을 바탕으로, 자산을 가장 효율적으로 불릴 수 있는 실행 계획을 우선순위·금액·시기와 함께 제시해 주세요. 세제 혜택 계좌, 비용 절감, 리스크 관리, 자동화(DCA·리밸런싱 규칙) 관점을 포함하고, 최근 소비 패턴에서 줄일 수 있는 항목도 짚어 주세요.'],
  ['소비 패턴 분석', '최근 소비내역(카테고리별 금액)을 분석해 과소비 항목, 고정비 절감 기회, 다음 달 예산안을 제안해 주세요.'],
];
