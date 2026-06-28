require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const mysql   = require('mysql2/promise');
const path    = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
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
  timezone:          '+09:00'
});

const ok  = (res, data={}) => res.json({ success: true,  ...data });
const err = (res, msg, status=500) => res.status(status).json({ success: false, error: msg });

// ── SSE 클라이언트 풀 ─────────────────────────────────────────
const sseClients = new Set();
function broadcast(type, payload={}) {
  const msg = `data: ${JSON.stringify({ type, ...payload })}\n\n`;
  for (const r of sseClients) { try { r.write(msg); } catch(e) { sseClients.delete(r); } }
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
app.get('/health', (req, res) => res.json({ ok: true }));

// ══════════════════════════════════════════════════════════════
// 메뉴 창고 (등록된모든메뉴)
// ══════════════════════════════════════════════════════════════

// 전체 메뉴 저장 (parse_onban_menu.py → POST /api/menu/all)
app.post('/api/menu/all', async (req, res) => {
  try {
    const list = req.body.data || req.body;
    if (!Array.isArray(list) || !list.length) return err(res, '데이터 없음', 400);
    const conn = await pool.getConnection();
    await conn.beginTransaction();
    try {
      // menuId 있으면 id 기준 UPDATE(이름 변경=rename 포함), 없으면 신규 INSERT
      // → menus.id가 진짜 키. 이름을 바꿔도 같은 행을 갱신(중복 생성 방지)
      for (const m of list) {
        if (m.menuId) {
          await conn.execute(
            `UPDATE menus SET name=?,cat=?,price=?,stock=?,child=?,img_url=?,icon=?,menu_desc=?,count=?,updated_at=? WHERE id=?`,
            [m.name, m.cat||'기타', m.price||0, m.stock||0, m.child?1:0, m.imgUrl||'', m.icon||'', m.desc||'', m.count||0, m.updatedAt||0, m.menuId]
          );
          // rename 전파: 연결된 daily_menus의 비정규화 name도 갱신(옛 이름 잔존·중복 방지)
          await conn.execute(
            `UPDATE daily_menus SET name=? WHERE menu_id=? AND name<>?`,
            [m.name, m.menuId, m.name]
          );
        } else {
          await conn.execute(
            `INSERT INTO menus (name,cat,price,stock,child,img_url,icon,menu_desc,count,updated_at)
             VALUES (?,?,?,?,?,?,?,?,?,?)
             ON DUPLICATE KEY UPDATE cat=VALUES(cat),price=VALUES(price),stock=VALUES(stock),
               child=VALUES(child),img_url=VALUES(img_url),icon=VALUES(icon),menu_desc=VALUES(menu_desc),
               count=VALUES(count),updated_at=VALUES(updated_at)`,
            [m.name, m.cat||'기타', m.price||0, m.stock||0, m.child?1:0, m.imgUrl||'', m.icon||'', m.desc||'', m.count||0, m.updatedAt||0]
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

// 마스터 병합 (POST /api/menu/master/merge)
// source를 target으로 합침: daily_menus를 target으로 재연결 후 source 삭제
app.post('/api/menu/master/merge', async (req, res) => {
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
app.post('/api/menu/master/delete', async (req, res) => {
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
app.post('/api/menu/daily', async (req, res) => {
  try {
    const list = req.body.data || req.body;
    if (!Array.isArray(list) || !list.length) return err(res, '데이터 없음', 400);

    // 날짜별로 그룹화
    const byDate = {};
    list.forEach(m => {
      if (!byDate[m.date]) byDate[m.date] = [];
      byDate[m.date].push(m);
    });

    const conn = await pool.getConnection();
    await conn.beginTransaction();
    const dates = Object.keys(byDate);
    for (const date of dates) {
      await conn.execute('DELETE FROM daily_menus WHERE date=?', [date]);
      for (const m of byDate[date]) {
        // 마스터 갱신 → menu_id 확보. menuId 있으면 id 기준 UPDATE(rename 포함), 없으면 신규 INSERT
        let menuId = m.menuId || null;
        if (menuId) {
          // menu_desc는 master 전용 — 일일 저장이 덮어쓰지 않음(정합성 보호)
          await conn.execute(
            `UPDATE menus SET name=?,cat=?,price=?,child=?,img_url=?,updated_at=? WHERE id=?`,
            [m.name, m.cat||'기타', m.price||0, m.child?1:0, m.imgUrl||'', m.updatedAt||Date.now(), menuId]
          );
        } else {
          // 신규행만 desc 초기값 적용. 기존행(중복키) menu_desc는 보호(덮어쓰지 않음)
          await conn.execute(
            `INSERT INTO menus (name,cat,price,child,img_url,menu_desc,updated_at)
             VALUES (?,?,?,?,?,?,?)
             ON DUPLICATE KEY UPDATE cat=VALUES(cat),price=VALUES(price),child=VALUES(child),
               img_url=VALUES(img_url),updated_at=VALUES(updated_at)`,
            [m.name, m.cat||'기타', m.price||0, m.child?1:0, m.imgUrl||'', m.desc||'', m.updatedAt||Date.now()]
          );
          const [[mrow]] = await conn.execute('SELECT id FROM menus WHERE name=?', [m.name]);
          menuId = mrow ? mrow.id : null;
        }
        // 일자별: menu_id + 폴백용 기존 컬럼 동시 저장
        await conn.execute(
          'INSERT INTO daily_menus (date,menu_id,name,cat,price,stock,child) VALUES (?,?,?,?,?,?,?)',
          [date, menuId, m.name, m.cat||'기타', m.price||0, m.stock||0, m.child?1:0]
        );
      }
    }
    await conn.commit();
    conn.release();
    ok(res, { sheets: dates.length, count: list.length });
  } catch(e) { err(res, e.message); }
});

// 특정 날짜 재고 업데이트 (PUT /api/menu/:date/stock)
app.put('/api/menu/:date/stock', async (req, res) => {
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
app.post('/api/menu/:date/stock-adjust', async (req, res) => {
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
    const { date, phone, name, deviceId } = req.query;
    let sql = 'SELECT * FROM orders WHERE 1=1';
    const params = [];
    if (date)     { sql += ' AND date=?';      params.push(date); }
    if (deviceId) { sql += ' AND device_id=?'; params.push(deviceId); }
    else if (phone) { sql += ' AND phone=?';   params.push(phone); }
    else if (name)  { sql += ' AND name=?';    params.push(name); }
    sql += ' ORDER BY created_at DESC';
    const [rows] = await pool.execute(sql, params);
    // mysql2 timezone:'+09:00'로 DATE컬럼이 KST자정(=UTC 전날15시)으로 반환 → +9h 보정
    const toDateStr = d => {
      if (d instanceof Date) { const kst=new Date(d.getTime()+9*60*60*1000); return kst.toISOString().slice(0,10); }
      return String(d||'').slice(0,10);
    };
    // DATETIME 컬럼 → Unix ms + 9h 보정 (timezone:'+09:00'로 Date가 9h 뒤로 밀림, toDateStr과 동일 처리)
    const toTS = d => { if(!d)return null; const ms=d instanceof Date?d.getTime():new Date(String(d).replace(' ','T')).getTime(); return isNaN(ms)?null:ms+9*60*60*1000; };
    const orders = rows.map(r => ({
      id: r.id, date: toDateStr(r.date), time: r.time,
      name: r.name, phone: r.phone, addr: r.addr, memo: r.memo,
      items: typeof r.items === 'string' ? JSON.parse(r.items) : (r.items||[]),
      total: r.total, status: r.status,
      adminReply: r.admin_reply, replyAt: toTS(r.reply_at),
      additionalRequest: r.additional_request,
      addreqAcked: !!r.addreq_acked,
      isReorder: !!r.is_reorder
    }));
    ok(res, { orders });
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
    const conn   = await pool.getConnection();
    await conn.beginTransaction();
    try {
      // 재고 확인 (FOR UPDATE — 동시 주문 직렬화)
      // menu_id 있으면 id 기준(rename 안전), 없으면(레거시 주문) name 폴백
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

      // 주문 저장
      await conn.execute(
        'INSERT INTO orders (id,date,time,name,phone,addr,memo,items,total,status,is_reorder,additional_request,device_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
        [
          order.id, date, order.time||'',
          order.name||'', order.phone||'', order.addr||'', order.memo||'',
          JSON.stringify(items), order.total||0,
          order.status||'pending', order.isReorder?1:0,
          order.additionalRequest||'', order.deviceId||null
        ]
      );
      await conn.commit(); conn.release();
      broadcast('order_new', { orderId: order.id, date });
      ok(res, { action: 'inserted' });
    } catch(e) { await conn.rollback(); conn.release(); throw e; }
  } catch(e) { err(res, e.message); }
});

// 주문 상태 변경 (PUT /api/orders/:id/status) — 취소 시 재고 복원
app.put('/api/orders/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    if (!status) return err(res, '상태 없음', 400);

    const conn = await pool.getConnection();
    await conn.beginTransaction();
    try {
      const [rows] = await conn.execute(
        'SELECT status, date, items FROM orders WHERE id=? FOR UPDATE', [req.params.id]
      );
      if (!rows.length) { await conn.rollback(); conn.release(); return err(res, '주문 없음', 404); }

      const prev   = rows[0].status;
      const date   = rows[0].date;
      const items  = typeof rows[0].items === 'string' ? JSON.parse(rows[0].items) : (rows[0].items||[]);
      const wasActive    = ['pending','confirmed','delivered'].includes(prev);
      const nowCancelled = status === 'cancelled';
      const wasCancelled = prev === 'cancelled';
      const nowActive    = ['pending','confirmed','delivered'].includes(status);

      await conn.execute('UPDATE orders SET status=? WHERE id=?', [status, req.params.id]);

      // 취소 시 재고 복원 (menu_id 우선, 없으면 name 폴백)
      if (wasActive && nowCancelled) {
        for (const item of items) {
          const byId = item.menuId != null;
          await conn.execute(
            byId ? 'UPDATE daily_menus SET stock = stock + ? WHERE date=? AND menu_id=?'
                 : 'UPDATE daily_menus SET stock = stock + ? WHERE date=? AND name=?',
            [item.qty || 1, date, byId ? item.menuId : item.name]
          );
        }
      }
      // 취소 해제(재주문 실패 롤백) 시 재고 재차감 (menu_id 우선, 없으면 name 폴백)
      if (wasCancelled && nowActive) {
        for (const item of items) {
          const byId = item.menuId != null;
          await conn.execute(
            byId ? 'UPDATE daily_menus SET stock = GREATEST(stock - ?, 0) WHERE date=? AND menu_id=?'
                 : 'UPDATE daily_menus SET stock = GREATEST(stock - ?, 0) WHERE date=? AND name=?',
            [item.qty || 1, date, byId ? item.menuId : item.name]
          );
        }
      }

      await conn.commit(); conn.release();
      broadcast('order_status', { orderId: req.params.id, status, date });
      ok(res);
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
    const { memo } = req.body;
    await pool.execute('UPDATE orders SET memo=? WHERE id=?', [memo||'', req.params.id]);
    broadcast('order_memo', { orderId: req.params.id });
    ok(res);
  } catch(e) { err(res, e.message); }
});

// 추가요청 확인 처리 (PUT /api/orders/:id/addreq-ack)
app.put('/api/orders/:id/addreq-ack', async (req, res) => {
  try {
    await pool.execute('UPDATE orders SET addreq_acked=1 WHERE id=?', [req.params.id]);
    broadcast('order_ack', { orderId: req.params.id });
    ok(res);
  } catch(e) { err(res, e.message); }
});

// 관리자 답변 저장 (PUT /api/orders/:id/reply)
app.put('/api/orders/:id/reply', async (req, res) => {
  try {
    const { text } = req.body;
    await pool.execute(
      'UPDATE orders SET admin_reply=?, reply_at=NOW() WHERE id=?',
      [text||'', req.params.id]
    );
    broadcast('order_reply', { orderId: req.params.id });
    ok(res);
  } catch(e) { err(res, e.message); }
});

// 주문 삭제 (DELETE /api/orders/:id)
app.delete('/api/orders/:id', async (req, res) => {
  try {
    const [r] = await pool.execute('DELETE FROM orders WHERE id=?', [req.params.id]);
    if (r.affectedRows === 0) return err(res, '주문 없음', 404);
    broadcast('order_delete', { orderId: req.params.id });
    ok(res);
  } catch(e) { err(res, e.message); }
});

// ── customers_master CRUD ──────────────────────────────────────
// GET /api/customers-master?phone=xxx&device_id=xxx
// JOIN: customers_master (저장 주소) + customers (주문이력) — 조인키: phone
app.get('/api/customers-master', async (req, res) => {
  try {
    const phone = (req.query.phone||'').replace(/[^0-9]/g,'');
    const deviceId = (req.query.device_id||'').trim();
    const pCond = 'REGEXP_REPLACE(phone,"[^0-9]","")';

    // device_id만 있으면 기기 자동 인식 (이름/전화 선입력용)
    if(deviceId && !phone){
      const [rows] = await pool.execute(
        'SELECT * FROM customers_master WHERE device_id=? ORDER BY updated_at DESC LIMIT 1',
        [deviceId]
      );
      return ok(res, {items: rows, history: [], device_match: rows.length>0});
    }

    // 1. customers_master 저장 주소
    const [master] = phone
      ? await pool.execute(`SELECT * FROM customers_master WHERE ${pCond}=? ORDER BY updated_at DESC`,[phone])
      : await pool.execute('SELECT * FROM customers_master ORDER BY updated_at DESC');

    // 2. orders 주문이력 중 master에 없는 주소 (phone 기준 조회, addr 중복 제거)
    const masterAddrs = new Set(master.flatMap(r => [r.addr1,r.addr2,r.addr3].filter(Boolean)));
    const [hist] = phone
      ? await pool.execute(
          `SELECT name, phone, addr, memo FROM orders
            WHERE ${pCond}=? AND addr IS NOT NULL AND addr!=''
            GROUP BY addr ORDER BY MAX(date) DESC LIMIT 20`,
          [phone])
      : [[]];
    const history = hist.filter(r => !masterAddrs.has(r.addr));

    ok(res, {items: master, history});
  } catch(e) { err(res, e.message); }
});

// POST /api/customers-master
app.post('/api/customers-master', async (req, res) => {
  try {
    const {name,phone,addr1,addr2,addr3,memo,device_id} = req.body;
    if(!phone||!addr1) return err(res,'phone and addr1 required',400);
    const [r] = await pool.execute(
      'INSERT INTO customers_master (name,phone,addr1,addr2,addr3,memo,device_id) VALUES (?,?,?,?,?,?,?)',
      [name||'',phone,addr1,addr2||null,addr3||null,memo||'',device_id||null]
    );
    ok(res, {id: r.insertId});
  } catch(e) { err(res, e.message); }
});

// PUT /api/customers-master/:id
app.put('/api/customers-master/:id', async (req, res) => {
  try {
    const {name,phone,addr1,addr2,addr3,memo,device_id} = req.body;
    await pool.execute(
      'UPDATE customers_master SET name=?,phone=?,addr1=?,addr2=?,addr3=?,memo=?,device_id=COALESCE(?,device_id) WHERE id=?',
      [name||'',phone,addr1,addr2||null,addr3||null,memo||'',device_id||null,req.params.id]
    );
    ok(res);
  } catch(e) { err(res, e.message); }
});

// DELETE /api/customers-master/:id
app.delete('/api/customers-master/:id', async (req, res) => {
  try {
    await pool.execute('DELETE FROM customers_master WHERE id=?',[req.params.id]);
    ok(res);
  } catch(e) { err(res, e.message); }
});

// ══════════════════════════════════════════════════════════════
// 설정
// ══════════════════════════════════════════════════════════════

// 설정 로드 (GET /api/settings)
app.get('/api/settings', async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT k, v FROM settings');
    const data = {};
    rows.forEach(r => {
      try { data[r.k] = JSON.parse(r.v); } catch { data[r.k] = r.v; }
    });
    ok(res, { data });
  } catch(e) { err(res, e.message); }
});

// 설정 저장 (POST /api/settings)
app.post('/api/settings', async (req, res) => {
  try {
    const data = req.body.data || req.body;
    const conn = await pool.getConnection();
    await conn.beginTransaction();
    for (const [k, v] of Object.entries(data)) {
      const val = typeof v === 'object' ? JSON.stringify(v) : String(v);
      await conn.execute(
        'INSERT INTO settings (k,v) VALUES (?,?) ON DUPLICATE KEY UPDATE v=?',
        [k, val, val]
      );
    }
    await conn.commit();
    conn.release();
    ok(res);
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
      created_at DATETIME DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS customers (
      id INT AUTO_INCREMENT PRIMARY KEY,
      date DATE,
      name VARCHAR(100),
      phone VARCHAR(30),
      addr VARCHAR(500),
      memo VARCHAR(1000),
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
      updated_at DATETIME DEFAULT NOW() ON UPDATE NOW()
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
    )`
  ];
  const conn = await pool.getConnection();
  try {
    for (const sql of sqls) await conn.execute(sql);
    // 기존 DB에 컬럼이 없을 경우 추가
    await conn.execute(`ALTER TABLE orders ADD COLUMN addreq_acked TINYINT(1) DEFAULT 0`).catch(()=>{});
    await conn.execute(`ALTER TABLE orders ADD COLUMN device_id VARCHAR(64)`).catch(()=>{});
    // ── 메뉴 정규화: daily_menus.menu_id(→menus.id) + menus.menu_desc ──
    await conn.execute(`ALTER TABLE daily_menus ADD COLUMN menu_id INT`).catch(()=>{});
    await conn.execute(`ALTER TABLE daily_menus ADD INDEX idx_menu (menu_id)`).catch(()=>{});
    // `desc`는 MySQL 예약어라 ODKU VALUES() 내부에서 버그 유발 → menu_desc로 rename
    await conn.execute(`ALTER TABLE menus CHANGE \`desc\` menu_desc TEXT`).catch(()=>{});
    await conn.execute(`ALTER TABLE menus ADD COLUMN menu_desc TEXT`).catch(()=>{});
    // 최초 1회: 기존 일자별 메뉴를 마스터에 등록 후 menu_id 연결
    const [[migMenu]] = await conn.execute(`SELECT v FROM settings WHERE k='menu_id_migrated_v1'`).catch(()=>[[null]]);
    if(!migMenu){
      await conn.execute(`INSERT IGNORE INTO menus(name,cat,price,child,img_url) SELECT name,MAX(cat),MAX(price),MAX(child),MAX(img_url) FROM daily_menus WHERE name IS NOT NULL AND name<>'' GROUP BY name`).catch(()=>{});
      await conn.execute(`UPDATE daily_menus d JOIN menus m ON d.name=m.name SET d.menu_id=m.id WHERE d.menu_id IS NULL`).catch(()=>{});
      await conn.execute(`INSERT IGNORE INTO settings(k,v) VALUES('menu_id_migrated_v1','done')`).catch(()=>{});
      console.log('menu_id 마이그레이션 완료');
    }
    // 최초 1회: addreq_acked 컬럼 도입 전 기존 레코드 일괄 ack 처리
    const [[migRow]] = await conn.execute(`SELECT v FROM settings WHERE k='addreq_acked_migrated_v1'`).catch(()=>[[null]]);
    if(!migRow){
      await conn.execute(`UPDATE orders SET addreq_acked=1 WHERE additional_request IS NOT NULL AND additional_request!=''`).catch(()=>{});
      await conn.execute(`INSERT IGNORE INTO settings(k,v) VALUES('addreq_acked_migrated_v1','done')`).catch(()=>{});
      console.log('addreq_acked 마이그레이션 완료');
    }
    // 최초 1회: icon 컬럼 추가 + img_url→icon 복사 + CSV로 img_url 갱신
    const [[iconMig]] = await conn.execute(`SELECT v FROM settings WHERE k='icon_col_v2'`).catch(()=>[[null]]);
    if(!iconMig){
      // IF NOT EXISTS 미지원 MySQL 대비 — SHOW COLUMNS로 존재 여부 확인 후 추가
      const [[iconColRow]] = await conn.execute(`SHOW COLUMNS FROM menus LIKE 'icon'`).catch(()=>[[null]]);
      if(!iconColRow){
        await conn.execute(`ALTER TABLE menus ADD COLUMN icon VARCHAR(1000) DEFAULT ''`);
        console.log('icon 컬럼 추가 완료');
      }
      await conn.execute(`UPDATE menus SET icon=img_url WHERE img_url IS NOT NULL AND img_url!='' AND (icon IS NULL OR icon='')`).catch(()=>{});
      // CSV 파싱 → img_url 갱신
      try {
        const fs  = require('fs');
        const csv = fs.readFileSync(path.join(__dirname,'..','menu_image_list_full.csv'),'utf8');
        const lines = csv.replace(/\r/g,'').split('\n').filter(l=>l.trim());
        let updated=0;
        for(let i=1;i<lines.length;i++){
          const cols=[]; let cur='',inQ=false;
          for(const ch of lines[i]){
            if(ch==='"'){inQ=!inQ;}
            else if(ch===','&&!inQ){cols.push(cur);cur='';}
            else cur+=ch;
          }
          cols.push(cur);
          if(cols.length>=4&&cols[3].trim()){
            const [r]=await conn.execute('UPDATE menus SET img_url=? WHERE name=?',[cols[3].trim(),cols[1].trim()]);
            updated+=r.affectedRows;
          }
        }
        console.log(`CSV img_url 갱신: ${updated}건`);
      } catch(e){ console.warn('CSV 읽기 실패(무시):', e.message); }
      await conn.execute(`INSERT IGNORE INTO settings(k,v) VALUES('icon_col_v2','done')`).catch(()=>{});
      console.log('icon 컬럼 마이그레이션 완료');
    }
    // daily_menus img_url 컬럼 제거 (이미지는 menus 마스터에서만 관리)
    const [[dailyImgMig]] = await conn.execute(`SELECT v FROM settings WHERE k='daily_no_imgurl_v1'`).catch(()=>[[null]]);
    if(!dailyImgMig){
      const [[imgCol]] = await conn.execute(`SHOW COLUMNS FROM daily_menus LIKE 'img_url'`).catch(()=>[[null]]);
      if(imgCol){ await conn.execute(`ALTER TABLE daily_menus DROP COLUMN img_url`).catch(()=>{}); }
      await conn.execute(`INSERT IGNORE INTO settings(k,v) VALUES('daily_no_imgurl_v1','done')`).catch(()=>{});
      console.log('daily_menus img_url 컬럼 제거 완료');
    }
    // menu_image_list_retry.csv → img_url 갱신 (ERROR 상태 메뉴 재처리)
    const [[retryMig]] = await conn.execute(`SELECT v FROM settings WHERE k='retry_img_v1'`).catch(()=>[[null]]);
    if(!retryMig){
      try {
        const fs = require('fs');
        const csv = fs.readFileSync(path.join(__dirname,'..','menu_image_list_retry.csv'),'utf8');
        const lines = csv.replace(/\r/g,'').split('\n').filter(l=>l.trim());
        let updated=0;
        for(let i=1;i<lines.length;i++){
          const cols=[]; let cur='',inQ=false;
          for(const ch of lines[i]){
            if(ch==='"'){inQ=!inQ;}
            else if(ch===','&&!inQ){cols.push(cur);cur='';}
            else cur+=ch;
          }
          cols.push(cur);
          if(cols.length>=3&&cols[2].trim()){
            const [r]=await conn.execute('UPDATE menus SET img_url=? WHERE name=?',[cols[2].trim(),cols[0].trim()]);
            updated+=r.affectedRows;
          }
        }
        console.log(`retry CSV img_url 갱신: ${updated}건`);
      } catch(e){ console.warn('retry CSV 읽기 실패:', e.message); }
      await conn.execute(`INSERT IGNORE INTO settings(k,v) VALUES('retry_img_v1','done')`).catch(()=>{});
    }
    // retry CSV v2 — 26건 추가 갱신
    const [[retryMig2]] = await conn.execute(`SELECT v FROM settings WHERE k='retry_img_v2'`).catch(()=>[[null]]);
    if(!retryMig2){
      try {
        const fs = require('fs');
        const csv = fs.readFileSync(path.join(__dirname,'..','menu_image_list_retry.csv'),'utf8');
        const lines = csv.replace(/\r/g,'').split('\n').filter(l=>l.trim());
        let updated=0;
        for(let i=1;i<lines.length;i++){
          const cols=[]; let cur='',inQ=false;
          for(const ch of lines[i]){
            if(ch==='"'){inQ=!inQ;}
            else if(ch===','&&!inQ){cols.push(cur);cur='';}
            else cur+=ch;
          }
          cols.push(cur);
          if(cols.length>=3&&cols[2].trim()){
            const [r]=await conn.execute('UPDATE menus SET img_url=? WHERE name=?',[cols[2].trim(),cols[0].trim()]);
            updated+=r.affectedRows;
          }
        }
        console.log(`retry CSV v2 img_url 갱신: ${updated}건`);
      } catch(e){ console.warn('retry CSV v2 읽기 실패:', e.message); }
      await conn.execute(`INSERT IGNORE INTO settings(k,v) VALUES('retry_img_v2','done')`).catch(()=>{});
    }
    // retry CSV v3 — 빈 img_url 메뉴 추가 갱신
    const [[retryMig3]] = await conn.execute(`SELECT v FROM settings WHERE k='retry_img_v3'`).catch(()=>[[null]]);
    if(!retryMig3){
      try {
        const fs = require('fs');
        const csv = fs.readFileSync(path.join(__dirname,'..','menu_image_list_retry.csv'),'utf8');
        const lines = csv.replace(/\r/g,'').split('\n').filter(l=>l.trim());
        let updated=0;
        for(let i=1;i<lines.length;i++){
          const cols=[]; let cur='',inQ=false;
          for(const ch of lines[i]){
            if(ch==='"'){inQ=!inQ;}
            else if(ch===','&&!inQ){cols.push(cur);cur='';}
            else cur+=ch;
          }
          cols.push(cur);
          if(cols.length>=3&&cols[2].trim()){
            const [r]=await conn.execute('UPDATE menus SET img_url=? WHERE name=?',[cols[2].trim(),cols[0].trim()]);
            updated+=r.affectedRows;
          }
        }
        console.log(`retry CSV v3 img_url 갱신: ${updated}건`);
      } catch(e){ console.warn('retry CSV v3 읽기 실패:', e.message); }
      await conn.execute(`INSERT IGNORE INTO settings(k,v) VALUES('retry_img_v3','done')`).catch(()=>{});
    }
    // +/& 중복 메뉴 병합 (count 높은 쪽 유지, daily_menus 참조 이전 후 삭제)
    const [[dupMig]] = await conn.execute(`SELECT v FROM settings WHERE k='merge_dup_v1'`).catch(()=>[[null]]);
    if(!dupMig){
      const [allMenus] = await conn.execute('SELECT id, name, cat, price, stock, child, img_url, icon, menu_desc, count FROM menus');
      const norm = s => s.replace(/\s*[+&]\s*/g,' ').replace(/\s+/g,' ').trim();
      const groups = {};
      allMenus.forEach(r => { const k=norm(r.name); if(!groups[k])groups[k]=[]; groups[k].push(r); });
      let merged=0;
      for(const [,items] of Object.entries(groups)){
        if(items.length<2) continue;
        // count 내림차순, 같으면 id 오름차순으로 정렬 → 첫번째가 master
        items.sort((a,b)=>(b.count-a.count)||a.id-b.id);
        const master=items[0];
        for(let i=1;i<items.length;i++){
          const dup=items[i];
          // count 합산, img_url/icon 없으면 dup 것 사용
          const newCount=(master.count||0)+(dup.count||0);
          const newImg=master.img_url||dup.img_url||'';
          const newIcon=master.icon||dup.icon||'';
          await conn.execute('UPDATE menus SET count=?, img_url=?, icon=? WHERE id=?',[newCount,newImg,newIcon,master.id]);
          // daily_menus 참조 이전
          await conn.execute('UPDATE daily_menus SET menu_id=?, name=? WHERE menu_id=?',[master.id,master.name,dup.id]).catch(()=>{});
          // 중복 삭제
          await conn.execute('DELETE FROM menus WHERE id=?',[dup.id]);
          console.log(`병합: "${dup.name}"(id=${dup.id}) → "${master.name}"(id=${master.id})`);
          merged++;
        }
      }
      await conn.execute(`INSERT IGNORE INTO settings(k,v) VALUES('merge_dup_v1','done')`).catch(()=>{});
      console.log(`+/& 중복 병합 완료: ${merged}건`);
    }
    // icon 비정상(ERROR/빈값/null/비http) → 이모지로 갱신
    const [[iconEmojiMig]] = await conn.execute(`SELECT v FROM settings WHERE k='icon_emoji_v1'`).catch(()=>[[null]]);
    if(!iconEmojiMig){
      const MENU_KW=[['삼계탕','🐓'],['찜닭','🐔'],['닭강정','🍗'],['닭갈비','🍗'],['닭볶음','🍗'],['닭가슴살','🍗'],['닭다리','🍗'],['닭한마리','🐓'],['닭개장','🍲'],['치킨','🍗'],['지코바','🍗'],['치코바','🍗'],['유린기','🍗'],['춘천닭','🍗'],['안동찜닭','🍗'],['버터치킨','🍛'],['불고기','🥩'],['갈비찜','🍖'],['갈비','🍖'],['등갈비','🍖'],['바싹불고기','🥩'],['육수불고기','🥩'],['사태','🥩'],['육전','🥩'],['떡갈비','🍖'],['함박','🍔'],['미트로프','🍖'],['동그랑땡','🍢'],['제육','🥩'],['불백','🥩'],['맥적','🥩'],['직화','🔥'],['스테이크','🥩'],['찹스테이크','🥩'],['수육','🍖'],['한우','🥩'],['삼겹','🥩'],['목살','🥩'],['등심카츠','🍱'],['안심카츠','🍱'],['카츠','🍱'],['동파육','🍖'],['감자탕','🍲'],['족발','🍖'],['오리불고기','🦆'],['훈제오리','🦆'],['오리냉채','🦆'],['오리','🦆'],['새우','🦐'],['쉬림프','🦐'],['낙지','🐙'],['쭈꾸미','🐙'],['주꾸미','🐙'],['오징어','🦑'],['꽃게','🦀'],['바지락','🦪'],['굴','🦪'],['꼬막','🦪'],['홍합','🦪'],['전복','🐚'],['아구','🐟'],['아귀','🐟'],['연어','🐟'],['고등어','🐟'],['가자미','🐟'],['광어','🐟'],['동태','🐟'],['황태','🐟'],['북어','🐟'],['명태','🐟'],['코다리','🐟'],['임연수','🐟'],['조기','🐟'],['열기','🐟'],['삼치','🐟'],['꽁치','🐟'],['노가리','🐟'],['알탕','🥚'],['명란','🍳'],['백합','🦪'],['해물','🦐'],['된장찌개','🍲'],['청국장','🍲'],['김치찌개','🍲'],['순두부','🍲'],['부대찌개','🍲'],['찌개','🍲'],['전골','🍲'],['미역국','🍜'],['미역','🍜'],['뭇국','🍜'],['탕국','🍜'],['곰탕','🍜'],['해장국','🍜'],['육개장','🍜'],['연포탕','🍜'],['꽃게탕','🦀'],['해물탕','🦐'],['짬뽕','🍜'],['황태국','🐟'],['북어국','🐟'],['콩나물국','🌱'],['쑥국','🌿'],['시금치국','🥬'],['찜','🫕'],['조림','🍱'],['볶음','🍳'],['구이','🔥'],['무침','🌿'],['냉채','🥗'],['샐러드','🥗'],['나물','🌿'],['겉절이','🥬'],['시래기','🌿'],['취나물','🌿'],['곤드레','🌿'],['봄나물','🌿'],['콩나물','🌱'],['숙주','🌱'],['시금치','🥬'],['배추','🥬'],['봄동','🥬'],['열무','🥬'],['두부','🫙'],['계란','🥚'],['달걀','🥚'],['에그','🥚'],['계란말이','🍳'],['에그마요','🥚'],['죽','🍚'],['솥밥','🍚'],['덮밥','🍚'],['비빔밥','🍚'],['국밥','🍚'],['볶음밥','🍚'],['약밥','🍚'],['알밥','🍚'],['떡볶이','🍢'],['가래떡','🍢'],['떡잡채','🍢'],['파스타','🍝'],['라구','🍝'],['라자냐','🍝'],['리조또','🍝'],['냉모밀','🍜'],['소바','🍜'],['메밀','🍜'],['쌀국수','🍜'],['잡채','🍜'],['칼국수','🍜'],['국수','🍜'],['전','🥞'],['부침','🥞'],['빈대떡','🥞'],['강정','🍡'],['탕수','🍡'],['튀김','🍟'],['치즈볼','🧀'],['스프','🥣'],['크림','🥛'],['스튜','🍲'],['카레','🍛'],['하이라이스','🍛'],['만두','🥟'],['어묵','🍢'],['꼬치','🍢'],['샌드위치','🥪'],['바게트','🥖'],['케잌','🎂'],['마들렌','🧁'],['과일','🍎'],['딸기','🍓'],['요거트','🥛'],['식혜','🍶'],['장아찌','🫙'],['젓갈','🫙'],['고추장','🌶'],['잼','🍯'],['밀키트','📦'],['샤브','📦'],['밀푀유','📦'],['스키야키','📦'],['월남쌈','📦'],['유부초밥','🍱'],['김밥','🍱'],['초밥','🍣'],['연근','🪷'],['우엉','🪵'],['더덕','🌿'],['마늘','🧄']];
      const CAT_EMOJI={'메인':'🍱','한우':'🥩','한돈':'🥩','반찬':'🌿','김치':'🥬','밀키트':'📦','기타':'🍽'};
      const getEmoji=(name,cat)=>{const n=(name||'').toLowerCase();for(const [k,e] of MENU_KW){if(n.includes(k))return e;}return CAT_EMOJI[cat]||'🍽';};
      const validUrl=u=>u&&u!=='ERROR'&&u.startsWith('http');
      const [rows]=await conn.execute('SELECT id,name,cat,icon FROM menus');
      let updated=0;
      for(const r of rows){
        if(!validUrl(r.icon)){
          const emoji=getEmoji(r.name,r.cat);
          await conn.execute('UPDATE menus SET icon=? WHERE id=?',[emoji,r.id]);
          updated++;
        }
      }
      await conn.execute(`INSERT IGNORE INTO settings(k,v) VALUES('icon_emoji_v1','done')`).catch(()=>{});
      console.log(`icon 이모지 갱신: ${updated}건`);
    }
    // icon이 http URL이면 이모지로 교체 (icon은 이모지 전용)
    const [[iconEmojiMig2]] = await conn.execute(`SELECT v FROM settings WHERE k='icon_emoji_v2'`).catch(()=>[[null]]);
    if(!iconEmojiMig2){
      const MENU_KW2=[['삼계탕','🐓'],['찜닭','🐔'],['닭강정','🍗'],['닭갈비','🍗'],['닭볶음','🍗'],['닭가슴살','🍗'],['닭다리','🍗'],['닭한마리','🐓'],['닭개장','🍲'],['치킨','🍗'],['지코바','🍗'],['치코바','🍗'],['유린기','🍗'],['춘천닭','🍗'],['안동찜닭','🍗'],['버터치킨','🍛'],['불고기','🥩'],['갈비찜','🍖'],['갈비','🍖'],['등갈비','🍖'],['바싹불고기','🥩'],['육수불고기','🥩'],['사태','🥩'],['육전','🥩'],['떡갈비','🍖'],['함박','🍔'],['미트로프','🍖'],['동그랑땡','🍢'],['제육','🥩'],['불백','🥩'],['맥적','🥩'],['직화','🔥'],['스테이크','🥩'],['찹스테이크','🥩'],['수육','🍖'],['한우','🥩'],['삼겹','🥩'],['목살','🥩'],['등심카츠','🍱'],['안심카츠','🍱'],['카츠','🍱'],['동파육','🍖'],['감자탕','🍲'],['족발','🍖'],['오리불고기','🦆'],['훈제오리','🦆'],['오리냉채','🦆'],['오리','🦆'],['새우','🦐'],['쉬림프','🦐'],['낙지','🐙'],['쭈꾸미','🐙'],['주꾸미','🐙'],['오징어','🦑'],['꽃게','🦀'],['바지락','🦪'],['굴','🦪'],['꼬막','🦪'],['홍합','🦪'],['전복','🐚'],['아구','🐟'],['아귀','🐟'],['연어','🐟'],['고등어','🐟'],['가자미','🐟'],['광어','🐟'],['동태','🐟'],['황태','🐟'],['북어','🐟'],['명태','🐟'],['코다리','🐟'],['임연수','🐟'],['조기','🐟'],['열기','🐟'],['삼치','🐟'],['꽁치','🐟'],['노가리','🐟'],['알탕','🥚'],['명란','🍳'],['백합','🦪'],['해물','🦐'],['된장찌개','🍲'],['청국장','🍲'],['김치찌개','🍲'],['순두부','🍲'],['부대찌개','🍲'],['찌개','🍲'],['전골','🍲'],['미역국','🍜'],['미역','🍜'],['뭇국','🍜'],['탕국','🍜'],['곰탕','🍜'],['해장국','🍜'],['육개장','🍜'],['연포탕','🍜'],['꽃게탕','🦀'],['해물탕','🦐'],['짬뽕','🍜'],['황태국','🐟'],['북어국','🐟'],['콩나물국','🌱'],['쑥국','🌿'],['시금치국','🥬'],['찜','🫕'],['조림','🍱'],['볶음','🍳'],['구이','🔥'],['무침','🌿'],['냉채','🥗'],['샐러드','🥗'],['나물','🌿'],['겉절이','🥬'],['시래기','🌿'],['취나물','🌿'],['곤드레','🌿'],['봄나물','🌿'],['콩나물','🌱'],['숙주','🌱'],['시금치','🥬'],['배추','🥬'],['봄동','🥬'],['열무','🥬'],['두부','🫙'],['계란','🥚'],['달걀','🥚'],['에그','🥚'],['계란말이','🍳'],['에그마요','🥚'],['죽','🍚'],['솥밥','🍚'],['덮밥','🍚'],['비빔밥','🍚'],['국밥','🍚'],['볶음밥','🍚'],['약밥','🍚'],['알밥','🍚'],['떡볶이','🍢'],['가래떡','🍢'],['떡잡채','🍢'],['파스타','🍝'],['라구','🍝'],['라자냐','🍝'],['리조또','🍝'],['냉모밀','🍜'],['소바','🍜'],['메밀','🍜'],['쌀국수','🍜'],['잡채','🍜'],['칼국수','🍜'],['국수','🍜'],['전','🥞'],['부침','🥞'],['빈대떡','🥞'],['강정','🍡'],['탕수','🍡'],['튀김','🍟'],['치즈볼','🧀'],['스프','🥣'],['크림','🥛'],['스튜','🍲'],['카레','🍛'],['하이라이스','🍛'],['만두','🥟'],['어묵','🍢'],['꼬치','🍢'],['샌드위치','🥪'],['바게트','🥖'],['케잌','🎂'],['마들렌','🧁'],['과일','🍎'],['딸기','🍓'],['요거트','🥛'],['식혜','🍶'],['장아찌','🫙'],['젓갈','🫙'],['고추장','🌶'],['잼','🍯'],['밀키트','📦'],['샤브','📦'],['밀푀유','📦'],['스키야키','📦'],['월남쌈','📦'],['유부초밥','🍱'],['김밥','🍱'],['초밥','🍣'],['연근','🪷'],['우엉','🪵'],['더덕','🌿'],['마늘','🧄']];
      const CAT_EMOJI2={'메인':'🍱','한우':'🥩','한돈':'🥩','반찬':'🌿','김치':'🥬','밀키트':'📦','기타':'🍽'};
      const getEmoji2=(name,cat)=>{const n=(name||'').toLowerCase();for(const [k,e] of MENU_KW2){if(n.includes(k))return e;}return CAT_EMOJI2[cat]||'🍽';};
      const [rows2]=await conn.execute("SELECT id,name,cat,icon FROM menus WHERE icon LIKE 'http%'");
      let updated2=0;
      for(const r of rows2){
        await conn.execute('UPDATE menus SET icon=? WHERE id=?',[getEmoji2(r.name,r.cat),r.id]);
        updated2++;
      }
      await conn.execute(`INSERT IGNORE INTO settings(k,v) VALUES('icon_emoji_v2','done')`).catch(()=>{});
      console.log(`icon URL→이모지 교체: ${updated2}건`);
    }
    // 특정 기본 Pexels URL → 빈값으로 초기화
    const [[clearUrlMig]] = await conn.execute(`SELECT v FROM settings WHERE k='clear_default_url_v1'`).catch(()=>[[null]]);
    if(!clearUrlMig){
      const DEFAULT_URL='https://images.pexels.com/photos/2781540/pexels-photo-2781540.jpeg?auto=compress&cs=tinysrgb&h=650&w=940';
      const [r]=await conn.execute('UPDATE menus SET img_url=? WHERE img_url=?',['' ,DEFAULT_URL]);
      await conn.execute(`INSERT IGNORE INTO settings(k,v) VALUES('clear_default_url_v1','done')`).catch(()=>{});
      console.log(`기본 URL 초기화: ${r.affectedRows}건`);
    }
    // customers_master: device_id 컬럼 추가
    const [[devIdMig]] = await conn.execute(`SELECT v FROM settings WHERE k='cm_device_id_v1'`).catch(()=>[[null]]);
    if(!devIdMig){
      await conn.execute(`ALTER TABLE customers_master ADD COLUMN IF NOT EXISTS device_id VARCHAR(100) DEFAULT NULL`).catch(()=>{});
      await conn.execute(`INSERT IGNORE INTO settings(k,v) VALUES('cm_device_id_v1','done')`).catch(()=>{});
      console.log('customers_master device_id 컬럼 추가 완료');
    }
    // customers_master: addr → addr1/addr2/addr3 마이그레이션
    const [[cmAddrMig]] = await conn.execute(`SELECT v FROM settings WHERE k='cm_addr3_v1'`).catch(()=>[[null]]);
    if(!cmAddrMig){
      const [[addrCol]] = await conn.execute(`SHOW COLUMNS FROM customers_master LIKE 'addr'`).catch(()=>[[null]]);
      if(addrCol){
        await conn.execute(`ALTER TABLE customers_master CHANGE addr addr1 VARCHAR(500) NOT NULL`).catch(()=>{});
        console.log('customers_master addr→addr1 완료');
      }
      await conn.execute(`INSERT IGNORE INTO settings(k,v) VALUES('cm_addr3_v1','done')`).catch(()=>{});
    }
    // customers_master: addr2/addr3 컬럼 보완 (별도 키로 항상 체크)
    const [[addr23Mig]] = await conn.execute(`SELECT v FROM settings WHERE k='cm_addr23_v1'`).catch(()=>[[null]]);
    if(!addr23Mig){
      const [[addr2Col]] = await conn.execute(`SHOW COLUMNS FROM customers_master LIKE 'addr2'`).catch(()=>[[null]]);
      if(!addr2Col) await conn.execute(`ALTER TABLE customers_master ADD COLUMN addr2 VARCHAR(500) DEFAULT NULL AFTER addr1`).catch(()=>{});
      const [[addr3Col]] = await conn.execute(`SHOW COLUMNS FROM customers_master LIKE 'addr3'`).catch(()=>[[null]]);
      if(!addr3Col) await conn.execute(`ALTER TABLE customers_master ADD COLUMN addr3 VARCHAR(500) DEFAULT NULL AFTER addr2`).catch(()=>{});
      await conn.execute(`INSERT IGNORE INTO settings(k,v) VALUES('cm_addr23_v1','done')`).catch(()=>{});
      console.log('customers_master addr2/addr3 보완 완료');
    }
    console.log('DB 테이블 초기화 완료');
  } finally {
    conn.release();
  }
}



initDB()
  .then(() => app.listen(PORT, () => console.log(`onban-api running on :${PORT}`)))
  .catch(e => { console.error('DB 초기화 실패:', e.message); process.exit(1); });
