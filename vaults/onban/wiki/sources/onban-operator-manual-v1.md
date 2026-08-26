---
title: 오늘의 반찬 — 메뉴 관리 가이드 (운영자 매뉴얼 v1)
page-type: source-note
domain: onban
tags: [매뉴얼, 관리자페이지, 온반, 메뉴관리, 구버전]
created: 2026-08-26
updated: 2026-08-26
source-url: "C:/myPrjt01/myFood01/onban_manual.html"
source-type: file
author: 내부 문서 (작성일 2026-04, ver 1.0)
date-accessed: 2026-08-26
raw-file: raw/onban-operator-manual-v1.md
related: [[onban-service]], [[menu-manager-page]], [[kakao-dispatch]], [[menu-warehouse]], [[onban-admin-manual]]
status: superseded-partially
---

# 오늘의 반찬 — 메뉴 관리 가이드 (운영자 매뉴얼 v1, 2026-04)

## Overview
menu-manager.html의 가장 초기 사용 매뉴얼(ver 1.0, 2026년 4월 작성). 서비스명을 "오늘의 반찬"으로 지칭하며, 날짜 선택·일일 메뉴 등록·사진 등록·재고/금액 수정·삭제·카카오 발송(양방향)·메뉴 창고 저장/조회의 기본 흐름만 다룬다. 주문 관리, 설정 세분화, 예약주문, 이미지 갤러리 관리자 모드 등은 이 문서에 없다 — 이후 [[onban-admin-manual]](2026-08-10)에서 다뤄진다.

## Key Takeaways
- **이 문서는 부분적으로 낡았다**: [[onban-admin-manual]]에 따르면 이후 "일일 메뉴 저장" 개념이 실시간 자동 저장으로 바뀌었다(→ [[realtime-autosave]]). 이 문서의 "10. 메뉴 창고 저장하기"는 여전히 유효하지만(메뉴 창고 저장은 별도 보관 기능이라 실시간 저장과 무관), 저장 버튼 존재 여부를 이 문서만으로 판단하지 말 것.
- **서비스명 표기가 다르다**: 이 문서는 "오늘의 반찬"으로, 8월 매뉴얼들은 "온반(溫飯)"으로 서비스를 지칭한다 → [[onban-service]] 참고 (동일 서비스의 명칭/표기 변화로 추정, 확정 여부는 코드·배포 이력 확인 필요).
- 기본 사용 흐름(날짜 선택 → 메뉴 등록 → 사진 → 카카오 발송)은 8월 문서와 내용상 크게 다르지 않아 처음 배우는 용도로는 여전히 쓸만하다.

## Detailed Notes
raw 파일 참고 — 11개 절 전체가 단계별(step-by-step) 튜토리얼 형식으로 되어 있어 요약보다 원문이 더 유용하다. 카카오 텍스트 가져오기 형식(`메뉴명 금액(천원)`, 예: `한우육전 10`)은 [[onban-admin-manual]]의 [[kakao-dispatch]] 절과 동일한 규칙을 따른다.

## Sources
- 원본 파일: `onban_manual.html` (프로젝트 루트, C:\myPrjt01\myFood01)
- 원문 전체: [[raw/onban-operator-manual-v1.md]]
- 최신 버전: [[onban-admin-manual]]
