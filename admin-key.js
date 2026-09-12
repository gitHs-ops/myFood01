// 온반 관리자 키 — 단일 원본(single source of truth)
//
// 이 값은 두 가지로 동시에 쓰인다:
//   1) 관리자 화면 진입 비밀번호 (index / menu-manager / 시스템_로그 / 이미지갤러리)
//   2) 서버 관리자 API 인증 토큰 (요청 헤더 x-admin-token)
//
// 따라서 Railway 환경변수 ADMIN_TOKEN 과 반드시 같은 값이어야 한다.
// 값을 바꿀 때 고칠 곳은 "이 파일 + Railway" 두 곳뿐이다.
//
// 주의: 이 파일은 정적 호스팅에서 캐시될 수 있다. 값을 바꾼 직후에는
//       관리자 화면에서 강력 새로고침(Ctrl+Shift+R) 한 번 해줄 것.
var ONBAN_ADMIN_KEY = 'onban@1dl34';
