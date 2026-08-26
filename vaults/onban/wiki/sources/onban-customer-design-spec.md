---
title: 온반 고객 페이지 상세설계서
page-type: source-note
domain: onban
tags: [설계서, 고객페이지, 온반, API, DB스키마, 아키텍처]
created: 2026-08-26
updated: 2026-08-26
source-url: "C:/myPrjt01/myFood01/고객페이지_상세설계서.html"
source-type: file
author: 내부 문서 (v1.1, 작성일 2026-06-30, 시퀀스·호출그래프 보강)
date-accessed: 2026-08-26
raw-file: raw/onban-customer-design-spec.html
related: [[onban-backend-api]], [[onban-customer-page]], [[onban-image-gallery]], [[reservation-order]], [[ai-menu-recommendation]], [[sse-realtime-sync]], [[device-id-identification]], [[onban-customer-manual]]
---

# 온반 고객 페이지 상세설계서

## Overview
onban01.html(고객 SPA)과 server/server.js(백엔드)의 내부 구조를 다루는 기술 설계서. [[onban-customer-manual]]이 "무엇을 어떻게 쓰는지"를 다룬다면, 이 문서는 "왜 이렇게 동작하는지"와 정확한 API/DB 스펙을 다룬다. 관리자 페이지는 범위 밖(API 공유 부분만 참조) — 그쪽은 [[onban-admin-design-spec]] 참고.

## Key Takeaways
- **재고 검증은 이중 방어**: 클라이언트가 주문 확정 직전 `verifyStock()`로 1차 확인하지만, 최종 정합성은 서버 트랜잭션(`SELECT...FOR UPDATE`)이 보장한다 → [[onban-backend-api]] 8.1절
- **주문내역 편집은 "저장-확정" 모델**: 수량/배송방법 변경은 화면에만 반영되고 저장 버튼을 눌러야 서버 반영 + 문자 발송. 예전엔 버튼 누를 때마다 자동저장·자동발송되어 문자가 남발되는 문제가 있어 2026-08-08 재구현됨(`_histDirty` 플래그)
- **예약주문 판별은 단일 기준**: `reserve_date` 컬럼 존재 여부만으로 판별(과거엔 status값·텍스트매칭도 병행해 혼란 유발 → 단일 기준으로 정리). 신청/접수/배송완료 전 과정에서 재고 차감·복원·검증을 전부 우회 → [[reservation-order]]
- **localStorage는 device_id와 orders 캐시 두 키뿐**: 설정·계좌·관리자연락처·카테고리는 전부 서버가 원본(2026-08-08 정리) → [[localstorage-server-truth]]
- **device_id 생성 함수가 두 개 공존**: `getDeviceId()`(prefix `dev-`)와 `_getDeviceId()`(UUID v4)가 같은 키를 쓰지만 형식이 다름 — 유지보수 시 통일 권장 (미해결 기술부채로 명시됨)
- **이미지 갤러리는 딴 파일**: `온반_메뉴_이미지갤러리.html`은 onban01.html과 별도 정적 페이지지만 같은 API_URL·device_id를 공유하고, 로그인된 기기에서는 관리자 편집 모드로도 동작 → [[onban-image-gallery]]

## Detailed Notes

### 아키텍처
Frontend(onban01.html, Vanilla JS SPA) → REST(fetch) + SSE(EventSource) → Railway(server.js, Express) → MySQL. 알림은 서버가 Google Apps Script를 통해 SMS/카카오 알림톡으로 위임. AI추천은 `POST /api/recommend`에서 Anthropic Messages API(`claude-sonnet-5`) 호출.

### 화면 8개 (page-*)
메뉴목록·장바구니·주문자정보·주문확인·결제안내·주문내역·예약주문·나의기록. `goPage(name)`이 `.active` 토글로 전환. **가드는 주문상세 팝업 닫기에만 걸림** — `goPage()` 자체엔 전환 가드 없음.

### 핵심 상태 변수
`allMenus`, `cart`(메모리 전용, 새로고침 시 소실), `orderItems`, `_histDirty`(Object, orderId→true) 등 → [[onban-customer-page]] 참고.

### DB 핵심 설계
`menus`(마스터, 정본) ↔ `daily_menus`(일자별 스냅샷, `menu_id` FK로 정적속성 조인) 분리 구조. `orders.reserve_date`(NULL 가능, 예약주문 전용). 2026-08 신설: `menu_click_log`·`recommend_selection_log`(둘 다 device_id 기준 append-only) → [[onban-backend-api]]

### 비즈니스 로직 하이라이트
- 배달료: 품목합계 ≥2만원이고 매장픽업 아닐 때만 +1천원. 2만원 미만은 매장픽업 강제
- 예약 이벤트 중복신청 방지: 같은 phone+reserve_date로 취소 안 된 이벤트 주문 존재 시 `POST /api/orders`가 409 반환
- 개인취향(persona) AI추천: 조회이력 상위5 + 과거 선택이력 최근5건을 프롬프트에 추가. 둘 다 없으면 "인기 메뉴 위주" 폴백 → [[ai-menu-recommendation]]

### 식별된 위험(12.2절, 미해결)
API 전체 무인증(주문 변경·삭제도 누구나 호출 가능), CORS 와일드카드 전면허용, 이모지 매핑(`_MENU_KW` ~180개)이 프론트/백엔드에 중복 정의.

## Sources
- 원본: `고객페이지_상세설계서.html` (프로젝트 루트) — 원문 전체는 [[raw/onban-customer-design-spec.html]] (HTML 원본 그대로 보존, API 경로·DB 컬럼명 등 정확한 문자열 참조용)
- 참조 문서: [[onban-customer-manual]], [[onban-admin-design-spec]]
