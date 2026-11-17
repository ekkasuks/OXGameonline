/* =====================================================================
 * api.js — ตัวกลางเรียก Google Apps Script Backend
 * ส่งแบบ POST text/plain เพื่อเลี่ยง CORS preflight
 * ===================================================================*/

const Net = {
  online: true,
  _listeners: [],

  onStatusChange(fn) { this._listeners.push(fn); },
  _emit() { this._listeners.forEach(fn => fn(this.online)); },
  _set(v) { if (this.online !== v) { this.online = v; this._emit(); } },

  async call(action, payload = {}) {
    if (!CONFIG.API_URL || CONFIG.API_URL.indexOf('PASTE_YOUR') === 0) {
      throw new Error('ยังไม่ได้ตั้งค่า API_URL ใน js/config.js');
    }
    const body = JSON.stringify(Object.assign({ action }, payload));
    try {
      const res = await fetch(CONFIG.API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body,
        redirect: 'follow'
      });
      const text = await res.text();
      let data;
      try { data = JSON.parse(text); }
      catch (e) { throw new Error('การตอบกลับไม่ถูกต้องจาก server'); }
      this._set(true);
      return data;
    } catch (err) {
      // ความผิดพลาดจากเครือข่าย
      this._set(false);
      throw err;
    }
  }
};

// helper: escape HTML กัน XSS จากชื่อนักเรียน
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
