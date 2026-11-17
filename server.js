// ===================================================================
//  เกม OX ออนไลน์สำหรับห้องเรียน  (OX Game Online for Classroom)
//  - ครูจัดการแข่งขันจากเครื่องของครู
//  - นักเรียนเข้าร่วมผ่านเบราว์เซอร์ในวง LAN เดียวกัน
//  - จับคู่อัตโนมัติต่อเนื่อง / ชนะ 3, เสมอ 1, แพ้ 0 / ล้างผลได้
// ===================================================================

const path = require('path');
const http = require('http');
const os = require('os');
const express = require('express');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

// -------------------------------------------------------------------
//  สถานะของระบบ (เก็บในหน่วยความจำ)
// -------------------------------------------------------------------
const players = new Map();   // socketId -> player
const matches = new Map();   // matchId  -> match
let queue = [];              // socketId ที่กำลังรอจับคู่
let matchmakingOpen = false; // ครูเปิด/ปิดการจับคู่
let matchCounter = 0;

const WIN_LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8], // แนวนอน
  [0, 3, 6], [1, 4, 7], [2, 5, 8], // แนวตั้ง
  [0, 4, 8], [2, 4, 6],            // แนวทแยง
];

// -------------------------------------------------------------------
//  ตัวช่วย
// -------------------------------------------------------------------
function publicPlayer(p) {
  return {
    id: p.id,
    name: p.name,
    score: p.score,
    wins: p.wins,
    draws: p.draws,
    losses: p.losses,
    played: p.wins + p.draws + p.losses,
    status: p.status, // 'lobby' | 'queued' | 'playing' | 'result'
  };
}

function scoreboard() {
  return [...players.values()]
    .map(publicPlayer)
    .sort((a, b) =>
      b.score - a.score ||
      b.wins - a.wins ||
      a.name.localeCompare(b.name, 'th')
    );
}

function publicMatch(m) {
  const a = players.get(m.players[0]);
  const b = players.get(m.players[1]);
  return {
    id: m.id,
    board: m.board,
    turn: m.turn,
    players: [
      a ? { id: a.id, name: a.name, symbol: m.symbols[a.id] } : null,
      b ? { id: b.id, name: b.name, symbol: m.symbols[b.id] } : null,
    ],
  };
}

// ส่งสถานะภาพรวมให้ครูทุกคน
function broadcastTeacherState() {
  const state = {
    matchmakingOpen,
    scoreboard: scoreboard(),
    queueCount: queue.length,
    matches: [...matches.values()].map(publicMatch),
    totalPlayers: players.size,
  };
  io.to('teachers').emit('teacher:state', state);
}

function checkWinner(board) {
  for (const [x, y, z] of WIN_LINES) {
    if (board[x] && board[x] === board[y] && board[x] === board[z]) {
      return { symbol: board[x], line: [x, y, z] };
    }
  }
  if (board.every((c) => c !== '')) return { symbol: 'draw', line: null };
  return null;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// นำผู้เล่นกลับเข้าคิว (ถ้ายังเชื่อมต่ออยู่)
function enqueue(id) {
  const p = players.get(id);
  if (!p) return;
  p.status = 'queued';
  p.matchId = null;
  if (!queue.includes(id)) queue.push(id);
  tryMatchmaking();
}

// จับคู่อัตโนมัติต่อเนื่อง
function tryMatchmaking() {
  if (!matchmakingOpen) return;
  // กรองเฉพาะคนที่ยัง online และสถานะ queued
  queue = queue.filter((id) => {
    const p = players.get(id);
    return p && p.status === 'queued';
  });

  while (queue.length >= 2 && matchmakingOpen) {
    // สุ่มเลือก 2 คนจากคิว
    shuffle(queue);
    const id1 = queue.shift();
    const id2 = queue.shift();
    const p1 = players.get(id1);
    const p2 = players.get(id2);
    if (!p1 || !p2) continue;
    createMatch(p1, p2);
  }
}

function createMatch(p1, p2) {
  matchCounter += 1;
  const id = 'm' + matchCounter;

  // สุ่มว่าใครได้ X (เริ่มก่อน)
  const order = shuffle([p1, p2]);
  const first = order[0];
  const second = order[1];

  const symbols = {};
  symbols[first.id] = 'X';
  symbols[second.id] = 'O';

  const match = {
    id,
    players: [first.id, second.id],
    board: ['', '', '', '', '', '', '', '', ''],
    symbols,
    turn: first.id, // X เริ่มก่อน
    createdAt: Date.now(),
  };
  matches.set(id, match);

  first.status = 'playing';
  second.status = 'playing';
  first.matchId = id;
  second.matchId = id;

  // แจ้งผู้เล่นทั้งสอง
  sendMatchStart(match, first);
  sendMatchStart(match, second);
  broadcastTeacherState();
}

function sendMatchStart(match, player) {
  const opponentId = match.players.find((pid) => pid !== player.id);
  const opponent = players.get(opponentId);
  io.to(player.id).emit('match:start', {
    matchId: match.id,
    board: match.board,
    yourSymbol: match.symbols[player.id],
    yourTurn: match.turn === player.id,
    opponentName: opponent ? opponent.name : '—',
  });
}

function sendMatchUpdate(match) {
  for (const pid of match.players) {
    io.to(pid).emit('match:update', {
      matchId: match.id,
      board: match.board,
      yourTurn: match.turn === pid,
    });
  }
}

// จบแมตช์: อัปเดตคะแนน แจ้งผล แล้วไม่ re-queue ทันที (ให้ client กดเล่นต่อ)
function finishMatch(match, result) {
  const [aId, bId] = match.players;
  const a = players.get(aId);
  const b = players.get(bId);

  if (result.symbol === 'draw') {
    if (a) { a.score += 1; a.draws += 1; }
    if (b) { b.score += 1; b.draws += 1; }
  } else {
    const winnerId = Object.keys(match.symbols).find(
      (pid) => match.symbols[pid] === result.symbol
    );
    const loserId = match.players.find((pid) => pid !== winnerId);
    const w = players.get(winnerId);
    const l = players.get(loserId);
    if (w) { w.score += 3; w.wins += 1; }
    if (l) { l.losses += 1; }
  }

  for (const pid of match.players) {
    const p = players.get(pid);
    if (!p) continue;
    p.status = 'result';
    p.matchId = null;
    let outcome = 'draw';
    if (result.symbol !== 'draw') {
      outcome = match.symbols[pid] === result.symbol ? 'win' : 'lose';
    }
    io.to(pid).emit('match:end', {
      board: match.board,
      outcome,
      winningLine: result.line,
      you: publicPlayer(p),
    });
  }

  matches.delete(match.id);
  broadcastTeacherState();
}

// ยกเลิกแมตช์ (เช่นมีคนหลุด) — เป็นโมฆะ ไม่มีใครได้คะแนน
function voidMatch(match, reason) {
  for (const pid of match.players) {
    const p = players.get(pid);
    if (!p) continue;
    io.to(pid).emit('match:void', { reason });
    enqueue(pid); // อีกฝ่ายกลับเข้าคิวให้อัตโนมัติ
  }
  matches.delete(match.id);
  broadcastTeacherState();
}

// -------------------------------------------------------------------
//  Socket.IO
// -------------------------------------------------------------------
io.on('connection', (socket) => {
  // ---------- ครู ----------
  socket.on('teacher:join', () => {
    socket.join('teachers');
    socket.data.role = 'teacher';
    broadcastTeacherState();
  });

  socket.on('teacher:toggle', (open) => {
    matchmakingOpen = !!open;
    if (matchmakingOpen) {
      // ดึงคนที่อยู่ lobby เข้าคิว
      for (const p of players.values()) {
        if (p.status === 'lobby' || p.status === 'result') {
          // เฉพาะคนที่กำลังรออยู่หน้าล็อบบี้เท่านั้นที่ client จะกดเข้าคิวเอง
        }
      }
      tryMatchmaking();
    }
    broadcastTeacherState();
  });

  socket.on('teacher:clear', () => {
    // ล้างผลการแข่งขัน: รีเซ็ตคะแนนทุกคนเป็น 0 (ไม่ตัดการเชื่อมต่อ)
    for (const p of players.values()) {
      p.score = 0; p.wins = 0; p.draws = 0; p.losses = 0;
    }
    broadcastTeacherState();
    io.emit('scores:cleared');
  });

  socket.on('teacher:kick', (playerId) => {
    const target = io.sockets.sockets.get(playerId);
    const p = players.get(playerId);
    if (p && p.matchId && matches.has(p.matchId)) {
      voidMatch(matches.get(p.matchId), 'ครูนำผู้เล่นออกจากการแข่งขัน');
    }
    players.delete(playerId);
    queue = queue.filter((id) => id !== playerId);
    if (target) {
      target.emit('kicked');
      target.disconnect(true);
    }
    broadcastTeacherState();
  });

  // ---------- นักเรียน ----------
  socket.on('player:join', (rawName) => {
    const name = String(rawName || '').trim().slice(0, 20) || 'ผู้เล่น';
    players.set(socket.id, {
      id: socket.id,
      name,
      score: 0, wins: 0, draws: 0, losses: 0,
      status: 'lobby',
      matchId: null,
    });
    socket.data.role = 'player';
    socket.emit('player:joined', { id: socket.id, name, matchmakingOpen });
    broadcastTeacherState();
  });

  // นักเรียนกดพร้อมเล่น / เล่นต่อ → เข้าคิว
  socket.on('player:ready', () => {
    const p = players.get(socket.id);
    if (!p || p.status === 'playing') return;
    if (!matchmakingOpen) {
      p.status = 'lobby';
      socket.emit('queue:waiting', { matchmakingOpen });
      broadcastTeacherState();
      return;
    }
    enqueue(socket.id);
    socket.emit('queue:waiting', { matchmakingOpen });
    broadcastTeacherState();
  });

  socket.on('player:move', ({ matchId, index }) => {
    const match = matches.get(matchId);
    const p = players.get(socket.id);
    if (!match || !p) return;
    if (!match.players.includes(socket.id)) return;
    if (match.turn !== socket.id) return;            // ไม่ใช่ตาของคุณ
    if (index < 0 || index > 8) return;
    if (match.board[index] !== '') return;           // ช่องไม่ว่าง

    match.board[index] = match.symbols[socket.id];
    const result = checkWinner(match.board);

    if (result) {
      sendMatchUpdate(match);
      finishMatch(match, result);
      return;
    }

    // สลับตา
    match.turn = match.players.find((pid) => pid !== socket.id);
    sendMatchUpdate(match);
    broadcastTeacherState();
  });

  // นักเรียนออกจากห้อง (กลับไปหน้าแรก)
  socket.on('player:leave', () => {
    handleLeave(socket);
  });

  socket.on('disconnect', () => {
    handleLeave(socket);
  });

  function handleLeave(sock) {
    const p = players.get(sock.id);
    if (!p) {
      broadcastTeacherState();
      return;
    }
    if (p.matchId && matches.has(p.matchId)) {
      voidMatch(matches.get(p.matchId), 'คู่แข่งหลุดจากการเชื่อมต่อ');
    }
    players.delete(sock.id);
    queue = queue.filter((id) => id !== sock.id);
    broadcastTeacherState();
  }
});

// -------------------------------------------------------------------
//  หา IP ในวง LAN เพื่อบอกนักเรียน
// -------------------------------------------------------------------
function getLanIPs() {
  const ips = [];
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) ips.push(net.address);
    }
  }
  return ips;
}

server.listen(PORT, () => {
  const ips = getLanIPs();
  console.log('\n==============================================');
  console.log('  🎮  เกม OX ออนไลน์ เริ่มทำงานแล้ว!');
  console.log('==============================================');
  console.log(`  หน้าครู (แดชบอร์ด) :  http://localhost:${PORT}/teacher.html`);
  console.log('');
  console.log('  ให้นักเรียนเปิดเบราว์เซอร์แล้วพิมพ์:');
  if (ips.length) {
    ips.forEach((ip) => console.log(`     ➜  http://${ip}:${PORT}`));
  } else {
    console.log(`     ➜  http://<ไอพีเครื่องครู>:${PORT}`);
  }
  console.log('==============================================\n');
});
