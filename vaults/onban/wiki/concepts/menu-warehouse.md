---
title: 메뉴 창고
page-type: concept
domain: onban
tags: [메뉴창고, 마스터메뉴, 온반]
created: 2026-08-26
updated: 2026-08-26
related: [[menu-manager-page]], [[onban-admin-manual]], [[onban-operator-manual-v1]], [[realtime-autosave]], [[reservation-order]]
---

# 메뉴 창고

## Overview
[[menu-manager-page]]의 "🗄 메뉴 창고" 탭. 두 가지 서로 다른 데이터를 함께 다룬다 — **일일 메뉴 이력**(날짜별로 그날 실제 등록됐던 메뉴 스냅샷)과 **전체 마스터 메뉴**(메뉴명·가격·설명·이미지를 담은 카탈로그 원본). 이름은 하나지만 개념적으로는 "지난 기록 보관함"과 "메뉴 카탈로그"가 한 화면에 있다고 이해하는 게 정확하다.

## 일일 메뉴 이력 (날짜별 메뉴 묶음)
- 탭 진입 시 기본으로 표시되는 뷰
- 날짜별로 저장된 과거 일일 메뉴 조회 → 🔍 미리보기 또는 선택하여 불러오기
- 여러 날짜를 체크박스로 선택 후 일괄 삭제 가능 (확인창 후 진행, 복구 불가)
- "메뉴 창고에 저장" 버튼(카카오 발송 탭에 위치, [[onban-operator-manual-v1]] 10장)으로 오늘 메뉴를 이 이력에 스냅샷 저장 — 메뉴 추가/수정 때마다의 자동 임시 저장과는 별개의 명시적 보관 동작

## 전체 마스터 메뉴
- 카테고리별 전체 마스터 메뉴 조회/편집
- 여러 개 체크 선택 시: **📤 오늘의 메뉴로 보내기** / **🗑 삭제**(사용 중인 메뉴는 자동 스킵) / **🔀 병합**(정확히 2개 선택 시만 노출)
- 메뉴명 클릭 시 이 마스터 목록에서 검색·자동 채우기됨 ([[onban-admin-manual]] 3.2절 메뉴 검색)

## 예약된 메뉴 (하위 탭)
마스터 메뉴 탭 옆에 위치. 작업일자 이후로 접수 완료된 [[reservation-order|예약주문]]만 모아 보여줌 — 날짜 무관하게 상세 조회 가능하며, 탭 재방문 시 항상 강제 갱신됨.

## DB 구조 (상세설계서 기준, 2026-08-26 추가)
- `menus`(마스터, 정본) — `id` PK, `UNIQUE(name,cat)`, `count`(병합·정렬 기준), `menu_desc`(MySQL 예약어 `desc` 회피 위해 rename)
- `daily_menus`(일자별 스냅샷) — `menu_id` FK로 `menus`를 조인해 이름·사진·설명 등 정적 속성을 가져오고, **`stock`만 이 테이블에서 직접 관리**한다. `menu_id`가 없는 레거시 행은 `name` 조인으로 폴백
- 마스터-일일 동기화(`syncAllMenuToMenus()`): 마스터의 가격·재고·이름이 바뀌면 같은 `menuId`를 가진 일일 메뉴 항목도 함께 갱신. DB 레벨에서는 `POST /api/menu/all`의 rename 전파 로직이 `daily_menus`까지 갱신
- 병합(`doMerge`): `POST /api/menu/master/delete`가 소스 메뉴를 삭제하면서 `daily_menus`·`orders`의 참조를 전부 대상 메뉴 ID로 일괄 업데이트

## 참고 (프로젝트 내부 규칙, 이 vault 밖 메모리)
"설명(desc)은 master 전용" 규칙과 직결: daily_menus에는 desc 컬럼이 없고, 일일 메뉴 저장 동작이 master의 menu_desc를 덮어써서는 안 된다는 프로젝트 내부 규칙이 이 마스터/일일 이력 분리 구조의 근거가 된다.

## Related
[[onban-backend-api]] 데이터 모델, [[onban-admin-design-spec]] 5.11~5.13절

## Related
[[realtime-autosave]] — 일일 메뉴 자체는 실시간 저장되지만 "메뉴 창고 저장"은 여전히 명시적 버튼 동작임에 유의
