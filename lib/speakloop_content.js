// 작업395: Speak Loop(영어 말하기) 콘텐츠. 서버가 가진 JSON(data/speakloop/content.json)만 쓰며, 사용자가 보낸 글자는 음성 생성에 들어가지 않는다.
// - 불러올 때 검증한다. 어긋나면 getContent() 가 예외를 던지고 API 는 500 으로 닫힌다(fail-closed).
// - 음성 클립 키(구분자는 마침표): 이디엄 받아쓰기 "<id>.say", 예문 전체 "<id>.ex", 예문 구 "<id>.ex.c<i>", 독백 문장 "<monologueId>.l<i>", 독백 구 "<monologueId>.l<i>.c<j>"
'use strict';
const fs = require('fs');
const path = require('path');

const CONTENT_PATH = path.join(__dirname, '..', 'data', 'speakloop', 'content.json');
const CHUNKS_MIN = 2;
const CHUNKS_MAX = 5;
const KINDS = ['idiom', 'sentence', 'chunk'];

const isText = v => typeof v === 'string' && v.trim() !== '';

// 문장(en, chunks) 하나 검증. 어긋난 이유 문자열 배열을 돌려준다
function checkSentence(where, en, chunks) {
  const errs = [];
  if (!isText(en)) { errs.push(where + ': en 이 비어 있음'); return errs; }
  if (!Array.isArray(chunks) || chunks.length < CHUNKS_MIN || chunks.length > CHUNKS_MAX) {
    errs.push(where + ': 구는 ' + CHUNKS_MIN + '~' + CHUNKS_MAX + '개여야 함');
    return errs;
  }
  chunks.forEach((c, i) => {
    for (const f of ['en', 'ko', 'st', 'p']) if (!c || !isText(c[f])) errs.push(where + '.c' + i + ': ' + f + ' 가 비어 있음');
  });
  if (!errs.length && chunks.map(c => c.en).join(' ') !== en) errs.push(where + ': 구를 공백 하나로 이어 붙인 글이 문장과 다름');
  return errs;
}

// 클립 목록 {key, kind, text}. 콘텐츠가 검증을 통과했다는 전제다
function clipsOf(content) {
  const clips = [];
  for (const it of content.idioms) {
    clips.push({ key: it.id + '.say', kind: 'idiom', text: it.say });
    clips.push({ key: it.id + '.ex', kind: 'sentence', text: it.example.en });
    it.example.chunks.forEach((c, i) => clips.push({ key: it.id + '.ex.c' + i, kind: 'chunk', text: c.en }));
  }
  for (const m of content.monologues) {
    m.lines.forEach((l, i) => {
      clips.push({ key: m.id + '.l' + i, kind: 'sentence', text: l.en });
      l.chunks.forEach((c, j) => clips.push({ key: m.id + '.l' + i + '.c' + j, kind: 'chunk', text: c.en }));
    });
  }
  return clips;
}

// 전체 검증. { ok, errors[] }
function validate(content) {
  const errors = [];
  if (!content || typeof content !== 'object' || Array.isArray(content)) return { ok: false, errors: ['콘텐츠가 객체가 아님'] };
  if (!Array.isArray(content.idioms) || !Array.isArray(content.monologues)) return { ok: false, errors: ['idioms·monologues 가 배열이 아님'] };
  const ids = new Set();
  const useId = (id, where) => {
    if (!isText(id) || id.includes('.')) errors.push(where + ': id 가 비었거나 마침표를 포함함');
    else if (ids.has(id)) errors.push(where + ': id 중복 ' + id);
    else ids.add(id);
  };
  content.idioms.forEach((it, n) => {
    const where = 'idioms[' + n + ']';
    if (!it || typeof it !== 'object') { errors.push(where + ': 객체가 아님'); return; }
    useId(it.id, where);
    if (!isText(it.say)) errors.push(where + ': say 가 비어 있음');
    if (!it.example || typeof it.example !== 'object') { errors.push(where + ': example 이 없음'); return; }
    errors.push(...checkSentence(where + '.example', it.example.en, it.example.chunks));
  });
  content.monologues.forEach((m, n) => {
    const where = 'monologues[' + n + ']';
    if (!m || typeof m !== 'object') { errors.push(where + ': 객체가 아님'); return; }
    useId(m.id, where);
    if (!Array.isArray(m.lines) || !m.lines.length) { errors.push(where + ': lines 가 비어 있음'); return; }
    m.lines.forEach((l, i) => errors.push(...checkSentence(where + '.lines[' + i + ']', l && l.en, l && l.chunks)));
  });
  if (!errors.length) {
    const seen = new Set();
    for (const c of clipsOf(content)) {
      if (!isText(c.text)) errors.push('클립 ' + c.key + ': 글이 비어 있음');
      if (seen.has(c.key)) errors.push('클립 키 중복 ' + c.key);
      seen.add(c.key);
    }
  }
  return { ok: errors.length === 0, errors };
}

let cached = null;   // { content, clips, keySet } | { error }
function load() {
  if (cached && !cached.error) return cached;
  try {
    const content = JSON.parse(fs.readFileSync(CONTENT_PATH, 'utf8'));
    const v = validate(content);
    if (!v.ok) throw new Error('콘텐츠 검증 실패: ' + v.errors.slice(0, 5).join(' / '));
    const clips = clipsOf(content);
    cached = { content, clips, keySet: new Set(clips.map(c => c.key)) };
    return cached;
  } catch (err) {
    console.error('speakloop content error:', err && err.message);
    throw err;
  }
}
const getContent = () => load().content;
const listClips = () => load().clips;
const hasClipKey = key => load().keySet.has(key);

module.exports = { CONTENT_PATH, KINDS, CHUNKS_MIN, CHUNKS_MAX, validate, clipsOf, getContent, listClips, hasClipKey };
