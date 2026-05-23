#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
parse_onban_menu.py
온반 카카오채널 텍스트 → 메뉴 창고(등록된모든메뉴) 구글 시트 업로드
2026년 1~5월 데이터 처리

실행 전: pip install requests
"""

import re, json, time, sys, io
from collections import Counter, defaultdict as ddict
import requests


def normalize_price(p):
    """12000 → 12, 1200 → 1.2, 9.5 → 9.5, 10 → 10"""
    if p >= 100:
        r = p / 1000
        return int(r) if r == int(r) else round(r, 1)
    return int(p) if p == int(p) else p

# Windows 콘솔 인코딩 강제 UTF-8
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

# ──────────────────────────────────────────────────────────────
GAS_URL = 'https://script.google.com/macros/s/AKfycbwtXJL4_lMynbG4U13PqbnPOiTp15evyw0BPPQ0A9aV5QYlI5dSQB4Ru-8BOqVR9RPq1w/exec'
FILE    = r"C:\Users\user\Documents\522 금요일 메뉴입니다.txt"
# ──────────────────────────────────────────────────────────────


# ── 카테고리 분류 ──────────────────────────────────────────────
def categorize(name):
    n = name
    # 밀키트
    if '밀키트' in n or n.endswith('키트'):
        return '밀키트'
    # 김치
    if any(k in n for k in ['김치', '겉절이', '소박이', '깍두기']):
        return '김치'
    # 메인으로 분류할 볶음류 예외
    main_exc = [
        '제육볶음', '낙지볶음', '오징어볶음', '쭈꾸미볶음',
        '마파두부', '잡채', '고추잡채', '닭볶음탕', '콩나물잡채',
        '5색비빔나물', '가지강정', '버섯탕수'
    ]
    if any(k in n for k in main_exc):
        return '메인'
    # 반찬
    반찬_kw = [
        '무침', '조림', '나물', '멸치볶음', '미역줄기볶음', '미역줄기',
        '장아찌', '젓갈', '실채', '건가자미', '아구포', '쥐포', '진미채',
        '고들빼기', '무말랭이', '계란장', '꽈리고추찜', '생깻잎찜',
        '깻잎찜', '생깻잎무침', '들깨무침', '새송이버섯조림',
        '연근조림', '연근우엉조림', '우엉조림', '검은콩조림',
        '표고마늘쫑볶음', '햄감자채볶음', '꽈리고추 새송이조림',
        '깻순조림', '톳젓갈무침', '북어피강정', '톳두부무침',
        '취나물', '시금치나물', '시금치무침', '숙주무침', '가지꽈리무침',
        '봄나물무침', '가지무침', '두부구이', '볶음'
    ]
    if any(k in n for k in 반찬_kw):
        return '반찬'
    return '메인'


# ── 파일 파싱 ──────────────────────────────────────────────────
with open(FILE, encoding='utf-8') as f:
    lines = [l.rstrip('\n') for l in f]

STOP_WORDS = {
    '좋아요수', '댓글수', '공유수', '온반', '댓글 0개',
    '최신순', '등록순', '글 통계', '더보기 메뉴'
}  # 빈 줄('')은 포함하지 않음 — 메뉴 항목 사이 빈줄 무시
DATE_RE = re.compile(r'^(\d+)/(\d+)\s+[가-힣]+요일\s+메뉴입니다')
MENU_RE = re.compile(r'^(.+?)\s+([\d.]+)\s*$')

sections = []
cur_date, cur_menus, in_menus = None, [], False

for line in lines:
    s = line.strip()

    dm = DATE_RE.match(s)
    if dm:
        if cur_date and cur_menus:
            sections.append((cur_date, list(cur_menus)))
        cur_date  = (2026, int(dm.group(1)), int(dm.group(2)))
        cur_menus = []
        in_menus  = True
        continue

    if not s:          # 빈 줄 — 파싱 상태 유지하고 무시
        continue

    if (s in STOP_WORDS
            or s.startswith('+ ')
            or re.match(r'^\d{4}\.\d+\.\d+', s)
            or s.startswith('댓글')
            or s.startswith('아직 댓글')
            or s.startswith('댓글을')):
        in_menus = False
        continue

    if in_menus and s:
        child = '👧' in s
        clean = s.replace('👧', '').strip()
        mm = MENU_RE.match(clean)
        if mm:
            name = mm.group(1).strip()
            try:
                p     = float(mm.group(2))
                price = normalize_price(p)
            except ValueError:
                continue
            cur_menus.append({'name': name, 'price': price, 'child': child})

if cur_date and cur_menus:
    sections.append((cur_date, list(cur_menus)))


# ── 1~5월 필터 + 집계 ─────────────────────────────────────────
target_sections = [(d, m) for d, m in sections if 1 <= d[1] <= 5]

print("=" * 55)
print(f"1~5월 날짜 수: {len(target_sections)}일")

# 월별 날짜 수 요약
month_cnt = Counter(d[1] for d, _ in target_sections)
for mo in sorted(month_cnt):
    print(f"  {mo}월 : {month_cnt[mo]}일")

# 날짜별 메뉴 수
print()
for d, ms in sorted(target_sections, key=lambda x: (x[0][1], x[0][2])):
    print(f"  {d[1]:2d}/{d[2]:02d} : {len(ms):3d}개")

# 전체 고유 메뉴 집계 (등장 횟수 포함)
agg = {}
for date, menus in target_sections:
    for m in menus:
        k = m['name']
        if k not in agg:
            agg[k] = dict(
                name      = k,
                cat       = categorize(k),
                price     = m['price'],
                stock     = 0,
                child     = m['child'],
                imgUrl    = '',
                count     = 0,
                updatedAt = int(time.time() * 1000)
            )
        agg[k]['count'] += 1

menus_list = sorted(agg.values(), key=lambda x: (-x['count'], x['name']))

print(f"\n고유 메뉴: {len(menus_list)}개")
cat_cnt = Counter(m['cat'] for m in menus_list)
print(f"카테고리: {dict(cat_cnt)}")

print("\n[등장 횟수 TOP 15]")
for m in menus_list[:15]:
    ch = '👧' if m['child'] else '  '
    print(f"  {m['count']:2d}회 [{m['cat']:4s}] {ch} {m['name']} {m['price']}천원")

print("=" * 55)


# ── 공통 GAS 헬퍼 ─────────────────────────────────────────────
_session = requests.Session()

def gas_get(action, params=''):
    url = GAS_URL + f'?action={action}' + (('&' + params) if params else '')
    resp = _session.get(url, allow_redirects=True)
    try:
        return resp.json()
    except Exception:
        return {'success': False, 'raw': resp.text[:200]}

def gas_post(action, data_obj):
    body = json.dumps({'data': data_obj}, ensure_ascii=False).encode('utf-8')
    url  = GAS_URL + f'?action={action}'
    resp = _session.post(url, data=body,
                         headers={'Content-Type': 'application/json; charset=utf-8'},
                         allow_redirects=False)
    if resp.status_code in (301, 302, 303):
        resp = _session.get(resp.headers.get('Location', ''), allow_redirects=True)
    try:
        return resp.json()
    except Exception:
        return {'success': False, 'raw': resp.text[:200]}


# ── [1] 메뉴 창고(등록된모든메뉴) 업로드 ──────────────────────
print("\n[1] 메뉴 창고 업로드 중...")
r = gas_post('export_all_menus', menus_list)
if r.get('success'):
    print(f"  ✅ 완료 — {r.get('count','?')}개 → [등록된모든메뉴] 시트")
else:
    print(f"  ❌ 실패: {r}")


# ── [2] 날짜별 메뉴 묶음 업로드 ───────────────────────────────
day_map = ddict(dict)   # "2026-MM-DD" → {name: menu_dict}
for (year, month, day_n), menus in target_sections:
    date_str = f"{year}-{month:02d}-{day_n:02d}"
    for m in menus:
        nm = m['name']
        if nm not in day_map[date_str]:
            day_map[date_str][nm] = m

all_daily = []
for date_str in sorted(day_map.keys()):
    for nm, m in day_map[date_str].items():
        cat_val = agg[nm]['cat'] if nm in agg else categorize(nm)
        all_daily.append({
            'date':   date_str,
            'name':   nm,
            'cat':    cat_val,
            'price':  m['price'],
            'stock':  0,
            'child':  m['child'],
            'imgUrl': ''
        })

dates_set = sorted(day_map.keys())
print(f"\n[2] 날짜별 메뉴 묶음 업로드 중...")
print(f"  날짜 {len(dates_set)}개 / 총 메뉴 항목 {len(all_daily)}개")

r2 = gas_post('export_menu', all_daily)
if r2.get('success'):
    print(f"  ✅ 완료 — {r2.get('sheets','?')}개 탭 생성 ({r2.get('count','?')}개 항목)")
    print(f"  생성된 시트 탭: {', '.join(dates_set)}")
else:
    print(f"  ❌ 실패: {r2}")
