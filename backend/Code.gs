/* =====================================================================
 * OX ONLINE TOURNAMENT — Google Apps Script Backend (Code.gs)
 * ---------------------------------------------------------------------
 * Backend เป็น "ผู้ควบคุมความจริง" ทั้งหมด:
 *   - ตรวจสอบ studentId + token ทุกครั้ง
 *   - ตรวจสิทธิ์การเดิน / ตาของผู้เล่น / ช่องว่าง / การเดินซ้ำ
 *   - สร้างตารางแข่ง Round Robin (Circle Method) ที่ถูกต้องทางคณิตศาสตร์
 *   - ตรวจผู้ชนะ / คิดคะแนน / กัน submit ซ้ำ
 *   - AI 3 ระดับ (ง่าย/ปานกลาง/ยาก=Minimax)
 *   - LockService กันเขียนชนกัน
 *
 * การติดตั้ง: ดู README.md หัวข้อ "ติดตั้ง Backend"
 * รันฟังก์ชัน setup() หนึ่งครั้งหลังวาง script ลงใน Sheet
 * =====================================================================*/

/* ------------------------- CONFIG ------------------------- */
const CONFIG = {
  // ถ้าใช้ bound script (เปิดจาก Extensions > Apps Script ในชีต) ปล่อยว่างได้
  // ถ้าใช้ standalone script ให้ใส่ ID ของ Google Sheet
  SPREADSHEET_ID: '',

  // 🔴 เปลี่ยนรหัสผ่านครูตรงนี้ แล้วรัน setup() ใหม่ (เก็บเฉพาะ hash ไว้)
  DEFAULT_TEACHER_PASSWORD: 'teacher1234',

  SESSION_HOURS: 8,            // อายุ session ครู
  WIN_POINTS: 3,
  DRAW_POINTS: 1,
  LOSS_POINTS: 0,
  DEFAULT_AI_LEVEL: 'medium'   // easy | medium | hard
};

const SHEETS = {
  STUDENTS: 'Students',
  MATCHES: 'Matches',
  MOVES: 'GameMoves',
  SCORES: 'Scores',
  SETTINGS: 'Settings',
  AUDIT: 'AuditLog'
};

const HEADERS = {
  Students: ['studentId', 'token', 'fullName', 'classRoom', 'registeredAt', 'status'],
  Matches: ['matchId', 'round', 'player1Id', 'player2Id', 'isAI', 'aiLevel',
            'boardState', 'currentTurn', 'status', 'winnerId',
            'player1Score', 'player2Score', 'startedAt', 'finishedAt'],
  GameMoves: ['moveId', 'matchId', 'moveNo', 'playerId', 'cellIndex', 'mark', 'timestamp'],
  Scores: ['studentId', 'fullName', 'games', 'wins', 'draws', 'losses', 'points'],
  Settings: ['key', 'value'],
  AuditLog: ['timestamp', 'actor', 'action', 'details']
};

const AI_ID = 'AI';
const EMPTY_BOARD = '_________'; // 9 ช่อง

/* ===================================================================
 * ENTRY POINTS
 * ===================================================================*/
function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents || '{}');
    var action = body.action;
    var result = route(action, body);
    return jsonOut(result);
  } catch (err) {
    return jsonOut({ ok: false, error: String(err && err.message || err) });
  }
}

function doGet(e) {
  // ใช้สำหรับ health-check และ polling แบบ GET (เลี่ยง CORS ในบางกรณี)
  try {
    var params = (e && e.parameter) || {};
    if (params.action) {
      return jsonOut(route(params.action, params));
    }
    return jsonOut({ ok: true, service: 'OX Tournament', time: now() });
  } catch (err) {
    return jsonOut({ ok: false, error: String(err && err.message || err) });
  }
}

function jsonOut(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ===================================================================
 * ROUTER
 * ===================================================================*/
function route(action, p) {
  switch (action) {
    // ----- นักเรียน -----
    case 'register':      return apiRegister(p);
    case 'getLobby':      return apiGetLobby(p);
    case 'getMyMatch':    return apiGetMyMatch(p);
    case 'getMatchState': return apiGetMatchState(p);
    case 'makeMove':      return apiMakeMove(p);

    // ----- สาธารณะ -----
    case 'getPublicStatus': return apiPublicStatus(p);
    case 'getLeaderboard':  return { ok: true, leaderboard: buildLeaderboard() };

    // ----- ครู -----
    case 'teacherLogin':      return apiTeacherLogin(p);
    case 'getDashboard':      return apiGetDashboard(p);
    case 'listStudents':      return apiListStudents(p);
    case 'addStudent':        return apiAddStudent(p);
    case 'editStudent':       return apiEditStudent(p);
    case 'removeStudent':     return apiRemoveStudent(p);
    case 'setRegistration':   return apiSetRegistration(p);
    case 'setAiLevel':        return apiSetAiLevel(p);
    case 'startTournament':   return apiStartTournament(p);
    case 'advanceRound':      return apiAdvanceRound(p);
    case 'pauseTournament':   return apiSetStatus(p, 'paused');
    case 'resumeTournament':  return apiSetStatus(p, 'running');
    case 'cancelTournament':  return apiSetStatus(p, 'cancelled');
    case 'finishTournament':  return apiSetStatus(p, 'finished');
    case 'resetTournament':   return apiResetTournament(p);
    case 'getMatches':        return apiGetMatches(p);
    case 'getMatchDetail':    return apiGetMatchDetail(p);
    case 'editResult':        return apiEditResult(p);

    default: return { ok: false, error: 'unknown action: ' + action };
  }
}

/* ===================================================================
 * SHEET HELPERS
 * ===================================================================*/
function ss() {
  return CONFIG.SPREADSHEET_ID
    ? SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID)
    : SpreadsheetApp.getActiveSpreadsheet();
}
function sheet(name) { return ss().getSheetByName(name); }

function readAll(name) {
  var sh = sheet(name);
  var values = sh.getDataRange().getValues();
  if (values.length < 2) return [];
  var head = values[0];
  var rows = [];
  for (var i = 1; i < values.length; i++) {
    var o = { _row: i + 1 };
    for (var c = 0; c < head.length; c++) o[head[c]] = values[i][c];
    rows.push(o);
  }
  return rows;
}

function appendRow(name, obj) {
  var sh = sheet(name);
  var head = HEADERS[name];
  var row = head.map(function (h) { return obj[h] !== undefined ? obj[h] : ''; });
  sh.appendRow(row);
}

function updateRow(name, rowIndex, obj) {
  var sh = sheet(name);
  var head = HEADERS[name];
  var range = sh.getRange(rowIndex, 1, 1, head.length);
  var cur = range.getValues()[0];
  for (var c = 0; c < head.length; c++) {
    if (obj[head[c]] !== undefined) cur[c] = obj[head[c]];
  }
  range.setValues([cur]);
}

/* ----- Settings key/value ----- */
function getSetting(key) {
  var rows = readAll(SHEETS.SETTINGS);
  for (var i = 0; i < rows.length; i++) if (rows[i].key === key) return rows[i].value;
  return null;
}
function setSetting(key, value) {
  var sh = sheet(SHEETS.SETTINGS);
  var rows = readAll(SHEETS.SETTINGS);
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].key === key) { sh.getRange(rows[i]._row, 2).setValue(value); return; }
  }
  sh.appendRow([key, value]);
}

function now() { return new Date().toISOString(); }
function uid(prefix) {
  return prefix + '-' + Utilities.getUuid().slice(0, 8).toUpperCase();
}

function audit(actor, action, details) {
  appendRow(SHEETS.AUDIT, {
    timestamp: now(), actor: actor, action: action,
    details: typeof details === 'string' ? details : JSON.stringify(details || {})
  });
}

function withLock(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); }
  finally { lock.releaseLock(); }
}

/* ===================================================================
 * SETUP (รันครั้งเดียวจาก editor)
 * ===================================================================*/
function setup() {
  var book = ss();
  Object.keys(SHEETS).forEach(function (k) {
    var name = SHEETS[k];
    var sh = book.getSheetByName(name);
    if (!sh) sh = book.insertSheet(name);
    sh.clear();
    sh.getRange(1, 1, 1, HEADERS[name].length).setValues([HEADERS[name]]);
    sh.setFrozenRows(1);
  });
  // ลบชีตเริ่มต้นชื่อ Sheet1 ถ้ามี
  var def = book.getSheetByName('Sheet1');
  if (def && book.getSheets().length > 1) book.deleteSheet(def);

  // ตั้งรหัสผ่านครู (เก็บเฉพาะ salt+hash)
  var salt = Utilities.getUuid();
  setSetting('teacherSalt', salt);
  setSetting('teacherPasswordHash', hashPassword(CONFIG.DEFAULT_TEACHER_PASSWORD, salt));
  setSetting('teacherSessionToken', '');
  setSetting('teacherSessionExpire', '');
  setSetting('tournamentStatus', 'registration'); // registration|running|paused|finished|cancelled
  setSetting('registrationOpen', 'true');
  setSetting('aiLevel', CONFIG.DEFAULT_AI_LEVEL);
  setSetting('currentRound', '0');
  setSetting('totalRounds', '0');
  setSetting('createdAt', now());

  audit('system', 'setup', 'initialized sheets + settings');
  return 'Setup เสร็จแล้ว ✅  (อย่าลืมเปลี่ยนรหัสผ่านครูใน CONFIG แล้วรัน setup() ซ้ำ)';
}

function hashPassword(pw, salt) {
  var raw = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256, salt + '::' + pw, Utilities.Charset.UTF_8);
  return raw.map(function (b) { return ((b & 0xff) + 0x100).toString(16).slice(1); }).join('');
}

/* ===================================================================
 * STUDENT API
 * ===================================================================*/
function apiRegister(p) {
  return withLock(function () {
    if (getSetting('registrationOpen') !== 'true' && getSetting('registrationOpen') !== true)
      return { ok: false, error: 'ปิดรับลงทะเบียนแล้ว' };
    if (['running', 'paused', 'finished', 'cancelled'].indexOf(getSetting('tournamentStatus')) >= 0)
      return { ok: false, error: 'การแข่งขันเริ่มแล้ว ไม่สามารถลงทะเบียนได้' };

    var name = String(p.fullName || '').trim();
    if (name.length < 2) return { ok: false, error: 'กรุณากรอกชื่อ-นามสกุล' };

    var students = readAll(SHEETS.STUDENTS).filter(function (s) { return s.status === 'active'; });
    // กันลงทะเบียนซ้ำ (ชื่อ+ห้องซ้ำ)
    var room = String(p.classRoom || '').trim();
    var dup = students.some(function (s) {
      return s.fullName.trim() === name && String(s.classRoom).trim() === room;
    });
    if (dup) return { ok: false, error: 'มีชื่อนี้ลงทะเบียนแล้ว' };

    var studentId = uid('STU');
    var token = Utilities.getUuid();
    appendRow(SHEETS.STUDENTS, {
      studentId: studentId, token: token, fullName: name,
      classRoom: room, registeredAt: now(), status: 'active'
    });
    audit(studentId, 'register', { name: name, room: room });
    return { ok: true, studentId: studentId, token: token, fullName: name,
             totalStudents: students.length + 1 };
  });
}

function authStudent(p) {
  var students = readAll(SHEETS.STUDENTS);
  for (var i = 0; i < students.length; i++) {
    if (students[i].studentId === p.studentId && students[i].token === p.token
        && students[i].status === 'active') {
      return students[i];
    }
  }
  return null;
}

function apiGetLobby(p) {
  var me = authStudent(p);
  if (!me) return { ok: false, error: 'ยืนยันตัวตนไม่สำเร็จ' };
  var status = getSetting('tournamentStatus');
  var students = readAll(SHEETS.STUDENTS).filter(function (s) { return s.status === 'active'; });
  var matches = readAll(SHEETS.MATCHES);
  var mine = matches.filter(function (m) {
    return m.player1Id === me.studentId || m.player2Id === me.studentId;
  });
  var played = mine.filter(function (m) { return m.status === 'finished'; }).length;
  var myScore = computeStudentScore(me.studentId, matches);

  // แมตช์ปัจจุบันที่พร้อมเล่น (รอบปัจจุบัน + in_progress)
  var current = findActiveMatchFor(me.studentId, matches);

  return {
    ok: true,
    tournamentStatus: status,
    totalStudents: students.length,
    fullName: me.fullName,
    totalMatches: mine.length,
    playedMatches: played,
    remainingMatches: mine.length - played,
    points: myScore.points,
    currentMatchId: current ? current.matchId : null,
    currentRound: Number(getSetting('currentRound') || 0),
    opponent: current ? opponentName(current, me.studentId) : null
  };
}

function findActiveMatchFor(studentId, matches) {
  var round = Number(getSetting('currentRound') || 0);
  if (getSetting('tournamentStatus') !== 'running') return null;
  for (var i = 0; i < matches.length; i++) {
    var m = matches[i];
    if (Number(m.round) === round && m.status === 'in_progress'
        && (m.player1Id === studentId || m.player2Id === studentId)) {
      return m;
    }
  }
  return null;
}

function opponentName(m, myId) {
  var oppId = (m.player1Id === myId) ? m.player2Id : m.player1Id;
  if (oppId === AI_ID) return '🤖 บอท AI';
  var s = findStudent(oppId);
  return s ? s.fullName : oppId;
}

function findStudent(id) {
  var rows = readAll(SHEETS.STUDENTS);
  for (var i = 0; i < rows.length; i++) if (rows[i].studentId === id) return rows[i];
  return null;
}

function apiGetMyMatch(p) {
  var me = authStudent(p);
  if (!me) return { ok: false, error: 'ยืนยันตัวตนไม่สำเร็จ' };
  var matches = readAll(SHEETS.MATCHES);
  var m = findActiveMatchFor(me.studentId, matches);
  if (!m) return { ok: true, match: null };
  return { ok: true, match: matchView(m, me.studentId) };
}

function apiGetMatchState(p) {
  var me = authStudent(p);
  if (!me) return { ok: false, error: 'ยืนยันตัวตนไม่สำเร็จ' };
  var m = findMatch(p.matchId);
  if (!m) return { ok: false, error: 'ไม่พบแมตช์' };
  if (m.player1Id !== me.studentId && m.player2Id !== me.studentId)
    return { ok: false, error: 'คุณไม่ใช่ผู้เล่นในแมตช์นี้' };
  return { ok: true, match: matchView(m, me.studentId) };
}

function matchView(m, myId) {
  var iAmP1 = (m.player1Id === myId);
  var myMark = iAmP1 ? 'X' : 'O';
  var turnMark = (m.currentTurn === 'player1') ? 'X' : 'O';
  return {
    matchId: m.matchId,
    round: Number(m.round),
    board: String(m.boardState),
    myMark: myMark,
    myTurn: (turnMark === myMark) && m.status === 'in_progress',
    status: m.status,
    isAI: (m.isAI === true || m.isAI === 'true'),
    winnerId: m.winnerId,
    result: resultForStudent(m, myId),
    myScore: iAmP1 ? Number(m.player1Score || 0) : Number(m.player2Score || 0),
    player1Name: m.player1Id === AI_ID ? '🤖 AI' : nameOf(m.player1Id),
    player2Name: m.player2Id === AI_ID ? '🤖 AI' : nameOf(m.player2Id),
    myName: nameOf(myId),
    opponentName: opponentName(m, myId)
  };
}

function nameOf(id) {
  if (id === AI_ID) return '🤖 AI';
  var s = findStudent(id);
  return s ? s.fullName : id;
}

function resultForStudent(m, myId) {
  if (m.status !== 'finished') return null;
  if (m.winnerId === 'draw') return 'draw';
  return (m.winnerId === myId) ? 'win' : 'lose';
}

function findMatch(matchId) {
  var rows = readAll(SHEETS.MATCHES);
  for (var i = 0; i < rows.length; i++) if (rows[i].matchId === matchId) return rows[i];
  return null;
}

/* ------------------------- MAKE MOVE ------------------------- */
function apiMakeMove(p) {
  return withLock(function () {
    var me = authStudent(p);
    if (!me) return { ok: false, error: 'ยืนยันตัวตนไม่สำเร็จ' };

    var status = getSetting('tournamentStatus');
    if (status === 'paused') return { ok: false, error: 'การแข่งขันถูกหยุดชั่วคราว' };
    if (status !== 'running') return { ok: false, error: 'ยังไม่อยู่ในช่วงแข่งขัน' };

    var m = findMatch(p.matchId);
    if (!m) return { ok: false, error: 'ไม่พบแมตช์' };
    if (Number(m.round) !== Number(getSetting('currentRound')))
      return { ok: false, error: 'แมตช์นี้ไม่ใช่รอบปัจจุบัน' };
    if (m.status !== 'in_progress') return { ok: false, error: 'แมตช์นี้ไม่ได้อยู่ระหว่างแข่งขัน' };

    var iAmP1 = (m.player1Id === me.studentId);
    var iAmP2 = (m.player2Id === me.studentId);
    if (!iAmP1 && !iAmP2) return { ok: false, error: 'คุณไม่ใช่ผู้เล่นในแมตช์นี้' };

    var myTurnSlot = iAmP1 ? 'player1' : 'player2';
    if (m.currentTurn !== myTurnSlot) return { ok: false, error: 'ยังไม่ถึงตาของคุณ' };

    var cell = Number(p.cellIndex);
    if (!(cell >= 0 && cell <= 8)) return { ok: false, error: 'ช่องไม่ถูกต้อง' };

    var board = String(m.boardState).split('');
    if (board[cell] !== '_') return { ok: false, error: 'ช่องนี้ถูกเดินไปแล้ว' };

    var myMark = iAmP1 ? 'X' : 'O';
    board[cell] = myMark;
    recordMove(m.matchId, me.studentId, cell, myMark);

    var result = evalBoard(board.join(''));
    if (result.over) {
      finishMatch(m, board.join(''), result);
      return { ok: true, match: matchView(findMatch(m.matchId), me.studentId) };
    }

    // สลับตา
    var nextTurn = iAmP1 ? 'player2' : 'player1';
    updateRow(SHEETS.MATCHES, m._row, { boardState: board.join(''), currentTurn: nextTurn });

    // ถ้าเป็นแมตช์ AI และตอนนี้ถึงตา AI -> ให้ AI เดินทันที
    m = findMatch(m.matchId);
    if ((m.isAI === true || m.isAI === 'true') && m.currentTurn === 'player2') {
      aiPlay(m);
      m = findMatch(m.matchId);
    }
    return { ok: true, match: matchView(m, me.studentId) };
  });
}

function recordMove(matchId, playerId, cell, mark) {
  var moves = readAll(SHEETS.MOVES).filter(function (x) { return x.matchId === matchId; });
  appendRow(SHEETS.MOVES, {
    moveId: uid('MV'), matchId: matchId, moveNo: moves.length + 1,
    playerId: playerId, cellIndex: cell, mark: mark, timestamp: now()
  });
}

function finishMatch(m, boardStr, result) {
  var p1 = CONFIG.LOSS_POINTS, p2 = CONFIG.LOSS_POINTS, winnerId;
  if (result.winner === 'draw') {
    p1 = CONFIG.DRAW_POINTS; p2 = CONFIG.DRAW_POINTS; winnerId = 'draw';
  } else if (result.winner === 'X') {
    p1 = CONFIG.WIN_POINTS; winnerId = m.player1Id;
  } else { // O
    p2 = CONFIG.WIN_POINTS; winnerId = m.player2Id;
  }
  updateRow(SHEETS.MATCHES, m._row, {
    boardState: boardStr, status: 'finished', winnerId: winnerId,
    player1Score: p1, player2Score: p2, finishedAt: now()
  });
  rebuildScores();
  audit('system', 'matchFinished', { matchId: m.matchId, winner: winnerId });
}

/* ------------------------- WIN DETECTION ------------------------- */
var WIN_LINES = [
  [0,1,2],[3,4,5],[6,7,8], // แถว
  [0,3,6],[1,4,7],[2,5,8], // คอลัมน์
  [0,4,8],[2,4,6]          // ทแยง
];
function evalBoard(boardStr) {
  var b = boardStr.split('');
  for (var i = 0; i < WIN_LINES.length; i++) {
    var L = WIN_LINES[i];
    if (b[L[0]] !== '_' && b[L[0]] === b[L[1]] && b[L[1]] === b[L[2]]) {
      return { over: true, winner: b[L[0]], line: L };
    }
  }
  if (b.indexOf('_') === -1) return { over: true, winner: 'draw' };
  return { over: false };
}

/* ===================================================================
 * AI (ง่าย=สุ่ม / ปานกลาง=ชนะ-กันแพ้ / ยาก=Minimax)
 * ผู้เล่นเป็น X (player1) เริ่มก่อน / AI เป็น O (player2)
 * ===================================================================*/
function aiPlay(m) {
  var board = String(m.boardState).split('');
  var level = m.aiLevel || CONFIG.DEFAULT_AI_LEVEL;
  var cell;
  if (level === 'easy') cell = aiRandom(board);
  else if (level === 'hard') cell = aiMinimax(board);
  else cell = aiMedium(board);

  if (cell === -1) { // กันกรณีไม่มีช่อง (ไม่ควรเกิด)
    var r = evalBoard(board.join(''));
    if (r.over) finishMatch(m, board.join(''), r);
    return;
  }
  board[cell] = 'O';
  recordMove(m.matchId, AI_ID, cell, 'O');

  var result = evalBoard(board.join(''));
  if (result.over) { finishMatch(m, board.join(''), result); return; }
  updateRow(SHEETS.MATCHES, m._row, { boardState: board.join(''), currentTurn: 'player1' });
}

function emptyCells(board) {
  var e = [];
  for (var i = 0; i < 9; i++) if (board[i] === '_') e.push(i);
  return e;
}
function aiRandom(board) {
  var e = emptyCells(board);
  return e.length ? e[Math.floor(Math.random() * e.length)] : -1;
}
function aiMedium(board) {
  // 1) ชนะได้ชนะเลย  2) กันคู่ต่อสู้ชนะ  3) กลาง  4) มุม  5) สุ่ม
  var win = findWinningCell(board, 'O'); if (win !== -1) return win;
  var block = findWinningCell(board, 'X'); if (block !== -1) return block;
  if (board[4] === '_') return 4;
  var corners = [0, 2, 6, 8].filter(function (i) { return board[i] === '_'; });
  if (corners.length) return corners[Math.floor(Math.random() * corners.length)];
  return aiRandom(board);
}
function findWinningCell(board, mark) {
  for (var i = 0; i < 9; i++) {
    if (board[i] === '_') {
      var copy = board.slice(); copy[i] = mark;
      if (evalBoard(copy.join('')).winner === mark) return i;
    }
  }
  return -1;
}
function aiMinimax(board) {
  var best = { score: -Infinity, cell: -1 };
  var e = emptyCells(board);
  for (var i = 0; i < e.length; i++) {
    var copy = board.slice(); copy[e[i]] = 'O';
    var s = minimax(copy, false, 0);
    if (s > best.score) { best.score = s; best.cell = e[i]; }
  }
  return best.cell;
}
function minimax(board, isAiTurn, depth) {
  var r = evalBoard(board.join(''));
  if (r.over) {
    if (r.winner === 'O') return 10 - depth;
    if (r.winner === 'X') return depth - 10;
    return 0;
  }
  var e = emptyCells(board);
  if (isAiTurn) {
    var best = -Infinity;
    for (var i = 0; i < e.length; i++) {
      var c = board.slice(); c[e[i]] = 'O';
      best = Math.max(best, minimax(c, false, depth + 1));
    }
    return best;
  } else {
    var worst = Infinity;
    for (var j = 0; j < e.length; j++) {
      var c2 = board.slice(); c2[e[j]] = 'X';
      worst = Math.min(worst, minimax(c2, true, depth + 1));
    }
    return worst;
  }
}

/* ===================================================================
 * SCORING / LEADERBOARD
 * ===================================================================*/
function computeStudentScore(studentId, matches) {
  var games = 0, wins = 0, draws = 0, losses = 0, points = 0;
  matches.forEach(function (m) {
    if (m.status !== 'finished') return;
    var isP1 = m.player1Id === studentId, isP2 = m.player2Id === studentId;
    if (!isP1 && !isP2) return;
    games++;
    if (m.winnerId === 'draw') { draws++; points += CONFIG.DRAW_POINTS; }
    else if (m.winnerId === studentId) { wins++; points += CONFIG.WIN_POINTS; }
    else { losses++; points += CONFIG.LOSS_POINTS; }
  });
  return { games: games, wins: wins, draws: draws, losses: losses, points: points };
}

function rebuildScores() {
  var students = readAll(SHEETS.STUDENTS).filter(function (s) { return s.status === 'active'; });
  var matches = readAll(SHEETS.MATCHES);
  var sh = sheet(SHEETS.SCORES);
  sh.clear();
  sh.getRange(1, 1, 1, HEADERS.Scores.length).setValues([HEADERS.Scores]);
  var rows = students.map(function (s) {
    var sc = computeStudentScore(s.studentId, matches);
    return [s.studentId, s.fullName, sc.games, sc.wins, sc.draws, sc.losses, sc.points];
  });
  if (rows.length) sh.getRange(2, 1, rows.length, HEADERS.Scores.length).setValues(rows);
  sh.setFrozenRows(1);
}

function buildLeaderboard() {
  var students = readAll(SHEETS.STUDENTS).filter(function (s) { return s.status === 'active'; });
  var matches = readAll(SHEETS.MATCHES);
  var list = students.map(function (s) {
    var sc = computeStudentScore(s.studentId, matches);
    return {
      studentId: s.studentId, fullName: s.fullName, classRoom: s.classRoom,
      games: sc.games, wins: sc.wins, draws: sc.draws, losses: sc.losses, points: sc.points
    };
  });
  // เรียง: คะแนน > จำนวนชนะ > ผลเจอกันตัวต่อตัว
  list.sort(function (a, b) {
    if (b.points !== a.points) return b.points - a.points;
    if (b.wins !== a.wins) return b.wins - a.wins;
    var h2h = headToHead(a.studentId, b.studentId, matches);
    if (h2h !== 0) return h2h;
    return 0;
  });
  // ใส่อันดับ (คะแนนเท่ากันทุกเกณฑ์ = อันดับร่วม)
  var rank = 0, prev = null;
  list.forEach(function (row, i) {
    if (prev && sameRank(prev, row, matches)) { row.rank = rank; }
    else { rank = i + 1; row.rank = rank; }
    prev = row;
  });
  return list;
}

function sameRank(a, b, matches) {
  return a.points === b.points && a.wins === b.wins
      && headToHead(a.studentId, b.studentId, matches) === 0;
}

// คืนค่า <0 ถ้า a ควรอยู่เหนือ b, >0 ถ้า b เหนือ a, 0 ถ้าเสมอ/ไม่เจอกัน
function headToHead(aId, bId, matches) {
  for (var i = 0; i < matches.length; i++) {
    var m = matches[i];
    if (m.status !== 'finished') continue;
    var pair = (m.player1Id === aId && m.player2Id === bId)
            || (m.player1Id === bId && m.player2Id === aId);
    if (!pair) continue;
    if (m.winnerId === aId) return -1;
    if (m.winnerId === bId) return 1;
  }
  return 0;
}

/* ===================================================================
 * TEACHER API
 * ===================================================================*/
function apiTeacherLogin(p) {
  var salt = getSetting('teacherSalt');
  var hash = getSetting('teacherPasswordHash');
  if (hashPassword(String(p.password || ''), salt) !== hash)
    return { ok: false, error: 'รหัสผ่านไม่ถูกต้อง' };
  var token = Utilities.getUuid();
  var expire = new Date(Date.now() + CONFIG.SESSION_HOURS * 3600 * 1000).toISOString();
  setSetting('teacherSessionToken', token);
  setSetting('teacherSessionExpire', expire);
  audit('teacher', 'login', {});
  return { ok: true, sessionToken: token };
}

function authTeacher(p) {
  var token = getSetting('teacherSessionToken');
  var expire = getSetting('teacherSessionExpire');
  if (!token || String(p.sessionToken) !== String(token)) return false;
  if (expire && new Date(expire).getTime() < Date.now()) return false;
  return true;
}
function needTeacher(p) {
  return authTeacher(p) ? null : { ok: false, error: 'กรุณาเข้าสู่ระบบครูอีกครั้ง', authExpired: true };
}

function apiGetDashboard(p) {
  var g = needTeacher(p); if (g) return g;
  var students = readAll(SHEETS.STUDENTS).filter(function (s) { return s.status === 'active'; });
  var matches = readAll(SHEETS.MATCHES);
  var finished = matches.filter(function (m) { return m.status === 'finished'; }).length;
  var inprog = matches.filter(function (m) { return m.status === 'in_progress'; }).length;
  var pending = matches.filter(function (m) { return m.status === 'pending'; }).length;
  return {
    ok: true,
    tournamentStatus: getSetting('tournamentStatus'),
    registrationOpen: getSetting('registrationOpen') === 'true' || getSetting('registrationOpen') === true,
    aiLevel: getSetting('aiLevel'),
    currentRound: Number(getSetting('currentRound') || 0),
    totalRounds: Number(getSetting('totalRounds') || 0),
    students: students.length,
    totalMatches: matches.length,
    finishedMatches: finished,
    inProgressMatches: inprog,
    pendingMatches: pending
  };
}

function apiListStudents(p) {
  var g = needTeacher(p); if (g) return g;
  var students = readAll(SHEETS.STUDENTS).filter(function (s) { return s.status === 'active'; });
  return { ok: true, students: students.map(function (s) {
    return { studentId: s.studentId, fullName: s.fullName, classRoom: s.classRoom,
             registeredAt: s.registeredAt };
  }) };
}

function apiAddStudent(p) {
  var g = needTeacher(p); if (g) return g;
  return withLock(function () {
    if (getSetting('tournamentStatus') === 'running')
      return { ok: false, error: 'กำลังแข่งขัน เพิ่มนักเรียนไม่ได้' };
    var name = String(p.fullName || '').trim();
    if (name.length < 2) return { ok: false, error: 'ชื่อไม่ถูกต้อง' };
    var room = String(p.classRoom || '').trim();
    var students = readAll(SHEETS.STUDENTS).filter(function (s) { return s.status === 'active'; });
    if (students.some(function (s) { return s.fullName.trim() === name && String(s.classRoom).trim() === room; }))
      return { ok: false, error: 'มีชื่อนี้แล้ว' };
    var id = uid('STU');
    appendRow(SHEETS.STUDENTS, {
      studentId: id, token: Utilities.getUuid(), fullName: name,
      classRoom: room, registeredAt: now(), status: 'active'
    });
    audit('teacher', 'addStudent', { name: name });
    return { ok: true, studentId: id };
  });
}

function apiEditStudent(p) {
  var g = needTeacher(p); if (g) return g;
  return withLock(function () {
    var s = findStudent(p.studentId);
    if (!s) return { ok: false, error: 'ไม่พบนักเรียน' };
    updateRow(SHEETS.STUDENTS, s._row, {
      fullName: String(p.fullName || s.fullName).trim(),
      classRoom: String(p.classRoom !== undefined ? p.classRoom : s.classRoom).trim()
    });
    rebuildScores();
    audit('teacher', 'editStudent', { studentId: p.studentId });
    return { ok: true };
  });
}

function apiRemoveStudent(p) {
  var g = needTeacher(p); if (g) return g;
  return withLock(function () {
    if (getSetting('tournamentStatus') === 'running')
      return { ok: false, error: 'กำลังแข่งขัน ลบนักเรียนไม่ได้' };
    var s = findStudent(p.studentId);
    if (!s) return { ok: false, error: 'ไม่พบนักเรียน' };
    updateRow(SHEETS.STUDENTS, s._row, { status: 'removed' });
    audit('teacher', 'removeStudent', { studentId: p.studentId, name: s.fullName });
    return { ok: true };
  });
}

function apiSetRegistration(p) {
  var g = needTeacher(p); if (g) return g;
  setSetting('registrationOpen', p.open ? 'true' : 'false');
  audit('teacher', 'setRegistration', { open: !!p.open });
  return { ok: true };
}

function apiSetAiLevel(p) {
  var g = needTeacher(p); if (g) return g;
  var lvl = ['easy', 'medium', 'hard'].indexOf(p.level) >= 0 ? p.level : CONFIG.DEFAULT_AI_LEVEL;
  setSetting('aiLevel', lvl);
  audit('teacher', 'setAiLevel', { level: lvl });
  return { ok: true, aiLevel: lvl };
}

/* ------------------------- START / ROUND ROBIN ------------------------- */
function apiStartTournament(p) {
  var g = needTeacher(p); if (g) return g;
  return withLock(function () {
    var status = getSetting('tournamentStatus');
    if (status === 'running' || status === 'paused')
      return { ok: false, error: 'การแข่งขันเริ่มไปแล้ว' };

    var students = readAll(SHEETS.STUDENTS).filter(function (s) { return s.status === 'active'; });
    if (students.length < 2) return { ok: false, error: 'ต้องมีนักเรียนอย่างน้อย 2 คน' };

    var aiLevel = getSetting('aiLevel') || CONFIG.DEFAULT_AI_LEVEL;
    var schedule = buildRoundRobin(students.map(function (s) { return s.studentId; }));

    // เคลียร์ของเดิม
    clearSheet(SHEETS.MATCHES);
    clearSheet(SHEETS.MOVES);

    var rows = [];
    schedule.forEach(function (round, ri) {
      round.forEach(function (pair) {
        var isAI = (pair[1] === AI_ID);
        // เมื่อเจอ AI นักเรียนต้องเป็น player1 (X) เพื่อเริ่มก่อน
        var p1 = pair[0], p2 = pair[1];
        if (p2 !== AI_ID && Math.random() < 0.5) { var t = p1; p1 = p2; p2 = t; }
        rows.push([
          uid('MAT'), ri + 1, p1, p2, isAI, isAI ? aiLevel : '',
          EMPTY_BOARD, 'player1', 'pending', '', '', '', '', ''
        ]);
      });
    });
    if (rows.length) sheet(SHEETS.MATCHES).getRange(2, 1, rows.length, HEADERS.Matches.length).setValues(rows);

    setSetting('totalRounds', String(schedule.length));
    setSetting('currentRound', '1');
    setSetting('registrationOpen', 'false');
    setSetting('tournamentStatus', 'running');
    activateRound(1);
    rebuildScores();
    audit('teacher', 'startTournament',
      { students: students.length, rounds: schedule.length, matches: rows.length });
    return { ok: true, rounds: schedule.length, matches: rows.length };
  });
}

function clearSheet(name) {
  var sh = sheet(name);
  sh.clear();
  sh.getRange(1, 1, 1, HEADERS[name].length).setValues([HEADERS[name]]);
  sh.setFrozenRows(1);
}

// ตั้งแมตช์รอบ r ให้พร้อมเล่น; AI match จะถูกเดินตาแรกของ AI? -> ไม่ เพราะนักเรียน(X)เริ่มก่อน
function activateRound(r) {
  var matches = readAll(SHEETS.MATCHES);
  matches.forEach(function (m) {
    if (Number(m.round) === r && m.status === 'pending') {
      updateRow(SHEETS.MATCHES, m._row, { status: 'in_progress', startedAt: now() });
    }
  });
}

/* Circle Method (Polygon) — Round Robin ที่ถูกต้อง ไม่มีคู่ซ้ำ ทุกคนเจอกันครบ */
function buildRoundRobin(ids) {
  var players = ids.slice();
  if (players.length % 2 === 1) players.push(AI_ID); // เลขคี่ -> เพิ่ม AI เป็นคู่สมมติ
  var n = players.length;
  var rounds = [];
  var arr = players.slice();
  for (var r = 0; r < n - 1; r++) {
    var pairs = [];
    for (var i = 0; i < n / 2; i++) {
      var a = arr[i], b = arr[n - 1 - i];
      // ข้ามคู่ที่เป็น AI vs AI (ไม่ควรเกิดเพราะมี AI แค่ตัวเดียว)
      if (a === AI_ID && b === AI_ID) continue;
      pairs.push([a, b]);
    }
    rounds.push(pairs);
    // หมุน: ตรึง arr[0], หมุนที่เหลือ
    var fixed = arr[0];
    var rest = arr.slice(1);
    rest.unshift(rest.pop());
    arr = [fixed].concat(rest);
  }
  return rounds;
}

function apiAdvanceRound(p) {
  var g = needTeacher(p); if (g) return g;
  return withLock(function () {
    if (getSetting('tournamentStatus') !== 'running')
      return { ok: false, error: 'ต้องอยู่ในสถานะกำลังแข่งขัน' };
    var cur = Number(getSetting('currentRound') || 0);
    var total = Number(getSetting('totalRounds') || 0);
    var matches = readAll(SHEETS.MATCHES);
    var unfinished = matches.filter(function (m) {
      return Number(m.round) === cur && m.status !== 'finished';
    });
    if (unfinished.length > 0 && !p.force) {
      return { ok: false, error: 'ยังมี ' + unfinished.length + ' แมตช์ในรอบนี้ที่ยังไม่จบ',
               unfinished: unfinished.map(function (m) { return m.matchId; }) };
    }
    if (cur >= total) {
      setSetting('tournamentStatus', 'finished');
      audit('teacher', 'finishTournament', { reason: 'all rounds done' });
      return { ok: true, finished: true };
    }
    var next = cur + 1;
    setSetting('currentRound', String(next));
    activateRound(next);
    audit('teacher', 'advanceRound', { from: cur, to: next, forced: !!p.force });
    return { ok: true, currentRound: next };
  });
}

function apiSetStatus(p, status) {
  var g = needTeacher(p); if (g) return g;
  setSetting('tournamentStatus', status);
  audit('teacher', 'setStatus', { status: status });
  return { ok: true, status: status };
}

function apiResetTournament(p) {
  var g = needTeacher(p); if (g) return g;
  if (!p.confirm) return { ok: false, error: 'ต้องยืนยันก่อนรีเซ็ต' };
  return withLock(function () {
    clearSheet(SHEETS.MATCHES);
    clearSheet(SHEETS.MOVES);
    clearSheet(SHEETS.SCORES);
    setSetting('tournamentStatus', 'registration');
    setSetting('registrationOpen', 'true');
    setSetting('currentRound', '0');
    setSetting('totalRounds', '0');
    audit('teacher', 'resetTournament', {});
    return { ok: true };
  });
}

function apiGetMatches(p) {
  var g = needTeacher(p); if (g) return g;
  var matches = readAll(SHEETS.MATCHES);
  var round = p.round ? Number(p.round) : null;
  var list = matches.filter(function (m) { return round ? Number(m.round) === round : true; })
    .map(function (m) {
      return {
        matchId: m.matchId, round: Number(m.round),
        player1: nameOf(m.player1Id), player2: nameOf(m.player2Id),
        player1Id: m.player1Id, player2Id: m.player2Id,
        isAI: (m.isAI === true || m.isAI === 'true'),
        status: m.status, winnerId: m.winnerId,
        winnerName: m.winnerId === 'draw' ? 'เสมอ' : (m.winnerId ? nameOf(m.winnerId) : ''),
        player1Score: m.player1Score, player2Score: m.player2Score
      };
    });
  return { ok: true, matches: list, currentRound: Number(getSetting('currentRound') || 0),
           totalRounds: Number(getSetting('totalRounds') || 0) };
}

function apiGetMatchDetail(p) {
  var g = needTeacher(p); if (g) return g;
  var m = findMatch(p.matchId);
  if (!m) return { ok: false, error: 'ไม่พบแมตช์' };
  var moves = readAll(SHEETS.MOVES).filter(function (x) { return x.matchId === p.matchId; })
    .sort(function (a, b) { return Number(a.moveNo) - Number(b.moveNo); })
    .map(function (x) {
      return { moveNo: Number(x.moveNo), player: nameOf(x.playerId),
               cell: Number(x.cellIndex), mark: x.mark, time: x.timestamp };
    });
  return { ok: true, detail: {
    matchId: m.matchId, round: Number(m.round),
    player1: nameOf(m.player1Id), player2: nameOf(m.player2Id),
    board: String(m.boardState), status: m.status,
    winnerName: m.winnerId === 'draw' ? 'เสมอ' : (m.winnerId ? nameOf(m.winnerId) : '-'),
    moves: moves
  } };
}

function apiEditResult(p) {
  var g = needTeacher(p); if (g) return g;
  return withLock(function () {
    var m = findMatch(p.matchId);
    if (!m) return { ok: false, error: 'ไม่พบแมตช์' };
    var w = p.winnerId; // studentId | 'draw'
    var valid = (w === 'draw' || w === m.player1Id || w === m.player2Id);
    if (!valid) return { ok: false, error: 'ผู้ชนะไม่ถูกต้อง' };
    var p1 = CONFIG.LOSS_POINTS, p2 = CONFIG.LOSS_POINTS;
    if (w === 'draw') { p1 = CONFIG.DRAW_POINTS; p2 = CONFIG.DRAW_POINTS; }
    else if (w === m.player1Id) p1 = CONFIG.WIN_POINTS;
    else p2 = CONFIG.WIN_POINTS;
    updateRow(SHEETS.MATCHES, m._row, {
      status: 'finished', winnerId: w, player1Score: p1, player2Score: p2, finishedAt: now()
    });
    rebuildScores();
    audit('teacher', 'editResult',
      { matchId: p.matchId, newWinner: w, oldWinner: m.winnerId, reason: p.reason || '' });
    return { ok: true };
  });
}

function apiPublicStatus(p) {
  return {
    ok: true,
    tournamentStatus: getSetting('tournamentStatus'),
    registrationOpen: getSetting('registrationOpen') === 'true' || getSetting('registrationOpen') === true,
    totalStudents: readAll(SHEETS.STUDENTS).filter(function (s) { return s.status === 'active'; }).length
  };
}
