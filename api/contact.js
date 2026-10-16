export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method Not Allowed" });
  }

  try {
    const { name, email, topic, message } = req.body || {};
    if (!name || !String(name).trim()) {
      return res.status(400).json({ ok: false, error: "กรุณากรอกชื่อผู้ติดต่อ" });
    }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim())) {
      return res.status(400).json({ ok: false, error: "กรุณากรอกอีเมลให้ถูกต้องเพื่อใช้ติดต่อกลับ" });
    }
    if (!message || !String(message).trim()) {
      return res.status(400).json({ ok: false, error: "กรุณาระบุรายละเอียดที่ต้องการสอบถามหรือแจ้งปัญหา" });
    }

    const resendKey = process.env.RESEND_API_KEY;
    const sellerEmail = process.env.SELLER_NOTIFICATION_EMAIL || process.env.SUPPORT_EMAIL;
    const fromEmail = process.env.FROM_EMAIL || "Excel Data Cleaner <onboarding@resend.dev>";
    const webhookUrl = process.env.GOOGLE_SHEET_WEBHOOK_URL;

    const tasks = [];

    if (resendKey && sellerEmail) {
      const html = `
        <div style="font-family: 'Sarabun', sans-serif; max-width: 600px; padding: 20px; border: 1px solid #e2e8f0; border-radius: 10px;">
          <h3 style="color: #0f3d68; margin-top: 0;">ข้อความติดต่อจากหน้าเว็บ Excel Data Cleaner</h3>
          <p><strong>ผู้ติดต่อ:</strong> ${String(name).trim()}</p>
          <p><strong>อีเมลสำหรับตอบกลับ:</strong> ${String(email).trim()}</p>
          <p><strong>หัวข้อ:</strong> ${String(topic || "ทั่วไป").trim()}</p>
          <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 16px 0;" />
          <p style="white-space: pre-wrap;">${String(message).trim()}</p>
        </div>
      `;
      tasks.push(
        fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${resendKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: fromEmail,
            to: [sellerEmail],
            reply_to: String(email).trim(),
            subject: `[ติดต่อ/แจ้งปัญหา] ${String(topic || "ทั่วไป").trim()} — จาก ${String(name).trim()}`,
            html,
          }),
        })
      );
    }

    if (webhookUrl) {
      tasks.push(
        fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            timestamp: new Date().toISOString(),
            licenseId: "CONTACT-FORM",
            customer: String(name).trim(),
            email: String(email).trim(),
            amount: 0,
            transRef: String(topic || "ทั่วไป").trim(),
            licenseKey: String(message).trim(),
          }),
        }).catch(() => null)
      );
    }

    await Promise.all(tasks);

    return res.status(200).json({
      ok: true,
      message: "ส่งข้อความเรียบร้อยแล้ว! ผู้พัฒนาจะตรวจสอบและติดต่อกลับทางอีเมลที่คุณระบุไว้โดยเร็วที่สุดครับ",
    });
  } catch (err) {
    return res.status(400).json({
      ok: false,
      error: err.message || "เกิดข้อผิดพลาดในการส่งข้อความ กรุณาลองใหม่อีกครั้ง",
    });
  }
}
