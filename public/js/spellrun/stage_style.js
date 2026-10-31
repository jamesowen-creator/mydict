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
.sr-box .progress,.sr-box .speedtag,.sr-box .snd{white-space:nowrap}   /* 작업365: [배경음] 단추가 늘어도 글자가 두 줄로 꺾이지 않게 */
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
.sr-box .rules,.sr-box .corelist{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:calc(7 * var(--u))}
.sr-box .rules li,.sr-box .corelist li{position:relative;padding-left:calc(18 * var(--u));font-size:calc(12 * var(--u));line-height:1.45;font-weight:500}
.sr-box .rules li::before,.sr-box .corelist li::before{content:"";position:absolute;left:0;top:calc(.45em);width:calc(9 * var(--u));height:calc(9 * var(--u));border-radius:calc(3 * var(--u));background:var(--coral);border:calc(1.5 * var(--u)) solid var(--ink)}
.sr-box .rules li.gold::before{background:var(--gold)}
.sr-box .corelist li.mint::before{background:#7ed9c3}
.sr-box .corelist li.red::before{background:#ff4d5e}
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
.sr-box #help .card{overflow:hidden}
.sr-box .helphead{display:flex;align-items:center;justify-content:space-between;gap:calc(8 * var(--u))}
.sr-box .helphead .title{text-align:left}
.sr-box .helpbody{display:flex;flex-direction:column;gap:calc(8 * var(--u));overflow:auto;min-height:0;flex:1}
.sr-box .helpbody:focus-visible{outline:calc(3 * var(--u)) solid var(--ink);outline-offset:calc(2 * var(--u))}
.sr-box .rhead{margin:calc(4 * var(--u)) 0 0;font-size:calc(13 * var(--u));font-weight:700;color:var(--ink)}
.sr-box .rhead[hidden],.sr-box .rgroup[hidden]{display:none}
.sr-box .vsbar{position:absolute;left:calc(14 * var(--u));right:calc(14 * var(--u));bottom:calc(10 * var(--u));z-index:2;pointer-events:none;box-sizing:border-box;background:var(--paper);border:calc(2 * var(--u)) solid var(--ink);border-radius:calc(12 * var(--u));padding:calc(4 * var(--u)) calc(10 * var(--u));display:flex;flex-direction:column;gap:calc(1 * var(--u));font-family:var(--f-body);color:var(--ink)}
.sr-box .vsbn{font-size:calc(12 * var(--u));font-weight:700;line-height:1.3;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sr-box .vsbs{font-size:calc(11.5 * var(--u));font-weight:500;line-height:1.3;color:var(--ink-soft);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sr-box .vstoast{position:absolute;left:calc(14 * var(--u));right:calc(14 * var(--u) + max(44px, 64 * var(--u)) + 8px);bottom:calc(66 * var(--u));z-index:2;pointer-events:none;text-align:center;background:var(--ink);color:#fff;border-radius:calc(14 * var(--u));padding:calc(5 * var(--u)) calc(12 * var(--u));font-size:calc(12 * var(--u));font-weight:700;line-height:1.3}
/* 작업348: 대결 나가기. 막대 위쪽 줄의 오른쪽 끝, 터치 44px 이상, 막대·가장자리와 간격을 둔다. z-index 를 주지 않아 선택·확인 화면이 열리면 그 아래로 가려진다 */
.sr-box .vsquit{position:absolute;right:calc(14 * var(--u));bottom:calc(66 * var(--u));box-sizing:border-box;width:max(44px, 64 * var(--u));min-height:44px;display:flex;align-items:center;justify-content:center;cursor:pointer;font-family:var(--f-body);font-weight:700;font-size:calc(12 * var(--u));color:var(--ink);background:var(--paper);border:calc(2 * var(--u)) solid var(--ink);border-radius:calc(14 * var(--u));padding:0}
.sr-box .vsquit:focus-visible{outline:calc(3 * var(--u)) solid var(--ink);outline-offset:calc(3 * var(--u))}
.sr-box .vfin li{flex-direction:column;align-items:flex-start;gap:calc(2 * var(--u))}
.sr-box .vsview{display:flex;flex-direction:column;gap:calc(10 * var(--u))}
.sr-box .vsview[hidden]{display:none}
.sr-box .vlist{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:calc(6 * var(--u));max-height:calc(150 * var(--u));overflow:auto}
.sr-box .vlist li{display:flex;align-items:center;justify-content:space-between;gap:calc(8 * var(--u));border:calc(2 * var(--u)) solid var(--ink);border-radius:calc(12 * var(--u));padding:calc(6 * var(--u)) calc(10 * var(--u));font-size:calc(13 * var(--u));font-weight:700}
.sr-box .vlist li .vm{font-size:calc(11 * var(--u));font-weight:500;color:var(--ink-soft)}
.sr-box .vlist li .vn{min-width:0;overflow-wrap:anywhere}
.sr-box .vsbtn,.sr-box #vs .btn,.sr-box #vsQuit .btn,.sr-box #pv .btn,.sr-box #start .btn{min-height:var(--ctl-min-h,44px);min-width:calc(88 * var(--u))}
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
/* 작업355: 꽉 찬 화면. 게임 화면에서는 앱 헤더·화면 바를 숨기고 판이 화면 전체(안전 여백 안)를 채운다. 배경은 화면 끝까지 */
body.sr-full{max-width:none;margin:0;overflow:hidden;position:fixed;inset:0;width:100%;height:100%;overscroll-behavior:none}
body.sr-full .metis-app-header,body.sr-full .screen-bar{display:none !important}
body.sr-full .content{max-width:none;margin:0;padding:0}
body.sr-full .sr-stage{position:fixed;inset:0;align-items:center;justify-content:center;border-radius:0;
  padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)}
body.sr-full .sr-box{border-radius:0;box-shadow:none}
body.sr-full .sr-box .screen{padding-top:calc(38 * var(--u))}
/* 위쪽 작은 단추: 시각 크기는 작게, 터치 영역은 44px 이상(::before). 달리는 중에는 HUD 둘째 줄 아래, 아닐 때는 맨 위 */
.sr-box .ctl{position:absolute;left:calc(8 * var(--u));top:calc(6 * var(--u));display:flex;gap:calc(8 * var(--u));z-index:6}
.sr-box .hud:not([hidden]) ~ .ctl{left:calc(14 * var(--u));top:calc(67 * var(--u))}   /* 작업365: 둘째 줄에 [배경음]이 늘어 속도 배지가 왼쪽으로 와서, 위쪽 단추를 3px 내림(뜻 시작 y 97 보다 위) */
.sr-box .ctlb{position:relative;cursor:pointer;font-family:var(--f-body);font-weight:700;font-size:calc(12 * var(--u));line-height:1;color:var(--ink);background:rgba(255,255,255,.78);border:calc(2 * var(--u)) solid var(--ink);border-radius:999px;padding:calc(5 * var(--u)) calc(12 * var(--u));height:calc(26 * var(--u))}
.sr-box .ctlb::before{content:"";position:absolute;left:-4px;right:-4px;top:50%;height:max(44px,100%);transform:translateY(-50%)}
.sr-box .ctlb:focus-visible{outline:calc(3 * var(--u)) solid var(--ink);outline-offset:calc(2 * var(--u))}
.sr-box .srtoast{position:absolute;left:50%;transform:translateX(-50%);bottom:calc(76 * var(--u));z-index:6;max-width:86%;text-align:center;pointer-events:none;background:var(--ink);color:#fff;border-radius:calc(14 * var(--u));padding:calc(6 * var(--u)) calc(14 * var(--u));font-size:calc(12 * var(--u));font-weight:700;line-height:1.3}
.sr-box .vlabel{align-self:center;font-weight:700;font-size:calc(12 * var(--u));color:var(--ink-soft)}
/* 가로를 골랐는데 폰이 세로일 때의 안내 띠: 판 바깥(화면 맨 위)에 둔다 */
.sr-stage .rotband{position:absolute;left:0;right:0;top:0;z-index:20;display:flex;align-items:center;justify-content:center;gap:10px;flex-wrap:wrap;box-sizing:border-box;
  padding:calc(6px + env(safe-area-inset-top,0px)) calc(10px + env(safe-area-inset-right,0px)) 6px calc(10px + env(safe-area-inset-left,0px));background:var(--ink);color:#fff;font-size:13px;font-weight:700;line-height:1.4;text-align:center}
.sr-stage .rotbtn{cursor:pointer;min-height:44px;padding:0 14px;font-family:inherit;font-size:13px;font-weight:700;color:var(--ink);background:var(--gold);border:2px solid #fff;border-radius:999px}
.sr-stage .rotbtn:focus-visible{outline:3px solid #fff;outline-offset:2px}
/* 작업356 가로 800x400 배치. 세로 CSS 는 건드리지 않는다(아래는 모두 .land 아래). 묶음 div(.c1w)는 세로에서 display:contents 라 배치가 같다 */
.sr-box .c1w{display:contents}
/* HUD: 위 한 줄(체력·진행·속도 | 닫기·화면 단추(가운데) | 콤보·점수·소리). 둘째 줄: 왼쪽 뜻(위 세 칸 폭), 오른쪽 글자 칸. 글자 영역 아래 끝은 100 이하 */
.sr-box.land .hud{display:grid;grid-template-columns:auto auto auto 1fr auto auto;grid-template-rows:auto;column-gap:calc(8 * var(--u));align-items:start;padding:calc(6 * var(--u)) calc(14 * var(--u)) 0}
.sr-box.land .hud .row{display:contents}
.sr-box.land .hearts{grid-area:1 / 1;align-self:center}
.sr-box.land .progress{grid-area:1 / 2;align-self:center}
.sr-box.land .speedtag{grid-area:1 / 3;align-self:center}
.sr-box.land .scorebox{grid-area:1 / 5;justify-self:end;align-self:center}
.sr-box.land .snd{grid-area:1 / 6;justify-self:end}
.sr-box.land .hintbox,.sr-box.land .hintbox.intro{position:absolute;left:calc(14 * var(--u));top:calc(36 * var(--u));width:calc(300 * var(--u));gap:calc(2 * var(--u))}   /* 격자 밖(절대 위치): 긴 뜻이 위쪽 한 줄의 칸 폭을 늘리지 않게 */
.sr-box.land .meaning{margin-top:0}
.sr-box.land .sub{margin-top:0}
.sr-box.land .word{position:absolute;left:calc(330 * var(--u));width:calc(456 * var(--u));top:calc(36 * var(--u));margin-top:calc(12 * var(--u))}
.sr-box.land .cell{height:calc(40 * var(--u));line-height:calc(36 * var(--u));border-bottom-width:calc(3 * var(--u))}
.sr-box.land .ctl,.sr-box.land .hud:not([hidden]) ~ .ctl{left:50%;top:calc(6 * var(--u));transform:translateX(-50%)}
/* 작업360 가로 상단 정리: 하트(왼쪽)와 점수(오른쪽)만 남기고, 단어 N/M·속도 배지·소리·닫기·화면 단추는 오른쪽 위 [메뉴] 단추 하나로 합친다(세로 CSS 는 건드리지 않는다).
   나중에 최종 보스 에너지 막대가 들어갈 자리: 아래 .hud 격자의 가운데 1fr 칸(grid-area 1 / 2), 하트와 점수 사이. 지금은 비어 있다 */
.sr-box .menubtn,.sr-box .srmenu{display:none}
.sr-box.land .progress,.sr-box.land .speedtag,.sr-box.land .snd,.sr-box.land .ctl,.sr-box.land .hud:not([hidden]) ~ .ctl{display:none}
.sr-box.land .hud{grid-template-columns:auto 1fr auto;padding-right:calc(14 * var(--u) + 62 * var(--u))}
.sr-box.land .hearts{grid-area:1 / 1}
.sr-box.land .scorebox{grid-area:1 / 3}
.sr-box.land .combo{display:none}   /* 작업361: 가로 상단은 하트·점수만(콤보 칩은 가로에서 숨김) */
.sr-box.land .menubtn{display:block;position:absolute;right:calc(14 * var(--u));top:calc(6 * var(--u));z-index:6}
.sr-box.land .srmenu:not([hidden]){display:flex;flex-direction:column;gap:calc(4 * var(--u));position:absolute;right:calc(14 * var(--u));top:calc(36 * var(--u));z-index:7;box-sizing:border-box;min-width:calc(150 * var(--u));padding:calc(6 * var(--u));background:var(--paper);border:calc(2 * var(--u)) solid var(--ink);border-radius:calc(14 * var(--u));box-shadow:0 calc(3 * var(--u)) 0 var(--ink)}
.sr-box.land .menuitem{cursor:pointer;min-height:var(--ctl-min-h,44px);font-family:var(--f-body);font-weight:700;font-size:calc(13 * var(--u));color:var(--ink);background:#fff;border:calc(2 * var(--u)) solid var(--ink);border-radius:calc(10 * var(--u));padding:0 calc(12 * var(--u))}
.sr-box.land .menuitem:focus-visible,.sr-box.land .menubtn:focus-visible{outline:calc(3 * var(--u)) solid var(--ink);outline-offset:calc(2 * var(--u))}
/* 완성 단어 카드: 두 열(왼쪽 단어·발음, 오른쪽 뜻·예문), 경기장 가운데 위쪽 줄 높은 칸 타일과 일반 타일 줄 사이(y 104~210). 펭귄(x 72)은 가리지 않는다 */
/* 작업357 가로 팝업·배너: 위쪽 뜻·글자 칸 영역(y 34~100)에 뜨고 그 자리를 덮는다(뜻·글자 칸은 팝업 아래에 가려진다). 높은 칸 타일 줄(y 112~170)·펭귄·다가오는 타일은 가리지 않는다.
   내용이 많으면 발음 기호 줄은 숨기고 예문은 한 줄로 줄이며, 단어와 뜻은 항상 보인다 */
.sr-box.land .popword{left:calc(14 * var(--u));right:calc(14 * var(--u));top:calc(34 * var(--u));display:grid;grid-template-columns:calc(250 * var(--u)) 1fr;grid-template-areas:"tag pm" "pw pe";column-gap:calc(16 * var(--u));row-gap:calc(1 * var(--u));align-items:center;padding:calc(3 * var(--u)) calc(16 * var(--u)) calc(3 * var(--u));border-width:calc(2 * var(--u));border-radius:calc(16 * var(--u));box-shadow:0 calc(3 * var(--u)) 0 var(--ink);text-align:left}
.sr-box.land .popword .tag{grid-area:tag;text-align:left;min-height:calc(12 * var(--u));font-size:calc(11 * var(--u));line-height:1.1}
.sr-box.land .popword .pw{grid-area:pw;justify-content:flex-start;line-height:1.15;overflow:hidden}
.sr-box.land .popword .pp{display:none}
.sr-box.land .popword .pm{grid-area:pm;text-align:left}
.sr-box.land .popword .pe{grid-area:pe;text-align:left;margin-top:0;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:1;line-clamp:1;overflow:hidden}
.sr-box.land .popword .pn{position:absolute;right:calc(14 * var(--u));bottom:calc(1 * var(--u));font-size:calc(10 * var(--u))}
.sr-box.land .banner{top:calc(34 * var(--u));flex-direction:row;align-items:baseline;justify-content:center;gap:calc(14 * var(--u));padding:calc(4 * var(--u)) calc(16 * var(--u));border-block-width:calc(3 * var(--u))}
.sr-box.land .banner .b1{font-size:calc(30 * var(--u))}
.sr-box.land .banner .b2{font-size:calc(15 * var(--u))}
/* 카드: 가로에서는 2열(왼쪽 설명·정보, 오른쪽 선택과 주 버튼)로 한 화면에 */
.sr-box.land .card{max-width:calc(700 * var(--u));align-self:center;padding:calc(10 * var(--u)) calc(16 * var(--u))}
.sr-box.land #cont .card,.sr-box.land #vsQuit .card,.sr-box.land #help .card{max-width:calc(520 * var(--u))}
.sr-box.land #result .btn,.sr-box.land #cont .btn{min-height:44px}
.sr-box.land #start .card,.sr-box.land #result .card{display:grid;grid-template-columns:1fr 1fr;column-gap:calc(18 * var(--u));row-gap:calc(8 * var(--u));align-content:center}
.sr-box.land #start .title{grid-column:1 / -1;grid-row:1;font-size:calc(32 * var(--u))}
.sr-box.land #startInfoCol{grid-column:1;grid-row:2 / span 4;display:flex;flex-direction:column;gap:calc(8 * var(--u));justify-content:center}
.sr-box.land #modeRow{grid-column:2;grid-row:2}
.sr-box.land #viewRow{grid-column:2;grid-row:3}
.sr-box.land #optRow{grid-column:2;grid-row:4}
.sr-box.land #startBtn{grid-column:2;grid-row:5}
.sr-box.land #resInfo{grid-column:1;grid-row:1;display:flex;flex-direction:column;gap:calc(8 * var(--u));justify-content:center}
.sr-box.land #resMain{grid-column:2;grid-row:1;display:flex;flex-direction:column;gap:calc(8 * var(--u))}
.sr-box.land #resTitle{font-size:calc(30 * var(--u))}
.sr-box.land #pv .card{display:grid;grid-template-columns:1fr 1fr;column-gap:calc(16 * var(--u));row-gap:calc(6 * var(--u));align-content:center}
.sr-box.land #pv .pvarea{grid-column:1;grid-row:1 / span 6;min-height:0;align-self:stretch}
.sr-box.land #pvTitle{grid-column:2;grid-row:1;font-size:calc(26 * var(--u))}
.sr-box.land #pvProg{grid-column:2;grid-row:2}
.sr-box.land #pvNote{grid-column:2;grid-row:3}
.sr-box.land #pvCtl{grid-column:2;grid-row:4}
.sr-box.land #pvStart{grid-column:2;grid-row:5}
.sr-box.land #pvBack{grid-column:2;grid-row:6}
/* 대결 화면: 목록·대기·결과를 2열로. 방 목록(내용이 많은 곳)만 영역 안 스크롤 */
.sr-box.land #vs .title.small{font-size:calc(24 * var(--u))}
.sr-box.land #vs .vlist{max-height:calc(190 * var(--u))}
.sr-box.land #vsListView,.sr-box.land #vsRoomView,.sr-box.land #vsFinView{display:grid;grid-template-columns:1.2fr 1fr;column-gap:calc(16 * var(--u));row-gap:calc(6 * var(--u));align-content:start}
.sr-box.land #vsListView[hidden],.sr-box.land #vsRoomView[hidden],.sr-box.land #vsFinView[hidden]{display:none}
.sr-box.land #vsList{grid-column:1;grid-row:1 / span 3}
.sr-box.land #vsEmpty{grid-column:1;grid-row:1 / span 3}
.sr-box.land #vsCreate{grid-column:2;grid-row:1}
.sr-box.land #vsListView > .trow{grid-column:2;grid-row:2}
.sr-box.land #vsRoomText{grid-column:1;grid-row:1}
.sr-box.land #vsPlayers{grid-column:1;grid-row:2 / span 2}
.sr-box.land #vsGo{grid-column:2;grid-row:1}
.sr-box.land #vsLeave{grid-column:2;grid-row:2}
.sr-box.land #vsFinTitle{grid-column:1;grid-row:1}
.sr-box.land #vsFinWhy{grid-column:1;grid-row:2}
.sr-box.land #vsFinList{grid-column:1;grid-row:3;max-height:none}
.sr-box.land #vsFinNote{grid-column:1;grid-row:4}
.sr-box.land #vsFinRematchNote{grid-column:2;grid-row:1}
.sr-box.land #vsFinRematch{grid-column:2;grid-row:2}
.sr-box.land #vsFinRetry{grid-column:2;grid-row:3}
.sr-box.land #vsFinView > .trow{grid-column:2;grid-row:4}
/* 대결 막대·나가기·안내: 아래쪽 줄(막대는 왼쪽, 나가기는 오른쪽 끝), 안내는 막대 위 */
.sr-box.land .vsbar{bottom:calc(6 * var(--u));right:calc(14 * var(--u) + max(44px, 64 * var(--u)) + 8px)}
.sr-box.land .vsquit{bottom:calc(6 * var(--u))}
.sr-box.land .vstoast{bottom:calc(50 * var(--u))}
.sr-box.land .srtoast{bottom:calc(50 * var(--u))}
/* 작업358: 캐릭터 선택 줄(작은 그림 + 이름, 터치 44px 이상). 그림은 시트의 서 있는 자세(둘째 칸)를 잘라 보인다 */
.sr-box .chbtn{display:inline-flex;align-items:center;gap:calc(4 * var(--u));padding:calc(2 * var(--u)) calc(8 * var(--u))}
.sr-box .chimg{display:inline-block;flex:none;width:calc(30 * var(--u));height:calc(30 * var(--u));background-repeat:no-repeat;background-size:calc(240 * var(--u)) calc(40 * var(--u));background-position:calc(-44 * var(--u)) calc(-5 * var(--u))}
.sr-box .chimg.penguin{background-image:url(/img/spellrun/spellrun_penguin_sheet.png)}
.sr-box .chimg.girl{background-image:url(/img/spellrun/spellrun_girl_sheet.png)}
.sr-box .chimg.boy{background-image:url(/img/spellrun/spellrun_boy_sheet.png)}
#charRow{flex-wrap:wrap}
/* 작업358: 보스 하늘(짙은 남색~보라~주황)에서도 위쪽 글자가 읽히게: 뜻·보조 줄·글자 칸·점수는 흰 글자 + 어두운 번짐 */
.sr-box.bsky .meaning,.sr-box.bsky .sub,.sr-box.bsky .score,.sr-box.bsky .word .cell,.sr-box.bsky .slot.done .cell{color:#fff;text-shadow:0 0 calc(3 * var(--u)) rgba(20,32,74,.95),0 0 calc(6 * var(--u)) rgba(20,32,74,.7)}
.sr-box.bsky .word .cell{border-bottom-color:rgba(255,255,255,.9)}
.sr-box.bsky .slot.cur .cell{border-bottom-color:var(--coral)}
.sr-box.bsky .slot.done .cell{border-bottom-color:#7ee2a8}
.sr-box.bsky .progress{color:#ffd9d9;text-shadow:0 0 calc(3 * var(--u)) rgba(20,32,74,.95)}
/* 작업382: 시작 화면 정리(가로·세로 공통). id·판정은 그대로, 보이는 모양만 바꾼다. 핵심 3줄(#coreList)은 [게임 방법] 맨 앞으로 옮겼다(spelling_run.html) */
.sr-box #start .card{border-width:calc(2 * var(--u));box-shadow:0 calc(10 * var(--u)) calc(28 * var(--u)) rgba(20,32,74,.28)}
.sr-box #start .lead{font-size:max(11px,calc(14 * var(--u)))}
.sr-box #start .vlabel,.sr-box #start .note{font-size:max(11px,calc(12 * var(--u)))}
.sr-box #start .toggle{font-size:max(11px,calc(12 * var(--u)));border-color:#c3cae0;color:var(--ink);position:relative}
.sr-box #start .toggle::before{content:"";position:absolute;left:0;right:0;top:50%;height:max(44px,100%);transform:translateY(-50%)}   /* 보이는 높이가 44px보다 작아도 터치 영역은 44px */
.sr-box #start .toggle[aria-pressed="true"]{background:var(--ink);border-color:var(--ink);color:#fff}
.sr-box #modeRow .toggle,.sr-box #viewRow .toggle{min-height:calc(36 * var(--u));min-width:calc(64 * var(--u));padding:0 calc(18 * var(--u))}
.sr-box #modeRow .toggle{font-size:max(12px,calc(14 * var(--u)))}
.sr-box #optRow .toggle{border:0;background:transparent;min-width:0;min-height:calc(36 * var(--u));padding:0 calc(14 * var(--u));color:var(--ink-soft)}
.sr-box #optRow .toggle[aria-pressed="true"]{background:transparent;color:var(--ink)}
.sr-box #start .chbtn[aria-pressed="true"]{box-shadow:0 0 0 calc(3 * var(--u)) var(--coral)}   /* 선택된 캐릭터: 코랄 링 */
.sr-box #start .btn{box-shadow:0 calc(6 * var(--u)) calc(16 * var(--u)) rgba(255,107,90,.35)}
.sr-box #start .btn:active{transform:translateY(calc(2 * var(--u)));box-shadow:0 calc(2 * var(--u)) calc(6 * var(--u)) rgba(255,107,90,.35)}
.sr-box #start .btn:disabled{box-shadow:none}
.sr-box .chimg.girl,.sr-box .chimg.boy{background-size:calc(560 * var(--u)) calc(40 * var(--u))}   /* 여학생·남학생 시트는 14칸 4032x288: 칸 하나가 40px 이 되도록 560x40(펭귄 6칸 1728x288 은 240x40). 비율 유지 */
.sr-box.land #modeRow{grid-column:1 / -1;grid-row:2}
.sr-box.land #startInfoCol{grid-column:1;grid-row:3 / span 2}
.sr-box.land #viewRow{grid-column:2;grid-row:3}
.sr-box.land #optRow{grid-column:2;grid-row:4}
.sr-box.land #startBtn{grid-column:1 / -1;grid-row:5}
.sr-box.land #charRow{gap:calc(6 * var(--u))}
.sr-box.land #charRow .chbtn{min-width:0;padding:calc(2 * var(--u)) calc(6 * var(--u))}   /* 가로 640x360 에서도 캐릭터 3개가 한 줄에 */
@media (prefers-reduced-motion:reduce){
.sr-box .word > .iv,.sr-box .popword.go .pl,.sr-box .slot.cur .cell,.sr-box .slot.done .cell.pop,.sr-box .slot.bad,.sr-box .popword.go,.sr-box .banner.go,.sr-box .meaning.enter{animation:sr-none}
}
`;
  var s = document.createElement('style');
  s.id = 'spellrun-stage-style';
  s.textContent = css;
  document.head.appendChild(s);
})();
