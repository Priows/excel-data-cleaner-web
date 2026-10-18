import crypto from "crypto";

// Must match _SIGNED_CONTEXT in app/licensing/policy.py. Keys are signed with the seller's Ed25519 private key;
// the program only holds the public key, so it can check keys but nobody can make them from the program.
const SIGNED_CONTEXT = "ExcelDataCleaner-Offline-License-v2:";
// PKCS#8 header for a raw 32-byte Ed25519 private key.
const ED25519_PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

function base64UrlEncode(buffer) {
  return Buffer.from(buffer)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function loadPrivateKey(text) {
  const seed = Buffer.from(String(text).trim().replace(/-/g, "+").replace(/_/g, "/"), "base64");
  if (seed.length !== 32) {
    throw new Error("EDC_LICENSE_PRIVATE_KEY ไม่ถูกต้อง");
  }
  return crypto.createPrivateKey({ key: Buffer.concat([ED25519_PKCS8_PREFIX, seed]), format: "der", type: "pkcs8" });
}

function createLicenseToken({ customer, edition = "Personal", licenseId, issuedDate, expires = "", privateKey }) {
  // ใช้วันที่โอนเงินจากสลิป (issuedDate) เพื่อให้สลิปใบเดิมได้รหัส License Key เดิมเสมอ (Idempotent Recovery)
  const issued = (issuedDate || new Date().toISOString()).slice(0, 10);
  const payloadObj = {
    v: 2,
    id: String(licenseId || "EDC-0001").trim(),
    customer: String(customer || "ผู้ใช้งานได้รับอนุญาต").trim(),
    edition: String(edition).trim(),
    issued,
    expires: String(expires).trim(),
  };
  const payloadBytes = Buffer.from(JSON.stringify(payloadObj), "utf-8");
  // Ed25519 signatures are deterministic, so the same slip still yields the same key.
  const signature = crypto.sign(null, Buffer.concat([Buffer.from(SIGNED_CONTEXT, "utf-8"), payloadBytes]), loadPrivateKey(privateKey));
  return `EDC2.${base64UrlEncode(payloadBytes)}.${base64UrlEncode(signature)}`;
}

export { createLicenseToken };

async function verifySlipWithProvider(slipBase64, expectedAmount) {
  const apiKey = process.env.SLIP_API_KEY;
  const provider = (process.env.SLIP_PROVIDER || "easyslip").toLowerCase();

  if (!apiKey) {
    throw new Error("ยังไม่ได้ตั้งค่า SLIP_API_KEY ในระบบหลังบ้าน Vercel");
  }

  // EasySlip API (https://developer.easyslip.com)
  // หมายเหตุ: ไม่เปิด checkDuplicate บล็อกทิ้ง เพื่อให้ลูกค้าที่พิมพ์อีเมลผิดหรือทำคีย์หาย
  // สามารถอัปโหลดสลิปเดิมของตัวเองเพื่อกู้คืนรหัส License Key เดิม (ที่ผูกกับเลขสลิปและชื่อผู้โอน) ได้
  if (provider === "easyslip") {
    const cleanBase64 = slipBase64.replace(/^data:image\/\w+;base64,/, "");
    const response = await fetch("https://developer.easyslip.com/api/v1/verify", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ image: cleanBase64 }),
    });
    const result = await response.json();
    if (!response.ok || result.status !== 200 || !result.data) {
      throw new Error(result.message || "ตรวจสอบสลิปไม่ผ่าน กรุณาใช้รูปสลิปที่มี QR Code ชัดเจน");
    }
    const amount = Number(result.data.amount?.amount || 0);
    const transRef = String(result.data.transRef || "");
    const transDate = String(result.data.date || new Date().toISOString());
    const receiverName = String(result.data.receiver?.account?.name?.th || "");
    const senderName = String(result.data.sender?.account?.name?.th || result.data.sender?.account?.name?.en || "");
    return { amount, transRef, transDate, receiverName, senderName };
  }

  // SlipOK API (https://slipok.com)
  if (provider === "slipok") {
    const branchId = process.env.SLIPOK_BRANCH_ID || "";
    const response = await fetch(`https://api.slipok.com/api/line/apikey/${branchId}`, {
      method: "POST",
      headers: {
        "x-authorization": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ files: slipBase64, log: false, amount: expectedAmount }),
    });
    const result = await response.json();
    if (!response.ok || !result.success || !result.data) {
      throw new Error(result.message || "ตรวจสอบสลิปไม่ผ่าน กรุณาใช้รูปสลิปที่มี QR Code ชัดเจน");
    }
    const amount = Number(result.data.amount || 0);
    const transRef = String(result.data.transRef || "");
    const transDate = String(result.data.transDate || new Date().toISOString()).slice(0, 10);
    const receiverName = String(result.data.receiver?.displayName || "");
    const senderName = String(result.data.sender?.displayName || "");
    return { amount, transRef, transDate, receiverName, senderName };
  }

  throw new Error(`ไม่รองรับผู้ให้บริการตรวจสลิป: ${provider}`);
}

async function sendLicenseEmail({ email, customer, licenseKey, licenseId }) {
  const resendKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.FROM_EMAIL || "Excel Data Cleaner <onboarding@resend.dev>";
  const sellerBcc = process.env.SELLER_NOTIFICATION_EMAIL || "";
  if (!resendKey || !email) {
    return false;
  }

  const html = `
    <div style="font-family: 'Sarabun', sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px;">
      <h2 style="color: #1f4e78; margin-top: 0;">ขอบคุณที่สั่งซื้อ Excel Data Cleaner</h2>
      <p>เรียนคุณ <strong>${customer}</strong>,</p>
      <p>ระบบได้ตรวจสอบสลิปการชำระเงินเรียบร้อยแล้ว นี่คือ <strong>License Key (รหัสปลดล็อกโปรแกรม)</strong> ของคุณครับ:</p>
      <div style="background: #f1f5f9; padding: 16px; border-radius: 8px; font-family: monospace; word-break: break-all; font-size: 14px; border: 1px solid #cbd5e1; margin: 16px 0;">
        ${licenseKey}
      </div>
      <p><strong>วิธีปลดล็อกในโปรแกรม:</strong></p>
      <ol>
        <li>เปิดโปรแกรม <strong>Excel Data Cleaner</strong> บนเครื่องของคุณ</li>
        <li>กดปุ่ม <strong>“🔑 ใส่ License Key”</strong> มุมขวาบนของโปรแกรม (หรือไปที่แท็บ <strong>“ตั้งค่า”</strong> ในเครื่องมือขั้นสูง)</li>
        <li>วางรหัส License Key ด้านบนลงในช่องแล้วกด <strong>“ตรวจสอบและปลดล็อกโปรแกรม”</strong></li>
      </ol>
      <p style="color: #64748b; font-size: 13px; margin-top: 24px;">
        หมายเลขอ้างอิง: ${licenseId} (อีเมลที่แจ้งไว้: ${email})<br/>
        กรุณาเก็บอีเมลฉบับนี้หรือรูปสลิปโอนเงินไว้สำหรับใช้กู้คืน License Key ในอนาคต
      </p>
    </div>
  `;

  const payload = {
    from: fromEmail,
    to: [email],
    subject: `License Key สำหรับปลดล็อก Excel Data Cleaner ของคุณ (${licenseId})`,
    html,
  };
  if (sellerBcc) {
    payload.bcc = [sellerBcc];
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  return res.ok;
}

async function logPurchaseToGoogleSheet(record) {
  const webhookUrl = process.env.GOOGLE_SHEET_WEBHOOK_URL;
  if (!webhookUrl) {
    return false;
  }
  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(record),
    });
    return res.ok;
  } catch (_) {
    return false;
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method Not Allowed" });
  }

  try {
    const { customer, email, slipImage } = req.body || {};
    if (!customer || !String(customer).trim()) {
      return res.status(400).json({ ok: false, error: "กรุณากรอกชื่อผู้ใช้งานหรือชื่อบริษัท" });
    }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim())) {
      return res.status(400).json({ ok: false, error: "กรุณากรอกอีเมลให้ถูกต้องเพื่อใช้รับ License Key สำรอง" });
    }
    if (!slipImage || !String(slipImage).startsWith("data:image/")) {
      return res.status(400).json({ ok: false, error: "กรุณาอัปโหลดไฟล์รูปภาพสลิปโอนเงิน" });
    }

    const expectedAmount = Number(process.env.EXPECTED_AMOUNT || 790);
    const expectedReceiver = (process.env.EXPECTED_RECEIVER_NAME || "").trim();
    const privateKey = process.env.EDC_LICENSE_PRIVATE_KEY;
    if (!privateKey) {
      return res.status(500).json({ ok: false, error: "ระบบยังไม่พร้อมออก License Key กรุณาติดต่อผู้พัฒนาผ่านฟอร์มด้านล่าง" });
    }

    const verified = await verifySlipWithProvider(slipImage, expectedAmount);
    if (verified.amount < expectedAmount) {
      return res.status(400).json({
        ok: false,
        error: `ยอดโอนในสลิป (${verified.amount} บาท) ไม่ตรงกับราคาสินค้า (${expectedAmount} บาท)`,
      });
    }
    if (expectedReceiver && !verified.receiverName.includes(expectedReceiver)) {
      return res.status(400).json({
        ok: false,
        error: "ชื่อบัญชีผู้รับเงินในสลิปไม่ตรงกับบัญชีผู้จำหน่าย",
      });
    }

    const shortRef = verified.transRef ? verified.transRef.slice(-8).toUpperCase() : Date.now().toString().slice(-6);
    const licenseId = `EDC-${shortRef}`;
    // ผูกชื่อผู้โอนจากสลิปธนาคารควบคู่กับชื่อที่ลูกค้ากรอก เพื่อป้องกันการนำสลิปคนอื่นมาออกคีย์ชื่อใหม่
    const customerLabel = verified.senderName
      ? `${String(customer).trim()} (${verified.senderName})`
      : String(customer).trim();

    const licenseKey = createLicenseToken({
      customer: customerLabel,
      edition: "Personal",
      licenseId,
      issuedDate: verified.transDate,
      privateKey,
    });

    const [emailSent] = await Promise.all([
      sendLicenseEmail({
        email: String(email).trim(),
        customer: customerLabel,
        licenseKey,
        licenseId,
      }),
      logPurchaseToGoogleSheet({
        timestamp: new Date().toISOString(),
        licenseId,
        customer: customerLabel,
        email: String(email).trim(),
        amount: verified.amount,
        transRef: verified.transRef,
        licenseKey,
      }),
    ]);

    return res.status(200).json({
      ok: true,
      licenseKey,
      licenseId,
      emailSent,
      message: "ตรวจสอบสลิปสำเร็จ! คัดลอก License Key ด้านล่างไปปลดล็อกในโปรแกรมได้ทันที",
    });
  } catch (err) {
    return res.status(400).json({
      ok: false,
      error: err.message || "เกิดข้อผิดพลาดในการตรวจสอบสลิป กรุณาลองใหม่อีกครั้ง",
    });
  }
}
