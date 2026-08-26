---
title: server.js (Backend API)
page-type: entity
entity-type: application-component
aliases: ["백엔드", "server.js", "API 서버"]
domain: onban
tags: [온반, 백엔드, API, MySQL, Express, SSE]
created: 2026-08-26
updated: 2026-08-26
related: [[onban-service]], [[menu-manager-page]], [[onban-customer-page]], [[onban-image-gallery]], [[sse-realtime-sync]], [[notification-dispatch]], [[reservation-order]], [[onban-customer-design-spec]], [[onban-admin-design-spec]]
---

# server.js (Backend API)

## Overview
[[onban-service]]의 유일한 백엔드. Node.js + Express 4 + mysql2/promise, Railway에 호스팅(`https://myfood01-production.up.railway.app`). 고객 페이지·관리자 페이지·이미지 갤러리 페이지가 전부 이 하나의 API를 공유한다. 정적 파일도 같은 서버가 `express.static`으로 직접 서빙.

## 데이터 모델 (9개 테이블)
| 테이블 | 역할 |
|---|---|
| `menus` | 메뉴 마스터(정본). `id` PK, `UNIQUE(name,cat)`, `menu_desc`(예약어 `desc` 회피용 rename), `count`(정렬 기준) |
| `daily_menus` | 일자별 판매 스냅샷. `menu_id` FK로 `menus` 조인, `stock`만 이 테이블에서 관리 |
| `orders` | 주문. `id`는 `'ORD'+ts`(일반)/`'RSV'+ts`(예약). `reserve_date`(NULL 가능, 예약주문 전용 — [[reservation-order]]). `is_reorder`는 레거시 컬럼, 항상 0 |
| `customers_master` | 고객 주소록. `phone` UNIQUE, `device_id` 연결 — [[device-id-identification]] |
| `settings` | k-v 설정(계좌·발송토글·예약이벤트 등 JSON 직렬화) |
| `access_log` | 접속 로그 |
| `categories` | 카테고리(id·name·color) — 2026-08-08부로 settings k-v에서 전용 테이블로 분리 |
| `menu_click_log` | 갤러리 상세팝업 열람 이력 (2026-08 신설, device_id 기준 append-only) |
| `recommend_selection_log` | AI추천 "메뉴 적용" 클릭 이력 (2026-08 신설, conditions·picks·reason 저장) |

## 핵심 설계 원칙
- **동시성 안전 재고 차감**: `POST /api/orders`가 트랜잭션 내에서 각 항목을 `SELECT stock...FOR UPDATE`로 잠근 뒤 확인·차감. 한 건이라도 부족하면 전체 롤백 + `soldOut[]` 반환. 클라이언트의 `verifyStock()` 사전검사는 1차 방어일 뿐, 최종 정합성은 이 트랜잭션이 보장
- **예약주문은 재고 로직을 전부 우회**: `reserve_date` 존재 여부만으로 판별, 신청·접수·배송완료 전 과정에서 재고 차감/복원/검증 스킵
- **모든 변경 API가 SSE 브로드캐스트**: 처리 후 `broadcast(type, payload)`로 연결된 모든 클라이언트(고객+관리자)에 실시간 전파 → [[sse-realtime-sync]]
- **알림은 서버 전담**: GAS(Google Apps Script) 호출이 서버에서만 발생, 클라이언트는 API 응답만 수신 → [[notification-dispatch]]
- **공통 응답 규약**: 성공 `{success:true,...data}` / 실패 `{success:false,error}` / 재고부족 `{success:false,soldOut:[{name,available}]}` / 마스터삭제차단 `{success:false,blocked:true,dates:[...]}`

## 인증
API 인증 없음(무인증) — 단, `POST /api/menu/master/update`(이미지 갤러리 관리자 인라인 편집)와 관리자 전용 `GET /api/settings` 필드는 `x-admin-token` 헤더 필요. **알려진 위험**: 주문 변경·삭제 등 대부분 API가 여전히 무인증(양쪽 상세설계서 12/13장에 공통 미해결 위험으로 명시).

## 죽은 엔드포인트 — 삭제됨 (2026-08-26)
`PUT /api/menu/:date/stock`(재고 절대값 설정)과 `POST /api/menu/:date/stock-adjust`(재고 증감, `GREATEST(0,stock+delta)`)는 두 상세설계서 모두 "관리자용" API로 나열하지만, `server/server.js`에 `requireAdmin`으로 보호된 채 **정의만 되어 있고 실제로는 어느 프론트엔드(menu-manager.html·onban01.html·온반_메뉴_이미지갤러리.html)에서도 호출되지 않는다**는 것을 전체 저장소 grep으로 확인 후, 사용자 요청으로 `server.js`에서 실제 삭제함(`node --check` 통과 확인). 현재 관리자 재고 변경은 [[realtime-autosave]]에 정리된 대로 `changeStock()`이 로컬 상태만 바꾸고 `POST /api/menu/daily` 일괄저장으로 반영되는 경로 하나뿐 — 이 두 엔드포인트는 설계서 작성 시점(2026-06-30) 이후 프론트엔드가 다른 방식으로 리팩터링되며 남겨졌던 것으로 보인다.

**⚠ 상세설계서(raw/, 원본 HTML)는 갱신하지 않음** — [[onban-customer-design-spec]] 7.1절에는 이 두 API가 여전히 문서화되어 있다. 코드가 설계서보다 최신인 상태.

## Related
- API 경로 전체 목록: [[onban-customer-design-spec]] 7장, [[onban-admin-design-spec]] 12장
- 마이그레이션 이력: 과거 1회성 스키마 보정 스크립트(menu_id 정규화, icon 컬럼 도입 등)는 운영 DB에 전부 반영 완료되어 코드에서 제거됨
