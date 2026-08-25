# BONLAB — Astro Frontend & Express Admin CMS

โปรเจกต์เว็บไซต์ BONLAB ที่ผสาน **Astro Frontend** (ดีไซน์ตาม Prototype) เข้ากับ **Express.js Backend + Visual Page Editor (GrapesJS)** จาก `bonlabweb`

---

## 🚀 คำสั่งเริ่มต้นใช้งาน (Commands)

| คำสั่ง | การทำงาน |
| :--- | :--- |
| `npm run start` | รันระบบ Full-stack (Express + Admin Visual Editor) ที่ `http://localhost:8000` |
| `npm run dev` | รัน Astro Dev Server เฉพาะหน้าเว็บที่ `http://localhost:4321` |
| `npm run build` | บิลด์หน้าเว็บ Astro ทั้งหมดเป็น Static HTML ลงในโฟลเดอร์ `dist/` |

---

## 🔐 การเข้าใช้งาน Admin Visual Editor

1. เริ่มต้นรันเซิร์ฟเวอร์: `npm start`
2. เปิดเบราว์เซอร์ไปที่: `http://localhost:8000/admin`
3. เข้าสู่ระบบด้วยข้อมูลเริ่มต้นใน `.env`:
   - **Username:** `adminbonlab`
   - **Password:** `change-this-password`
4. เมื่อแก้ไขหน้าเว็บและกด **Save**:
   - ระบบจะบันทึกการเปลี่ยนแปลงลงไฟล์ HTML ทันที
   - ระบบจะสร้างไฟล์สำรองอัตโนมัติในโฟลเดอร์ `backups/`

---

## 📁 โครงสร้างโปรเจกต์ (Project Structure)

```text
density-light/
├── admin/                  # หน้าตาและระบบ Visual Editor (GrapesJS)
├── backups/                # ไฟล์สำรอง HTML อัตโนมัติเมื่อมีการบันทึกผ่าน Admin
├── public/assets/          # ไฟล์ Style, Script, รูปภาพ และ Uploads
├── src/
│   ├── layouts/
│   │   └── Layout.astro    # Common Layout (Header, Footer, Meta)
│   └── pages/              # หน้าเว็บ Astro ทั้ง 9 หน้า
├── .env                    # การตั้งค่าพอร์ตและรหัสผ่าน Admin
├── server.js               # Backend Server (Express + Auth + Editor API)
├── astro.config.mjs        # การตั้งค่า Astro Build
└── package.json
```

