---
title: AI추천메뉴
page-type: concept
domain: onban
tags: [AI추천, 이미지갤러리, 온반, 개인화]
created: 2026-08-26
updated: 2026-08-26
related: [[onban-image-gallery]], [[onban-customer-page]], [[reservation-order]], [[onban-customer-manual]]
---

# AI추천메뉴

## Overview
[[onban-image-gallery]]에서 제공되는 기능. 고객이 조건을 입력하면 AI가 전체 메뉴 중 3~6개를 골라주고, 마음에 드는 것만 골라 바로 [[reservation-order|예약주문]]으로 넘길 수 있다.

## 추천 범위 (3가지 중 선택)
1. 오늘의 메뉴에서 추천받기
2. 전체 메뉴중에서 추천 받기
3. 개인취향으로 추천받기 — 이 기기가 그동안 살펴본 메뉴 + 과거 AI추천에서 실제로 선택했던 메뉴 이력을 참고. 이용 이력이 없으면 인기 메뉴 위주로 대체

## 조건 항목 (모두 선택 사항)
식사 목적 · 형태 · 음식 종류 · 국물 유무 · 맛/매운정도 · 온도감 · 식단/칼로리 · 밀키트 여부 · 곁들일 음료 · 예산 범위 · 알레르기(비선호 재료). 모두 비워두면 "특별한 조건 없이 골고루" 추천.

## 결과 처리
- 조건에 맞는 메뉴가 없으면 어떤 조건이 서로 충돌했는지 화면 중앙에 설명 → 조건 조정 후 재시도 가능
- "메뉴 적용" 시 추천 메뉴만 갤러리에 표시되고 각 카드에 체크박스(기본 전체 선택) 등장 → 원치 않는 것은 선택 해제
- "예약 주문 신청하기"로 체크된 메뉴 전부를 한 번에 예약주문 화면에 전달 (구버전에서는 메뉴 1개만 넘길 수 있었으나 현재는 다중 전달 지원)

## 개인화의 데이터 기반
로그인 없이 기기 식별 방식 — "나의 기록" 화면(고객 페이지)에서 AI추천 선택 이력(최근 10건, 추천 이유 포함)과 자주 살펴본 메뉴 TOP 10을 직접 확인 가능. 이 트래킹 데이터가 "개인취향으로 추천받기"의 입력이 된다.

## 기술 구현 (상세설계서 기준, 2026-08-26 추가)
- `POST /api/recommend` — Anthropic Messages API(`model:'claude-sonnet-5'`) 호출. `ANTHROPIC_API_KEY` 미설정 시 503. 메뉴 풀이 스코프별로 다름: `today`=오늘 daily_menus(없으면 404), `all`/`persona`=menus 전체(count DESC)
- **개인취향(persona) 로직**: 메뉴 풀 자체는 `all`과 동일 전체 마스터 쿼리를 쓰되, 프롬프트에 `menu_click_log`(device_id GROUP BY, 조회 상위 5) + `recommend_selection_log`(최근 5건 picks, 중복제거) 컨텍스트를 추가. 두 데이터가 모두 없는 신규 고객이면 "인기 메뉴 위주로 추천해주세요" 폴백 지시만 추가되어 일반 추천과 사실상 동일한 결과가 나온다
- 갤러리 열람 추적: `POST /api/track/menu-click`(무인증, fire-and-forget) — 실패해도 화면에 영향 없음
- 추천 적용 추적: `POST /api/track/recommend-apply` → `recommend_selection_log` INSERT(conditions·picks는 JSON 직렬화)
- 조회 API: `GET /api/tracker/mine?deviceId=` — recommend_selection_log 최근 10건 + menu_click_log COUNT 상위 10건을 한 번에 반환. "나의 기록" 화면 전용으로 신설된 유일한 백엔드 엔드포인트(주문·예약은 기존 `/api/orders` 재사용)
- 위 4개 API는 전부 무인증 공개 API — device_id는 클라이언트 자체 생성값이라 서버가 소유권을 검증하지 않음(추천/트래커는 개인정보가 아니라 현재는 낮은 위험으로 판단) → [[device-id-identification]]

## Related
[[onban-customer-manual]] 12장, 13장
기술 상세: [[onban-customer-design-spec]] 4.11~4.13·7.4·8.9절, [[onban-backend-api]]
