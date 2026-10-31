// Firestore 보안 규칙 공격/정상 시나리오 시뮬레이션 (에뮬레이터)
// 실행: cd dev/rules-test && npm install && npm test   (Java 11+ 필요)
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import firebase from 'firebase/compat/app';
import 'firebase/compat/firestore';

const RULES = process.env.RULES_FILE || new URL('../../firestore.rules', import.meta.url);
const env = await initializeTestEnvironment({
  projectId: 'demo-asset',
  firestore: { rules: readFileSync(RULES, 'utf8'), host: '127.0.0.1', port: 8089 },
});
const TS = () => firebase.firestore.FieldValue.serverTimestamp();
const ADMIN = 'devmh1003@gmail.com';

const ctx = {
  anon: () => env.unauthenticatedContext().firestore(),
  admin: () => env.authenticatedContext('admin', { email: ADMIN, email_verified: true }).firestore(),
  fakeAdmin: () => env.authenticatedContext('fake', { email: ADMIN, email_verified: false }).firestore(),
  admin2: () => env.authenticatedContext('admin2', { email: 'second@x.com', email_verified: true }).firestore(),
  admin2Unverified: () => env.authenticatedContext('admin2u', { email: 'second@x.com', email_verified: false }).firestore(),
  alice: () => env.authenticatedContext('alice', { email: 'alice@x.com', email_verified: true }).firestore(),
  bob: () => env.authenticatedContext('bob', { email: 'bob@x.com', email_verified: false }).firestore(),
  carol: () => env.authenticatedContext('carol', { email: 'carol@x.com', email_verified: true }).firestore(),
  noEmail: () => env.authenticatedContext('noemail', {}).firestore(),
};

const seed = async (fn) => env.withSecurityRulesDisabled(async (c) => fn(c.firestore()));
const results = [];
async function t(name, expect, fn) {
  try {
    await (expect ? assertSucceeds(fn()) : assertFails(fn()));
    results.push(['PASS', name]);
  } catch (e) {
    results.push(['FAIL', `${name} — expected ${expect ? 'ALLOW' : 'DENY'}: ${String(e.message || e).split('\n')[0].slice(0, 160)}`]);
  }
}
const log = (o = {}) => ({ uid: 'alice', email: 'alice@x.com', action: 'update', target: 't', detail: 'd', at: TS(), ...o });
let n = 0; const id = () => String(9e12 - Date.now()).padStart(13, '0') + (n++);

async function reset({ approval = false } = {}) {
  await env.clearFirestore();
  await seed(async (db) => {
    await db.doc('profiles/alice').set({ email: 'alice@x.com', name: 'Alice', createdAt: 'x' });
    await db.doc('profiles/bob').set({ email: 'bob@x.com', name: 'Bob', createdAt: 'x' });
    await db.doc('users/alice/assets/a1').set({ name: '통장', amount: 100 });
    await db.doc('users/bob/assets/b1').set({ name: 'bob 통장', amount: 200 });
    await db.doc('users/bob/meta/settings').set({ theme: 'dark' });
    await db.doc('auditLogs/bob1').set({ uid: 'bob', email: 'bob@x.com', action: 'update', target: 't', detail: 'd', at: new Date() });
    await db.doc('admins/second@x.com').set({ by: ADMIN });
    if (approval) await db.doc('meta/appConfig').set({ approvalRequired: true });
  });
}

// ===== 1. 비로그인 =====
await reset();
await t('비로그인: 타인 자산 읽기 차단', false, () => ctx.anon().doc('users/alice/assets/a1').get());
await t('비로그인: 프로필 목록 차단', false, () => ctx.anon().collection('profiles').get());
await t('비로그인: 공지(meta) 읽기 차단', false, () => ctx.anon().doc('meta/appConfig').get());
await t('비로그인: 이력 쓰기 차단', false, () => ctx.anon().doc(`auditLogs/${id()}`).set(log()));

// ===== 2. 사용자 데이터 격리 =====
await t('본인 자산 읽기', true, () => ctx.alice().doc('users/alice/assets/a1').get());
await t('본인 자산 쓰기', true, () => ctx.alice().doc('users/alice/assets/a2').set({ amount: 1 }));
await t('본인 설정 쓰기 (meta/settings)', true, () => ctx.alice().doc('users/alice/meta/settings').set({ x: 1 }));
await t('본인 부동산 쓰기', true, () => ctx.alice().doc('users/alice/realestate/r1').set({ value: 1 }));
await t('타인 자산 읽기 차단', false, () => ctx.alice().doc('users/bob/assets/b1').get());
await t('타인 자산 목록 차단', false, () => ctx.alice().collection('users/bob/assets').get());
await t('타인 자산 쓰기 차단', false, () => ctx.alice().doc('users/bob/assets/x').set({ amount: 1 }));
await t('타인 자산 삭제 차단', false, () => ctx.alice().doc('users/bob/assets/b1').delete());
await t('타인 설정 덮어쓰기 차단', false, () => ctx.alice().doc('users/bob/meta/settings').set({ theme: 'x' }));
await t('본인 하위에 임의 컬렉션 생성 차단', false, () => ctx.alice().doc('users/alice/junk/x').set({ big: 'x' }));
await t('본인 하위 깊은 중첩 문서 차단', false, () => ctx.alice().doc('users/alice/assets/a1/deep/x').set({ x: 1 }));
await t('users/{uid} 루트 문서 생성 차단', false, () => ctx.alice().doc('users/alice').set({ x: 1 }));

// ===== 3. 관리자 판별 =====
await t('관리자: 타인 자산 읽기', true, () => ctx.admin().doc('users/bob/assets/b1').get());
await t('관리자: 타인 데이터 삭제(정리)', true, () => ctx.admin().doc('users/bob/assets/b1').delete());
await t('미인증 이메일로 관리자 사칭 차단 (읽기)', false, () => ctx.fakeAdmin().doc('users/alice/assets/a1').get());
await t('미인증 이메일로 관리자 사칭 차단 (프로필 목록)', false, () => ctx.fakeAdmin().collection('profiles').get());
await t('admins 문서로 지정된 관리자: 프로필 목록', true, () => ctx.admin2().collection('profiles').get());
await t('admins 지정 + 미인증 이메일 차단', false, () => ctx.admin2Unverified().collection('profiles').get());
await t('일반 사용자: 스스로 admins 등록 차단', false, () => ctx.alice().doc('admins/alice@x.com').set({ by: 'me' }));
await t('일반 사용자: admins 목록 차단', false, () => ctx.alice().collection('admins').get());
await t('본인 admins 문서 조회(관리자 여부 확인)', true, () => ctx.alice().doc('admins/alice@x.com').get());
await t('타인 admins 문서 조회 차단', false, () => ctx.alice().doc('admins/second@x.com').get());
await t('관리자: 관리자 추가', true, () => ctx.admin().doc('admins/carol@x.com').set({ by: ADMIN }));
await t('이메일 없는 토큰: 프로필 생성 차단', false, () => ctx.noEmail().doc('profiles/noemail').set({ email: 'alice@x.com' }));

// ===== 4. 프로필 =====
await reset();
await t('본인 프로필 생성 (승인제 꺼짐)', true, () => ctx.carol().doc('profiles/carol').set({ email: 'carol@x.com', name: 'C' }));
await env.clearFirestore(); await reset();
await t('타인 uid 로 프로필 생성 차단', false, () => ctx.carol().doc('profiles/zzz').set({ email: 'carol@x.com' }));
await t('다른 이메일로 프로필 생성 차단 (관리자 사칭)', false, () => ctx.carol().doc('profiles/carol').set({ email: ADMIN }));
await t('disabled 필드 포함 생성 차단', false, () => ctx.carol().doc('profiles/carol').set({ email: 'carol@x.com', disabled: false }));
await t('memo 필드 포함 생성 차단', false, () => ctx.carol().doc('profiles/carol').set({ email: 'carol@x.com', memo: 'x' }));
await t('approvedBy 위조 생성 차단', false, () => ctx.carol().doc('profiles/carol').set({ email: 'carol@x.com', approvedBy: ADMIN }));
await t('본인 프로필 갱신 (lastLogin/name)', true, () => ctx.alice().doc('profiles/alice').set({ lastLogin: 'now', name: 'A2' }, { merge: true }));
await t('본인 프로필 이메일 변경 차단', false, () => ctx.alice().doc('profiles/alice').set({ email: ADMIN }, { merge: true }));
await t('본인 프로필 memo 수정 차단', false, () => ctx.alice().doc('profiles/alice').set({ memo: 'x' }, { merge: true }));
await t('본인 프로필 disabled 해제 차단', false, () => ctx.alice().doc('profiles/alice').set({ disabled: false }, { merge: true }));
await t('타인 프로필 읽기 차단', false, () => ctx.alice().doc('profiles/bob').get());
await t('타인 프로필 수정 차단', false, () => ctx.alice().doc('profiles/bob').set({ name: 'hacked' }, { merge: true }));
await t('프로필 목록 차단 (일반)', false, () => ctx.alice().collection('profiles').get());
await t('관리자: 프로필 목록', true, () => ctx.admin().collection('profiles').get());
await t('관리자: 사용자 비활성화', true, () => ctx.admin().doc('profiles/bob').set({ disabled: true }, { merge: true }));
await t('비활성 사용자: 본인 데이터 읽기 (백업용)', true, () => ctx.bob().doc('users/bob/assets/b1').get());
await t('비활성 사용자: 본인 데이터 쓰기 차단', false, () => ctx.bob().doc('users/bob/assets/b1').set({ amount: 1 }));
await t('비활성 사용자: 설정 쓰기 차단', false, () => ctx.bob().doc('users/bob/meta/settings').set({ x: 1 }));
await t('비활성 사용자: 프로필 삭제로 우회 차단', false, () => ctx.bob().doc('profiles/bob').delete());
await t('비활성 사용자: disabled 해제 차단', false, () => ctx.bob().doc('profiles/bob').update({ disabled: false }));
await t('비활성 사용자: 데이터 변경 이력 쓰기 차단', false, () => ctx.bob().doc(`auditLogs/${id()}`).set(log({ uid: 'bob', email: 'bob@x.com' })));
await t('비활성 사용자: 로그인 이력 쓰기', true, () => ctx.bob().doc(`auditLogs/${id()}`).set(log({ uid: 'bob', email: 'bob@x.com', action: 'login' })));
await t('비활성 사용자: lastLogin 갱신 (로그인 처리)', true, () => ctx.bob().doc('profiles/bob').set({ email: 'bob@x.com', lastLogin: 'now', loginCount: 2 }, { merge: true }));
await t('본인 탈퇴: 프로필 삭제', true, () => ctx.alice().doc('profiles/alice').delete());

// ===== 5. 가입 승인제 =====
await reset({ approval: true });
await t('승인제: pending 없이 프로필 생성 차단', false, () => ctx.carol().doc('profiles/carol').set({ email: 'carol@x.com' }));
await t('승인제: pending=false 로 생성 차단', false, () => ctx.carol().doc('profiles/carol').set({ email: 'carol@x.com', pending: false }));
await t('승인제: 프로필 없이 데이터 쓰기 차단', false, () => ctx.carol().doc('users/carol/assets/x').set({ a: 1 }));
await t('승인제: pending=true 로 생성', true, () => ctx.carol().doc('profiles/carol').set({ email: 'carol@x.com', pending: true }));
await t('승인 대기: 데이터 쓰기 차단', false, () => ctx.carol().doc('users/carol/assets/x').set({ a: 1 }));
await t('승인 대기: pending 해제 차단', false, () => ctx.carol().doc('profiles/carol').set({ pending: false }, { merge: true }));
await t('승인 대기: pending 필드 삭제 차단', false, () => ctx.carol().doc('profiles/carol').update({ pending: firebase.firestore.FieldValue.delete() }));
await t('승인 대기: 프로필 삭제 후 재생성 시 다시 pending', false, async () => {
  await ctx.carol().doc('profiles/carol').delete();
  await ctx.carol().doc('profiles/carol').set({ email: 'carol@x.com' });
});
await t('승인 대기: 데이터 변경 이력 쓰기 차단', false, () => ctx.carol().doc(`auditLogs/${id()}`).set(log({ uid: 'carol', email: 'carol@x.com', action: 'create' })));
await t('승인 대기: 가입 이력 쓰기', true, () => ctx.carol().doc(`auditLogs/${id()}`).set(log({ uid: 'carol', email: 'carol@x.com', action: 'signup' })));
await t('승인 대기: 공지 읽기', true, () => ctx.carol().doc('meta/appConfig').get());
await t('관리자: 승인', true, () => ctx.admin().doc('profiles/carol').set({ pending: false, approvedBy: ADMIN }, { merge: true }));
await t('승인 후: 데이터 쓰기', true, () => ctx.carol().doc('users/carol/assets/x').set({ a: 1 }));
await t('기존 사용자(승인제 이전 가입): 데이터 쓰기 유지', true, () => ctx.alice().doc('users/alice/assets/a9').set({ a: 1 }));

// ===== 6. 운영 설정 =====
await t('일반 사용자: 공지/승인제 변경 차단', false, () => ctx.alice().doc('meta/appConfig').set({ approvalRequired: false, notice: { text: 'x' } }, { merge: true }));
await t('일반 사용자: 분류 템플릿 변경 차단', false, () => ctx.alice().doc('meta/taxonomyTemplate').set({ taxonomy: {} }));
await t('관리자: 공지 변경', true, () => ctx.admin().doc('meta/appConfig').set({ notice: { text: '점검', on: true } }, { merge: true }));

// ===== 7. 변경 이력 (auditLogs) =====
await reset();
await t('본인 이력 쓰기', true, () => ctx.alice().doc(`auditLogs/${id()}`).set(log()));
await t('타인 uid 로 이력 위조 차단', false, () => ctx.alice().doc(`auditLogs/${id()}`).set(log({ uid: 'bob' })));
await t('다른 이메일로 이력 위조 차단', false, () => ctx.alice().doc(`auditLogs/${id()}`).set(log({ email: ADMIN })));
await t('과거 시각으로 이력 위조 차단', false, () => ctx.alice().doc(`auditLogs/${id()}`).set(log({ at: new Date('2020-01-01') })));
await t('관리자 작업 이력 위조 차단', false, () => ctx.alice().doc(`auditLogs/${id()}`).set(log({ action: 'admin' })));
await t('알 수 없는 action 차단', false, () => ctx.alice().doc(`auditLogs/${id()}`).set(log({ action: 'evil' })));
await t('허용되지 않은 필드 차단', false, () => ctx.alice().doc(`auditLogs/${id()}`).set(log({ extra: 1 })));
await t('과대 detail 차단', false, () => ctx.alice().doc(`auditLogs/${id()}`).set(log({ detail: 'x'.repeat(2001) })));
await t('target 비문자열 차단', false, () => ctx.alice().doc(`auditLogs/${id()}`).set(log({ target: { a: 1 } })));
await t('subject 과대 차단', false, () => ctx.alice().doc(`auditLogs/${id()}`).set(log({ subject: 'x'.repeat(200) })));
await t('이력 수정 차단 (본인)', false, async () => {
  const k = id(); await ctx.alice().doc(`auditLogs/${k}`).set(log());
  await ctx.alice().doc(`auditLogs/${k}`).set(log({ detail: 'changed' }));
});
await t('이력 삭제 차단 (본인)', false, () => ctx.bob().doc('auditLogs/bob1').delete());
await t('타인 이력 읽기 차단', false, () => ctx.alice().doc('auditLogs/bob1').get());
await t('전체 이력 조회 차단 (일반)', false, () => ctx.alice().collection('auditLogs').limit(10).get());
await t('본인 이력 조회 (uid 필터)', true, () => ctx.alice().collection('auditLogs').where('uid', '==', 'alice').limit(50).get());
await t('타인 uid 필터 조회 차단', false, () => ctx.alice().collection('auditLogs').where('uid', '==', 'bob').limit(50).get());
await t('관리자: 전체 이력 조회 (시각 정렬)', true, () => ctx.admin().collection('auditLogs').orderBy('at', 'desc').limit(50).get());
await t('관리자: 관리자 작업 이력 쓰기', true, () => ctx.admin().doc(`auditLogs/${id()}`).set(log({ uid: 'admin', email: ADMIN, action: 'admin', subject: 'bob' })));
await t('관리자: 이력 수정도 차단', false, () => ctx.admin().doc('auditLogs/bob1').set({ uid: 'bob', detail: 'x' }));
await t('추가 관리자: 이력 삭제 차단 (소유자만)', false, () => ctx.admin2().doc('auditLogs/bob1').delete());
await t('소유자: 오래된 이력 삭제', true, () => ctx.admin().doc('auditLogs/bob1').delete());
await t('관리자: 이력 범위 삭제 조회 (at < 기준)', true, () => ctx.admin().collection('auditLogs').where('at', '<', new Date()).limit(400).get());

// ===== 8. 추가 강화 항목 =====
await reset();
await t('관리자 메모: 대상 사용자 읽기 차단', false, async () => {
  await ctx.admin().doc('adminNotes/alice').set({ memo: '주의 고객' });
  await ctx.alice().doc('adminNotes/alice').get();
});
await t('관리자 메모: 관리자 읽기', true, () => ctx.admin().collection('adminNotes').get());
await t('관리자 메모: 일반 사용자 쓰기 차단', false, () => ctx.alice().doc('adminNotes/alice').set({ memo: 'x' }));
await t('미인증 계정이 emailVerified=true 위조 차단', false, () => ctx.bob().doc('profiles/bob').set({ emailVerified: true }, { merge: true }));
await t('인증 계정 emailVerified=true 기록', true, () => ctx.alice().doc('profiles/alice').set({ emailVerified: true }, { merge: true }));
await t('미인증 계정 emailVerified=false 기록', true, () => ctx.bob().doc('profiles/bob').set({ emailVerified: false, lastLogin: 'n' }, { merge: true }));
await t('프로필 임의 필드 추가 차단', false, () => ctx.alice().doc('profiles/alice').set({ role: 'admin' }, { merge: true }));
await t('프로필 이름 과대 차단', false, () => ctx.alice().doc('profiles/alice').set({ name: 'x'.repeat(101) }, { merge: true }));
await t('meta 하위 settings 외 문서 차단', false, () => ctx.alice().doc('users/alice/meta/other').set({ x: 1 }));
await t('본인 전체 컬렉션 쓰기 (앱 컬렉션 12종)', true, async () => {
  for (const c of ['assets', 'liabilities', 'cashflow', 'history', 'portfolio', 'goals', 'kpis', 'scenarios', 'reports', 'transactions', 'realestate', 'recurring']) await ctx.alice().doc(`users/alice/${c}/z`).set({ a: 1 });
});
await t('관리자: 사용자 데이터 정리 (meta/settings 포함)', true, () => ctx.admin().doc('users/bob/meta/settings').delete());
await t('추가 관리자: 기본 관리자 admins 문서 생성은 허용(무해)', true, () => ctx.admin2().doc('admins/x@y.com').set({ by: 'second@x.com' }));

await env.cleanup();
const fails = results.filter((r) => r[0] === 'FAIL');
for (const r of results) console.log(r[0], r[1]);
console.log(`\n${results.length - fails.length}/${results.length} passed`);
process.exit(fails.length ? 1 : 0);
