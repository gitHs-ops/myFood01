---
title: onban vault 색인
page-type: index
updated: 2026-08-26
---

# onban vault 색인

[[온반(溫飯)]] — 반찬 주문 서비스(myFood01 프로젝트) 관련 매뉴얼/설계 지식을 모으는 vault.

## Sources

| 페이지 | 요약 | 도메인 | 날짜 |
|---|---|---|---|
| [[onban-admin-manual]] | 관리자 페이지(menu-manager.html) 사용 매뉴얼 — 최신, 5개 탭 전체 | onban | 2026-08-10 |
| [[onban-customer-manual]] | 고객 페이지(onban.html) 사용 매뉴얼 — 주문·예약·AI추천 전체 흐름 | onban | 2026-08-10 |
| [[onban-operator-manual-v1]] | 관리자 페이지 초기 매뉴얼(ver 1.0) — 부분적으로 낡음, 최신은 admin-manual 참고 | onban | 2026-04 |

## Entities

| 페이지 | 요약 | 도메인 |
|---|---|---|
| [[onban-service]] | 서비스 전체 개요 ("온반"/"오늘의 반찬") | onban |
| [[menu-manager-page]] | 관리자 전용 페이지 (menu-manager.html) | onban |
| [[onban-customer-page]] | 고객 주문 페이지 (onban.html) | onban |
| [[onban-image-gallery]] | 메뉴 이미지 갤러리 — 고객/관리자 이중 모드 | onban |

## Concepts

| 페이지 | 요약 | 도메인 |
|---|---|---|
| [[kakao-dispatch]] | 카카오 발송 문구 ↔ 메뉴 양방향 변환 규칙 | onban |
| [[reservation-order]] | 예약주문 — 상태 체계, 날짜 규칙, 배송비 | onban |
| [[menu-warehouse]] | 메뉴 창고 — 일일 이력 vs 마스터 카탈로그 | onban |
| [[realtime-autosave]] | 일일 메뉴 저장 방식 변천사 (실시간→명시적 버튼 회귀, 2026-08-20) | onban |
| [[ai-menu-recommendation]] | AI추천메뉴 — 추천 범위·조건·개인화 | onban |

## 알아둘 점
- [[onban-operator-manual-v1]]과 [[onban-admin-manual]]은 같은 페이지(menu-manager.html)의 신·구 매뉴얼 — 기본 흐름은 겹치지만 admin-manual이 최신
- [[realtime-autosave]] 페이지는 **매뉴얼 문서보다 코드가 먼저 바뀌었던 사례**를 기록함 — 매뉴얼(2026-08-10)이 설명하던 "실시간 자동 저장"은 2026-08-20에 폐지되었고, 2026-08-26에 이 사실을 발견해 원본 매뉴얼(`관리자페이지_사용매뉴얼.html`) 3.4절을 직접 갱신함
