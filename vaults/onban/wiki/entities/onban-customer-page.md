---
title: 고객 주문 페이지 (onban.html)
page-type: entity
entity-type: application-page
aliases: ["고객 페이지"]
domain: onban
tags: [온반, 고객페이지, onban.html]
created: 2026-08-26
updated: 2026-08-26
related: [[onban-service]], [[onban-customer-manual]], [[reservation-order]], [[ai-menu-recommendation]], [[onban-image-gallery]], [[onban-backend-api]], [[device-id-identification]], [[sse-realtime-sync]], [[onban-customer-design-spec]]
---

# 고객 주문 페이지 (onban.html)

## Overview
[[onban-service]]의 고객용 단일 페이지 앱(SPA). 로그인 없이 기기 식별 방식으로 개인화(자동 채우기, "나의 기록"). 실물 파일은 프로젝트 루트의 `onban.html`.

## Key Facts
- 화면 전환은 새로고침 없이 상단 버튼으로 처리 (메뉴 목록 / AI 추천메뉴 / 설명서 / 장바구니 / 주문내역 / 예약주문 / 나의 기록)
- 장바구니는 임시 저장 — 새로고침 시 초기화됨
- 배달 가능 기준: 합계 2만원 이상 (미만이면 매장 픽업만 가능)
- 결제는 계좌 이체 안내 후 관리자가 수동 확인하는 방식 (자동 결제 연동 없음)

## 기술 구조 (상세설계서 기준, 2026-08-26 추가)
파일명은 `onban01.html`. 로그인 없이 [[device-id-identification|device_id]] 하나로 개인화. 주문 흐름은 클라이언트 `verifyStock()` 1차 검증 + 서버 트랜잭션(`SELECT...FOR UPDATE`) 최종 검증의 이중 방어. 주문내역 편집은 "저장-확정" 모델(수량 변경은 화면에만 반영, 저장 버튼을 눌러야 서버 반영+문자 발송) — 2026-08-08 재구현, 예전엔 버튼 누를 때마다 자동저장·자동발송돼 문자가 남발됐음.

## Related
- 사용법 상세: [[onban-customer-manual]]
- 예약 흐름: [[reservation-order]]
- 사진 갤러리·AI 추천: [[onban-image-gallery]], [[ai-menu-recommendation]]
- 기술 상세: [[onban-customer-design-spec]], [[onban-backend-api]]
