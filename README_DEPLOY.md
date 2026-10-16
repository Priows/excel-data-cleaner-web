# คู่มือการนำหน้าเว็บและระบบตรวจสลิปอัตโนมัติขึ้น Vercel

โฟลเดอร์ `web/` นี้ประกอบด้วย:
1. `index.html` — หน้าเว็บไซต์แนะนำโปรแกรม ตารางเปรียบเทียบก่อน/หลัง และฟอร์มแนบสลิปรับคีย์อัตโนมัติ
2. `api/verify-slip.js` — ระบบหลังบ้าน (Vercel Serverless Function) สำหรับตรวจสลิปธนาคารผ่าน API (EasySlip / SlipOK), สร้างรหัส `License Key (EDC1....)` ที่ตรงกับตัวโปรแกรม Python 100%, ส่งสำเนาคีย์เข้าอีเมลลูกค้าผ่าน Resend และบันทึกประวัติลูกค้าลง Google Sheets อัตโนมัติ
3. `vercel.json` — ตั้งค่าสำหรับ Vercel

---

## ขั้นตอนการตั้งค่าเมื่อพร้อมเปิดขายจริง (4 ขั้นตอน)

1. **ใส่รูป QR Code พร้อมเพย์ของคุณใน `web/index.html`**
   - นำไฟล์รูป QR Code พร้อมเพย์ของคุณมาวางในโฟลเดอร์ `web/` (เช่น `promptpay-qr.png`)
   - แก้ไขตรงคำว่า `[ วางรูป QR พร้อมเพย์ ]` ในไฟล์ `web/index.html` ให้เป็น `<img src="/promptpay-qr.png" width="170" alt="PromptPay QR" />`

2. **อัปโหลดเฉพาะโฟลเดอร์ `web/` ขึ้น GitHub และเชื่อมกับ Vercel**
   - ในหน้าตั้งค่าโปรเจกต์บน Vercel หากเก็บไว้ใน Repo เดียวกัน ให้ตั้ง **Root Directory** เป็น `web`

3. **ตั้งค่าตัวแปรความลับ (Environment Variables) ในหน้าเว็บ Vercel**
   เข้าไปที่โปรเจกต์บน Vercel -> **Settings** -> **Environment Variables** แล้วเพิ่มค่าต่อไปนี้:

   | ชื่อตัวแปร (Key) | ค่าที่ต้องใส่ (Value) | คำอธิบาย |
   | :--- | :--- | :--- |
   | `EDC_LICENSE_SECRET` | รหัสลับเดียวกับที่คุณใช้คอมไพล์ตัวโปรแกรม (ค่าเริ่มต้นคือ `EDC-DEFAULT-SELLER-SECRET`) | ใช้เซ็นลายเซ็นดิจิทัลลงใน License Key |
   | `SLIP_PROVIDER` | `easyslip` หรือ `slipok` | เลือกผู้ให้บริการ API ตรวจสลิปธนาคาร |
   | `SLIP_API_KEY` | API Key ที่ได้จากเว็บ EasySlip หรือ SlipOK | ใช้ตรวจสอบสลิปจริง |
   | `EXPECTED_AMOUNT` | `790` | ยอดเงินขั้นต่ำที่ต้องตรงในสลิป (บาท) |
   | `EXPECTED_RECEIVER_NAME` | ชื่อบัญชีของคุณ (ภาษาไทย เช่น `สมชาย`) | ป้องกันคนเอาสลิปที่โอนไปบัญชีอื่นมาสวมรอย |
   | `RESEND_API_KEY` | API Key จากเว็บ `resend.com` (ไม่บังคับ) | สำหรับส่งสำเนา License Key เข้าอีเมลลูกค้าอัตโนมัติ (ฟรี 3,000 ฉบับ/เดือน) |
   | `FROM_EMAIL` | เช่น `Excel Data Cleaner <noreply@yourdomain.com>` | อีเมลผู้ส่งเมื่อใช้ Resend |
   | `SELLER_NOTIFICATION_EMAIL` | อีเมลส่วนตัวของคุณเอง (เช่น `youremail@gmail.com`) | ส่งสำเนาใบอนุญาตของลูกค้าทุกคนเข้าอีเมลคุณเก็บเป็นหลักฐานอัตโนมัติ |
   | `GOOGLE_SHEET_WEBHOOK_URL` | ลิงก์ Web App จาก Google Sheets (ดูวิธีทำด้านล่าง) | บันทึกรายชื่อลูกค้าที่ซื้อลงตาราง Google Sheets อัตโนมัติ (ไม่บังคับ) |

---

## วิธีเชื่อมตาราง Google Sheets เก็บประวัติลูกค้าอัตโนมัติ (ฟรี 100%)

1. สร้างไฟล์ **Google Sheets** ใหม่ในบัญชี Google ของคุณ
2. ไปที่เมนูด้านบน **ส่วนขยาย (Extensions)** -> **Apps Script**
3. ลบโค้ดเดิมออกแล้ววางโค้ดสั้นๆ นี้ลงไป:
   ```javascript
   function doPost(e) {
     var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
     var data = JSON.parse(e.postData.contents);
     sheet.appendRow([
       data.timestamp,
       data.licenseId,
       data.customer,
       data.email,
       data.amount,
       data.transRef,
       data.licenseKey
     ]);
     return ContentService.createTextOutput("OK");
   }
   ```
4. กดปุ่ม **การทำให้ใช้งานได้ (Deploy)** มุมขวาบน -> **การทำให้ใช้งานได้รายการใหม่ (New deployment)** -> เลือกประเภทเป็น **เว็บแอป (Web app)** -> ตั้งค่า *ผู้มีสิทธิ์เข้าถึง (Who has access)* เป็น **ทุกคน (Anyone)** แล้วกด Deploy
5. คัดลอก URL ที่ได้ ไปใส่ในตัวแปร `GOOGLE_SHEET_WEBHOOK_URL` บน Vercel เท่านี้ทุกครั้งที่มีลูกค้าซื้อ ข้อมูลจะเด้งเข้าตาราง Google Sheets ของคุณทันทีครับ!
