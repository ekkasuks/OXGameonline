/* =====================================================================
 * teacher.js — แดชบอร์ดครู
 * ===================================================================*/
const SS_KEY = 'ox_teacher_session';
let TOKEN = null;
let dashTimer = null;
let curTab = 'overview';
let topChart = null;
let selectedRound = null;

const $ = id => document.getElementById(id);

Net.onStatusChange(online => $('offlineBar').classList.toggle('show', !online));

window.addEventListener('DOMContentLoaded', () => {
  TOKEN = sessionStorage.getItem(SS_KEY);
  $('btnLogin').addEventListener('click', doLogin);
  $('pw').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
  bindTabs();
  bindControls();
  $('mSave').addEventListener('click', saveStudent);
  $('btnToggleReg').addEventListener('click', toggleReg);
  $('aiLevel').addEventListener('change', () => {});
  $('roundSelect').addEventListener('change', () => { selectedRound = Number($('roundSelect').value); loadMatches(); });

  if (TOKEN) { showDash(); } else { showLogin(); }
});

/* ---------- login ---------- */
async function doLogin() {
  const pw = $('pw').value;
  if (!pw) return;
  $('btnLogin').disabled = true;
  $('loginMsg').innerHTML = '<div class="msg info">กำลังตรวจสอบ…</div>';
  try {
    const r = await Net.call('teacherLogin', { password: pw });
    if (!r.ok) { $('loginMsg').innerHTML = `<div class="msg err">${esc(r.error)}</div>`; $('btnLogin').disabled = false; return; }
    TOKEN = r.sessionToken;
    sessionStorage.setItem(SS_KEY, TOKEN);
    showDash();
  } catch (e) {
    $('loginMsg').innerHTML = '<div class="msg err">เชื่อมต่อ server ไม่ได้ ตรวจสอบ API_URL</div>';
    $('btnLogin').disabled = false;
  }
}
function logout() {
  sessionStorage.removeItem(SS_KEY);
  location.reload();
}
function showLogin() {
  $('view-login').classList.remove('hide');
  $('view-dash').classList.add('hide');
  $('topRight').innerHTML = '';
  stopDash();
}
function showDash() {
  $('view-login').classList.add('hide');
  $('view-dash').classList.remove('hide');
  $('topRight').innerHTML = '<button class="btn ghost sm" onclick="logout()">ออกจากระบบ</button>';
  startDash();
  loadStudents();
}

/* ---------- auth guard ---------- */
function guard(r) {
  if (r && r.authExpired) { alert('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่'); logout(); return false; }
  return true;
}
function P(extra) { return Object.assign({ sessionToken: TOKEN }, extra || {}); }

/* ---------- tabs ---------- */
function bindTabs() {
  document.querySelectorAll('.tab').forEach(t => {
    t.addEventListener('click', () => switchTab(t.dataset.tab));
  });
}
function switchTab(name) {
  curTab = name;
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.add('hide'));
  $('tab-' + name).classList.remove('hide');
  if (name === 'students') loadStudents();
  if (name === 'matches') loadMatches();
  if (name === 'leaderboard') loadLeaderboard();
}

/* ===================================================================
 * ภาพรวม (poll)
 * ===================================================================*/
function startDash() { stopDash(); pollDash(); dashTimer = setInterval(pollDash, CONFIG.POLL_TEACHER); }
function stopDash() { if (dashTimer) { clearInterval(dashTimer); dashTimer = null; } }

async function pollDash() {
  try {
    const r = await Net.call('getDashboard', P());
    if (!guard(r)) return;
    if (!r.ok) return;
    const statusMap = {
      registration: ['badge blue', 'เปิดรับลงทะเบียน'],
      running: ['badge green', 'กำลังแข่งขัน'],
      paused: ['badge orange', 'หยุดชั่วคราว'],
      finished: ['badge gray', 'จบการแข่งขัน'],
      cancelled: ['badge red', 'ยกเลิก']
    };
    const s = statusMap[r.tournamentStatus] || ['badge gray', r.tournamentStatus];
    $('ovStatus').className = s[0]; $('ovStatus').textContent = s[1];
    $('ovRound').textContent = r.totalRounds ? ` · รอบ ${r.currentRound}/${r.totalRounds}` : '';
    $('ovStudents').textContent = r.students;
    $('ovTotal').textContent = r.totalMatches;
    $('ovDone').textContent = r.finishedMatches;
    $('ovPlaying').textContent = r.inProgressMatches;
    $('ovPending').textContent = r.pendingMatches;
    $('aiLevel').value = r.aiLevel;
    updateRegBadge(r.registrationOpen);
    updateControlButtons(r);
    if (curTab === 'overview') refreshChart();
    if (curTab === 'matches' && $('roundSelect').options.length === 0) buildRoundSelect(r.totalRounds, r.currentRound);
  } catch (e) {}
}

function updateControlButtons(r) {
  const st = r.tournamentStatus;
  $('cStart').disabled = !(st === 'registration');
  $('cPause').disabled = !(st === 'running');
  $('cResume').disabled = !(st === 'paused');
  $('cNext').disabled = !(st === 'running');
  $('cReset').disabled = false;
  $('cCancel').disabled = !(st === 'running' || st === 'paused');
  $('cFinish').disabled = !(st === 'running' || st === 'paused');
  $('cStart').textContent = (st === 'finished' || st === 'cancelled') ? '▶ เริ่มใหม่ (ต้องรีเซ็ตก่อน)' : '▶ เริ่มการแข่งขัน';
}

/* ===================================================================
 * นักเรียน
 * ===================================================================*/
async function loadStudents() {
  try {
    const r = await Net.call('listStudents', P());
    if (!guard(r) || !r.ok) return;
    const tb = $('studentRows');
    tb.innerHTML = r.students.map((s, i) => `
      <tr>
        <td>${i + 1}</td>
        <td>${esc(s.fullName)}</td>
        <td>${esc(s.classRoom || '-')}</td>
        <td class="row-actions">
          <button class="btn ghost sm" onclick="openEditStudent('${s.studentId}','${escAttr(s.fullName)}','${escAttr(s.classRoom)}')">แก้ไข</button>
          <button class="btn red sm" onclick="removeStudent('${s.studentId}','${escAttr(s.fullName)}')">ลบ</button>
        </td>
      </tr>`).join('') || '<tr><td colspan="4" class="center" style="color:var(--muted)">ยังไม่มีนักเรียนลงทะเบียน</td></tr>';
  } catch (e) {}
}
function escAttr(s) { return esc(s).replace(/'/g, '&#39;'); }

function updateRegBadge(open) {
  $('regBadge').innerHTML = open
    ? '<span class="badge green">เปิดรับลงทะเบียน</span>'
    : '<span class="badge red">ปิดรับลงทะเบียน</span>';
  $('btnToggleReg').textContent = open ? 'ปิดรับลงทะเบียน' : 'เปิดรับลงทะเบียน';
  $('btnToggleReg').dataset.open = open ? '1' : '0';
}
async function toggleReg() {
  const open = $('btnToggleReg').dataset.open === '1';
  const r = await Net.call('setRegistration', P({ open: !open }));
  if (!guard(r)) return;
  pollDash();
}

function openAddStudent() {
  $('modalTitle').textContent = 'เพิ่มนักเรียน';
  $('mStudentId').value = ''; $('mName').value = ''; $('mRoom').value = '';
  $('modalMsg').innerHTML = '';
  openModal('modalStudent');
}
function openEditStudent(id, name, room) {
  $('modalTitle').textContent = 'แก้ไขนักเรียน';
  $('mStudentId').value = id;
  $('mName').value = name === '-' ? '' : name;
  $('mRoom').value = room === '-' ? '' : room;
  $('modalMsg').innerHTML = '';
  openModal('modalStudent');
}
async function saveStudent() {
  const id = $('mStudentId').value;
  const name = $('mName').value.trim();
  const room = $('mRoom').value.trim();
  if (name.length < 2) { $('modalMsg').innerHTML = '<div class="msg err">กรุณากรอกชื่อ</div>'; return; }
  const action = id ? 'editStudent' : 'addStudent';
  const r = await Net.call(action, P({ studentId: id, fullName: name, classRoom: room }));
  if (!guard(r)) return;
  if (!r.ok) { $('modalMsg').innerHTML = `<div class="msg err">${esc(r.error)}</div>`; return; }
  closeModal('modalStudent');
  loadStudents(); pollDash();
}
async function removeStudent(id, name) {
  if (!confirm(`ลบนักเรียน "${name}" ?`)) return;
  const r = await Net.call('removeStudent', P({ studentId: id }));
  if (!guard(r)) return;
  if (!r.ok) { alert(r.error); return; }
  loadStudents(); pollDash();
}

/* ===================================================================
 * ควบคุมการแข่งขัน
 * ===================================================================*/
function bindControls() {
  $('cStart').addEventListener('click', startTournament);
  $('cPause').addEventListener('click', () => doControl('pauseTournament', 'หยุดการแข่งขันชั่วคราว'));
  $('cResume').addEventListener('click', () => doControl('resumeTournament', 'เล่นต่อ'));
  $('cNext').addEventListener('click', advanceRound);
  $('cReset').addEventListener('click', resetTournament);
  $('cCancel').addEventListener('click', () => { if (confirm('ยกเลิกการแข่งขันทั้งหมด?')) doControl('cancelTournament', 'ยกเลิกแล้ว'); });
  $('cFinish').addEventListener('click', () => { if (confirm('ปิด/จบการแข่งขัน?')) doControl('finishTournament', 'ปิดการแข่งขันแล้ว'); });
}
function ctrlMsg(type, msg) { $('controlMsg').innerHTML = `<div class="msg ${type}">${esc(msg)}</div>`; }

async function startTournament() {
  if (!confirm('เริ่มการแข่งขัน? ระบบจะสร้างตาราง Round Robin และปิดรับลงทะเบียน')) return;
  const r = await Net.call('startTournament', P());
  if (!guard(r)) return;
  if (!r.ok) { ctrlMsg('err', r.error); return; }
  ctrlMsg('ok', `สร้างตารางสำเร็จ: ${r.rounds} รอบ · ${r.matches} แมตช์`);
  pollDash();
}
async function advanceRound(force) {
  const r = await Net.call('advanceRound', P({ force: force === true }));
  if (!guard(r)) return;
  if (!r.ok) {
    if (r.unfinished) {
      if (confirm(`${r.error}\n\nต้องการข้ามไปรอบถัดไปเลยหรือไม่? (แมตช์ที่ค้างจะไม่ถูกนับผล — ควรแก้ผลก่อน)`)) {
        advanceRound(true);
      }
      return;
    }
    ctrlMsg('err', r.error); return;
  }
  if (r.finished) ctrlMsg('ok', 'ครบทุกรอบแล้ว — การแข่งขันจบ 🏁');
  else ctrlMsg('ok', `เดินไปรอบที่ ${r.currentRound}`);
  pollDash();
}
async function resetTournament() {
  if (!confirm('⚠️ รีเซ็ตการแข่งขัน จะลบตารางแข่ง/การเดิน/คะแนนทั้งหมด (รายชื่อนักเรียนยังอยู่) ยืนยัน?')) return;
  if (!confirm('ยืนยันอีกครั้ง: ลบผลการแข่งขันทั้งหมด?')) return;
  const r = await Net.call('resetTournament', P({ confirm: true }));
  if (!guard(r)) return;
  if (!r.ok) { ctrlMsg('err', r.error); return; }
  ctrlMsg('ok', 'รีเซ็ตเรียบร้อย กลับสู่สถานะรับลงทะเบียน');
  pollDash();
}
async function doControl(action, okMsg) {
  const r = await Net.call(action, P());
  if (!guard(r)) return;
  if (!r.ok) { ctrlMsg('err', r.error); return; }
  ctrlMsg('ok', okMsg); pollDash();
}
async function saveAiLevel() {
  const r = await Net.call('setAiLevel', P({ level: $('aiLevel').value }));
  if (!guard(r)) return;
  ctrlMsg('ok', 'บันทึกระดับ AI แล้ว');
}

/* ===================================================================
 * ตารางแข่งขัน
 * ===================================================================*/
function buildRoundSelect(total, current) {
  const sel = $('roundSelect');
  sel.innerHTML = '';
  for (let i = 1; i <= total; i++) {
    const op = document.createElement('option');
    op.value = i; op.textContent = `รอบ ${i}` + (i === current ? ' (ปัจจุบัน)' : '');
    sel.appendChild(op);
  }
  selectedRound = current || 1;
  sel.value = selectedRound;
}
async function loadMatches() {
  try {
    const r = await Net.call('getMatches', P({ round: selectedRound }));
    if (!guard(r) || !r.ok) return;
    if ($('roundSelect').options.length === 0 && r.totalRounds) buildRoundSelect(r.totalRounds, r.currentRound);
    const tb = $('matchRows');
    tb.innerHTML = r.matches.map(m => `
      <tr>
        <td>${m.round}</td>
        <td>${esc(m.player1)}</td>
        <td>${esc(m.player2)}</td>
        <td>${matchStatusBadge(m.status)}</td>
        <td>${esc(m.winnerName || '-')}</td>
        <td><button class="btn ghost sm" onclick="openMatch('${m.matchId}')">ดู</button></td>
      </tr>`).join('') || '<tr><td colspan="6" class="center" style="color:var(--muted)">ยังไม่มีตารางแข่งขัน — กด "เริ่มการแข่งขัน"</td></tr>';
  } catch (e) {}
}
function matchStatusBadge(st) {
  const m = { pending: ['badge gray', 'ยังไม่เริ่ม'], in_progress: ['badge orange', 'กำลังแข่ง'], finished: ['badge green', 'จบแล้ว'] };
  const x = m[st] || ['badge gray', st];
  return `<span class="${x[0]}">${x[1]}</span>`;
}

async function openMatch(matchId) {
  const r = await Net.call('getMatchDetail', P({ matchId }));
  if (!guard(r)) return;
  if (!r.ok) { alert(r.error); return; }
  const d = r.detail;
  const b = d.board.split('');
  const grid = b.map(c => `<div class="${c === 'X' ? 'x' : c === 'O' ? 'o' : ''}">${c === 'X' ? '✕' : c === 'O' ? '◯' : ''}</div>`).join('');
  const movesHtml = d.moves.length
    ? d.moves.map(mv => `<li>ตา ${mv.moveNo}: <b>${esc(mv.player)}</b> เดิน ${mv.mark} ช่อง ${mv.cell + 1}</li>`).join('')
    : '<li style="color:var(--muted)">ยังไม่มีการเดิน</li>';

  $('matchDetailBody').innerHTML = `
    <p>รอบ ${d.round} · <b>${esc(d.player1)}</b> (X) vs <b>${esc(d.player2)}</b> (O)</p>
    <p>สถานะ: ${matchStatusBadge(d.status)} · ผล: <b>${esc(d.winnerName)}</b></p>
    <div class="mini-board" style="margin:10px 0">${grid}</div>
    <div class="section-title">ประวัติการเดิน</div>
    <ul style="margin:0;padding-left:18px">${movesHtml}</ul>
    ${buildEditResultForm(d, matchId)}`;
  openModal('modalMatch');
}

function buildEditResultForm(d, matchId) {
  return `
    <hr style="margin:16px 0;border:none;border-top:1px solid var(--line)">
    <div class="section-title">แก้ไขผล (เฉพาะกรณีจำเป็น · บันทึกประวัติไว้)</div>
    <div class="field">
      <label>เลือกผู้ชนะ</label>
      <select id="editWinner" class="field" style="margin:0">
        <option value="p1">${esc(d.player1)} ชนะ</option>
        <option value="p2">${esc(d.player2)} ชนะ</option>
        <option value="draw">เสมอ</option>
      </select>
    </div>
    <div class="field"><label>เหตุผล</label><input id="editReason" type="text" placeholder="เช่น นักเรียนไม่มาแข่ง"></div>
    <button class="btn orange sm" onclick="saveEditResult('${matchId}')">บันทึกผลใหม่</button>`;
}

async function saveEditResult(matchId) {
  // ต้องแปลง p1/p2 เป็น studentId จริง -> ขอจาก backend ผ่าน getMatches (มี player1Id/player2Id)
  const sel = $('editWinner').value;
  const reason = $('editReason').value.trim();
  const mr = await Net.call('getMatches', P({}));
  if (!guard(mr)) return;
  const m = (mr.matches || []).find(x => x.matchId === matchId);
  if (!m) { alert('ไม่พบแมตช์'); return; }
  let winnerId = sel === 'draw' ? 'draw' : (sel === 'p1' ? m.player1Id : m.player2Id);
  if (!confirm('ยืนยันแก้ไขผลการแข่งขัน?')) return;
  const r = await Net.call('editResult', P({ matchId, winnerId, reason }));
  if (!guard(r)) return;
  if (!r.ok) { alert(r.error); return; }
  closeModal('modalMatch');
  loadMatches(); pollDash();
}

/* ===================================================================
 * ตารางคะแนน + กราฟ
 * ===================================================================*/
async function loadLeaderboard() {
  try {
    const r = await Net.call('getLeaderboard', P());
    if (!r.ok) return;
    const tb = $('lbRows');
    tb.innerHTML = r.leaderboard.map(x => `
      <tr>
        <td class="${x.rank <= 3 ? 'rank-' + x.rank : ''}">${x.rank}</td>
        <td>${esc(x.fullName)}${x.classRoom ? ' <span style="color:var(--muted)">(' + esc(x.classRoom) + ')</span>' : ''}</td>
        <td class="center">${x.games}</td>
        <td class="center">${x.wins}</td>
        <td class="center">${x.draws}</td>
        <td class="center">${x.losses}</td>
        <td class="center"><b>${x.points}</b></td>
      </tr>`).join('') || '<tr><td colspan="7" class="center" style="color:var(--muted)">ยังไม่มีคะแนน</td></tr>';
  } catch (e) {}
}

async function refreshChart() {
  try {
    const r = await Net.call('getLeaderboard', P());
    if (!r.ok) return;
    const top = r.leaderboard.slice(0, 10);
    const labels = top.map(x => x.fullName);
    const data = top.map(x => x.points);
    if (!topChart) {
      topChart = new Chart($('chartTop'), {
        type: 'bar',
        data: { labels, datasets: [{ label: 'คะแนนรวม', data, backgroundColor: '#2563eb', borderRadius: 6 }] },
        options: {
          plugins: { legend: { display: false } },
          scales: { y: { beginAtZero: true, ticks: { precision: 0 } } },
          maintainAspectRatio: true
        }
      });
    } else {
      topChart.data.labels = labels;
      topChart.data.datasets[0].data = data;
      topChart.update();
    }
  } catch (e) {}
}

/* ---------- modal helpers ---------- */
function openModal(id) { $(id).classList.add('show'); }
function closeModal(id) { $(id).classList.remove('show'); }
