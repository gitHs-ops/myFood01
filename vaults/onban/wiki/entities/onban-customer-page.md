---
title: 고객 주문 페이지 (onban.html)
page-type: entity
entity-type: application-page
aliases: ["고객 페이지"]
domain: onban
tags: [온반, 고객페이지, onban.html]
created: 2026-08-26
updated: 2026-08-26
related: [[onban-service]], [[onban-customer-manual]], [[reservation-order]], [[ai-menu-recommendation]], [[onban-image-gallery]]
---

# 고객 주문 페이지 (onban.html)

## Overview
[[onban-service]]의 고객용 단일 페이지 앱(SPA). 로그인 없이 기기 식별 방식으로 개인화(자동 채우기, "나의 기록"). 실물 파일은 프로젝트 루트의 `onban.html`.

## Key Facts
- 화면 전환은 새로고침 없이 상단 버튼으로 처리 (메뉴 목록 / AI 추천메뉴 / 설명서 / 장바구니 / 주문내역 / 예약주문 / 나의 기록)
- 장바구니는 임시 저장 — 새로고침 시 초기화됨
- 배달 가능 기준: 합계 2만원 이상 (미만이면 매장 픽업만 가능)
- 결제는 계좌 이체 안내 후 관리자가 수동 확인하는 방식 (자동 결제 연동 없음)

## Related
- 사용법 상세: [[onban-customer-manual]]
- 예약 흐름: [[reservation-order]]
- 사진 갤러리·AI 추천: [[onban-image-gallery]], [[ai-menu-recommendation]]
