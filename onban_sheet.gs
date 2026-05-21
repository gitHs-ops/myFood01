// ══════════════════════════════════════════════════════
// onban_sheet.gs — 구글 시트 연동 2026 05 21 v2// ══════════════════════════════════════════════════════

var SHEET_ID = '1_jAZK1zwob2zbiOwKRYzmpKkaswOAi4RUGC043ujiLo';

// ── 메뉴 내보내기 ──
function exportMenu(e, dataOverride) {
  var data = dataOverride || JSON.parse(decodeURIComponent(e.parameter.data || '[]'));
  if (!data.length) return json({ success: false, error: '데이터 없음' });

  var ss = SpreadsheetApp.openById(SHEET_ID);
  var byDate = {};
  data.forEach(function(m) {
    var d = Array.isArray(m) ? m[0] : m.date;
    if (!byDate[d]) byDate[d] = [];
    byDate[d].push(m);
  });

  var headers = ['메뉴명', '카테고리', '금액(천원)', '재고', '어린이가능', '사진URL'];
  var dates   = Object.keys(byDate).sort();

  dates.forEach(function(date) {
    var sheet = ss.getSheetByName(date);
    if (!sheet) sheet = ss.insertSheet(date);
    sheet.clearContents();
    sheet.clearFormats();
    sheet.appendRow(headers);
    var hRange = sheet.getRange(1, 1, 1, headers.length);
    hRange.setFontWeight('bold')
          .setBackground('#086266')
          .setFontColor('#ffffff')
          .setHorizontalAlignment('center');
    sheet.setFrozenRows(1);
    var rows = byDate[date].map(function(m) {
      if (Array.isArray(m)) return [m[1], m[2], m[3], m[4], m[5] ? 'Y' : 'N', m[6] || ''];
      return [m.name||'', m.cat||'', m.price||0, m.stock||0, m.child ? 'Y' : 'N', m.imgUrl||''];
    });
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
    sheet.autoResizeColumns(1, headers.length);
  });

  return json({ success: true, count: data.length, sheets: dates.length });
}

// ── 날짜 목록 조회 ──
function listDates() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var dates = ss.getSheets()
    .map(function(s){ return s.getName(); })
    .filter(function(n){ return /^\d{4}-\d{2}-\d{2}$/.test(n); })
    .sort().reverse();
  return json({ success: true, dates: dates });
}

// ── 메뉴 가져오기 ──
function importMenu(e) {
  var date = decodeURIComponent(e.parameter.date || '');
  if (!date) return json({ success: false, error: '날짜 없음' });

  var ss    = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName(date);
  if (!sheet) return json({ success: false, error: date + ' 탭이 없습니다.' });

  var rows = sheet.getDataRange().getValues();
  if (rows.length < 2) return json({ success: false, error: '데이터 없음' });

  var menus = [];
  for (var i = 1; i < rows.length; i++) {
    var r = rows[i];
    if (!r[0]) continue;
    menus.push({
      name:   String(r[0] || ''),
      cat:    String(r[1] || '기타'),
      price:  Number(r[2]) || 0,
      stock:  Number(r[3]) || 0,
      child:  String(r[4]) === 'Y',
      imgUrl: String(r[5] || '') || null
    });
  }
  return json({ success: true, date: date, menus: menus });
}

// ── 전체 메뉴 내보내기 ──
function exportAllMenus(e, dataOverride) {
  var data = dataOverride || JSON.parse(decodeURIComponent((e&&e.parameter&&e.parameter.data)||'[]'));
  var ss   = SpreadsheetApp.openById(SHEET_ID);
  var SNAME = '등록된모든메뉴';
  var sheet = ss.getSheetByName(SNAME);
  if (!sheet) sheet = ss.insertSheet(SNAME);
  sheet.clearContents(); sheet.clearFormats();
  var headers = ['메뉴명','카테고리','금액(천원)','재고','어린이가능','사진URL','등록횟수','수정시각(ms)'];
  sheet.appendRow(headers);
  sheet.getRange(1,1,1,headers.length).setFontWeight('bold').setBackground('#086266').setFontColor('#ffffff').setHorizontalAlignment('center');
  sheet.setFrozenRows(1);
  var rows = data.map(function(m){
    return [m.name||'',m.cat||'기타',m.price||0,m.stock||0,m.child?'Y':'N',m.imgUrl||'',m.count||0,m.updatedAt||0];
  });
  if (rows.length) sheet.getRange(2,1,rows.length,headers.length).setValues(rows);
  sheet.autoResizeColumns(1,headers.length);
  return json({ success: true, count: rows.length });
}

// ── 전체 메뉴 가져오기 ──
function importAllMenus() {
  var ss    = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName('등록된모든메뉴');
  if (!sheet) return json({ success: false, error: '시트 없음' });
  var rows = sheet.getDataRange().getValues();
  if (rows.length < 2) return json({ success: false, error: '데이터 없음' });
  var menus = [];
  for (var i = 1; i < rows.length; i++) {
    var r = rows[i]; if (!r[0]) continue;
    menus.push({ name:String(r[0]||''), cat:String(r[1]||'기타'), price:Number(r[2])||0,
      stock:Number(r[3])||0, child:String(r[4])==='Y', imgUrl:String(r[5]||'')||null,
      count:Number(r[6])||0, updatedAt:Number(r[7])||0 });
  }
  return json({ success: true, menus: menus });
}

// ── 설정 저장 ──
function saveSettings(e, dataOverride) {
  var data = dataOverride || JSON.parse(decodeURIComponent((e&&e.parameter&&e.parameter.data)||'{}'));
  var ss   = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName('settings');
  if (!sheet) sheet = ss.insertSheet('settings');
  sheet.clearContents();
  sheet.appendRow(['key', 'value']);
  Object.keys(data).forEach(function(k) {
    var v = (typeof data[k] === 'object') ? JSON.stringify(data[k]) : String(data[k]);
    sheet.appendRow([k, v]);
  });
  return json({ success: true });
}

// ── 설정 로드 ──
function loadSettings() {
  var ss    = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName('settings');
  if (!sheet) return json({ success: false, error: '설정 없음' });
  var rows = sheet.getDataRange().getValues();
  if (rows.length < 2) return json({ success: false, error: '설정 없음' });
  var data = {};
  for (var i = 1; i < rows.length; i++) {
    var k = rows[i][0], v = rows[i][1];
    if (!k) continue;
    try { data[k] = JSON.parse(v); } catch(ex) { data[k] = v; }
  }
  return json({ success: true, data: data });
}

// ── 접속 로그 ──
function logAccess(e) {
  var ss    = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName('접속로그');
  if (!sheet) {
    sheet = ss.insertSheet('접속로그');
    sheet.appendRow(['일시', 'User-Agent', 'Referrer', '페이지']);
    sheet.getRange(1, 1, 1, 4)
         .setFontWeight('bold').setBackground('#086266')
         .setFontColor('#ffffff').setHorizontalAlignment('center');
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(1, 150);
    sheet.setColumnWidth(2, 300);
    sheet.setColumnWidth(3, 200);
    sheet.setColumnWidth(4, 80);
  }
  var ua   = (e && e.parameter && e.parameter.ua)   || '';
  var ref  = (e && e.parameter && e.parameter.ref)  || '';
  var page = (e && e.parameter && e.parameter.page) || 'index';
  sheet.appendRow([new Date(), ua, ref, page]);
  return json({ success: true });
}

function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
