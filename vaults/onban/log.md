# onban vault 로그

## [2026-08-26] ingest | 온반 사용자 매뉴얼 3종
- Source type: file (local HTML manuals, myFood01 프로젝트 루트)
- Raw files: raw/onban-admin-manual.md, raw/onban-customer-manual.md, raw/onban-operator-manual-v1.md
- Pages created:
  - Sources: [[onban-admin-manual]], [[onban-customer-manual]], [[onban-operator-manual-v1]]
  - Entities: [[onban-service]], [[menu-manager-page]], [[onban-customer-page]], [[onban-image-gallery]]
  - Concepts: [[kakao-dispatch]], [[reservation-order]], [[menu-warehouse]], [[realtime-autosave]], [[ai-menu-recommendation]]
- Pages updated: 없음 (vault 신규 생성)
- 참고: 사용자 요청으로 설계서(상세설계서.html) 2종은 이번 ingest 범위에서 제외됨 — 사용자용 매뉴얼 3종만 처리
- 발견한 드리프트: [[onban-admin-manual]] 3.4절("실시간 자동 저장")이 실제 코드(2026-08-20 "실시간 연동 폐지" 주석, 최근 커밋 b591206/986c3a9/64d2722)와 어긋남을 확인. [[realtime-autosave]] 페이지에 정정 내용 기록, 매뉴얼 자체 갱신은 이번 범위 밖(문서 원본은 수정하지 않음)
---
