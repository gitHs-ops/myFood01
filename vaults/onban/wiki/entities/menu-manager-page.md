---
title: 메뉴 관리 페이지 (menu-manager.html)
page-type: entity
entity-type: application-page
aliases: ["관리자 페이지", "운영자 페이지"]
domain: onban
tags: [온반, 관리자페이지, menu-manager]
created: 2026-08-26
updated: 2026-08-26
related: [[onban-service]], [[onban-admin-manual]], [[onban-operator-manual-v1]], [[kakao-dispatch]], [[reservation-order]], [[menu-warehouse]], [[realtime-autosave]], [[onban-image-gallery]]
---

# 메뉴 관리 페이지 (menu-manager.html)

## Overview
[[onban-service]]의 점주(운영자) 전용 관리 화면. 비밀번호 1개로 보호되며, 5개 탭(🍱메뉴 관리 / 💬카카오 발송 / 📦주문 관리 / 🗄메뉴 창고 / ⚙설정)으로 구성. 실물 파일은 프로젝트 루트의 `menu-manager.html`.

## Key Facts
- 접속 URL 예시(2026-04 기준): `https://giths-ops.github.io/myOnban/menu-manager.html`
- 로그인: 비밀번호 오입력 시 페이지 자체가 닫힘(재시도 UI 없음)
- 일일 메뉴 저장 방식은 두 번 바뀌었다 — 2026-08-20부로 실시간 자동 저장이 폐지되고 명시적 "💾 일일 메뉴 저장" 버튼 + 저장 중 전체화면 차단(`#savingOverlay`) 방식으로 되돌아감 (마스터 메뉴는 계속 즉시 저장). 상세 변천사 → [[realtime-autosave]]
- 카카오 발송 텍스트를 양방향으로 다룸: 오늘 메뉴 → 문구 생성, 문구 → 메뉴 재등록 → [[kakao-dispatch]]
- 이미지 갤러리 페이지([[onban-image-gallery]])도 같은 비밀번호로 로그인된 기기에서는 관리자 모드로 동작

## Related
- 사용법 상세: [[onban-admin-manual]] (최신, 2026-08-10), [[onban-operator-manual-v1]] (초기, 2026-04)
