/* =====================================================================
 * OX ONLINE TOURNAMENT — ค่าตั้งค่าฝั่ง Frontend
 * ---------------------------------------------------------------------
 * วิธีใช้: หลัง Deploy Google Apps Script เป็น Web App แล้ว
 * ให้นำ URL ที่ได้ (ลงท้ายด้วย /exec) มาวางแทนค่าด้านล่างนี้
 * =====================================================================*/

const CONFIG = {
  // 🔴 แก้ตรงนี้: วาง Web App URL ของคุณ (ลงท้าย /exec)
  API_URL: 'https://script.google.com/macros/s/AKfycbzDYs2EmNPRDeArAMhokXSPKokY8XtW8lG_a-eUNbR_zx7uUGtR3HYgmaqUYeKt9xYg/exec',

  // ช่วงเวลา polling (มิลลิวินาที)
  POLL_GAME: 1200,       // ระหว่างเล่นเกม (ถี่ขึ้นเล็กน้อย)
  POLL_GAME_WAIT: 900,   // เมื่อกำลังรอคู่แข่ง/บอทเดิน เร่งให้ถี่ขึ้น
  POLL_LOBBY: 3500,      // หน้าห้องรอ
  POLL_TEACHER: 3000,    // แดชบอร์ดครู

  VERSION: '1.0.0'
};
