# 온반(myFood01) 개발자 온보딩

반찬 정기주문 웹서비스. **빌드 시스템 없는 정적 HTML 4장** + **Express API 1개** + **MySQL(Railway)** 구조.

---

## 1. 로컬 개발 환경 셋업

### 백엔드
```bash
cd server
npm install
cp .env.example .env   # 아래 값 채우기
npm start               # server/server.js 실행, PORT(기본 3000)
```
`.env`에 필요한 값 (`server/.env.example` 참고):
```
MYSQL_HOST=...
MYSQL_PORT=...
MYSQL_USER=...
MYSQL_PASSWORD=...
MYSQL_DATABASE=...
PORT=3000
```
DB 접속 정보는 Railway 프로젝트 대시보드에서 확인. **값을 추측해서 채우지 말 것** — 실제 Railway 값을 반드시 확인 후 사용.

기동 시 `initDB()`가 필요한 테이블을 자동 생성/보정하므로, 빈 MySQL 인스턴스에 연결해도 별도 마이그레이션 없이 바로 뜬다.

### 프론트엔드
빌드 없음, 정적 파일 그대로 서빙하면 끝.
```bash
npx serve -l 5174 .
```
(`.claude/launch.json`에 이미 이 설정이 등록돼 있어 Claude Code의 preview 도구로도 바로 띄울 수 있음)

각 HTML 파일 상단의 `API_URL` 상수가 백엔드 주소를 가리킨다. 기본값은 프로덕션 Railway 주소이므로, 로컬 백엔드로 테스트하려면 이 상수를 `http://localhost:3000`으로 바꿔야 한다 (커밋하지 말 것).

---

## 2. 프로젝트 구조

| 파일 | 역할 |
|---|---|
| `index.html` | 랜딩 페이지. 진입 시 관리자 비밀번호(`prompt()`) 게이트 |
| `onban01.html` | 고객용: 메뉴 조회·장바구니·주문·예약주문·주문내역 |
| `온반_메뉴_이미지갤러리.html` | 이미지 위주 메뉴 갤러리 (오늘의메뉴/예약주문 모드) |
| `menu-manager.html` | 관리자용: 일일 메뉴 관리·주문 관리·설정·계좌·카테고리 |
| `onban.html` | 비밀번호 오답 시 리다이렉트되는 폴백 페이지 |
| `server/server.js` | Express API 전체 (라우트, DB 쿼리, SMS/알림톡 발송 전부 이 한 파일) |
| `server/schema.sql` | DB 스키마 **참고용 스냅샷** — 실제 스키마는 아래 "주의사항" 참고 |

4개 HTML은 서로 완전히 독립된 정적 파일이다. 공유 JS 모듈이 없어서, 같은 로직(예: 전화번호 하이픈 포맷 `fmtPhone`/`formatPhone`)이 파일마다 따로 구현돼 있다. 한 파일을 고칠 때 다른 파일도 같은 문제를 가지고 있는지 확인하는 습관이 필요하다.

원격저장소가 아키텍처 개요는 Obsidian 노트(`개발01/온반/myFood01 flowchart TB.md`)에 Mermaid 다이어그램으로 정리돼 있다.

---

## 3. 배포

| 대상 | 방식 |
|---|---|
| 프론트 (정적 HTML) | GitHub Pages — `main` 브랜치 push 시 자동 반영. `https://giths-ops.github.io/myFood01/` |
| 백엔드 (API) | Railway — 저장소 루트 `Procfile`(`web: node server/server.js`) 기준 `main` push 시 자동 배포. `https://myfood01-production.up.railway.app` |

이 프로젝트는 **커밋 + push를 확인 없이 바로 진행하는 게 기본 워크플로우**다. 즉 `main`에 올라간 변경은 곧바로 두 서비스에 반영된다고 보면 된다. 실험적인 변경은 로컬에서 충분히 검증 후 올릴 것.

---

## 4. DB 테이블 (실제 운영 기준)

`server.js`의 `initDB()`가 생성하는 테이블이 진짜다:

- **menus** — 마스터 메뉴 (이름 UNIQUE, 카테고리/가격/이미지/설명 보관)
- **daily_menus** — 날짜별로 노출되는 메뉴 목록 (menus를 참조하되 스냅샷 형태로 저장)
- **orders** — 주문
- **customers_master** — 고객 저장 주소록 (전화번호로 매칭, device_id로 자동 인식)
- **settings** — 키-값 설정 저장소
- **access_log** — 접근 로그

---

## 5. 알아둘 것 (이 프로젝트 특이사항 — 처음 손댈 때 자주 걸리는 지점)

- **`server/schema.sql`을 맹신하지 말 것.** 실제 스키마는 `server.js`의 `initDB()`가 기동 시 만드는 게 진짜 소스다. schema.sql은 예: `customers_master` 대신 `customers`로 남아있는 등 이미 뒤처져 있다. 컬럼을 추가하면 `initDB()`와 `schema.sql` 둘 다 맞출 것.
- **`localStorage` 사용 금지.** 신규/기존 코드 모두. 예외는 `onban_device_id`(기기 식별 UUID)와 `onban_admin_auth`(관리자 로그인 유지) 두 키뿐.
- **전화번호는 항상 숫자만 저장, 화면에서만 하이픈 포맷.** 저장/조회는 `.replace(/[^0-9]/g,'')`로 정규화, 표시할 때 `fmtPhone()`/`formatPhone()`으로 하이픈 삽입. 서버(`/api/customers-master` 등)도 저장 시 한 번 더 정규화하므로 이중 방어돼 있음.
- **`menu_desc`(메뉴 설명)는 마스터(`menus`) 전용.** `daily_menus` 저장 로직이 이걸 덮어쓰면 안 됨 — 관련 보호 로직이 `POST /api/menu/daily`에 있음.
- **`POST /api/menu/all`은 전달한 배열에 없는 이름의 메뉴를 통째로 DELETE한다** (단, `daily_menus`에 걸려 있는 메뉴는 예외). 마스터 메뉴 목록을 부분적으로만 보내면 나머지가 삭제되니, 항상 GET으로 받은 전체 목록을 수정해서 그대로 되돌려 보낼 것.
- **`POST /api/menu/daily`는 빈 배열을 기본적으로 거부한다.** 특정 날짜의 메뉴를 전부 비우고 싶으면 배열은 비워도 되지만 `date` 필드를 함께 보내야 한다 (`{data:[], date:'YYYY-MM-DD'}`).
- **응답/커밋 메시지는 한국어로.** 영어·일본어 혼용 금지.
- 외부 서비스(Pexels API 등) 연동 스크립트가 저장소 루트에 흩어져 있는데, 이들은 **웹 서비스 런타임과 무관한 1회성 도구**이고 `.gitignore`로 제외돼 있다. API 키를 다시 하드코딩하지 말고 `.env`로 뺄 것.

---

## 6. 주요 API 엔드포인트

| 메서드 | 경로 | 용도 |
|---|---|---|
| GET | `/api/menu/:date` | 특정 날짜의 노출 메뉴 조회 |
| GET | `/api/menu/all` | 마스터 메뉴 전체 조회 |
| POST | `/api/menu/all` | 마스터 메뉴 전체 저장 (미포함 항목 삭제 주의) |
| POST | `/api/menu/daily` | 특정 날짜 메뉴 저장/교체 |
| PUT | `/api/menu/:date/stock` | 특정 날짜 메뉴 재고 갱신 |
| POST | `/api/menu/master/merge` | 중복 마스터 메뉴 병합 |
| POST | `/api/menu/master/delete` | 마스터 메뉴 삭제 |
| GET/POST | `/api/orders` | 주문 조회/생성 |
| PUT | `/api/orders/:id/status` | 주문 상태 변경 (SMS/알림톡 발송 트리거) |
| GET/POST/PUT/DELETE | `/api/customers-master` | 고객 저장 주소록 CRUD |
| GET/POST | `/api/settings` | 계좌정보/카테고리/발송설정 등 |
| GET | `/api/dates`, `/api/events` | 히스토리 날짜 목록, 예약 이벤트 |
| (SSE) | `/api/orders/stream` 계열 | 관리자 화면 실시간 주문 알림 |

---

## 7. 처음 시작할 때

1. `server/.env` 채우고 `npm start` → `http://localhost:3000/health` 200 확인
2. `npx serve -l 5174 .` → `onban01.html`에서 메뉴가 정상적으로 뜨는지 확인 (API_URL을 로컬로 바꾼 경우)
3. `menu-manager.html` 열어서 관리자 비밀번호 게이트 통과 → 일일 메뉴/주문/설정 화면 둘러보기
4. 코드 수정 후엔 `git add` → `git commit` → `git push origin main`까지 바로 진행 (별도 승인 절차 없음)
