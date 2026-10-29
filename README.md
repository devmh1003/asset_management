# 자산관리 플랫폼

개인 자산현황 엑셀(`B.S / D.L / C.F / Main / 포폴구성 / 결산` 시트)의 구조를 웹으로 옮긴 HTML 기반 자산관리 앱입니다.
Firebase(Auth + Firestore) 에 저장하고, 엑셀로 내려받아 편집한 뒤 다시 업로드할 수 있습니다.

- 배포: https://devmh1003.github.io/asset_management/
- Firebase 프로젝트: `asset-management-6c342` (Spark 무료 플랜, Firestore `asia-northeast3`)

## 화면

| 페이지 | 엑셀 원본 | 내용 |
|---|---|---|
| 대시보드 | Main | 순자산 히어로, 자산 변동 이력(기준일별 대분류 누적), 자산 구성, 핵심 KPI 진행률, Var/Risk/Fixed, 기준일별 비중표, 인사이트(연말 예상 순자산·만기 부채·분기 스냅샷 안내) |
| 자산 (B.S) | B.S(1Q) | 기준일별 자산 목록. 공정가치 × 환율 = 원화환산, 비중, 기대이익, NRV 자동 계산 |
| 부채 (D.L) | D.L | 채권자·금액·만기·금리, 연이자/월이자 자동 계산 |
| 현금흐름 (C.F) | C.F | 연도별 월간 수입/지출 (단위: 만원), Net Income·누적 자동 계산 |
| 핵심 KPI | 결산 중점 관리사항 | 연도별 KPI 목표 ↔ 분기별 실적 자동 계산(수동값 우선), 달성률 차트 |
| 연도별 추이 | Main 우측 표 | 기준일별 순자산·목표치·나이, 증가율·달성률·CAGR |
| 포트폴리오 | 포폴구성 | 투자안별 구성, 최대/최소/평균 수익률, FV |
| 시뮬레이션 | — | 순자산 전망(낙관/기본/비관·실질가치·목표 도달), 리밸런싱(목표 비중 → 매수/매도, 연령 기준 프리셋), 부채 상환(완납 시점·총이자), 은퇴·FIRE(필요 자산·도달 시점·필요 월 저축·코스트 FIRE·SWR 매트릭스). 시나리오 저장 |
| AI 어드바이저 | — | OpenAI API 로 자산 데이터 기반 조언: 포트폴리오 진단·리밸런싱·부채 전략·현금흐름·월간 리포트·절세·KPI 점검. 스트리밍 답변, 리포트 저장(엑셀 시트 포함) |
| 설정 | B.S 환율표 / 분류체계 | 환율(자동 갱신), 대분류/중분류 체계, OpenAI 키·모델, 엑셀·JSON 입출력, 테마, 인쇄 |
| 관리자 | — | 계정 목록·통계·읽기전용 열람·비활성화·관리자 지정, 추천 분류 템플릿 편집 (관리자 계정에만 표시) |

## 자산운용사·로보어드바이저 벤치마크 기능

| 기능 | 벤치마크 | 위치 |
|---|---|---|
| 재무 건강 점수 (비상자금·부채·저축률·분산·연령 대비 위험·KPI, 가중 평균 0~100, A~E 등급) | 뱅크샐러드 금융건강점수, Empower Retirement Readiness | 대시보드 |
| 알림 센터 (부채 만기/고금리, 비상자금 부족, 단일 자산 집중, 위험 비중, 수수료, 부채비율, 환율 노후, 분기 기준일 누락, KPI 미달, 예산 초과) | Mint Alerts, Betterment 리밸런싱 알림, 토스 소비 알림 | 대시보드 |
| 은퇴·FIRE 계산기 (4% 규칙, Lean/Fat × SWR 매트릭스, 목표 나이까지 필요한 월 저축, 코스트 FIRE) | Wealthfront Path, Empower Retirement Planner | 시뮬레이션 |
| 연령 기반 글라이드패스 (110 − 나이 규칙 목표 위험 비중) | 타깃데이트펀드, 핀트/파운트 로보어드바이저 | 리밸런싱 프리셋 · 건강 점수 |
| 예산 vs 실제 (지출 항목별 월 예산, 예산대비 %, 이번 달 초과 알림) | Mint/YNAB 예산, 뱅크샐러드 예산 | 현금흐름 · 대시보드 |
| 수수료 분석 (자산별 연보수율 → 연간 비용, 10·20년 복리 손실) | Empower Fee Analyzer | 자산 |
| AI 어드바이저 + 월간 리포트 + AI 자동 분류 | Betterment Digital Advice, 핀트 리포트, 토스/뱅크샐러드 자동 분류 | AI 어드바이저 · 자산 |

### OpenAI 연동 방식

- 설정 페이지에서 **본인 OpenAI API 키**를 입력합니다. 키는 브라우저 `localStorage` 에만 저장되고 Firestore 등 서버로는 전송되지 않습니다 (공용 PC 에서는 사용 후 삭제).
- 질문 시 자산·부채·현금흐름·KPI 의 **요약(이름·금액·분류·비율, 억원 단위)** 과 건강 점수·알림이 시스템 프롬프트로 함께 전송됩니다. 이메일 등 개인 식별 정보는 포함하지 않습니다. “데이터 요약 보기” 로 전송 내용을 확인할 수 있습니다.
- 기본 모델 `gpt-4o-mini` (질문 1회 ≈ 1~3원). 모델명은 자유 입력.
- 키를 브라우저에 두고 싶지 않다면 `엔드포인트` 를 자체 프록시(Cloudflare Worker 등, OpenAI 호환 `/chat/completions`)로 바꾸고 키를 비워 두면 됩니다.
- AI 답변은 참고 정보이며 투자 권유가 아닙니다.

## 엑셀처럼 쓰기

- 헤더 클릭 정렬, `Enter`/`↑`/`↓` 로 같은 열의 위·아래 행 이동, 행 순서 이동(↑↓)·복제·삭제
- 검색 필터, 대분류별 자동 색상, 원화환산 데이터바, 음수 빨간색
- 금액 칸에 `1.2억`, `500만`, `1,200만원`, `$1,000` 처럼 입력하면 원 단위로 파싱 (통화 기호가 있으면 통화도 자동 설정)
- 소분류 이름을 입력하면 키워드로 대분류/중분류 자동 분류 (예: `업비트` → 가상자산 › 거래소 현물, `청약` → 현금 › 청약저축). 분류가 기본값일 때만 적용되며 언제든 수정 가능
- 소분류·운용위임사 자동완성, `✨ 자동 정리` 버튼(공백 정리·미분류 자동 분류·통화 보정), 중복 이름 경고

## 실행

정적 파일이므로 `public/` 폴더를 아무 웹서버로 띄우면 됩니다.

```bash
python dev/serve.py 8765
```

- `public/js/firebase-config.js` 의 `apiKey` 가 비어 있으면 **로컬 모드**(브라우저 localStorage 저장)로 동작합니다.
- URL 에 `?local=1` 을 붙이면 Firebase 설정이 있어도 로컬 모드로 열립니다 (로그인 없이 테스트).

## Firebase 설정 (무료 Spark 플랜)

1. [Firebase 콘솔](https://console.firebase.google.com) 에서 프로젝트 생성
2. **Authentication → Sign-in method** 에서 `Google` 과 `이메일/비밀번호` 사용 설정
3. **Firestore Database** 생성 (프로덕션 모드, 리전 `asia-northeast3` 권장)
4. Firestore **규칙** 탭에 `firestore.rules` 내용 붙여넣기
5. **프로젝트 설정 → 내 앱 → 웹 앱 추가** 후 `firebaseConfig` 값을 `public/js/firebase-config.js` 에 복사
6. **Authentication → Settings → 승인된 도메인** 에 배포 도메인(예: `devmh1003.github.io`) 추가

### 보안 모델

- 웹 `apiKey` 는 공개 식별자입니다. 접근 제어는 `firestore.rules` 와 승인된 도메인이 담당합니다.
- 각 사용자는 `users/{자기 uid}` 아래만 읽고 씁니다.
- 관리자: `firestore.rules` 의 부트스트랩 이메일 목록 또는 `admins/{email}` 문서. 관리자는 모든 사용자 데이터 열람·정리, `profiles` 의 `disabled` 설정, 추천 분류 템플릿(`meta/taxonomyTemplate`) 편집 가능.
- 비활성화(`profiles/{uid}.disabled = true`)된 계정은 로그인은 되지만 Firestore 쓰기가 거부됩니다. 사용자는 자신의 `disabled` 값을 바꿀 수 없습니다.
- Auth 계정 자체의 삭제/비밀번호 초기화는 Firebase 콘솔에서만 가능합니다 (무료 플랜에는 서버 코드가 없음).

## 배포

`main` 브랜치에 푸시하면 GitHub Actions 가 `public/` 을 GitHub Pages 로 배포합니다.

## 엑셀 입출력

- **다운로드**: 현재 데이터를 시트별로 내보냅니다. 헤더에 `*` 가 붙은 열은 자동 계산 열입니다.
- **업로드**: 같은 양식의 파일을 올리면 시트별 행 수를 확인한 뒤 **교체**(파일 기준으로 전부 바꿈) 또는 **병합**(ID 기준 추가/수정) 을 선택합니다.
- **빈 양식 다운로드**: 금액이 0 인 기본 구조 파일을 받습니다.
- 시트: 자산(B.S) · 부채(D.L) · 현금흐름(C.F) · 연도별추이 · 포트폴리오 · KPI · 시나리오 · AI리포트 · 관리목표 · 환율 · 분류체계 · 안내
- **JSON 전체 백업/복원** 도 설정 페이지에서 가능합니다.

## 데이터 구조 (Firestore)

```
users/{uid}/assets/{id}       기준일(basis), 대분류, 중분류, 소분류, 통화, 공정가치, 기대이익률, 연보수율(fee), 운용위임사, 기타
users/{uid}/liabilities/{id}  채권자, 금액, 만기일, 금리, 상환방식
users/{uid}/cashflow/{id}     연도, 구분(수입/지출), 그룹, 항목, 월예산(budget, 만원), m[12] (만원)
users/{uid}/reports/{id}      AI 리포트 (날짜, 제목, 모델, 내용)
users/{uid}/history/{id}      기준일, 평가, 순자산, 부채비율, 목표치, 나이
users/{uid}/portfolio/{id}    안 이름, 구분, 대분류, 중분류, 형태, 금액, 최대/최소/평균 수익률
users/{uid}/kpis/{id}         연도, KPI명, 지표, 방향, 목표, q[4](수동 실적), 메모
users/{uid}/scenarios/{id}    시뮬레이션 저장본
users/{uid}/goals/{id}        항목, 목표, 지표, 현 상황, 전략, 진행
users/{uid}/meta/settings     환율(fx, fxUpdatedAt, fxAuto), 분류체계(taxonomy)
profiles/{uid}                이메일, 이름, 가입/최근 로그인, disabled, 관리자 메모
admins/{email}                추가 관리자
meta/taxonomyTemplate         관리자가 편집한 추천 분류 템플릿
```

환율은 [open.er-api.com](https://open.er-api.com) 에서 12시간 경과 시 자동 갱신됩니다 (설정에서 끌 수 있음).
