/**
 * notification.js — /feature-bev (v3)
 * MCL Subcontract System — Shared Notification Library
 *
 * Active triggers (5):
 *   T1  Manager ขอโควต้า / แก้ไข / ยกเลิก   → HR ที่ระบุชื่อ
 *   T2  HR จัดสรร / แก้ไข / ยกเลิก          → Admin Sub ที่เกี่ยวข้อง
 *   T3  Employee ลงทะเบียน                   → Admin Sub บริษัทที่เลือก
 *   T4  Admin Sub ยืนยันบัตร                 → Employee
 *   T5  Blacklist เกิดขึ้น                   → HR ทุกคน + Admin Sub ทุกคน
 *
 * Import เฉพาะในไฟล์: dept.html, hr.html, admin.html, visitor.html
 *   <script src="notification.js"></script>  (ก่อน </body>)
 *
 * Requires: firebase (compat v9) initialized globally as `db`
 */

'use strict';

const Notif = (() => {

  const LIFF_ID       = 'YOUR_LIFF_ID';
  const LIFF_BASE_URL = `https://liff.line.me/${LIFF_ID}`;
  const QUEUE_COL     = 'notification_queue';

  // ─── Core push ────────────────────────────────────────────────────────────
  async function push(type, context, lineUids, payload) {
    const valid = [...new Set((lineUids || []).filter(Boolean))];
    if (!valid.length) {
      console.warn(`[Notif:${type}] no valid lineUids — skipped`);
      return;
    }
    try {
      await db.collection(QUEUE_COL).add({
        type,
        ...context,
        recipients: valid.map(uid => ({ lineUid: uid, sent: false, sentAt: null })),
        payload,
        status   : 'pending',
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
    } catch (e) {
      console.error(`[Notif:${type}] push failed:`, e);
    }
  }

  // ─── Flex builder ─────────────────────────────────────────────────────────
  function buildFlex(headerText, headerColor, rows, actions = []) {
    return {
      type    : 'flex',
      altText : headerText,
      contents: {
        type  : 'bubble',
        size  : 'kilo',
        header: {
          type: 'box', layout: 'horizontal',
          backgroundColor: '#0d1117', paddingAll: '12px',
          contents: [{ type: 'text', text: headerText,
            weight: 'bold', color: headerColor, size: 'sm' }],
        },
        body: {
          type: 'box', layout: 'vertical',
          backgroundColor: '#161b27', paddingAll: '12px', spacing: 'sm',
          contents: rows.map(r => ({
            type: 'box', layout: 'baseline', spacing: 'sm',
            contents: [
              { type: 'text', text: r.label,          color: '#94a3b8', size: 'xs', flex: 3 },
              { type: 'text', text: String(r.value ?? '—'), color: '#f1f5f9', size: 'sm', flex: 5, wrap: true },
            ],
          })),
        },
        ...(actions.length ? {
          footer: {
            type: 'box', layout: 'vertical',
            backgroundColor: '#161b27', paddingAll: '10px', paddingTop: '0', spacing: 'sm',
            contents: actions.map((a, i) => ({
              type: 'button', height: 'sm',
              style: i === 0 ? 'primary' : 'secondary',
              color: i === 0 ? headerColor : undefined,
              margin: i > 0 ? 'sm' : undefined,
              action: a.uri
                ? { type: 'uri',     label: a.label, uri: a.uri }
                : { type: 'postback',label: a.label, data: a.data, displayText: a.label },
            })),
          },
        } : {}),
      },
    };
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────
  function _hhmmNow() {
    const d = new Date();
    return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  }

  // แปลง type ย่อย → ป้ายข้อความภาษาไทย
  const QUOTA_ACTION_LABEL = {
    created : 'ส่งคำขอใหม่',
    edited  : 'แก้ไขคำขอ',
    cancelled: 'ยกเลิกคำขอ',
  };

  const ALLOC_ACTION_LABEL = {
    allocated : 'จัดสรรโควต้า',
    edited    : 'แก้ไขการจัดสรร',
    cancelled : 'ยกเลิกการจัดสรร',
  };

  const QUOTA_HEADER_COLOR = {
    created  : '#10b981',
    edited   : '#f59e0b',
    cancelled: '#ef4444',
  };

  const ALLOC_HEADER_COLOR = {
    allocated : '#a78bfa',
    edited    : '#f59e0b',
    cancelled : '#ef4444',
  };

  // ─────────────────────────────────────────────────────────────────────────
  // T1 — Manager ขอโควต้า / แก้ไข / ยกเลิก
  // เรียกจาก: dept.html
  //
  // @param action  'created' | 'edited' | 'cancelled'
  // @param hrLineUid  lineUid ของ HR ที่ Manager เลือก (field hrAssignedLineUid)
  // ─────────────────────────────────────────────────────────────────────────
  async function quotaRequest({
    action = 'created',
    quotaRequestId,
    hrLineUid,
    deptName, warehouseName,
    amount, startDate, endDate,
    salary, shiftAllowance,
    managerName,
  }) {
    const label  = QUOTA_ACTION_LABEL[action]  || action;
    const color  = QUOTA_HEADER_COLOR[action]  || '#10b981';
    const header = `📋 โควต้า — ${label}`;

    const rows = [
      { label: 'แผนก',      value: `${deptName} · ${warehouseName}` },
      { label: 'จำนวน',    value: `${amount} อัตรา` },
      { label: 'ช่วงเวลา', value: `${startDate} – ${endDate}` },
      { label: 'ค่าแรง',   value: `${salary} + ${shiftAllowance} ฿/วัน` },
      { label: 'โดย',      value: managerName },
    ];

    // ยกเลิก → ไม่มีปุ่ม
    const actions = action === 'cancelled' ? [] : [
      { label: 'ดูคำขอ', uri: `${LIFF_BASE_URL}?page=hr&tab=quota&id=${quotaRequestId}` },
    ];

    const flex = buildFlex(header, color, rows, actions);

    await push(
      `quota_${action}`,
      { quotaRequestId, deptName, amount, action },
      [hrLineUid],
      { title: header, body: `${deptName} · ${amount} อัตรา`, flex },
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // T2 — HR จัดสรรโควต้า / แก้ไข / ยกเลิก
  // เรียกจาก: hr.html — เรียก 1 ครั้งต่อ 1 บริษัทที่เกี่ยวข้อง
  //
  // @param action  'allocated' | 'edited' | 'cancelled'
  // @param adminLineUid  lineUid ของ Admin Sub บริษัทนั้น
  // ─────────────────────────────────────────────────────────────────────────
  async function quotaAllocated({
    action = 'allocated',
    quotaRequestId, adminLineUid, companyId,
    projectName, amount,
    salary, shiftAllowance,
    startDate, endDate,
  }) {
    const label  = ALLOC_ACTION_LABEL[action]  || action;
    const color  = ALLOC_HEADER_COLOR[action]  || '#a78bfa';
    const header = `📦 โควต้า — ${label}`;

    const rows = [
      { label: 'โครงการ', value: projectName },
      { label: 'จำนวน',  value: `${amount} อัตรา` },
      { label: 'ค่าแรง', value: `${salary} + ${shiftAllowance} ฿/วัน` },
      { label: 'ช่วง',   value: `${startDate} – ${endDate}` },
    ];

    const actions = action === 'cancelled' ? [] : [
      { label: 'ดูรายละเอียด', uri: `${LIFF_BASE_URL}?page=admin&tab=quota&id=${quotaRequestId}` },
    ];

    const flex = buildFlex(header, color, rows, actions);

    await push(
      `alloc_${action}`,
      { quotaRequestId, companyId, amount, action },
      [adminLineUid],
      { title: header, body: `${projectName} · ${amount} อัตรา`, flex },
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // T3 — Employee กรอกฟอร์มลงทะเบียน
  // เรียกจาก: visitor.html หลัง Firestore write
  //
  // @param adminLineUid  lineUid ของ Admin Sub บริษัทที่ Employee เลือก
  // ─────────────────────────────────────────────────────────────────────────
  async function employeeRegistered({
    userId, adminLineUid,
    employeeName, companyName,
    registeredAt,
  }) {
    const header = '🆕 มีพนักงานลงทะเบียนใหม่';
    const flex = buildFlex(header, '#3b82f6', [
      { label: 'ชื่อ',        value: employeeName },
      { label: 'บริษัท',     value: companyName },
      { label: 'ลงทะเบียน', value: registeredAt || _hhmmNow() },
    ], [
      { label: 'อนุมัติบัตร', uri: `${LIFF_BASE_URL}?page=admin&tab=approve&uid=${userId}` },
    ]);

    await push(
      'employee_registered',
      { userId, companyName },
      [adminLineUid],
      { title: header, body: `${employeeName} · ${companyName}`, flex },
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // T4 — Admin Sub ยืนยันบัตรพนักงาน
  // เรียกจาก: admin.html หลัง users.status → 'approved'
  //
  // @param employeeLineUid  lineUid ของ Employee
  // ─────────────────────────────────────────────────────────────────────────
  async function badgeApproved({
    userId, employeeLineUid,
    companyName, deptName, warehouseName,
  }) {
    const header = '🪪 บัตรพนักงานพร้อมใช้งาน!';
    const flex = buildFlex(header, '#10b981', [
      { label: 'บริษัท', value: companyName },
      { label: 'แผนก',  value: deptName },
      { label: 'คลัง',  value: warehouseName },
    ], [
      { label: 'เปิดบัตร QR', uri: `${LIFF_BASE_URL}?page=employee&tab=badge` },
    ]);

    await push(
      'badge_approved',
      { userId },
      [employeeLineUid],
      { title: header, body: `${companyName} · ${deptName}`, flex },
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // T5 — Blacklist เกิดขึ้น
  // เรียกจาก: hr.html หลัง users.blacklist.isBlacklisted → true
  //
  // @param hrLineUids    lineUid[] ของ HR ทุกคน (caller resolve ก่อนส่ง)
  // @param adminLineUids lineUid[] ของ Admin Sub ทุกบริษัท
  // ─────────────────────────────────────────────────────────────────────────
  async function blacklisted({
    userId, employeeName, companyName,
    reason, bannedByName,
    hrLineUids, adminLineUids,
  }) {
    const header = '⛔ พนักงานถูก Blacklist';
    const allUids = [...new Set([...(hrLineUids || []), ...(adminLineUids || [])])];

    const flex = buildFlex(header, '#ef4444', [
      { label: 'ชื่อ',      value: employeeName },
      { label: 'บริษัท',   value: companyName },
      { label: 'เหตุผล',  value: reason },
      { label: 'โดย',     value: bannedByName },
    ]);

    await push(
      'blacklisted',
      { userId, employeeName, reason },
      allUids,
      { title: header, body: `${employeeName} — ${reason}`, flex },
    );
  }

  // ─── Public API ────────────────────────────────────────────────────────────
  return { quotaRequest, quotaAllocated, employeeRegistered, badgeApproved, blacklisted };

})();
