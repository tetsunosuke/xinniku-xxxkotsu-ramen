/* ============================================================
   澱みのスープ — OS Core
   ゲーム状態管理 / ウィンドウ管理 / 通知 / ロック画面
   ============================================================ */

// ─── GAME STATE ───────────────────────────────────────────────
const STATE_KEY = 'yodomi_gameState';
const CORRECT_PASSCODE = '19940826';

const DEFAULT_STATE = {
  isLocked: true,
  currentStep: 'intro',       // intro → unlocked → news_found → location_spec → chat_sent → clear | bad_end
  flags: {
    audioUnlocked: false,
    // snsVisited: SNSアプリはログイン画面になったため廃止
    newsRead: false,
    galleryOpened: false,
    kitchenPhotoViewed: false,
    casePhotoViewed: false,
    locationSent: false,
    returnedToPlayerPhone: false, // 拾ったスマホを解除後、一度自分のスマホへ戻ったか
  },
  notifiedItems: []
};

let gameState = (() => {
  try {
    const s = localStorage.getItem(STATE_KEY);
    return s ? JSON.parse(s) : JSON.parse(JSON.stringify(DEFAULT_STATE));
  } catch { return JSON.parse(JSON.stringify(DEFAULT_STATE)); }
})();

// 現在プレイヤーが見ているデバイスを追跡（'player' = 自分のスマホ ・ 'picked' = 拾ったスマホ）
// 初期状態は picked（ロック画面からスタート）
let currentDevice = 'picked';

// バッテリー管理
let pickedBattery = 98; // 初期値98%
let shutdownActive = false;

function saveState() {
  try { localStorage.setItem(STATE_KEY, JSON.stringify(gameState)); } catch {}
}

function setFlag(key, value) {
  if (gameState.flags[key] === value) return;
  gameState.flags[key] = value;
  saveState();
  checkTriggers();
  updateBadges();
  syncBatteryFromStep();
}

function advanceStep(step) {
  const ORDER = ['intro','unlocked','news_found','location_spec','chat_sent','clear'];
  const cur = ORDER.indexOf(gameState.currentStep);
  const nxt = ORDER.indexOf(step);
  if (nxt > cur) {
    gameState.currentStep = step;
    saveState();
    checkTriggers();
    updateBadges();
    syncBatteryFromStep();
  }
}

// 自分のスマホのバッテリー（ゲーム進行に応じて微減）
let playerBattery = parseInt(localStorage.getItem('playerBattery') || '78');
function savePlayerBattery() {
  localStorage.setItem('playerBattery', String(playerBattery));
}

function syncBatteryFromStep() {
  if (shutdownActive) return;
  const step = gameState.currentStep;
  if (gameState.isLocked) {
    pickedBattery = 98;
  } else if (step === 'unlocked') {
    pickedBattery = 80;
  } else if (step === 'news_found') {
    pickedBattery = 52;
  } else if (step === 'location_spec') {
    pickedBattery = 24;
  } else if (step === 'chat_sent' || step === 'clear' || step === 'bad_end') {
    pickedBattery = 0;
  }
  // 自分のスマホのバッテリーもステップに応じて変化
  const playerBatteryByStep = { intro:78, unlocked:74, news_found:69, location_spec:63, chat_sent:61, clear:61, bad_end:61 };
  const newPb = playerBatteryByStep[step] ?? playerBattery;
  if (newPb < playerBattery) { playerBattery = newPb; savePlayerBattery(); }
  updateBatteryDisplay();
}

function updateBatteryDisplay() {
  const batteryStr = `🔋 ${pickedBattery}%`;
  const pickedEl = document.getElementById('picked-phone-battery');
  const desktopEl = document.getElementById('desktop-battery');
  if (pickedEl) pickedEl.textContent = batteryStr;
  if (desktopEl) desktopEl.textContent = batteryStr;
  // 自分のスマホのバッテリー表示
  const playerBattEl = document.querySelector('.phone-bar-battery');
  if (playerBattEl) playerBattEl.textContent = `🔋 ${playerBattery}%`;
}

// ─── NOTIFICATIONS ────────────────────────────────────────────
const NOTIFS = [
  // hint_sns は廃止（SNSアプリはログイン画面のため）
  // ブラウザはロック解除直後からバッジ表示（お店の通知がきっかけ）→ NOTIFS不要
  {
    id: 'hint_gallery',
    // ニュース発見後、かつ一度自分のスマホへ戻ってから（友人がヒントを言ってくれる）
    check: () => gameState.currentStep === 'news_found'
                 && gameState.flags.returnedToPlayerPhone
                 && !(gameState.flags.kitchenPhotoViewed && gameState.flags.casePhotoViewed),
    icon: '💬',
    app: 'メッセージ (友人)',
    msg: 'ケンの配信で「写真フォルダにも手がかりがあるかも」って言ってたよ！調べてみろ！',
    delay: 1000,
    badge: 'gallery'
  },
  {
    id: 'hint_chat',
    check: () => gameState.flags.newsRead && gameState.flags.kitchenPhotoViewed && gameState.flags.casePhotoViewed && gameState.currentStep === 'news_found',
    icon: '💬',
    app: 'LIME',
    msg: '「写真をケンに送信する」準備ができました。LIMEを確認してください。',
    delay: 1500,
    badge: 'chat'
  }
];

function checkTriggers() {
  NOTIFS.forEach(n => {
    if (!gameState.notifiedItems.includes(n.id) && n.check()) {
      // 「友人からのメッセージ」は自分のスマホを見ているときのみ表示する
      // 拾ったスマホを見ている間は notifiedItems に追加せず次回に持ち越す
      if (n.app === 'メッセージ (友人)' && currentDevice !== 'player') return;
      gameState.notifiedItems.push(n.id);
      saveState();
      setTimeout(() => showToast(n.icon, n.app, n.msg), n.delay);
    }
  });
}

function updateBadges() {
  const badgeMap = {
    // SNSバッジは廃止（ログイン画面のため意味がない）
    sns:     () => false,
    // ブラウザバッジ：ロック解除後〜ニュース記事を読むまで
    browser: () => !gameState.isLocked && !gameState.flags.newsRead,
    // ギャラリーバッジ：ニュース発見後 かつ 一度自分のスマホへ戻ってから
    gallery: () => gameState.currentStep === 'news_found'
                   && gameState.flags.returnedToPlayerPhone
                   && !(gameState.flags.kitchenPhotoViewed && gameState.flags.casePhotoViewed),
    chat:    () => (gameState.flags.newsRead && gameState.flags.kitchenPhotoViewed && gameState.flags.casePhotoViewed && gameState.currentStep === 'news_found') || (gameState.currentStep === 'location_spec' && gameState.currentStep !== 'chat_sent')
  };
  Object.entries(badgeMap).forEach(([id, cond]) => {
    const el = document.getElementById('badge-' + id);
    if (el) el.style.display = cond() ? 'flex' : 'none';
  });
}

// ─── TOAST ────────────────────────────────────────────────────
let toastQueue = [];
let toastActive = false;

function showToast(icon, app, msg) {
  toastQueue.push({ icon, app, msg });
  if (!toastActive) processToast();
}

function processToast() {
  if (!toastQueue.length) { toastActive = false; return; }
  toastActive = true;
  const { icon, app, msg } = toastQueue.shift();
  const el = document.getElementById('notification-toast');
  el.querySelector('.toast-icon').textContent = icon;
  el.querySelector('.toast-app').textContent  = app;
  el.querySelector('.toast-msg').textContent  = msg;
  el.classList.add('show');
  playBeep();

  // スマホのバイブレーション（振動）演出をクラス付与で行う
  let targetDevice = null;
  if (gameState.isLocked) {
    targetDevice = document.getElementById('lock-screen');
  } else {
    if (isMobile()) {
      targetDevice = (document.getElementById('player-phone').style.display !== 'none') 
        ? document.getElementById('player-phone') 
        : document.getElementById('desktop');
    } else {
      // PC版: アプリ名が「メッセージ」なら自分のスマホ、それ以外（LIME、SNS等）なら拾ったスマホ
      if (app === 'メッセージ') {
        targetDevice = document.getElementById('player-phone');
      } else {
        targetDevice = document.getElementById('desktop');
      }
    }
  }
  
  if (targetDevice) {
    targetDevice.classList.remove('shake-device');
    // リフローを挟んでアニメーションをリスタート
    void targetDevice.offsetWidth;
    targetDevice.classList.add('shake-device');
    setTimeout(() => { targetDevice.classList.remove('shake-device'); }, 1200);
  }

  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(processToast, 600);
  }, 3800);
}

// ─── AUDIO ────────────────────────────────────────────────────
let audioCtx = null;

function unlockAudio() {
  if (audioCtx) return;
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    gameState.flags.audioUnlocked = true;
    saveState();
  } catch {}
}

function playBeep(freq1 = 880, freq2 = 660, dur = 0.25, vol = 0.15) {
  if (!audioCtx) return;
  try {
    const osc  = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain); gain.connect(audioCtx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq1, audioCtx.currentTime);
    osc.frequency.setValueAtTime(freq2, audioCtx.currentTime + dur * 0.5);
    gain.gain.setValueAtTime(vol,     audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur);
    osc.start(audioCtx.currentTime);
    osc.stop(audioCtx.currentTime + dur);
  } catch {}
}

function playError() { playBeep(200, 180, 0.3, 0.2); }
function playClick() { playBeep(1200, 1000, 0.08, 0.08); }

// ─── LOCK SCREEN ──────────────────────────────────────────────
let passcode = '';

function initLockScreen() {
  const pad = document.getElementById('number-pad');
  if (!pad) return;
  [1,2,3,4,5,6,7,8,9,'',0,'⌫'].forEach(n => {
    const btn = document.createElement('button');
    btn.className = 'passcode-btn' + (n === '' ? ' empty' : n === '⌫' ? ' del-btn' : '');
    btn.textContent = n;
    btn.setAttribute('aria-label', n === '⌫' ? '削除' : String(n));
    if (n === '') { btn.disabled = true; }
    else if (n === '⌫') {
      btn.addEventListener('click', () => { unlockAudio(); playClick(); deleteDigit(); });
    } else {
      btn.addEventListener('click', () => { unlockAudio(); playClick(); addDigit(String(n)); });
    }
    pad.appendChild(btn);
  });

  updateLockTime();
  setInterval(updateLockTime, 1000);
}

function triggerFirstNotification() {
  // Show dummy notification after 1.5s
  setTimeout(() => {
    const el = document.getElementById('lock-notification');
    if (el) {
      el.innerHTML = `
        <div class="lock-notif-icon">🍜</div>
        <div>
          <div class="lock-notif-app">〇ンニク〇んこつラーメン</div>
          <div class="lock-notif-msg">【ご案内】本日11/12（火）のご予約時間が近づいています。ご来店をお待ちしております。</div>
        </div>
      `;
      el.classList.add('visible');
      
      // 音声再生（audioCtxの準備ができている場合のみ）
      if (audioCtx) {
        playBeep(880, 660, 0.25, 0.15);
      }
      
      // ロック画面自体をブルブルと振動させる
      const targetDevice = document.getElementById('lock-screen');
      
      if (targetDevice) {
        targetDevice.classList.remove('shake-device');
        void targetDevice.offsetWidth; // リフロー
        targetDevice.classList.add('shake-device');
        setTimeout(() => { targetDevice.classList.remove('shake-device'); }, 1200);
      }
    }
  }, 1500);
}

function addDigit(d) {
  if (passcode.length >= 8) return;
  passcode += d;
  renderDots();
  if (passcode.length === 8) setTimeout(checkPasscode, 350);
}

function deleteDigit() {
  passcode = passcode.slice(0,-1);
  renderDots();
}

function renderDots() {
  document.querySelectorAll('.passcode-dot').forEach((dot, i) => {
    dot.classList.toggle('filled', i < passcode.length);
  });
}

function checkPasscode() {
  if (passcode === CORRECT_PASSCODE) {
    doUnlock();
  } else {
    playError();
    const disp = document.getElementById('passcode-display');
    const err  = document.getElementById('passcode-error');
    disp.classList.add('shake');
    err.classList.add('show');
    passcode = '';
    setTimeout(() => {
      renderDots();
      disp.classList.remove('shake');
    }, 550);
    setTimeout(() => err.classList.remove('show'), 2000);
  }
}

function doUnlock() {
  gameState.isLocked = false;
  advanceStep('unlocked');
  const ls = document.getElementById('lock-screen');
  ls.classList.add('fade-out');
  setTimeout(() => {
    ls.style.display = 'none';
    updateBadges();
    // ロック解除直後：お店の通知がきっかけなのでブラウザ（お店のサイト）を自動で開く
    setTimeout(() => {
      openApp('browser'); // デフォルトタブ = ramen（お店のウェブサイト）
    }, 600);
  }, 900);
}

function updateLockTime() {
  const now = new Date();
  const timeEl = document.getElementById('lock-time');
  const dateEl = document.getElementById('lock-date');
  if (timeEl) timeEl.textContent = now.toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'});
  if (dateEl) {
    const days = ['日','月','火','水','木','金','土'];
    dateEl.textContent = `${now.getFullYear()}年${now.getMonth()+1}月${now.getDate()}日（${days[now.getDay()]}）`;
  }
}

// ─── DESKTOP CLOCK ────────────────────────────────────────────
function updateClock() {
  const el = document.getElementById('desktop-clock');
  if (el) el.textContent = new Date().toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'});
}

// ─── APP CONFIG ───────────────────────────────────────────────
const APPS = {
  sns:     { title: 'SNS',     icon: '🐦', src: 'apps/sns.html',     w: 480, h: 640 },
  browser: { title: 'ブラウザ', icon: '🌐', src: 'apps/browser.html', w: 620, h: 520 },
  gallery: { title: '写真',     icon: '📷', src: 'apps/gallery.html', w: 440, h: 600 },
  chat:    { title: 'LIME',    icon: '💬', src: 'apps/chat.html',    w: 400, h: 640 }
};

// isMobile は初期化時に固定（下部の _isMobileFixed を参照）

function openApp(appId, extra = null) {
  const cfg = APPS[appId]; if (!cfg) return;
  playClick();
  if (isMobile()) openMobile(appId, extra);
  else             openWindow(appId, extra);
}

// ─── MOBILE ───────────────────────────────────────────────────
function openMobile(appId, extra) {
  const overlay = document.getElementById('mobile-app-overlay');
  const iframe  = document.getElementById('mobile-iframe');
  let src = APPS[appId].src;
  if (extra) src += '?' + new URLSearchParams(extra).toString();
  iframe.src = src;
  overlay.dataset.app = appId;
  overlay.classList.add('visible');
}

function closeMobileApp() {
  const overlay = document.getElementById('mobile-app-overlay');
  overlay.classList.remove('visible');
  setTimeout(() => { document.getElementById('mobile-iframe').src = ''; }, 420);
}

// ─── PC WINDOWS ───────────────────────────────────────────────
let winZ = 100;
const wins = {};

function openWindow(appId, extra) {
  if (wins[appId]) { bringToFront(appId); return; }
  const cfg = APPS[appId];
  const win = document.createElement('div');
  win.className = 'os-window';
  win.id = 'win-' + appId;
  win.style.cssText = `
    width:${cfg.w}px; height:${cfg.h}px;
    left:${80 + Object.keys(wins).length * 30}px;
    top:${50 + Object.keys(wins).length * 24}px;
    z-index:${++winZ};
  `;
  let src = cfg.src;
  if (extra) src += '?' + new URLSearchParams(extra).toString();
  win.innerHTML = `
    <div class="win-titlebar" id="tb-${appId}">
      <span class="win-title">${cfg.icon} ${cfg.title}</span>
      <div class="win-controls">
        <button class="win-btn win-min" title="最小化" onclick="minimizeWin('${appId}')"></button>
        <button class="win-btn win-max" title="最大化" onclick="toggleMaxWin('${appId}')"></button>
        <button class="win-btn win-close" title="閉じる" onclick="closeWin('${appId}')"></button>
      </div>
    </div>
    <iframe class="win-iframe" src="${src}" frameborder="0" allowtransparency="true"></iframe>
  `;
  document.getElementById('windows-container').appendChild(win);
  wins[appId] = { el: win, minimized: false, maximized: false, restore: {} };
  makeDraggable(win, win.querySelector('.win-titlebar'));
  win.addEventListener('mousedown', () => bringToFront(appId));
  renderTaskbar();
}

function closeWin(appId) {
  if (!wins[appId]) return;
  wins[appId].el.remove();
  delete wins[appId];
  renderTaskbar();
}

function minimizeWin(appId) {
  const w = wins[appId]; if (!w) return;
  w.minimized = true;
  w.el.style.display = 'none';
  renderTaskbar();
}

function toggleMaxWin(appId) {
  const w = wins[appId]; if (!w) return;
  const container = document.getElementById('windows-container');
  const cr = container.getBoundingClientRect();
  if (w.maximized) {
    Object.assign(w.el.style, w.restore);
    w.maximized = false;
  } else {
    w.restore = { left: w.el.style.left, top: w.el.style.top, width: w.el.style.width, height: w.el.style.height };
    w.el.style.cssText += `left:0;top:0;width:${cr.width}px;height:${cr.height}px;`;
    w.maximized = true;
  }
}

function bringToFront(appId) {
  const w = wins[appId]; if (!w) return;
  if (w.minimized) { w.minimized = false; w.el.style.display = 'flex'; }
  w.el.style.zIndex = ++winZ;
  renderTaskbar();
}

function makeDraggable(win, handle) {
  let dragging = false, sx, sy, sl, st;
  handle.addEventListener('mousedown', e => {
    if (e.target.closest('button')) return;
    dragging = true; sx = e.clientX; sy = e.clientY;
    sl = parseInt(win.style.left)||0; st = parseInt(win.style.top)||0;
    e.preventDefault();
  });
  document.addEventListener('mousemove', e => {
    if (!dragging) return;
    win.style.left = sl + e.clientX - sx + 'px';
    win.style.top  = st + e.clientY - sy + 'px';
  });
  document.addEventListener('mouseup', () => { dragging = false; });
}

function renderTaskbar() {
  const tb = document.getElementById('taskbar-apps'); if (!tb) return;
  tb.innerHTML = '';
  Object.entries(wins).forEach(([id, w]) => {
    const btn = document.createElement('button');
    btn.className = 'taskbar-btn' + (w.minimized ? ' minimized' : '');
    btn.textContent = APPS[id].icon + ' ' + APPS[id].title;
    btn.title = APPS[id].title;
    btn.onclick = () => w.minimized ? bringToFront(id) : minimizeWin(id);
    tb.appendChild(btn);
  });
}

// ─── POSTMESSAGE ──────────────────────────────────────────────
window.addEventListener('message', e => {
  const msg = e.data; if (!msg || !msg.type) return;
  switch(msg.type) {
    case 'OPEN_APP':
      openApp(msg.appId, msg.extra || null);
      break;
    case 'SET_FLAG':
      setFlag(msg.key, msg.value);
      break;
    case 'ADVANCE_STEP':
      advanceStep(msg.step);
      // ニュース発見後の「写真を調べろ」ヒントは、プレイヤーが自分のスマホへ戻った際に
      // チャットシナリオ（インデックス10〜12）から自然に流れるため、ここでは通知しない
      break;
    case 'GET_STATE':
      e.source?.postMessage({ type: 'STATE', state: gameState }, '*');
      break;
    case 'GAME_CLEAR':
      triggerClear();
      break;
    case 'BAD_END':
      triggerBadEnd();
      break;
    case 'CLOSE_APP':
      if (isMobile()) {
        closeMobileApp();
      } else {
        closeWin(msg.appId);
      }
      break;
    case 'SHOW_TOAST':
      showToast(msg.icon || '🔔', msg.app || '', msg.msg);
      break;
    case 'SHUTDOWN_START':
      triggerShutdownSequence(msg.endType);
      break;
  }
});

// ─── SHUTDOWN SEQUENCE ────────────────────────────────────────
function triggerShutdownSequence(endType) {
  shutdownActive = true;
  pickedBattery = 0;
  updateBatteryDisplay();

  showToast('⚠️', 'システム', 'バッテリー残量がありません。シャットダウンします...');
  
  // Close any running apps on picked phone
  Object.keys(wins).forEach(closeWin);
  closeMobileApp();

  setTimeout(() => {
    // Show blackout overlay — requestAnimationFrame で iOS Safari 対応
    const overlay = document.getElementById('shutdown-overlay');
    if (overlay) {
      overlay.style.display = 'flex';
      requestAnimationFrame(() => {
        requestAnimationFrame(() => { overlay.style.opacity = '1'; });
      });
    }

    // Play click/power down sound
    playBeep(330, 110, 0.8, 0.2);

    setTimeout(() => {
      // Flip back to Player's phone automatically
      flipDevice();
      
      // Hide shutdown overlay so the player can see their phone
      if (overlay) {
        overlay.style.opacity = '0';
        setTimeout(() => {
          overlay.style.display = 'none';
        }, 1500);
      }

      // Automatically open the LIME chat thread on player's phone
      openThread();
      
      // Inject battery dead notification / conversation
      if (playerChatTimeout) clearTimeout(playerChatTimeout);
      
      if (endType === 'clear') {
        playerChatIndex = 13; // グッドエンド用の充電切れメッセージへ
      } else {
        playerChatIndex = 17; // バッドエンド用の充電切れメッセージへ
      }
      renderNextPlayerMessage();
    }, 3500);
  }, 2000);
}

// ─── ENDINGS ──────────────────────────────────────────────────
function triggerClear() {
  advanceStep('clear');
  const el = document.getElementById('epilogue-overlay');
  if (el) {
    setTimeout(() => el.classList.add('visible'), 500);
  }
}

async function triggerBadEnd() {
  gameState.currentStep = 'bad_end'; saveState();
  // Close all windows
  Object.keys(wins).forEach(closeWin);
  closeMobileApp();

  const overlay = document.getElementById('hacking-video-overlay');
  if (!overlay) {
    const el = document.getElementById('bad-end-overlay');
    if (el) el.classList.add('visible');
    playBeep(60, 40, 3, 0.4);
    return;
  }

  // 1. ハッキングオーバーレイの表示
  overlay.style.display = 'flex';
  
  // 不気味な電子ノイズ音の開始
  let synthInterval = null;
  if (audioCtx) {
    try {
      playBeep(50, 48, 5.0, 0.4);
      synthInterval = setInterval(() => {
        playBeep(Math.random() * 150 + 40, Math.random() * 150 + 40, 0.12, 0.12);
      }, 250);
    } catch(e) {}
  }

  const dummy = document.getElementById('hacked-dummy');
  const shadow = document.getElementById('dummy-shadow');

  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  
  if (shadow) {
    // 人影が徐々にカメラへ近づいてくる演出
    await wait(400);
    shadow.style.width = '380px';
    shadow.style.height = '620px';
    shadow.style.filter = 'blur(8px)';
  }
  
  await wait(1800);

  // 3. 店主の顔（赤い目）が突如ジャンプスケアで出現
  const face = document.getElementById('jumpscare-face');
  if (face) {
    face.style.display = 'flex';
    if (audioCtx) {
      // 悲鳴のような高周波の不協和音
      playBeep(180, 70, 1.2, 0.5);
      playBeep(210, 50, 1.2, 0.5);
    }
  }

  await wait(1000);

  // 4. 「みいつけた」巨大テロップ表示
  const hackText = document.getElementById('hacking-text');
  if (hackText) {
    hackText.style.display = 'block';
    if (audioCtx) {
      playBeep(35, 30, 2.0, 0.6);
    }
  }

  await wait(2500);

  if (synthInterval) clearInterval(synthInterval);

  // 5. 強烈なグリッチ砂嵐
  const cover = document.getElementById('glitch-cover');
  if (cover) {
    cover.style.display = 'block';
    if (audioCtx) {
      playBeep(90, 85, 1.2, 0.4);
    }
  }

  await wait(1500);

  // 6. オーバーレイを非表示にして本来のバッドエンド画面を表示
  overlay.style.display = 'none';
  if (cover) cover.style.display = 'none';
  if (face) face.style.display = 'none';
  if (hackText) hackText.style.display = 'none';

  const badEndOverlay = document.getElementById('bad-end-overlay');
  if (badEndOverlay) badEndOverlay.classList.add('visible');
  playBeep(45, 45, 4.0, 0.3);
}

// ─── SETTINGS ─────────────────────────────────────────────────
function openSettings() {
  document.getElementById('settings-overlay').classList.add('open');
}
function closeSettings() {
  document.getElementById('settings-overlay').classList.remove('open');
}

function exportState() {
  const blob = new Blob([JSON.stringify(gameState, null, 2)], {type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'yodomi_save.json';
  a.click();
}

function importState() {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = '.json';
  inp.onchange = async () => {
    try {
      const text = await inp.files[0].text();
      gameState = JSON.parse(text);
      saveState();
      location.reload();
    } catch { alert('セーブデータが読み込めませんでした'); }
  };
  inp.click();
}

function resetGame() {
  if (!confirm('ゲームをリセットしますか？\n進捗がすべて消えます。')) return;
  localStorage.removeItem(STATE_KEY);
  location.reload();
}

const PLAYER_CHAT_SCENARIO = [
  // --- 初期会話（インデックス 0〜5）---
  // 友人がフードハンター ケンの緊急配信を見てプレイヤーに連絡してきた
  { sender: 'recv', text: 'おい、フードハンター ケンが緊急生配信してるぞ！ タベアルキ太郎が昨日から連絡取れないって、配信でずっと呼びかけてる…' },
  { sender: 'sent', text: 'マジか！？ 実はさっき変なスマホ拾ったんだよ。裏に「ラーメン店オープン記念」のケースがついてたやつ。太郎のじゃないか？' },
  { sender: 'recv', text: 'それ絶対太郎のスマホじゃん！ ロックとかかかってない？' },
  { sender: 'sent', text: 'かかってる。8桁のパスコードがわからん' },
  { sender: 'recv', text: 'ケンが配信で言ってた。「太郎のSNSにヒントがある」って。太郎の公開SNS、調べてみろよ！' },
  { sender: 'sent', text: 'なるほど。ちょっと調べてみる！' },

  // --- ロック解除後（インデックス 6〜9）---
  { sender: 'sent', text: 'ロック解除できたぞ！' },
  { sender: 'recv', text: 'マジか！ 中身を確認してくれ！ ケンが配信で「太郎の行方をご存知の方はDMを」って言ってるけど、お前が直接太郎のLIMEからケンに連絡できないか？' },
  { sender: 'sent', text: 'わかった。LIMEアプリとか、ブラウザとか、写真とか……ざっと見てみる' },
  { sender: 'recv', text: '頼む。ケンも配信しながら自分で調べてるみたいだけど、スマホの中の情報は絶対そっちの方が詳しいはずだ' },

  // --- ニュース発見後（インデックス 10〜12）---
  { sender: 'sent', text: '太郎のブラウザに、台東区の葬儀業者への家宅捜索ニュースがあった。しかも太郎がよく行ってたあのラーメン店のすぐ近くだって' },
  { sender: 'recv', text: '……それって、まさかそのラーメン店のことじゃ。ゾッとするな。写真フォルダとかに何か残ってないか？ 太郎、撮影癖あるだろ' },
  { sender: 'sent', text: 'ある。最近追加された「厨房の写真」があるみたいだから詳しく調べてみる！' },

  // --- グッドエンド用：充電切れ後（インデックス 13〜16）---
  { sender: 'sent', text: 'あっ、拾ったスマホの充電が切れちゃった…！' },
  { sender: 'recv', text: 'ケンの配信見てたら「今、匿名から住所の情報が届いた！！」って言い出した！ それってお前がLIMEで送ったやつだよな！？' },
  { sender: 'recv', text: 'ケンが「台東区音無町3-19-4、今から警察と一緒に向かう！」って叫んでる！ 視聴者もザワついてる！！' },
  { sender: 'recv', text: 'マジでやばい。お前すごいことしたぞ……！' },

  // --- バッドエンド用：充電切れ後（インデックス 17〜19）---
  { sender: 'sent', text: 'あっ、拾ったスマホの充電が切れちゃった…！' },
  { sender: 'recv', text: 'ケンの配信見てたら、住所に行ったら……空き地だったって言ってる。違う場所だったのか？' },
  { sender: 'recv', text: '「情報が間違ってた……太郎どこにいるんだ」って配信で泣いてる。どういうことだよ……' },
  { sender: 'recv', text: 'おい、どうなってるんだ！ 返事しろよ！' }
];

let playerChatIndex = 0;
let playerChatTimeout = null;

function openThread() {
  document.querySelector('.chat-thread').classList.add('open');
  // Start message generation if not started yet
  if (playerChatIndex === 0) {
    renderNextPlayerMessage();
  }
}

function renderNextPlayerMessage() {
  if (playerChatIndex >= PLAYER_CHAT_SCENARIO.length) return;
  
  const container = document.getElementById('player-thread-messages');
  if (!container) return;
  
  const msgData = PLAYER_CHAT_SCENARIO[playerChatIndex];
  const msgDiv = document.createElement('div');
  msgDiv.className = `msg ${msgData.sender}`;
  msgDiv.innerHTML = `<div class="msg-bubble">${msgData.text}</div>`;
  
  container.appendChild(msgDiv);
  container.scrollTop = container.scrollHeight;
  
  playerChatIndex++;
  
  if (playerChatIndex < PLAYER_CHAT_SCENARIO.length) {
    const nextMsg = PLAYER_CHAT_SCENARIO[playerChatIndex];
    // ロック中（インデックス6に到達する前）に、自動で「ロック解除できたぞ！」へ進まないように制御
    if (playerChatIndex === 6 && gameState.isLocked) {
      return;
    }
    // グッドエンド：インデックス13はグッドエンド充電切れの先頭なので、
    // シャットダウン後にjumpされるまでここで停止する
    if (playerChatIndex === 13) {
      return; 
    }
    // グッドエンド：インデックス16まで（0〜15まで表示）でクリアへ
    if (playerChatIndex === 17) {
      // グッドエンドの最後「助け出す！」を表示後、クリアシーセルフ開始
      setTimeout(triggerClear, 3500);
      return;
    }
    // バッドエンド：インデックス20まで（0〜19表示）でバッドエンドへ
    if (playerChatIndex === 20) {
      // バッドエンドの最後「返事しろよ！」を表示後、脅迫メッセージとバッドエンドへ
      setTimeout(() => {
        const div = document.createElement('div');
        div.className = 'msg recv';
        div.innerHTML = `
          <div class="msg-ava" style="background:#2a0000;filter:hue-rotate(180deg)">🔪</div>
          <div class="msg-bubble" style="background:#2a0505;color:#ff6060">
            余計なことをするな<br><span style="font-size:11px;color:rgba(255,60,60,0.5)">— 未知の番号</span>
          </div>
          <div class="msg-time" style="color:#ff4040">09:31</div>
        `;
        container.appendChild(div);
        container.scrollTop = container.scrollHeight;

        setTimeout(triggerBadEnd, 2500);
      }, 2000);
      return;
    }

    const delay = nextMsg.sender === 'recv' ? 2200 : 1400;
    playerChatTimeout = setTimeout(renderNextPlayerMessage, delay);
  }
}

function closeThread() {
  document.querySelector('.chat-thread').classList.remove('open');
}

function openPlayerSns() {
  openPlayerBrowserSearch();
}
function openPlayerBrowserSearch() {
  const overlay = document.getElementById('player-sns-overlay');
  const iframe = document.getElementById('player-sns-iframe');
  iframe.src = 'apps/sns.html?preview=1';
  overlay.classList.add('open');
}
function closePlayerSns() {
  const overlay = document.getElementById('player-sns-overlay');
  const iframe = document.getElementById('player-sns-iframe');
  iframe.src = '';
  overlay.classList.remove('open');
}
function switchToPickedPhone() {
  currentDevice = 'picked'; // 拾ったスマホへ切り替え
  if (shutdownActive) {
    showToast('⚠️', 'システム', '端末のバッテリーが切れています。');
    return;
  }
  if (isMobile()) {
    const pp = document.getElementById('player-phone');
    pp.style.transform = 'translateY(-100%)';
    setTimeout(() => { pp.style.display = 'none'; }, 500);
  }
}
function flipDevice() {
  currentDevice = 'player'; // 自分のスマホへ切り替え→先に設定しcheckTriggersが正しく動くように
  if (isMobile()) {
    const pp = document.getElementById('player-phone');
    pp.style.display = 'flex';
    setTimeout(() => { pp.style.transform = 'translateY(0)'; }, 20);
  }
  
  setTimeout(() => {
    // 初めて自分のスマホに戻ったとき（会話未開始）は
    // ホーム画面を見せて、通知トーストで友人からのメッセージを知らせるだけにする
    if (playerChatIndex === 0) {
      setTimeout(() => {
        showToast('💬', 'メッセージ (友人)', 'おい、フードハンター ケンが緊急生配信してるぞ！');
      }, 800);
      return;
    }

    // 2回目以降はチャットスレッドを自動で開く
    openThread();

    // 自分のスマホへ戻ったことを記録（ギャラリーバッジ等の解禁に使う）
    if (!gameState.flags.returnedToPlayerPhone && !gameState.isLocked) {
      setFlag('returnedToPlayerPhone', true);
    }
    
    // 手動で自分のスマホに戻ってきたときに、現在のゲーム進行度に応じてチャットの会話を進める
    if (gameState.currentStep === 'unlocked' && playerChatIndex === 6) {
      renderNextPlayerMessage();
    } else if (gameState.currentStep === 'news_found' && playerChatIndex === 10) {
      renderNextPlayerMessage();
    }
  }, 100);
}
function updatePlayerClock() {
  const now = new Date();
  const el = document.getElementById('player-phone-clock');
  if (el) el.textContent = now.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
}

function startStory() {
  playClick();
  const intro = document.getElementById('novel-intro');
  if (intro) {
    intro.classList.add('hidden');
    setTimeout(() => { intro.style.display = 'none'; }, 800);
  }
  // 最初は「拾ったスマホのロック画面」を前面に表示します。
  switchToPickedPhone();
  triggerFirstNotification();
}
window.startStory = startStory;
window.openThread = openThread;
window.closeThread = closeThread;
window.openPlayerSns = openPlayerSns;
window.closePlayerSns = closePlayerSns;
window.switchToPickedPhone = switchToPickedPhone;
window.flipDevice = flipDevice;

// ─── WALLPAPER ────────────────────────────────────────────────
function loadWallpaper() {
  const wp = document.getElementById('wallpaper');
  const img = new Image();
  img.onload = () => {
    wp.style.backgroundImage = `url(${img.src})`;
    wp.classList.add('has-image');
  };
  img.src = 'assets/images/wallpaper.png';
}

// ─── INIT ─────────────────────────────────────────────────────

// P-10: PC/スマホを区別せず、常にモバイルUI（フルスクリーン切り替え方式）で動作する
function isMobile() { return true; }

document.addEventListener('DOMContentLoaded', () => {
  loadWallpaper();

  // Preloader
  const preloader = document.getElementById('preloader');
  setTimeout(() => preloader.classList.add('hidden'), 1200);

  // Lock screen & Player phone initialization
  const pp = document.getElementById('player-phone');
  const intro = document.getElementById('novel-intro');
  if (!gameState.isLocked) {
    const ls = document.getElementById('lock-screen');
    if (ls) ls.style.display = 'none';
    if (isMobile()) {
      if (pp) { pp.style.display = 'none'; pp.style.transform = 'translateY(-100%)'; }
    } else {
      if (pp) { pp.style.display = 'flex'; pp.style.transform = 'none'; }
    }
    if (intro) intro.style.display = 'none';
    syncBatteryFromStep();
    checkTriggers();
    updateBadges();
  } else {
    // If locked, initialize lock screen but hide picked phone interface initially under the player phone on mobile
    initLockScreen();
    if (pp) { pp.style.display = 'flex'; pp.style.transform = 'none'; }
    syncBatteryFromStep();
  }

  // P-04: リロード時のチャット進捗の同期（正しいインデックスで復元）
  const stepIndexMap = {
    'intro':         0,
    'unlocked':     10,   // 0〜9を描画
    'news_found':   13,   // 0〜12を描画
    'location_spec':13,
    'chat_sent':    13,
    'clear':        13,
    'bad_end':      13,
  };
  playerChatIndex = stepIndexMap[gameState.currentStep] ?? 0;

  // 進捗段階までのメッセージを一括描画
  const container = document.getElementById('player-thread-messages');
  if (container) {
    container.innerHTML = '';
    const maxRender = Math.min(playerChatIndex, 13); // 充電切れメッセージ前まで描画
    for (let i = 0; i < maxRender; i++) {
      const msgData = PLAYER_CHAT_SCENARIO[i];
      const msgDiv = document.createElement('div');
      msgDiv.className = `msg ${msgData.sender}`;
      msgDiv.innerHTML = `<div class="msg-bubble">${msgData.text}</div>`;
      container.appendChild(msgDiv);
    }
    container.scrollTop = container.scrollHeight;
  }

  // Clock
  updateClock();
  setInterval(updateClock, 1000);
  updatePlayerClock();
  setInterval(updatePlayerClock, 1000);

  // Settings overlay click-outside close
  document.getElementById('settings-overlay').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeSettings();
  });

  setupShareLinks();
});

function setupShareLinks() {
  const gameUrl = "https://xinniku-xxxkotsu-ramen.pages.dev/";
  const clearText = encodeURIComponent("拾ったスマホから繋がる、ある失踪事件の記録――\n『〇ンニク〇んこつラーメン』を解決。太郎の救出に成功。\n\n#〇ンニク〇んこつラーメン");
  const badText = encodeURIComponent("拾ったスマホから繋がる、ある失踪事件の記録――\n『〇ンニク〇んこつラーメン』。……みいつけた。\n\n#〇ンニク〇んこつラーメン");
  
  const clearLink = document.getElementById('share-clear-x');
  const badLink = document.getElementById('share-bad-x');
  
  if (clearLink) {
    clearLink.href = `https://x.com/intent/tweet?text=${clearText}&url=${encodeURIComponent(gameUrl)}`;
  }
  if (badLink) {
    badLink.href = `https://x.com/intent/tweet?text=${badText}&url=${encodeURIComponent(gameUrl)}`;
  }
}
