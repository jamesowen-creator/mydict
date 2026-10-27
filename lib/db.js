const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
});

// 286-1: cmap_edges 관계 유형 10개 + 문구 선택화(label NULL 허용, 유형도 문구도 없는 연결은 금지)
const CMAP_EDGE_TYPES_V2 = ['사용', '일부', '종류', '일으킴', '선행', '조건', '구별', '유사', '대립', '연관'];
const CMAP_EDGE_CHECKS = { type: 'cmap_edges_relation_type_check_v2', label: 'cmap_edges_label_check_v2', content: 'cmap_edges_has_content_check_v2' };
// 308-1: cmap_edges 관계 유형 3종 통일(37번 단계). 옛 7종은 종류로, 유형이 없던(NULL) 연결은 문구가 정확히 '일부'·'대립'이면 그 유형으로 아니면 종류로 바꾸고, 원래 유형은 legacy_type 에 보관한다('없음' = 유형이 없었음).
const CMAP_EDGE_TYPES_V3 = ['종류', '일부', '대립'];
const CMAP_EDGE_LEGACY_TYPES = ['사용', '일으킴', '선행', '조건', '구별', '유사', '연관'];
const CMAP_EDGE_TYPE_CHECK_V3 = 'cmap_edges_relation_type_check_v3';
const sqlList = list => list.map(x => "'" + x + "'").join(', ');
// 롤백 SQL(자동 실행하지 않음): 변환 전 상태로 되돌린다. legacy_type 이 있는 행만 원래 유형으로 복원('없음'은 NULL). 그 뒤 옛 10값 CHECK 를 되돌린다. legacy_type 이 비어 있는(사용자가 직접 고친) 행은 그대로 둔다
const CMAP_EDGES_TYPES_V3_ROLLBACK_SQL = [
  'ALTER TABLE cmap_edges ALTER COLUMN relation_type DROP NOT NULL',
  'ALTER TABLE cmap_edges DROP CONSTRAINT IF EXISTS ' + CMAP_EDGE_TYPE_CHECK_V3,
  "UPDATE cmap_edges SET relation_type = CASE WHEN legacy_type = '없음' THEN NULL ELSE legacy_type END WHERE legacy_type IS NOT NULL",
  'ALTER TABLE cmap_edges ADD CONSTRAINT ' + CMAP_EDGE_CHECKS.type + ' CHECK (relation_type IS NULL OR relation_type IN (' + sqlList(CMAP_EDGE_TYPES_V2) + '))',
];
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
    // 작업270-1: 새 메뉴 "개념 지도"(옛 개념학습과 별도). 기존 단계·테이블은 바꾸지 않고 아래 두 단계만 맨 끝에 더한다.
    await step('cmap_user_permission', async () => {
    // 옛 perm_* 와 달리 기본값 false: 개발 중에는 관리자가 직접 켠 계정에서만 보인다(기존 사용자도 false 가 된다)
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS perm_concept_map BOOLEAN NOT NULL DEFAULT false`);
    });
    await step('cmap_topics', async () => {
    // 주제 트리. parent_id NULL = 최상위. root_id: 최상위 행은 NULL(자기 자신이 루트), 하위 행은 최상위 행의 id.
    // (자기 id 를 넣으려면 삽입 뒤 갱신하는 2단계가 필요해 중간 상태가 생기므로 NULL 방식을 쓴다. 한 트리 조회: id = $루트 OR root_id = $루트)
    // 부모 삭제 정책은 다음 단계(2a)에서 정하므로 FK 는 ON DELETE 를 지정하지 않는다(NO ACTION: 자식이 남아 있으면 삭제 불가.
    // RESTRICT 는 즉시 검사라 users 삭제 연쇄 때 같은 사용자의 부모·자식 행을 한 문장에서 지울 때 막힐 수 있어 NO ACTION 을 쓴다)
    await client.query(`
      CREATE TABLE IF NOT EXISTS cmap_topics (
        id         SERIAL PRIMARY KEY,
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        parent_id  INTEGER REFERENCES cmap_topics(id),
        root_id    INTEGER REFERENCES cmap_topics(id),
        title      TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 80 AND btrim(title) <> ''),
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now(),
        CHECK ((parent_id IS NULL) = (root_id IS NULL))
      )
    `);
    // 깊이(parent_id 를 따라 올라간 단계 수)는 최상위 포함 최대 5단계. DB 제약이 아니라 서버 코드(2a 단계)에서 검사한다
    await client.query(`CREATE INDEX IF NOT EXISTS idx_cmap_topics_user_root ON cmap_topics(user_id, root_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_cmap_topics_parent ON cmap_topics(parent_id)`);
    // 같은 부모 아래 이름 중복 금지(대소문자 무시): 최상위는 사용자별, 하위는 부모별
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_cmap_topics_root_title ON cmap_topics(user_id, lower(title)) WHERE parent_id IS NULL`);
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_cmap_topics_child_title ON cmap_topics(parent_id, lower(title)) WHERE parent_id IS NOT NULL`);
    console.log('[DB] cmap_topics migration complete');
    }, { needs: ['users'] });
    await step('cmap_concepts', async () => {
    // 작업271-1: 주제 안에 직접 입력하는 개념. root_id 는 두지 않는다(최상위 주제는 topic_id 로 거슬러 올라가 조회).
    // topic_id FK 는 ON DELETE 동작이 없는 NO ACTION 이며 DEFERRABLE INITIALLY DEFERRED: 검사를 트랜잭션 끝으로 미룬다.
    // (users 삭제 연쇄로 cmap_topics 와 cmap_concepts 가 한 문장 안에서 함께 지워질 때, 개념보다 주제가 먼저 지워지는 순서여도 막히지 않게 함.
    //  앱의 삭제 라우트는 개념을 먼저 옮기거나 지우므로 정상 동작에는 영향이 없다)
    await client.query(`
      CREATE TABLE IF NOT EXISTS cmap_concepts (
        id             SERIAL PRIMARY KEY,
        user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        topic_id       INTEGER NOT NULL REFERENCES cmap_topics(id) DEFERRABLE INITIALLY DEFERRED,
        term           TEXT NOT NULL CHECK (char_length(term) BETWEEN 1 AND 80 AND btrim(term) <> ''),
        english        TEXT CHECK (english IS NULL OR char_length(english) <= 120),
        memo           TEXT CHECK (memo IS NULL OR char_length(memo) <= 2000),
        content_source TEXT NOT NULL DEFAULT 'manual',
        sort_order     INTEGER NOT NULL DEFAULT 0,
        created_at     TIMESTAMPTZ DEFAULT now(),
        updated_at     TIMESTAMPTZ DEFAULT now()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_cmap_concepts_user_topic ON cmap_concepts(user_id, topic_id)`);
    // 같은 주제 안 개념 이름 중복 금지(대소문자 무시)
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_cmap_concepts_topic_term ON cmap_concepts(topic_id, lower(term))`);
    console.log('[DB] cmap_concepts migration complete');
    }, { needs: ['users', 'cmap_topics'] });
    await step('cmap_concept_explanation', async () => {
    // 작업273-1: AI 백과사전 설명(정의·맥락·예·헷갈리는 점 4항목 JSON)과 그 출처('ai' | 'manual'), 만든 시각. 기존 열은 바꾸지 않는다
    await client.query(`ALTER TABLE cmap_concepts ADD COLUMN IF NOT EXISTS explanation JSONB`);
    await client.query(`ALTER TABLE cmap_concepts ADD COLUMN IF NOT EXISTS explanation_source TEXT CHECK (explanation_source IN ('ai', 'manual'))`);
    await client.query(`ALTER TABLE cmap_concepts ADD COLUMN IF NOT EXISTS explained_at TIMESTAMPTZ`);
    }, { needs: ['cmap_concepts'] });

    // 작업273-2: 지도(최상위 주제당 여러 개 허용, 화면은 1개만 만든다) · 노드(지도에 쓰는 개념 + 좌표) · 간선(사용자가 직접 만든 연결)
    await step('cmap_maps', async () => {
    // root_topic_id: 최상위 주제. cmap_concepts.topic_id 와 같은 이유로 DEFERRABLE INITIALLY DEFERRED(ON DELETE 동작 없는 NO ACTION)
    await client.query(`
      CREATE TABLE IF NOT EXISTS cmap_maps (
        id            SERIAL PRIMARY KEY,
        user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        root_topic_id INTEGER NOT NULL REFERENCES cmap_topics(id) DEFERRABLE INITIALLY DEFERRED,
        title         TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 80 AND btrim(title) <> ''),
        semantic_hash TEXT,
        saved_at      TIMESTAMPTZ,
        created_at    TIMESTAMPTZ DEFAULT now(),
        updated_at    TIMESTAMPTZ DEFAULT now()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_cmap_maps_user_root ON cmap_maps(user_id, root_topic_id)`);
    }, { needs: ['users', 'cmap_topics'] });
    await step('cmap_map_nodes', async () => {
    // x, y NULL = 아직 배치하지 않음(화면이 임시 격자 위치로 보여 주고 첫 이동 때 저장)
    await client.query(`
      CREATE TABLE IF NOT EXISTS cmap_map_nodes (
        map_id     INTEGER NOT NULL REFERENCES cmap_maps(id) ON DELETE CASCADE,
        concept_id INTEGER NOT NULL REFERENCES cmap_concepts(id) ON DELETE CASCADE,
        x          REAL,
        y          REAL,
        PRIMARY KEY (map_id, concept_id)
      )
    `);
    }, { needs: ['cmap_maps', 'cmap_concepts'] });
    await step('cmap_edges', async () => {
    // 양 끝은 같은 지도의 노드여야 하고(복합 FK, 노드가 빠지면 간선도 함께 삭제), 관계 종류는 선택(NULL 허용)이며 5종 CHECK(= lib/concept_links_b2.js PREDICATES),
    // 문구(label)는 필수 1~40자. 같은 쌍은 방향과 상관없이 한 번만(LEAST/GREATEST 유일 인덱스: 구별 포함)
    await client.query(`
      CREATE TABLE IF NOT EXISTS cmap_edges (
        id              SERIAL PRIMARY KEY,
        map_id          INTEGER NOT NULL REFERENCES cmap_maps(id) ON DELETE CASCADE,
        from_concept_id INTEGER NOT NULL,
        to_concept_id   INTEGER NOT NULL,
        relation_type   TEXT CHECK (relation_type IS NULL OR relation_type IN ('사용', '일부', '종류', '일으킴', '구별')),
        label           TEXT NOT NULL CHECK (char_length(label) BETWEEN 1 AND 40 AND btrim(label) <> ''),
        created_at      TIMESTAMPTZ DEFAULT now(),
        CHECK (from_concept_id <> to_concept_id),
        UNIQUE (map_id, from_concept_id, to_concept_id),
        FOREIGN KEY (map_id, from_concept_id) REFERENCES cmap_map_nodes(map_id, concept_id) ON DELETE CASCADE,
        FOREIGN KEY (map_id, to_concept_id) REFERENCES cmap_map_nodes(map_id, concept_id) ON DELETE CASCADE
      )
    `);
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_cmap_edges_pair ON cmap_edges(map_id, LEAST(from_concept_id, to_concept_id), GREATEST(from_concept_id, to_concept_id))`);
    }, { needs: ['cmap_maps', 'cmap_map_nodes'] });   // 건너뛴 단계는 실패로 기록되지 않아, 앞선 두 단계를 모두 선행으로 적는다

    // 작업273-4: AI 해설(지도당 최신 1개). source_hash = 해설을 만든 시점의 지도 의미 해시, content = {summary, story, mnemonic, suggestions}
    await step('cmap_narrations', async () => {
    await client.query(`
      CREATE TABLE IF NOT EXISTS cmap_narrations (
        id          SERIAL PRIMARY KEY,
        map_id      INTEGER NOT NULL UNIQUE REFERENCES cmap_maps(id) ON DELETE CASCADE,
        user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        source_hash TEXT NOT NULL,
        content     JSONB NOT NULL,
        model       TEXT NOT NULL,
        created_at  TIMESTAMPTZ DEFAULT now()
      )
    `);
    }, { needs: ['users', 'cmap_maps'] });

    // 작업275-4: "모르는 개념" 표시(사용자별, 개념 단위 — 지도와 무관). 개념이 지워지면 표시도 함께 지워진다
    await step('cmap_concept_marks', async () => {
    await client.query(`
      CREATE TABLE IF NOT EXISTS cmap_concept_marks (
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        concept_id INTEGER NOT NULL REFERENCES cmap_concepts(id) ON DELETE CASCADE,
        marked_at  TIMESTAMPTZ DEFAULT now(),
        PRIMARY KEY (user_id, concept_id)
      )
    `);
    }, { needs: ['users', 'cmap_concepts'] });

    // 작업273-5: 연결 퀴즈 시도 기록(점수 3종: 쌍 맞힘·종류·방향, 0~1. 분모가 0 인 항목은 NULL)
    await step('cmap_quiz_attempts', async () => {
    await client.query(`
      CREATE TABLE IF NOT EXISTS cmap_quiz_attempts (
        id              SERIAL PRIMARY KEY,
        user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        map_id          INTEGER NOT NULL REFERENCES cmap_maps(id) ON DELETE CASCADE,
        source_hash     TEXT NOT NULL,
        pair_score      REAL,
        type_score      REAL,
        direction_score REAL,
        created_at      TIMESTAMPTZ DEFAULT now()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_cmap_quiz_attempts_map ON cmap_quiz_attempts(map_id, created_at)`);
    }, { needs: ['users', 'cmap_maps'] });

    // 작업278-1: 말로 설명하기 평가 결과(AI 가 정리한 요약·판정·피드백만. 오디오·전사·입력 원문 열은 없다)
    await step('cmap_answer_attempts', async () => {
    await client.query(`
      CREATE TABLE IF NOT EXISTS cmap_answer_attempts (
        id          SERIAL PRIMARY KEY,
        user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        concept_id  INTEGER NOT NULL REFERENCES cmap_concepts(id) ON DELETE CASCADE,
        verdict     TEXT NOT NULL CHECK (verdict IN ('충분', '부분적', '부족')),
        summary     TEXT NOT NULL,
        strengths   JSONB NOT NULL DEFAULT '[]'::jsonb,
        gaps        JSONB NOT NULL DEFAULT '[]'::jsonb,
        supplement  TEXT NOT NULL DEFAULT '',
        input_mode  TEXT NOT NULL CHECK (input_mode IN ('voice', 'text')),
        created_at  TIMESTAMPTZ DEFAULT now()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_cmap_answer_attempts_user_created ON cmap_answer_attempts(user_id, created_at DESC)`);
    }, { needs: ['users', 'cmap_concepts'] });

    // 작업286-1: cmap_edges 관계 종류를 10개로 넓히고 문구(label)를 선택 사항으로 바꾼다. 기존 행은 바꾸지 않는다(기존 5개 유형·모든 문구는 새 제약에서도 유효).
    // 제약 이름은 추정하지 않는다: pg_constraint 에서 relation_type 또는 label 컬럼을 쓰는 CHECK 를 찾아 모두 DROP 하고, 이름을 붙인 새 CHECK 3개를 ADD 한다
    // (유형 10값 또는 NULL / 문구 NULL 또는 1~40자 / 유형·문구 중 하나는 있어야 함). label 의 NOT NULL 도 푼다.
    // 이미 새 제약 3개만 있으면(유형 값 정확히 일치) 아무것도 바꾸지 않는다(멱등). DROP·ADD 는 한 트랜잭션이라 중간에 실패하면 ROLLBACK 되어 옛 제약이 그대로 남고,
    // 이 단계가 실패해도 다른 단계·서버 시작에는 영향이 없다(개념 지도의 새 유형·빈 문구 저장만 DB 가 거부한다).
    await step('cmap_edges_types_v2', async () => {
    const found = async () => (await client.query(
      `SELECT c.conname, pg_get_constraintdef(c.oid) AS def FROM pg_constraint c WHERE c.conrelid = 'cmap_edges'::regclass AND c.contype = 'c' AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey) AND a.attname IN ('relation_type', 'label'))`
    )).rows;
    // 308-1: 37번 단계(v3)가 유형 CHECK 를 3값(이름 ..._v3)으로 바꾼 뒤에도 v2 는 "이미 적용됨"으로 본다(서버를 다시 시작할 때마다 제약을 되돌리지 않도록)
    const upToDate = rows => rows.length === 3 && [CMAP_EDGE_CHECKS.label, CMAP_EDGE_CHECKS.content].every(n => rows.some(r => r.conname === n))
      && ((rows.some(r => r.conname === CMAP_EDGE_CHECKS.type) && sameLiteralSet(rows.find(r => r.conname === CMAP_EDGE_CHECKS.type).def, CMAP_EDGE_TYPES_V2))
        || (rows.some(r => r.conname === CMAP_EDGE_TYPE_CHECK_V3) && sameLiteralSet(rows.find(r => r.conname === CMAP_EDGE_TYPE_CHECK_V3).def, CMAP_EDGE_TYPES_V3)));
    if (upToDate(await found())) return;   // 이미 적용됨: 잠금도 트랜잭션도 만들지 않는다
    await client.query('BEGIN');
    await client.query('LOCK TABLE cmap_edges IN ACCESS EXCLUSIVE MODE');   // 동시에 뜬 다른 서버와 순서를 맞춘다(뒤에 들어온 쪽은 아래에서 이미 적용된 것을 보고 건너뜀)
    const rows = await found();
    if (!upToDate(rows)) {
      for (const r of rows) await client.query('ALTER TABLE cmap_edges DROP CONSTRAINT ' + quoteIdent(r.conname));
      await client.query('ALTER TABLE cmap_edges ALTER COLUMN label DROP NOT NULL');
      await client.query('ALTER TABLE cmap_edges ADD CONSTRAINT ' + CMAP_EDGE_CHECKS.type + ' CHECK (relation_type IS NULL OR relation_type IN (' + CMAP_EDGE_TYPES_V2.map(t => "'" + t + "'").join(', ') + '))');
      await client.query('ALTER TABLE cmap_edges ADD CONSTRAINT ' + CMAP_EDGE_CHECKS.label + " CHECK (label IS NULL OR (char_length(label) BETWEEN 1 AND 40 AND btrim(label) <> ''))");
      await client.query('ALTER TABLE cmap_edges ADD CONSTRAINT ' + CMAP_EDGE_CHECKS.content + ' CHECK (label IS NOT NULL OR relation_type IS NOT NULL)');
      console.log('[DB] cmap_edges: 관계 종류 ' + CMAP_EDGE_TYPES_V2.length + '값, 문구 선택화');
    }
    await client.query('COMMIT');
    }, { needs: ['cmap_edges'], tx: true });

    // 작업308-1: cmap_edges 관계 유형을 종류·일부·대립 3종으로 통일(37번 단계). DELETE·DROP TABLE 없음(컬럼 추가와 값 수정, 유형 CHECK 교체만).
    //  ① legacy_type TEXT(제약 없음) 추가 ② 원래 유형 보관(옛 7종은 그 이름, 유형이 없던 행은 '없음') ③ 변환: 옛 7종 → 종류, NULL → 문구가 '일부'·'대립'이면 그 유형, 그 밖은 종류(문구는 바꾸지 않음)
    //  ④ NULL → 대립으로 바뀐 행만 id 작은 쪽이 from 이 되게 맞춤(방향 없는 유형이라 순서는 의미가 없음) ⑤ 유형 CHECK 를 3값으로 교체하고 relation_type 을 NOT NULL 로
    // 이미 3값 CHECK + legacy_type 컬럼 + 3종 밖의 행 0개 + NOT NULL 이면 잠금 없이 끝낸다(멱등). 한 트랜잭션이라 실패하면 ROLLBACK 되어 옛 상태가 그대로 남는다.
    // 변환 건수만 로그에 남기고 연결 내용·문구·개념 이름은 남기지 않는다. 롤백 SQL 은 위 CMAP_EDGES_TYPES_V3_ROLLBACK_SQL(자동 실행 안 함).
    await step('cmap_edges_types_v3', async () => {
    const state3 = async () => (await client.query(
      "SELECT (SELECT is_nullable FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'cmap_edges' AND column_name = 'relation_type') AS nullable, "
      + "EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'cmap_edges' AND column_name = 'legacy_type') AS has_legacy, "
      + "(SELECT count(*) FROM cmap_edges WHERE relation_type IS NULL OR relation_type NOT IN (" + sqlList(CMAP_EDGE_TYPES_V3) + ")) AS pending"
    )).rows[0] || null;
    const found3 = async () => (await client.query(
      "SELECT c.conname, pg_get_constraintdef(c.oid) AS def FROM pg_constraint c WHERE c.conrelid = 'cmap_edges'::regclass AND c.contype = 'c' AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey) AND a.attname = 'relation_type')"
    )).rows;
    const typeChecks = rows => rows.filter(r => /relation_type/.test(r.def) && /ARRAY\[|\bIN \(/i.test(r.def));   // 유형 값을 제한하는 CHECK 만(문구·내용 CHECK 는 건드리지 않음)
    const upToDate = (s, rows) => !!s && s.nullable === 'NO' && s.has_legacy === true && Number(s.pending) === 0
      && typeChecks(rows).length === 1 && typeChecks(rows)[0].conname === CMAP_EDGE_TYPE_CHECK_V3 && sameLiteralSet(typeChecks(rows)[0].def, CMAP_EDGE_TYPES_V3);
    if (upToDate(await state3(), await found3())) return;   // 이미 적용됨: 잠금도 트랜잭션도 만들지 않는다
    await client.query('BEGIN');
    await client.query('LOCK TABLE cmap_edges IN ACCESS EXCLUSIVE MODE');   // 동시에 뜬 다른 서버와 순서를 맞춘다(뒤에 들어온 쪽은 아래에서 이미 적용된 것을 보고 건너뜀)
    const s = await state3(), rows = await found3();
    if (!upToDate(s, rows)) {
      const n = r => (r && Number.isFinite(r.rowCount) ? r.rowCount : 0);
      await client.query('ALTER TABLE cmap_edges ADD COLUMN IF NOT EXISTS legacy_type TEXT');
      await client.query('UPDATE cmap_edges SET legacy_type = relation_type WHERE legacy_type IS NULL AND relation_type IN (' + sqlList(CMAP_EDGE_LEGACY_TYPES) + ')');
      await client.query("UPDATE cmap_edges SET legacy_type = '없음' WHERE legacy_type IS NULL AND relation_type IS NULL");
      const toKindOld = n(await client.query("UPDATE cmap_edges SET relation_type = '종류' WHERE relation_type IN (" + sqlList(CMAP_EDGE_LEGACY_TYPES) + ')'));
      const toPart = n(await client.query("UPDATE cmap_edges SET relation_type = '일부' WHERE relation_type IS NULL AND btrim(label) = '일부'"));
      const toOpp = n(await client.query("UPDATE cmap_edges SET relation_type = '대립' WHERE relation_type IS NULL AND btrim(label) = '대립'"));
      const toKindNull = n(await client.query("UPDATE cmap_edges SET relation_type = '종류' WHERE relation_type IS NULL"));
      await client.query("UPDATE cmap_edges SET from_concept_id = to_concept_id, to_concept_id = from_concept_id WHERE relation_type = '대립' AND legacy_type = '없음' AND from_concept_id > to_concept_id");
      for (const r of typeChecks(rows)) await client.query('ALTER TABLE cmap_edges DROP CONSTRAINT ' + quoteIdent(r.conname));
      await client.query('ALTER TABLE cmap_edges ADD CONSTRAINT ' + CMAP_EDGE_TYPE_CHECK_V3 + ' CHECK (relation_type IN (' + sqlList(CMAP_EDGE_TYPES_V3) + '))');
      await client.query('ALTER TABLE cmap_edges ALTER COLUMN relation_type SET NOT NULL');
      const total = toKindOld + toPart + toOpp + toKindNull;
      if (total > 0) console.log('[DB] cmap_edges: 관계 유형 3종 통일, 변환 ' + total + '건(종류로 ' + (toKindOld + toKindNull) + '건, 일부 ' + toPart + '건, 대립 ' + toOpp + '건, 원래 유형 없음 ' + (toPart + toOpp + toKindNull) + '건)');
    }
    await client.query('COMMIT');
    }, { needs: ['cmap_edges_types_v2'], tx: true });

    // 작업JG-1: 일본어 문법 해설 캐시. 키는 앞뒤 공백을 뺀 문장의 sha256(hex). 성공한 응답만 저장한다(result = {translation, grammar[]}). 사용자와 무관한 공용 캐시라 users 를 참조하지 않는다
    await step('jgrammar_cache', async () => {
    await client.query(`
      CREATE TABLE IF NOT EXISTS jgrammar_cache (
        sentence_hash TEXT PRIMARY KEY,
        sentence      TEXT NOT NULL,
        result        JSONB NOT NULL,
        model         TEXT NOT NULL,
        created_at    TIMESTAMPTZ DEFAULT now()
      )
    `);
    // 작업313: 문장 학습(언어 일반화). 언어 코드 열이며 기존 행은 모두 ja. ja 이외 언어는 해시에 언어 코드가 들어가므로 PK(sentence_hash)는 그대로 둔다
    await client.query(`ALTER TABLE jgrammar_cache ADD COLUMN IF NOT EXISTS lang TEXT NOT NULL DEFAULT 'ja'`);
    });

    // 작업JG-2: 일본어 문법 해설 메뉴 권한. 개념 지도와 같은 방식(기본 false, 기존 사용자도 false)이지만 별도 열·별도 단계다
    await step('jgrammar_user_permission', async () => {
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS perm_jgrammar BOOLEAN NOT NULL DEFAULT false`);
    });

    // 작업JG-6: 일본어 문법 해설 사용자별 저장 목록(jgrammar_cache 와 별개). 사용자+문장 해시당 1건, 사용자가 지워지면 함께 지워진다. result = {translation, grammar[]}
    await step('jgrammar_saved', async () => {
    await client.query(`
      CREATE TABLE IF NOT EXISTS jgrammar_saved (
        id            SERIAL PRIMARY KEY,
        user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        sentence_hash TEXT NOT NULL,
        sentence      TEXT NOT NULL,
        result        JSONB NOT NULL,
        created_at    TIMESTAMPTZ DEFAULT now(),
        last_used_at  TIMESTAMPTZ DEFAULT now(),
        UNIQUE (user_id, sentence_hash)
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_jgrammar_saved_user_used ON jgrammar_saved(user_id, last_used_at DESC)`);
    // 작업313: 언어 코드 열(기존 행은 모두 ja). UNIQUE (user_id, sentence_hash) 는 그대로 — 해시에 언어가 들어가 언어 간 충돌이 없다. 목록·100건 상한은 (user_id, lang) 단위
    await client.query(`ALTER TABLE jgrammar_saved ADD COLUMN IF NOT EXISTS lang TEXT NOT NULL DEFAULT 'ja'`);
    }, { needs: ['users'] });

    // 작업343: 2인 대결 권한. 개념 지도·일본어 문법과 같은 방식(기본 false, 기존 사용자도 false, 관리자는 화면 쪽 규칙으로 따로 통과). 방은 서버 메모리에 있어 테이블은 없다
    await step('versus_user_permission', async () => {
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS perm_versus BOOLEAN NOT NULL DEFAULT false`);
    }, { needs: ['users'] });

    // 작업CL-1: 개념학습 삭제. 개념학습 전용 테이블 5개를 지운다(서로만 참조: quiz_attempts → links → items → studies, migrations 는 독립). 한 문장이라 전부 지우거나 전혀 지우지 않는다.
    // users.perm_concept_study 열과 음성 학습의 voice_concepts 테이블은 지우지 않는다.
    await step('concept_study_drop', async () => {
    await client.query(`DROP TABLE IF EXISTS concept_quiz_attempts, concept_links, concept_items, concept_studies, concept_migrations`);
    });

    console.log('[DB] init done: 총 ' + total + '단계, 실패 ' + failed.length + '단계' + (failed.length ? ' (실패: ' + failed.join(', ') + ')' : '')
      + (skipped.length ? ', 건너뜀 ' + skipped.length + '단계 (건너뜀: ' + skipped.join(', ') + ')' : ''));
    return { total, failed, skipped };
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

module.exports = { CMAP_EDGES_TYPES_V3_ROLLBACK_SQL, pool, initDB, trackUsage, createApiReadyGate };
