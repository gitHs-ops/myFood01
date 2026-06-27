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
            `UPDATE menus SET name=?,cat=?,price=?,stock=?,child=?,img_url=?,menu_desc=?,count=?,updated_at=? WHERE id=?`,
            [m.name, m.cat||'기타', m.price||0, m.stock||0, m.child?1:0, m.imgUrl||'', m.desc||'', m.count||0, m.updatedAt||0, m.menuId]
          );
          // rename 전파: 연결된 daily_menus의 비정규화 name도 갱신(옛 이름 잔존·중복 방지)
          await conn.execute(
            `UPDATE daily_menus SET name=? WHERE menu_id=? AND name<>?`,
            [m.name, m.menuId, m.name]
          );
        } else {
          await conn.execute(
            `INSERT INTO menus (name,cat,price,stock,child,img_url,menu_desc,count,updated_at)
             VALUES (?,?,?,?,?,?,?,?,?)
             ON DUPLICATE KEY UPDATE cat=VALUES(cat),price=VALUES(price),stock=VALUES(stock),
               child=VALUES(child),img_url=VALUES(img_url),menu_desc=VALUES(menu_desc),
               count=VALUES(count),updated_at=VALUES(updated_at)`,
            [m.name, m.cat||'기타', m.price||0, m.stock||0, m.child?1:0, m.imgUrl||'', m.desc||'', m.count||0, m.updatedAt||0]
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

// ── 임시 진단 (GET /api/debug/menu-search?q=톳) ──
// 이름에 q가 포함된 menus·daily_menus 행을 HEX·길이와 함께 반환 (인코딩/링크 점검)
app.get('/api/debug/menu-search', async (req, res) => {
  try {
    const q = '%' + (req.query.q || '') + '%';
    const [masters] = await pool.execute(
      'SELECT id, name, CHAR_LENGTH(name) AS len, HEX(name) AS hex FROM menus WHERE name LIKE ? ORDER BY id',
      [q]
    );
    const [dailies] = await pool.execute(
      "SELECT id, menu_id, DATE_FORMAT(date,'%Y-%m-%d') AS date, name, CHAR_LENGTH(name) AS len, HEX(name) AS hex FROM daily_menus WHERE name LIKE ? ORDER BY date DESC, id",
      [q]
    );
    ok(res, { masters, dailies });
  } catch(e) { err(res, e.message); }
});

// 마스터 단건 삭제 (POST /api/menu/master/delete)
// 일자별 목록(daily_menus)이 참조 중이면 삭제 차단하고 등록된 날짜 반환
app.post('/api/menu/master/delete', async (req, res) => {
  try {
    const body = req.body.data || req.body;
    const id = body.id || 0, name = body.name || '';
    const [dates] = await pool.execute(
      "SELECT DISTINCT DATE_FORMAT(date,'%Y-%m-%d') AS d FROM daily_menus WHERE menu_id=? OR name=? ORDER BY d DESC",
      [id, name]
    );
    if (dates.length) {
      return res.json({ success: false, blocked: true, dates: dates.map(r => r.d) });
    }
    await pool.execute('DELETE FROM menus WHERE id=? OR name=?', [id, name]);
    ok(res, { deleted: true });
  } catch(e) { err(res, e.message); }
});

// 전체 메뉴 조회 (GET /api/menu/all)
app.get('/api/menu/all', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT id AS menuId,name,cat,price,stock,child,img_url AS imgUrl,menu_desc AS `desc`,count,updated_at AS updatedAt FROM menus ORDER BY count DESC, name'
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
         COALESCE(m.img_url,m2.img_url,d.img_url) AS imgUrl,
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
          'INSERT INTO daily_menus (date,menu_id,name,cat,price,stock,child,img_url) VALUES (?,?,?,?,?,?,?,?)',
          [date, menuId, m.name, m.cat||'기타', m.price||0, m.stock||0, m.child?1:0, m.imgUrl||'']
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

// ══════════════════════════════════════════════════════════════
// 고객 정보
// ══════════════════════════════════════════════════════════════

// 고객 저장 (POST /api/customers)
app.post('/api/customers', async (req, res) => {
  try {
    const d = req.body.data || req.body;
    const [date, name, phone, addr, memo] = Array.isArray(d) ? d : [d.date,d.name,d.phone,d.addr,d.memo];
    await pool.execute(
      'INSERT INTO customers (date,name,phone,addr,memo) VALUES (?,?,?,?,?)',
      [date, name, phone, addr, memo]
    );
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
      img_url VARCHAR(1000) DEFAULT '',
      INDEX idx_date (date),
      INDEX idx_menu (menu_id)
    )`,
    `CREATE TABLE IF NOT EXISTS menus (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(200) UNIQUE NOT NULL,
      cat VARCHAR(50) DEFAULT '기타',
      price DECIMAL(6,1) DEFAULT 0,
      stock INT DEFAULT 0,
      child TINYINT(1) DEFAULT 0,
      img_url VARCHAR(1000) DEFAULT '',
      menu_desc TEXT,
      count INT DEFAULT 0,
      updated_at BIGINT DEFAULT 0
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
    console.log('DB 테이블 초기화 완료');
  } finally {
    conn.release();
  }
}

initDB()
  .then(() => app.listen(PORT, () => console.log(`onban-api running on :${PORT}`)))
  .catch(e => { console.error('DB 초기화 실패:', e.message); process.exit(1); });
