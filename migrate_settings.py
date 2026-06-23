#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
migrate_settings.py
구글 시트 settings → Railway MySQL API 1회성 마이그레이션
실행: python migrate_settings.py
"""
import requests, json, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

GAS_URL = 'https://script.google.com/macros/s/AKfycbwtXJL4_lMynbG4U13PqbnPOiTp15evyw0BPPQ0A9aV5QYlI5dSQB4Ru-8BOqVR9RPq1w/exec'
API_URL = 'https://myfood01-production.up.railway.app'

print('=== 구글 시트 → MySQL 설정 마이그레이션 ===')

# 1) GAS에서 설정 읽기
print('\n[1] GAS에서 설정 로드 중...')
try:
    r = requests.get(GAS_URL + '?action=load_settings', allow_redirects=True, timeout=30)
    d = r.json()
except Exception as e:
    print(f'  ❌ GAS 호출 실패: {e}')
    sys.exit(1)

if not d.get('success') or not d.get('data'):
    print(f'  ❌ 설정 없음 또는 실패: {d}')
    sys.exit(1)

data = d['data']
print(f'  ✅ 로드 완료')
print(f'  항목: {list(data.keys())}')

# 2) Railway MySQL API로 저장
print('\n[2] Railway MySQL에 저장 중...')
try:
    r2 = requests.post(
        API_URL + '/api/settings',
        json={'data': data},
        headers={'Content-Type': 'application/json'},
        timeout=30
    )
    d2 = r2.json()
except Exception as e:
    print(f'  ❌ API 호출 실패: {e}')
    sys.exit(1)

if d2.get('success') is not False:
    print(f'  ✅ 저장 완료!')
    print(f'\n이전된 설정:')
    for k, v in data.items():
        print(f'  {k}: {json.dumps(v, ensure_ascii=False)}')
else:
    print(f'  ❌ 저장 실패: {d2}')
