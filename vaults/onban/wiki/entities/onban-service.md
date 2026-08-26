---
title: 온반(溫飯)
page-type: entity
entity-type: product-service
aliases: ["오늘의 반찬", "Onban"]
domain: onban
tags: [온반, 서비스, 반찬주문]
created: 2026-08-26
updated: 2026-08-26
related: [[menu-manager-page]], [[onban-customer-page]], [[onban-image-gallery]], [[onban-backend-api]], [[onban-admin-manual]], [[onban-customer-manual]], [[onban-operator-manual-v1]], [[onban-customer-design-spec]], [[onban-admin-design-spec]]
---

# 온반(溫飯)

## Overview
반찬/한우/한돈/김치/밀키트 등을 카카오톡 채널 기반으로 안내하고, 별도 앱 설치 없이 웹페이지(HTML)로 주문·결제 안내를 받는 소규모 반찬 배달/픽업 서비스. 슬로건: "엄마의 정성처럼 따뜻한 마음과 온기를 담았습니다."

2026년 4월 문서에서는 "오늘의 반찬"으로, 2026년 8월 문서들에서는 "온반(溫飯)"으로 지칭된다 — 동일 서비스로 보이나 명칭 변경 시점은 코드/배포 이력 확인 전까지 추정으로 남겨둔다.

## Key Facts
- 결제 방식: 계좌 이체(국민은행) — 이체 후 입금자명을 주문자 이름으로 기재, 관리자가 수동으로 입금 확인
- 주문 채널: 카카오톡 채널 공지 → 웹페이지 링크 클릭 → 온라인 주문. 관리자는 카카오 발송 문구를 앱에서 자동 생성
- 배달 기준: 장바구니 합계 2만원 이상이면 배달 가능(배달료 1천원 추가), 미만이면 매장 픽업만 가능
- 로그인 체계: 고객은 로그인 없이 기기 식별(device_id)로 개인화, 관리자는 비밀번호 1개로 전체 관리 페이지 보호

## 기술 스택 (상세설계서 기준, 2026-08-26 추가)
Vanilla JS(프레임워크 없음) 프론트 3개 + Node.js/Express 백엔드 1개(→ [[onban-backend-api]]) + MySQL(9테이블) + Railway 호스팅 + Google Apps Script(SMS·알림톡 프록시) + Anthropic Messages API(AI추천). 실시간은 SSE(+폴링 이중화), 결제는 PG 없이 계좌이체 수동 확인 방식.

## 구성 페이지
| 페이지 | 파일 | 대상 |
|---|---|---|
| [[menu-manager-page]] | menu-manager.html | 운영자(점주) 전용 |
| [[onban-customer-page]] | onban.html | 고객 |
| [[onban-image-gallery]] | 온반_메뉴_이미지갤러리.html | 고객 + 관리자(동일 기기 로그인 시 편집 모드) |

## Related
- [[onban-admin-manual]] — 관리자 페이지 최신 매뉴얼 (2026-08-10)
- [[onban-customer-manual]] — 고객 페이지 매뉴얼 (2026-08-10)
- [[onban-operator-manual-v1]] — 관리자 페이지 초기 매뉴얼 (2026-04, 부분적으로 낡음)
