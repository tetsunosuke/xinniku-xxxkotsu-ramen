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
    snsVisited: false,
    newsRead: false,
    galleryOpened: false,
    kitchenPhotoViewed: false,
  },
  notifiedItems: []
};

let gameState = (() => {
  try {
    const s = localStorage.getItem(STATE_KEY);
    return s ? JSON.parse(s) : JSON.parse(JSON.stringify(DEFAULT_STATE));
  } catch { return JSON.parse(JSON.stringify(DEFAULT_STATE)); }
})();

function saveState() {
  try { localStorage.setItem(STATE_KEY, JSON.stringify(gameState)); } catch {}
}

function setFlag(key, value) {
  if (gameState.flags[key] === value) return;
  gameState.flags[key] = value;
  saveState();
  checkTriggers();
  updateBadges();
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
  }
}

// ─── NOTIFICATIONS ────────────────────────────────────────────
const NOTIFS = [
  {
    id: 'hint_sns',
    check: () => !gameState.isLocked && !gameState.flags.snsVisited,
    icon: '🐦',
    app: 'SNS',
    msg: '【タベアルキ太郎】未読の投稿が3件あります',
    delay: 800,
    badge: 'sns'
  },
  {
    id: 'hint_news',
    check: () => gameState.flags.snsVisited && !gameState.flags.newsRead,
    icon: '🌐',
    app: 'ブラウザ',
    msg: 'ニュース詳細をブラウザで確認してください',
    delay: 1200,
    badge: 'browser'
  },
  {
    id: 'hint_gallery',
    check: () => gameState.currentStep === 'news_found' && !gameState.flags.kitchenPhotoViewed,
    icon: '📷',
    app: '写真',
    msg: '写真フォルダに新しい画像が追加されました',
    delay: 1000,
    badge: 'gallery'
  },
  {
    id: 'hint_chat',
    check: () => gameState.currentStep === 'location_spec',
    icon: '💬',
    app: 'LIME',
    msg: '【フードハンターケン】新着メッセージがあります…',
    delay: 1500,
    badge: 'chat'
  }
];

function checkTriggers() {
  NOTIFS.forEach(n => {
    if (!gameState.notifiedItems.includes(n.id) && n.check()) {
      gameState.notifiedItems.push(n.id);
      saveState();
      setTimeout(() => showToast(n.icon, n.app, n.msg), n.delay);
    }
  });
}

function updateBadges() {
  const badgeMap = {
    sns:     () => !gameState.isLocked && !gameState.flags.snsVisited,
    browser: () => gameState.flags.snsVisited && !gameState.flags.newsRead,
    gallery: () => gameState.currentStep === 'news_found' && !gameState.flags.kitchenPhotoViewed,
    chat:    () => gameState.currentStep === 'location_spec' && gameState.currentStep !== 'chat_sent'
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

  // Show dummy notification after 1.5s
  setTimeout(() => {
    const el = document.getElementById('lock-notification');
    if (el) {
      el.innerHTML = `
        <div class="lock-notif-icon">🍜</div>
        <div>
          <div class="lock-notif-app">〇ンニク〇んこつラーメン</div>
          <div class="lock-notif-msg">【お知らせ】本日はタベアルキ太郎様ご予約の特別仕込み日です。限定枠残り1席、今すぐご予約できます。</div>
        </div>
      `;
      el.classList.add('visible');
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
  setTimeout(() => { ls.style.display = 'none'; checkTriggers(); updateBadges(); }, 900);
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

function isMobile() { return window.innerWidth <= 768; }

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
    case 'SHOW_TOAST':
      showToast(msg.icon || '🔔', msg.app || '', msg.msg);
      break;
  }
});

// ─── ENDINGS ──────────────────────────────────────────────────
function triggerClear() {
  advanceStep('clear');
  const el = document.getElementById('epilogue-overlay');
  if (el) {
    setTimeout(() => el.classList.add('visible'), 500);
  }
}

function triggerBadEnd() {
  gameState.currentStep = 'bad_end'; saveState();
  // Close all windows
  Object.keys(wins).forEach(closeWin);
  closeMobileApp();
  const el = document.getElementById('bad-end-overlay');
  if (el) setTimeout(() => el.classList.add('visible'), 300);
  // Horror sound
  playBeep(60, 40, 3, 0.4);
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
  { sender: 'sent', text: 'ヤバい、変なスマホ拾った。裏面に「ラーメン店オープン記念」って書いてある。あの失踪したYouTuberタベアルキ太郎のじゃないか？' },
  { sender: 'recv', text: 'マジで！？例の限定スマホケースをつけた端末か？' },
  { sender: 'sent', text: 'そう、まさにそれ！でもロックかかってて開かないんだよ。パスコード8桁。' },
  { sender: 'recv', text: 'たしか、あの店はスマホケース（＝店への招待状）を持つファンだけが入れる優先予約システムがあったはず。太郎もそれで行く予定だったんだ。' },
  { sender: 'recv', text: '太郎の公開SNSを調べてみろよ。誕生日とか、お気に入りの店の情報（オープン記念日）あたりがヒントになってるんじゃないか？' },
  { sender: 'sent', text: 'なるほど。調べてみる！' }
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
  
  // Set random delay for next typing feel message (1.5s - 2.5s)
  if (playerChatIndex < PLAYER_CHAT_SCENARIO.length) {
    const nextMsg = PLAYER_CHAT_SCENARIO[playerChatIndex];
    const delay = nextMsg.sender === 'recv' ? 2200 : 1400; // Recv takes longer to type
    playerChatTimeout = setTimeout(renderNextPlayerMessage, delay);
  }
}

function closeThread() {
  document.querySelector('.chat-thread').classList.remove('open');
}

function openPlayerSns() {
  const overlay = document.getElementById('player-sns-overlay');
  const iframe = document.getElementById('player-sns-iframe');
  iframe.src = 'apps/sns.html?preview=1'; // Add query to remove profile header if needed
  overlay.classList.add('open');
}
function closePlayerSns() {
  const overlay = document.getElementById('player-sns-overlay');
  const iframe = document.getElementById('player-sns-iframe');
  iframe.src = '';
  overlay.classList.remove('open');
}
function switchToPickedPhone() {
  const pp = document.getElementById('player-phone');
  pp.style.transform = 'translateY(-100%)';
  // Use setTimeout to change display after transition ends
  setTimeout(() => { pp.style.display = 'none'; }, 500);
}
function flipDevice() {
  const pp = document.getElementById('player-phone');
  pp.style.display = 'flex';
  setTimeout(() => { pp.style.transform = 'translateY(0)'; }, 20);
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
  // Transition directly to the picked phone's lock screen
  switchToPickedPhone();
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
    if (pp) { pp.style.display = 'none'; pp.style.transform = 'translateY(-100%)'; }
    if (intro) intro.style.display = 'none';
    checkTriggers();
    updateBadges();
  } else {
    // If locked, initialize lock screen but hide picked phone interface initially under the player phone
    initLockScreen();
    if (pp) { pp.style.display = 'flex'; pp.style.transform = 'translateY(0)'; }
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
});
