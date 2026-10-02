/* Generic lesson view. NAVAL_DATA is loaded from the selected item's compiled Markdown bundle. */
(function () {
'use strict';

var D = window.NAVAL_DATA;
if (!D) {
  document.body.innerHTML = '<div style="padding:48px;font-family:-apple-system,sans-serif;line-height:1.8">'
    + '<h2>学习数据未载入</h2><p>请回到资料库确认这篇资料已经生成学习材料，然后使用 <code>python3 serve.py</code> 启动本地服务。</p></div>';
  return;
}
var HAS_YT = !!(D.meta && D.meta.videoId);

var ENT = D.entities, SENTS = D.sentences, MATCHES = D.matches, CHS = D.chapters;
/* Item translation bundle aligns with SENTS; a missing translation hides its button. */
var SENT_CN = window.NAVAL_SENT_CN || [];
var CH_CN = window.NAVAL_CH_CN || [];
function chTitle(i) { return CH_CN[i] || (CHS[i] && CHS[i].title) || ''; }
var byId = new Map();
ENT.forEach(function (e) { byId.set(e.id, e); });
var TOTAL_ENT = ENT.length;

/* ------------------------------------------------------------------ 工具 */
var $ = function (s) { return document.querySelector(s); };
/* 进度存档按视频隔离，避免多个学习页共用同一份记录 */
var ITEM_ID = window.NAVAL_ITEM_ID || new URLSearchParams(location.search).get('item') || 'naval-44-harsh-truths';
var LS_KEY = 'study.item.' + ITEM_ID + '.v1';
var MD_PROGRESS_URL = '/api/items/' + encodeURIComponent(ITEM_ID) + '/progress';
var mdSaveTimer = null;

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function fmt(sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  var mm = (h ? String(m).padStart(2, '0') : String(m));
  return (h ? h + ':' : '') + mm + ':' + String(s).padStart(2, '0');
}
function shuffle(a) {
  for (var i = a.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}
var toastTimer = null;
function toast(msg) {
  var el = $('#toast');
  el.textContent = msg;
  el.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { el.classList.remove('on'); }, 1900);
}

/* ------------------------------------------------------------------ 状态 */
var S = {
  theme: 'light', mode: 'read', chapter: 0, rate: 1,
  navW: 0, navCollapsed: false,
  learned: {}, score: {}, wrong: {}, stats: { a: 0, c: 0 }
};
try {
  var saved = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
  Object.keys(saved).forEach(function (k) { if (k in S) S[k] = saved[k]; });
} catch (e) { /* 忽略损坏的存档 */ }
try {
  var sharedTheme = localStorage.getItem('echo-theme');
  if (sharedTheme === 'light' || sharedTheme === 'dark') S.theme = sharedTheme;
} catch (e) { /* 忽略不可用的浏览器存储 */ }
var requestedMode = new URLSearchParams(location.search).get('mode');
if (['read', 'cards', 'quiz', 'concepts', 'listening'].indexOf(requestedMode) >= 0) S.mode = requestedMode;
var libraryHome = $('#libraryHome');
if (libraryHome) libraryHome.addEventListener('click', function () { location.href = '/'; });
function mdProgressSnapshot() {
  return { chapter: S.chapter, learned: S.learned, score: S.score, wrong: S.wrong, stats: S.stats,
    updatedAt: new Date().toISOString() };
}
function save() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(S)); } catch (e) {}
  clearTimeout(mdSaveTimer);
  mdSaveTimer = setTimeout(function () {
    fetch(MD_PROGRESS_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ progress: mdProgressSnapshot() }) }).catch(function () {});
  }, 450);
}
function restoreMarkdownProgress() {
  return fetch(MD_PROGRESS_URL).then(function (r) { if (!r.ok) throw new Error('progress unavailable'); return r.json(); })
    .then(function (payload) {
      var p = payload && payload.progress;
      if (!p || !Object.keys(p).length) return;
      ['chapter', 'learned', 'score', 'wrong', 'stats'].forEach(function (k) {
        if (p[k] !== undefined) S[k] = p[k];
      });
    }).catch(function () {});
}

function isLearned(id) { return !!S.learned[id]; }
function markLearned(id, on) {
  if (on) { S.learned[id] = 1; } else { delete S.learned[id]; }
  save(); syncProgress();
}
function learnedCount() { return Object.keys(S.learned).length; }
function syncProgress() {
  var n = learnedCount();
  $('#progBar').style.width = (TOTAL_ENT ? n / TOTAL_ENT * 100 : 0) + '%';
  $('#progText').textContent = n + ' / ' + TOTAL_ENT;
}

function entClass(e) {
  if (e.type === 'word') return 'word-' + (e.tier || 'rare');
  return e.type;   // phrase | concept
}
function tierLabel(e) {
  if (e.type === 'phrase') return '短语';
  if (e.type === 'concept') return '概念';
  return { core: '核心', mid: '进阶', rare: '拓展' }[e.tier] || '';
}

/* ------------------------------------------------------------------ 主题 */
function applyTheme() {
  document.documentElement.setAttribute('data-theme', S.theme);
  try { localStorage.setItem('echo-theme', S.theme); } catch (e) {}
  save();
}

/* ------------------------------------------------------------------ 播放层
   两套后端，统一接口：
   - yt    ：YouTube IFrame API（需要能访问 youtube.com，且版权方允许嵌入）
   - local ：本地音频 / 视频文件（离线可用，跳转、A-B 循环、倍速、跟读全部对等）
   界面其余部分只通过 yt.ready / yt.player.* 访问，后端切换对它们透明。 */
var YT_ERR = {
  2: '参数无效（视频 ID 或播放参数错误）',
  5: 'HTML5 播放器错误（浏览器解码或扩展干扰）',
  100: '视频不存在、已被删除或设为私享',
  101: '版权方禁止嵌入播放，只能在 youtube.com 观看',
  150: '版权方禁止嵌入播放，只能在 youtube.com 观看'
};
var ITEM_MEDIA = window.NAVAL_ITEM_MEDIA || '';
var ITEM_MEDIA_NAME = window.NAVAL_ITEM_MEDIA_NAME || '';
var ITEM_POSTER = window.NAVAL_ITEM_POSTER || '';
var ITEM_SOURCE_URL = window.NAVAL_ITEM_SOURCE_URL || '';

var PL = {
  backend: 'local',         // 'yt' | 'local'
  ytPhase: 'idle',          // idle | loading | ready | failed
  ytPlayer: null,
  ytErr: '',                // 诊断用的错误码文本
  phMsg: '播放器载入中…',    // 占位层要显示的话（只在 YouTube 后端未就绪时可见）
  el: null, elKind: 'audio', elReady: false,
  srcName: '',
  ytDur: 0,                 // YouTube 后端时长（两条后端的时长必须分开存，
  localDur: 0,              // 否则 onReady 会把本地音源已读到的时长覆盖掉）
  foundLocal: ''            // 自动探测到的本地文件 URL
};

var yt = {
  player: null, dur: 0, playing: false,
  loopA: null, loopB: null, remain: 0,
  active: -1, timer: null
};
Object.defineProperty(yt, 'ready', {
  get: function () { return PL.backend === 'local' ? PL.elReady : PL.ytPhase === 'ready'; }
});
Object.defineProperty(yt, 'failed', {
  get: function () { return PL.ytPhase === 'failed'; }
});

/* 把本地 <audio>/<video> 包装成与 YT 播放器一致的接口 */
function localAdapter(el) {
  return {
    seekTo: function (s) { try { el.currentTime = Math.max(0, s); } catch (e) {} },
    playVideo: function () {
      var p = el.play();
      if (p && p.catch) p.catch(function () { toast('浏览器阻止了自动播放，请再点一次播放按钮'); });
    },
    pauseVideo: function () { try { el.pause(); } catch (e) {} },
    getCurrentTime: function () { return el.currentTime || 0; },
    getDuration: function () { return isFinite(el.duration) ? el.duration : 0; },
    getPlayerState: function () { return el.ended ? 0 : (el.paused ? 2 : 1); },
    setPlaybackRate: function (r) { try { el.playbackRate = r; } catch (e) {} }
  };
}

/* 播放按钮是「播放 ▶ / 暂停 ⏸」图标切换，不是文字标签。
   所有状态变化都必须走这里，否则图标会停在错误的一侧。 */
function setPlayingUI(on) {
  var b = $('#btnPlay');
  if (!b) return;
  b.classList.toggle('active', !!on);
  b.setAttribute('aria-label', on ? '暂停' : '播放');
}

function paintSrc() {
  var g = $('#srcGroup');
  if (g) {
    g.querySelectorAll('button').forEach(function (b) {
      b.classList.toggle('active', b.dataset.src === PL.backend);
    });
  }
  var pick = $('#btnPick');
  if (pick) pick.style.display = (PL.backend === 'local' && !PL.elReady) ? '' : 'none';
}

/* 切换后端；两边互斥，切换时暂停另一方 */
function useBackend(kind) {
  if (kind === 'yt' && !HAS_YT) { toast('这篇资料使用本地视频'); return; }
  // 只有「一个本地文件都没有」时才需要弹文件框；文件已选但元数据尚未解析时应当直接切换
  if (kind === 'local' && !PL.el) {
    toast('请选择本机的音频或视频文件');
    pickLocalFile();
    paintSrc();
    return;
  }
  PL.backend = kind;
  var box = $('#ytBox');
  if (box) {
    box.classList.toggle('mode-local', kind === 'local');
    box.classList.toggle('mode-yt', kind !== 'local');
  }
  paintSourceKind();
  paintPh();
  if (kind === 'local') {
    if (PL.ytPlayer && PL.ytPlayer.pauseVideo) { try { PL.ytPlayer.pauseVideo(); } catch (e) {} }
    yt.player = PL.elReady ? localAdapter(PL.el) : null;
    yt.dur = PL.localDur;
    $('#dockTotal').textContent = PL.localDur ? fmt(PL.localDur) : '--:--';
    setState(PL.elReady ? '本地音源就绪' : '音源载入中…');
  } else {
    if (PL.el) { try { PL.el.pause(); } catch (e) {} }
    yt.player = PL.ytPlayer;
    yt.dur = (PL.ytPlayer && PL.ytPlayer.getDuration) ? (PL.ytPlayer.getDuration() || 0) : 0;
    $('#dockTotal').textContent = yt.dur ? fmt(yt.dur) : D.meta.durationText;
    setState(PL.ytPhase === 'ready' ? '就绪' : (PL.ytPhase === 'failed' ? '不可用' : '载入中'));
  }
  yt.playing = false;
  setPlayingUI(false);
  yt.loopA = yt.loopB = null;
  $('#dockTitle').textContent = kind === 'local' ? (PL.srcName || '本地音源') : '未开始播放';
  paintSrc();
  startTick();
  syncDock();
}

/* 用后端内的方法刷新一次读数，避免切换后停在同一帧 */
function syncDock() {
  var t = (yt.ready && yt.player && yt.player.getCurrentTime) ? yt.player.getCurrentTime() : 0;
  $('#dockCur').textContent = fmt(t);
}

function startTick() {
  if (yt.timer) return;
  yt.timer = setInterval(tick, 250);
}

function tick() {
  if (!yt.ready || !yt.player || !yt.player.getCurrentTime) return;
  var cur = yt.player.getCurrentTime();
  $('#dockCur').textContent = fmt(cur);
  if (yt.loopA !== null && yt.loopB !== null) {
    if (cur >= yt.loopB - 0.06 || cur < yt.loopA - 0.6) {
      if (yt.remain > 1) {
        if (yt.remain !== Infinity) yt.remain--;
        yt.player.seekTo(yt.loopA, true);
        yt.player.playVideo();
      } else {
        yt.loopA = yt.loopB = null;
        setState('就绪');
      }
    }
  }
  if (S.mode === 'read') followPlayback(cur);
}

function setState(t) { $('#dockState').textContent = t; }

/* ------------------------------- YouTube 后端 ------------------------------- */
window.onYouTubeIframeAPIReady = function () {
  var vars = { rel: 0, modestbranding: 1, playsinline: 1, controls: 1, enablejsapi: 1 };
  if (location.protocol !== 'file:') vars.origin = location.origin;
  PL.ytPlayer = new window.YT.Player('ytPlayer', {
    videoId: D.meta.videoId,
    width: '100%', height: '100%',
    playerVars: vars,
    events: {
      onReady: function (ev) {
        PL.ytPhase = 'ready';
        PL.ytErr = '';
        PL.phMsg = '';
        paintPh();
        var d = ev.target.getDuration() || 0;
        PL.ytDur = d;
        if (PL.backend === 'yt') {
          yt.player = PL.ytPlayer;
          yt.dur = d;
          $('#dockTotal').textContent = fmt(d) || D.meta.durationText;
          setState('就绪');
        }
        startTick();
      },
      onStateChange: function (ev) {
        yt.playing = (ev.data === 1);
        var map = { 1: '播放中', 2: '已暂停', 0: '已结束', 3: '缓冲中', 5: '已就绪' };
        // 循环播放时不要用「播放中」覆盖循环状态提示
        if (PL.backend === 'yt' && yt.loopA === null) setState(map[ev.data] || '就绪');
        setPlayingUI(ev.data === 1);
      },
      onError: function (ev) {
        var code = ev && ev.data;
        var desc = YT_ERR[code];
        PL.ytErr = code ? (code + '：' + (desc || '未知错误')) : '未知错误';
        markPlayerFailed(desc
          ? ('YouTube 播放器报错 ' + code + '（' + desc + '）')
          : 'YouTube 播放器报错（未返回错误码）');
      }
    }
  });
};

function markPlayerFailed(msg) {
  PL.ytPhase = 'failed';
  PL.phMsg = msg || '播放器不可用';
  paintPh();
  if (PL.backend === 'yt') {
    setState('不可用');
    $('#dockTotal').textContent = D.meta.durationText;
  }
  // 本地音源可用则自动接管，否则给出可执行的替代路径
  var alt = PL.elReady ? localSourceUrl() : PL.foundLocal;
  if (alt) {
    loadLocalSource(alt, PL.srcName || baseName(alt), true);
    toast('YouTube 不可用，已自动切换到本地音源');
    return;
  }
  showNotice('<strong>视频无法播放</strong> —— ' + esc(msg) + '。'
    + '<button data-act="retry-yt" style="font-size:var(--fs-2xs);padding:2px 9px;margin:0 4px">重试连接</button>'
    + '<button data-act="pick-local" style="font-size:var(--fs-2xs);padding:2px 9px;margin:0 4px">载入本地音源</button>'
    + '或点 <code>播放器诊断</code> 看细节；在本篇资料目录的 <code>media/</code> 中配置本地音频'
    + '刷新即可离线使用全部跟读功能。');
}

/* 网络恢复后重新拉起播放器，无需刷新页面 */
function retryYouTube() {
  closeDrawer();
  PL.ytPhase = 'loading'; PL.ytErr = '';
  yt.loopA = yt.loopB = null;
  if (PL.el) { try { PL.el.pause(); } catch (e) {} }
  try { if (PL.ytPlayer && PL.ytPlayer.destroy) PL.ytPlayer.destroy(); } catch (e) {}
  PL.ytPlayer = null;
  var old = document.getElementById('ytPlayer');
  if (old) {
    var n = document.createElement('div');
    n.id = 'ytPlayer';
    old.parentNode.replaceChild(n, old);
  }
  PL.phMsg = '正在重试连接 YouTube…';
  useBackend('yt');
  retryYtLoad();
  setTimeout(function () {
    if (PL.ytPhase === 'loading') markPlayerFailed('重试超时：网络仍不通');
  }, 9000);
}

/* 拉起（或重新拉起）YouTube IFrame API —— 启动与「重试连接」共用 */
function retryYtLoad() {
  if (window.YT && window.YT.Player) {
    window.onYouTubeIframeAPIReady();
  } else {
    var s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api?retry=' + Date.now();
    s.onerror = function () { markPlayerFailed('无法载入 YouTube 播放器（未联网或代理未生效）'); };
    document.head.appendChild(s);
  }
}

(function loadYT() {
  if (PL.backend === 'local') {
    PL.ytPhase = 'idle'; PL.phMsg = '默认使用本地音源';
    return;
  }
  if (!HAS_YT) {
    PL.ytPhase = 'failed'; PL.phMsg = '请使用本地视频';
    var ytButton = document.querySelector('#srcGroup [data-src="yt"]');
    if (ytButton) ytButton.hidden = true;
    var openButton = $('#btnOpen');
    if (openButton) openButton.textContent = '打开原视频';
    return;
  }
  retryYtLoad();
  setTimeout(function () {
    if (PL.ytPhase === 'loading') markPlayerFailed('播放器载入超时（网络不通或已被拦截）');
  }, 9000);
})();

/* ------------------------------- 本地音源后端 ------------------------------- */
function baseName(url) {
  try { return decodeURIComponent(String(url).split('/').pop().split('?')[0]); }
  catch (e) { return '本地音源'; }
}
function localSourceUrl() {
  return PL.el && PL.el.src ? PL.el.src : '';
}

/* 播放器方框里同一时刻只该有一层：视频画面，或 ♪ 徽标。
   由「当前后端 + 载入的文件类型」共同决定，缺了它视频会被不透明徽标盖住。 */
function paintSourceKind() {
  var box = $('#ytBox');
  if (!box) return;
  var local = PL.backend === 'local';
  box.classList.toggle('is-video', local && PL.elKind === 'video');
  box.classList.toggle('is-audio', local && PL.elKind !== 'video');
}

/* 占位层（#ytPh）= 播放器方框里那层文字提示。
   显隐必须只由本函数决定：它用的是 inline style，而 CSS 的
   `.yt-box.mode-local .ph{display:none}` 压不过 inline —— 一旦别处直接写
   `style.display='block'`，切到本地音源后旧的「未知错误」就会一直盖在画面上。 */
function paintPh() {
  var ph = $('#ytPh');
  if (!ph) return;
  if (PL.backend === 'local' || PL.ytPhase === 'ready') {
    ph.style.display = 'none';
    return;
  }
  ph.style.display = 'grid';
  ph.textContent = PL.phMsg || (PL.ytPhase === 'failed' ? '播放器不可用' : '播放器载入中…');
}

function loadLocalSource(url, name, autoSwitch) {
  var isVideo = /\.(mp4|webm|ogv|mov|mkv|m4v)(\?|$)/i.test(name || url);
  PL.elKind = isVideo ? 'video' : 'audio';
  paintSourceKind();
  var el = isVideo ? $('#localVideo') : $('#localAudio');

  PL.el = el;
  PL.srcName = name || '本地音源';
  PL.elReady = false;
  try { el.pause(); } catch (e) {}

  if (el.dataset.wired !== '1') {
    el.dataset.wired = '1';
    el.addEventListener('loadedmetadata', function () {
      PL.elReady = true;
      PL.localDur = isFinite(el.duration) ? el.duration : 0;
      // 有封面图时方框显示封面；没有封面（例如用户自己拖进来的文件）才蹭一帧，
      // 否则 preload="metadata" 不解码画面，方框会一直是黑的、像坏掉了。
      if (PL.elKind === 'video' && !el.poster && !el.played.length && el.currentTime === 0) {
        try { el.currentTime = 0.05; } catch (e) {}
      }
      if (PL.backend === 'local') {
        yt.dur = PL.localDur;
        yt.player = localAdapter(el);
        $('#dockTotal').textContent = PL.localDur ? fmt(PL.localDur) : '--:--';
        setState('本地音源就绪');
      }
      startTick();
      paintSrc();
    });
    el.addEventListener('play', function () {
      yt.playing = true;
      if (PL.backend === 'local' && yt.loopA === null) setState('播放中');
      setPlayingUI(true);
    });
    el.addEventListener('pause', function () {
      yt.playing = false;
      if (PL.backend === 'local') setState('已暂停');
      setPlayingUI(false);
    });
    el.addEventListener('ended', function () {
      yt.playing = false;
      if (PL.backend === 'local') setState('已结束');
      setPlayingUI(false);
    });
    el.addEventListener('error', function () {
      PL.elReady = false;
      showNotice('本地音源载入失败：<code>' + esc(PL.srcName) + '</code>。'
        + '请确认文件是浏览器可解码的格式（推荐 <code>.m4a / .mp3 / .mp4</code>）。');
    });
  }
  // 每篇封面由该条目 index.md 的 poster_path 配置。
  if (el.id === 'localVideo') el.poster = /^blob:/.test(url) ? '' : ITEM_POSTER;
  el.src = url;
  el.load();
  // YouTube 已失败时，无论调用方怎么传都直接接管——否则用户面对的是一个坏掉的播放器
  var go = (autoSwitch !== false) || PL.ytPhase === 'failed';
  if (go) { useBackend('local'); $('#notice').hidden = true; }
  else paintSrc();
}

function pickLocalFile() {
  $('#filePick').click();
}

(function wireLocalPickers() {
  var f = $('#filePick');
  f.addEventListener('change', function () {
    var file = f.files && f.files[0];
    if (!file) return;
    loadLocalSource(URL.createObjectURL(file), file.name, true);
    toast('已载入 ' + file.name);
    f.value = '';
  });
  var box = $('#ytBox');
  ['dragenter', 'dragover'].forEach(function (k) {
    box.addEventListener(k, function (e) { e.preventDefault(); box.classList.add('drag'); });
  });
  ['dragleave', 'drop'].forEach(function (k) {
    box.addEventListener(k, function (e) { e.preventDefault(); box.classList.remove('drag'); });
  });
  box.addEventListener('drop', function (e) {
    var file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (!file) return;
    loadLocalSource(URL.createObjectURL(file), file.name, true);
    toast('已载入 ' + file.name);
  });
})();

/* 只加载当前资料 index.md 配置的本地媒体，不扫描项目级共享目录。 */
function autoFindLocalSource() {
  if (!ITEM_MEDIA) { paintSrc(); return; }
  PL.foundLocal = ITEM_MEDIA;
  loadLocalSource(ITEM_MEDIA, ITEM_MEDIA_NAME || baseName(ITEM_MEDIA), true);
  toast('已启用本篇本地音源 ' + (ITEM_MEDIA_NAME || baseName(ITEM_MEDIA)));
}

/* ------------------------------- 诊断 ------------------------------- */
function openDiag() {
  var rows = [
    ['页面协议', location.protocol + (location.protocol === 'file:' ? '（file:// 下 YouTube 通信会被拦截，请用本地服务）' : '')],
    ['当前音源', PL.backend === 'local' ? ('本地文件：' + (PL.srcName || '—')) : 'YouTube 内嵌'],
    ['YouTube IFrame API', PL.ytPhase === 'ready' ? '已就绪' : (PL.ytPhase === 'failed' ? '失败' : '加载中…')],
    ['YouTube 错误', PL.ytErr || '无'],
    ['本地音源', PL.elReady ? ('已就绪 · ' + fmt(PL.localDur)) : (PL.srcName ? '载入中/失败' : '未找到')],
    ['自动探测', PL.foundLocal ? PL.foundLocal : (ITEM_MEDIA ? '本篇媒体载入中或失败' : '本篇未配置本地媒体')]
  ];
  var h = '<div class="dsec"><div class="k">状态</div><div class="v">'
    + rows.map(function (r) {
      return '<div style="display:flex;gap:10px;padding:4px 0"><span style="min-width:146px;color:var(--text-3);font-size:var(--fs-2xs)">'
        + esc(r[0]) + '</span><span style="font-size:var(--fs-xs)">' + r[1] + '</span></div>';
    }).join('') + '</div></div>';

  h += '<div class="dsec"><div class="k">YouTube 报错码含义</div><div class="v">'
    + Object.keys(YT_ERR).map(function (k) {
      return '<div style="font-size:var(--fs-xs)"><code>' + k + '</code> ' + esc(YT_ERR[k]) + '</div>';
    }).join('') + '</div></div>';

  h += '<div class="dsec"><div class="k">无法内嵌时的替代方案</div><div class="v" style="font-size:var(--fs-xs);line-height:1.7">'
    + '1. 把媒体放入本篇目录的 <code>media/</code>，并在 <code>index.md</code> 设置 <code>media_path</code>，刷新即自动启用；<br>'
    + '2. 或点 <code>本地音源 → 选择文件…</code>，临时载入本机任意音视频；<br>'
    + '3. 或点 <code>在 YouTube 打开</code>，用浏览器原生播放器听，回来按 <code>← →</code> 定位句子。'
    + '</div></div>';

  h += '<div class="dsec"><div class="k">操作</div><div class="acts">'
    + '<button data-act="retry-yt">重试连接 YouTube</button>'
    + '<button data-act="pick-local">载入本地音源</button>'
    + '<button data-act="open-yt">在 YouTube 打开</button>'
    + '</div></div>';

  h += '<div class="dsec"><div class="k">获取音频的命令（需已安装 yt-dlp）</div>'
    + '<div class="v"><pre style="background:var(--surface-2);border:1px solid var(--border);border-radius:8px;padding:10px;'
    + 'font-family:var(--font-mono);font-size:var(--fs-2xs);overflow:auto;line-height:1.6">'
    + 'mkdir -p media\n'
    + 'yt-dlp -f bestaudio -o "media/audio.%(ext)s" \\\n'
    + '  "https://www.youtube.com/watch?v=' + esc(D.meta.videoId) + '"</pre></div></div>';

  $('#dwTitle').textContent = '播放器诊断';
  $('#dwPhone').textContent = D.meta.title;
  $('#dwBody').innerHTML = h;
  $('#drawer').classList.add('open');
  $('#backdrop').classList.add('open');
  drawerOpen = true;
}

function showNotice(html) {
  var n = $('#notice');
  $('#noticeTx').innerHTML = html;
  n.hidden = false;
}

function seek(sec, play) {
  if (!yt.ready) {
    toast('播放器未就绪，已复制时间点 ' + fmt(sec));
    try { navigator.clipboard.writeText(fmt(sec)); } catch (e) {}
    return false;
  }
  yt.loopA = yt.loopB = null;
  yt.player.seekTo(Math.max(0, sec), true);
  if (play !== false) { yt.player.playVideo(); }
  return true;
}

function playRange(a, b, times) {
  if (!yt.ready) { toast('播放器未就绪'); return; }
  var finite = (times && times !== Infinity);
  yt.loopA = a; yt.loopB = b; yt.remain = finite ? times : Infinity;
  yt.player.seekTo(a, true);
  yt.player.playVideo();
  setState(finite ? '重复 ' + times + ' 次' : '本句循环');
}

function sentenceEnd(si) {
  var s = SENTS[si];
  var e = s[2];
  if (e == null || e <= s[0]) e = s[0] + 6;
  return Math.min(e, s[0] + 30);
}

/* 播放时高亮并跟随当前句 */
function followPlayback(cur) {
  var ch = CHS[S.chapter];
  if (!ch) return;
  var from = ch.sentStart, to = Math.min(ch.sentEnd, SENTS.length);
  if (SENTS[from] && cur < SENTS[from][0]) return;
  var idx = -1;
  for (var i = from; i < to; i++) {
    if (SENTS[i][0] <= cur + 0.15) idx = i; else break;
  }
  if (idx >= 0 && idx !== yt.active) setActive(idx, true);
}

function setActive(si, scroll) {
  var trans = $('#transcript');
  var prev = trans.querySelector('.sent.active');
  if (prev) prev.classList.remove('active');
  var el = trans.querySelector('[data-si="' + si + '"]');
  if (el) {
    el.classList.add('active');
    if (scroll && yt.playing) {
      var box = trans.getBoundingClientRect(), r = el.getBoundingClientRect();
      if (r.top < box.top + 40 || r.bottom > box.bottom - 40) {
        trans.scrollTop += (r.top - box.top) - box.height / 2 + r.height / 2;
      }
    }
  }
  yt.active = si;
}

/* ------------------------------------------------------------------ 精读 */
var chapterFilter = '';

function renderChapters() {
  var q = chapterFilter.toLowerCase();
  var html = '';
  CHS.forEach(function (c, i) {
    var t = chTitle(i), en = c.title || '';
    if (q && t.toLowerCase().indexOf(q) < 0 && en.toLowerCase().indexOf(q) < 0) return;
    html += '<li data-ch="' + i + '" class="' + (i === S.chapter ? 'active' : '') + '"'
      + (en && en !== t ? ' title="' + esc(en) + '"' : '') + '>'
      + '<span class="t">' + fmt(c.sec) + '</span>'
      + '<span>' + esc(t) + '</span>'
      + '<span class="n">' + (c.entities ? c.entities.length : 0) + '</span></li>';
  });
  $('#chapterList').innerHTML = html || '<li class="muted" style="cursor:default">无匹配章节</li>';
  $('#chCount').textContent = CHS.length + ' 章';
}

function renderTranscript() {
  var ch = CHS[S.chapter];
  if (!ch) return;
  var from = ch.sentStart, to = Math.min(ch.sentEnd, SENTS.length);
  var onlyHi = $('#onlyHi').checked;
  var html = '', n = 0;
  for (var i = from; i < to; i++) {
    var m = MATCHES[i] || [];
    if (onlyHi && !m.length) continue;
    n++;
    var txt = SENTS[i][1], last = 0, inner = '';
    for (var k = 0; k < m.length; k++) {
      var eid = m[k][0], a = m[k][1], b = m[k][2];
      if (a > last) inner += esc(txt.slice(last, a));
      var e = byId.get(eid);
      inner += '<mark class="hi t-' + entClass(e) + (isLearned(eid) ? ' learned' : '')
        + '" data-eid="' + eid + '">' + esc(txt.slice(a, b)) + '</mark>';
      last = b;
    }
    inner += esc(txt.slice(last));
    var cn = SENT_CN[i] || '';
    html += '<div class="sent" data-si="' + i + '">'
      + '<span class="ts">' + fmt(SENTS[i][0]) + '</span>'
      + '<p>' + inner + '</p>'
      + (cn ? '<div class="sent-cn" hidden>' + esc(cn) + '</div>' : '')
      + '<div class="act-col">'
      + '<button class="loop-btn" data-loop="' + i + '">循环</button>'
      + (cn ? '<button class="tr-btn" data-tr="' + i + '" title="显示 / 隐藏本句中文翻译">译</button>' : '')
      + '</div></div>';
  }
  $('#transcript').innerHTML = html || '<p class="empty">本章没有含目标词的句子。取消上方勾选可查看全文。</p>';
  $('#curChapter').textContent = chTitle(S.chapter);
  $('#curMeta').textContent = '句子 ' + n + ' · ' + fmt(ch.sec) + ' 起';
  renderSideWords(ch);
  yt.active = -1;
}

function renderSideWords(ch) {
  var ids = ch.entities || [];
  var html = '';
  ids.forEach(function (id) {
    var e = byId.get(id);
    if (!e) return;
    html += '<div class="wcard' + (isLearned(id) ? ' learned' : '') + '" data-eid="' + id + '">'
      + '<div class="r1"><span class="w">' + esc(e.disp) + '</span>'
      + '<span class="tagchip ' + entClass(e) + '">' + tierLabel(e) + '</span>'
      + '<span class="n">' + (e.n || 0) + ' 次</span></div>'
      + (e.phone ? '<div class="r2">' + esc(e.phone) + (e.pos ? ' · ' + esc(e.pos) : '') + '</div>' : '')
      + '<div class="r3">' + esc((e.cn || '').slice(0, 66)) + '</div></div>';
  });
  $('#sideWords').innerHTML = html || '<p class="empty" style="padding:16px 4px">本章未命中目标词</p>';
  $('#sideCount').textContent = ids.length + ' 条';
}

function gotoChapter(i, jump) {
  S.chapter = Math.max(0, Math.min(CHS.length - 1, i));
  save();
  renderChapters();
  renderTranscript();
  $('#transcript').scrollTop = 0;
  if (jump && yt.ready) seek(CHS[S.chapter].sec);
}

/* ------------------------------------------------------------------ 详情抽屉 */
var drawerOpen = false;
function openDrawer(eid) {
  var e = byId.get(eid);
  if (!e) return;
  $('#dwTitle').textContent = e.disp;
  $('#dwPhone').textContent = [e.phone ? '/' + e.phone + '/' : '', e.pos, tierLabel(e),
    e.themeLabel || ''].filter(Boolean).join(' · ');

  var h = '';
  h += '<div class="dsec"><div class="k">在视频中的意思</div><div class="v">' + esc(e.cn || '—') + '</div></div>';
  if (e.conceptDesc) {
    h += '<div class="dsec"><div class="k">概念框架</div><div class="v">' + esc(e.conceptDesc) + '</div></div>';
  }
  h += '<div class="dsec"><div class="k">出现情况</div><div class="v">'
    + '词典标注 ' + (e.n || 0) + ' 次'
    + (e.occ != null ? ' · 正文命中 ' + e.occ + ' 句' : '')
    + (e.first != null ? ' · 首次出现 <span class="mono">' + fmt(e.first) + '</span>' : '')
    + (e.starter ? ' · <span style="color:var(--accent)">首轮 40 词</span>' : '')
    + '</div></div>';

  if (e.ex) {
    h += '<div class="dsec"><div class="k">视频原句</div>'
      + '<div class="quote">' + (e.exSec != null ? '<span class="ts">' + fmt(e.exSec) + '</span>' : '')
      + esc(e.ex) + '</div></div>';
  }

  h += '<div class="dsec"><div class="k">操作</div><div class="acts">';
  if (e.first != null) h += '<button class="primary" data-act="play" data-sec="' + e.first + '">播放首次出现</button>';
  if (e.exSec != null) h += '<button data-act="play" data-sec="' + e.exSec + '">播放此例句</button>';
  h += '<button data-act="toggle-learn">' + (isLearned(eid) ? '取消「已掌握」' : '标记为已掌握') + '</button>';
  h += '<button data-act="copy">复制词条</button>';
  h += '</div></div>';

  $('#dwBody').innerHTML = h;
  $('#drawer').classList.add('open');
  $('#backdrop').classList.add('open');
  drawerOpen = true;
}
function closeDrawer() {
  $('#drawer').classList.remove('open');
  $('#backdrop').classList.remove('open');
  drawerOpen = false;
}

/* ------------------------------------------------------------------ 悬浮提示 */
(function tipInit() {
  var tip = $('#tip');
  document.addEventListener('mouseover', function (ev) {
    var m = ev.target.closest && ev.target.closest('mark.hi, .wcard');
    if (!m) return;
    var e = byId.get(+m.dataset.eid);
    if (!e) return;
    tip.innerHTML = '<div class="w">' + esc(e.disp) + '</div>'
      + (e.phone ? '<div class="ph">/' + esc(e.phone) + '/ ' + esc(e.pos || '') + '</div>' : '')
      + '<div class="cn">' + esc((e.cn || '').slice(0, 96)) + '</div>'
      + '<div class="hint">' + (e.n || 0) + ' 次 · 点击查看详情</div>';
    tip.classList.add('on');
  });
  document.addEventListener('mousemove', function (ev) {
    if (!tip.classList.contains('on')) return;
    var pad = 14, w = tip.offsetWidth, hgt = tip.offsetHeight;
    var x = ev.clientX + pad, y = ev.clientY + pad;
    if (x + w > innerWidth - 8) x = ev.clientX - w - pad;
    if (y + hgt > innerHeight - 8) y = ev.clientY - hgt - pad;
    tip.style.left = Math.max(8, x) + 'px';
    tip.style.top = Math.max(8, y) + 'px';
  });
  document.addEventListener('mouseout', function (ev) {
    if (ev.target.closest && ev.target.closest('mark.hi, .wcard')) tip.classList.remove('on');
  });
})();

/* ------------------------------------------------------------------ 词汇卡 */
var F = { type: 'all', tier: 'all', theme: 'all', sort: 'n', q: '', state: 'all' };

var THEMES = (function () {
  var m = new Map();
  ENT.forEach(function (e) { if (e.themeLabel) m.set(e.theme, e.themeLabel); });
  return [...m.entries()];
})();

function renderCards() {
  var P = $('#cardsPanel');
  var themes = THEMES.map(function (t) {
    return '<option value="' + t[0] + '"' + (F.theme === t[0] ? ' selected' : '') + '>' + esc(t[1]) + '</option>';
  }).join('');

  P.innerHTML = ''
    + '<h2>词汇与词组总表</h2>'
    + '<p class="lead">共 ' + TOTAL_ENT + ' 条，全部经视频字幕逐条校验。'
    + '绿色为核心词（≥3 次），蓝色为进阶／拓展词，橙色为固定搭配，紫色为概念术语。'
    + '点击任意卡片查看详情并跳转到视频中对应的位置。</p>'
    + '<div class="toolbar">'
    + '<div class="field"><label>类型</label><select id="fType">'
    + '<option value="all">全部</option><option value="word">单词</option>'
    + '<option value="phrase">短语搭配</option><option value="concept">概念术语</option></select></div>'
    + '<div class="field"><label>层级</label><select id="fTier">'
    + '<option value="all">全部</option><option value="core">核心 ≥3 次</option>'
    + '<option value="mid">进阶 2 次</option><option value="rare">拓展 1 次</option></select></div>'
    + '<div class="field"><label>主题</label><select id="fTheme"><option value="all">全部</option>'
    + themes + '</select></div>'
    + '<div class="field"><label>排序</label><select id="fSort">'
    + '<option value="n">按出现次数</option><option value="az">按字母</option>'
    + '<option value="time">按出现顺序</option></select></div>'
    + '<div class="field"><label>状态</label><select id="fState">'
    + '<option value="all">全部</option><option value="new">未掌握</option>'
    + '<option value="done">已掌握</option>'
    + (ENT.some(function (e) { return e.starter; })
      ? '<option value="starter">首轮 40 词</option>' : '')
    + '</select></div>'
    + '<div class="grow"><input type="search" id="fQ" placeholder="搜索单词、释义或音标…" value="' + esc(F.q) + '"></div>'
    + '</div>'
    + '<div id="cardStats" class="stat-row"></div>'
    + '<div class="card-grid" id="cardGrid"></div>';

  $('#fType').value = F.type; $('#fTier').value = F.tier; $('#fTheme').value = F.theme;
  $('#fSort').value = F.sort; $('#fState').value = F.state;

  function onChange(id, key) {
    $('#' + id).addEventListener('input', function () { F[key] = this.value; paintCards(); });
    $('#' + id).addEventListener('change', function () { F[key] = this.value; paintCards(); });
  }
  onChange('fType', 'type'); onChange('fTier', 'tier'); onChange('fTheme', 'theme');
  onChange('fSort', 'sort'); onChange('fState', 'state'); onChange('fQ', 'q');
  paintCards();
}

function filtered() {
  var q = F.q.trim().toLowerCase();
  var list = ENT.filter(function (e) {
    if (F.type !== 'all' && e.type !== F.type) return false;
    if (F.tier !== 'all' && e.tier !== F.tier) return false;
    if (F.theme !== 'all' && e.theme !== F.theme) return false;
    if (F.state === 'new' && isLearned(e.id)) return false;
    if (F.state === 'done' && !isLearned(e.id)) return false;
    if (F.state === 'starter' && !e.starter) return false;
    if (q) {
      var hay = (e.disp + ' ' + (e.cn || '') + ' ' + (e.phone || '') + ' ' + (e.ex || '')).toLowerCase();
      if (hay.indexOf(q) < 0) return false;
    }
    return true;
  });
  var s = F.sort;
  list.sort(function (a, b) {
    if (s === 'az') return a.disp.toLowerCase() < b.disp.toLowerCase() ? -1 : 1;
    if (s === 'time') return (a.first == null ? 1e9 : a.first) - (b.first == null ? 1e9 : b.first);
    return (b.n || 0) - (a.n || 0) || (a.disp < b.disp ? -1 : 1);
  });
  return list;
}

function paintCards() {
  var list = filtered();
  var done = list.filter(function (e) { return isLearned(e.id); }).length;
  $('#cardStats').innerHTML = ''
    + '<div class="stat"><div class="k">筛选结果</div><div class="v">' + list.length + '</div></div>'
    + '<div class="stat"><div class="k">其中已掌握</div><div class="v">' + done + '</div></div>'
    + '<div class="stat"><div class="k">总进度</div><div class="v">' + Math.round(learnedCount() / TOTAL_ENT * 100) + '%</div></div>';

  $('#cardGrid').innerHTML = list.map(function (e) {
    return '<div class="ecard' + (isLearned(e.id) ? ' learned' : '') + '" data-eid="' + e.id + '">'
      + '<div class="top"><span class="w">' + esc(e.disp) + '</span>'
      + '<span class="n">' + (e.n || 0) + '×</span></div>'
      + '<div class="ph">' + esc(e.phone || '') + (e.pos ? '  ' + esc(e.pos) : '') + '</div>'
      + '<div class="cn">' + esc((e.cn || '').slice(0, 80)) + '</div>'
      + '<div class="foot"><span class="tagchip ' + entClass(e) + '">' + tierLabel(e) + '</span>'
      + (e.first != null ? '<span class="muted mono" style="font-size:var(--fs-2xs)">' + fmt(e.first) + '</span>' : '')
      + (isLearned(e.id) ? '<span class="muted" style="font-size:var(--fs-2xs);margin-left:auto">已掌握</span>' : '')
      + '</div></div>';
  }).join('') || '<p class="empty">没有符合条件的词条。</p>';
}

/* ------------------------------------------------------------------ 概念 */
function renderConcepts() {
  var P = $('#conceptsPanel');
  var logic = (D.coreLogic || []).slice();
  var terms = (D.concepts || []).slice();
  if (!terms.length) {
    terms = ENT.filter(function (e) { return e.type === 'concept'; }).map(function (e) {
      return { disp: e.disp, n: e.n || 0, desc: e.cn || e.desc || '', wordId: e.id };
    });
  }
  var heading = logic.length ? '本篇核心逻辑' : terms.length ? '本篇概念术语' : '本篇重点表达';
  var lead = logic.length
    ? '按本篇内容的推理顺序整理关键观点、原因与行动结论。点击卡片查看完整说明。'
    : terms.length
    ? '这些术语帮助梳理本篇内容中的关键观点。点击卡片查看详细释义与相关词条。'
    : '本篇没有单独整理概念术语，先从高频短语和重点表达理解内容。点击卡片可查看释义与例句。';
  var fallback = (!logic.length && !terms.length)
    ? ENT.filter(function (e) { return e.type === 'phrase' && (e.cn || e.disp); })
      .sort(function (a, b) { return (b.n || 0) - (a.n || 0); })
      .slice(0, 8)
      .map(function (e) { return { disp: e.disp, n: e.n || 0, desc: e.cn || '', wordId: e.id }; })
    : [];
  if (!logic.length && !terms.length && !fallback.length) lead = '本篇暂未整理概念术语或重点表达。';

  function cardGrid(list, offset) {
    if (!list.length) return '';
    return '<div class="card-grid concept-grid">' + list.map(function (c, i) {
      return '<div class="ecard" data-cidx="' + (offset + i) + '">'
        + '<div class="top"><span class="w">' + esc(c.disp) + '</span>' + (c.n != null ? '<span class="n">' + c.n + '×</span>' : '') + '</div>'
        + '<div class="cn">' + esc(c.desc) + '</div></div>';
    }).join('') + '</div>';
  }

  var all = logic.concat(terms).concat(fallback);
  P.innerHTML = '<h2>' + heading + '</h2>'
    + '<p class="lead">' + lead + '</p>'
    + cardGrid(logic, 0)
    + (logic.length && terms.length
      ? '<h3 style="margin:26px 0 8px;font-size:var(--fs-lg)">概念术语</h3>'
        + '<p class="lead">本篇反复出现的关键术语。不懂这些词，即使每句都听清也抓不住论证。</p>'
      : '')
    + cardGrid(terms, logic.length)
    + cardGrid(fallback, logic.length + terms.length);

  P.addEventListener('click', function (ev) {
    var card = ev.target.closest('[data-cidx]');
    if (!card) return;
    var c = all[+card.dataset.cidx];
    if (c.wordId != null) openDrawer(c.wordId);
    else drawConcept(c);
  });
}

function drawConcept(c) {
  $('#dwTitle').textContent = c.disp;
  $('#dwPhone').textContent = c.framework ? '核心逻辑拆解' : '概念术语 · 出现 ' + c.n + ' 次';
  $('#dwBody').innerHTML = '<div class="dsec"><div class="k">' + (c.framework ? '推理脉络' : '含义与作用') + '</div><div class="v">' + esc(c.desc) + '</div></div>'
    + (c.framework ? '' : '<div class="dsec"><div class="k">相关词条</div><div class="v muted">该概念在正文中以多个词形出现，'
    + '已在高亮中合并展示。</div></div>');
  $('#drawer').classList.add('open');
  $('#backdrop').classList.add('open');
  drawerOpen = true;
}

/* ------------------------------------------------------------------ 听力 */
function renderListening() {
  var L = D.listening || {};
  var h = '';
  h += '<h2>词汇之外：真正的听力障碍</h2>';
  if (L.lead && L.lead.length) {
    h += '<p class="lead">' + L.lead.map(esc).join(' ') + '</p>';
  }

  h += '<h3 style="margin:18px 0 8px;font-size:var(--fs-lg)">口语填充词与话语标记</h3>';
  if (L.markerLead && L.markerLead.length) {
    h += '<p class="lead">' + L.markerLead.map(esc).join(' ') + '</p>';
  }
  h += '<div class="tablewrap"><table class="data"><thead><tr><th>标记词</th><th class="num">出现</th><th>功能与听觉要点</th></tr></thead><tbody>'
    + (L.markers || []).map(function (m) {
      return '<tr><td><strong>' + esc(m.name) + '</strong></td><td class="num">' + m.n + '</td><td>' + esc(m.note) + '</td></tr>';
    }).join('') + '</tbody></table></div>';

  h += '<h3 style="margin:18px 0 8px;font-size:var(--fs-lg)">连读与弱读：高频听觉陷阱</h3>';
  h += '<div class="tablewrap"><table class="data"><thead><tr><th>书面形式</th><th>实际读音</th><th>说明</th></tr></thead><tbody>'
    + (L.reductions || []).filter(function (r) { return !r.quote; }).map(function (r) {
      return '<tr><td><code>' + esc(r.written) + '</code></td><td class="num">' + esc(r.ipa) + '</td><td>' + esc(r.note) + '</td></tr>';
    }).join('') + '</tbody></table></div>';

  h += '<h3 style="margin:18px 0 8px;font-size:var(--fs-lg)">字幕与转写核对勘误</h3>'
    + (L.errataLead && L.errataLead.length
      ? '<p class="muted" style="margin:0 0 8px">' + L.errataLead.map(esc).join(' ') + '</p>'
      : '<p class="muted" style="margin:0 0 8px">听不清时先核对这张表——有些「生词」其实是字幕识别错了。</p>');
    + '<div class="tablewrap"><table class="data"><thead><tr><th>字幕原文</th><th>实际内容</th><th>说明</th></tr></thead><tbody>'
    + (L.errata || []).map(function (e) {
      return '<tr><td class="mono" style="font-size:var(--fs-2xs)">' + esc(e.asr) + '</td><td><strong>' + esc(e.real) + '</strong></td><td>' + esc(e.note) + '</td></tr>';
    }).join('') + '</tbody></table></div>';

  h += '<h3 style="margin:18px 0 8px;font-size:var(--fs-lg)">语速与信息密度</h3>';
  h += '<ul class="bullets">' + (L.speed || []).map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ul>';

  if (D.plan && D.plan.length) {
    h += '<h3 style="margin:22px 0 8px;font-size:var(--fs-lg)">三阶段学习计划</h3>';
    h += '<div class="tablewrap"><table class="data"><thead><tr><th>阶段</th><th>任务</th><th>检验标准</th></tr></thead><tbody>'
      + D.plan.map(function (p) {
        return '<tr><td><strong>' + esc(p.stage) + '</strong></td><td>' + esc(p.task) + '</td><td>' + esc(p.check) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  if (D.method && D.method.length) {
    h += '<h3 style="margin:22px 0 8px;font-size:var(--fs-lg)">分析口径与收录原则</h3>';
    D.method.forEach(function (m) {
      h += '<div style="margin-bottom:10px"><div style="font-weight:600;font-size:var(--fs-sm);margin-bottom:4px">' + esc(m.h) + '</div>';
      if (m.intro) h += '<p class="muted" style="margin:0 0 5px">' + esc(m.intro) + '</p>';
      if (m.items && m.items.length) {
        h += '<ul class="bullets">' + m.items.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>';
      }
      h += '</div>';
    });
  }

  if (D.appendix && D.appendix.length) {
    h += '<h3 style="margin:22px 0 8px;font-size:var(--fs-lg)">附录：常见但本片<strong>未出现</strong>的表达</h3>'
      + '<p class="muted" style="margin:0 0 8px">以下表达在同类内容里很常见，但经脚本校验，本片中确实没有——不必为它们花时间。</p>'
      + '<div class="tablewrap"><table class="data"><thead><tr><th style="width:34%">表达</th><th>说明</th></tr></thead><tbody>'
      + D.appendix.map(function (a) {
        return '<tr><td class="mono" style="font-size:var(--fs-2xs)">' + esc(a.expr) + '</td><td>' + esc(a.why) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  // 注：原「键盘快捷键」小节已移除。快捷键属于全局功能说明，与每篇资料的
  // 内容分析无关，放在这里会让本面板的边界变得含糊（详见 h2 的定位说明）。

  $('#listeningPanel').innerHTML = h;
}

/* ------------------------------------------------------------------ 自测 */
var QZ = { scope: 'core', type: 'en2cn', size: 10, qs: [], i: 0, right: 0, wrong: [], answered: false, started: false };
var occIndex = null;
function buildOccIndex() {
  if (occIndex) return occIndex;
  occIndex = new Map();
  for (var si = 0; si < MATCHES.length; si++) {
    var m = MATCHES[si];
    for (var k = 0; k < m.length; k++) {
      var id = m[k][0];
      if (!occIndex.has(id)) occIndex.set(id, []);
      if (occIndex.get(id).length < 8) occIndex.get(id).push([si, m[k][1], m[k][2]]);
    }
  }
  return occIndex;
}

function quizPool() {
  var pool = ENT.filter(function (e) { return e.cn && e.cn !== '—'; });
  if (QZ.scope === 'core') pool = pool.filter(function (e) { return e.tier === 'core'; });
  else if (QZ.scope === 'starter') pool = pool.filter(function (e) { return e.starter; });
  else if (QZ.scope === 'new') pool = pool.filter(function (e) { return !isLearned(e.id); });
  else if (QZ.scope === 'wrong') pool = pool.filter(function (e) { return S.wrong[e.id]; });
  if (QZ.type === 'listen' || QZ.type === 'cloze') {
    pool = pool.filter(function (e) { return e.first != null; });
  }
  return pool;
}

function makeQuestion(e, pool, type) {
  var others = shuffle(pool.filter(function (x) { return x.id !== e.id && x.cn !== e.cn; }));
  var same = others.filter(function (x) { return x.type === e.type; });
  var picks = (same.length >= 3 ? same : others).slice(0, 3);
  var q = { eid: e.id, type: type, options: [], answer: 0, e: e };

  if (type === 'en2cn') {
    q.options = shuffle([e.cn].concat(picks.map(function (x) { return x.cn; })));
    q.answer = q.options.indexOf(e.cn);
  } else if (type === 'cn2en' || type === 'listen') {
    q.options = shuffle([e.disp].concat(picks.map(function (x) { return x.disp; })));
    q.answer = q.options.indexOf(e.disp);
  } else if (type === 'cloze') {
    var occ = buildOccIndex().get(e.id) || [];
    if (!occ.length) return null;
    var pick = occ[Math.floor(Math.random() * Math.min(occ.length, 4))];
    q.si = pick[0]; q.a = pick[1]; q.b = pick[2];
    var txt = SENTS[q.si][1];
    q.before = txt.slice(0, q.a); q.after = txt.slice(q.b);
    q.blanks = txt.slice(q.a, q.b);
    q.sec = SENTS[q.si][0];
  }
  return q;
}

function startQuiz() {
  var pool = quizPool();
  if (pool.length < 4) { toast('该范围下的词条不足，换个范围试试'); return; }
  var picks = shuffle(pool.slice()).slice(0, Math.min(QZ.size, pool.length));
  var qs = [];
  picks.forEach(function (e) {
    var type = QZ.type;
    if (type === 'mixed') type = ['en2cn', 'cn2en', 'cloze'][Math.floor(Math.random() * 3)];
    var q = makeQuestion(e, pool, type);
    if (q) qs.push(q);
  });
  if (!qs.length) { toast('无法生成题目，请更换范围或题型'); return; }
  QZ.qs = qs; QZ.i = 0; QZ.right = 0; QZ.wrong = []; QZ.answered = false; QZ.started = true;
  paintQuiz();
}

function paintQuiz() {
  var P = $('#quizPanel');
  if (!QZ.started) {
    var pool = quizPool();
    P.innerHTML = '<div class="quiz-wrap">'
      + '<h2>自测</h2>'
      + '<p class="lead">四种题型：英→中、中→英、听音辨词、逐字稿挖空。答对两次会自动标记为「已掌握」，'
      + '全程记录存于本机浏览器，不需要联网（听音与挖空题需要播放器可用）。</p>'
      + '<div class="quiz-card"><div class="toolbar" style="margin:0;border:0;padding:0;background:none">'
      + '<div class="field"><label>范围</label><select id="qScope">'
      + '<option value="core">核心词（≥3 次）</option><option value="starter">首轮 40 词</option>'
      + '<option value="all">全部词条</option><option value="new">仅未掌握</option>'
      + '<option value="wrong">仅错题（' + Object.keys(S.wrong).length + '）</option></select></div>'
      + '<div class="field"><label>题型</label><select id="qType">'
      + '<option value="en2cn">英 → 中</option><option value="cn2en">中 → 英</option>'
      + '<option value="listen">听音辨词</option><option value="cloze">逐字稿挖空</option>'
      + '<option value="mixed">混合</option></select></div>'
      + '<div class="field"><label>题量</label><select id="qSize">'
      + '<option value="10">10 题</option><option value="20">20 题</option><option value="30">30 题</option></select></div>'
      + '</div>'
      + '<div class="stat-row" style="margin:16px 0 0">'
      + '<div class="stat"><div class="k">该范围可用</div><div class="v">' + pool.length + '</div></div>'
      + '<div class="stat"><div class="k">累计答题</div><div class="v">' + (S.stats.a || 0) + '</div></div>'
      + '<div class="stat"><div class="k">累计正确率</div><div class="v">'
      + (S.stats.a ? Math.round(S.stats.c / S.stats.a * 100) + '%' : '—') + '</div></div>'
      + '</div>'
      + '<div style="margin-top:20px;display:flex;gap:8px">'
      + '<button class="primary" id="qStart">开始测试</button>'
      + '<button id="qReset">清空学习记录</button></div>'
      + '</div></div>';
    $('#qScope').value = QZ.scope; $('#qType').value = QZ.type; $('#qSize').value = String(QZ.size);
    $('#qScope').onchange = function () { QZ.scope = this.value; paintQuiz(); };
    $('#qType').onchange = function () { QZ.type = this.value; };
    $('#qSize').onchange = function () { QZ.size = +this.value; };
    $('#qStart').onclick = startQuiz;
    $('#qReset').onclick = function () {
      if (!confirm('将清空已掌握标记、错题记录与答题统计，确定吗？')) return;
      S.learned = {}; S.score = {}; S.wrong = {}; S.stats = { a: 0, c: 0 };
      save(); syncProgress(); paintQuiz(); toast('已清空学习记录');
    };
    return;
  }

  if (QZ.i >= QZ.qs.length) { paintQuizResult(); return; }

  var q = QZ.qs[QZ.i], e = q.e;
  var head = '<div class="quiz-wrap"><div class="quiz-card">'
    + '<div class="quiz-step"><span>第 ' + (QZ.i + 1) + ' / ' + QZ.qs.length + ' 题</span>'
    + '<span class="bar"><i style="width:' + (QZ.i / QZ.qs.length * 100) + '%"></i></span>'
    + '<span>答对 ' + QZ.right + '</span></div>';

  var body = '';
  if (q.type === 'en2cn') {
    body = '<div class="quiz-prompt">选出正确的中文释义</div>'
      + '<p class="quiz-q">' + esc(e.disp) + '</p>'
      + '<div class="quiz-sub">' + esc(e.phone || '') + (e.pos ? ' ' + esc(e.pos) : '') + '</div>'
      + '<div class="opts">' + q.options.map(function (o, i) {
        return '<button class="opt" data-opt="' + i + '">' + esc(o) + '</button>';
      }).join('') + '</div>';
  } else if (q.type === 'cn2en') {
    body = '<div class="quiz-prompt">选出对应的英文词条</div>'
      + '<p class="quiz-q small">' + esc(e.cn) + '</p>'
      + '<div class="quiz-sub">' + tierLabel(e) + ' · 出现 ' + (e.n || 0) + ' 次</div>'
      + '<div class="opts">' + q.options.map(function (o, i) {
        return '<button class="opt" data-opt="' + i + '">' + esc(o) + '</button>';
      }).join('') + '</div>';
  } else if (q.type === 'listen') {
    body = '<div class="quiz-prompt">播放视频片段，选出你听到的词</div>'
      + '<p class="quiz-q small muted" style="font-size:var(--fs-sm)">点击下方按钮播放（约 3 秒片段）</p>'
      + '<div style="margin:12px 0 18px"><button id="qPlay" class="primary">▶ 播放片段</button>'
      + '<span class="muted" style="margin-left:10px">可反复重听</span></div>'
      + '<div class="opts">' + q.options.map(function (o, i) {
        return '<button class="opt" data-opt="' + i + '">' + esc(o) + '</button>';
      }).join('') + '</div>';
  } else if (q.type === 'cloze') {
    body = '<div class="quiz-prompt">听写填空：补全下面这句话中被挖掉的词</div>'
      + '<p class="quiz-q serif" style="font-size:var(--fs-lg)">' + esc(q.before) + '<span style="color:var(--accent)">'
      + '_'.repeat(Math.max(4, Math.min(14, q.blanks.length))) + '</span>' + esc(q.after) + '</p>'
      + '<div class="quiz-sub">' + fmt(q.sec) + '</div>'
      + '<div style="margin:12px 0 6px"><button id="qPlay" class="primary">▶ 播放本句</button></div>'
      + '<div class="cloze-input"><input type="text" id="qInput" placeholder="输入你听到的词" autocomplete="off" spellcheck="false">'
      + '<button class="primary" id="qSubmit">提交</button></div>';
  }

  P.innerHTML = head + body + '<div id="qFb"></div></div></div>';

  if (q.type === 'listen') $('#qPlay').onclick = function () { seek(Math.max(0, e.first - 0.4)); };
  if (q.type === 'cloze') {
    $('#qPlay').onclick = function () { seek(q.sec); };
    $('#qInput').focus();
    $('#qInput').onkeydown = function (ev) { if (ev.key === 'Enter') submitCloze(); };
    $('#qSubmit').onclick = submitCloze;
  }
  P.querySelectorAll('.opt').forEach(function (b) {
    b.onclick = function () { answer(+b.dataset.opt); };
  });
}

function submitCloze() {
  if (QZ.answered) return;
  var q = QZ.qs[QZ.i];
  var v = ($('#qInput').value || '').trim().toLowerCase().replace(/[^a-z'\- ]/g, '');
  var target = q.blanks.toLowerCase().trim();
  var ok = v === target || (target.indexOf(v) === 0 && v.length >= Math.max(3, target.length - 3));
  answer(ok ? q.answer : -1, target);
}

function answer(pick, clozeTarget) {
  if (QZ.answered) return;
  QZ.answered = true;
  var q = QZ.qs[QZ.i], e = q.e;
  var ok = (q.type === 'cloze') ? (pick !== -1) : (pick === q.answer);
  S.stats.a = (S.stats.a || 0) + 1;

  if (ok) {
    S.stats.c = (S.stats.c || 0) + 1;
    QZ.right++;
    S.score[e.id] = (S.score[e.id] || 0) + 1;
    delete S.wrong[e.id];
    if (S.score[e.id] >= 2 && !isLearned(e.id)) { S.learned[e.id] = 1; }
  } else {
    S.wrong[e.id] = (S.wrong[e.id] || 0) + 1;
    S.score[e.id] = 0;
    QZ.wrong.push(e.id);
  }
  save(); syncProgress();

  if (q.type !== 'cloze') {
    document.querySelectorAll('.opt').forEach(function (b, i) {
      b.disabled = true;
      if (i === q.answer) b.classList.add('right');
      if (i === pick && !ok) b.classList.add('wrong');
    });
  } else {
    var inp = $('#qInput');
    if (inp) { inp.disabled = true; inp.style.borderColor = ok ? 'var(--ok)' : 'var(--bad)'; }
    if ($('#qSubmit')) $('#qSubmit').disabled = true;
  }
  if (q.type === 'listen') { /* 保持音频可继续听 */ }

  var fb = $('#qFb');
  fb.innerHTML = '<div class="quiz-fb ' + (ok ? 'ok' : 'no') + '">'
    + (ok ? '正确' : '错误，正确答案：<strong>' + esc(q.type === 'cloze' ? q.blanks : (q.type === 'en2cn' ? e.cn : e.disp)) + '</strong>')
    + '<div style="margin-top:6px;font-size:var(--fs-sm)">'
    + '<strong>' + esc(e.disp) + '</strong> ' + (e.phone ? '<span class="mono">/' + esc(e.phone) + '/</span> ' : '')
    + (e.pos ? esc(e.pos) + ' ' : '') + esc(e.cn || '')
    + '</div>'
    + (e.ex ? '<div class="ex">' + (e.exSec != null ? '[' + fmt(e.exSec) + '] ' : '') + esc(e.ex) + '</div>' : '')
    + '<div style="margin-top:10px;display:flex;gap:8px">'
    + (e.first != null ? '<button data-act="play" data-sec="' + e.first + '">播放首次出现</button>' : '')
    + '<button data-act="open" data-eid="' + e.id + '">查看详情</button>'
    + '<button class="primary" id="qNext">' + (QZ.i + 1 >= QZ.qs.length ? '查看结果' : '下一题') + '</button>'
    + '</div></div>';
  $('#qNext').onclick = function () { QZ.i++; QZ.answered = false; paintQuiz(); };
  $('#qNext').focus();
}

function paintQuizResult() {
  var rate = QZ.qs.length ? Math.round(QZ.right / QZ.qs.length * 100) : 0;
  var wrongEnts = [...new Set(QZ.wrong)].map(function (id) { return byId.get(id); }).filter(Boolean);
  $('#quizPanel').innerHTML = '<div class="quiz-wrap"><div class="quiz-card center">'
    + '<div class="quiz-prompt">本轮完成</div>'
    + '<div class="big-num">' + rate + '%</div>'
    + '<p class="muted" style="margin:6px 0 18px">' + QZ.qs.length + ' 题中答对 ' + QZ.right + ' 题</p>'
    + '<div class="stat-row" style="justify-content:center">'
    + '<div class="stat"><div class="k">已掌握词条</div><div class="v">' + learnedCount() + ' / ' + TOTAL_ENT + '</div></div>'
    + '<div class="stat"><div class="k">累计正确率</div><div class="v">'
    + (S.stats.a ? Math.round(S.stats.c / S.stats.a * 100) + '%' : '—') + '</div></div>'
    + '</div>'
    + (wrongEnts.length
      ? '<div style="text-align:left;margin-top:20px"><div class="quiz-prompt">本轮错题（' + wrongEnts.length + '）</div>'
      + '<div class="chips" style="margin-top:6px">' + wrongEnts.map(function (e) {
        return '<button data-act="open" data-eid="' + e.id + '">' + esc(e.disp) + '</button>';
      }).join('') + '</div></div>'
      : '<p class="muted" style="margin-top:16px">全部答对。</p>')
    + '<div style="margin-top:24px;display:flex;gap:8px;justify-content:center">'
    + (wrongEnts.length ? '<button class="primary" id="qRedo">重做错题</button>' : '')
    + '<button id="qAgain">再来一轮</button>'
    + '<button id="qBack">返回设置</button></div>'
    + '</div></div>';
  if ($('#qRedo')) $('#qRedo').onclick = function () {
    QZ.scope = 'wrong'; QZ.started = false; startQuiz();
  };
  $('#qAgain').onclick = startQuiz;
  $('#qBack').onclick = function () { QZ.started = false; paintQuiz(); };
}

/* ------------------------------------------------------------------ 侧栏宽度与折叠 */
var NAV_MIN = 200, NAV_MAX = 460, NAV_DEF = 276;

function applyNav() {
  var reader = document.querySelector('.reader');
  if (!reader) return;
  var collapsed = !!S.navCollapsed;
  reader.classList.toggle('nav-collapsed', collapsed);
  if (!collapsed) {
    var w = Math.max(NAV_MIN, Math.min(NAV_MAX, S.navW || NAV_DEF));
    document.documentElement.style.setProperty('--nav-w', w + 'px');
  }
  var ex = $('#navExpand'); if (ex) ex.hidden = !collapsed;
  var co = $('#navCollapse'); if (co) co.hidden = collapsed;
}

(function wireNav() {
  var resizer = $('#navResizer'), reader = document.querySelector('.col-nav');
  if (!resizer || !reader) return;
  var dragging = false, startX = 0, startW = 0;
  resizer.addEventListener('mousedown', function (e) {
    dragging = true; startX = e.clientX;
    startW = reader.getBoundingClientRect().width;
    resizer.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  });
  document.addEventListener('mousemove', function (e) {
    if (!dragging) return;
    var w = Math.max(NAV_MIN, Math.min(NAV_MAX, startW + e.clientX - startX));
    S.navW = w;
    document.documentElement.style.setProperty('--nav-w', w + 'px');
  });
  document.addEventListener('mouseup', function () {
    if (!dragging) return;
    dragging = false;
    resizer.classList.remove('dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    save();
  });
  resizer.addEventListener('dblclick', function () {
    S.navW = NAV_DEF; save(); applyNav();
  });
  var co = $('#navCollapse'), ex = $('#navExpand');
  if (co) co.addEventListener('click', function () { S.navCollapsed = true; save(); applyNav(); });
  if (ex) ex.addEventListener('click', function () { S.navCollapsed = false; save(); applyNav(); });
})();

/* ------------------------------------------------------------------ 事件绑定 */
document.addEventListener('click', function (ev) {
  var t = ev.target;

  var tab = t.closest && t.closest('#tabs button');
  if (tab) {
    S.mode = tab.dataset.mode; save();
    document.querySelectorAll('#tabs button').forEach(function (b) { b.classList.toggle('active', b === tab); });
    document.querySelectorAll('.mode').forEach(function (m) {
      var on = m.id === 'mode-' + S.mode;
      m.classList.toggle('active', on);
      if (on) { var p = m.querySelector('.panel'); if (p) p.scrollTop = 0; }
    });
    if (S.mode === 'cards') paintCards();
    if (S.mode === 'quiz' && !QZ.started) paintQuiz();
    return;
  }

  var ch = t.closest && t.closest('#chapterList li[data-ch]');
  if (ch) { gotoChapter(+ch.dataset.ch); return; }

  var mc = t.closest && t.closest('mark.hi');
  if (mc && !t.closest('.loop-btn')) { openDrawer(+mc.dataset.eid); return; }

  var lb = t.closest && t.closest('.loop-btn');
  if (lb) {
    ev.stopPropagation();
    var si = +lb.dataset.loop;
    playRange(SENTS[si][0], sentenceEnd(si), Infinity);
    return;
  }

  /* 「译」按钮：切换本句中文翻译的显隐；再点一次收起 */
  var tb = t.closest && t.closest('.tr-btn');
  if (tb) {
    ev.stopPropagation();
    var host = tb.closest('.sent');
    var cnEl = host && host.querySelector('.sent-cn');
    if (cnEl) {
      var show = cnEl.hidden;
      cnEl.hidden = !show;
      tb.classList.toggle('on', show);
    }
    return;
  }

  var sent = t.closest && t.closest('.sent');
  if (sent) {
    var i = +sent.dataset.si;
    seek(SENTS[i][0]);
    setActive(i, false);
    $('#dockTitle').textContent = fmt(SENTS[i][0]) + ' · ' + SENTS[i][1].slice(0, 52);
    return;
  }

  var wc = t.closest && t.closest('.wcard, .ecard[data-eid]');
  if (wc && wc.dataset.eid) { openDrawer(+wc.dataset.eid); return; }

  var act = t.closest && t.closest('[data-act]');
  if (act) {
    var a = act.dataset.act;
    if (a === 'play') { seek(+act.dataset.sec); }
    else if (a === 'open') { openDrawer(+act.dataset.eid); }
    else if (a === 'retry-yt') { retryYouTube(); }
    else if (a === 'pick-local') { closeDrawer(); pickLocalFile(); }
    else if (a === 'open-yt') { closeDrawer(); window.open(ITEM_SOURCE_URL || D.meta.url, '_blank'); }
    else if (a === 'copy') {
      var item = ENT.find(function (x) { return x.disp === $('#dwTitle').textContent; });
      if (item) {
        var line = item.disp + '\t/' + (item.phone || '') + '/\t' + (item.pos || '') + '\t' + (item.cn || '')
          + (item.ex ? '\n' + item.ex : '');
        try { navigator.clipboard.writeText(line); toast('已复制到剪贴板'); } catch (err) { toast('复制失败'); }
      }
    }
    else if (a === 'toggle-learn') {
      var title = $('#dwTitle').textContent;
      var it = ENT.find(function (x) { return x.disp === title; });
      if (it) {
        markLearned(it.id, !isLearned(it.id));
        toast(isLearned(it.id) ? '已标记为掌握' : '已取消掌握标记');
        openDrawer(it.id);
        if (S.mode === 'read') renderTranscript();
        if (S.mode === 'cards') paintCards();
      }
    }
    return;
  }

  if (t.closest && (t.closest('#backdrop') || t.closest('#dwClose'))) closeDrawer();
});

$('#chSearch').addEventListener('input', function () { chapterFilter = this.value; renderChapters(); });
$('#onlyHi').addEventListener('change', renderTranscript);
$('#themeBtn').addEventListener('click', function () {
  S.theme = S.theme === 'dark' ? 'light' : 'dark';
  applyTheme(); toast(S.theme === 'dark' ? '已切换到深色主题' : '已切换到浅色主题');
});
$('#btnPlay').addEventListener('click', function () {
  if (!yt.ready) {
    if (PL.backend === 'yt' && PL.ytPhase === 'failed') { toast('当前音源不可用，可切到「本地音源」或点「播放器诊断」'); }
    else toast('播放器未就绪，请稍候');
    return;
  }
  var st = yt.player.getPlayerState();
  if (st === 1) yt.player.pauseVideo(); else yt.player.playVideo();
});
$('#btnPrev').addEventListener('click', function () { stepSentence(-1); });
$('#btnNext').addEventListener('click', function () { stepSentence(1); });
$('#btnLoop').addEventListener('click', function () {
  var si = yt.active >= 0 ? yt.active : CHS[S.chapter].sentStart;
  playRange(SENTS[si][0], sentenceEnd(si), Infinity);
  toast('循环 ' + fmt(SENTS[si][0]) + ' 起的一句');
});
$('#btnRepeat').addEventListener('click', function () {
  var si = yt.active >= 0 ? yt.active : CHS[S.chapter].sentStart;
  playRange(SENTS[si][0], sentenceEnd(si), 3);
  toast('重复 3 次');
});
$('#btnOpen').addEventListener('click', function () {
  var sec = yt.active >= 0 ? SENTS[yt.active][0] : CHS[S.chapter].sec;
  var source = ITEM_SOURCE_URL || D.meta.url;
  window.open(source + (source.indexOf('?') >= 0 ? '&' : '?') + 't=' + Math.floor(sec) + 's', '_blank');
});
$('#btnDiag').addEventListener('click', openDiag);
$('#noticeX').addEventListener('click', function () { $('#notice').hidden = true; });
$('#srcGroup').addEventListener('click', function (ev) {
  var b = ev.target.closest('button[data-src]');
  if (!b) return;
  useBackend(b.dataset.src);
});
$('#btnPick').addEventListener('click', pickLocalFile);
$('#rateGroup').addEventListener('click', function (ev) {
  var b = ev.target.closest('button[data-rate]');
  if (!b) return;
  S.rate = +b.dataset.rate; save();
  this.querySelectorAll('button').forEach(function (x) { x.classList.toggle('active', x === b); });
  if (yt.ready && yt.player.setPlaybackRate) yt.player.setPlaybackRate(S.rate);
  toast('播放速度 ' + S.rate + '×');
});

function stepSentence(d) {
  var base = yt.active >= 0 ? yt.active : CHS[S.chapter].sentStart - 1;
  var idx = Math.max(0, Math.min(SENTS.length - 1, base + d));
  var ci = CHS.findIndex(function (c, i) {
    return idx >= c.sentStart && (i + 1 >= CHS.length || idx < CHS[i + 1].sentStart);
  });
  if (ci >= 0 && ci !== S.chapter) gotoChapter(ci, false);
  seek(SENTS[idx][0]);
  setActive(idx, true);
  $('#dockTitle').textContent = fmt(SENTS[idx][0]) + ' · ' + SENTS[idx][1].slice(0, 52);
}

document.addEventListener('keydown', function (ev) {
  if (ev.target.matches('input, select, textarea')) return;
  var k = ev.key.toLowerCase();
  if (k === 'escape') { closeDrawer(); return; }
  if (S.mode !== 'read') return;
  if (ev.code === 'Space') { ev.preventDefault(); $('#btnPlay').click(); }
  else if (ev.key === 'ArrowLeft') { ev.preventDefault(); stepSentence(-1); }
  else if (ev.key === 'ArrowRight') { ev.preventDefault(); stepSentence(1); }
  else if (k === 'l') { $('#btnLoop').click(); }
  else if (k === 'r') { $('#btnRepeat').click(); }
  else if (k === 'n') { gotoChapter(S.chapter + 1, true); }
  else if (k === 'p') { gotoChapter(S.chapter - 1, true); }
});

/* ------------------------------------------------------------------ 启动 */
/* 播放条高度随内容自适应，同时把实测高度回写到 --dock-h，
   这样 toast / 抽屉 / 提示气泡的偏移量始终按真实高度计算，不会被播放条压住 */
function syncDockHeight() {
  var d = document.querySelector('.dock');
  if (!d) return;
  var h = Math.ceil(d.getBoundingClientRect().height);
  if (h) document.documentElement.style.setProperty('--dock-h', h + 'px');
}
window.addEventListener('resize', syncDockHeight);

function boot() {
  applyTheme();
  document.title = D.meta.title + ' — 学习台';
  $('#brandTitle').textContent = D.meta.title;
  $('#brandSub').textContent = [D.meta.guest || D.meta.channel, D.meta.sentenceCount + ' 句',
    D.meta.chapterCount + ' 章', '构建于 ' + D.meta.builtAt].filter(Boolean).join(' · ');
  $('#dockTotal').textContent = D.meta.durationText;
  $('#rateGroup').querySelectorAll('button').forEach(function (b) {
    b.classList.toggle('active', +b.dataset.rate === S.rate);
  });
  syncProgress();
  paintSrc();

  if (location.protocol === 'file:') {
    showNotice('当前以 <code>file://</code> 打开，本地 Markdown 资料库和 YouTube 播放器需要本地服务。'
      + '请在项目目录执行 <code>python3 serve.py</code>，然后访问 <code>http://127.0.0.1:8777/</code>。');
  }

  S.chapter = Math.max(0, Math.min(CHS.length - 1, S.chapter || 0));
  applyNav();
  renderChapters();
  renderTranscript();
  renderCards();
  renderConcepts();
  renderListening();
  paintQuiz();

  var m = document.querySelector('#tabs button[data-mode="' + S.mode + '"]');
  if (m) { m.classList.add('active'); }
  document.querySelectorAll('#tabs button').forEach(function (b) {
    b.classList.toggle('active', b.dataset.mode === S.mode);
  });
  document.querySelectorAll('.mode').forEach(function (x) {
    x.classList.toggle('active', x.id === 'mode-' + S.mode);
  });

  // 本地服务下加载当前资料配置的本地媒体
  try { autoFindLocalSource(); } catch (e) {}
  syncDockHeight();
}

restoreMarkdownProgress().then(boot);
})();
