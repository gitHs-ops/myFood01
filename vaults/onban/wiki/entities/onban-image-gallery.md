---
title: 온반 메뉴 이미지 갤러리 (온반_메뉴_이미지갤러리.html)
page-type: entity
entity-type: application-page
aliases: ["이미지 갤러리", "AI추천메뉴 페이지"]
domain: onban
tags: [온반, 이미지갤러리, AI추천]
created: 2026-08-26
updated: 2026-08-26
related: [[onban-service]], [[onban-customer-page]], [[menu-manager-page]], [[ai-menu-recommendation]], [[onban-customer-manual]], [[onban-admin-manual]]
---

# 온반 메뉴 이미지 갤러리 (온반_메뉴_이미지갤러리.html)

## Overview
전체 메뉴를 사진 카드로 훑어보는 화면. 고객 페이지 상단 "🎯 AI 추천메뉴" 버튼 또는 메뉴 목록의 "🖼️ 이미지갤러리" 버튼으로 진입. 마스터 메뉴와 실시간 연동되어 관리자가 메뉴를 추가·수정하면 새로고침 시 바로 반영된다.

## Key Facts — 이중 모드
같은 URL이지만 접속 기기의 로그인 상태에 따라 동작이 다르다:
- **일반 고객(비로그인 기기)**: 카드 클릭 → 상세 보기 팝업(조회만 가능)
- **관리자 모드([[menu-manager-page]]와 같은 비밀번호로 로그인된 기기)**: 카드 클릭 → 메뉴 편집 팝업(메뉴명·카테고리·가격·재고·설명·이미지). 저장 시 마스터 메뉴 한 건만 즉시 갱신되며 오늘의 메뉴 목록 전체에는 영향 없음
- 별도의 관리자 로그인 절차는 없음 — menu-manager.html에 로그인된 브라우저로 갤러리 링크를 열면 자동 인식

## AI 추천 기능 → [[ai-menu-recommendation]]
추천 범위(오늘의 메뉴/전체 메뉴/개인취향) 선택 후 조건 입력 → AI가 3~6개 메뉴 추천 → 적용 시 체크박스로 선택 해제 가능 → 예약주문으로 일괄 전달 가능.

## Related
- [[onban-customer-manual]] 12장, [[onban-admin-manual]] 8장
