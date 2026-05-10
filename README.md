# 유니와니 가계부

부부가 함께 월급 통장, 고정비 분배, 생활비 정산, 예적금, 주택 자금, 전체 자산을 관리하는 웹앱입니다.

## 실행

브라우저에서 `index.html`을 열면 바로 사용할 수 있습니다.

```text
file:///C:/Users/kto09/OneDrive/%EB%AC%B8%EC%84%9C/New%20project/index.html
```

배포 URL:

```text
https://uniwani-budget-240225.web.app
```

## 현재 기능

- 월별 수입/지출 대시보드
- 월별 수입/지출 그래프
- 월급 통장 고정비 지출 관리
- 고정비 체크 후 날짜 선택 시 거래 내역 자동 추가
- 거래 내역 추가/수정/삭제/검색
- 생활비 개인카드 선결제 정산 입력/수정/삭제
- 예금/적금 가입일, 만기일, 이율, 현재 금액 추가/수정/삭제
- 전세금, 주택 자금, 대출금, 월 대출이자 관리
- 대출금 상환 기록 추가/수정/삭제 및 대출 잔액 자동 계산
- 전체 자산 합산 및 흐름 그래프
- 모바일/PC 반응형 UI
- 모든 수정/삭제 작업은 확인 메시지를 거쳐 반영
- 전체 초기화 시 현재 데이터를 최근 백업으로 저장
- 최근 백업 복원으로 초기화 전 상태 복구 가능

기본 데이터는 빈 상태입니다. 실제 가계부 현황을 직접 입력해 사용합니다.

## 모바일/PC 동기화

동기화에는 클라우드 DB가 필요합니다. 이 앱은 Firebase Firestore를 사용할 수 있게 구성되어 있습니다.

1. Firebase 프로젝트를 생성합니다.
2. Firestore Database를 생성합니다.
3. 웹앱 설정값을 복사합니다.
4. `firebase-config.js`의 `firebaseConfig`를 실제 값으로 교체합니다.
5. `allowedEmails`에 부부가 사용할 Google 계정을 입력합니다.
6. `firestore.rules`의 이메일 placeholder를 같은 이메일로 교체합니다.
7. Firebase Hosting으로 배포합니다.
8. 같은 URL을 모바일과 PC에서 열면 동일한 household 데이터를 공유합니다.

설정 전에는 localStorage 기반 로컬 모드로 동작하므로 기기 간 데이터가 공유되지 않습니다.

## 접근 제한

Firebase 설정 후에는 Google 로그인을 통과한 허용 이메일만 Firestore 데이터를 읽고 쓸 수 있습니다.

주의: Firebase Hosting은 정적 파일을 배포하므로 로그인 페이지 자체의 HTML/CSS/JS 파일은 인터넷에서 접근 가능합니다. 실제 가계부 데이터는 Firebase Authentication과 Firestore Rules로 보호됩니다. 앱 화면 파일 자체까지 외부에서 열 수 없게 하려면 Cloudflare Access, Google Cloud IAP, 사설 서버 인증 같은 별도 접근 제어 계층이 필요합니다.
