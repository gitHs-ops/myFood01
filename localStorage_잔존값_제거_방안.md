# localStorage 잔존값 제거 방안

작성일: 2026-08-07 · 배경: 계좌번호 사고(옛 값이 고객 기기에 굳어 남아 혼선)와 동일한 구조가 3곳에 잔존.
원칙: **디바이스 식별(`onban_device_id`) 외에는 localStorage를 원본 저장소로 쓰지 않는다.**

---

## 위험도 요약 및 처리 시점

| 순위 | 키 | 위험 | 수정 규모 | 처리 시점 |
|---|---|---|---|---|
| 1 | `onban_categories` | **서버에 아예 저장 안 됨** — 계좌번호와 동일 구조 + 유실 위험 | 소 (양쪽 합쳐 ~40줄) | **재오픈 전 필수** |
| 2 | `onban_admin_auth` | 비밀번호 바꿔도 기존 기기 로그인 유지 (굳은 값 그 자체) | 극소 (3줄) | **재오픈 전 필수** |
| 3 | `orders` | 기기 변경 시 내역 소실, DB와 어긋남(phantom 보정으로 부분 방어 중) | 대 (30여 곳) | 1단계만 재오픈 전, 전면 전환은 오픈 후 |

---

## 1. `onban_categories` — 카테고리를 서버 settings로 이전

### 현재 구조의 문제 (조사 결과)
- 카테고리 원본이 **관리자 기기의 localStorage에만 존재**: `setCats()` menu-manager.html:827
- `server.js`에 카테고리 관련 코드 **0건** — 서버에 저장 자체가 안 됨
- 고객 페이지 onban01.html:733 은 자기 기기의 `onban_categories`를 읽지만, 고객 기기에 이 키를 **쓰는 코드가 없음** → 고객은 항상 하드코딩 기본색(onban01.html:718)만 봄
- 결과: 관리자가 카테고리 추가/색 변경해도 고객·타 기기에 전파 안 됨, 관리자 폰 바꾸면 설정 전체 소실

### 수정 방안 — 서버 수정 0줄
`/api/settings`는 임의 키를 받는 key-value 저장소(server.js:887-903, `ON DUPLICATE KEY UPDATE`)이므로 `categories` 키를 그냥 실어 보내면 됨.

**menu-manager.html**
1. `setCats(cats)` (827행): localStorage 저장을 `apiPost('/api/settings',{categories:cats},...)`로 교체. 저장 실패 시 알림 표시(조용히 삼키지 말 것).
2. `getCats()` (826행): localStorage 읽기 제거. 페이지 로드 시 이미 있는 `apiFetch('/api/settings',...)` 흐름(3099행 근처)에서 `d.data.categories`를 받아 전역 `_cats` 변수에 보관, `getCats()`는 그걸 반환. 서버에 값이 없으면 `DEFAULT_CATS` 반환 후 최초 1회 서버에 저장(시드).
3. `_buildCatMaps()` (829행)는 그대로 두되 데이터 출처만 위 전역으로 바뀜.
4. 마이그레이션: 로드 시 localStorage에 `onban_categories`가 있고 서버에 없으면 → 서버로 올린 뒤 `localStorage.removeItem('onban_categories')`. 서버에 이미 있으면 그냥 remove.

**onban01.html**
5. 733행 IIFE(localStorage 읽기) 삭제.
6. 이미 호출 중인 `fetch(API_URL+'/api/settings')` (1757행 결제화면 진입, 2373행) 응답에서 `data.categories`를 꺼내 `CAT_COLOR` 갱신. 단, 이 두 호출은 특정 시점에만 일어나므로 **초기 로드 시 1회 settings 조회를 추가**해 메뉴 렌더 전에 색상 반영. 718행 하드코딩 맵은 서버 응답 전 폴백으로 유지.

**갤러리(온반_메뉴_이미지갤러리.html)**: CAT_COLOR 유사 로직 있으면 같은 방식 적용(확인 필요).

---

## 2. `onban_admin_auth` — 비밀번호 연동 무효화

### 현재 구조의 문제
- menu-manager.html:12-16 — `ADMIN_PW` 검증 후 `'1'` 고정 플래그 저장. **비밀번호를 바꿔도 이미 로그인한 기기는 영원히 통과** (계좌번호와 동일한 "굳은 값").
- 부가 문제(별건, 오픈 후 과제): `ADMIN_PW`('onban@1dl34')와 `ADMIN_TOKEN`(2859행 근처)이 정적 HTML에 평문 하드코딩 — GitHub Pages 소스는 공개이므로 사실상 비밀번호가 공개된 상태.

### 수정 방안
**1단계 (재오픈 전, 3줄)** — 플래그 값을 비밀번호에 묶기:
```js
var AUTH_VAL='ok_'+ADMIN_PW;                       // 비번 바뀌면 값도 바뀜
if(localStorage.getItem('onban_admin_auth')===AUTH_VAL)return;
var input=prompt('관리자 비밀번호를 입력하세요');
if(input===ADMIN_PW){localStorage.setItem('onban_admin_auth',AUTH_VAL);}
```
비밀번호 변경 즉시 모든 기존 기기가 재로그인 필요 → 굳은 값 문제 해소. (localStorage에 비번이 들어가지만, 어차피 소스에 평문인 현 구조에서 추가 노출은 아님)

**2단계 (정식 오픈 후)** — 검증을 서버로 이전:
- `POST /api/admin/login {pw}` → 서버가 `ADMIN_TOKEN` 반환(환경변수 비교), 프런트는 받은 토큰을 보관하고 `x-admin-token` 헤더에 사용
- HTML에서 `ADMIN_PW`·`ADMIN_TOKEN` 하드코딩 제거
- 서버 비번 변경(환경변수) 시 전 기기 자동 무효화

---

## 3. `orders` — 주문내역 원본을 서버로 전환

### 현재 구조의 문제
- 고객 주문내역의 원본이 localStorage `orders` (onban01.html 30여 곳에서 읽고 씀)
- 서버는 이미 `GET /api/orders?deviceId=` 본인 조회를 인증 없이 지원(server.js:421-447) — **API가 없어서가 아니라 레거시**
- 위험: 기기 변경/브라우저 데이터 삭제 시 내역 소실, 관리자가 DB에서 수정·삭제한 내용이 고객 폰에 잔존(phantom 제거 로직이 오늘자+예약만 보정, 과거분은 그대로)

### 수정 방안 — 단계 전환
**1단계 (재오픈 전, 소규모)** — 표시 경로만 서버 우선:
- 주문내역 화면 진입 함수에서 localStorage 먼저 그리는 대신 `GET /api/orders?deviceId=` + `?reservedForDevice=1&deviceId=` 결과로 렌더. 실패 시에만 "불러오기 실패" 표시(옛 캐시로 폴백하지 않음 — 폴백이 곧 굳은 값).
- 쓰기 30곳은 당분간 유지(호환), 단 렌더에는 안 쓰이므로 무해화됨.

**2단계 (오픈 후)** — 쓰기 제거:
- 주문 성공 시 localStorage 기록(1663-1666행), 수정/취소/요청사항 갱신류 함수들의 localStorage 갱신 전부 제거
- 첫 진입 시 `localStorage.removeItem('orders')` 마이그레이션 1줄
- 주의: device_id 없이 저장된 옛 주문은 조회 누락 → 필요 시 phone 보조 조회(`?phone=`, 이미 지원) 추가

---

## 작업 순서 요약 (재오픈 전 체크리스트)

1. [ ] 카테고리 서버 이전 (§1 전체) — 사고 대기 상태 해소
2. [ ] 관리자 인증 플래그 비번 연동 (§2 1단계) — 3줄
3. [ ] 주문내역 서버 우선 렌더 (§3 1단계)
4. [ ] 배포 후 검증: 관리자 기기에서 카테고리 색 변경 → 고객 기기(다른 폰) 새로고침으로 반영 확인 / 비번 임시 변경 → 기존 로그인 기기 차단 확인
5. [ ] 오픈 후 과제로 이월: §2 2단계(서버 로그인), §3 2단계(orders 쓰기 제거)
