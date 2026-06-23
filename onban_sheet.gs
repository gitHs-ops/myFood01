// ══════════════════════════════════════════════════════
// onban_sheet.gs — 구글 시트 연동 2026 06 101 v1.591
// ══════════════════════════════════════════════════════

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

  var headers = ['메뉴명', '카테고리', '금액(천원)', '재고', '어린이가능', '사진URL', '설명'];
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
      if (Array.isArray(m)) return [m[1], m[2], m[3], m[4], m[5] ? 'Y' : 'N', m[6] || '', m[7] || ''];
      return [m.name||'', m.cat||'', m.price||0, m.stock||0, m.child ? 'Y' : 'N', m.imgUrl||'', m.desc||''];
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
      imgUrl: String(r[5] || '') || null,
      desc:   String(r[6] || '')
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
  var headers = ['메뉴명','카테고리','금액(천원)','재고','어린이가능','사진URL','설명','등록횟수','수정시각(ms)'];
  sheet.appendRow(headers);
  sheet.getRange(1,1,1,headers.length).setFontWeight('bold').setBackground('#086266').setFontColor('#ffffff').setHorizontalAlignment('center');
  sheet.setFrozenRows(1);
  var rows = data.map(function(m){
    return [m.name||'',m.cat||'기타',m.price||0,m.stock||0,m.child?'Y':'N',m.imgUrl||'',m.desc||'',m.count||0,m.updatedAt||0];
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
      desc:String(r[6]||''), count:Number(r[7])||0, updatedAt:Number(r[8])||0 });
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
    sheet.appendRow(['일시', '접속IP', 'Referrer', '페이지']);
    sheet.getRange(1, 1, 1, 4)
         .setFontWeight('bold').setBackground('#086266')
         .setFontColor('#ffffff').setHorizontalAlignment('center');
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(1, 150);
    sheet.setColumnWidth(2, 300);
    sheet.setColumnWidth(3, 200);
    sheet.setColumnWidth(4, 80);
  }
  var ip   = (e && e.parameter && e.parameter.ip)   || '';
  var ref  = (e && e.parameter && e.parameter.ref)  || '';
  var page = (e && e.parameter && e.parameter.page) || 'index';
  sheet.appendRow([new Date(), ip, ref, page]);
  return json({ success: true });
}

// ── 주문 저장 (신규 또는 상태 업데이트) ──
function saveOrder(e, dataOverride) {
  var order = dataOverride || JSON.parse(decodeURIComponent((e&&e.parameter&&e.parameter.data)||'{}'));
  if (!order.id) return json({ success: false, error: '주문 ID 없음' });

  var ss    = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName('주문');
  if (!sheet) {
    sheet = ss.insertSheet('주문');
    var hdr = ['id','date','time','name','phone','addr','memo','items','total','status','isReorder'];
    sheet.appendRow(hdr);
    sheet.getRange(1,1,1,hdr.length).setFontWeight('bold')
         .setBackground('#086266').setFontColor('#fff').setHorizontalAlignment('center');
    sheet.setFrozenRows(1);
  }

  var rows = sheet.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(order.id)) {
      if (order.status) sheet.getRange(i+1, 10).setValue(order.status);
      return json({ success: true, action: 'updated' });
    }
  }
  sheet.appendRow([
    order.id, order.date, order.time||'', order.name||'', order.phone||'',
    order.addr||'', order.memo||'',
    JSON.stringify(order.items||[]), order.total||0, order.status||'pending',
    order.isReorder ? 'Y' : ''
  ]);
  return json({ success: true, action: 'inserted' });
}

// ── 주문 목록 조회 ──
function getOrders(e) {
  var date  = (e&&e.parameter&&e.parameter.date) || '';
  var ss    = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName('주문');
  if (!sheet) return json({ success: true, orders: [] });
  var rows  = sheet.getDataRange().getValues();
  if (rows.length < 2) return json({ success: true, orders: [] });
  // 헤더에서 동적 컬럼 위치 확인
  var headerRow = rows[0];
  var addReqIdx = -1, addReqAtIdx = -1, adminReplyIdx = -1, replyAtIdx = -1;
  for (var j = 0; j < headerRow.length; j++) {
    if (String(headerRow[j]) === '추가요청')  addReqIdx      = j;
    if (String(headerRow[j]) === 'addreqAt')  addReqAtIdx    = j;
    if (String(headerRow[j]) === '관리자답변') adminReplyIdx  = j;
    if (String(headerRow[j]) === 'replyAt')   replyAtIdx     = j;
  }
  var orders = [];
  for (var i = 1; i < rows.length; i++) {
    var r = rows[i];
    if (!r[0]) continue;
    // 구글 시트가 날짜 문자열을 Date 객체로 자동 변환하는 경우 대응
    var rowDate = (r[1] instanceof Date)
      ? Utilities.formatDate(r[1], 'Asia/Seoul', 'yyyy-MM-dd')
      : String(r[1]).trim().slice(0, 10);
    if (date && rowDate !== date) continue;
    var items = [];
    try { items = JSON.parse(r[7]); } catch(ex) {}
    // 구글 시트가 전화번호 앞자리 0을 숫자로 변환하여 제거한 경우 복원 후 포맷
    var rawPhone = String(r[4] || '').replace(/[^0-9]/g, '');
    if (rawPhone.length === 10 && rawPhone.charAt(0) !== '0') rawPhone = '0' + rawPhone;
    var phone = rawPhone.length === 11
      ? rawPhone.slice(0,3)+'-'+rawPhone.slice(3,7)+'-'+rawPhone.slice(7)
      : rawPhone.length === 10
      ? rawPhone.slice(0,3)+'-'+rawPhone.slice(3,6)+'-'+rawPhone.slice(6)
      : String(r[4] || '');
    orders.push({ id:String(r[0]), date:rowDate, time:String(r[2]),
      name:String(r[3]), phone:phone, addr:String(r[5]), memo:String(r[6]),
      items:items, total:Number(r[8]), status:String(r[9]),
      isReorder:     String(r[10]||'') === 'Y',
      additionalRequest: addReqIdx     >= 0 ? String(r[addReqIdx]||'')    : '',
      addreqAt:          addReqAtIdx   >= 0 ? Number(r[addReqAtIdx]||0)   : 0,
      adminReply:        adminReplyIdx >= 0 ? String(r[adminReplyIdx]||'') : '',
      replyAt:           replyAtIdx    >= 0 ? Number(r[replyAtIdx]||0)    : 0 });
  }
  return json({ success: true, orders: orders });
}

// ── 관리자 답변 저장 ──
function saveAdminReply(e, dataOverride) {
  var data = dataOverride || {};
  var id   = data.id   || (e&&e.parameter&&e.parameter.id)   || '';
  var text = data.text || (e&&e.parameter&&e.parameter.text) || '';
  if (!id)   return json({ success: false, error: 'ID 없음' });
  if (!text) return json({ success: false, error: '내용 없음' });

  var ss    = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName('주문');
  if (!sheet) return json({ success: false, error: '시트 없음' });

  var lastCol    = sheet.getLastColumn();
  var headerVals = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var repColNum = -1, tsColNum = -1;
  for (var j = 0; j < headerVals.length; j++) {
    if (String(headerVals[j]) === '관리자답변') repColNum = j + 1;
    if (String(headerVals[j]) === 'replyAt')   tsColNum  = j + 1;
  }
  if (repColNum === -1) {
    repColNum = lastCol + 1; lastCol++;
    var hc1 = sheet.getRange(1, repColNum);
    hc1.setValue('관리자답변');
    hc1.setFontWeight('bold').setBackground('#086266').setFontColor('#ffffff').setHorizontalAlignment('center');
  }
  if (tsColNum === -1) {
    tsColNum = lastCol + 1;
    var hc2 = sheet.getRange(1, tsColNum);
    hc2.setValue('replyAt');
    hc2.setFontWeight('bold').setBackground('#086266').setFontColor('#ffffff').setHorizontalAlignment('center');
  }

  var now  = new Date().getTime();
  var rows = sheet.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(id)) {
      sheet.getRange(i + 1, repColNum).setValue(text);
      sheet.getRange(i + 1, tsColNum).setValue(now);
      return json({ success: true, replyAt: now });
    }
  }
  return json({ success: false, error: '주문 없음' });
}

// ── 주문 삭제 ──
function deleteOrder(e) {
  var id = (e&&e.parameter&&e.parameter.id) || '';
  if (!id) return json({ success: false, error: 'ID 없음' });
  var ss    = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName('주문');
  if (!sheet) return json({ success: false, error: '시트 없음' });
  var rows = sheet.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(id)) {
      sheet.deleteRow(i + 1);
      return json({ success: true });
    }
  }
  return json({ success: false, error: '주문 없음' });
}

// ── 추가 요청 저장 ──
function saveAdditionalRequest(e, dataOverride) {
  var data = dataOverride || {};
  var id   = data.id   || (e&&e.parameter&&e.parameter.id)   || '';
  var text = data.text || (e&&e.parameter&&e.parameter.text) || '';
  if (!id)   return json({ success: false, error: 'ID 없음' });
  if (!text) return json({ success: false, error: '내용 없음' });

  var ss    = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName('주문');
  if (!sheet) return json({ success: false, error: '시트 없음' });

  // 헤더에서 '추가요청', 'addreqAt' 컬럼 찾기 — 없으면 마지막에 추가
  var lastCol    = sheet.getLastColumn();
  var headerVals = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var reqColNum = -1, tsColNum = -1;
  for (var j = 0; j < headerVals.length; j++) {
    if (String(headerVals[j]) === '추가요청') reqColNum = j + 1;
    if (String(headerVals[j]) === 'addreqAt') tsColNum  = j + 1;
  }
  if (reqColNum === -1) {
    reqColNum = lastCol + 1; lastCol++;
    var hc1 = sheet.getRange(1, reqColNum);
    hc1.setValue('추가요청');
    hc1.setFontWeight('bold').setBackground('#086266').setFontColor('#ffffff').setHorizontalAlignment('center');
  }
  if (tsColNum === -1) {
    tsColNum = lastCol + 1;
    var hc2 = sheet.getRange(1, tsColNum);
    hc2.setValue('addreqAt');
    hc2.setFontWeight('bold').setBackground('#086266').setFontColor('#ffffff').setHorizontalAlignment('center');
  }

  var now  = new Date().getTime(); // ms 타임스탬프
  var rows = sheet.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(id)) {
      sheet.getRange(i + 1, reqColNum).setValue(text);
      sheet.getRange(i + 1, tsColNum).setValue(now);
      return json({ success: true, addreqAt: now });
    }
  }
  return json({ success: false, error: '주문 없음' });
}

// ── 주문 상태 변경 ──
function updateOrderStatus(e) {
  var id     = (e&&e.parameter&&e.parameter.id)     || '';
  var status = (e&&e.parameter&&e.parameter.status) || '';
  if (!id || !status) return json({ success: false, error: '파라미터 없음' });
  var ss    = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName('주문');
  if (!sheet) return json({ success: false, error: '시트 없음' });
  var rows  = sheet.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(id)) {
      sheet.getRange(i+1, 10).setValue(status);
      return json({ success: true });
    }
  }
  return json({ success: false, error: '주문 없음' });
}

function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}