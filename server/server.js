require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const mysql   = require('mysql2/promise');
const path    = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

// 주의: 이 서버는 자기 자신도 정적 HTML을 서빙한다(express.static). 그래서 Railway 주소로
// 관리자 화면을 열 수 있는데, 그때 브라우저는 읽기(GET)에는 Origin을 안 붙이지만
// 쓰기(POST·PUT·DELETE)에는 같은 주소여도 반드시 붙인다. 여기에 자기 주소가 없으면
// "읽기는 되는데 저장·삭제만 전부 실패"하는 형태로 나타난다.
const ALLOWED_ORIGINS = [
  'https://giths-ops.github.io',                    // 프로덕션 GitHub Pages
  'https://myfood01-production.up.railway.app',     // 이 서버 자신 (정적 HTML 직접 접속용)
  'http://localhost:3000',                          // 로컬 개발
  'http://127.0.0.1:3000',
  'http://localhost:5174',                          // npx serve -l 5174 (ONBOARDING.md 기준)
  'http://127.0.0.1:5174',
  'http://localhost:5500',                          // VS Code Live Server
  'http://127.0.0.1:5500',
];
app.use(cors({
  origin: function(origin, cb) {
    // curl / 서버간 호출 등 origin 없는 경우 허용
    if (!origin) return cb(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    cb(new Error('CORS blocked: ' + origin));
  },
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// HTML 정적 파일 서빙 (repo 루트)
app.use(express.static(path.join(__dirname, '..')));

// ── DB 연결 풀 ──────────────────────────────────────────────
const pool = mysql.createPool({
  host:              process.env.MYSQLHOST     || process.env.MYSQL_HOST,
  port:              Number(process.env.MYSQLPORT     || process.env.MYSQL_PORT) || 3306,
  user:              process.env.MYSQLUSER     || process.env.MYSQL_USER,
  password:          process.env.MYSQLPASSWORD || process.env.MYSQL_PASSWORD,
  database:          process.env.MYSQLDATABASE || process.env.MYSQL_DATABASE,
  waitForConnections: true,
  connectionLimit:   10,
  timezone:          '+09:00',
  charset:           'utf8mb4'
});

const ok  = (res, data={}) => res.json({ success: true,  ...data });
const err = (res, msg, status=500) => res.status(status).json({ success: false, error: msg });

// ── 관리자 인증 ─────────────────────────────────────────────
// Railway 환경변수 ADMIN_TOKEN 설정 필요. 관리자 전용 API는 X-Admin-Token 헤더로 검증.
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
function requireAdmin(req, res, next) {
  if (!ADMIN_TOKEN) return err(res, '서버에 ADMIN_TOKEN이 설정되지 않았습니다.', 500);
  if (req.headers['x-admin-token'] !== ADMIN_TOKEN) return err(res, '인증이 필요합니다.', 401);
  next();
}
const toKSTDateStr = d => {
  if (!d) return null;
  if (d instanceof Date) { const kst=new Date(d.getTime()+9*60*60*1000); return kst.toISOString().slice(0,10); }
  return String(d).slice(0,10);
};

// ── SSE 클라이언트 풀 ─────────────────────────────────────────
const sseClients = new Set();
function broadcast(type, payload={}) {
  const msg = `data: ${JSON.stringify({ type, ...payload })}\n\n`;
  for (const r of sseClients) { try { r.write(msg); } catch(e) { sseClients.delete(r); } }
}

// ── GAS 알림 발송 헬퍼 (fire-and-forget) ─────────────────────
async function _getNotifySettings() {
  const [rows] = await pool.execute(
    "SELECT k,v FROM settings WHERE k IN ('gasUrl','smsEnabled','alimtalkEnabled','adminPhone','phone','deliveryPhone','notifyEvents')"
  );
  const s = {};
  rows.forEach(r => { s[r.k] = r.v; });
  return s;
}
// 발송 결과를 settings.lastNotify 에 남긴다.
// 예전에는 실패해도 아무 기록이 없어서, 알림이 안 나가는 것을 몇 달간 아무도 몰랐다.
// 전화번호는 뒤 4자리만 남긴다.
async function _recordNotify(obj, key) {
  try {
    const v = JSON.stringify(Object.assign({ at: new Date().toISOString() }, obj));
    await pool.execute(
      'INSERT INTO settings (k,v) VALUES (?,?) ON DUPLICATE KEY UPDATE v=?',
      [key || 'lastNotify', v, v]
    );
  } catch(e) {}
}
function _mask(p) { const s = String(p||''); return s ? '****' + s.slice(-4) : '(없음)'; }

function _gasCall(url, params) {
  const qs = Object.entries(params)
    .map(([k,v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  fetch(url + '?' + qs, { redirect: 'follow' })
    .then(r => r.text().then(t => ({ status: r.status, body: t.slice(0, 300) })))
    .then(r => _recordNotify({
      step: 'sent', action: params.action || 'sms', to: _mask(params.receiver),
      httpStatus: r.status, response: r.body
    }))
    .catch(e => _recordNotify({
      step: 'failed', action: params.action || 'sms', to: _mask(params.receiver),
      error: String((e && e.message) || e)
    }));
}
function _sms(phone, msg, url, ns) {
  // 알림톡과 마찬가지로 건너뛴 이유를 남긴다
  if (!phone) { _recordNotify({ step: 'skipped', action: 'sms', reason: '받는 번호가 없음' }); return; }
  if (!msg)   { _recordNotify({ step: 'skipped', action: 'sms', reason: '보낼 내용이 비어 있음' }); return; }
  if (!url)   { _recordNotify({ step: 'skipped', action: 'sms', reason: 'settings.gasUrl 이 비어 있음' }); return; }
  if (String(ns.smsEnabled ?? 'true') === 'false') {
    _recordNotify({ step: 'skipped', action: 'sms', reason: 'smsEnabled 가 false (설정으로 꺼둔 상태)' }); return;
  }
  _gasCall(url, { receiver: String(phone).replace(/[^0-9]/g,''), msg });
}
function _alimtalk(phone, tplId, vars, fallback, url, ns) {
  // 왜 안 나갔는지 알 수 있도록 건너뛴 이유도 남긴다
  if (!phone) { _recordNotify({ step: 'skipped', reason: '주문에 전화번호가 없음' }); return; }
  if (!url)   { _recordNotify({ step: 'skipped', reason: 'settings.gasUrl 이 비어 있음' }); return; }
  if (String(ns.alimtalkEnabled ?? 'true') === 'false') {
    _recordNotify({ step: 'skipped', reason: 'alimtalkEnabled 가 false' }); return;
  }
  _gasCall(url, { action: 'alimtalk', receiver: phone, tplId, vars: JSON.stringify(vars), msg: fallback || '' });
}
// 고객 알림톡을 "어느 시점에" 보낼지 — settings.notifyEvents 배열로 제어.
// 주문 시점에 카톡이 가면 고객이 그 대화방에서 답장해 옛 주문 방식으로 되돌아가므로,
// 기본값은 거래가 끝난 뒤인 배송완료 하나뿐이다.
// 쓸 수 있는 값: 'order'(주문접수) 'confirmed'(접수완료) 'delivered'(배송완료) 'cancelled'(주문취소) 'reply'(관리자 답변)
function _notifyAllowed(ns, event) {
  let list = null;
  try { list = typeof ns.notifyEvents === 'string' ? JSON.parse(ns.notifyEvents) : ns.notifyEvents; } catch { list = null; }
  if (!Array.isArray(list)) list = ['delivered'];
  return list.includes(event);
}
function _notifyOrder(order, isReorder) {
  (async () => {
    try {
      const ns  = await _getNotifySettings();
      const url = (ns.gasUrl || '').trim();
      if (!url) return;
      const items    = typeof order.items === 'string' ? JSON.parse(order.items) : (order.items || []);
      const menuList = items.map(i => `${i.name} ${i.qty||1}개`).join(', ');
      const total    = order.total || 0;
      const tplId    = isReorder
        ? 'KA01TP260522215451814ICITJ2ltD6g'
        : 'KA01TP260522043036061jyoL3rs2iVT';
      const fallback = `[오늘의 반찬] ${order.name}님, ${isReorder?'재주문':'주문'}이 접수됐습니다! ${menuList} 합계: ${Number(total).toLocaleString()}천원`;
      if (_notifyAllowed(ns, 'order')) {
        _alimtalk(order.phone, tplId, { 이름: order.name||'', 메뉴목록: menuList, 금액: String(total) }, fallback, url, ns);
      }
      // 관리자 화면은 업주 번호를 'phone' 키로 저장하는데 여기서는 'adminPhone'을 읽고 있었다 → 둘 다 인정
      const ownerPhone = ns.adminPhone || ns.phone;
      if (ownerPhone) {
        const label = isReorder ? '재주문' : '새 주문';
        const adminMsg = `[오늘의 반찬] ${label}! ${order.name}${order.phone?' ('+order.phone+')':''} ${menuList} 합계: ${Number(total).toLocaleString()}천원${order.memo?' 배송:'+order.memo:''}${order.additionalRequest?' 요청:'+order.additionalRequest:''}`;
        _sms(ownerPhone, adminMsg, url, ns);
      }
    } catch(e) {}
  })();
}
// 주문이 바뀐 내역을 답변 필드에 쌓는다.
// 최초 주문 문자와 실제 주문이 달라지면 입금 대조가 안 되므로, 무엇이 언제 바뀌었는지
// 남겨 거래 증명으로 쓴다. 이 내용은 고객 주문내역에도 그대로 보인다.
async function _appendOrderLog(orderId, lines) {
  if (!lines || !lines.length) return;
  try {
    const [[o]] = await pool.execute('SELECT admin_reply FROM orders WHERE id=?', [orderId]);
    if (!o) return;
    const stamp = new Date(Date.now() + 9*60*60*1000).toISOString().replace('T', ' ').slice(0, 16);
    const entry = `[${stamp}] ` + lines.join(' / ');
    const prev  = (o.admin_reply || '').trim();
    await pool.execute(
      'UPDATE orders SET admin_reply=?, reply_at=NOW() WHERE id=?',
      [prev ? prev + '\n' + entry : entry, orderId]
    );
    broadcast('order_reply', { orderId });
  } catch(e) {}
}

// 주문이 바뀌면 업주에게 '지금 상태'로 문자를 다시 보낸다.
// 최초 주문 문자만 남아 있으면 실제 주문과 어긋나 입금 대조가 안 된다.
function _notifyOwnerChange(orderId, label, lines) {
  (async () => {
    try {
      const ns  = await _getNotifySettings();
      const url = (ns.gasUrl || '').trim();
      if (!url) return;
      const ownerPhone = ns.adminPhone || ns.phone;
      if (!ownerPhone) return;
      const [[o]] = await pool.execute(
        'SELECT name,phone,memo,items,total FROM orders WHERE id=?', [orderId]);
      if (!o) return;
      const items    = typeof o.items === 'string' ? JSON.parse(o.items) : (o.items || []);
      const menuList = items.map(i => `${i.name} ${i.qty||1}개`).join(', ');
      const msg = `[오늘의 반찬] ${label}! ${o.name}${o.phone ? ' ('+o.phone+')' : ''} ${menuList}`
        + ` 합계: ${Number(o.total||0).toLocaleString()}천원`
        + (lines && lines.length ? ` / 변경: ${lines.join(', ')}` : '')
        + (o.memo ? ` 배송:${o.memo}` : '');
      _sms(ownerPhone, msg, url, ns);
    } catch(e) {}
  })();
}

function _notifyStatus(orderId, status) {
  (async () => {
    try {
      const ns  = await _getNotifySettings();
      const url = (ns.gasUrl || '').trim();
      // 어떤 주문의 어떤 상태에서 알림을 시도했는지 따로 남긴다 —
      // 발송 기록(lastNotify)과 짝을 맞춰 보면 어디서 끊겼는지 알 수 있다
      _recordNotify({
        orderId, status,
        gasUrl: !!url,
        alimtalkEnabled: String(ns.alimtalkEnabled ?? 'true') !== 'false',
        notifyEvents: ns.notifyEvents || '(미설정→기본 delivered)',
        allowed: _notifyAllowed(ns, status)
      }, 'lastNotifyTrigger');
      if (!url) return;
      const [[o]] = await pool.execute(
        'SELECT phone,name,total,addr,memo,additional_request,items FROM orders WHERE id=?', [orderId]
      );
      if (!o) return;
      const items    = typeof o.items === 'string' ? JSON.parse(o.items) : (o.items || []);
      const menuList = items.map(i => `${i.name} ${i.qty||1}개`).join(', ');
      if (status === 'confirmed') {
        if (_notifyAllowed(ns, 'confirmed')) {
          _alimtalk(o.phone, 'KA01TP260522043220298Ev0vb3LtcjG',
            { 이름: o.name, 메뉴목록: menuList, 금액: String(o.total||0) },
            `[오늘의 반찬] ${o.name}님, 배송업체에 요청했습니다! ${menuList} 합계: ${Number(o.total||0).toLocaleString()}천원`, url, ns);
        }
        // 배송업체 문자는 두 가지로 관리한다 —
        //   ① 설정 페이지의 SMS 토글(smsEnabled)로 전체 on/off
        //   ② 배송업체 번호를 비워두면 이 문자만 안 나감
        if (ns.deliveryPhone) {
          const delivMsg = `[오늘의 반찬] 배송 요청 / ${o.name}${o.phone?' '+o.phone:''}`
            + (o.addr ? ' / ' + o.addr : '')
            + ' / ' + menuList
            + (o.memo ? ' / 배송:' + (o.memo||'').split(' / ')[0].trim() : '')
            + (o.additional_request ? ' / 요청:' + o.additional_request : '');
          _sms(ns.deliveryPhone, delivMsg, url, ns);
        }
      } else if (status === 'delivered') {
        if (_notifyAllowed(ns, 'delivered')) {
          _alimtalk(o.phone, 'KA01TP260522043333235AUBreysEIxj',
            { 이름: o.name },
            `[오늘의 반찬] ${o.name}님, 배송이 완료됐습니다! 맛있게 드세요 😊`, url, ns);
        }
      } else if (status === 'cancelled') {
        if (_notifyAllowed(ns, 'cancelled')) {
          _alimtalk(o.phone, 'KA01TP2605220434459714HrsH0pRr0l',
            { 이름: o.name },
            `[오늘의 반찬] ${o.name}님, 주문이 취소됐습니다.`, url, ns);
        }
      }
    } catch(e) {}
  })();
}

// SSE 연결 (GET /api/events)
app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  res.write(':connected\n\n');
  sseClients.add(res);
  // 25초 heartbeat (Railway 30분 타임아웃 대비)
  const hb = setInterval(() => { try { res.write(':\n\n'); } catch(e) { clearInterval(hb); } }, 25000);
  req.on('close', () => { clearInterval(hb); sseClients.delete(res); });
});

// ── 헬스체크 ────────────────────────────────────────────────
// build 표식 — 설정을 바꾸기 전에 배포가 실제로 반영됐는지 확인하는 용도
app.get('/health', (req, res) => res.json({ ok: true, build: 'cart-page-close-btn-1' }));

// ══════════════════════════════════════════════════════════════
// 메뉴 창고 (등록된모든메뉴)
// ══════════════════════════════════════════════════════════════

// 전체 메뉴 저장 (parse_onban_menu.py → POST /api/menu/all)
app.post('/api/menu/all', requireAdmin, async (req, res) => {
  try {
    const list = req.body.data || req.body;
    if (!Array.isArray(list) || !list.length) return err(res, '데이터 없음', 400);
    const conn = await pool.getConnection();
    await conn.beginTransaction();
    try {
      // menuId 있으면 id 기준 UPDATE(이름 변경=rename 포함), 없으면 신규 INSERT
      // → menus.id가 진짜 키. 이름을 바꿔도 같은 행을 갱신(중복 생성 방지)
      for (const m of list) {
        const catId = await _resolveCatId(conn, m.cat || '기타');
        if (m.menuId) {
          await conn.execute(
            `UPDATE menus SET name=?,cat=?,cat_id=?,price=?,stock=?,child=?,img_url=?,icon=?,menu_desc=?,count=?,updated_at=? WHERE id=?`,
            [m.name, m.cat||'기타', catId, m.price||0, m.stock||0, m.child?1:0, m.imgUrl||'', m.icon||'', m.desc||'', m.count||0, m.updatedAt||0, m.menuId]
          );
          // rename 전파: 연결된 daily_menus의 비정규화 name도 갱신(옛 이름 잔존·중복 방지)
          await conn.execute(
            `UPDATE daily_menus SET name=? WHERE menu_id=? AND name<>?`,
            [m.name, m.menuId, m.name]
          );
        } else {
          await conn.execute(
            `INSERT INTO menus (name,cat,cat_id,price,stock,child,img_url,icon,menu_desc,count,updated_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?)
             ON DUPLICATE KEY UPDATE cat=VALUES(cat),cat_id=VALUES(cat_id),price=VALUES(price),stock=VALUES(stock),
               child=VALUES(child),img_url=VALUES(img_url),icon=VALUES(icon),menu_desc=VALUES(menu_desc),
               count=VALUES(count),updated_at=VALUES(updated_at)`,
            [m.name, m.cat||'기타', catId, m.price||0, m.stock||0, m.child?1:0, m.imgUrl||'', m.icon||'', m.desc||'', m.count||0, m.updatedAt||0]
          );
        }
      }
      // 전송 목록(메뉴 창고 전체)에 없는 마스터는 삭제 (창고 전체 동기화)
      // 단, 일자별 목록(daily_menus)이 참조 중인 메뉴는 보존 — 삭제 차단 정책
      const names = list.map(m => m.name);
      const ph = names.map(()=>'?').join(',');
      await conn.execute(
        `DELETE FROM menus WHERE name NOT IN (${ph}) AND name NOT IN (SELECT DISTINCT name FROM daily_menus)`,
        names
      );
      await conn.commit(); conn.release();
      ok(res, { count: list.length });
    } catch(e) { await conn.rollback(); conn.release(); throw e; }
  } catch(e) { err(res, e.message); }
});

// 마스터 단건 수정 (POST /api/menu/master/update)
// 전체 목록 동기화(POST /api/menu/all)와 달리 딱 한 행만 갱신 — 다른 마스터 항목은 전혀 건드리지 않음
app.post('/api/menu/master/update', requireAdmin, async (req, res) => {
  try {
    const body = req.body.data || req.body;
    const id = body.id || 0;
    if (!id) return err(res, '메뉴 id가 필요합니다.', 400);
    const name = String(body.name || '').trim();
    if (!name) return err(res, '메뉴명을 입력해주세요.', 400);
    const cat = String(body.cat || '기타').trim() || '기타';

    const conn = await pool.getConnection();
    try {
      const catId = await _resolveCatId(conn, cat);
      const [result] = await conn.execute(
        `UPDATE menus SET name=?,cat=?,cat_id=?,price=?,stock=?,child=?,img_url=?,icon=?,menu_desc=?,updated_at=? WHERE id=?`,
        [name, cat, catId, Number(body.price) || 0, Number(body.stock) || 0, body.child ? 1 : 0, body.imgUrl || '', body.icon || '', body.desc || '', Date.now(), id]
      );
      if (!result.affectedRows) { conn.release(); return err(res, '해당 메뉴를 찾을 수 없습니다.', 404); }
      // rename 전파: 연결된 daily_menus의 비정규화 name도 갱신
      await conn.execute(`UPDATE daily_menus SET name=? WHERE menu_id=? AND name<>?`, [name, id, name]);
      conn.release();
      ok(res, { updated: true });
    } catch (e) { conn.release(); throw e; }
  } catch (e) { err(res, e.message); }
});

// 마스터 병합 (POST /api/menu/master/merge)
// source를 target으로 합침: daily_menus를 target으로 재연결 후 source 삭제
app.post('/api/menu/master/merge', requireAdmin, async (req, res) => {
  try {
    const body = req.body.data || req.body;
    const sourceId = body.sourceId || 0, sourceName = body.sourceName || '';
    const targetId = body.targetId || 0, targetName = body.targetName || '';
    if ((!sourceId && !sourceName) || (!targetId && !targetName)) return err(res, '병합 대상 부족', 400);
    if (sourceId && targetId && sourceId === targetId) return err(res, '같은 메뉴', 400);
    const conn = await pool.getConnection();
    await conn.beginTransaction();
    try {
      // 1) target의 진짜 id 확보(없으면 name으로 조회)
      let tId = targetId;
      if (!tId) { const [[r]] = await conn.execute('SELECT id FROM menus WHERE name=?', [targetName]); tId = r ? r.id : 0; }
      if (!tId) { await conn.rollback(); conn.release(); return err(res, 'target 없음', 404); }
      // 2) source를 참조(menu_id 또는 name)하는 daily_menus를 target으로 재연결 + 이름 통일
      await conn.execute(
        'UPDATE daily_menus SET menu_id=?, name=? WHERE menu_id=? OR name=?',
        [tId, targetName, sourceId || 0, sourceName]
      );
      // 3) source 마스터 삭제 (id 우선, 없으면 name)
      await conn.execute('DELETE FROM menus WHERE (id=? OR name=?) AND id<>?', [sourceId || 0, sourceName, tId]);
      await conn.commit(); conn.release();
      ok(res, { merged: true, targetId: tId });
    } catch(e) { await conn.rollback(); conn.release(); throw e; }
  } catch(e) { err(res, e.message); }
});

// 마스터 단건 삭제 (POST /api/menu/master/delete)
// force:true 이면 daily_menus에서도 제거 후 강제 삭제
app.post('/api/menu/master/delete', requireAdmin, async (req, res) => {
  try {
    const body = req.body.data || req.body;
    const id = body.id || 0, name = body.name || '';
    const force = !!body.force;
    if (!force) {
      const [dates] = await pool.execute(
        "SELECT DISTINCT DATE_FORMAT(date,'%Y-%m-%d') AS d FROM daily_menus WHERE menu_id=? OR name=? ORDER BY d DESC",
        [id, name]
      );
      if (dates.length) {
        return res.json({ success: false, blocked: true, dates: dates.map(r => r.d) });
      }
    } else {
      await pool.execute('DELETE FROM daily_menus WHERE menu_id=? OR name=?', [id, name]);
    }
    await pool.execute('DELETE FROM menus WHERE id=? OR name=?', [id, name]);
    ok(res, { deleted: true });
  } catch(e) { err(res, e.message); }
});

// 전체 메뉴 조회 (GET /api/menu/all)
app.get('/api/menu/all', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT id AS menuId,name,cat,price,stock,child,img_url AS imgUrl,icon,menu_desc AS `desc`,count,updated_at AS updatedAt FROM menus ORDER BY count DESC, name'
    );
    const menus = rows.map(r => ({ ...r, child: !!r.child, price: Number(r.price||0) }));
    ok(res, { menus });
  } catch(e) { err(res, e.message); }
});

// ══════════════════════════════════════════════════════════════
// 날짜별 메뉴
// ══════════════════════════════════════════════════════════════

// 날짜 목록 (GET /api/dates)
app.get('/api/dates', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      "SELECT DISTINCT DATE_FORMAT(date,'%Y-%m-%d') AS d FROM daily_menus ORDER BY d DESC"
    );
    ok(res, { dates: rows.map(r => r.d) });
  } catch(e) { err(res, e.message); }
});

// 특정 날짜 메뉴 조회 (GET /api/menu/:date)
app.get('/api/menu/:date', async (req, res) => {
  try {
    // 정적 속성(이름·카테고리·사진·설명)은 마스터(menus)에서 가져옴. menu_id 없는 레거시 행은 daily 값으로 폴백
    const [rows] = await pool.execute(
      // m: menu_id 링크, m2: name 링크(폴백). desc/정적속성은 둘 중 먼저 매칭되는 master값 사용.
      // menuId는 재고연산 정합성 위해 daily에 저장된 d.menu_id를 그대로 반환.
      `SELECT d.menu_id AS menuId,
         COALESCE(m.name,m2.name,d.name) AS name,
         COALESCE(m.cat,m2.cat,d.cat) AS cat,
         COALESCE(m.price,m2.price,d.price) AS price,
         d.stock,
         COALESCE(m.child,m2.child,d.child) AS child,
         COALESCE(m.img_url,m2.img_url) AS imgUrl,
         COALESCE(m.icon,m2.icon) AS icon,
         COALESCE(m.menu_desc,m2.menu_desc) AS \`desc\`
       FROM daily_menus d
       LEFT JOIN menus m  ON m.id=d.menu_id
       LEFT JOIN menus m2 ON m2.name=d.name
       WHERE d.date=? ORDER BY d.id`,
      [req.params.date]
    );
    if (!rows.length) return err(res, `${req.params.date} 메뉴 없음`, 404);
    const menus = rows.map(r => ({ ...r, child: !!r.child, price: Number(r.price||0) }));
    ok(res, { date: req.params.date, menus });
  } catch(e) { err(res, e.message); }
});

// 날짜별 메뉴 일괄 저장 (POST /api/menu/daily)
app.post('/api/menu/daily', requireAdmin, async (req, res) => {
  try {
    const list = req.body.data || req.body;
    const clearDate = req.body.date || null;
    if (!Array.isArray(list)) return err(res, '데이터 없음', 400);
    if (!list.length && !clearDate) return err(res, '데이터 없음', 400);

    // 날짜별로 그룹화
    const byDate = {};
    list.forEach(m => {
      if (!byDate[m.date]) byDate[m.date] = [];
      byDate[m.date].push(m);
    });
    // 목록이 비어도 date가 지정되면 해당 날짜를 빈 목록으로 저장(전체 삭제) 허용
    if (clearDate && !byDate[clearDate]) byDate[clearDate] = [];

    const conn = await pool.getConnection();
    await conn.beginTransaction();
    const dates = Object.keys(byDate);
    for (const date of dates) {
      // 저장 도중 들어온 주문의 재고 차감이 되돌아가지 않도록, 지우기 전에 현재 재고를 읽어둔다.
      // 화면이 보낸 baseStock(불러온 시점의 재고)과 비교해 관리자가 실제로 바꾼 만큼만 현재 재고에 반영.
      const [prevRows] = await conn.execute('SELECT menu_id,name,stock FROM daily_menus WHERE date=?', [date]);
      const prevById = {}, prevByName = {};
      prevRows.forEach(r => {
        if (r.menu_id != null && prevById[r.menu_id] === undefined) prevById[r.menu_id] = Number(r.stock);
        if (prevByName[r.name] === undefined) prevByName[r.name] = Number(r.stock);
      });
      const resolveStock = (m, menuId) => {
        const want = (m.stock == null) ? 0 : Number(m.stock);
        if (want === -1) return -1;              // 준비중은 수량이 아니라 상태 → 그대로 적용
        if (m.baseStock == null) return want;    // 화면에서 새로 추가된 메뉴 → 그대로
        let cur = null;
        if (menuId != null && prevById[menuId] !== undefined) cur = prevById[menuId];
        else if (prevByName[m.name] !== undefined)            cur = prevByName[m.name];
        if (cur === null) return want;           // 그날 목록에 없던 메뉴 → 그대로
        const delta = want - Number(m.baseStock);
        if (delta === 0) return cur;             // 관리자가 손대지 않음 → DB 현재 재고 유지
        return Math.max(0, cur + delta);
      };

      await conn.execute('DELETE FROM daily_menus WHERE date=?', [date]);
      for (const m of byDate[date]) {
        const catId = await _resolveCatId(conn, m.cat || '기타');
        // 마스터 갱신 → menu_id 확보. menuId 있으면 id 기준 UPDATE(rename 포함), 없으면 신규 INSERT
        let menuId = m.menuId || null;
        if (menuId) {
          // menu_desc는 master 전용 — 일일 저장이 덮어쓰지 않음(정합성 보호)
          await conn.execute(
            `UPDATE menus SET name=?,cat=?,cat_id=?,price=?,child=?,img_url=?,updated_at=? WHERE id=?`,
            [m.name, m.cat||'기타', catId, m.price||0, m.child?1:0, m.imgUrl||'', m.updatedAt||Date.now(), menuId]
          );
        } else {
          // 신규행만 desc 초기값 적용. 기존행(중복키) menu_desc는 보호(덮어쓰지 않음)
          await conn.execute(
            `INSERT INTO menus (name,cat,cat_id,price,child,img_url,menu_desc,updated_at)
             VALUES (?,?,?,?,?,?,?,?)
             ON DUPLICATE KEY UPDATE cat=VALUES(cat),cat_id=VALUES(cat_id),price=VALUES(price),child=VALUES(child),
               img_url=VALUES(img_url),updated_at=VALUES(updated_at)`,
            [m.name, m.cat||'기타', catId, m.price||0, m.child?1:0, m.imgUrl||'', m.desc||'', m.updatedAt||Date.now()]
          );
          // 이름만으로 찾으면 같은 이름의 다른 카테고리(예: 부대찌개 메인/밀키트)에 잘못 연결된다.
          // 바로 위 INSERT가 (이름,카테고리)로 넣었으므로 같은 조건으로 찾는다.
          const [[mrow]] = await conn.execute('SELECT id FROM menus WHERE name=? AND cat=?', [m.name, m.cat||'기타']);
          menuId = mrow ? mrow.id : null;
        }
        // 일자별: menu_id + 폴백용 기존 컬럼 동시 저장
        await conn.execute(
          'INSERT INTO daily_menus (date,menu_id,name,cat,cat_id,price,stock,child) VALUES (?,?,?,?,?,?,?,?)',
          [date, menuId, m.name, m.cat||'기타', catId, m.price||0, resolveStock(m, menuId), m.child?1:0]
        );
      }
    }
    await conn.commit();
    conn.release();
    ok(res, { sheets: dates.length, count: list.length });
  } catch(e) { err(res, e.message); }
});

// 특정 날짜 재고 업데이트 (PUT /api/menu/:date/stock)
app.put('/api/menu/:date/stock', requireAdmin, async (req, res) => {
  try {
    const { name, stock, menuId } = req.body;
    const byId = menuId != null;
    await pool.execute(
      byId ? 'UPDATE daily_menus SET stock=? WHERE date=? AND menu_id=?'
           : 'UPDATE daily_menus SET stock=? WHERE date=? AND name=?',
      [stock, req.params.date, byId ? menuId : name]
    );
    ok(res);
  } catch(e) { err(res, e.message); }
});

// 재고 증감 (POST /api/menu/:date/stock-adjust)  delta = +N/-N
app.post('/api/menu/:date/stock-adjust', requireAdmin, async (req, res) => {
  try {
    const items = req.body.items || [];
    if (!items.length) return ok(res);
    const conn = await pool.getConnection();
    await conn.beginTransaction();
    for (const it of items) {
      const byId = it.menuId != null;
      await conn.execute(
        byId ? 'UPDATE daily_menus SET stock = GREATEST(0, stock + ?) WHERE date=? AND menu_id=?'
             : 'UPDATE daily_menus SET stock = GREATEST(0, stock + ?) WHERE date=? AND name=?',
        [it.delta, req.params.date, byId ? it.menuId : it.name]
      );
    }
    await conn.commit();
    conn.release();
    ok(res);
  } catch(e) { err(res, e.message); }
});

// ══════════════════════════════════════════════════════════════
// 주문
// ══════════════════════════════════════════════════════════════

// 주문 조회 (GET /api/orders?date=&phone=)
app.get('/api/orders', async (req, res) => {
  try {
    const { date, phone, name, deviceId, reserved, reservedFrom, createdOn, reservedForDevice } = req.query;
    // deviceId로 본인 기기 범위 조회는 고객 자유 허용, 그 외(날짜 전체조회 등 관리자용)는 인증 필요
    if (!deviceId) {
      if (!ADMIN_TOKEN || req.headers['x-admin-token'] !== ADMIN_TOKEN) return err(res, '인증이 필요합니다.', 401);
    }
    let sql = 'SELECT * FROM orders WHERE 1=1';
    const params = [];
    if (createdOn) {
      sql += " AND status='confirmed' AND reserve_date IS NOT NULL AND DATE(created_at)=?";
      params.push(createdOn);
    } else if (reservedForDevice && deviceId) {
      // 고객 주문내역용 — 예약일자로 date가 미래로 바뀐 주문도 기기 기준으로 조회
      sql += ' AND device_id=? AND reserve_date IS NOT NULL';
      params.push(deviceId);
    } else {
      if (date)     { sql += ' AND date=?';      params.push(date); }
      if (deviceId) { sql += ' AND device_id=?'; params.push(deviceId); }
      else if (phone) { sql += ' AND phone=?';   params.push(phone); }
      else if (name)  { sql += ' AND name=?';    params.push(name); }
      if (reserved) {
        sql += " AND reserve_date IS NOT NULL AND status<>'cancelled'";
        if (reservedFrom) { sql += ' AND reserve_date >= ?'; params.push(reservedFrom); }
        else               { sql += ' AND reserve_date >= CURDATE()'; }
      }
    }
    sql += reserved ? ' ORDER BY reserve_date ASC, created_at DESC' : ' ORDER BY created_at DESC';
    const [rows] = await pool.execute(sql, params);
    // DATETIME 컬럼 → Unix ms + 9h 보정
    const toTS = d => { if(!d)return null; const ms=d instanceof Date?d.getTime():new Date(String(d).replace(' ','T')).getTime(); return isNaN(ms)?null:ms+9*60*60*1000; };
    const orders = rows.map(r => ({
      id: r.id, date: toKSTDateStr(r.date), time: r.time,
      name: r.name, phone: r.phone, addr: r.addr, memo: r.memo,
      items: typeof r.items === 'string' ? JSON.parse(r.items) : (r.items||[]),
      total: r.total, status: r.status,
      adminReply: r.admin_reply, replyAt: toTS(r.reply_at),
      additionalRequest: r.additional_request,
      addreqAcked: !!r.addreq_acked,
      isReorder: !!r.is_reorder,
      reserveDate: toKSTDateStr(r.reserve_date),
      createdDate: toKSTDateStr(r.created_at)
    }));
    ok(res, { orders });
  } catch(e) { err(res, e.message); }
});

// 묻힌 주문 요약 (GET /api/orders/pending-summary?today=YYYY-MM-DD)
// 지난 날짜에 '대기중'으로 남은 주문 = 아직 입금 확인이 안 됐고 아무도 안 본 주문.
// 알림 문자를 쓰지 않으므로, 놓친 주문을 마감 때 잡아내는 안전망 역할을 한다.
app.get('/api/orders/pending-summary', requireAdmin, async (req, res) => {
  try {
    const today = (req.query.today || '').slice(0, 10);
    if (!today) return err(res, 'today 필요', 400);
    // 예약주문은 예약일이 아직 안 지났으면 정상 대기 상태이므로 제외
    const [rows] = await pool.execute(
      `SELECT DATE_FORMAT(date,'%Y-%m-%d') AS d, COUNT(*) AS cnt, COALESCE(SUM(total),0) AS amount
         FROM orders
        WHERE status='pending' AND date < ?
          AND (reserve_date IS NULL OR reserve_date < ?)
        GROUP BY date ORDER BY d DESC LIMIT 30`,
      [today, today]
    );
    const dates = rows.map(r => ({ date: r.d, count: Number(r.cnt), amount: Number(r.amount) }));
    ok(res, {
      dates,
      totalCount:  dates.reduce((s, r) => s + r.count, 0),
      totalAmount: dates.reduce((s, r) => s + r.amount, 0)
    });
  } catch(e) { err(res, e.message); }
});

// 주문 저장/업데이트 (POST /api/orders) — 재고 차감 포함
app.post('/api/orders', async (req, res) => {
  try {
    const order = req.body.data || req.body;
    if (!order.id) return err(res, '주문 ID 없음', 400);

    // 이미 존재하는 주문이면 상태만 업데이트
    const [exist] = await pool.execute('SELECT id FROM orders WHERE id=?', [order.id]);
    if (exist.length) {
      if (order.status) await pool.execute('UPDATE orders SET status=? WHERE id=?', [order.status, order.id]);
      return ok(res, { action: 'updated' });
    }

    const items  = order.items || [];
    const date   = order.date;
    const isReserve = !!order.reserveDate;
    const isEventOrder = items.some(it => it.menuId === 'EVENT');

    // 같은 전화번호로 같은 날짜에 동일 예약 이벤트를 중복 신청하는 것을 방지
    if (isEventOrder && order.reserveDate && order.phone) {
      const [dupRows] = await pool.execute(
        `SELECT items FROM orders WHERE phone=? AND reserve_date=? AND status!='cancelled'`,
        [order.phone, order.reserveDate]
      );
      const hasDup = dupRows.some(r => {
        const its = typeof r.items === 'string' ? JSON.parse(r.items) : (r.items || []);
        return its.some(it => it.menuId === 'EVENT');
      });
      if (hasDup) return err(res, '이미 같은 날짜로 예약 이벤트를 신청하셨어요.', 409);
    }

    const conn   = await pool.getConnection();
    await conn.beginTransaction();
    try {
      if (!isReserve) {
        // 재고 확인 (FOR UPDATE — 동시 주문 직렬화)
        const soldOut = [];
        for (const item of items) {
          const byId = item.menuId != null;
          const [rows] = await conn.execute(
            byId ? 'SELECT stock FROM daily_menus WHERE date=? AND menu_id=? FOR UPDATE'
                 : 'SELECT stock FROM daily_menus WHERE date=? AND name=? FOR UPDATE',
            [date, byId ? item.menuId : item.name]
          );
          const stock = rows.length ? rows[0].stock : 0;
          if (stock < (item.qty || 1)) soldOut.push({ name: item.name, available: stock });
        }
        if (soldOut.length) {
          await conn.rollback(); conn.release();
          return res.json({ success: false, soldOut });
        }
        // 재고 차감
        for (const item of items) {
          const byId = item.menuId != null;
          await conn.execute(
            byId ? 'UPDATE daily_menus SET stock = stock - ? WHERE date=? AND menu_id=?'
                 : 'UPDATE daily_menus SET stock = stock - ? WHERE date=? AND name=?',
            [item.qty || 1, date, byId ? item.menuId : item.name]
          );
        }
      }

      // ── 금액 검산 ────────────────────────────────────────────
      // 화면이 보낸 금액을 그대로 믿지 않는다. 단가를 DB에서 다시 읽어 합계를 계산한다.
      // 주문 수정 API(PUT /:id/items)는 원래 이렇게 하고 있었는데 주문 생성만 빠져 있었다.
      // 단가 출처: 그날 노출 메뉴(menu_id) → 마스터(menu_id) → 그날 노출 메뉴(이름) 순.
      // 예약 이벤트처럼 어디에도 없는 항목은 화면 값을 그대로 둔다.
      const fixes = [];
      for (const item of items) {
        let dbPrice = null;
        if (item.menuId != null && item.menuId !== 'EVENT') {
          const [dr] = await conn.execute(
            'SELECT price FROM daily_menus WHERE date=? AND menu_id=? LIMIT 1', [date, item.menuId]);
          if (dr.length) dbPrice = Number(dr[0].price);
          if (dbPrice === null) {
            const [mr] = await conn.execute('SELECT price FROM menus WHERE id=? LIMIT 1', [item.menuId]);
            if (mr.length) dbPrice = Number(mr[0].price);
          }
        }
        if (dbPrice === null && item.name) {
          const [dr2] = await conn.execute(
            'SELECT price FROM daily_menus WHERE date=? AND name=? LIMIT 1', [date, item.name]);
          if (dr2.length) dbPrice = Number(dr2[0].price);
        }
        if (dbPrice !== null && Number(item.price) !== dbPrice) {
          fixes.push(`${item.name}: ${item.price}→${dbPrice}`);
          item.price = dbPrice;
        }
      }
      const itemsSum    = items.reduce((s, i) => s + (Number(i.price)||0) * (i.qty||1), 0);
      const isPickup    = String(order.memo||'').startsWith('매장픽업');
      const deliveryFee = (!isPickup && itemsSum >= 20) ? 1 : 0;
      const serverTotal = itemsSum + deliveryFee;
      if (fixes.length || Number(order.total) !== serverTotal) {
        // 화면 계산이 서버와 다르면 서버 값으로 저장하고 기록을 남긴다.
        // 조용히 덮기만 하면 화면 버그를 영영 못 찾는다.
        console.warn(`[금액검산] ${order.id} 합계 ${order.total}→${serverTotal}`
          + (fixes.length ? ` / 단가 ${fixes.join(', ')}` : ''));
      }
      order.total = serverTotal;   // 알림 문구에도 검산된 금액이 쓰이도록

      // 주문 저장
      await conn.execute(
        'INSERT INTO orders (id,date,time,name,phone,addr,memo,items,total,status,is_reorder,additional_request,device_id,reserve_date) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        [
          order.id, date, order.time||'',
          order.name||'', order.phone||'', order.addr||'', order.memo||'',
          JSON.stringify(items), serverTotal,
          order.status||'pending', order.isReorder?1:0,
          order.additionalRequest||'', order.deviceId||null,
          order.reserveDate||null
        ]
      );
      await conn.commit(); conn.release();
      broadcast('order_new', { orderId: order.id, date });
      ok(res, { action: 'inserted' });
      _notifyOrder(order, !!order.isReorder);
    } catch(e) { await conn.rollback(); conn.release(); throw e; }
  } catch(e) { err(res, e.message); }
});

// 주문 상태 변경 (PUT /api/orders/:id/status) — 취소 시 재고 복원
app.put('/api/orders/:id/status', async (req, res) => {
  try {
    const { status, deviceId } = req.body;
    if (!status) return err(res, '상태 없음', 400);
    const isAdmin = !!ADMIN_TOKEN && req.headers['x-admin-token'] === ADMIN_TOKEN;

    const conn = await pool.getConnection();
    await conn.beginTransaction();
    try {
      const [rows] = await conn.execute(
        'SELECT status, date, items, reserve_date, device_id FROM orders WHERE id=? FOR UPDATE', [req.params.id]
      );
      if (!rows.length) { await conn.rollback(); conn.release(); return err(res, '주문 없음', 404); }

      // 관리자가 아니면 본인 기기의 대기중 주문을 취소하는 경우만 허용 (그 외 상태변경은 관리자 전용)
      if (!isAdmin) {
        const ownsOrder = deviceId && rows[0].device_id && deviceId === rows[0].device_id;
        if (status !== 'cancelled' || rows[0].status !== 'pending' || !ownsOrder) {
          await conn.rollback(); conn.release();
          return err(res, '인증이 필요합니다.', 401);
        }
      }

      const prev        = rows[0].status;
      let   orderDate   = toKSTDateStr(rows[0].date) || rows[0].date;
      const items       = typeof rows[0].items === 'string' ? JSON.parse(rows[0].items) : (rows[0].items||[]);
      const reserveDate = toKSTDateStr(rows[0].reserve_date);
      const wasActive    = ['pending','confirmed','delivered'].includes(prev);
      const nowCancelled = status === 'cancelled';
      const wasCancelled = prev === 'cancelled';
      const nowActive    = ['pending','confirmed','delivered'].includes(status);
      // 예약주문 판별은 오직 reserve_date 유무로만 — 재고와 무관하게 모든 stock 조작 스킵
      const isReserveOrder = !!reserveDate;

      // 예약주문(reserve_date 보유) → confirmed: date를 reserve_date로 업데이트
      if (status === 'confirmed' && reserveDate) {
        orderDate = reserveDate;
        await conn.execute('UPDATE orders SET status=?, date=? WHERE id=?', [status, orderDate, req.params.id]);
      } else {
        await conn.execute('UPDATE orders SET status=? WHERE id=?', [status, req.params.id]);
      }

      // 취소 시 재고 복원 (menu_id 우선, 없으면 name 폴백) — 예약주문 제외
      if (wasActive && nowCancelled && !isReserveOrder) {
        for (const item of items) {
          const byId = item.menuId != null;
          await conn.execute(
            byId ? 'UPDATE daily_menus SET stock = stock + ? WHERE date=? AND menu_id=?'
                 : 'UPDATE daily_menus SET stock = stock + ? WHERE date=? AND name=?',
            [item.qty || 1, orderDate, byId ? item.menuId : item.name]
          );
        }
      }
      // 취소 해제(재주문 실패 롤백) 시 재고 재차감 (menu_id 우선, 없으면 name 폴백) — 예약주문 제외
      if (wasCancelled && nowActive && !isReserveOrder) {
        for (const item of items) {
          const byId = item.menuId != null;
          await conn.execute(
            byId ? 'UPDATE daily_menus SET stock = GREATEST(stock - ?, 0) WHERE date=? AND menu_id=?'
                 : 'UPDATE daily_menus SET stock = GREATEST(stock - ?, 0) WHERE date=? AND name=?',
            [item.qty || 1, orderDate, byId ? item.menuId : item.name]
          );
        }
      }

      await conn.commit(); conn.release();
      broadcast('order_status', { orderId: req.params.id, status, date: orderDate });
      ok(res);
      if (['confirmed','delivered','cancelled'].includes(status)) {
        _notifyStatus(req.params.id, status);
      }
      // 주문취소는 거래 내용이 사라지는 일이라 반드시 기록으로 남긴다.
      // 업주 문자는 고객이 취소했을 때만 — 관리자가 직접 취소한 건 본인이 이미 안다.
      if (status === 'cancelled' && prev !== 'cancelled') {
        const who = isAdmin ? '관리자' : '고객';
        _appendOrderLog(req.params.id, [`${who}가 주문취소`]);
        if (!isAdmin) _notifyOwnerChange(req.params.id, '고객 주문취소', null);
      }
    } catch(e) { await conn.rollback(); conn.release(); throw e; }
  } catch(e) { err(res, e.message); }
});

// 주문 항목(수량·삭제) 저장 (PUT /api/orders/:id/items) — 대기중 주문만 직접 수정, 재고 검증 후 합계는 서버가 재계산
app.put('/api/orders/:id/items', async (req, res) => {
  try {
    const { items, memo } = req.body;
    if (!Array.isArray(items) || !items.length) return err(res, '항목 없음', 400);

    const conn = await pool.getConnection();
    await conn.beginTransaction();
    try {
      const [rows] = await conn.execute(
        'SELECT status, date, items, memo, total, reserve_date FROM orders WHERE id=? FOR UPDATE', [req.params.id]
      );
      if (!rows.length) { await conn.rollback(); conn.release(); return err(res, '주문 없음', 404); }
      if (rows[0].status !== 'pending') { await conn.rollback(); conn.release(); return err(res, '대기중 주문만 수정할 수 있어요.', 409); }

      const orderDate  = toKSTDateStr(rows[0].date) || rows[0].date;
      const oldItems   = typeof rows[0].items === 'string' ? JSON.parse(rows[0].items) : (rows[0].items || []);
      const isReserve  = !!rows[0].reserve_date;
      const findOld = item => oldItems.find(i => item.menuId != null ? i.menuId === item.menuId : i.name === item.name);

      if (!isReserve) {
        // 재고 확인 (기존 수량 대비 증가분만, FOR UPDATE — 동시 주문 직렬화)
        const soldOut = [];
        for (const item of items) {
          const delta = (item.qty || 1) - (findOld(item) ? (findOld(item).qty || 0) : 0);
          if (delta <= 0) continue;
          const byId = item.menuId != null;
          const [stockRows] = await conn.execute(
            byId ? 'SELECT stock FROM daily_menus WHERE date=? AND menu_id=? FOR UPDATE'
                 : 'SELECT stock FROM daily_menus WHERE date=? AND name=? FOR UPDATE',
            [orderDate, byId ? item.menuId : item.name]
          );
          const stock = stockRows.length ? stockRows[0].stock : 0;
          if (stock < delta) soldOut.push({ name: item.name, available: stock });
        }
        if (soldOut.length) { await conn.rollback(); conn.release(); return res.json({ success: false, soldOut }); }

        // 증가/감소분 재고 반영
        for (const item of items) {
          const delta = (item.qty || 1) - (findOld(item) ? (findOld(item).qty || 0) : 0);
          if (delta === 0) continue;
          const byId = item.menuId != null;
          await conn.execute(
            byId ? 'UPDATE daily_menus SET stock = GREATEST(stock - ?, 0) WHERE date=? AND menu_id=?'
                 : 'UPDATE daily_menus SET stock = GREATEST(stock - ?, 0) WHERE date=? AND name=?',
            [delta, orderDate, byId ? item.menuId : item.name]
          );
        }
        // 완전히 삭제된 항목은 재고 복원
        for (const oldItem of oldItems) {
          const byId = oldItem.menuId != null;
          const stillExists = items.some(i => byId ? i.menuId === oldItem.menuId : i.name === oldItem.name);
          if (stillExists) continue;
          await conn.execute(
            byId ? 'UPDATE daily_menus SET stock = stock + ? WHERE date=? AND menu_id=?'
                 : 'UPDATE daily_menus SET stock = stock + ? WHERE date=? AND name=?',
            [oldItem.qty || 1, orderDate, byId ? oldItem.menuId : oldItem.name]
          );
        }
      }

      // 합계는 클라이언트 값을 신뢰하지 않고 서버가 재계산
      const finalMemo   = memo !== undefined ? (memo || '') : (rows[0].memo || '');
      const itemsSum    = items.reduce((s, i) => s + (i.price || 0) * (i.qty || 1), 0);
      const isPickup    = finalMemo.startsWith('매장픽업');
      const deliveryFee = (!isPickup && itemsSum >= 20) ? 1 : 0;
      const total       = itemsSum + deliveryFee;

      // 무엇이 바뀌었는지 정리 (거래 증명용)
      const changeLines = [];
      const keyOf  = i => (i.menuId != null ? 'id:' + i.menuId : 'nm:' + i.name);
      const oldMap = {}; oldItems.forEach(i => { oldMap[keyOf(i)] = i; });
      const newMap = {}; items.forEach(i => { newMap[keyOf(i)] = i; });
      for (const i of items) {
        const o = oldMap[keyOf(i)];
        const nq = i.qty || 1;
        if (!o) changeLines.push(`${i.name} ${nq}개 추가`);
        else if ((o.qty || 1) !== nq) changeLines.push(`${i.name} ${o.qty||1}개→${nq}개`);
      }
      for (const o of oldItems) {
        if (!newMap[keyOf(o)]) changeLines.push(`${o.name} ${o.qty||1}개 삭제`);
      }
      const prevMemo  = rows[0].memo || '';
      const prevTotal = Number(rows[0].total) || 0;
      if (finalMemo !== prevMemo) changeLines.push(`배송방법 ${prevMemo||'(없음)'}→${finalMemo||'(없음)'}`);
      if (total !== prevTotal)    changeLines.push(`합계 ${prevTotal}→${total}천원`);

      await conn.execute('UPDATE orders SET items=?, total=?, memo=? WHERE id=?', [JSON.stringify(items), total, finalMemo, req.params.id]);
      await conn.commit(); conn.release();
      broadcast('order_items', { orderId: req.params.id });
      ok(res, { total });
      if (changeLines.length) {
        _appendOrderLog(req.params.id, changeLines);
        _notifyOwnerChange(req.params.id, '주문변경', changeLines);
      }
    } catch(e) { await conn.rollback(); conn.release(); throw e; }
  } catch(e) { err(res, e.message); }
});

// 추가요청 저장 (PUT /api/orders/:id/request)
app.put('/api/orders/:id/request', async (req, res) => {
  try {
    const { text } = req.body;
    await pool.execute('UPDATE orders SET additional_request=? WHERE id=?', [text||'', req.params.id]);
    broadcast('order_request', { orderId: req.params.id });
    ok(res);
  } catch(e) { err(res, e.message); }
});

// 배송방법(memo) 저장 (PUT /api/orders/:id/memo)
app.put('/api/orders/:id/memo', async (req, res) => {
  try {
    // 여기서는 기록·통보를 하지 않는다.
    // 고객이 배송방법을 바꾸면 '저장'을 눌렀을 때 PUT /:id/items 로 함께 넘어오고,
    // 거기서 한 번만 기록·발송한다. 이 경로는 옛 memo 형식을 정리하는 1회성
    // 마이그레이션도 쓰기 때문에, 여기서 통보하면 화면을 열 때마다 문자가 나간다.
    const { memo } = req.body;
    await pool.execute('UPDATE orders SET memo=? WHERE id=?', [memo||'', req.params.id]);
    broadcast('order_memo', { orderId: req.params.id });
    ok(res);
  } catch(e) { err(res, e.message); }
});

// 추가요청 확인 처리 (PUT /api/orders/:id/addreq-ack)
app.put('/api/orders/:id/addreq-ack', requireAdmin, async (req, res) => {
  try {
    await pool.execute('UPDATE orders SET addreq_acked=1 WHERE id=?', [req.params.id]);
    broadcast('order_ack', { orderId: req.params.id });
    ok(res);
  } catch(e) { err(res, e.message); }
});

// 관리자 답변 저장 (PUT /api/orders/:id/reply)
app.put('/api/orders/:id/reply', requireAdmin, async (req, res) => {
  try {
    const { text } = req.body;
    await pool.execute(
      'UPDATE orders SET admin_reply=?, reply_at=NOW() WHERE id=?',
      [text||'', req.params.id]
    );
    broadcast('order_reply', { orderId: req.params.id });
    ok(res);
    // 고객 알림 (fire-and-forget)
    (async () => {
      try {
        const ns  = await _getNotifySettings();
        const url = (ns.gasUrl || '').trim();
        if (!url) return;
        const [[o]] = await pool.execute('SELECT phone, name FROM orders WHERE id=?', [req.params.id]);
        if (!o) return;
        if (!_notifyAllowed(ns, 'reply')) return;
        const fallback = `[오늘의 반찬] ${text||''}`;
        _alimtalk(o.phone, 'KA01TP260529154902220c1zr7XODUTj', { 이름: o.name||'' }, fallback, url, ns);
      } catch(e) {}
    })();
  } catch(e) { err(res, e.message); }
});

// 주문 삭제 (DELETE /api/orders/:id) — 대기중은 삭제 불가. 재고는 건드리지 않음(취소는 별도 API가 복원 담당)
app.delete('/api/orders/:id', async (req, res) => {
  try {
    const isAdmin = !!ADMIN_TOKEN && req.headers['x-admin-token'] === ADMIN_TOKEN;
    const conn = await pool.getConnection();
    await conn.beginTransaction();
    try {
      const [rows] = await conn.execute(
        'SELECT status, device_id FROM orders WHERE id=? FOR UPDATE', [req.params.id]
      );
      if (!rows.length) { await conn.rollback(); conn.release(); return err(res, '주문 없음', 404); }

      if (!isAdmin) {
        const deviceId = (req.query.deviceId || '').trim();
        const ownsOrder = deviceId && rows[0].device_id && deviceId === rows[0].device_id;
        if (rows[0].status !== 'cancelled' || !ownsOrder) {
          await conn.rollback(); conn.release();
          return err(res, '인증이 필요합니다.', 401);
        }
      } else if (rows[0].status === 'pending') {
        await conn.rollback(); conn.release();
        return err(res, '대기중 주문은 삭제할 수 없어요. 먼저 주문취소를 해주세요.', 409);
      }

      const [r] = await conn.execute('DELETE FROM orders WHERE id=?', [req.params.id]);
      if (r.affectedRows === 0) { await conn.rollback(); conn.release(); return err(res, '주문 없음', 404); }
      await conn.commit(); conn.release();
      broadcast('order_delete', { orderId: req.params.id });
      ok(res);
    } catch(e) { await conn.rollback(); conn.release(); throw e; }
  } catch(e) { err(res, e.message); }
});

// ── customers_master CRUD ──────────────────────────────────────
// GET /api/customers-master?phone=xxx&device_id=xxx
// JOIN: customers_master (저장 주소) + customers (주문이력) — 조인키: phone
app.get('/api/customers-master', async (req, res) => {
  try {
    // phone은 항상 숫자만 (저장 시 정규화 보장)
    const phone = (req.query.phone||'').replace(/[^0-9]/g,'');
    const deviceId = (req.query.device_id||'').trim();
    const isAdmin = !!ADMIN_TOKEN && req.headers['x-admin-token'] === ADMIN_TOKEN;
    // 본인 조회(phone 또는 device_id)만 인증 없이 허용 — 전체 조회는 관리자만
    if (!phone && !deviceId && !isAdmin) return err(res, '인증이 필요합니다.', 401);

    // device_id만 있으면 기기 자동 인식
    if(deviceId && !phone){
      const [rows] = await pool.execute(
        'SELECT * FROM customers_master WHERE device_id=? ORDER BY updated_at DESC LIMIT 1',
        [deviceId]
      );
      return ok(res, {items: rows, history: [], device_match: rows.length>0});
    }

    // 1. customers_master — 단순 WHERE phone=? (저장 시 숫자 정규화됨)
    const [master] = phone
      ? await pool.execute('SELECT * FROM customers_master WHERE phone=? ORDER BY updated_at DESC',[phone])
      : await pool.execute('SELECT * FROM customers_master ORDER BY updated_at DESC');

    // phone 조회 성공 + device_id 있으면 DB에 device_id 자동 갱신 (NULL인 기존 레코드 대응)
    if(phone && deviceId && master.length){
      await pool.execute(
        'UPDATE customers_master SET device_id=? WHERE phone=? AND (device_id IS NULL OR device_id=?)',
        [deviceId, phone, deviceId]
      ).catch(()=>{});
    }

    ok(res, {items: master});
  } catch(e) { err(res, e.message); }
});

// POST /api/customers-master (phone UNIQUE → UPSERT)
app.post('/api/customers-master', async (req, res) => {
  try {
    const {name,addr1,addr2,addr3,memo,device_id} = req.body;
    const phone = (req.body.phone||'').replace(/[^0-9]/g,'');
    if(!phone) return err(res,'phone required',400);
    // 빈 값은 기존 값 유지 (addr 없이도 저장 허용 — 기존 addr 보존)
    await pool.execute(
      `INSERT INTO customers_master (name,phone,addr1,addr2,addr3,memo,device_id) VALUES (?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE
         name=IF(VALUES(name)!='',VALUES(name),name),
         addr1=IF(VALUES(addr1)!='',VALUES(addr1),addr1),
         addr2=COALESCE(VALUES(addr2),addr2),
         addr3=COALESCE(VALUES(addr3),addr3),
         memo=IF(VALUES(memo)!='',VALUES(memo),memo),
         device_id=COALESCE(VALUES(device_id),device_id)`,
      [name||'', phone, addr1||'', addr2||null, addr3||null, memo||'', device_id||null]
    );
    ok(res);
  } catch(e) { err(res, e.message); }
});

// PUT /api/customers-master/:id
app.put('/api/customers-master/:id', async (req, res) => {
  try {
    const {name,addr1,addr2,addr3,memo,device_id} = req.body;
    const phone = (req.body.phone||'').replace(/[^0-9]/g,'');
    await pool.execute(
      'UPDATE customers_master SET name=?,phone=?,addr1=?,addr2=?,addr3=?,memo=?,device_id=COALESCE(?,device_id) WHERE id=?',
      [name||'',phone,addr1,addr2||null,addr3||null,memo||'',device_id||null,req.params.id]
    );
    ok(res);
  } catch(e) { err(res, e.message); }
});

// DELETE /api/customers-master/:id
app.delete('/api/customers-master/:id', requireAdmin, async (req, res) => {
  try {
    await pool.execute('DELETE FROM customers_master WHERE id=?',[req.params.id]);
    ok(res);
  } catch(e) { err(res, e.message); }
});

// ══════════════════════════════════════════════════════════════
// 설정
// ══════════════════════════════════════════════════════════════

// 고객 화면이 실제로 쓰는 설정 키만 공개. 그 외(gasUrl·adminPhone·deliveryPhone 등)는
// 관리자 토큰이 있을 때만 내려준다 — 문자 발송 주소와 연락처가 새어나가지 않도록.
// categories 는 별도 취급(아래) — settings 테이블이 아니라 categories 테이블이 원본이고,
// 고객 화면도 색상이 필요하므로 인증 여부와 무관하게 항상 공개한다.
const PUBLIC_SETTING_KEYS = ['banks', 'reserveEvent'];

// 설정 로드 (GET /api/settings)
app.get('/api/settings', async (req, res) => {
  try {
    const isAdmin = !!ADMIN_TOKEN && req.headers['x-admin-token'] === ADMIN_TOKEN;
    const [rows] = await pool.execute('SELECT k, v FROM settings');
    const data = {};
    rows.forEach(r => {
      if (!isAdmin && !PUBLIC_SETTING_KEYS.includes(r.k)) return;
      try { data[r.k] = JSON.parse(r.v); } catch { data[r.k] = r.v; }
    });
    const [cats] = await pool.execute('SELECT id,name,color FROM categories ORDER BY sort_order,id');
    data.categories = cats;
    ok(res, { data });
  } catch(e) { err(res, e.message); }
});

// 설정 저장 (POST /api/settings)
app.post('/api/settings', requireAdmin, async (req, res) => {
  try {
    const data = req.body.data || req.body;
    const conn = await pool.getConnection();
    await conn.beginTransaction();
    let blockedCategories = [];
    for (const [k, v] of Object.entries(data)) {
      // 카테고리는 id 기반 전용 로직으로 — 일반 키-값 저장(JSON 통째로 덮어쓰기)을 타면
      // 이름 변경이 기존 메뉴에 전파되지 않아 옛 이름이 계속 남는 문제가 재발한다.
      if (k === 'categories') { blockedCategories = await _saveCategories(conn, v); continue; }
      const val = typeof v === 'object' ? JSON.stringify(v) : String(v);
      await conn.execute(
        'INSERT INTO settings (k,v) VALUES (?,?) ON DUPLICATE KEY UPDATE v=?',
        [k, val, val]
      );
    }
    await conn.commit();
    conn.release();
    ok(res, blockedCategories.length ? { blockedCategories } : {});
  } catch(e) { err(res, e.message); }
});

// ══════════════════════════════════════════════════════════════
// 접속 로그
// ══════════════════════════════════════════════════════════════

app.post('/api/log', async (req, res) => {
  try {
    const { ip, ref, page } = req.body;
    await pool.execute(
      'INSERT INTO access_log (ip,referrer,page) VALUES (?,?,?)',
      [ip||'', ref||'', page||'index']
    );
    ok(res);
  } catch(e) { err(res, e.message); }
});

// ══════════════════════════════════════════════════════════════
// AI 추천 메뉴 (오늘의 추천 메뉴)
// ══════════════════════════════════════════════════════════════

app.post('/api/recommend', async (req, res) => {
  try {
    if (!process.env.ANTHROPIC_API_KEY) return err(res, 'AI 추천 기능이 아직 설정되지 않았습니다.', 503);
    const body = req.body || {};
    const scope = ['today', 'all', 'persona'].includes(body.scope) ? body.scope : 'all';
    const deviceId = String(body.deviceId || '').trim();
    const purpose = String(body.purpose || '').trim();
    const mealType = String(body.mealType || '').trim();
    const cuisine = String(body.cuisine || '').trim();
    const broth = String(body.broth || '').trim();
    const taste = Array.isArray(body.taste) ? body.taste.filter(Boolean).map(String) : [];
    const temp = String(body.temp || '').trim();
    const diet = Array.isArray(body.diet) ? body.diet.filter(Boolean).map(String) : [];
    const mealKit = String(body.mealKit || '').trim();
    const allergy = String(body.allergy || '').trim();
    const drinks = Array.isArray(body.drinks) ? body.drinks.filter(Boolean).map(String) : [];
    const budget = String(body.budget || '').trim();

    let rows;
    if (scope === 'today') {
      const todayStr = toKSTDateStr(new Date());
      [rows] = await pool.execute(
        `SELECT COALESCE(m.name,m2.name,d.name) AS name, COALESCE(m.cat,m2.cat,d.cat) AS cat
         FROM daily_menus d
         LEFT JOIN menus m  ON m.id=d.menu_id
         LEFT JOIN menus m2 ON m2.name=d.name
         WHERE d.date=? AND d.stock<>0`,
        [todayStr]
      );
      if (!rows.length) return err(res, '오늘 등록된 메뉴가 없어서 오늘의 메뉴 기준으로는 추천할 수 없어요. "전체 메뉴중에서 추천 받기"로 다시 시도해보세요.', 404);
    } else {
      [rows] = await pool.execute('SELECT name, cat FROM menus ORDER BY count DESC, name');
      if (!rows.length) return err(res, '추천할 메뉴가 없습니다.', 404);
    }
    const menuLines = rows.map(r => r.name + ' (' + (r.cat || '기타') + ')').join('\n');

    const reqLines = [];
    if (purpose) reqLines.push('- 식사 목적: ' + purpose);
    if (mealType) reqLines.push('- 식사 형태: ' + mealType);
    if (cuisine) reqLines.push('- 음식 종류: ' + cuisine);
    if (broth) reqLines.push('- 국물 유무: ' + broth);
    if (taste.length) reqLines.push('- 맛/매운정도: ' + taste.join(', '));
    if (temp) reqLines.push('- 온도감: ' + temp);
    if (diet.length) reqLines.push('- 식단/칼로리: ' + diet.join(', '));
    if (mealKit) reqLines.push('- 밀키트 여부: ' + mealKit);
    if (allergy) reqLines.push('- 알레르기·비선호 재료(반드시 제외): ' + allergy);
    if (drinks.length) reqLines.push('- 곁들일 음료: ' + drinks.join(', '));
    if (budget) reqLines.push('- 예산 범위(총액 기준): ' + budget);
    if (!reqLines.length) reqLines.push('- 특별한 조건 없음, 아무거나 골고루 추천');

    let personaContext = '';
    if (scope === 'persona' && deviceId) {
      const [recRows] = await pool.execute(
        'SELECT picks FROM recommend_selection_log WHERE device_id=? ORDER BY created_at DESC LIMIT 5',
        [deviceId]
      );
      const [clickRows] = await pool.execute(
        'SELECT menu_name, COUNT(*) AS cnt FROM menu_click_log WHERE device_id=? GROUP BY menu_name ORDER BY cnt DESC LIMIT 5',
        [deviceId]
      );
      const personaLines = [];
      if (clickRows.length) {
        personaLines.push('- 자주 살펴본 메뉴(관심 순): ' + clickRows.map(r => r.menu_name + '(' + r.cnt + '회)').join(', '));
      }
      const pastPicks = Array.from(new Set(recRows.flatMap(r => {
        const picks = typeof r.picks === 'string' ? JSON.parse(r.picks) : (r.picks || []);
        return picks;
      })));
      if (pastPicks.length) personaLines.push('- 과거 AI추천에서 실제로 선택했던 메뉴: ' + pastPicks.join(', '));
      personaContext = personaLines.length
        ? '\n\n[고객 개인 취향 데이터]\n' + personaLines.join('\n') + '\n위 데이터를 참고해서 이 고객이 좋아할 만한 메뉴 위주로 추천해주세요.'
        : '\n\n[고객 개인 취향 데이터] 아직 이 고객의 취향 데이터가 쌓이지 않았습니다. 인기 있는 메뉴 위주로 추천해주세요.';
    }

    const scopeDesc = scope === 'today' ? '아래는 오늘 판매 중인 메뉴 목록입니다.' : '아래는 지금까지 판매해온 전체 메뉴 목록입니다.';
    const prompt = '당신은 반찬가게 "온반"의 메뉴 추천 도우미입니다. ' + scopeDesc + '\n\n'
      + menuLines + '\n\n'
      + '고객 요청:\n' + reqLines.join('\n') + personaContext + '\n\n'
      + '위 목록 중에서 고객 요청에 가장 잘 맞는 메뉴를 3~6개 골라 추천해주세요. '
      + '반드시 목록에 있는 이름을 정확히 그대로 사용하세요(오타·변형 금지). '
      + '만약 여러 조건을 동시에 만족하는 메뉴가 목록에 하나도 없다면, picks는 빈 배열로 두고 '
      + 'reason에 어떤 조건들이 서로 충돌해서 못 골랐는지 구체적으로 설명해 고객이 조건을 조정할 수 있게 해주세요.';

    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
        tools: [{
          name: 'recommend_menus',
          description: '고객 조건에 맞는 메뉴를 목록에서 골라 추천한다',
          input_schema: {
            type: 'object',
            properties: {
              picks: { type: 'array', items: { type: 'string' }, description: '추천 메뉴 이름(목록에 있는 정확한 이름), 조건에 맞는 게 있으면 3~6개, 하나도 없으면 빈 배열' },
              reason: { type: 'string', description: '추천 이유(picks가 있을 때) 또는 못 고른 구체적 이유(picks가 비었을 때), 한두 문장' },
            },
            required: ['picks', 'reason'],
          },
        }],
        tool_choice: { type: 'tool', name: 'recommend_menus' },
      }),
    });
    if (!aiRes.ok) {
      const errText = await aiRes.text().catch(() => '');
      return err(res, 'AI 호출 실패(' + aiRes.status + '): ' + errText.slice(0, 300));
    }
    const aiData = await aiRes.json();
    const toolBlock = (aiData.content || []).find(b => b.type === 'tool_use' && b.name === 'recommend_menus');
    if (!toolBlock) return err(res, 'AI 응답 형식 오류');

    const validNames = new Set(rows.map(r => r.name));
    const picks = (toolBlock.input.picks || []).filter(n => validNames.has(n));
    if (!picks.length) return err(res, toolBlock.input.reason || '조건에 맞는 메뉴를 찾지 못했습니다.', 404);

    ok(res, { picks, reason: toolBlock.input.reason || '' });
  } catch (e) { err(res, e.message); }
});

// ── 고객 개인별 취향/행동 추적 로그 (주문·예약은 기존 orders.device_id로 이미 저장됨) ──
app.post('/api/track/menu-click', async (req, res) => {
  try {
    const deviceId = String(req.body.deviceId || '').trim();
    const name = String(req.body.name || '').trim();
    if (!deviceId || !name) return err(res, 'deviceId, name 필요', 400);
    const cat = String(req.body.cat || '').trim();
    await pool.execute('INSERT INTO menu_click_log (device_id,menu_name,cat) VALUES (?,?,?)', [deviceId, name, cat]);
    ok(res, {});
  } catch (e) { err(res, e.message); }
});

app.post('/api/track/recommend-apply', async (req, res) => {
  try {
    const deviceId = String(req.body.deviceId || '').trim();
    const picks = Array.isArray(req.body.picks) ? req.body.picks.filter(Boolean).map(String) : [];
    if (!deviceId || !picks.length) return err(res, 'deviceId, picks 필요', 400);
    const scope = req.body.scope === 'today' ? 'today' : 'all';
    const conditions = (req.body.conditions && typeof req.body.conditions === 'object') ? req.body.conditions : {};
    const reason = String(req.body.reason || '');
    await pool.execute(
      'INSERT INTO recommend_selection_log (device_id,scope,conditions,picks,reason) VALUES (?,?,?,?,?)',
      [deviceId, scope, JSON.stringify(conditions), JSON.stringify(picks), reason]
    );
    ok(res, {});
  } catch (e) { err(res, e.message); }
});

// GET /api/tracker/mine?deviceId=xxx — 고객 본인 기기의 추천선택/관심메뉴 이력(주문·예약은 기존 /api/orders?deviceId= 재사용)
app.get('/api/tracker/mine', async (req, res) => {
  try {
    const deviceId = String(req.query.deviceId || '').trim();
    if (!deviceId) return err(res, 'deviceId 필요', 400);
    const [recRows] = await pool.execute(
      'SELECT scope, conditions, picks, reason, created_at FROM recommend_selection_log WHERE device_id=? ORDER BY created_at DESC LIMIT 10',
      [deviceId]
    );
    const [clickRows] = await pool.execute(
      'SELECT menu_name, cat, COUNT(*) AS cnt, MAX(created_at) AS last_at FROM menu_click_log WHERE device_id=? GROUP BY menu_name, cat ORDER BY cnt DESC, last_at DESC LIMIT 10',
      [deviceId]
    );
    const toTS = d => { if (!d) return null; const ms = d instanceof Date ? d.getTime() : new Date(String(d).replace(' ', 'T')).getTime(); return isNaN(ms) ? null : ms + 9 * 60 * 60 * 1000; };
    const recommendLogs = recRows.map(r => ({
      scope: r.scope,
      conditions: typeof r.conditions === 'string' ? JSON.parse(r.conditions) : (r.conditions || {}),
      picks: typeof r.picks === 'string' ? JSON.parse(r.picks) : (r.picks || []),
      reason: r.reason || '',
      createdAt: toTS(r.created_at),
    }));
    const topMenus = clickRows.map(r => ({ name: r.menu_name, cat: r.cat, count: r.cnt, lastAt: toTS(r.last_at) }));
    ok(res, { recommendLogs, topMenus });
  } catch (e) { err(res, e.message); }
});

// ── 서버 시작 ────────────────────────────────────────────────
async function initDB() {
  const sqls = [
    `CREATE TABLE IF NOT EXISTS daily_menus (
      id INT AUTO_INCREMENT PRIMARY KEY,
      date DATE NOT NULL,
      menu_id INT,
      name VARCHAR(200) NOT NULL,
      cat VARCHAR(50) DEFAULT '기타',
      price DECIMAL(6,1) DEFAULT 0,
      stock INT DEFAULT 0,
      child TINYINT(1) DEFAULT 0,
      INDEX idx_date (date),
      INDEX idx_menu (menu_id)
    )`,
    `CREATE TABLE IF NOT EXISTS menus (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(200) NOT NULL,
      cat VARCHAR(50) DEFAULT '기타',
      price DECIMAL(6,1) DEFAULT 0,
      stock INT DEFAULT 0,
      child TINYINT(1) DEFAULT 0,
      img_url VARCHAR(1000) DEFAULT '',
      icon VARCHAR(1000) DEFAULT '',
      menu_desc TEXT,
      count INT DEFAULT 0,
      updated_at BIGINT DEFAULT 0,
      UNIQUE KEY uq_name_cat (name, cat)
    )`,
    // 카테고리 진짜 원본 — 이름이 아니라 id로 참조한다. menu_id/daily_menus 관계와 같은 방식.
    // menus.cat / daily_menus.cat 은 화면 렌더용 비정규화 캐시로 남겨두고, 이름이 바뀌면 카테고리
    // 저장 시(POST /api/settings) 그 캐시도 함께 갱신한다 — 메뉴 이름 rename 전파와 같은 패턴.
    `CREATE TABLE IF NOT EXISTS categories (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(50) NOT NULL UNIQUE,
      color VARCHAR(20) DEFAULT '#888780',
      sort_order INT DEFAULT 0,
      created_at DATETIME DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS orders (
      id VARCHAR(100) PRIMARY KEY,
      date DATE,
      time VARCHAR(20),
      name VARCHAR(100),
      phone VARCHAR(30),
      addr VARCHAR(500),
      memo VARCHAR(1000),
      items JSON,
      total INT DEFAULT 0,
      status VARCHAR(30) DEFAULT 'pending',
      admin_reply TEXT,
      reply_at DATETIME,
      additional_request TEXT,
      addreq_acked TINYINT(1) DEFAULT 0,
      is_reorder TINYINT(1) DEFAULT 0,
      device_id VARCHAR(64),
      reserve_date DATE NULL,
      created_at DATETIME DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS customers_master (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(100),
      phone VARCHAR(30) NOT NULL,
      addr1 VARCHAR(500) NOT NULL,
      addr2 VARCHAR(500) DEFAULT NULL,
      addr3 VARCHAR(500) DEFAULT NULL,
      memo VARCHAR(200) DEFAULT '',
      device_id VARCHAR(100) DEFAULT NULL,
      created_at DATETIME DEFAULT NOW(),
      updated_at DATETIME DEFAULT NOW() ON UPDATE NOW(),
      UNIQUE KEY uq_cm_phone (phone)
    )`,
    `CREATE TABLE IF NOT EXISTS settings (
      k VARCHAR(100) PRIMARY KEY,
      v TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS access_log (
      id INT AUTO_INCREMENT PRIMARY KEY,
      created_at DATETIME DEFAULT NOW(),
      ip VARCHAR(100),
      referrer VARCHAR(500),
      page VARCHAR(100)
    )`,
    // 고객 개인별 취향 추적 — 갤러리에서 메뉴 상세를 열어본 기록(관심 신호)
    `CREATE TABLE IF NOT EXISTS menu_click_log (
      id INT AUTO_INCREMENT PRIMARY KEY,
      device_id VARCHAR(64),
      menu_name VARCHAR(200),
      cat VARCHAR(50),
      created_at DATETIME DEFAULT NOW(),
      INDEX idx_device (device_id)
    )`,
    // 고객 개인별 페르소나 파악 — AI 추천에서 실제로 "메뉴 적용"한 조건/결과 기록
    `CREATE TABLE IF NOT EXISTS recommend_selection_log (
      id INT AUTO_INCREMENT PRIMARY KEY,
      device_id VARCHAR(64),
      scope VARCHAR(20),
      conditions JSON,
      picks JSON,
      reason TEXT,
      created_at DATETIME DEFAULT NOW(),
      INDEX idx_device (device_id)
    )`
  ];
  const conn = await pool.getConnection();
  try {
    for (const sql of sqls) await conn.execute(sql);
    // ADD COLUMN IF NOT EXISTS 는 MySQL 8.0.29 이상에서만 지원되어 버전을 확신할 수 없다.
    // information_schema로 존재 여부를 직접 확인하는 방식은 모든 버전에서 동작한다.
    await _ensureColumn(conn, 'menus', 'cat_id', 'cat_id INT NULL');
    await _ensureColumn(conn, 'daily_menus', 'cat_id', 'cat_id INT NULL');
    console.log('DB 테이블 초기화 완료');
    await _migrateCategoriesToTable(conn);
  } finally {
    conn.release();
  }
}

async function _ensureColumn(conn, table, column, ddl) {
  const [[row]] = await conn.execute(
    'SELECT COUNT(*) AS n FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name=? AND column_name=?',
    [table, column]
  );
  if (row.n > 0) return;
  await conn.execute(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}

// 카테고리를 이름 기반(settings.categories JSON / menus.cat 문자열)에서 id 기반(categories 테이블)으로
// 옮기는 1회성 마이그레이션. 서버 기동마다 실행되지만 완료 표시(settings.categoriesMigratedV1)로
// 두 번째부터는 곧바로 빠져나간다 — 기존 menu_id 도입 때와 같은 방식.
async function _migrateCategoriesToTable(conn) {
  const [[flag]] = await conn.execute("SELECT v FROM settings WHERE k='categoriesMigratedV1'");
  if (flag) return;

  // 1) 시드 — 예전 settings.categories(JSON)에 있던 값이 있으면 그걸, 없으면 기본 7개
  const [[oldRow]] = await conn.execute("SELECT v FROM settings WHERE k='categories'");
  let seed = [];
  if (oldRow) { try { seed = JSON.parse(oldRow.v); } catch(e) {} }
  if (!Array.isArray(seed) || !seed.length) {
    seed = [
      { name: '메인', color: '#1D9E75' }, { name: '한우', color: '#C0392B' },
      { name: '한돈', color: '#8E44AD' }, { name: '반찬', color: '#378ADD' },
      { name: '김치', color: '#D4537E' }, { name: '밀키트', color: '#E9A826' },
      { name: '기타', color: '#888780' }
    ];
  }
  for (const c of seed) {
    if (!c || !c.name) continue;
    await conn.execute('INSERT IGNORE INTO categories (name,color) VALUES (?,?)', [c.name, c.color || '#888780']);
  }
  // 2) 이미 메뉴에 쓰이고 있는데 목록엔 없던 카테고리명도 빠짐없이 만든다(고아 방지)
  const [orphans] = await conn.execute(
    `SELECT DISTINCT cat FROM (
       SELECT cat FROM menus WHERE cat IS NOT NULL AND cat<>''
       UNION SELECT cat FROM daily_menus WHERE cat IS NOT NULL AND cat<>''
     ) x WHERE cat NOT IN (SELECT name FROM categories)`
  );
  for (const o of orphans) {
    await conn.execute('INSERT IGNORE INTO categories (name,color) VALUES (?,?)', [o.cat, '#888780']);
  }
  // 3) 이름으로 매칭해 cat_id 백필 (이후로는 id가 원본, cat 문자열은 캐시)
  await conn.execute('UPDATE menus m JOIN categories c ON c.name=m.cat SET m.cat_id=c.id WHERE m.cat_id IS NULL');
  await conn.execute('UPDATE daily_menus d JOIN categories c ON c.name=d.cat SET d.cat_id=c.id WHERE d.cat_id IS NULL');
  // 4) 예전 JSON 원본은 정리 — 이제 GET /api/settings 는 categories 테이블만 본다
  await conn.execute("DELETE FROM settings WHERE k='categories'");
  await conn.execute("INSERT INTO settings (k,v) VALUES ('categoriesMigratedV1','1') ON DUPLICATE KEY UPDATE v='1'");
  console.log('카테고리 id 기반 마이그레이션 완료');
}

// 카테고리명으로 id를 찾고, 없으면 만든다(카톡 파싱 등 자유 입력으로 새 카테고리명이 들어오는 경우 대비)
async function _resolveCatId(conn, name) {
  const n = (name || '').trim() || '기타';
  const [[row]] = await conn.execute('SELECT id FROM categories WHERE name=?', [n]);
  if (row) return row.id;
  const [ins] = await conn.execute('INSERT INTO categories (name,color) VALUES (?,?)', [n, '#888780']);
  return ins.insertId;
}

// 카테고리 목록 저장 — id가 있으면 그 행을 수정(이름이 바뀌면 메뉴들의 cat 캐시도 함께 갱신),
// id가 없으면(신규 추가) 이름으로 기존 행을 찾아 재사용하거나 새로 만든다.
// 목록에서 빠진 기존 카테고리는, 메뉴가 참조 중이면 삭제하지 않고 남겨둔다(마스터 메뉴 삭제와 같은 보호 정책).
async function _saveCategories(conn, list) {
  if (!Array.isArray(list)) return [];
  const [existingRows] = await conn.execute('SELECT id,name,color FROM categories');
  const existingById = {}; existingRows.forEach(r => { existingById[r.id] = r; });
  const seenIds = new Set();
  let order = 0;
  for (const c of list) {
    const name = ((c && c.name) || '').trim();
    if (!name) { order++; continue; }
    const color = (c && c.color) || '#888780';
    if (c && c.id && existingById[c.id]) {
      seenIds.add(c.id);
      const prev = existingById[c.id];
      await conn.execute('UPDATE categories SET name=?,color=?,sort_order=? WHERE id=?', [name, color, order, c.id]);
      if (prev.name !== name) {
        await conn.execute('UPDATE menus SET cat=? WHERE cat_id=?', [name, c.id]);
        await conn.execute('UPDATE daily_menus SET cat=? WHERE cat_id=?', [name, c.id]);
      }
    } else {
      const [[byName]] = await conn.execute('SELECT id FROM categories WHERE name=?', [name]);
      if (byName) {
        seenIds.add(byName.id);
        await conn.execute('UPDATE categories SET color=?,sort_order=? WHERE id=?', [color, order, byName.id]);
      } else {
        const [ins] = await conn.execute('INSERT INTO categories (name,color,sort_order) VALUES (?,?,?)', [name, color, order]);
        seenIds.add(ins.insertId);
      }
    }
    order++;
  }
  const blocked = [];
  for (const row of existingRows) {
    if (seenIds.has(row.id)) continue;
    const [[used]] = await conn.execute(
      'SELECT (SELECT COUNT(*) FROM menus WHERE cat_id=?)+(SELECT COUNT(*) FROM daily_menus WHERE cat_id=?) AS n',
      [row.id, row.id]
    );
    if (used && used.n > 0) { blocked.push({ id: row.id, name: row.name }); continue; }
    await conn.execute('DELETE FROM categories WHERE id=?', [row.id]);
  }
  return blocked;
}



initDB()
  .then(() => app.listen(PORT, () => console.log(`onban-api running on :${PORT}`)))
  .catch(e => { console.error('DB 초기화 실패:', e.message); process.exit(1); });
