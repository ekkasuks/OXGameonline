/* =====================================================================
 * student.js — ตรรกะฝั่งนักเรียน (ลงทะเบียน / ห้องรอ / เล่นเกม)
 * ===================================================================*/
const LS_KEY = 'ox_student';
let ME = null;               // { studentId, token, fullName }
let VIEW = 'register';       // register | lobby | game
let pollTimer = null;
let curMatchId = null;
let lastBoard = null;
let busy = false;            // กันกดซ้ำระหว่างส่ง move
let resultShownFor = null;   // กัน overlay เด้งซ้ำ
let myMark = 'X';            // เครื่องหมายของเรา (ใช้ตอน optimistic)
let gameWaiting = false;     // true = กำลังรอคู่แข่ง -> poll ถี่ขึ้น

const $ = id => document.getElementById(id);

/* ---------- offline indicator ---------- */
Net.onStatusChange(online => {
  $('offlineBar').classList.toggle('show', !online);
});

/* ---------- init ---------- */
window.addEventListener('DOMContentLoaded', () => {
  const saved = localStorage.getItem(LS_KEY);
  if (saved) {
    try { ME = JSON.parse(saved); } catch (e) { ME = null; }
  }
  bindRegister();
  $('btnNext').addEventListener('click', () => {
    hideResult();
    curMatchId = null; resultShownFor = null;
  });

  if (ME) { goView('lobby'); startLobbyPoll(); }
  else { goView('register'); checkRegStatus(); }
});

function goView(v) {
  VIEW = v;
  $('view-register').classList.toggle('hide', v !== 'register');
  $('view-lobby').classList.toggle('hide', v !== 'lobby');
  $('view-game').classList.toggle('hide', v !== 'game');
  $('topRight').innerHTML = ME
    ? `<button class="btn ghost sm" onclick="logout()">ออกจากระบบ</button>` : '';
}

function logout() {
  if (!confirm('ออกจากระบบ? ข้อมูลการแข่งขันของคุณยังอยู่ แต่ต้องใช้ชื่อเดิมเข้าใหม่')) return;
  localStorage.removeItem(LS_KEY);
  location.reload();
}

/* ===================================================================
 * ลงทะเบียน
 * ===================================================================*/
async function checkRegStatus() {
  try {
    const r = await Net.call('getPublicStatus');
    if (r.ok) {
      if (r.tournamentStatus !== 'registration') {
        $('regStatus').className = 'msg err';
        $('regStatus').textContent = 'การแข่งขันเริ่มไปแล้ว ไม่สามารถลงทะเบียนได้';
        $('btnRegister').disabled = true;
      } else if (!r.registrationOpen) {
        $('regStatus').className = 'msg err';
        $('regStatus').textContent = 'ครูปิดรับลงทะเบียนชั่วคราว';
        $('btnRegister').disabled = true;
      } else {
        $('regStatus').className = 'msg ok';
        $('regStatus').textContent = `เปิดรับลงทะเบียน · ขณะนี้มีผู้ลงทะเบียน ${r.totalStudents} คน`;
        $('btnRegister').disabled = false;
      }
    }
  } catch (e) {
    $('regStatus').className = 'msg err';
    $('regStatus').textContent = 'เชื่อมต่อ server ไม่ได้ ตรวจสอบ API_URL / อินเทอร์เน็ต';
  }
}

function bindRegister() {
  $('btnRegister').addEventListener('click', doRegister);
  $('regName').addEventListener('keydown', e => { if (e.key === 'Enter') doRegister(); });
}

async function doRegister() {
  const name = $('regName').value.trim();
  const room = $('regRoom').value.trim();
  if (name.length < 2) { showReg('err', 'กรุณากรอกชื่อ-นามสกุล'); return; }
  $('btnRegister').disabled = true;
  showReg('info', 'กำลังลงทะเบียน…');
  try {
    const r = await Net.call('register', { fullName: name, classRoom: room });
    if (!r.ok) { showReg('err', r.error); $('btnRegister').disabled = false; return; }
    ME = { studentId: r.studentId, token: r.token, fullName: r.fullName };
    localStorage.setItem(LS_KEY, JSON.stringify(ME));
    goView('lobby');
    startLobbyPoll();
  } catch (e) {
    showReg('err', 'เชื่อมต่อไม่สำเร็จ ลองใหม่อีกครั้ง');
    $('btnRegister').disabled = false;
  }
}
function showReg(type, msg) { $('regMsg').innerHTML = `<div class="msg ${type}">${esc(msg)}</div>`; }

/* ===================================================================
 * ห้องรอ — poll สถานะ, เมื่อมีแมตช์ปัจจุบันให้เข้าเกม
 * ===================================================================*/
function startLobbyPoll() {
  stopPoll();
  pollLobby();
  pollTimer = setInterval(pollLobby, CONFIG.POLL_LOBBY);
}

async function pollLobby() {
  if (!ME) return;
  try {
    const r = await Net.call('getLobby', ME);
    if (!r.ok) {
      if (r.error && r.error.indexOf('ยืนยัน') >= 0) { badSession(); }
      return;
    }
    $('lobbyName').textContent = r.fullName;
    $('sTotal').textContent = r.totalMatches;
    $('sPlayed').textContent = r.playedMatches;
    $('sRemain').textContent = r.remainingMatches;
    $('sPoints').textContent = r.points;
    $('sStudents').textContent = r.totalStudents;
    $('lobbyStatus').innerHTML = lobbyStatusHtml(r);

    if (r.currentMatchId) { enterGame(r.currentMatchId); }
  } catch (e) { /* offline handled by Net */ }
}

function lobbyStatusHtml(r) {
  const map = {
    registration: ['badge blue', 'รอครูเริ่มการแข่งขัน'],
    running: ['badge green', 'กำลังแข่งขัน'],
    paused: ['badge orange', 'หยุดชั่วคราว'],
    finished: ['badge gray', 'การแข่งขันจบแล้ว'],
    cancelled: ['badge red', 'ยกเลิกการแข่งขัน']
  };
  const m = map[r.tournamentStatus] || ['badge gray', r.tournamentStatus];
  let extra = '';
  if (r.tournamentStatus === 'running') extra = ` · รอบที่ ${r.currentRound}`;
  if (r.tournamentStatus === 'finished') extra = ' 🎉 ดูอันดับที่หน้าครู';
  return `<span class="${m[0]}">${m[1]}</span>${extra}
    <div style="margin-top:8px;color:var(--muted)">
      ${r.tournamentStatus === 'running' && !r.currentMatchId
        ? 'รอบนี้คุณยังไม่มีคู่ หรือเล่นครบแล้ว — รอครูเดินรอบถัดไป'
        : 'โปรดรอสักครู่…'}
    </div>`;
}

function badSession() {
  stopPoll();
  localStorage.removeItem(LS_KEY);
  alert('ไม่พบข้อมูลนักเรียนของคุณ (ครูอาจรีเซ็ตการแข่งขัน) — กรุณาลงทะเบียนใหม่');
  location.reload();
}

/* ===================================================================
 * เล่นเกม
 * ===================================================================*/
function enterGame(matchId) {
  if (VIEW === 'game' && curMatchId === matchId) return;
  curMatchId = matchId;
  lastBoard = null;
  goView('game');
  startGamePoll();
}

function startGamePoll() {
  stopPoll();
  pollGameLoop();
}
// วนด้วย setTimeout เพื่อปรับความถี่ได้ตามสถานการณ์ (รอคู่แข่ง = ถี่ขึ้น)
async function pollGameLoop() {
  if (VIEW !== 'game' || !curMatchId) return;
  await pollGame();
  if (VIEW !== 'game' || !curMatchId) return;
  const delay = gameWaiting ? (CONFIG.POLL_GAME_WAIT || 900) : CONFIG.POLL_GAME;
  pollTimer = setTimeout(pollGameLoop, delay);
}

async function pollGame() {
  if (!ME || !curMatchId) return;
  try {
    const r = await Net.call('getMatchState', { studentId: ME.studentId, token: ME.token, matchId: curMatchId });
    if (!r.ok) {
      if (r.error && r.error.indexOf('ยืนยัน') >= 0) badSession();
      return;
    }
    renderMatch(r.match);
  } catch (e) { /* offline */ }
}

function renderMatch(m) {
  myMark = m.myMark;
  gameWaiting = (m.status === 'in_progress' && !m.myTurn);
  $('gRound').textContent = m.round;
  $('gMyMark').textContent = m.myMark;
  $('nameX').textContent = m.player1Name;
  $('nameO').textContent = m.player2Name;

  // ไฮไลต์ว่าตาใคร
  const xActive = (m.board.split('').filter(c => c !== '_').length % 2 === 0);
  $('chipX').classList.toggle('active', xActive && m.status === 'in_progress');
  $('chipO').classList.toggle('active', !xActive && m.status === 'in_progress');

  if (m.status === 'in_progress') {
    if (m.myTurn) {
      $('turnBanner').className = 'turn-banner mine';
      $('turnBanner').textContent = '🟢 ตาของคุณ! คลิกช่องที่ต้องการ';
    } else {
      $('turnBanner').className = 'turn-banner theirs';
      $('turnBanner').textContent = m.isAI ? '🤖 บอทกำลังคิด…' : '⏳ รอคู่แข่งเดิน…';
    }
  }
  drawBoard(m);

  // แสดงผลเมื่อจบ
  if (m.status === 'finished' && resultShownFor !== m.matchId) {
    resultShownFor = m.matchId;
    showResult(m);
  }
}

function drawBoard(m) {
  const board = $('board');
  const myTurnNow = m.myTurn && m.status === 'in_progress';
  board.classList.toggle('locked', !myTurnNow);
  const cells = m.board.split('');
  // สร้างใหม่เฉพาะเมื่อ layout ยังไม่มี
  if (board.children.length !== 9) {
    board.innerHTML = '';
    for (let i = 0; i < 9; i++) {
      const d = document.createElement('div');
      d.className = 'cell';
      d.dataset.i = i;
      d.addEventListener('click', () => onCellClick(i));
      board.appendChild(d);
    }
  }
  for (let i = 0; i < 9; i++) {
    const d = board.children[i];
    const v = cells[i];
    d.classList.toggle('filled', v !== '_');
    d.classList.toggle('x', v === 'X');
    d.classList.toggle('o', v === 'O');
    d.textContent = v === 'X' ? '✕' : v === 'O' ? '◯' : '';
    d.classList.toggle('disabled', v !== '_' || !myTurnNow);
  }
  lastBoard = m.board;
}

async function onCellClick(i) {
  if (busy || !curMatchId) return;
  const cells = (lastBoard || '').split('');
  if (cells[i] !== '_') return;
  busy = true;

  // 🚀 Optimistic UI: แสดงหมากของเราทันที ไม่ต้องรอ server
  optimisticPlace(i, myMark);
  playMoveSound();

  try {
    const r = await Net.call('makeMove', {
      studentId: ME.studentId, token: ME.token, matchId: curMatchId, cellIndex: i
    });
    if (!r.ok) {
      if (r.error && r.error.indexOf('ยืนยัน') >= 0) { badSession(); return; }
      // ส่งไม่สำเร็จ -> ดึงสถานะจริงกลับมา (ย้อนหมากที่แสดงไว้)
      beep(220, .12);
      await pollGame();
    } else {
      renderMatch(r.match); // ผลจาก server คือความจริงเสมอ
    }
  } catch (e) {
    await pollGame(); // ออฟไลน์ -> ซิงก์ใหม่เมื่อกลับมา
  } finally { busy = false; }
}

// วางหมากของเราบนจอทันที (ยืนยันจริงด้วย renderMatch ภายหลัง)
function optimisticPlace(i, mark) {
  const board = $('board');
  if (board.children.length === 9) {
    const d = board.children[i];
    d.classList.add('filled', 'disabled', mark === 'X' ? 'x' : 'o');
    d.textContent = mark === 'X' ? '✕' : '◯';
  }
  const arr = (lastBoard || '_________').split('');
  arr[i] = mark; lastBoard = arr.join('');
  board.classList.add('locked');
  gameWaiting = true; // หลังเราเดิน = รออีกฝ่าย -> poll ถี่ขึ้น
  $('turnBanner').className = 'turn-banner theirs';
  $('turnBanner').textContent = '⏳ กำลังส่ง…';
}

/* ---------- ผลการแข่งขัน + เสียง/อนิเมชัน ---------- */
function showResult(m) {
  highlightWinLine(m.board);
  const o = $('resultOverlay');
  if (m.result === 'win') {
    $('rEmoji').textContent = '🏆'; $('rTitle').textContent = 'คุณชนะ!';
    $('rTitle').className = 'result-title win'; victoryFanfare();
  } else if (m.result === 'lose') {
    $('rEmoji').textContent = '😢'; $('rTitle').textContent = 'คุณแพ้';
    $('rTitle').className = 'result-title lose'; beep(180, .3);
  } else {
    $('rEmoji').textContent = '🤝'; $('rTitle').textContent = 'เสมอ';
    $('rTitle').className = 'result-title draw'; beep(330, .2);
  }
  $('rPoints').textContent = `ได้รับ ${m.myScore} คะแนน`;
  o.classList.add('show');
}
function hideResult() {
  $('resultOverlay').classList.remove('show');
  // กลับห้องรอเพื่อรอรอบถัดไป
  goView('lobby');
  startLobbyPoll();
}

function highlightWinLine(boardStr) {
  const b = boardStr.split('');
  const lines = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
  for (const L of lines) {
    if (b[L[0]] !== '_' && b[L[0]] === b[L[1]] && b[L[1]] === b[L[2]]) {
      const board = $('board');
      if (board.children.length === 9) L.forEach(i => board.children[i].classList.add('win'));
      return;
    }
  }
}

/* ---------- เสียง (Web Audio) ---------- */
let audioCtx = null;
function ctx() { if (!audioCtx) { try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} } return audioCtx; }
function beep(freq, dur, type = 'sine') {
  const c = ctx(); if (!c) return;
  const osc = c.createOscillator(), g = c.createGain();
  osc.type = type; osc.frequency.value = freq;
  osc.connect(g); g.connect(c.destination);
  g.gain.setValueAtTime(.18, c.currentTime);
  g.gain.exponentialRampToValueAtTime(.001, c.currentTime + dur);
  osc.start(); osc.stop(c.currentTime + dur);
}
function playMoveSound() { beep(520, .08, 'triangle'); }
function victoryFanfare() {
  const notes = [523, 659, 784, 1047];
  notes.forEach((f, i) => setTimeout(() => beep(f, .18, 'triangle'), i * 140));
}

function stopPoll() { if (pollTimer) { clearTimeout(pollTimer); clearInterval(pollTimer); pollTimer = null; } }
