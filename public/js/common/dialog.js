// 작업207-2: 모든 화면이 함께 쓰는 확인·알림 대화상자. 브라우저 기본 confirm()/alert()를 대신한다.
//   metisConfirm(message, { danger, okText, cancelText }) → Promise<boolean>   확인=true, 취소·ESC·바깥 눌림=false
//   metisAlert(message, { okText })                         → Promise<void>
// 모양은 tokens.css 값을 따른다(반경 --card-radius 16px, 버튼 높이 --ctl-min-h 44px, 버튼 반경 --btn-radius, 주 버튼색 --btn-primary-bg).
// <dialog> 요소(showModal)를 써서 포커스 가두기·ESC·배경 가림을 브라우저가 처리한다. <dialog>를 못 쓰는 브라우저는 기본 confirm/alert로 대신한다.
// 이 파일을 불러오지 못한 화면은 각 화면의 인라인 대체 코드(기본 confirm/alert)가 같은 이름의 함수를 만든다.
(function () {
  if (window.metisConfirm && window.metisAlert) return;

  const STYLE_ID = 'metis-dialog-style';
  const CSS = `
    dialog.metis-dialog { margin: auto; width: calc(100% - 32px); max-width: 420px; padding: 20px; border: 1px solid #dde2f5; border-radius: var(--card-radius, 16px);
      background: #ffffff; color: #1a1f3c; font-family: 'Noto Sans KR', sans-serif; font-size: 15px; line-height: 1.6; box-shadow: 0 8px 24px rgba(26, 31, 60, 0.18); box-sizing: border-box; }
    dialog.metis-dialog::backdrop { background: rgba(0, 0, 0, 0.45); }
    .metis-dialog-msg { white-space: pre-line; word-break: keep-all; overflow-wrap: anywhere; }
    .metis-dialog-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; margin-top: 18px; }
    .metis-dialog-btn { min-height: var(--ctl-min-h, 44px); min-width: 88px; padding: 10px 18px; border: 1px solid #dde2f5; border-radius: var(--btn-radius, 10px); background: #eef1fb; color: #1a1f3c;
      font-family: inherit; font-size: 14px; font-weight: var(--btn-weight, 600); cursor: pointer; }
    .metis-dialog-btn:focus-visible { outline: 2px solid #1a1f3c; outline-offset: 2px; }
    .metis-dialog-btn.primary { background: var(--btn-primary-bg, #b8442e); border-color: var(--btn-primary-bg, #b8442e); color: #ffffff; }
    .metis-dialog-btn.primary:hover { background: var(--btn-primary-bg-hover, #9c3a27); border-color: var(--btn-primary-bg-hover, #9c3a27); }
    .metis-dialog-btn.danger { background: #b42318; border-color: #b42318; color: #ffffff; }
    .metis-dialog-btn.danger:hover { background: #912018; border-color: #912018; }
  `;
  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const st = document.createElement('style');
    st.id = STYLE_ID;
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  const supportsDialog = typeof HTMLDialogElement === 'function' && typeof document.createElement('dialog').showModal === 'function';
  let chain = Promise.resolve();   // 동시에 여러 개를 열려고 하면 차례대로 보여 준다

  function open(kind, message, opts) {
    opts = opts || {};
    if (!supportsDialog) return Promise.resolve(kind === 'confirm' ? window.confirm(message) : void window.alert(message));
    return new Promise(resolve => {
      ensureStyle();
      const returnFocus = document.activeElement;
      const dlg = document.createElement('dialog');
      dlg.className = 'metis-dialog';
      dlg.setAttribute('role', 'alertdialog');
      const msg = document.createElement('div');
      msg.className = 'metis-dialog-msg';
      msg.id = 'metis-dialog-msg';
      msg.setAttribute('data-t', 'dialog-msg');
      msg.textContent = String(message);
      dlg.setAttribute('aria-describedby', msg.id);
      const actions = document.createElement('div');
      actions.className = 'metis-dialog-actions';
      const mk = (cls, text, t) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'metis-dialog-btn' + (cls ? ' ' + cls : ''); b.textContent = text; b.setAttribute('data-t', t); return b; };
      let cancelBtn = null;
      if (kind === 'confirm') { cancelBtn = mk('', opts.cancelText || '취소', 'dialog-cancel'); actions.appendChild(cancelBtn); }
      const okBtn = mk(opts.danger ? 'danger' : 'primary', opts.okText || '확인', 'dialog-ok');
      actions.appendChild(okBtn);
      dlg.append(msg, actions);

      let result = kind === 'confirm' ? false : undefined;
      let finished = false;
      const finish = value => { result = value; if (dlg.open) dlg.close(); };
      okBtn.addEventListener('click', () => finish(kind === 'confirm' ? true : undefined));
      if (cancelBtn) cancelBtn.addEventListener('click', () => finish(false));
      dlg.addEventListener('click', ev => { if (ev.target === dlg) finish(kind === 'confirm' ? false : undefined); });   // 바깥(배경) 눌림 = 취소
      dlg.addEventListener('cancel', () => { result = kind === 'confirm' ? false : undefined; });                      // ESC
      dlg.addEventListener('close', () => {
        if (finished) return;
        finished = true;
        dlg.remove();
        if (returnFocus && typeof returnFocus.focus === 'function' && document.contains(returnFocus)) { try { returnFocus.focus(); } catch (e) { /* 무시 */ } }
        resolve(result);
      });
      document.body.appendChild(dlg);
      dlg.showModal();
      // 위험한 확인(삭제 등)은 취소에 먼저 포커스를 둬서 실수로 Enter를 눌러도 지워지지 않게 한다
      (opts.danger && cancelBtn ? cancelBtn : okBtn).focus();
    });
  }

  function queued(kind, message, opts) {
    const run = () => open(kind, message, opts);
    const p = chain.then(run, run);
    chain = p.then(() => undefined, () => undefined);
    return p;
  }

  window.metisConfirm = (message, opts) => queued('confirm', message, opts);
  window.metisAlert = (message, opts) => queued('alert', message, opts);
})();
