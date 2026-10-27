// 몰입형 예외: design_lint 대상 밖에 의도적으로 둠.
// 스펠링 런의 무대(캔버스·HUD·시작/결과 카드)는 시제품의 어두운 무대와 자체 색을 그대로 쓴다. 헤더와 뒤로가기만 앱 규격(tokens.css)을 따른다.
// public/css 아래 CSS 파일은 design_lint 검사 대상이라 두지 않고, 무대 안쪽 CSS를 런타임에 <style>로 주입한다.
// 글꼴은 앱의 기존 글꼴 스택(--font-sans, tokens.css)을 쓴다. 시제품의 Fredoka·Jua 외부 글꼴은 로드하지 않는다.
(function () {
  var css = `

[hidden]{display:none !important}
.sr-stage{
  --ink:#1d2b53;--ink-soft:#56628f;--paper:#ffffff;--stage:#14204a;--sky-top:#8fd3f4;--sky-bot:#eaf6f0;
  --coral:#ff6b5a;--gold:#ffb700;--gold-deep:#a86a00;--good:#1fae68;--bad:#e8454f;
  --f-display:var(--font-sans,"Noto Sans KR",sans-serif);--f-letter:var(--font-sans,"Noto Sans KR",sans-serif);--f-body:var(--font-sans,"Noto Sans KR",sans-serif);
  position:relative;box-sizing:border-box;display:flex;justify-content:center;padding:8px 0;border-radius:12px;background:var(--stage);color:var(--ink);font-family:var(--f-body);line-height:normal;
  touch-action:manipulation;overscroll-behavior:none;-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent;
}
.sr-box canvas{position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none}
.sr-box h1,.sr-box h2,.sr-box p,.sr-box ul{margin:0}
.sr-box .meaning,.sr-box .title,.sr-box .btn,.sr-box .popword .tag,.sr-box .popword .pm,.sr-box .banner .b2,.sr-box .combo{font-weight:700}
.sr-box .title.small{font-size:calc(36 * var(--u))}
.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
.sr-box{
  --u:1px;
  position:relative;
  width:360px;
  height:640px;
  overflow:hidden;
  border-radius:calc(18 * var(--u));
  background:var(--sky-bot);
  box-shadow:0 calc(6 * var(--u)) 0 rgba(0,0,0,.35);
}
.sr-box .hud{
  position:absolute;left:0;right:0;top:0;
  padding:calc(12 * var(--u)) calc(14 * var(--u)) 0;
  display:flex;flex-direction:column;align-items:center;gap:calc(4 * var(--u));
  pointer-events:none;
}
.sr-box .row{width:100%;display:flex;justify-content:space-between;align-items:center;gap:calc(8 * var(--u))}
.sr-box .hearts{display:flex;gap:calc(3 * var(--u))}
.sr-box .hearts svg{width:calc(23 * var(--u));height:calc(23 * var(--u));fill:var(--bad);stroke:var(--ink);stroke-width:1.8;stroke-linejoin:round}
.sr-box .hearts svg.off{fill:rgba(29,43,83,.14);stroke:rgba(29,43,83,.35)}
.sr-box .scorebox{display:flex;align-items:center;gap:calc(8 * var(--u))}
.sr-box .score{font-family:var(--f-letter);font-weight:700;font-size:calc(24 * var(--u));font-variant-numeric:tabular-nums;line-height:1}
.sr-box .combo{
  font-family:var(--f-display);font-size:calc(13 * var(--u));line-height:1;
  background:var(--gold);color:var(--ink);border:calc(2 * var(--u)) solid var(--ink);
  border-radius:999px;padding:calc(3 * var(--u)) calc(9 * var(--u));
}
.sr-box .progress{font-family:var(--f-letter);font-weight:600;font-size:calc(13 * var(--u));color:var(--ink-soft);font-variant-numeric:tabular-nums}
.sr-box .speedtag{
  font-family:var(--f-letter);font-weight:700;font-size:calc(12 * var(--u));color:var(--ink);
  background:var(--gold);border:calc(2 * var(--u)) solid var(--ink);border-radius:999px;
  padding:calc(2 * var(--u)) calc(9 * var(--u));font-variant-numeric:tabular-nums;
}
.sr-box .snd{
  pointer-events:auto;cursor:pointer;
  font-family:var(--f-body);font-weight:700;font-size:calc(11 * var(--u));color:var(--ink);
  background:rgba(255,255,255,.7);border:calc(2 * var(--u)) solid var(--ink);border-radius:999px;
  padding:calc(3 * var(--u)) calc(10 * var(--u));
}
.sr-box .meaning.enter{animation:sr-meaningin .55s cubic-bezier(.2,1.3,.4,1)}
@keyframes sr-meaningin{0%{transform:scale(.6);opacity:0}100%{transform:none;opacity:1}}
.sr-box .meaning{
  width:100%;font-family:var(--f-display);font-size:calc(var(--mfs,28) * var(--u));line-height:1.15;text-align:center;
  word-break:keep-all;overflow-wrap:normal;margin-top:calc((4 + var(--hs,24)) * var(--u));
}
.sr-box .word{display:flex;justify-content:center;align-items:flex-end;gap:calc(var(--sg,5) * var(--u));margin-top:calc(18 * var(--u));--cw:32;--fs:30;--cg:3}   /* 위쪽 18: 보조 줄과 조각 칸 표시(×N)·높은 칸 삼각형이 겹치지 않게 */
.sr-box .slot{position:relative;display:flex;gap:calc(var(--cg,3) * var(--u))}
.sr-box .slot.high::after{content:"";position:absolute;left:50%;top:calc(-13 * var(--u));margin-left:calc(-6 * var(--u));border:calc(6 * var(--u)) solid transparent;border-top:0;border-bottom:calc(9 * var(--u)) solid var(--gold-deep)}
.sr-box .hintbox{width:100%;display:flex;flex-direction:column;gap:calc(4 * var(--u));transform-origin:50% 50%}
.sr-box .hintbox.intro{position:relative;z-index:3}
.sr-box .hintbox.intro .meaning{text-shadow:0 0 calc(3 * var(--u)) #fff,0 0 calc(3 * var(--u)) #fff,calc(1 * var(--u)) 0 0 #fff,calc(-1 * var(--u)) 0 0 #fff,0 calc(1 * var(--u)) 0 #fff,0 calc(-1 * var(--u)) 0 #fff}   /* 연출 중에만: 하늘·구름 위 가독성(끝나면 작업322 모양 그대로) */
.sr-box .word > .iv{animation:sr-slotin .22s cubic-bezier(.2,1.3,.4,1)}
@keyframes sr-slotin{0%{transform:scale(.55);opacity:0}100%{transform:none;opacity:1}}
.sr-box .sub{
  width:100%;text-align:center;font-family:var(--f-body);font-weight:700;font-size:calc(var(--sfs,12) * var(--u));line-height:1.3;color:var(--ink);
  word-break:keep-all;overflow-wrap:normal;margin-top:calc(2 * var(--u));
  text-shadow:0 0 calc(3 * var(--u)) #fff,0 0 calc(3 * var(--u)) #fff,calc(1 * var(--u)) 0 0 #fff,calc(-1 * var(--u)) 0 0 #fff,0 calc(1 * var(--u)) 0 #fff,0 calc(-1 * var(--u)) 0 #fff;   /* 하늘색 배경·구름 위에서도 읽히도록 흰 외곽 */
}
.sr-box .ttssrc{position:absolute;right:calc(8 * var(--u));bottom:calc(6 * var(--u));max-width:62%;text-align:right;font-size:calc(10 * var(--u));font-weight:700;line-height:1.3;color:#fff;text-shadow:0 0 calc(3 * var(--u)) #14204a,0 0 calc(3 * var(--u)) #14204a;pointer-events:none;z-index:6}   /* 점검 옵션 ttsdebug=1 일 때만 JS 가 만든다 */
.sr-box .tune{position:absolute;left:0;bottom:0;min-height:44px;padding:0 calc(10 * var(--u));margin:0;background:none;border:0;font-family:var(--f-body);font-size:calc(11 * var(--u));font-weight:700;color:var(--gold);text-decoration:underline;cursor:pointer;z-index:5}
.sr-box .slot.chunk{
  padding:0 calc(4 * var(--u));margin-top:calc(2 * var(--u));
  background:rgba(255,183,0,.24);border-radius:calc(10 * var(--u));
  outline:calc(2 * var(--u)) dashed var(--gold);outline-offset:calc(1 * var(--u));
}
.sr-box .slot.chunk::before{
  content:attr(data-mult);position:absolute;right:calc(2 * var(--u));top:calc(-17 * var(--u));
  font-family:var(--f-letter);font-weight:700;font-size:calc(11 * var(--u));color:var(--gold-deep);
}
.sr-box .cell{
  width:calc(var(--cw) * var(--u));height:calc(46 * var(--u));
  border-bottom:calc(4 * var(--u)) solid var(--ink);
  font-family:var(--f-letter);font-weight:700;font-size:calc(var(--fs) * var(--u));
  line-height:calc(42 * var(--u));text-align:center;box-sizing:border-box;
}
.sr-box .cell.fixed{border-bottom-color:transparent;width:calc(var(--cw) * .6 * var(--u))}
.sr-box .slot.cur .cell{border-bottom-color:var(--coral);animation:sr-blink .9s steps(2,jump-none) infinite}
.sr-box .cell.hint{color:var(--good);border-bottom-color:var(--good);animation:sr-none}
.sr-box .cell.ghost{color:rgba(29,43,83,.32)}
.sr-box .slot.done .cell{border-bottom-color:var(--good);color:var(--ink)}
.sr-box .slot.done .cell.pop{animation:sr-pop .28s ease-out}
.sr-box .slot.bad{animation:sr-shake .3s}
@keyframes sr-blink{50%{border-bottom-color:rgba(255,107,90,.25)}}
@keyframes sr-pop{0%{transform:scale(.4)}60%{transform:scale(1.25)}100%{transform:scale(1)}}
@keyframes sr-shake{25%{transform:translateX(-5px)}75%{transform:translateX(5px)}}
.sr-box .popword{
  position:absolute;left:calc(16 * var(--u));right:calc(16 * var(--u));top:34%;box-sizing:border-box;
  display:flex;flex-direction:column;align-items:center;gap:calc(2 * var(--u));
  background:var(--paper);border:calc(3 * var(--u)) solid var(--ink);border-radius:calc(22 * var(--u));
  box-shadow:0 calc(6 * var(--u)) 0 var(--ink);padding:calc(12 * var(--u)) calc(16 * var(--u)) calc(14 * var(--u));
  pointer-events:none;text-align:center;word-break:keep-all;
}
.sr-box .popword.go{animation:sr-popin .45s cubic-bezier(.2,1.4,.4,1)}
@keyframes sr-popin{0%{transform:translateY(20px) scale(.6);opacity:0}100%{transform:none;opacity:1}}
.sr-box .popword .tag{font-family:var(--f-display);font-size:calc(14 * var(--u));color:var(--good);min-height:calc(18 * var(--u))}
.sr-box .popword .pw{width:100%;display:flex;justify-content:center;white-space:nowrap;font-family:var(--f-letter);font-weight:700;font-size:calc(var(--pfs,44) * var(--u));line-height:1.15}
.sr-box .popword .pl{display:inline-block}
.sr-box .popword.go .pl{animation:sr-letter .55s cubic-bezier(.2,1,.4,1) backwards;animation-delay:calc(var(--i) * 55ms)}
@keyframes sr-letter{0%{transform:translate(var(--fx,0px),var(--fy,0px)) scale(.55);opacity:.85}55%{transform:translate(0,calc(-16 * var(--u))) scale(1.22);opacity:1}78%{transform:translate(0,calc(2 * var(--u))) scale(.96)}100%{transform:none}}
.sr-box .popword .pp{font-family:var(--f-body);font-size:calc(13 * var(--u));font-weight:500;color:var(--ink-soft);max-width:100%;overflow-wrap:anywhere}
.sr-box .popword .pm{width:100%;font-family:var(--f-display);font-size:calc(var(--pmfs,22) * var(--u));color:var(--ink-soft);line-height:1.2}
.sr-box .popword .pe{width:100%;font-family:var(--f-body);font-size:calc(var(--pefs,13) * var(--u));font-weight:500;color:var(--ink);line-height:1.35;margin-top:calc(2 * var(--u))}
.sr-box .popword .pe b{font-weight:700;color:var(--coral);background:rgba(255,183,0,.28);border-radius:calc(3 * var(--u));padding:0 calc(2 * var(--u))}
.sr-box .popword .pn{font-size:calc(11.5 * var(--u));font-weight:700;color:var(--bad)}
.sr-box .screen{
  position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
  background:rgba(20,32,74,.42);padding:calc(16 * var(--u));
}
.sr-box .card{
  width:100%;max-height:100%;overflow:auto;box-sizing:border-box;
  background:var(--paper);border:calc(3 * var(--u)) solid var(--ink);border-radius:calc(22 * var(--u));
  box-shadow:0 calc(7 * var(--u)) 0 var(--ink);padding:calc(18 * var(--u)) calc(16 * var(--u)) calc(16 * var(--u));
  display:flex;flex-direction:column;gap:calc(10 * var(--u));
}
.sr-box .title{font-family:var(--f-display);font-size:calc(var(--tfs,42) * var(--u));line-height:1;margin:0;text-align:center;white-space:nowrap}
.sr-box .lead{margin:0;text-align:center;font-weight:700;font-size:calc(14 * var(--u));line-height:1.5;text-wrap:balance}
.sr-box .rules{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:calc(7 * var(--u))}
.sr-box .rules li{position:relative;padding-left:calc(18 * var(--u));font-size:calc(12 * var(--u));line-height:1.45;font-weight:500}
.sr-box .rules li::before{content:"";position:absolute;left:0;top:calc(.45em);width:calc(9 * var(--u));height:calc(9 * var(--u));border-radius:calc(3 * var(--u));background:var(--coral);border:calc(1.5 * var(--u)) solid var(--ink)}
.sr-box .rules li.gold::before{background:var(--gold)}
.sr-box .rules li.mint::before{background:#7ed9c3}
.sr-box .rules li.red::before{background:#ff4d5e}
.sr-box .trow{display:flex;justify-content:center;gap:calc(8 * var(--u))}
.sr-box .note{margin:0;font-size:calc(11.5 * var(--u));color:var(--ink-soft);line-height:1.45;text-align:center}
.sr-box .btn{
  font-family:var(--f-display);font-size:calc(22 * var(--u));line-height:1;cursor:pointer;
  color:var(--ink);background:var(--coral);border:calc(3 * var(--u)) solid var(--ink);border-radius:calc(16 * var(--u));
  padding:calc(13 * var(--u)) calc(16 * var(--u));box-shadow:0 calc(5 * var(--u)) 0 var(--ink);
  transition:transform .08s,box-shadow .08s;
}
.sr-box .btn:active{transform:translateY(calc(4 * var(--u)));box-shadow:0 calc(1 * var(--u)) 0 var(--ink)}
.sr-box .btn.alt{background:#9db8ff}
.sr-box .btn:disabled{background:#d7dbe8;color:var(--ink-soft);cursor:not-allowed;box-shadow:0 calc(5 * var(--u)) 0 #9aa3c2;border-color:#9aa3c2}
.sr-box .btn:focus-visible,.sr-box .snd:focus-visible{outline:calc(3 * var(--u)) solid var(--ink);outline-offset:calc(3 * var(--u))}
.sr-box .toggle{
  align-self:center;cursor:pointer;font-family:var(--f-body);font-weight:700;font-size:calc(12 * var(--u));color:var(--ink);
  background:transparent;border:calc(2 * var(--u)) solid var(--ink);border-radius:999px;padding:calc(5 * var(--u)) calc(14 * var(--u));
}
.sr-box .toggle[aria-pressed="true"]{background:var(--ink);color:#fff}
.sr-box .pvarea{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:calc(8 * var(--u));min-height:calc(120 * var(--u));width:100%;padding:calc(10 * var(--u));cursor:pointer;font-family:var(--f-body);color:var(--ink);background:#eef0f6;border:calc(2 * var(--u)) solid var(--ink);border-radius:calc(16 * var(--u));text-align:center}
.sr-box .pvarea:disabled{cursor:default}
.sr-box .pvarea:focus-visible{outline:calc(3 * var(--u)) solid var(--ink);outline-offset:calc(3 * var(--u))}
.sr-box .pvw{font-family:var(--f-letter);font-weight:700;font-size:calc(34 * var(--u));line-height:1.1;overflow-wrap:anywhere;max-width:100%}
.sr-box .pvm{font-weight:700;font-size:calc(24 * var(--u));line-height:1.25;overflow-wrap:anywhere;word-break:keep-all;max-width:100%}
.sr-box #pv .toggle{align-self:center}
.sr-box .vsview{display:flex;flex-direction:column;gap:calc(10 * var(--u))}
.sr-box .vsview[hidden]{display:none}
.sr-box .vlist{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:calc(6 * var(--u));max-height:calc(150 * var(--u));overflow:auto}
.sr-box .vlist li{display:flex;align-items:center;justify-content:space-between;gap:calc(8 * var(--u));border:calc(2 * var(--u)) solid var(--ink);border-radius:calc(12 * var(--u));padding:calc(6 * var(--u)) calc(10 * var(--u));font-size:calc(13 * var(--u));font-weight:700}
.sr-box .vlist li .vm{font-size:calc(11 * var(--u));font-weight:500;color:var(--ink-soft)}
.sr-box .vlist li .vn{min-width:0;overflow-wrap:anywhere}
.sr-box .vsbtn,.sr-box #vs .btn,.sr-box #pv .btn{min-height:var(--ctl-min-h,44px);min-width:calc(88 * var(--u))}
.sr-box .toggle:focus-visible{outline:calc(3 * var(--u)) solid var(--ink);outline-offset:calc(3 * var(--u))}
.sr-box .big{font-family:var(--f-letter);font-weight:700;white-space:nowrap;font-size:calc(var(--bfs,56) * var(--u));line-height:1;text-align:center;font-variant-numeric:tabular-nums}
.sr-box .stats{display:flex;justify-content:center;gap:calc(22 * var(--u));font-size:calc(13 * var(--u));font-weight:700;text-align:center}
.sr-box .stats > div{min-width:0}
.sr-box .stats b{display:block;font-family:var(--f-letter);font-size:calc(22 * var(--u));font-variant-numeric:tabular-nums}
.sr-box .chips{display:flex;flex-wrap:wrap;gap:calc(6 * var(--u));justify-content:center}
.sr-box .chip{
  border:calc(2 * var(--u)) solid var(--ink);border-radius:999px;padding:calc(3 * var(--u)) calc(10 * var(--u));
  font-family:var(--f-body);font-size:calc(12 * var(--u));font-weight:700;line-height:1.35;background:#eef0f6;color:var(--ink-soft);
  cursor:pointer;max-width:100%;text-align:left;word-break:keep-all;overflow-wrap:anywhere;
}
.sr-box .chip:focus-visible{outline:calc(3 * var(--u)) solid var(--ink);outline-offset:calc(2 * var(--u))}
.sr-box .chip.boss{border-color:var(--gold-deep);box-shadow:0 0 0 calc(2 * var(--u)) var(--gold)}
.sr-box .chip em{font-style:normal;font-family:var(--f-letter);font-size:calc(10 * var(--u));background:var(--ink);color:var(--gold);border-radius:999px;padding:0 calc(6 * var(--u));margin-right:calc(5 * var(--u))}
.sr-box.boss .progress{color:var(--bad)}
.sr-box .banner{
  position:absolute;left:0;right:0;top:36%;display:flex;flex-direction:column;align-items:center;gap:calc(4 * var(--u));
  background:var(--ink);color:var(--gold);padding:calc(14 * var(--u)) calc(16 * var(--u));pointer-events:none;
  border-block:calc(4 * var(--u)) solid var(--gold);text-align:center;
}
.sr-box .banner.go{animation:sr-slidein .5s cubic-bezier(.2,1.2,.4,1)}
.sr-box .banner .b1{font-family:var(--f-letter);font-weight:700;font-size:calc(52 * var(--u));line-height:1;letter-spacing:.12em}
.sr-box .banner .b2{font-family:var(--f-display);font-size:calc(17 * var(--u));color:#fff}
@keyframes sr-slidein{0%{transform:translateX(-100%)}100%{transform:translateX(0)}}
.sr-box .chip i{font-style:normal;font-weight:500;margin-left:calc(5 * var(--u));opacity:.8}
.sr-box .chip.clean{background:#d4f4e3;color:var(--ink)}
.sr-box .chip.slip{background:#ffe0c2;color:var(--ink)}
.sr-box .chip.fail{background:#ffcfd3;color:var(--ink)}
.sr-box .legend{display:flex;justify-content:center;gap:calc(12 * var(--u));flex-wrap:wrap;font-size:calc(11 * var(--u));color:var(--ink-soft)}
.sr-box .legend span::before{content:"";display:inline-block;width:calc(9 * var(--u));height:calc(9 * var(--u));border-radius:50%;border:calc(1.5 * var(--u)) solid var(--ink);margin-right:calc(4 * var(--u));vertical-align:-1px}
.sr-box .legend .c::before{background:#d4f4e3}
.sr-box .legend .s::before{background:#ffe0c2}
.sr-box .legend .f::before{background:#ffcfd3}
.sr-box .legend .k::before{background:#eef0f6}
.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
@media (prefers-reduced-motion:reduce){
.sr-box .word > .iv,.sr-box .popword.go .pl,.sr-box .slot.cur .cell,.sr-box .slot.done .cell.pop,.sr-box .slot.bad,.sr-box .popword.go,.sr-box .banner.go,.sr-box .meaning.enter{animation:sr-none}
}
`;
  var s = document.createElement('style');
  s.id = 'spellrun-stage-style';
  s.textContent = css;
  document.head.appendChild(s);
})();
