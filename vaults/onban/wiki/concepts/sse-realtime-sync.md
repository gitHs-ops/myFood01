---
title: SSE 실시간 동기화
page-type: concept
domain: onban
tags: [SSE, 실시간동기화, 온반, 폴링]
created: 2026-08-26
updated: 2026-08-26
related: [[onban-backend-api]], [[onban-customer-page]], [[menu-manager-page]], [[onban-customer-design-spec]], [[onban-admin-design-spec]]
---

# SSE 실시간 동기화

## Overview
[[onban-backend-api]]가 변경 API 처리 후 `broadcast(type, payload)`로 모든 연결된 클라이언트(고객+관리자)에 실시간 이벤트를 push하는 구조. Server-Sent Events(`GET /api/events`, `text/event-stream`) 단방향 스트림 — 클라이언트는 `EventSource`로 구독만 하고, 실제 변경은 별도 REST 호출로 수행한다.

## 공통 인프라
- **25초 heartbeat**(`:\n\n`)로 Railway 프록시 타임아웃 방어, `X-Accel-Buffering:no` 설정
- 클라이언트 `onerror` 시 연결을 닫고 **5초 뒤 자동 재연결**
- 입력 중(textarea/input focus)이면 재렌더를 blur 시점까지 지연 — 실시간 갱신이 타이핑을 방해하지 않도록

## 이벤트 타입
| 타입 | 발행 시점 | 고객 반응 | 관리자 반응 |
|---|---|---|---|
| `order_new` | 주문 생성 | — | `renderOrders()` 즉시 + 뱃지 갱신 |
| `order_status` | 상태 변경 | 주문내역 디바운스 재렌더(500ms) | `_ordersCache` 항목 갱신 |
| `order_request/memo/reply/ack/delete` | 각 항목 변경 | 동일 디바운스 재렌더 | — |
| `menu_updated` | 메뉴 저장 | 메뉴 목록 갱신 | 다른 기기의 workDate 메뉴 재조회 |

## 이중화: SSE + 폴링
관리자 페이지는 SSE만 믿지 않고 **주문관리 탭에서 15초 폴링**(`renderOrders()`)을 병행한다 — SSE 연결이 끊겨도 최대 15초 지연으로 신규 주문을 놓치지 않기 위함. 고객 페이지의 메뉴 목록도 별도로 **10초 자동 재조회**(`_startMenuAutoRefresh`, 사용자 활동 시 카운트 리셋)를 SSE와 병행한다.

## 왜 이중화했는가
SSE 연결은 네트워크 환경(특히 모바일)에서 끊기기 쉽고, Railway 같은 프록시 호스팅은 장시간 유지 연결에 타임아웃을 걸 수 있다. 주문 접수 지연은 실제 매출 손실로 직결되므로, 단일 메커니즘에 의존하지 않고 heartbeat + 자동재연결 + 폴링 3중 방어를 둔 것으로 보인다.

## Related
[[onban-customer-design-spec]] 9장, [[onban-admin-design-spec]] 11장
