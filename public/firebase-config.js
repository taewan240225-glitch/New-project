import "./currency-inputs.js";

// Firebase를 사용해 모바일/PC 실시간 동기화를 켜려면 이 파일의 값을 채우세요.
// 설정 전에는 앱이 localStorage 기반 로컬 모드로 동작합니다.
export const firebaseConfig = {
  projectId: "uniwani-budget-240225",
  appId: "1:924982387744:web:f45beb08208e8c7e5d0845",
  storageBucket: "uniwani-budget-240225.firebasestorage.app",
  apiKey: "AIzaSyBgCMu87uM5zoPcPUQ03giNlcH0DUtL05k",
  authDomain: "uniwani-budget-240225.firebaseapp.com",
  messagingSenderId: "924982387744"
};

export const allowedEmails = ["taewan240225@gmail.com", "uuuuuny@gmail.com"];

// 예시:
// export const firebaseConfig = {
//   apiKey: "YOUR_API_KEY",
//   authDomain: "YOUR_PROJECT.firebaseapp.com",
//   projectId: "YOUR_PROJECT_ID",
//   storageBucket: "YOUR_PROJECT.appspot.com",
//   messagingSenderId: "YOUR_SENDER_ID",
//   appId: "YOUR_APP_ID"
// };
// export const allowedEmails = ["user1@gmail.com", "user2@gmail.com"];
