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

## [2026-08-26] update | 관리자페이지_사용매뉴얼.html 3.4절 실제 문구 갱신
- 사용자 요청으로 원본 문서(`관리자페이지_사용매뉴얼.html`) 3.4절을 코드 확인 내용대로 수정: 제목 "실시간 저장" → "일일 메뉴 저장", 명시적 저장 버튼·저장 중 전체화면 차단·탭 이동 시 미저장 경고·새로고침 시 무경고 소실 4가지를 반영
- 함께 갱신: [[onban-admin-manual]] (raw 사본 + source-note Key Takeaways), [[realtime-autosave]] (매뉴얼 갱신 완료로 표시), [[wiki/index]] (알아둘 점 갱신)
- Browser 프리뷰로 렌더링 확인 완료 (get_page_text로 3.4절 텍스트·warn/note 마커 정상 출력 확인)
---

## [2026-08-26] ingest | 온반 상세설계서 2종
- Source type: file (local HTML design specs, myFood01 프로젝트 루트) — 지난 ingest에서 사용자용 매뉴얼만 처리하며 범위 밖으로 남겨뒀던 문서
- Raw files: raw/onban-customer-design-spec.html, raw/onban-admin-design-spec.html (원본 HTML 그대로 보존 — API 경로·DB 컬럼명 등 정확한 문자열이 중요해 매뉴얼과 달리 마크다운 전사하지 않음, CLAUDE.md 컨벤션에 반영)
- Pages created:
  - Sources: [[onban-customer-design-spec]], [[onban-admin-design-spec]]
  - Entities: [[onban-backend-api]] (server.js, 9테이블 데이터 모델 포함)
  - Concepts: [[sse-realtime-sync]], [[notification-dispatch]], [[device-id-identification]], [[localstorage-server-truth]]
- Pages updated: [[reservation-order]](reserve_date 단일 판별기준·API 보완조회 로직), [[menu-warehouse]](DB 조인구조), [[realtime-autosave]](설계서와 교차검증), [[ai-menu-recommendation]](persona 로직·추적API), [[onban-service]](기술스택), [[menu-manager-page]](인증방식), [[onban-customer-page]](저장확정모델·이중방어), [[onban-image-gallery]](관리자 편집 API)
- 발견한 사실: 관리자 상세설계서 5.5절이 지난번 매뉴얼 정정(실시간저장→명시적버튼)과 서술이 일치 — 별도 출처(코드 grep vs 설계서 문서)로 같은 결론에 도달해 교차검증됨
---
