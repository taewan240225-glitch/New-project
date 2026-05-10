# 유니와니 가계부 작업 규칙

이 저장소는 Firebase Hosting + Firestore로 배포되는 부부 공동 가계부 앱입니다.

## 데이터 보호 원칙

- 기능 추가, UI 수정, 리팩터링 중 Firestore에 저장된 실제 가계부 데이터는 임의로 삭제하거나 수정하지 않는다.
- `households/default-household` 문서나 하위 데이터 삭제는 사용자가 명시적으로 요청한 경우에만 수행한다.
- 초기화, 마이그레이션, 데이터 구조 변경이 필요한 경우 먼저 백업 또는 복원 경로를 마련한다.
- 테스트가 필요하면 실제 Firestore 데이터를 조작하지 말고 로컬 상태, 임시 데이터, 또는 별도 테스트 문서를 사용한다.

## 배포 원칙

- 실제 앱 배포 파일은 `public/` 폴더의 `index.html`, `styles.css`, `app.js`, `firebase-config.js` 기준이다.
- 루트 파일을 수정한 경우 배포 전에 같은 파일을 `public/`에 동기화한다.
- Firebase Hosting 배포 후 GitHub에도 커밋하고 푸시한다.
- Firestore Rules 변경 시 `firestore.rules`를 배포하고, 허용 이메일 목록이 `firebase-config.js`와 일치하는지 확인한다.

## GitHub 관리

- 모든 기능 변경은 Git 커밋으로 남기고 `main` 브랜치에 푸시한다.
- 모바일 ChatGPT나 다른 환경에서 이어서 수정할 수 있도록 GitHub 저장소를 최신 상태로 유지한다.
- 커밋 전 `node --check app.js`로 문법 오류를 확인한다.

## 현재 서비스

- Firebase project: `uniwani-budget-240225`
- Hosting URL: `https://uniwani-budget-240225.web.app`
- GitHub repo: `https://github.com/taewan240225-glitch/New-project`
