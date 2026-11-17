# ⭕❌ OX ONLINE TOURNAMENT

ระบบแข่งขันเกม OX (Tic-Tac-Toe) ออนไลน์สำหรับโรงเรียน — นักเรียนหลายคนเล่นพร้อมกันจากคอมพิวเตอร์คนละเครื่อง มีหน้าจอครูควบคุมการแข่งขันแบบพบกันหมด (Round Robin) พร้อมคู่แข่ง AI สำหรับจำนวนผู้เล่นเลขคี่

- **Frontend:** HTML5 + CSS3 + JavaScript (โฮสต์ฟรีบน GitHub Pages)
- **Backend:** Google Apps Script Web App (ควบคุมความจริงทั้งหมด)
- **Database:** Google Sheets (6 ชีต)
- **Real-time:** Polling (เล่นเกม 1.5 วิ / ห้องรอ 4 วิ)

---

## 📁 โครงสร้างไฟล์

```
OXGameonline/
├── index.html          หน้าเลือกบทบาท
├── student.html        หน้านักเรียน (ลงทะเบียน/ห้องรอ/เล่นเกม)
├── teacher.html        หน้าครู (ล็อกอิน/แดชบอร์ด/ควบคุม)
├── css/style.css       ธีมทั้งหมด
├── js/
│   ├── config.js       ⚙️ ตั้งค่า API_URL (ต้องแก้)
│   ├── api.js          ตัวกลางเรียก Backend + ตรวจออฟไลน์
│   ├── student.js      ตรรกะนักเรียน
│   └── teacher.js      ตรรกะครู
├── backend/
│   └── Code.gs         Backend ทั้งหมด (วางใน Google Apps Script)
├── README.md           ไฟล์นี้
├── คู่มือครู.md
└── คู่มือนักเรียน.md
```

---

## 🚀 ติดตั้งทีละขั้นตอน

### ขั้นที่ 1 — สร้าง Google Sheets + ติดตั้ง Backend

1. ไปที่ [sheets.new](https://sheets.new) สร้าง Google Sheet ใหม่ ตั้งชื่อ เช่น `OX Tournament DB`
2. เมนู **ส่วนขยาย (Extensions) → Apps Script**
3. ลบโค้ดเดิมทั้งหมดในไฟล์ `Code.gs` แล้ววางเนื้อหาจาก `backend/Code.gs` ของโปรเจกต์นี้
4. **เปลี่ยนรหัสผ่านครู** ที่บรรทัด `DEFAULT_TEACHER_PASSWORD: 'teacher1234'` ให้เป็นรหัสของคุณ
5. กด 💾 บันทึก แล้วเลือกฟังก์ชัน **`setup`** จากเมนูด้านบน กด **▶ Run**
   - ครั้งแรกจะขออนุญาตเข้าถึง Google Sheet → กด **Review permissions → เลือกบัญชี → Advanced → Go to (unsafe) → Allow**
   - เมื่อสำเร็จจะเห็นชีต `Students, Matches, GameMoves, Scores, Settings, AuditLog` ถูกสร้าง

> 💡 ถ้าแก้รหัสผ่านครูภายหลัง ให้แก้ค่าใน `CONFIG` แล้วรัน `setup()` ซ้ำ (จะล้างข้อมูลแข่งขัน) หรือแก้ `teacherPasswordHash` เองในชีต Settings

### ขั้นที่ 2 — Deploy เป็น Web App

1. ในหน้า Apps Script กดมุมขวาบน **Deploy → New deployment**
2. ไอคอนเฟือง ⚙️ เลือก **Web app**
3. ตั้งค่า:
   - **Description:** `OX Tournament API`
   - **Execute as:** `Me (บัญชีของคุณ)`
   - **Who has access:** `Anyone` ← สำคัญ! (นักเรียนเรียกโดยไม่ต้องล็อกอิน Google)
4. กด **Deploy → Authorize access** (ถ้าถาม) → คัดลอก **Web app URL** (ลงท้าย `/exec`)

> ⚠️ ทุกครั้งที่แก้ `Code.gs` ต้องกด **Deploy → Manage deployments → ✏️ → Version: New version → Deploy** เพื่อให้ URL เดิมใช้โค้ดใหม่

### ขั้นที่ 3 — เชื่อม Frontend กับ Backend

เปิดไฟล์ `js/config.js` แก้บรรทัดเดียว:
```js
API_URL: 'https://script.google.com/macros/s/XXXXXXXX/exec',
```
วาง URL จากขั้นที่ 2 แทน `PASTE_YOUR_WEB_APP_URL_HERE`

### ขั้นที่ 4 — ตั้งค่า GitHub Pages

1. สร้าง repository ใหม่บน GitHub แล้วอัปโหลดไฟล์ทั้งหมด (หรือ `git push`)
2. ไปที่ **Settings → Pages**
3. **Source:** `Deploy from a branch` → **Branch:** `main` / โฟลเดอร์ `/ (root)` → **Save**
4. รอ 1–2 นาที จะได้ URL เช่น `https://ชื่อผู้ใช้.github.io/OXGameonline/`
5. แจกลิงก์นี้ให้นักเรียน — ครูเปิดหน้าเดียวกันแล้วเลือก "ครู"

> ทดสอบในเครื่องก่อนได้: เปิดโฟลเดอร์แล้วรัน `python3 -m http.server 8000` → เปิด `http://localhost:8000`

---

## 🎮 วิธีใช้งานโดยย่อ

| บทบาท | ทำอะไร |
|---|---|
| **นักเรียน** | เปิดลิงก์ → เลือก "นักเรียน" → กรอกชื่อ → รอครูเริ่ม → เล่นเกมอัตโนมัติ |
| **ครู** | เปิดลิงก์ → เลือก "ครู" → ใส่รหัสผ่าน → เริ่มการแข่งขัน → กด "เดินรอบถัดไป" เมื่อทุกคู่ในรอบจบ |

ดูรายละเอียดใน [คู่มือครู](คู่มือครู.md) และ [คู่มือนักเรียน](คู่มือนักเรียน.md)

### รูปแบบการแข่งขัน (ครูกดเดินรอบเอง)
1. ครูกด **เริ่มการแข่งขัน** → ระบบสร้างตาราง Round Robin ทั้งหมด และเปิดรอบที่ 1
2. นักเรียนที่มีคู่ในรอบปัจจุบันจะเข้าเกมอัตโนมัติ เล่นพร้อมกันทั้งห้อง
3. เมื่อทุกคู่ในรอบจบ ครูกด **เดินรอบถัดไป** → เข้ารอบใหม่
4. ทำซ้ำจนครบทุกรอบ → ระบบสรุปอันดับใน **ตารางคะแนน**

---

## 🔐 ความปลอดภัย (ออกแบบไว้)

- Backend ตรวจ `studentId + token` ทุกคำสั่ง — ปลอมตัวเป็นคนอื่นไม่ได้
- ตรวจ **ตาของผู้เล่น / ช่องว่าง / การเดินซ้ำ / สถานะเกม** ที่ Backend — เบราว์เซอร์สั่งเดินมั่วไม่ได้
- **คะแนนคำนวณที่ Backend** จากผลแมตช์จริง — แก้คะแนนจากเบราว์เซอร์ไม่ได้
- รหัสผ่านครูเก็บเป็น **SHA-256 + salt** ไม่เคยส่งไป Frontend; ล็อกอินแล้วได้ session token มีอายุ
- `LockService` กันการเขียนชนกันเมื่อหลายคนเดินพร้อมกัน
- ทุกการกระทำสำคัญ + การแก้ไขผล บันทึกใน `AuditLog`

---

## 💾 สำรอง & รีเซ็ตข้อมูล

**สำรองข้อมูล:** เปิด Google Sheet → **ไฟล์ → ทำสำเนา (Make a copy)** หรือ **ดาวน์โหลด → Microsoft Excel (.xlsx)** เก็บไว้ก่อนเริ่ม/หลังจบการแข่งขัน

**รีเซ็ตเพื่อแข่งรอบใหม่:**
- ปุ่ม **รีเซ็ตการแข่งขัน** ในหน้าครู → ล้าง `Matches/GameMoves/Scores` แต่ **เก็บรายชื่อนักเรียน** กลับสู่สถานะรับลงทะเบียน
- ล้างทั้งหมดรวมนักเรียน: รันฟังก์ชัน `setup()` ใน Apps Script อีกครั้ง

---

## ✅ ผลการทดสอบอัลกอริทึม

ทดสอบด้วย Node (`scratchpad/test_algo.js`) ยืนยันแล้ว:
- **Round Robin** N=2 ถึง 10: ทุกคนพบกันครบ · ไม่มีคู่ซ้ำ · จำนวนแมตช์ต่อคนเท่ากัน · เลขคี่เจอ AI คนละ 1 ครั้ง (N=5 → 5 รอบ 10 คู่ ✔ ตรงสเปก)
- **AI ระดับยาก (Minimax)** เล่น 2000 เกมกับฝ่ายสุ่ม → ไม่แพ้เลย (ชนะ 1625 / เสมอ 375)

---

## 🧩 รายการ API (อ้างอิง)

| กลุ่ม | action |
|---|---|
| นักเรียน | `register`, `getLobby`, `getMyMatch`, `getMatchState`, `makeMove` |
| สาธารณะ | `getPublicStatus`, `getLeaderboard` |
| ครู | `teacherLogin`, `getDashboard`, `listStudents`, `addStudent`, `editStudent`, `removeStudent`, `setRegistration`, `setAiLevel`, `startTournament`, `advanceRound`, `pauseTournament`, `resumeTournament`, `cancelTournament`, `finishTournament`, `resetTournament`, `getMatches`, `getMatchDetail`, `editResult` |

---
🤖 Generated with [Claude Code](https://claude.com/claude-code)
