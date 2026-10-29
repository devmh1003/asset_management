# 자산관리 플랫폼

개인 자산현황 엑셀(`B.S / D.L / C.F / Main / 포폴구성 / 결산` 시트)의 구조를 웹으로 옮긴 HTML 기반 자산관리 앱입니다.
Firebase(Auth + Firestore) 에 저장하고, 엑셀로 내려받아 편집한 뒤 다시 업로드할 수 있습니다.

## 화면

| 페이지 | 엑셀 원본 | 내용 |
|---|---|---|
| 대시보드 | Main | 순자산·총자산·부채비율·목표 달성률, 대분류 비중, Var/Risk/Fixed 그룹, 기준일별 비중표 |
| 자산 (B.S) | B.S(1Q) | 기준일별 자산 목록. 공정가치 × 환율 = 원화환산, 비중, 기대이익, NRV 자동 계산 |
| 부채 (D.L) | D.L | 채권자·금액·만기·금리, 연이자 자동 계산 |
| 현금흐름 (C.F) | C.F | 연도별 월간 수입/지출 (단위: 만원), Net Income·누적 자동 계산 |
| 연도별 추이 | Main 우측 표 | 기준일별 순자산·목표치·나이, 증가율·달성률 자동 계산 |
| 포트폴리오 | 포폴구성 | 투자안별 구성, 최대/최소/평균 수익률, FV |
| 관리목표 | 25년결산 중점 관리사항 | 목표·지표·전략, 현재 지표값 자동 표시 |
| 설정 | B.S 환율표 / 분류체계 | 환율, 대분류/중분류 체계, 엑셀 입출력, 데이터 초기화 |

## 실행

정적 파일이므로 `public/` 폴더를 아무 웹서버로 띄우면 됩니다.

```bash
python dev/serve.py 8765
```

`public/js/firebase-config.js` 의 `apiKey` 가 비어 있으면 **로컬 모드**(브라우저 localStorage 저장)로 동작합니다.

## Firebase 설정 (무료 Spark 플랜)

1. [Firebase 콘솔](https://console.firebase.google.com) 에서 프로젝트 생성
2. **Authentication → Sign-in method** 에서 `Google` 과 `이메일/비밀번호` 사용 설정
3. **Firestore Database** 생성 (프로덕션 모드, 리전 `asia-northeast3` 권장)
4. Firestore **규칙** 탭에 `firestore.rules` 내용 붙여넣기 (본인 `users/{uid}` 문서만 접근 가능)
5. **프로젝트 설정 → 내 앱 → 웹 앱 추가** 후 `firebaseConfig` 값을 `public/js/firebase-config.js` 에 복사
6. **Authentication → Settings → 승인된 도메인** 에 배포 도메인(예: `devmh1003.github.io`) 추가

## 배포

`main` 브랜치에 푸시하면 GitHub Actions 가 `public/` 을 GitHub Pages 로 배포합니다.

## 엑셀 입출력

- **다운로드**: 현재 데이터를 시트별로 내보냅니다. 헤더에 `*` 가 붙은 열은 자동 계산 열입니다.
- **업로드**: 같은 양식의 파일을 올리면 시트별 행 수를 확인한 뒤 **교체**(파일 기준으로 전부 바꿈) 또는 **병합**(ID 기준 추가/수정) 을 선택합니다.
- **빈 양식 다운로드**: 금액이 0 인 기본 구조 파일을 받습니다.

## 데이터 구조 (Firestore)

```
users/{uid}/assets/{id}       기준일(basis), 대분류, 중분류, 소분류, 통화, 공정가치, 기대이익률, 운용위임사, 기타
users/{uid}/liabilities/{id}  채권자, 금액, 만기일, 금리, 상환방식
users/{uid}/cashflow/{id}     연도, 구분(수입/지출), 그룹, 항목, m[12] (만원)
users/{uid}/history/{id}      기준일, 평가, 순자산, 부채비율, 목표치, 나이
users/{uid}/portfolio/{id}    안 이름, 구분, 대분류, 중분류, 형태, 금액, 최대/최소/평균 수익률
users/{uid}/goals/{id}        항목, 목표, 지표, 현 상황, 전략, 진행
users/{uid}/meta/settings     환율(fx), 분류체계(taxonomy)
```
