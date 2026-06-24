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
    const [rows] = await pool.execute(
      'SELECT name,cat,price,stock,child,img_url AS imgUrl FROM daily_menus WHERE date=? ORDER BY id',
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

// 재고 증감 (POST /api/menu/:date/stock-adjust)  delta = +N/-N
app.post('/api/menu/:date/stock-adjust', async (req, res) => {
  try {
    const items = req.body.items || [];
    if (!items.length) return ok(res);
    const conn = await pool.getConnection();
    await conn.beginTransaction();
    for (const it of items) {
      await conn.execute(
        'UPDATE daily_menus SET stock = GREATEST(0, stock + ?) WHERE date=? AND name=?',
        [it.delta, req.params.date, it.name]
      );
    }
    await conn.commit();
    conn.release();
    ok(res);
  } catch(e) { err(res, e.message); }
});

// ══════════════════════════════════════════════════════════════
// 메뉴 재고 실시간 SSE
// ══════════════════════════════════════════════════════════════
const sseClients = new Map(); // date -> Set<res>
const sseSnapshots = {};      // date -> JSON string

app.get('/api/menu/stream', (req, res) => {
  const date = req.query.date;
  if (!date) return res.status(400).end();
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  res.write(':\n\n'); // keep-alive ping
  if (!sseClients.has(date)) sseClients.set(date, new Set());
  sseClients.get(date).add(res);
  req.on('close', () => { sseClients.get(date)?.delete(res); });
});

setInterval(async () => {
  for (const [date, clients] of sseClients.entries()) {
    if (!clients.size) continue;
    try {
      const [rows] = await pool.execute(
        'SELECT name, stock FROM daily_menus WHERE date=? ORDER BY name', [date]
      );
      const snap = JSON.stringify(rows.map(r => ({ n: r.name, s: r.stock })));
      if (sseSnapshots[date] !== snap) {
        sseSnapshots[date] = snap;
        const payload = `data: ${JSON.stringify(rows.map(r => ({ name: r.name, stock: r.stock })))}\n\n`;
        for (const client of clients) { try { client.write(payload); } catch(e) {} }
      }
    } catch(e) {}
  }
}, 3000);

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
    // mysql2 timezone:'+09:00'로 DATE컬럼이 KST자정(=UTC 전날15시)으로 반환 → +9h 보정
    const toDateStr = d => {
      if (d instanceof Date) { const kst=new Date(d.getTime()+9*60*60*1000); return kst.toISOString().slice(0,10); }
      return String(d||'').slice(0,10);
    };
    const orders = rows.map(r => ({
      id: r.id, date: toDateStr(r.date), time: r.time,
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
      const soldOut = [];
      for (const item of items) {
        const [rows] = await conn.execute(
          'SELECT stock FROM daily_menus WHERE date=? AND name=? FOR UPDATE',
          [date, item.name]
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
        await conn.execute(
          'UPDATE daily_menus SET stock = stock - ? WHERE date=? AND name=?',
          [item.qty || 1, date, item.name]
        );
      }

      // 주문 저장
      await conn.execute(
        'INSERT INTO orders (id,date,time,name,phone,addr,memo,items,total,status,is_reorder,additional_request) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
        [
          order.id, date, order.time||'',
          order.name||'', order.phone||'', order.addr||'', order.memo||'',
          JSON.stringify(items), order.total||0,
          order.status||'pending', order.isReorder?1:0,
          order.additionalRequest||''
        ]
      );
      await conn.commit(); conn.release();
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
      const wasActive = ['pending','confirmed','delivered'].includes(prev);
      const nowCancelled = status === 'cancelled';

      await conn.execute('UPDATE orders SET status=? WHERE id=?', [status, req.params.id]);

      // 취소 시 재고 복원
      if (wasActive && nowCancelled) {
        for (const item of items) {
          await conn.execute(
            'UPDATE daily_menus SET stock = stock + ? WHERE date=? AND name=?',
            [item.qty || 1, date, item.name]
          );
        }
      }

      await conn.commit(); conn.release();
      ok(res);
    } catch(e) { await conn.rollback(); conn.release(); throw e; }
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
async function initDB() {
  const sqls = [
    `CREATE TABLE IF NOT EXISTS daily_menus (
      id INT AUTO_INCREMENT PRIMARY KEY,
      date DATE NOT NULL,
      name VARCHAR(200) NOT NULL,
      cat VARCHAR(50) DEFAULT '기타',
      price DECIMAL(6,1) DEFAULT 0,
      stock INT DEFAULT 0,
      child TINYINT(1) DEFAULT 0,
      img_url VARCHAR(1000) DEFAULT '',
      INDEX idx_date (date)
    )`,
    `CREATE TABLE IF NOT EXISTS menus (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(200) UNIQUE NOT NULL,
      cat VARCHAR(50) DEFAULT '기타',
      price DECIMAL(6,1) DEFAULT 0,
      stock INT DEFAULT 0,
      child TINYINT(1) DEFAULT 0,
      img_url VARCHAR(1000) DEFAULT '',
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
      is_reorder TINYINT(1) DEFAULT 0,
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
    console.log('DB 테이블 초기화 완료');
  } finally {
    conn.release();
  }
}

initDB()
  .then(() => app.listen(PORT, () => console.log(`onban-api running on :${PORT}`)))
  .catch(e => { console.error('DB 초기화 실패:', e.message); process.exit(1); });
