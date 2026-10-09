const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
});

// 작업227-9: concept_links.relation_type 허용값(옛 6종 + 새 5종). routes/concept_study.js 의 RELATION_TYPES(옛 6종)는 이번에 바꾸지 않으므로 서버는 아직 새 5종을 거부한다.
const CONCEPT_LINK_RELATION_TYPES_V2 = ['포함', '원인→결과', '순서', '대비', '비슷함', '기타 관련', '사용', '일부', '종류', '일으킴', '구별'];
const CONCEPT_LINK_TYPES_CHECK_NAME = 'concept_links_relation_type_check_v2';
const quoteIdent = name => '"' + String(name).replace(/"/g, '""') + '"';
// pg_get_constraintdef 결과 안의 문자열 값 목록이 expected 와 정확히 같은 집합인지
function sameLiteralSet(def, expected) {
  const got = new Set((String(def).match(/'([^']*)'/g) || []).map(x => x.slice(1, -1)));
  return got.size === expected.length && expected.every(v => got.has(v));
}

async function initDB() {
  // Use a single dedicated client so all migration queries run sequentially
  // without triggering "client is already executing a query" warnings.
  const client = await pool.connect();
  try {
    // 작업211: 단계(이름 붙은 묶음)마다 오류를 따로 처리한다. 한 단계가 실패해도 다음 단계를 계속 실행하고 끝에서 요약을 남긴다.
    // 단계 안의 SQL 문장과 순서는 그대로다. needs에 적힌 단계가 실패했으면 그 단계는 건너뛴다(이전 같은 후행 단계가 잘못된 상태에서 돌지 않게).
    const failed = [], skipped = [], failedSet = new Set();
    let total = 0;
    async function step(name, fn, { needs = [], tx = false } = {}) {
      total++;
      const blockers = needs.filter(n => failedSet.has(n));
      if (blockers.length) {
        skipped.push(name);
        console.error('[DB] init step skipped: ' + name + ': 선행 단계 실패 (' + blockers.join(', ') + ')');
        return;
      }
      try {
        const r = await fn();
        if (r && r.error) throw new Error('단계 안에서 오류가 났습니다(위 로그 참고)');
      } catch (err) {
        if (tx) { try { await client.query('ROLLBACK'); } catch (e) { /* 무시 */ } }
        failed.push(name); failedSet.add(name);
        console.error('[DB] init step failed: ' + name + ': ' + err.message);
      }
    }
    await step('client_encoding', async () => {
    await client.query("SET client_encoding = 'UTF8'");
    });

    await step('users', async () => {
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
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS perm_science_reading    BOOLEAN DEFAULT true`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS perm_voice_study         BOOLEAN DEFAULT true`);
    });

    await step('users_name_repair', async () => {
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
    });

    await step('wordbook', async () => {
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
    // 작업107: 검색 출처(OCR 스캔 vs 수동 입력) 구분용 - 기존 행은 DEFAULT로
    // 'manual'로 채워짐(과거 데이터는 실제 출처를 알 수 없어 편의상 처리).
    // 작업104에서 추가했다가 106에서 코드만 되돌리고 컬럼은 남겨뒀던 것을
    // 107에서 다시 활용 - 프로덕션엔 이미 있어 IF NOT EXISTS로 별 영향 없음.
    await client.query(`ALTER TABLE wordbook ADD COLUMN IF NOT EXISTS source            VARCHAR(20) DEFAULT 'manual'`);
    console.log('[DB] wordbook migration complete (metacognitive + concept columns)');
    });

    await step('tts_cache', async () => {
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
    });
    await step('api_usage', async () => {
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
    });
    await step('review_log', async () => {
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
    });

    await step('voice_notes', async () => {
    // 작업179: 음성 학습 자료(변환 글·요약본만 저장, 오디오 컬럼 없음)
    await client.query(`
      CREATE TABLE IF NOT EXISTS voice_notes (
        id         SERIAL PRIMARY KEY,
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title      TEXT,
        transcript TEXT,
        summary    TEXT,
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_voice_notes_user_id ON voice_notes(user_id)`);
    // 작업187: 과목·세부 과목(둘 다 NULL 허용)
    await client.query(`ALTER TABLE voice_notes ADD COLUMN IF NOT EXISTS subject TEXT`);
    await client.query(`ALTER TABLE voice_notes ADD COLUMN IF NOT EXISTS subject_detail TEXT`);
    console.log('[DB] voice_notes migration complete');
    });

    await step('voice_quizzes', async () => {
    // 작업185: 음성 학습 퀴즈(자료당 1세트, 원문 sha256으로 원문 변경 여부 확인)
    await client.query(`
      CREATE TABLE IF NOT EXISTS voice_quizzes (
        note_id     INTEGER PRIMARY KEY REFERENCES voice_notes(id) ON DELETE CASCADE,
        user_id     INTEGER NOT NULL,
        questions   JSONB NOT NULL,
        source_hash TEXT NOT NULL,
        created_at  TIMESTAMPTZ DEFAULT now()
      )
    `);
    console.log('[DB] voice_quizzes migration complete');
    });

    await step('voice_quiz_attempts', async () => {
    // 작업193-3: 퀴즈 결과(문제 스냅샷 포함). 자료당 최근 50개만 보관(서버가 초과분 삭제)
    await client.query(`
      CREATE TABLE IF NOT EXISTS voice_quiz_attempts (
        id         SERIAL PRIMARY KEY,
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        note_id    INTEGER NOT NULL REFERENCES voice_notes(id) ON DELETE CASCADE,
        quiz_hash  TEXT,
        score      INTEGER,
        total      INTEGER,
        items      JSONB,
        created_at TIMESTAMPTZ DEFAULT now()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_voice_quiz_attempts_user_note ON voice_quiz_attempts(user_id, note_id, created_at)`);
    console.log('[DB] voice_quiz_attempts migration complete');
    });

    await step('voice_concepts', async () => {
    // 작업193-4: 개념 학습(용어·설명을 과목 > 대주제 > 소주제 맥락으로 저장). 사용자당 최대 500개는 서버가 확인
    await client.query(`
      CREATE TABLE IF NOT EXISTS voice_concepts (
        id             SERIAL PRIMARY KEY,
        user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        term           TEXT NOT NULL,
        explanation    TEXT,
        subject        TEXT NOT NULL,
        subject_detail TEXT,
        topic          TEXT NOT NULL,
        subtopic       TEXT,
        last_rating    TEXT,
        rated_at       TIMESTAMPTZ,
        created_at     TIMESTAMPTZ DEFAULT now(),
        updated_at     TIMESTAMPTZ DEFAULT now()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_voice_concepts_user_subject_topic ON voice_concepts(user_id, subject, topic)`);
    console.log('[DB] voice_concepts migration complete');
    });

    await step('voice_links', async () => {
    // 작업188: 자료 간 연결(요약 sha256으로 생성 시점 기록) + 연상 키워드
    await client.query(`
      CREATE TABLE IF NOT EXISTS voice_links (
        id           SERIAL PRIMARY KEY,
        user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        from_note_id INTEGER NOT NULL REFERENCES voice_notes(id) ON DELETE CASCADE,
        to_note_id   INTEGER NOT NULL REFERENCES voice_notes(id) ON DELETE CASCADE,
        from_hash    TEXT NOT NULL,
        to_hash      TEXT NOT NULL,
        kind         TEXT NOT NULL,
        relation     TEXT,
        quote_from   TEXT,
        quote_to     TEXT,
        created_at   TIMESTAMPTZ DEFAULT now()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_voice_links_from ON voice_links(from_note_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_voice_links_to ON voice_links(to_note_id)`);
    await client.query(`ALTER TABLE voice_notes ADD COLUMN IF NOT EXISTS link_hash TEXT`);
    await client.query(`ALTER TABLE voice_notes ADD COLUMN IF NOT EXISTS keywords JSONB`);
    // 작업191: 요약이 기준으로 삼은 원문의 sha256(원문이 바뀌면 요약이 낡았음을 표시하는 데 사용). NULL = 알 수 없음
    await client.query(`ALTER TABLE voice_notes ADD COLUMN IF NOT EXISTS summary_source_hash TEXT`);
    // 작업192: 합본의 원본 목록 [{id, title, hash}] (hash = 합칠 때 원본 원문의 sha256). NULL = 합본이 아님
    await client.query(`ALTER TABLE voice_notes ADD COLUMN IF NOT EXISTS merged_from JSONB`);
    console.log('[DB] voice_links migration complete');
    });

    await step('voice_links_user_edit', async () => {
    // 작업214-2: 사용자가 연결을 직접 만들거나 고치거나 지웠는지. 기존 행은 DEFAULT로 source='ai', user_edited=false, hidden=false가 된다.
    // hidden: 사용자가 지운 AI 연결(재분석이 되살리지 못하게 행을 남긴다). 같은 쌍의 중복 방지는 UNIQUE 제약이 아니라 앱 로직으로 한다.
    await client.query(`ALTER TABLE voice_links ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'ai'`);
    await client.query(`ALTER TABLE voice_links ADD COLUMN IF NOT EXISTS user_edited BOOLEAN NOT NULL DEFAULT false`);
    await client.query(`ALTER TABLE voice_links ADD COLUMN IF NOT EXISTS hidden BOOLEAN NOT NULL DEFAULT false`);
    });

    await step('voice_images', async () => {
    // 작업189: 연상 그림(실험 기능). 자료당 세트 1개, 장(page)별 이미지는 BYTEA로 저장
    await client.query(`
      CREATE TABLE IF NOT EXISTS voice_image_sets (
        note_id      INTEGER PRIMARY KEY REFERENCES voice_notes(id) ON DELETE CASCADE,
        user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        status       TEXT NOT NULL,
        summary_hash TEXT,
        pages_total  INTEGER,
        truncated    BOOLEAN,
        error        TEXT,
        rating       SMALLINT,
        created_at   TIMESTAMPTZ DEFAULT now(),
        updated_at   TIMESTAMPTZ DEFAULT now()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_voice_image_sets_user_id ON voice_image_sets(user_id)`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS voice_images (
        note_id      INTEGER NOT NULL REFERENCES voice_image_sets(note_id) ON DELETE CASCADE,
        page_no      INTEGER NOT NULL,
        status       TEXT NOT NULL,
        title        TEXT,
        cells        JSONB,
        image        BYTEA,
        mime         TEXT,
        check_result TEXT,
        attempts     INTEGER,
        error        TEXT,
        PRIMARY KEY (note_id, page_no)
      )
    `);
    console.log('[DB] voice_image migration complete');
    });

    await step('concept_user_permission', async () => {
    // 작업194: 개념학습(분야 학습 > 개념 > 연결). 개념 학습은 음성 학습과 별도 메뉴
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS perm_concept_study BOOLEAN NOT NULL DEFAULT true`);
    });
    await step('concept_studies', async () => {
    await client.query(`
      CREATE TABLE IF NOT EXISTS concept_studies (
        id               SERIAL PRIMARY KEY,
        user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        topic            TEXT NOT NULL,
        selected_item_id INTEGER,
        created_at       TIMESTAMPTZ DEFAULT now(),
        updated_at       TIMESTAMPTZ DEFAULT now()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_concept_studies_user_id ON concept_studies(user_id)`);
    // 작업195-1: 선택 경로(개념 id 배열, 최근 12개). 서버가 선택이 바뀔 때 갱신
    await client.query(`ALTER TABLE concept_studies ADD COLUMN IF NOT EXISTS path JSONB NOT NULL DEFAULT '[]'::jsonb`);
    });
    await step('concept_items', async () => {
    await client.query(`
      CREATE TABLE IF NOT EXISTS concept_items (
        id                    SERIAL PRIMARY KEY,
        study_id              INTEGER NOT NULL REFERENCES concept_studies(id) ON DELETE CASCADE,
        user_id               INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        term                  TEXT NOT NULL,
        term_key              TEXT NOT NULL,
        english               TEXT,
        group_label           TEXT,
        definition            TEXT,
        example               TEXT,
        simple_text           TEXT,
        deeper_text           TEXT,
        content_source        TEXT NOT NULL DEFAULT 'none' CHECK (content_source IN ('none','ai','user')),
        status                TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','held','excluded')),
        review_state          TEXT NOT NULL DEFAULT 'new' CHECK (review_state IN ('new','understood','confused')),
        origin                TEXT,
        note                  TEXT,
        suggestions           JSONB,
        feedback              JSONB,
        legacy_voice_concept_id INTEGER,
        created_at            TIMESTAMPTZ DEFAULT now(),
        updated_at            TIMESTAMPTZ DEFAULT now()
      )
    `);
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_concept_items_study_term ON concept_items(study_id, term_key)`);
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_concept_items_legacy ON concept_items(legacy_voice_concept_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_concept_items_user_id ON concept_items(user_id)`);
    });
    await step('concept_links', async () => {
    await client.query(`
      CREATE TABLE IF NOT EXISTS concept_links (
        id            SERIAL PRIMARY KEY,
        study_id      INTEGER NOT NULL REFERENCES concept_studies(id) ON DELETE CASCADE,
        user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        from_item_id  INTEGER NOT NULL REFERENCES concept_items(id) ON DELETE CASCADE,
        to_item_id    INTEGER NOT NULL REFERENCES concept_items(id) ON DELETE CASCADE,
        relation_type TEXT NOT NULL CHECK (relation_type IN ('포함','원인→결과','순서','대비','비슷함','기타 관련')),
        label         TEXT,
        detail        TEXT,
        source        TEXT NOT NULL CHECK (source IN ('ai','user')),
        created_at    TIMESTAMPTZ DEFAULT now()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_concept_links_study_id ON concept_links(study_id)`);
    });
    await step('concept_links_user_edited', async () => {
    // 작업209-2: 사용자가 연결(관계·문구·이유·방향)을 고쳤는지. source('ai'/'user')는 그대로 두고 따로 표시
    await client.query(`ALTER TABLE concept_links ADD COLUMN IF NOT EXISTS user_edited BOOLEAN NOT NULL DEFAULT false`);
    });
    await step('concept_links_relation_types_v2', async () => {
    // 작업227-9: 연결 관계 종류 CHECK 를 옛 6종 + 새 5종(사용, 일부, 종류, 일으킴, 구별) = 11값으로 넓힌다. 기존 행은 바꾸지 않는다(옛 6종 그대로 유효).
    // 제약 이름은 추정하지 않는다: pg_constraint 에서 concept_links 의 CHECK 중 relation_type 컬럼을 쓰는 것을 찾아 모두 DROP 하고, 이름을 직접 붙여 새 CHECK 를 ADD 한다.
    // 이미 11값(새 이름, 값 정확히 일치)이면 아무것도 바꾸지 않는다(멱등). DROP 과 ADD 는 한 트랜잭션이라 중간에 실패하면 ROLLBACK 되어 옛 제약이 그대로 남는다.
    const found = async () => (await client.query(
      `SELECT c.conname, pg_get_constraintdef(c.oid) AS def FROM pg_constraint c WHERE c.conrelid = 'concept_links'::regclass AND c.contype = 'c' AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey) AND a.attname = 'relation_type') ORDER BY c.conname`
    )).rows;
    const upToDate = rows => rows.length === 1 && rows[0].conname === CONCEPT_LINK_TYPES_CHECK_NAME && sameLiteralSet(rows[0].def, CONCEPT_LINK_RELATION_TYPES_V2);
    if (upToDate(await found())) return;   // 이미 적용됨: 잠금도 트랜잭션도 만들지 않는다
    await client.query('BEGIN');
    await client.query('LOCK TABLE concept_links IN ACCESS EXCLUSIVE MODE');   // 동시에 뜬 다른 서버와 순서를 맞춘다(뒤에 들어온 쪽은 아래에서 이미 적용된 것을 보고 건너뜀)
    const rows = await found();
    if (!upToDate(rows)) {
      for (const r of rows) await client.query('ALTER TABLE concept_links DROP CONSTRAINT ' + quoteIdent(r.conname));
      await client.query('ALTER TABLE concept_links ADD CONSTRAINT ' + CONCEPT_LINK_TYPES_CHECK_NAME + ' CHECK (relation_type IN (' + CONCEPT_LINK_RELATION_TYPES_V2.map(t => "'" + t + "'").join(', ') + '))');
      console.log('[DB] concept_links relation_type CHECK: ' + CONCEPT_LINK_RELATION_TYPES_V2.length + '값으로 확장');
    }
    await client.query('COMMIT');
    }, { needs: ['concept_links'], tx: true });
    await step('concept_quiz_attempts', async () => {
    // 작업205: 돌아보기 퀴즈 기록. 학습·개념이 삭제되면 기록도 함께 삭제(concept_links와 같은 ON DELETE CASCADE)
    await client.query(`
      CREATE TABLE IF NOT EXISTS concept_quiz_attempts (
        id         SERIAL PRIMARY KEY,
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        study_id   INTEGER NOT NULL REFERENCES concept_studies(id) ON DELETE CASCADE,
        item_id    INTEGER NOT NULL REFERENCES concept_items(id) ON DELETE CASCADE,
        kind       TEXT NOT NULL CHECK (kind IN ('A','B')),
        correct    BOOLEAN NOT NULL,
        created_at TIMESTAMPTZ DEFAULT now()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_concept_quiz_attempts_study_id ON concept_quiz_attempts(study_id)`);
    });
    await step('concept_migrations_table', async () => {
    await client.query(`CREATE TABLE IF NOT EXISTS concept_migrations (name TEXT PRIMARY KEY, done_at TIMESTAMPTZ DEFAULT now())`);
    console.log('[DB] concept study migration complete');
    });

    // 이전 실패가 서버 시작을 막지 않도록 migrateVoiceConcepts는 오류를 던지지 않는다
    await step('concept_migration_v1', () => migrateVoiceConcepts(client), { needs: ['users', 'voice_concepts', 'concept_studies', 'concept_items', 'concept_migrations_table'], tx: true });
    await step('concept_migration_v2', () => migrateVoiceConceptsV2(client), { needs: ['users', 'voice_concepts', 'concept_studies', 'concept_items', 'concept_migrations_table'], tx: true });

    console.log('[DB] init done: 총 ' + total + '단계, 실패 ' + failed.length + '단계' + (failed.length ? ' (실패: ' + failed.join(', ') + ')' : '')
      + (skipped.length ? ', 건너뜀 ' + skipped.length + '단계 (건너뜀: ' + skipped.join(', ') + ')' : ''));
    return { total, failed, skipped };
  } finally {
    client.release();
  }
}

// 작업194-1: voice_concepts → concept_studies/concept_items 이전(한 번만).
// 완료 표시(concept_migrations)가 있으면 건너뛰고, 원본 id(legacy_voice_concept_id)가 이미 있는 행도 건너뛴다.
// 한 트랜잭션이라 실패하면 아무것도 남지 않는다. 원본 voice_concepts는 읽기만 한다. 개수 상한은 이전에는 적용하지 않는다.
const CONCEPT_MIGRATION_NAME = 'voice_concepts_v1';
const RATING_TO_REVIEW = { known: 'understood', confused: 'confused' };
function cutChars(s, n) { return Array.from(String(s)).slice(0, n).join(''); }

// rows를 (사용자, 과목·세부 과목 / 대주제) 묶음별 학습으로 옮긴다. 호출한 쪽의 트랜잭션 안에서 실행된다.
async function copyVoiceConceptRows(client, rows) {
  const groups = new Map();
  for (const r of rows) {
    const name = r.subject + (r.subject_detail ? '·' + r.subject_detail : '') + ' / ' + r.topic;
    const key = r.user_id + '\u0001' + name;
    if (!groups.has(key)) groups.set(key, { userId: r.user_id, name, rows: [] });
    groups.get(key).rows.push(r);
  }
  let studies = 0, items = 0, skippedDup = 0;
  for (const g of groups.values()) {
    const made = await client.query(
      'INSERT INTO concept_studies (user_id, topic, created_at) VALUES ($1, $2, $3) RETURNING id',
      [g.userId, cutChars(g.name, 80), g.rows[0].created_at]
    );
    const studyId = made.rows[0].id;
    studies++;
    for (const r of g.rows) {
      const term = cutChars(String(r.term).trim(), 80);
      const definition = r.explanation && r.explanation.trim() ? r.explanation : null;
      const ins = await client.query(
        `INSERT INTO concept_items (study_id, user_id, term, term_key, group_label, definition, content_source, review_state, origin, legacy_voice_concept_id, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) ON CONFLICT DO NOTHING`,
        [studyId, g.userId, term, term.replace(/\s+/g, '').toLowerCase(),
         r.subtopic && r.subtopic.trim() ? cutChars(r.subtopic.trim(), 30) : null,
         definition, definition ? 'user' : 'none', RATING_TO_REVIEW[r.last_rating] || 'new', '이전됨', r.id, r.created_at]
      );
      if (ins.rowCount) items++; else skippedDup++;
    }
  }
  return { studies, items, skippedDup };
}

async function migrateVoiceConcepts(client) {
  try {
    await client.query('BEGIN');
    const done = await client.query('SELECT 1 FROM concept_migrations WHERE name = $1', [CONCEPT_MIGRATION_NAME]);
    if (done.rows.length) { await client.query('COMMIT'); return { skipped: true }; }

    const { rows } = await client.query(
      `SELECT id, user_id, term, explanation, subject, subject_detail, topic, subtopic, last_rating, created_at
       FROM voice_concepts
       WHERE NOT EXISTS (SELECT 1 FROM concept_items ci WHERE ci.legacy_voice_concept_id = voice_concepts.id)
       ORDER BY user_id, id`
    );
    const { studies, items, skippedDup } = await copyVoiceConceptRows(client, rows);
    await client.query('INSERT INTO concept_migrations (name) VALUES ($1) ON CONFLICT DO NOTHING', [CONCEPT_MIGRATION_NAME]);
    await client.query('COMMIT');
    console.log('[DB] concept migration: 원본 ' + rows.length + '개 → 학습 ' + studies + '개, 개념 ' + items + '개 이전' + (skippedDup ? ' (같은 학습 안 중복 용어 ' + skippedDup + '개 건너뜀)' : ''));
    return { studies, items, skippedDup };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (e) { /* 무시 */ }
    console.error('[DB] concept migration failed (서버는 계속 시작):', err.message);
    return { error: true };
  }
}

// 작업196-3: 194 이후(v1 완료 시각 뒤)에 voice_concepts에 생긴 행만 한 번 더 이전한다.
// 사용자가 v1 이후 지운 개념은 created_at이 v1 이전이라 대상이 아니므로 되살아나지 않는다.
// v1 완료 표시가 없으면 v1이 전부 처리하므로 아무것도 하지 않는다(v2 표시도 남기지 않음).
// created_at/done_at 모두 TIMESTAMPTZ라 시간대와 무관하게 비교된다. 원본 voice_concepts는 읽기만 한다.
const CONCEPT_MIGRATION_NAME_V2 = 'voice_concepts_v2';
async function migrateVoiceConceptsV2(client) {
  try {
    await client.query('BEGIN');
    const done = await client.query('SELECT 1 FROM concept_migrations WHERE name = $1', [CONCEPT_MIGRATION_NAME_V2]);
    if (done.rows.length) { await client.query('COMMIT'); return { skipped: true }; }
    const v1 = await client.query('SELECT done_at FROM concept_migrations WHERE name = $1', [CONCEPT_MIGRATION_NAME]);
    if (!v1.rows.length || !v1.rows[0].done_at) { await client.query('COMMIT'); return { skipped: true, noV1: true }; }

    const { rows } = await client.query(
      `SELECT id, user_id, term, explanation, subject, subject_detail, topic, subtopic, last_rating, created_at
       FROM voice_concepts
       WHERE created_at > $1 AND NOT EXISTS (SELECT 1 FROM concept_items ci WHERE ci.legacy_voice_concept_id = voice_concepts.id)
       ORDER BY user_id, id`,
      [v1.rows[0].done_at]
    );
    const { studies, items, skippedDup } = await copyVoiceConceptRows(client, rows);
    await client.query('INSERT INTO concept_migrations (name) VALUES ($1) ON CONFLICT DO NOTHING', [CONCEPT_MIGRATION_NAME_V2]);
    await client.query('COMMIT');
    console.log('[DB] concept migration v2: 194 이후 원본 ' + rows.length + '개 → 학습 ' + studies + '개, 개념 ' + items + '개 이전' + (skippedDup ? ' (같은 학습 안 중복 용어 ' + skippedDup + '개 건너뜀)' : ''));
    return { studies, items, skippedDup };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (e) { /* 무시 */ }
    console.error('[DB] concept migration v2 failed (서버는 계속 시작):', err.message);
    return { error: true };
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

// 작업211-4: initDB가 끝날 때까지(성공·실패 무관) /api 요청을 최대 timeoutMs 기다리게 하는 미들웨어.
// ready가 없으면(DB를 쓰지 않는 구성·테스트) 기다리지 않는다. 시간이 지나도 끝나지 않으면 기다리지 않고 그대로 처리한다.
function createApiReadyGate(ready, timeoutMs = 15000) {
  if (!ready || typeof ready.then !== 'function') return (req, res, next) => next();
  let done = false;
  ready.then(() => { done = true; }, () => { done = true; });
  return (req, res, next) => {
    if (done) return next();
    let called = false, timer = null;
    const go = () => { if (called) return; called = true; clearTimeout(timer); next(); };
    timer = setTimeout(go, timeoutMs);
    ready.then(go, go);
    res.on('close', () => { called = true; clearTimeout(timer); });   // 기다리는 동안 연결이 끊기면 처리하지 않는다
  };
}

module.exports = { pool, initDB, trackUsage, migrateVoiceConcepts, migrateVoiceConceptsV2, createApiReadyGate };
