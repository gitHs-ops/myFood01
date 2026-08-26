---
title: 시스템 로그 (관찰가능성)
page-type: concept
domain: onban
tags: [시스템로그, 관찰가능성, 온반, 감사로그]
created: 2026-08-26
updated: 2026-08-26
related: [[onban-backend-api]], [[menu-manager-page]], [[notification-dispatch]], [[ai-menu-recommendation]]
---

# 시스템 로그 (관찰가능성)

## Overview
[[onban-backend-api]]가 `system_log` 테이블에 이벤트를 append-only로 기록하고, 관리자 전용 화면 `시스템_로그.html`(별도 정적 페이지, menu-manager.html과는 다른 파일)에서 조회한다. 두 상세설계서 어디에도 다뤄지지 않은 부분 — 관리자 페이지의 5탭 밖에 있는 진단 전용 화면이라 설계서 작성 시점엔 없었거나 범위 밖이었던 것으로 보인다.

## 서버 쪽 메커니즘
`sysLog(type, summary, detail, ip, deviceId)` 헬퍼(fire-and-forget, `.catch(()=>{})`로 실패해도 본 요청에 영향 없음) → `INSERT INTO system_log`. `detail`은 JSON 직렬화 저장, `summary`는 500자 컷.

| type | 기록 시점 | 비고 |
|---|---|---|
| `ai_recommend` | AI추천 호출마다(성공/실패 무관) | 토큰 비용 발생하므로 호출 자체를 추적 |
| `order_customer` | 신규 주문 접수 | 고객 개인정보(이름·전화) 포함 |
| `daily_menu_save` | 일일 메뉴 저장(`saveToday()`) | → [[realtime-autosave]] |
| `menu_delete` | 마스터 메뉴 삭제 | **2026-08-26 신설** — 이전엔 삭제해도 로그가 전혀 안 남았음(사용자가 직접 발견해 요청) |
| `abnormal_access` | 관리자 인증 실패, 정의되지 않은 API 경로(404) | 보안 이상징후 |
| `abnormal_order` | 한 번에 50개 초과 항목 주문 시도(차단됨) | 남용 방지 |
| `error` | `err()` 헬퍼가 5xx 응답을 보낼 때 자동 기록 | 별도 호출 불필요, 에러 경로에 이미 내장 |

## 왜 마스터 메뉴 삭제엔 로그가 없었는가
`POST /api/menu/master/delete`뿐 아니라 `/master/update`·`/master/merge`도 마찬가지로 `sysLog` 호출이 없다 — 이 세 마스터 변경 API 전체가 애초에 시스템 로그 대상에서 빠져 있었던 것으로 보인다(설계 당시 시스템 로그는 비용·보안·주문 추적 위주로 설계됐고, 일반 관리자 CRUD 작업까지는 포괄하지 않았던 듯). 2026-08-26에 삭제(delete)만 사용자 요청으로 추가함 — **update·merge는 여전히 로그 없음** (필요 시 같은 패턴으로 추가 가능).

## 조회·정리
- `GET /api/system-log?type=&limit=` — type 생략 시 전체, `x-admin-token` 필요
- `POST /api/system-log/delete {ids:[...]}` — 관리자가 "파일로 내보내기" 클릭 시 방금 내보낸 항목만 선택적으로 지울지 확인창으로 물어봄. **자동 만료/정리(TTL)는 없음** — 관리자가 수동으로 내보내기+삭제하지 않으면 테이블이 계속 쌓인다.

## Related
[[onban-backend-api]] — server.js 전체 구조. 시스템 로그는 두 상세설계서 범위 밖의 부속 화면이라 [[onban-admin-design-spec]]에는 없음.
