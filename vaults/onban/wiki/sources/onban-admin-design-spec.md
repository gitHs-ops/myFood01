---
title: 온반 관리자 페이지 상세설계서
page-type: source-note
domain: onban
tags: [설계서, 관리자페이지, 온반, API, DB스키마, 알림발송, 아키텍처]
created: 2026-08-26
updated: 2026-08-26
source-url: "C:/myPrjt01/myFood01/관리자페이지_상세설계서.html"
source-type: file
author: 내부 문서 (v2.0, 작성일 2026-06-30)
date-accessed: 2026-08-26
raw-file: raw/onban-admin-design-spec.html
related: [[onban-backend-api]], [[menu-manager-page]], [[realtime-autosave]], [[reservation-order]], [[menu-warehouse]], [[notification-dispatch]], [[sse-realtime-sync]], [[onban-admin-manual]], [[onban-customer-design-spec]]
---

# 온반 관리자 페이지 상세설계서

## Overview
menu-manager.html(관리자 SPA)의 내부 구조·5탭 설계·상태관리·알림발송 흐름을 다루는 기술 설계서(v2.0). [[onban-admin-manual]]의 기술적 배경 문서. 인증·이미지업로드·알림구조·SSE+폴링 이중화·보안 이슈까지 포괄한다.

## Key Takeaways
- **⚠ 이 문서가 검증한 사실 — [[realtime-autosave]] 정정 근거**: 5.5절 "💾 일일 메뉴 저장(saveToday())"이 명시적 저장 버튼 방식을 설명하고 있어, 앞서 코드 grep으로 발견해 매뉴얼을 정정했던 내용(2026-08-20 실시간저장 폐지)이 이 설계서 서술과도 일치함을 재확인. 단, 이 설계서(v2.0, 6/30 작성)에도 "실시간 저장" 표현은 등장하지 않음 — 애초에 설계서는 그 시점 기준 실시간저장 도입 이전이거나, 이미 명시적 저장 방식을 전제로 쓰여진 것으로 보임(문서 작성일과 실제 코드 변경일의 선후 관계는 불확실)
- **인증은 클라이언트 평문 비밀번호**: `ONBAN_ADMIN_KEY` 값이 `menu-manager.html`·`index.html`·`온반_메뉴_이미지갤러리.html` 세 프론트 파일 + Railway 환경변수 `ADMIN_TOKEN` **네 곳이 항상 같아야** 함. 어긋나면 관리자 API 전체 401
- **알림 발송 전면 미작동 사고(2026-08-08)**: 운영 DB에 `gasUrl` 자체가 없어서 SMS·알림톡이 한 통도 안 나가고 있었는데, 실패가 기록되지 않아 오래 몰랐다. `settings.lastNotify`/`lastNotifyTrigger` 진단 키를 새로 만든 뒤에야 원인(주소 누락 + 솔라피 API IP제한) 발견 → [[notification-dispatch]]
- **배송업체 SMS는 실제 미사용**: 코드는 남아있지만(`deliveryPhone` 있을 때만 발송) 운영에서는 그 칸을 항상 비워둠 — [[onban-admin-manual]]에 이미 기록된 내용과 일치
- **예약주문 판별 로직 변천사**: 과거엔 status값·추가요청 텍스트 매칭도 병행했으나 신호가 여러 개라 혼란 유발 → `reserve_date` 컬럼 단일 기준(`_isReserveOrder()`)으로 정리. 재고 차감/복원/검증을 전 과정에서 우회 → [[reservation-order]]
- **`GET /api/settings`는 토큰 유무로 응답이 달라짐**: 무인증이면 `banks`·`reserveEvent`·`categories`만 반환(고객 화면용). `gasUrl`·`phone`·`deliveryPhone` 등은 토큰 필요 — 2026-08-08 P0 점검에서 이 값들이 인증없이 전부 노출되던 걸 막음

## Detailed Notes

### 5탭 구조
🍱메뉴관리 / 💬카카오발송 / 📦주문관리 / 🗄메뉴창고 / ⚙설정. `switchPage(name)` — HTTP 요청 없이 DOM 표시만 전환(주문관리·창고는 진입 시 자동 재조회).

### 설정 탭 (2026-08-08 정리)
재고·계좌·관리자정보·카테고리는 예전엔 localStorage에도 캐시했으나 전부 제거, 서버가 유일한 원본. 문서상 저장 키 이름(`adminPhone`/`adminEmail`/`defaultStock`)이 실제 코드 키(`phone`/`email`/`stock`)와 달랐던 것도 이번에 바로잡음 → [[localstorage-server-truth]]

### 알림 발송 매핑 (10.2절 표 핵심)
| 시점 | 고객 알림톡 | 관리자 SMS |
|---|---|---|
| 신규 주문 | 비활성(기본) | ✅ 활성 |
| 주문접수(confirmed) | 비활성 | — |
| **배송완료** | **✅ 활성(유일한 기본 고객 알림)** | — |
| 고객이 주문 저장/취소 | — | ✅ 활성 |

고객에게 접수 시점 알림톡을 안 보내는 이유: 카카오 대화방 알림에 고객이 답장하면 시스템 이전 "카톡 주문" 방식으로 되돌아가기 때문(업주 결정) → [[notification-dispatch]]

### SSE + 15초 폴링 이중화
SSE(`order_new`/`order_status`/`menu_updated`)가 주력, 끊겨도 15초 폴링이 보완. 25초 heartbeat로 Railway 타임아웃 방어 → [[sse-realtime-sync]]

### 보안 미해결 항목(13절)
관리자 비밀번호·ImgBB API Key 모두 JS 소스 평문 노출(높음/중간 위험). GAS URL·관리자 전화·계좌 기본값은 DB settings 이전으로 완료.

## Sources
- 원본: `관리자페이지_상세설계서.html` (프로젝트 루트) — 원문 전체는 [[raw/onban-admin-design-spec.html]] (HTML 원본 그대로 보존)
- 참조 문서: [[onban-admin-manual]], [[onban-customer-design-spec]]
