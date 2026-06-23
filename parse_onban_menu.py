#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
parse_onban_menu.py
온반 카카오채널 텍스트 → 메뉴 창고(등록된모든메뉴) 구글 시트 업로드
2025년 5월 ~ 2026년 5월 데이터 처리

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
API_URL = 'https://myfood01-production.up.railway.app'
FILE    = r"C:\Users\user\Documents\522 금요일 메뉴입니다.txt"
# ──────────────────────────────────────────────────────────────


# ── 카테고리 분류 ──────────────────────────────────────────────
def categorize(name):
    n = name
    if '밀키트' in n or n.endswith('키트'):
        return '밀키트'
    if any(k in n for k in ['김치', '겉절이', '소박이', '깍두기']):
        return '김치'
    main_exc = [
        '제육볶음', '낙지볶음', '오징어볶음', '쭈꾸미볶음',
        '마파두부', '잡채', '고추잡채', '닭볶음탕', '콩나물잡채',
        '5색비빔나물', '가지강정', '버섯탕수'
    ]
    if any(k in n for k in main_exc):
        return '메인'
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
# 파일은 역순(최신→과거). 연도는 월이 증가할 때(12→1 역방향 = 1→12 감지) 감소
with open(FILE, encoding='utf-8') as f:
    lines = [l.rstrip('\n') for l in f]

STOP_WORDS = {
    '좋아요수', '댓글수', '공유수', '온반', '댓글 0개',
    '최신순', '등록순', '글 통계', '더보기 메뉴'
}
DATE_RE = re.compile(r'^(\d+)/(\d+)\s+[가-힣]+요일\s+메뉴입니다')
MENU_RE = re.compile(r'^(.+?)\s+([\d.]+)\s*$')

sections   = []
cur_date, cur_menus, in_menus = None, [], False
cur_year   = 2026   # 파일 시작(최신) 연도 — 역순이므로 2026→2025→2024 자동 감소
prev_month = None   # 직전 파싱 월

for line in lines:
    s = line.strip()

    dm = DATE_RE.match(s)
    if dm:
        if cur_date and cur_menus:
            sections.append((cur_date, list(cur_menus)))
        month = int(dm.group(1))
        day   = int(dm.group(2))
        # 역순 파일: 이전 월보다 월이 커지면 연도 경계 넘은 것
        if prev_month is not None and month > prev_month:
            cur_year -= 1
        prev_month = month
        cur_date  = (cur_year, month, day)
        cur_menus = []
        in_menus  = True
        continue

    if not s:
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


# ── 2024-02 ~ 2026-05 필터 + 집계 ────────────────────────────
def in_range(d):
    y, m = d[0], d[1]
    if y == 2024: return m >= 2
    if y == 2025: return True
    if y == 2026: return m <= 5
    return False

target_sections = [(d, ms) for d, ms in sections if in_range(d)]

print("=" * 60)
print(f"2024-02 ~ 2026-05  날짜 수: {len(target_sections)}일")

# 연·월별 요약
ym_cnt = Counter((d[0], d[1]) for d, _ in target_sections)
for (y, m) in sorted(ym_cnt):
    print(f"  {y}/{m:02d} : {ym_cnt[(y,m)]:2d}일")

# 날짜별 메뉴 수
print()
for d, ms in sorted(target_sections, key=lambda x: x[0]):
    print(f"  {d[0]}/{d[1]:02d}/{d[2]:02d} : {len(ms):3d}개")

# 전체 고유 메뉴 집계
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
    print(f"  {m['count']:3d}회 [{m['cat']:4s}] {ch} {m['name']} {m['price']}천원")

print("=" * 60)


# ── API 헬퍼 ──────────────────────────────────────────────────
_session = requests.Session()

def api_post(path, data_obj):
    url  = API_URL + path
    resp = _session.post(url, json={'data': data_obj},
                         headers={'Content-Type': 'application/json'})
    try:
        return resp.json()
    except Exception:
        return {'success': False, 'raw': resp.text[:200]}


# ── [1] 메뉴 창고 업로드 ──────────────────────────────────────
print("\n[1] 메뉴 창고 업로드 중...")
r = api_post('/api/menu/all', menus_list)
if r.get('success'):
    print(f"  ✅ 완료 — {r.get('count','?')}개 → menus 테이블")
else:
    print(f"  ❌ 실패: {r}")


# ── [2] 날짜별 메뉴 묶음 업로드 ───────────────────────────────
day_map = ddict(dict)
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

r2 = api_post('/api/menu/daily', all_daily)
if r2.get('success'):
    print(f"  ✅ 완료 — {r2.get('sheets','?')}개 날짜 ({r2.get('count','?')}개 항목) → daily_menus 테이블")
    print(f"  날짜 범위: {dates_set[0]} ~ {dates_set[-1]}")
else:
    print(f"  ❌ 실패: {r2}")
