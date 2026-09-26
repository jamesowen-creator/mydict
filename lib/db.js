const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
});

async function initDB() {
  // Use a single dedicated client so all migration queries run sequentially
  // without triggering "client is already executing a query" warnings.
  const client = await pool.connect();
  try {
    await client.query("SET client_encoding = 'UTF8'");

    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id         SERIAL PRIMARY KEY,
        google_id  VARCHAR(255) UNIQUE NOT NULL,
        email      VARCHAR(255),
        name       VARCHAR(255),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    // Admin & permission columns (safe to run repeatedly)
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS role        VARCHAR(20)  DEFAULT 'user'`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_blocked  BOOLEAN      DEFAULT false`);
    // DEFAULT true here is intentional: ADD COLUMN backfills this default onto
    // every existing row, so pre-existing accounts (including the admin) are
    // grandfathered in as approved. New signups get is_approved set explicitly
    // in the INSERT (routes/auth.js), which overrides this table default.
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_approved BOOLEAN      DEFAULT true`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS can_search  BOOLEAN      DEFAULT true`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS can_wordbook BOOLEAN     DEFAULT true`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS can_quiz    BOOLEAN      DEFAULT true`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS can_tts     BOOLEAN      DEFAULT true`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS can_podcast BOOLEAN      DEFAULT true`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS perm_literature_compass BOOLEAN DEFAULT true`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS perm_digest_reading     BOOLEAN DEFAULT true`);

    // ── Name repair ───────────────────────────────────────────────────────────
    // Dump ALL user names with codepoints for diagnosis (no filter condition).
    const { rows: allUsers } = await client.query(
      'SELECT id, name FROM users WHERE name IS NOT NULL ORDER BY id'
    );
    for (const row of allUsers) {
      const codepoints = [...row.name]
        .map(c => 'U+' + c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0'))
        .join(' ');
      console.log('[DB] user ' + row.id + ' name="' + row.name + '" codepoints=' + codepoints);
    }

    // Repair: treat each char's code-point as a Latin-1 byte, re-decode as UTF-8.
    // Accepts the conversion only if:
    //   - result contains valid Korean (U+AC00-U+D7A3)  AND original did not
    //   - result does not contain U+FFFD (invalid UTF-8 sequence marker)
    // Does NOT rely on literal special chars in regex — safe across all encodings.
    const KOREAN_RE = /[가-힣]/;
    const FFFD      = '�';

    function tryLatinRepair(str) {
      if (KOREAN_RE.test(str)) return null;           // already has Korean — skip
      try {
        const candidate = Buffer.from(str, 'latin1').toString('utf8');
        if (candidate.includes(FFFD)) return null;   // invalid UTF-8 after conversion
        if (KOREAN_RE.test(candidate)) return candidate;
        return null;
      } catch { return null; }
    }

    let repairCount = 0;
    for (const row of allUsers) {
      let name = row.name;

      // Up to 2 passes for double-encoded names
      const p1 = tryLatinRepair(name);
      if (p1 !== null) {
        name = p1;
        const p2 = tryLatinRepair(name);
        if (p2 !== null) name = p2;
      }

      name = name.normalize('NFC');

      if (name !== row.name) {
        console.log('[DB] name repair: "' + row.name + '" -> "' + name + '"');
        await client.query('UPDATE users SET name = $1 WHERE id = $2', [name, row.id]);
        repairCount++;
      }
    }
    console.log('[DB] name repair: 복구 대상 ' + allUsers.length + '명 조회, 복구 완료 ' + repairCount + '명');

    // Dump again after repair so we can compare before/after in logs
    if (repairCount > 0) {
      const { rows: afterRows } = await client.query(
        'SELECT id, name FROM users WHERE name IS NOT NULL ORDER BY id'
      );
      for (const row of afterRows) {
        const codepoints = [...row.name]
          .map(c => 'U+' + c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0'))
          .join(' ');
        console.log('[DB] user(after) ' + row.id + ' name="' + row.name + '" codepoints=' + codepoints);
      }
    }

    await client.query(`
      CREATE TABLE IF NOT EXISTS wordbook (
        id         SERIAL PRIMARY KEY,
        user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
        word       VARCHAR(255) NOT NULL,
        lang       VARCHAR(50)  DEFAULT 'en',
        data       JSONB,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    // Metacognitive learning + concept dictionary columns (safe to run repeatedly)
    await client.query(`ALTER TABLE wordbook ADD COLUMN IF NOT EXISTS next_review       TIMESTAMP`);
    await client.query(`ALTER TABLE wordbook ADD COLUMN IF NOT EXISTS interval_days     INTEGER   DEFAULT 1`);
    await client.query(`ALTER TABLE wordbook ADD COLUMN IF NOT EXISTS ease_factor       FLOAT     DEFAULT 2.5`);
    await client.query(`ALTER TABLE wordbook ADD COLUMN IF NOT EXISTS repetitions       INTEGER   DEFAULT 0`);
    await client.query(`ALTER TABLE wordbook ADD COLUMN IF NOT EXISTS last_reviewed     TIMESTAMP`);
    await client.query(`ALTER TABLE wordbook ADD COLUMN IF NOT EXISTS example_sentence  TEXT`);
    await client.query(`ALTER TABLE wordbook ADD COLUMN IF NOT EXISTS entry_type        VARCHAR(10) DEFAULT 'word'`);
    await client.query(`ALTER TABLE wordbook ADD COLUMN IF NOT EXISTS correct_count     INTEGER   DEFAULT 0`);
    await client.query(`ALTER TABLE wordbook ADD COLUMN IF NOT EXISTS next_review_date  DATE`);
    await client.query(`ALTER TABLE wordbook ADD COLUMN IF NOT EXISTS review_count      INTEGER   DEFAULT 0`);
    console.log('[DB] wordbook migration complete (metacognitive + concept columns)');

    await client.query(`
      CREATE TABLE IF NOT EXISTS tts_cache (
        id         SERIAL PRIMARY KEY,
        text_key   VARCHAR(500) NOT NULL,
        lang       VARCHAR(10)  DEFAULT 'en',
        audio      BYTEA        NOT NULL,
        created_at TIMESTAMP    DEFAULT NOW(),
        UNIQUE(text_key, lang)
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS api_usage (
        id            SERIAL PRIMARY KEY,
        user_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
        event_type    VARCHAR(50)  NOT NULL,
        model         VARCHAR(100),
        input_tokens  INTEGER DEFAULT 0,
        output_tokens INTEGER DEFAULT 0,
        char_count    INTEGER DEFAULT 0,
        created_at    TIMESTAMP DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS review_log (
        id         SERIAL PRIMARY KEY,
        user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
        word_id    INTEGER,
        score      INTEGER,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('[DB] review_log migration complete');

  } finally {
    client.release();
  }
}

function trackUsage(userId, eventType, model, inputTokens, outputTokens, charCount) {
  if (!process.env.DATABASE_URL) return;
  pool.query(
    `INSERT INTO api_usage (user_id, event_type, model, input_tokens, output_tokens, char_count)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [userId || null, eventType, model || null, inputTokens || 0, outputTokens || 0, charCount || 0]
  ).catch(e => console.error('Usage tracking error:', e.message));
}

module.exports = { pool, initDB, trackUsage };
