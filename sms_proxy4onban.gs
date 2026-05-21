// ══════════════════════════════════════════════════════
// sms_proxy4onban.gs  —  오늘의 반찬 SMS + 알림톡 프록시 2026 05 21 v2
//
// 【설정 방법】
//   GAS 프로젝트 속성 → 스크립트 속성 추가:
//      SOLAPI_KEY    = 솔라피 API Key
//      SOLAPI_SECRET = 솔라피 API Secret
//
// 【재배포 주의】
//   배포 관리 → 기존 배포 편집 → 새 버전 (URL 유지)
// ══════════════════════════════════════════════════════

var SENDER = '01026989056';
var PFID   = 'KA01PF2604200643463721Nt5zowB1yk'; // 솔라피 카카오채널 PFID

// 알림톡 템플릿 ID
var TPL_ORDER     = 'KA01TP260420064728982mRP1sQswzyJ'; // 주문접수
var TPL_CONFIRM   = 'KA01TP260420064826771YwlmOoWlKMa'; // 배송확정
var TPL_DELIVERED = 'KA01TP260420064907492eIPbycJK6Mk'; // 배송완료
var TPL_CANCEL    = 'KA01TP260420064944290l6Rv4uFM5yE'; // 주문취소

// ── POST 진입점 (대용량 데이터) ──────────────────────
function doPost(e) {
  var action = e.parameter.action || '';
  var body = {};
  try { body = JSON.parse((e.postData && e.postData.contents) || '{}'); } catch(ex) {}
  if (action === 'export_menu')      return exportMenu(null, body.data || []);
  if (action === 'export_all_menus') return exportAllMenus(null, body.data || []);
  if (action === 'save_settings')    return saveSettings(null, body.data || {});
  return json({ success: false, error: '알 수 없는 POST 액션' });
}

// ── GET 진입점 ──────────────────────────────────────
function doGet(e) {
  var action   = e.parameter.action   || 'sms';
  var receiver = e.parameter.receiver || '';
  var msg      = e.parameter.msg      || '';

  // 접속 로그
  if (action === 'log_access') return logAccess(e);

  // 날짜 목록 조회
  if (action === 'list_dates') return listDates();

  // 설정 저장/로드
  if (action === 'save_settings') return saveSettings(e);
  if (action === 'load_settings') return loadSettings();

  // 전체 메뉴 저장/로드
  if (action === 'export_all_menus') return exportAllMenus(e);
  if (action === 'import_all_menus') return importAllMenus();

  // 구글 시트 내보내기
  if (action === 'export_menu') return exportMenu(e);

  // 구글 시트 가져오기
  if (action === 'import_menu') return importMenu(e);

  // 알림톡 발송
  if (action === 'alimtalk') {
    var tplId = e.parameter.tplId || '';
    var vars  = {};
    try { vars = JSON.parse(decodeURIComponent(e.parameter.vars || '{}')); } catch(e2) {}
    return sendAlimtalk(receiver, tplId, vars, msg);
  }

  // SMS 발송 (기본)
  return sendSms(receiver, msg);
}

// ── 알림톡 발송 ──────────────────────────────────────
function sendAlimtalk(receiver, tplId, vars, fallbackMsg) {
  try {
    receiver = receiver.replace(/[^0-9]/g, '');
    if (!receiver || receiver.length < 10) return result(false, '전화번호 형식 오류');
    if (!tplId) return result(false, '템플릿 ID 없음');

    var auth = getAuth();

    // 변수 형식 변환: {고객명: '홍길동'} → {'#{고객명}': '홍길동'}
    var kakaoVars = {};
    Object.keys(vars).forEach(function(k) {
      kakaoVars['#{' + k + '}'] = vars[k];
    });

    var payload = JSON.stringify({
      message: {
        to:   receiver,
        from: SENDER,
        text: fallbackMsg || '',   // 알림톡 실패 시 SMS 대체 발송
        kakaoOptions: {
          pfId:       PFID,
          templateId: tplId,
          variables:  kakaoVars
        }
      }
    });

    var res = UrlFetchApp.fetch('https://api.solapi.com/messages/v4/send', {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json; charset=utf-8',
        'Authorization': auth
      },
      payload:            payload,
      muteHttpExceptions: true
    });

    var code = res.getResponseCode();
    var body = res.getContentText();
    Logger.log('알림톡 응답: ' + code + ' / ' + body);

    if (code === 200) {
      return result(true, '알림톡 발송 완료');
    } else {
      var err = JSON.parse(body);
      return result(false, err.errorMessage || err.message || 'HTTP ' + code);
    }
  } catch(err) {
    Logger.log('알림톡 오류: ' + err.message);
    return result(false, err.message);
  }
}

// ── SMS 발송 ──────────────────────────────────────────
function sendSms(receiver, msg) {
  try {
    receiver = receiver.replace(/[^0-9]/g, '');
    if (!receiver || receiver.length < 10) return result(false, '전화번호 형식 오류');
    if (!msg) return result(false, '메시지 없음');

    var auth = getAuth();

    var res = UrlFetchApp.fetch('https://api.solapi.com/messages/v4/send', {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json; charset=utf-8',
        'Authorization': auth
      },
      payload: JSON.stringify({
        message: { to: receiver, from: SENDER, text: msg }
      }),
      muteHttpExceptions: true
    });

    var code = res.getResponseCode();
    var body = res.getContentText();
    Logger.log('SMS 응답: ' + code + ' / ' + body);

    if (code === 200) {
      return result(true, '발송 완료');
    } else {
      var err = JSON.parse(body);
      return result(false, err.errorMessage || err.message || 'HTTP ' + code);
    }
  } catch(err) {
    Logger.log('SMS 오류: ' + err.message);
    return result(false, err.message);
  }
}

// ── HMAC 인증 헤더 생성 ───────────────────────────────
function getAuth() {
  var props     = PropertiesService.getScriptProperties();
  var API_KEY    = props.getProperty('SOLAPI_KEY');
  var API_SECRET = props.getProperty('SOLAPI_SECRET');
  var dateTime  = new Date().toISOString();
  var salt      = Utilities.getUuid().replace(/-/g, '');
  var signBytes = Utilities.computeHmacSha256Signature(
    dateTime + salt, API_SECRET, Utilities.Charset.UTF_8
  );
  var signature = signBytes.map(function(b) {
    return ('0' + (b < 0 ? b + 256 : b).toString(16)).slice(-2);
  }).join('');
  return 'HMAC-SHA256 apiKey=' + API_KEY + ', date=' + dateTime + ', salt=' + salt + ', signature=' + signature;
}

// ── 공통 응답 ─────────────────────────────────────────
function result(success, message) {
  return ContentService
    .createTextOutput(JSON.stringify({ success: success, message: message }))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── 테스트 ────────────────────────────────────────────
function testSms() {
  var res = doGet({ parameter: { action: 'sms', receiver: '01026989056', msg: '[온반] SMS 테스트' } });
  Logger.log(res.getContent());
}

function testAlimtalk() {
  var res = doGet({ parameter: {
    action:   'alimtalk',
    receiver: '01026989056',
    tplId:    TPL_ORDER,
    vars:     encodeURIComponent(JSON.stringify({ '고객명': '테스트', '메뉴목록': '한우육전 1개', '금액': '10' })),
    msg:      '[오늘의 반찬] 테스트 주문 접수'
  }});
  Logger.log(res.getContent());
}
