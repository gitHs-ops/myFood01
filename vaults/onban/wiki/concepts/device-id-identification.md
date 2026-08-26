---
title: device_id 기반 무로그인 식별
page-type: concept
domain: onban
tags: [device_id, 무로그인, 온반, 개인화]
created: 2026-08-26
updated: 2026-08-26
related: [[onban-customer-page]], [[onban-backend-api]], [[ai-menu-recommendation]], [[onban-customer-design-spec]]
---

# device_id 기반 무로그인 식별

## Overview
[[onban-service]]는 회원가입·로그인이 전혀 없다. 대신 브라우저 `localStorage`에 UUID v4를 1회 생성해 저장(`onban_device_id`)하고, 이 값 하나로 주문자 정보 자동채움·주문내역 조회·AI추천 개인화·"나의 기록"까지 전부 처리한다.

## 이 식별자가 쓰이는 곳
- **주문자 정보 자동 채움**: 재방문 시 `GET /api/customers-master?device_id=`로 이름·전화·주소1 자동 조회
- **주문내역 조회**: `GET /api/orders?deviceId=`
- **AI추천 개인취향(persona) 스코프**: `menu_click_log`·`recommend_selection_log`를 device_id로 집계해 프롬프트 컨텍스트로 사용 → [[ai-menu-recommendation]]
- **나의 기록 화면**: 주문·예약 요약, AI추천 선택 이력, 자주 살펴본 메뉴 TOP10 — 전부 device_id 하나로 "본인 것만" 필터링
- **이미지 갤러리 관리자 모드 판별**: `localStorage.onban_admin_auth` 값을 그대로 읽어 같은 기기인지 확인(→ [[onban-image-gallery]])

## 알려진 기술부채: 생성 함수가 두 개
`getDeviceId()`(prefix `dev-` 형식)와 `_getDeviceId()`(표준 UUID v4 형식)가 **같은 localStorage 키**(`onban_device_id`)를 쓰지만 생성 형식이 다르다. 어느 함수가 먼저 호출되었느냐에 따라 실제 저장된 값의 형식이 갈린다. 설계서에 "유지보수 시 통일 권장"으로 명시된 미해결 항목.

## 이 설계의 트레이드오프
- **장점**: 회원가입 이탈 없이 바로 주문 가능, 매장 운영자 입장에서 별도 인증 인프라 불필요
- **한계**: device_id는 클라이언트가 자체 생성한 값이라 **서버가 소유권을 검증하지 않는다** — 기기를 바꾸면 이력이 끊기고, 브라우저 데이터를 지우면 완전히 새 사용자로 인식된다. 주문/개인정보 API가 사실상 무인증이라는 더 큰 보안 이슈와도 맞닿아 있음(12.2절 위험 목록과 동일 계열)

## Related
[[onban-customer-design-spec]] 4.6·4.13·5.2절
