// cleanup_old_reservations.js
// 2026-07-31 이전 reserve_date를 가진 예약주문(orders)을 영구 삭제한다.
// 프로그램 변경 전 남아있던 오래된 예약주문 잔재 정리용 1회성 스크립트.
require('dotenv').config();
const mysql = require('mysql2/promise');

const CUTOFF = '2026-07-31';

async function main() {
  const pool = mysql.createPool({
    host    : process.env.MYSQL_HOST,
    port    : process.env.MYSQL_PORT || 3306,
    user    : process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
    ssl     : { rejectUnauthorized: false },
  });

  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.execute(
      'SELECT id, name, phone, reserve_date, status, created_at FROM orders WHERE reserve_date IS NOT NULL AND reserve_date < ? ORDER BY reserve_date',
      [CUTOFF]
    );
    console.log(`🔍 ${CUTOFF} 이전 예약주문 ${rows.length}건 발견`);
    rows.forEach(r => console.log(`  - ${r.id} | ${r.name || '(이름없음)'} | 예약일 ${r.reserve_date} | 상태 ${r.status} | 신청 ${r.created_at}`));

    if (!rows.length) { console.log('삭제할 항목 없음 — 종료'); return; }

    const [result] = await conn.execute(
      'DELETE FROM orders WHERE reserve_date IS NOT NULL AND reserve_date < ?',
      [CUTOFF]
    );
    console.log(`✅ 삭제 완료: ${result.affectedRows}건`);
  } finally {
    conn.release();
    await pool.end();
  }
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
