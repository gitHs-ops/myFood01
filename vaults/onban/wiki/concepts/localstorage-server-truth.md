---
title: localStorage 정리 — 서버 단일 원본화 (2026-08-08)
page-type: concept
domain: onban
tags: [localStorage, 서버원본, 온반, 2026-08-08]
created: 2026-08-26
updated: 2026-08-26
related: [[onban-backend-api]], [[menu-manager-page]], [[onban-customer-page]], [[device-id-identification]], [[onban-admin-design-spec]], [[onban-customer-design-spec]]
---

# localStorage 정리 — 서버 단일 원본화 (2026-08-08)

## Overview
2026-08-08 이전에는 관리자 설정(재고 기본값·계좌정보·관리자연락처·카테고리)이 서버 DB뿐 아니라 각 기기의 `localStorage`에도 캐시되어 있었다(`onban_settings`/`onban_banks`/`onban_admin`/`onban_categories`). 2026-08-08에 이 캐시들을 전부 제거하고 **서버 DB(settings 테이블/categories 테이블)만 원본**으로 삼도록 정리했다.

## 왜 문제였는가
- **카테고리 색상**: 예전엔 고객 화면이 자기 기기의 localStorage(`onban_categories`)를 읽었는데, 그 값을 쓰는 코드가 관리자 화면(다른 기기)에만 있어서 고객에게는 항상 기본색만 보이던 버그가 있었다.
- **관리자 폰을 바꾸면 통째로 사라짐**: 카테고리 원본이 그 기기에만 있었기 때문에, 관리자가 기기를 바꾸면 설정이 전파되지 않고 사라졌다.

## 정리 후 현재 동작
| 항목 | 이전 | 이후(2026-08-08~) |
|---|---|---|
| 재고 기본값·계좌·관리자연락처 | localStorage 캐시 + DB | DB만 원본, 페이지 로드마다 서버에서 재조회해 메모리 변수(`_settings`/`_adminInfo`/`_banks`)에 담음 |
| 카테고리 | localStorage(`onban_categories`) | 전용 `categories` 테이블. `getCats()`는 메모리 변수 `_cats` 반환, `setCats()`는 즉시 `POST /api/settings`로 서버 저장 |
| 고객 화면 카테고리 색상 | 관리자 기기의 로컬값 (사실상 항상 기본색) | `GET /api/settings`의 `categories` 값에서 직접 받음(`loadCatColorsFromServer()`) |

**마이그레이션 방식**: 페이지 로드 시 `loadCatsFromServer()`가 서버 값으로 맞추되, 이 기기에 옛 localStorage 값이 남아 있고 서버엔 아직 없으면 1회 서버로 옮긴 뒤 로컬 값을 지운다.

## 지금도 남아있는 localStorage 키
`onban_device_id`(기기 식별 UUID)와 `orders`(주문내역 캐시, 오프라인 폴백용)뿐. 설정류는 전부 제거됨 — 이 두 키만은 "캐시가 아니라 이 기기 고유의 데이터"라서 의도적으로 유지된 것으로 보인다.

## Related
프로젝트 내부 규칙(이 vault 밖 메모리)의 "localStorage 사용 금지" 원칙과 정확히 같은 방향의 정리 작업 — device_id UUID만 예외로 허용한다는 규칙이 이 코드 정리와 일치한다.
