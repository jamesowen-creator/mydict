// 작업278-1: 개념 지도 — 음성 → 글 변환(전사). 개념학습의 전사 라우트(음성 입력, 작업206)의 로직·상수를 읽고 복사한 것이며 옛 파일은 불러오지도 바꾸지도 않는다.
// - 오디오는 메모리(req.body Buffer)에서만 다루고 OpenAI 로 보낸 뒤 버린다. 디스크·DB·로그에 남기지 않는다(로그에는 상태코드·오류 이름만). 전사 결과(글)도 이 모듈은 호출한 쪽에 돌려줄 뿐 저장하지 않는다.
// - 모델은 환경변수 VOICE_STT_MODEL(기본 gpt-4o-mini-transcribe), 분당 단가는 routes/admin.js calcCost 가 같은 이름의 환경변수·모델표로 계산한다(이 모듈은 값을 읽기만 하고 기록하지 않는다).
// - 한도: 이벤트 cmap_stt, 환경변수 CMAP_STT_DAILY_CAP(기본 20). 한도 확인은 외부 호출 전, 사용량 기록은 변환이 끝난 직후(빈 결과여도 기록, 실패(502)는 기록하지 않음).
'use strict';
const express = require('express');
const { trackUsage } = require('./db');

const STT_EVENT = 'cmap_stt';
const STT_MAX_BYTES = '6mb';                 // 60초 녹음은 보통 1MB 안팎
const STT_MAX_SECONDS = 60;
const STT_TIMEOUT_MS = 60000;
const STT_TYPES = { 'audio/webm': 'webm', 'audio/mp4': 'm4a', 'audio/mpeg': 'mp3', 'audio/wav': 'wav' };
const STT_FAIL_TEXT = '음성 변환에 실패했습니다. 잠시 후 다시 시도해주세요.';

function sttDailyCap() {
  const n = parseInt(process.env.CMAP_STT_DAILY_CAP, 10);
  return Number.isFinite(n) && n >= 1 && n <= 10000 ? n : 20;
}
function audioBaseType(req) { return String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase(); }
function requireAudioType(req, res, next) {
  if (!STT_TYPES[audioBaseType(req)]) return res.status(415).json({ ok: false, error: '지원하지 않는 오디오 형식입니다.' });
  next();
}
// 한도 초과(PayloadTooLargeError 등)를 JSON 응답으로 바꿔 준다
function audioBody(req, res, next) {
  express.raw({ type: 'audio/*', limit: STT_MAX_BYTES })(req, res, err => {
    if (!err) return next();
    const status = err.status === 413 ? 413 : 400;
    res.status(status).json({ ok: false, error: status === 413 ? '녹음 파일이 너무 큽니다.' : '요청을 읽을 수 없습니다.' });
  });
}

// 변환 1회. 성공 { text }, 실패 { status, error }. 호출 전에 한도·키는 호출한 쪽이 확인한다(키 없음은 여기서도 503).
async function transcribe(userId, audio, type, secondsHeader) {
  if (!process.env.OPENAI_API_KEY) return { status: 503, error: '음성 변환 기능을 사용할 수 없습니다.' };
  const model = process.env.VOICE_STT_MODEL || 'gpt-4o-mini-transcribe';
  const secondsRaw = parseFloat(secondsHeader);
  const seconds = Number.isFinite(secondsRaw) ? Math.min(STT_MAX_SECONDS, Math.max(0, Math.round(secondsRaw))) : 0;
  try {
    const form = new FormData();
    form.append('file', new Blob([audio], { type }), 'audio.' + STT_TYPES[type]);
    form.append('model', model);
    form.append('language', 'ko');
    const openaiRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` },
      body: form,
      signal: AbortSignal.timeout(STT_TIMEOUT_MS),
    });
    if (!openaiRes.ok) {
      console.error('cmap stt upstream status:', openaiRes.status);
      return { status: 502, error: STT_FAIL_TEXT };
    }
    const data = await openaiRes.json();
    const text = typeof data.text === 'string' ? data.text.trim() : '';
    trackUsage(userId, STT_EVENT, model, 0, 0, seconds);   // 변환이 끝났으면 빈 결과여도 비용이 생겼으므로 기록한다
    return { text };
  } catch (err) {
    console.error('cmap stt error:', err.name);           // 오류 이름만 남기고 메시지·본문은 남기지 않는다
    return { status: 502, error: STT_FAIL_TEXT };
  }
}

module.exports = { STT_EVENT, STT_MAX_BYTES, STT_MAX_SECONDS, STT_TIMEOUT_MS, STT_TYPES, sttDailyCap, audioBaseType, requireAudioType, audioBody, transcribe };
