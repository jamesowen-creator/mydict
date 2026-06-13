#!/usr/bin/env node
// scripts/generate_literature_content.js
// Batch-generates Korean literature content via claude-haiku-4-5-20251001
// Run from repo root: node scripts/generate_literature_content.js

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs   = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');

const client   = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL    = 'claude-haiku-4-5-20251001';
const DELAY_MS = 500; // ms between API calls

const LIT_PATH = path.join(__dirname, '..', 'public', 'literature_db.json');
const DIG_PATH = path.join(__dirname, '..', 'public', 'digest_db.json');

// ── Work definitions ──────────────────────────────────────────────────────────
const WORKS = [
  // resistance
  { lit_id:'work_012', dig_id:'digest_010', title:'절정',               author:'이육사', year:'1940', level:'고등', movement_id:'resistance',       movement_name:'저항시',       era_context:'일제강점기 말기, 극한의 상황에서 의지를 노래한 저항시' },
  { lit_id:'work_013', dig_id:'digest_011', title:'광야',               author:'이육사', year:'1945', level:'고등', movement_id:'resistance',       movement_name:'저항시',       era_context:'일제강점기 말기·광복 직전, 민족의 미래에 대한 염원을 담은 저항시' },
  { lit_id:'work_014', dig_id:'digest_012', title:'자화상',             author:'윤동주', year:'1939', level:'중학', movement_id:'resistance',       movement_name:'저항시',       era_context:'1940년대 초 일제강점기, 자기 성찰의 저항시' },
  { lit_id:'work_015', dig_id:'digest_013', title:'빼앗긴 들에도 봄은 오는가', author:'이상화', year:'1926', level:'고등', movement_id:'resistance', movement_name:'저항시',      era_context:'1920년대 일제강점기, 국토 상실과 저항을 노래한 시' },
  { lit_id:'work_016', dig_id:'digest_014', title:'님의 침묵',           author:'한용운', year:'1926', level:'고등', movement_id:'resistance',       movement_name:'저항시',       era_context:'1920년대 일제강점기, 불교·민족주의적 저항 서정시' },
  { lit_id:'work_017', dig_id:'digest_015', title:'나룻배와 행인',       author:'한용운', year:'1926', level:'중학', movement_id:'resistance',       movement_name:'저항시',       era_context:'1920년대 일제강점기, 희생과 봉사의 정신을 담은 저항시' },
  { lit_id:'work_018', dig_id:'digest_016', title:'그날이 오면',         author:'심훈',   year:'1930', level:'중학', movement_id:'resistance',       movement_name:'저항시',       era_context:'1930년대 일제강점기, 광복의 열망을 직설적으로 표현한 저항시' },
  // cheongrokpa
  { lit_id:'work_019', dig_id:'digest_017', title:'봉황수',             author:'조지훈', year:'1942', level:'고등', movement_id:'cheongrokpa',     movement_name:'청록파',       era_context:'1940년대 일제강점기 말기, 사라져가는 전통 문화를 애도하는 청록파 시' },
  // imagism
  { lit_id:'work_020', dig_id:'digest_018', title:'향수',               author:'정지용', year:'1927', level:'중학', movement_id:'imagism',         movement_name:'이미지즘',     era_context:'1920년대 근대화 시기, 감각적 이미지로 고향 그리움을 표현한 이미지즘 시' },
  { lit_id:'work_021', dig_id:'digest_019', title:'유리창',             author:'정지용', year:'1930', level:'고등', movement_id:'imagism',         movement_name:'이미지즘',     era_context:'1930년대 모더니즘, 이미지즘 기법으로 슬픔을 형상화한 시' },
  { lit_id:'work_022', dig_id:'digest_020', title:'와사등',             author:'김광균', year:'1939', level:'고등', movement_id:'imagism',         movement_name:'이미지즘',     era_context:'1930년대 이미지즘, 도시의 고독을 회화적 이미지로 표현한 시' },
  // minjung (참여시)
  { lit_id:'work_023', dig_id:'digest_021', title:'풀',                 author:'김수영', year:'1968', level:'고등', movement_id:'minjung',         movement_name:'참여시',       era_context:'1960년대 군사독재 시기, 민중의 저항력을 풀에 빗댄 참여시' },
  { lit_id:'work_024', dig_id:'digest_022', title:'껍데기는 가라',       author:'신동엽', year:'1967', level:'고등', movement_id:'minjung',         movement_name:'참여시',       era_context:'1960년대 분단·독재 시기, 순수한 민족 정신의 회복을 외친 참여시' },
  { lit_id:'work_025', dig_id:'digest_023', title:'성북동 비둘기',       author:'김광섭', year:'1969', level:'고등', movement_id:'minjung',         movement_name:'참여시',       era_context:'1960년대 급격한 도시화·산업화 시기, 삶의 터전을 잃은 존재를 노래한 시' },
  { lit_id:'work_026', dig_id:'digest_024', title:'농무',               author:'신경림', year:'1971', level:'고등', movement_id:'minjung',         movement_name:'참여시',       era_context:'1970년대 산업화 시기, 농촌 민중의 한과 저항을 담은 참여시' },
  { lit_id:'work_027', dig_id:'digest_025', title:'폭포',               author:'김수영', year:'1957', level:'고등', movement_id:'minjung',         movement_name:'참여시',       era_context:'1950년대 한국전쟁 이후, 지식인의 자유 의지를 폭포 이미지로 표현한 시' },
  { lit_id:'work_028', dig_id:'digest_026', title:'봄',                 author:'이성부', year:'1968', level:'고등', movement_id:'minjung',         movement_name:'참여시',       era_context:'1960년대 군사독재 시기, 봄의 이미지로 민중의 역동성을 표현한 참여시' },
  // traditional_lyric
  { lit_id:'work_029', dig_id:'digest_027', title:'추억에서',           author:'박재삼', year:'1962', level:'고등', movement_id:'traditional_lyric', movement_name:'전통적 서정', era_context:'1960년대 전통 서정시, 어머니에 대한 추억과 가난의 한(恨)' },
  // folk_lyric (기존 사조)
  { lit_id:'work_030', dig_id:'digest_028', title:'먼 후일',             author:'김소월', year:'1925', level:'중학', movement_id:'folk_lyric',       movement_name:'민요적 서정시', era_context:'1920년대 일제강점기, 민요 리듬으로 이별과 체념을 노래한 시' },
  { lit_id:'work_031', dig_id:'digest_029', title:'초혼',               author:'김소월', year:'1925', level:'고등', movement_id:'folk_lyric',       movement_name:'민요적 서정시', era_context:'1920년대 일제강점기, 죽은 임을 부르는 절절한 사랑과 상실의 시' },
  // simunhak
  { lit_id:'work_032', dig_id:'digest_030', title:'모란이 피기까지는',   author:'김영랑', year:'1934', level:'중학', movement_id:'simunhak',         movement_name:'시문학파',     era_context:'1930년대 시문학파, 언어의 음악성으로 기다림과 슬픔을 표현한 순수시' },
  { lit_id:'work_033', dig_id:'digest_031', title:'떠나가는 배',         author:'박용철', year:'1930', level:'고등', movement_id:'simunhak',         movement_name:'시문학파',     era_context:'1930년대 시문학파, 이별과 상실의 정서를 음악적 언어로 표현한 순수시' },
  // saengmyeong
  { lit_id:'work_034', dig_id:'digest_032', title:'국화 옆에서',         author:'서정주', year:'1947', level:'중학', movement_id:'saengmyeong',     movement_name:'생명파',       era_context:'1940년대 생명파, 국화의 성숙 과정으로 존재의 의미를 탐구한 시' },
  { lit_id:'work_035', dig_id:'digest_033', title:'자화상',             author:'서정주', year:'1939', level:'고등', movement_id:'saengmyeong',     movement_name:'생명파',       era_context:'1930년대 후반 생명파, 자신의 출생과 존재를 강렬하게 탐구한 시' },
  { lit_id:'work_036', dig_id:'digest_034', title:'깃발',               author:'유치환', year:'1936', level:'고등', movement_id:'saengmyeong',     movement_name:'생명파',       era_context:'1930년대 후반 생명파, 의지와 허무 사이의 긴장을 깃발로 형상화한 시' },
];

// ── New movements ─────────────────────────────────────────────────────────────
const NEW_MOVEMENTS = [
  { id:'imagism',         name:'이미지즘',    period:'1920~30년대',    hint:'정지용·김광균 중심, 서구 이미지즘 영향, 감각적·회화적 이미지, 도시적/이국적 정서, 모더니즘', representative_authors:['정지용','김광균'] },
  { id:'minjung',         name:'참여시',      period:'1960~70년대',    hint:'산업화·민주화 시기, 현실 비판과 민중의 삶, 김수영·신동엽·신경림 등, 직설적이고 강한 어조', representative_authors:['김수영','신동엽','신경림','이성부'] },
  { id:'traditional_lyric', name:'전통적 서정', period:'1960년대',    hint:'한(恨)의 정서를 현대적으로 계승, 토속적이고 서정적인 언어, 박재삼 등 전통 서정', representative_authors:['박재삼'] },
  { id:'simunhak',        name:'시문학파',    period:'1930년대 초',    hint:'순수시 운동, 언어의 음악성과 형식미 추구, 현실 초월·예술지상주의, 김영랑·박용철', representative_authors:['김영랑','박용철'] },
  { id:'saengmyeong',     name:'생명파',      period:'1930년대 후반', hint:'인간 존재와 생명 본질 탐구, 강렬한 토속적·원시적 정서, 의지와 허무, 서정주·유치환', representative_authors:['서정주','유치환'] },
];

// ── All works for related_works generation (existing + new) ──────────────────
const ALL_LIT = [
  { id:'work_001', title:'진달래꽃',   author:'김소월', movement_id:'folk_lyric',  movement_name:'민요적 서정시' },
  { id:'work_002', title:'산유화',    author:'김소월', movement_id:'folk_lyric',  movement_name:'민요적 서정시' },
  { id:'work_003', title:'엄마야 누나야', author:'김소월', movement_id:'folk_lyric', movement_name:'민요적 서정시' },
  { id:'work_004', title:'나그네',    author:'박목월', movement_id:'cheongrokpa', movement_name:'청록파' },
  { id:'work_005', title:'청노루',    author:'박목월', movement_id:'cheongrokpa', movement_name:'청록파' },
  { id:'work_006', title:'승무',      author:'조지훈', movement_id:'cheongrokpa', movement_name:'청록파' },
  { id:'work_007', title:'해',        author:'박두진', movement_id:'cheongrokpa', movement_name:'청록파' },
  { id:'work_008', title:'서시',      author:'윤동주', movement_id:'resistance',  movement_name:'저항시' },
  { id:'work_009', title:'별 헤는 밤', author:'윤동주', movement_id:'resistance',  movement_name:'저항시' },
  { id:'work_011', title:'청포도',    author:'이육사', movement_id:'resistance',  movement_name:'저항시' },
  ...WORKS.map(w => ({ id:w.lit_id, title:w.title, author:w.author, movement_id:w.movement_id, movement_name:w.movement_name })),
];

// digest equivalents (work_006/승무 has no digest entry)
const LIT_TO_DIG_META = {
  'work_001': { dig_id:'digest_001', title:'진달래꽃',   author:'김소월', movement_id:'folk_lyric',  movement_name:'민요적 서정시' },
  'work_002': { dig_id:'digest_002', title:'산유화',    author:'김소월', movement_id:'folk_lyric',  movement_name:'민요적 서정시' },
  'work_003': { dig_id:'digest_003', title:'엄마야 누나야', author:'김소월', movement_id:'folk_lyric', movement_name:'민요적 서정시' },
  'work_004': { dig_id:'digest_005', title:'나그네',    author:'박목월', movement_id:'cheongrokpa', movement_name:'청록파' },
  'work_005': { dig_id:'digest_006', title:'청노루',    author:'박목월', movement_id:'cheongrokpa', movement_name:'청록파' },
  'work_007': { dig_id:'digest_007', title:'해',        author:'박두진', movement_id:'cheongrokpa', movement_name:'청록파' },
  'work_008': { dig_id:'digest_004', title:'서시',      author:'윤동주', movement_id:'resistance',  movement_name:'저항시' },
  'work_009': { dig_id:'digest_008', title:'별 헤는 밤', author:'윤동주', movement_id:'resistance',  movement_name:'저항시' },
  'work_011': { dig_id:'digest_009', title:'청포도',    author:'이육사', movement_id:'resistance',  movement_name:'저항시' },
};
WORKS.forEach(w => {
  LIT_TO_DIG_META[w.lit_id] = { dig_id:w.dig_id, title:w.title, author:w.author, movement_id:w.movement_id, movement_name:w.movement_name };
});
const ALL_DIG = Object.values(LIT_TO_DIG_META);

// ── Related-works helpers ─────────────────────────────────────────────────────
function buildLitRelated(litId) {
  const work = ALL_LIT.find(w => w.id === litId);
  if (!work) return [];
  const result = []; const seen = new Set([litId]);

  // same author first (max 2)
  ALL_LIT.filter(w => w.author === work.author && !seen.has(w.id))
    .slice(0, 2).forEach(w => { result.push({ id:w.id, title:w.title, author:w.author, relation:'같은 작가' }); seen.add(w.id); });

  // same movement to fill up to 3
  if (result.length < 3) {
    ALL_LIT.filter(w => w.movement_id === work.movement_id && !seen.has(w.id))
      .slice(0, 3 - result.length).forEach(w => {
        result.push({ id:w.id, title:w.title, author:w.author, relation:`같은 사조 — ${work.movement_name}` });
        seen.add(w.id);
      });
  }
  return result;
}

function buildDigRelated(digId) {
  const work = ALL_DIG.find(w => w.dig_id === digId);
  if (!work) return [];
  const result = []; const seen = new Set([digId]);

  ALL_DIG.filter(w => w.author === work.author && !seen.has(w.dig_id))
    .slice(0, 2).forEach(w => { result.push({ id:w.dig_id, title:w.title, author:w.author, relation:'같은 작가' }); seen.add(w.dig_id); });

  if (result.length < 3) {
    ALL_DIG.filter(w => w.movement_id === work.movement_id && !seen.has(w.dig_id))
      .slice(0, 3 - result.length).forEach(w => {
        result.push({ id:w.dig_id, title:w.title, author:w.author, relation:`같은 사조 — ${work.movement_name}` });
        seen.add(w.dig_id);
      });
  }
  return result;
}

// ── API helpers ───────────────────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function callHaiku(userPrompt, attempt = 0) {
  try {
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 2048,
      system: '당신은 한국 현대문학 전문가입니다. 반드시 유효한 JSON만 출력하세요. 마크다운 코드 블록(```), 줄바꿈 앞뒤 텍스트, 설명 등을 절대 포함하지 마세요.',
      messages: [{ role:'user', content: userPrompt }],
    });
    const raw = res.content[0].text.trim();
    const cleaned = raw.replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'').trim();
    return JSON.parse(cleaned);
  } catch (e) {
    if (attempt < 2) {
      console.warn(`     retry ${attempt + 1}...`);
      await sleep(1000);
      return callHaiku(userPrompt, attempt + 1);
    }
    throw e;
  }
}

async function genMovementBriefing(mv) {
  const prompt = `다음 한국 현대문학 사조에 대한 정보를 JSON으로 생성해주세요.

사조명: ${mv.name}
시기: ${mv.period}
주요 특징: ${mv.hint}

아래 JSON 스키마로만 응답하세요:
{
  "era_background": "시대적 배경 2~3문장",
  "characteristics": "이 사조의 특징과 주요 경향 2~3문장",
  "keywords": ["키워드1","키워드2","키워드3","키워드4","키워드5"],
  "representative_authors": ${JSON.stringify(mv.representative_authors)}
}`;
  return callHaiku(prompt);
}

async function genWorkContent(w) {
  const prompt = `아래 한국 현대시에 대한 학습 콘텐츠를 JSON으로 생성해주세요.

작품: ${w.title}
작가: ${w.author} (${w.year}년 발표)
문학사조: ${w.movement_name}
학습대상: ${w.level}
시대적 맥락: ${w.era_context}

아래 JSON 스키마로만 응답하세요 (모든 텍스트는 한국어):
{
  "keywords": ["키워드1","키워드2","키워드3","키워드4","키워드5"],
  "genre_desc": "이 시의 장르 특성과 이 작품이 어떻게 구현하는지 2~3문장",
  "author_desc": "작가의 생몰년·이력·문학적 특징·대표작 3~4문장",
  "era_desc": "작품의 시대적 배경과 문학사적 의미 3~4문장",
  "one_line": "작품의 핵심을 담은 한 문장 요약",
  "summary": "작품 전체 내용 요약 4~6문장",
  "key_scenes": ["장면1 — 의미","장면2 — 의미","장면3 — 의미"],
  "theme": "작품의 주제 한 문장",
  "emotion": "주요 정서 2~4개, 쉼표로 구분"
}`;
  return callHaiku(prompt);
}

// ── Main ──────────────────────────────────────────────────────────────────────
(async () => {
  if (!process.env.ANTHROPIC_API_KEY) { console.error('ANTHROPIC_API_KEY not set'); process.exit(1); }

  const litDb  = JSON.parse(fs.readFileSync(LIT_PATH, 'utf8'));
  const digDb  = JSON.parse(fs.readFileSync(DIG_PATH, 'utf8'));
  const errors = [];

  // Map of existing movements by id
  const era = litDb.eras[0];
  const movByIdLit = {};
  era.movements.forEach(m => { movByIdLit[m.id] = m; });

  // ── Step 1: Generate movement briefings ────────────────────────────────────
  console.log('\n=== STEP 1: movement briefings ===');
  for (const mv of NEW_MOVEMENTS) {
    if (movByIdLit[mv.id] && movByIdLit[mv.id].briefing && movByIdLit[mv.id].briefing.keywords) {
      console.log(`  → ${mv.name} — already exists, skipping`);
      continue;
    }
    console.log(`  → ${mv.name} ...`);
    try {
      const briefing = await genMovementBriefing(mv);
      movByIdLit[mv.id] = {
        id: mv.id,
        name: mv.name,
        period: mv.period,
        briefing,
        works: [],
      };
      console.log(`     ✓ keywords: ${briefing.keywords.join(', ')}`);
    } catch (e) {
      console.error(`     ✗ FAILED: ${e.message}`);
      errors.push(`movement:${mv.id} — ${e.message}`);
      // Create skeleton so works can still be added
      movByIdLit[mv.id] = { id:mv.id, name:mv.name, period:mv.period, briefing:{}, works:[] };
    }
    await sleep(DELAY_MS);
  }

  // Build sets of already-existing IDs for idempotency
  const existingLitIds = new Set();
  era.movements.forEach(m => m.works.forEach(w => existingLitIds.add(w.id)));
  const existingDigIds = new Set(digDb.works.map(w => w.id));

  // ── Step 2: Generate work content ─────────────────────────────────────────
  console.log('\n=== STEP 2: work content ===');
  for (const w of WORKS) {
    if (existingLitIds.has(w.lit_id) && existingDigIds.has(w.dig_id)) {
      console.log(`  → [${w.lit_id}] ${w.title} — already exists, skipping`);
      continue;
    }
    console.log(`  → [${w.lit_id}] ${w.title} (${w.author}) ...`);
    let content;
    try {
      content = await genWorkContent(w);
      console.log(`     ✓ theme: ${content.theme}`);
    } catch (e) {
      console.error(`     ✗ FAILED: ${e.message}`);
      errors.push(`work:${w.lit_id}(${w.title}) — ${e.message}`);
      await sleep(DELAY_MS);
      continue;
    }
    await sleep(DELAY_MS);

    // Build literature_db entry
    const litEntry = {
      id: w.lit_id,
      title: w.title,
      author: w.author,
      year: w.year,
      genre: '시',
      literary_movement: w.movement_name,
      level: w.level,
      quiz_unlocked: false,
      keywords:    content.keywords,
      genre_desc:  content.genre_desc,
      author_desc: content.author_desc,
      era_desc:    content.era_desc,
      related_works: buildLitRelated(w.lit_id),
    };

    // Add to correct movement
    if (!movByIdLit[w.movement_id]) {
      errors.push(`work:${w.lit_id} — movement '${w.movement_id}' not found`);
    } else {
      movByIdLit[w.movement_id].works.push(litEntry);
    }

    // Build digest_db entry
    const digEntry = {
      id: w.dig_id,
      title: w.title,
      author: w.author,
      year: w.year,
      genre: '시',
      level: w.level,
      one_line:   content.one_line,
      summary:    content.summary,
      key_scenes: content.key_scenes,
      theme:      content.theme,
      emotion:    content.emotion,
      related_works: buildDigRelated(w.dig_id),
    };
    digDb.works.push(digEntry);
  }

  // ── Step 3: Rebuild literature_db movements array ─────────────────────────
  // Preserve original movement order, then append new ones
  const origOrder = ['folk_lyric','cheongrokpa','resistance'];
  const newOrder  = NEW_MOVEMENTS.map(m => m.id);
  const finalOrder = [
    ...origOrder,
    ...newOrder.filter(id => !origOrder.includes(id)),
  ];
  era.movements = finalOrder.map(id => movByIdLit[id]).filter(Boolean);

  // ── Step 4: Update metadata & validate ────────────────────────────────────
  litDb.version      = '1.1';
  litDb.last_updated = '2026-06-13';
  digDb.version      = '1.1';
  digDb.last_updated = '2026-06-13';

  // Count new works
  let litTotal = 0;
  era.movements.forEach(m => { litTotal += m.works.length; });
  console.log(`\n=== Summary ===`);
  console.log(`literature_db: ${litTotal} works across ${era.movements.length} movements`);
  console.log(`digest_db:     ${digDb.works.length} works`);

  if (errors.length) {
    console.warn('\nErrors encountered:');
    errors.forEach(e => console.warn('  !', e));
  }

  // Validate
  JSON.parse(JSON.stringify(litDb));
  JSON.parse(JSON.stringify(digDb));

  // ── Step 5: Write ──────────────────────────────────────────────────────────
  fs.writeFileSync(LIT_PATH, JSON.stringify(litDb, null, 2), 'utf8');
  fs.writeFileSync(DIG_PATH, JSON.stringify(digDb, null, 2), 'utf8');
  console.log('\n✓ literature_db.json updated');
  console.log('✓ digest_db.json updated');

  if (errors.length) {
    console.warn(`\n⚠ Completed with ${errors.length} error(s). Review above.`);
    process.exit(1);
  }
  console.log('\nDone.');
})();
