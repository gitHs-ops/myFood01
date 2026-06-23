require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const mysql   = require('mysql2/promise');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ── DB 연결 풀 ──────────────────────────────────────────────
const pool = mysql.createPool({
  host:              process.env.MYSQL_HOST,
  port:              Number(process.env.MYSQL_PORT) || 3306,
  user:              process.env.MYSQL_USER,
  password:          process.env.MYSQL_PASSWORD,
  database:          process.env.MYSQL_DATABASE,
  waitForConnections: true,
  connectionLimit:   10,
  timezone:          '+09:00'
});

const ok  = (res, data={}) => res.json({ success: true,  ...data });
const err = (res, msg, status=500) => res.status(status).json({ success: false, error: msg });

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
    await conn.execute('TRUNCATE TABLE menus');
    const rows = list.map(m => [
      m.name, m.cat||'기타', m.price||0, m.stock||0,
      m.child?1:0, m.imgUrl||'', m.count||0, m.updatedAt||0
    ]);
    await conn.query(
      'INSERT INTO menus (name,cat,price,stock,child,img_url,count,updated_at) VALUES ?',
      [rows]
    );
    await conn.commit();
    conn.release();
    ok(res, { count: rows.length });
  } catch(e) { err(res, e.message); }
});

// 전체 메뉴 조회 (GET /api/menu/all)
app.get('/api/menu/all', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT name,cat,price,stock,child,img_url AS imgUrl,count,updated_at AS updatedAt FROM menus ORDER BY count DESC, name'
    );
    const menus = rows.map(r => ({ ...r, child: !!r.child }));
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
    const [rows] = await pool.execute(
      'SELECT name,cat,price,stock,child,img_url AS imgUrl FROM daily_menus WHERE date=? ORDER BY id',
      [req.params.date]
    );
    if (!rows.length) return err(res, `${req.params.date} 메뉴 없음`, 404);
    const menus = rows.map(r => ({ ...r, child: !!r.child }));
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
      const rows = byDate[date].map(m => [
        date, m.name, m.cat||'기타', m.price||0, m.stock||0,
        m.child?1:0, m.imgUrl||''
      ]);
      await conn.query(
        'INSERT INTO daily_menus (date,name,cat,price,stock,child,img_url) VALUES ?',
        [rows]
      );
    }
    await conn.commit();
    conn.release();
    ok(res, { sheets: dates.length, count: list.length });
  } catch(e) { err(res, e.message); }
});

// 특정 날짜 재고 업데이트 (PUT /api/menu/:date/stock)
app.put('/api/menu/:date/stock', async (req, res) => {
  try {
    const { name, stock } = req.body;
    await pool.execute(
      'UPDATE daily_menus SET stock=? WHERE date=? AND name=?',
      [stock, req.params.date, name]
    );
    ok(res);
  } catch(e) { err(res, e.message); }
});

// ══════════════════════════════════════════════════════════════
// 주문
// ══════════════════════════════════════════════════════════════

// 주문 조회 (GET /api/orders?date=&phone=)
app.get('/api/orders', async (req, res) => {
  try {
    const { date, phone } = req.query;
    let sql = 'SELECT * FROM orders WHERE 1=1';
    const params = [];
    if (date)  { sql += ' AND date=?';  params.push(date); }
    if (phone) { sql += ' AND phone=?'; params.push(phone); }
    sql += ' ORDER BY created_at DESC';
    const [rows] = await pool.execute(sql, params);
    const orders = rows.map(r => ({
      id: r.id, date: r.date, time: r.time,
      name: r.name, phone: r.phone, addr: r.addr, memo: r.memo,
      items: typeof r.items === 'string' ? JSON.parse(r.items) : (r.items||[]),
      total: r.total, status: r.status,
      adminReply: r.admin_reply, replyAt: r.reply_at,
      additionalRequest: r.additional_request,
      isReorder: !!r.is_reorder
    }));
    ok(res, { orders });
  } catch(e) { err(res, e.message); }
});

// 주문 저장/업데이트 (POST /api/orders)
app.post('/api/orders', async (req, res) => {
  try {
    const order = req.body.data || req.body;
    if (!order.id) return err(res, '주문 ID 없음', 400);
    const [exist] = await pool.execute('SELECT id FROM orders WHERE id=?', [order.id]);
    if (exist.length) {
      if (order.status) await pool.execute('UPDATE orders SET status=? WHERE id=?', [order.status, order.id]);
      return ok(res, { action: 'updated' });
    }
    await pool.execute(
      'INSERT INTO orders (id,date,time,name,phone,addr,memo,items,total,status,is_reorder,additional_request) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
      [
        order.id, order.date, order.time||'',
        order.name||'', order.phone||'', order.addr||'', order.memo||'',
        JSON.stringify(order.items||[]), order.total||0,
        order.status||'pending', order.isReorder?1:0,
        order.additionalRequest||''
      ]
    );
    ok(res, { action: 'inserted' });
  } catch(e) { err(res, e.message); }
});

// 주문 상태 변경 (PUT /api/orders/:id/status)
app.put('/api/orders/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    if (!status) return err(res, '상태 없음', 400);
    await pool.execute('UPDATE orders SET status=? WHERE id=?', [status, req.params.id]);
    ok(res);
  } catch(e) { err(res, e.message); }
});

// 추가요청 저장 (PUT /api/orders/:id/request)
app.put('/api/orders/:id/request', async (req, res) => {
  try {
    const { text } = req.body;
    await pool.execute('UPDATE orders SET additional_request=? WHERE id=?', [text||'', req.params.id]);
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
    ok(res);
  } catch(e) { err(res, e.message); }
});

// 주문 삭제 (DELETE /api/orders/:id)
app.delete('/api/orders/:id', async (req, res) => {
  try {
    const [r] = await pool.execute('DELETE FROM orders WHERE id=?', [req.params.id]);
    if (r.affectedRows === 0) return err(res, '주문 없음', 404);
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
app.listen(PORT, () => console.log(`onban-api running on :${PORT}`));
