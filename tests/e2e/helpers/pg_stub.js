// 작업349: 통합 시험용 pg 스텁. 실제 server.js 를 DATABASE_URL 없이 띄울 때 `node -r` 로 먼저 불러온다.
// 앱 코드는 바꾸지 않고 pg 의 Pool.query 만 대신한다: 단어장 조회(SELECT ... FROM wordbook)에만 시험 단어를 돌려주고,
// 그 밖의 SQL 은 빈 결과로 답하면서 표준 오류에 한 줄 남긴다(시험이 "예상 밖 DB 조회가 없었는지" 확인한다).
const pg = require('pg');
const WORDS = ['apple', 'book', 'water', 'happy', 'window', 'music', 'friend', 'garden', 'planet', 'river', 'cloud', 'bridge'];
const ROWS = WORDS.map((w, i) => ({ id: i + 1, word: w, lang: 'en', created_at: new Date(2026, 9, 1, 0, 0, 100 - i).toISOString(), data: { word: w, lang: 'en', short_meaning: w + ' 뜻' } }));
pg.Pool.prototype.query = async function (sql) {
  if (/FROM wordbook WHERE user_id/.test(String(sql))) return { rows: ROWS, rowCount: ROWS.length };
  process.stderr.write('[pg_stub] 예상 밖 SQL: ' + String(sql).replace(/\s+/g, ' ').slice(0, 80) + '\n');
  return { rows: [], rowCount: 0 };
};
