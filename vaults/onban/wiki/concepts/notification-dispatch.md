---
title: 알림 발송 구조 (SMS·카카오 알림톡)
page-type: concept
domain: onban
tags: [알림발송, SMS, 카카오알림톡, 온반, 장애이력]
created: 2026-08-26
updated: 2026-08-26
related: [[onban-backend-api]], [[menu-manager-page]], [[onban-admin-design-spec]], [[onban-customer-design-spec]]
---

# 알림 발송 구조 (SMS·카카오 알림톡)

## Overview
[[onban-backend-api]]가 Google Apps Script(GAS) Web App을 프록시로 사용해 솔라피 SMS·카카오 알림톡을 발송한다. 설계 원칙은 **"클라이언트는 알림 로직이 없다"** — GAS 호출은 전부 서버(`_notifyOrder`/`_notifyStatus`/`_sms`/`_alimtalk`)에서만 일어나고, 프론트엔드는 API 응답만 받는다. 발송은 fire-and-forget(비동기 IIFE)이라 실패해도 API 응답 자체엔 영향 없음.

## 트리거별 발송 매핑
| 트리거 | 고객 알림톡 | 관리자 SMS |
|---|---|---|
| 신규 주문 접수 | 비활성(기본) | ✅ 활성 |
| 주문 접수확정(confirmed) | 비활성 | — (배송업체 SMS 항목은 실제 미사용) |
| **배송완료** | **✅ 활성 — 기본으로 나가는 유일한 고객 알림톡** | — |
| 주문 취소(관리자 처리) | 비활성 | — |
| 주문 취소(고객 본인) | — | ✅ 활성 |
| 고객이 주문 저장(수량 등 변경) | — (`admin_reply`에 변경기록으로 대체) | ✅ 활성 |
| 관리자 답변 | 비활성 | — |

활성 여부는 `settings.notifyEvents`(배열, 기본값 `["delivered"]`)와 `smsEnabled`/`alimtalkEnabled` 토글의 조합으로 결정된다. `order`/`confirmed`/`cancelled`/`reply`를 `notifyEvents`에 추가하면 해당 시점도 함께 발송되도록 설계돼 있으나, **기본 운영값은 배송완료 하나뿐**이다.

## 왜 접수 시점엔 고객에게 안 보내는가
카카오 알림톡은 카카오 채널 대화방에 도착한다. 고객이 그 자리에서 답장하면, 시스템 도입 이전의 "카톡으로 직접 주문받던" 방식으로 되돌아가 버린다. 그래서 거래가 끝난 **배송완료 시점만** 기본 활성화했다 — 업주의 명시적 의사결정.

## 2026-08-08 발송 전면 미작동 사고
운영 DB에 `gasUrl` 값 자체가 존재하지 않아 **SMS·알림톡이 한 통도 발송되지 않고 있었다.** 저장하는 코드가 프로젝트 어디에도 없었고, 발송 실패가 어디에도 기록되지 않아 오랫동안 아무도 몰랐다. 해결 과정에서 두 가지 진단 장치가 추가됨:
- `settings.lastNotify` — 가장 최근 GAS 호출 결과(성공 시 HTTP상태+응답본문 300자, 실패 시 에러메시지, 시도 자체를 안 했으면 그 이유: 번호없음/gasUrl없음/토글꺼짐)
- `settings.lastNotifyTrigger` — 어떤 주문의 어떤 상태변경에서 시도했는지 + 그 시점의 판단값

원인은 주소 누락 + 솔라피 API 키의 IP 제한이 겹친 것이었다. 두 키 모두 전화번호는 뒤 4자리만 남기고(`_mask()`) 관리자 토큰 없이는 조회 불가.

## `adminPhone` vs `phone` 키 불일치 (같은 사고에서 함께 발견)
관리자 화면은 `phone` 키로 저장하는데 서버는 원래 `adminPhone`만 읽고 있어 업주 SMS가 영원히 안 갔을 결함이 있었다. `const ownerPhone = ns.adminPhone || ns.phone`으로 둘 다 인정하도록 수정.

## 배송업체 SMS는 실제 미사용
코드는 남아 있다(`settings.deliveryPhone`이 설정돼 있을 때만 발송). 운영에서는 이 칸을 항상 비워두므로 실제로는 발송되지 않는다 — 설계서에도 "코드상 가능한 동작이지 실제 운영 동작이 아니다"라고 명시.

## Related
[[onban-admin-design-spec]] 10장, [[onban-customer-design-spec]] 10.1절
