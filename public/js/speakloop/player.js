// 작업399: Speak Loop 음성 재생기(공용). 저장된 원문 음성만 재생한다 — audio-index 에 없는 키는 재생하지 않고(브라우저 음성 합성 대체 없음) 호출한 쪽이 "음성 없음"을 보인다.
// - 클립은 Authorization 헤더 fetch → Blob URL 로 메모리에 보관(동시에 최대 4개). content_hash 가 바뀌면 다시 받는다. release() 로 URL 을 해제한다.
// - 한 번에 하나만 재생한다. 새로 재생하면 이전 것은 멈추고, stop() 은 쉬는 시간 대기까지 즉시 취소한다.
(function (root) {
  var CONCURRENCY = 4;

  function create(opts) {
    var token = opts.token;
    var P = { index: {}, rate: 1 };
    var clips = {};          // key -> { hash, url, dur }
    var loading = {};        // key -> Promise
    var gen = 0;             // stop()/새 재생마다 올라간다. 오래된 재생·대기는 이 값이 달라지면 끝낸다
    var current = null, wake = null, timer = null;
    var released = false;

    function headers() { return { Authorization: 'Bearer ' + (token() || '') }; }

    P.loadIndex = function () {
      return fetch('/api/speakloop/audio-index', { headers: headers() }).then(function (r) {
        if (!r.ok) throw new Error('index ' + r.status);
        return r.json();
      }).then(function (d) {
        if (!d || !d.ok || !d.index) throw new Error('index');
        P.index = d.index;
        return P.index;
      });
    };

    P.has = function (key) { return Object.prototype.hasOwnProperty.call(P.index, key); };

    function readDuration(url) {
      return new Promise(function (resolve) {
        var a = new window.Audio(), done = false;
        var fin = function (d) { if (done) return; done = true; resolve(isFinite(d) && d > 0 ? d : 0); };
        a.preload = 'metadata';
        a.addEventListener('loadedmetadata', function () { fin(a.duration); });
        a.addEventListener('error', function () { fin(0); });
        setTimeout(function () { fin(a.duration); }, 4000);
        a.src = url;
        if (isFinite(a.duration) && a.duration > 0) fin(a.duration);
      });
    }

    function fetchClip(key) {
      var hash = P.index[key];
      var have = clips[key];
      if (have && have.hash === hash) return Promise.resolve(have);
      if (loading[key]) return loading[key];
      var p = fetch('/api/speakloop/audio/' + encodeURIComponent(key), { headers: headers() }).then(function (r) {
        if (!r.ok) throw new Error('audio ' + r.status);
        return r.blob();
      }).then(function (blob) {
        var url = URL.createObjectURL(blob);
        return readDuration(url).then(function (dur) {
          if (released) { URL.revokeObjectURL(url); return null; }
          if (clips[key]) URL.revokeObjectURL(clips[key].url);   // 해시가 바뀐 옛 URL 해제
          clips[key] = { hash: hash, url: url, dur: dur };
          return clips[key];
        });
      }).then(function (c) { delete loading[key]; return c; }, function (e) { delete loading[key]; throw e; });
      loading[key] = p;
      return p;
    }

    // keys 중 audio-index 에 있는 것만 동시에 최대 4개씩 받는다. 실패한 키 목록을 돌려준다
    P.preload = function (keys) {
      var todo = keys.filter(P.has), failed = [], i = 0;
      function worker() {
        if (released || i >= todo.length) return Promise.resolve();
        var k = todo[i++];
        return fetchClip(k).catch(function () { failed.push(k); }).then(worker);
      }
      var ws = [];
      for (var n = 0; n < Math.min(CONCURRENCY, todo.length); n++) ws.push(worker());
      return Promise.all(ws).then(function () { return failed; });
    };

    P.ready = function (key) { return !!(P.has(key) && clips[key] && clips[key].hash === P.index[key]); };
    // 실제 재생 시간(초) = 음성 길이 ÷ 재생 속도
    P.seconds = function (key) { return P.ready(key) ? clips[key].dur / P.rate : 0; };

    function endCurrent() {
      if (current) { try { current.pause(); } catch (e) { /* 이미 멈춤 */ } current = null; }
      if (timer) { clearTimeout(timer); timer = null; }
      if (wake) { var w = wake; wake = null; w(false); }
    }
    P.stop = function () { gen++; endCurrent(); };

    // 한 클립 재생. 끝까지 재생하면 true, 취소·실패하면 false. 모바일에서는 사용자가 누른 직후 호출 흐름에서만 시작한다(자동 재생 없음)
    P.play = function (key, myGen) {
      if (myGen === undefined) { P.stop(); myGen = gen; }
      if (myGen !== gen) return Promise.resolve(false);
      return fetchClip(key).then(function (c) {
        if (!c || myGen !== gen) return false;
        return playUrl(c.url, P.rate, myGen);
      }, function () { return false; });
    };

    // Blob URL(내 녹음 등)을 재생. rate 를 직접 정한다(내 소리는 1.0). 한 번에 하나만 재생하는 규칙은 같다
    function playUrl(url, rate, myGen) {
      endCurrent();
      return new Promise(function (resolve) {
        var a = new window.Audio(url);
        a.playbackRate = rate;
        current = a;
        wake = resolve;
        var fin = function (ok) { if (current === a) { current = null; wake = null; } resolve(ok); };
        a.addEventListener('ended', function () { fin(true); });
        a.addEventListener('error', function () { fin(false); });
        var pr = a.play();
        if (pr && pr.catch) pr.catch(function () { fin(false); });
      });
    }
    P.playUrl = function (url, rate, myGen) {
      if (myGen === undefined) { P.stop(); myGen = gen; }
      if (myGen !== gen) return Promise.resolve(false);
      return playUrl(url, rate || 1, myGen);
    };

    // 취소할 수 있는 대기(초)
    P.wait = function (sec, myGen) {
      if (myGen !== gen) return Promise.resolve(false);
      return new Promise(function (resolve) {
        wake = resolve;
        timer = setTimeout(function () { timer = null; wake = null; resolve(true); }, Math.max(0, sec) * 1000);
      });
    };

    P.begin = function () { P.stop(); return gen; };
    P.alive = function (myGen) { return myGen === gen; };

    // keys 를 gapSec 간격으로 이어서 재생
    P.playSeq = function (keys, gapSec, myGen) {
      var chain = Promise.resolve(true);
      keys.forEach(function (k, n) {
        chain = chain.then(function (ok) {
          if (!ok) return false;
          return (n > 0 && gapSec > 0 ? P.wait(gapSec, myGen) : Promise.resolve(true)).then(function (ok2) { return ok2 ? P.play(k, myGen) : false; });
        });
      });
      return chain;
    };

    P.release = function () {
      released = true; P.stop();
      Object.keys(clips).forEach(function (k) { URL.revokeObjectURL(clips[k].url); });
      clips = {};
    };
    // 화면을 떠날 때(독백에서 목록으로): 받아 둔 URL 을 해제하되 재생기는 계속 쓸 수 있다
    P.clear = function () {
      P.stop();
      Object.keys(clips).forEach(function (k) { URL.revokeObjectURL(clips[k].url); });
      Object.keys(clips).forEach(function (k) { delete clips[k]; });
    };
    P._clips = clips;
    return P;
  }

  root.SLPlayer = { create: create, CONCURRENCY: CONCURRENCY };
})(typeof self !== 'undefined' ? self : this);
