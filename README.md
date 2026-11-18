# BONLAB website

เว็บไซต์ของ BONLAB (Broadband Optical Network Laboratory, RMUTI Khon Kaen) หน้าเว็บสร้างด้วย **Astro** ฝั่งหลังบ้านเป็น **Express** มี visual editor (GrapesJS) ให้แอดมิน lab แก้หน้าเว็บได้เอง รองรับ 3 ภาษา (EN/TH/DE) และ dark mode

- วิธี deploy, ย้ายเครื่อง และ rollback: [DEPLOY.md](DEPLOY.md)
- ระบบข่าว Facebook และวิธีขอ token: [docs/FACEBOOK_FEED.md](docs/FACEBOOK_FEED.md)

---

## โครงสร้างระบบ

```
              GitHub ── PR ──> CI: build + smoke test + docker build
                │
                └─ merge main / tag v* ──> ghcr.io/bfirstkok/bonlabweb:<tag>
                                                      │ pull (cron ทุก 5 นาที, scripts/deploy.sh)
Server ───────────────────────────────────────────────▼───────────────────
  Caddy :80/:443 (HTTPS อัตโนมัติ) ──> web :8000 (Express + หน้าเว็บที่ build แล้ว)
                                              │
                                       ./data  (ข้อมูลทั้งหมดที่ต้องเก็บ)
```

**แยกโค้ดออกจากข้อมูล:**
- **โค้ด** อยู่ใน image สร้างใหม่ได้ทุกเมื่อ
- **ข้อมูล** อยู่ใน `data/` บนเครื่อง ทั้งหมดที่ต้อง backup และต้องย้ายตามคือ `data/` กับ `.env`

| ใน `data/` | ที่มา |
|---|---|
| `pages/*.html` | หน้าเว็บที่แอดมินแก้แล้ว ตอนเปิดครั้งแรกระบบ copy มาจาก `dist/` |
| `uploads/` | รูปที่อัปโหลด และรูปจาก Facebook ที่ดาวน์โหลดมาเก็บไว้ |
| `news.json` | ข่าว Facebook ทั้งจากการดึงอัตโนมัติและที่แอดมินเพิ่มเอง |
| `backups/` | ไฟล์เดิมก่อนการ save แต่ละครั้ง |

### ข้อควรระวัง: หน้าเว็บมี 3 ที่
- `src/pages/*.astro` คือต้นฉบับ ใช้ build ไปเป็น `dist/*.html`
- `*.html` ที่ root ของ repo เป็นไฟล์รุ่นเก่า ใช้เฉพาะตอนรันแบบไม่ตั้ง `DATA_DIR`
- บน server ระบบใช้ไฟล์ใน `data/pages/` เป็นหลัก

**ผลที่ตามมา:** หลังจากเครื่องเปิดใช้งานครั้งแรกแล้ว การแก้ `.astro` แล้ว deploy ใหม่ **จะไม่ไปทับหน้าที่อยู่ใน `data/pages/`** เพราะระบบตั้งใจไม่ทับงานที่แอดมินแก้ไว้

ถ้าต้องการให้หน้าไหนใช้เวอร์ชันใหม่จากโค้ด:
1. backup ก่อน
2. ลบไฟล์หน้านั้นใน `data/pages/`
3. restart ระบบจะ copy หน้าใหม่มาให้ แต่งานที่แอดมินแก้ในหน้านั้นจะหาย

ส่วน `public/assets/` (CSS/JS) อยู่ใน image จึงอัปเดตทุกครั้งที่ deploy

---

## รันบนเครื่องตัวเอง

| คำสั่ง | ทำอะไร |
|---|---|
| `npm ci` | ติดตั้ง dependency (ต้องใช้ Node 22) |
| `npm run dev` | Astro dev server ที่ `http://localhost:4321` ใช้ดูหน้าเว็บอย่างเดียว |
| `npm run build` | build หน้าเว็บลง `dist/` |
| `npm start` | Express + admin ที่ `http://localhost:8000` (`/admin`) |
| `docker compose up -d --build` | รันแบบเดียวกับบน server (ต้องตั้ง `SITE_ADDRESS` ใน `.env`) |

`cp .env.example .env` แล้วแก้ค่า:

| ตัวแปร | ใช้ทำอะไร |
|---|---|
| `BONLAB_ADMIN_USER`, `BONLAB_ADMIN_PASSWORD` | ข้อมูล login เข้า `/admin` |
| `BONLAB_SESSION_SECRET` | ใช้เซ็น cookie ของ admin สร้างด้วย `openssl rand -hex 32` |
| `SITE_ADDRESS` | โดเมนที่ Caddy ออกใบ HTTPS ให้ ถ้ายังไม่มีโดเมนใช้ `<ip-แบบขีด>.sslip.io` |
| `BONLAB_TAG` | image ที่ server จะ deploy: `main` สำหรับ staging หรือ `v1.0.0` สำหรับ production |
| `FB_PAGE_ID`, `FB_PAGE_ACCESS_TOKEN`, `FB_FEED_URL` | ใช้ดึงข่าว Facebook อัตโนมัติ เว้นว่างได้ |
| `DATA_DIR` | ตั้งให้อัตโนมัติใน Docker (`/app/data`) ถ้าไม่ตั้ง ระบบจะเขียนลงโค้ดโดยตรง ซึ่งเป็นโหมดเดิมไว้ใช้ตอน dev |

`.env` และ `data/` ห้าม commit เด็ดขาด

---

## หลังบ้าน (Admin)

- `/admin`: แก้หน้าเว็บแบบลากวาง แล้วกดบันทึก ระบบ backup ไฟล์เดิมไว้ใน `data/backups/` ให้เอง
- `/admin/news.html`: จัดการข่าว Facebook
  - เพิ่ม แก้ไข และลบโพสต์
  - กดดึงข่าวจาก Facebook เอง
  - ดูสถานะการดึงข่าวครั้งล่าสุด

### ระบบข่าว 3 ชั้น
ชั้นไหนเสีย หน้าข่าวก็ยังไม่ว่าง

1. **Page Plugin ของ Facebook** (แถบข้าง): ไม่ต้องใช้ token ขึ้นตลอด
2. **โพสต์ที่แอดมินเพิ่มเอง**:
   - รูปเก็บบน server จึงไม่หมดอายุ
   - การดึงอัตโนมัติจะไม่เขียนทับ
3. **ดึงอัตโนมัติทุก 30 นาที**:
   - ใช้ Page token จากแอดมินเพจ
   - ถ้าดึงไม่สำเร็จ ข่าวเดิมยังแสดงอยู่ และหน้า admin แสดง error

---

## CI/CD

| Event | ผล |
|---|---|
| เปิด PR | `test` (build + เปิด server ทดสอบ endpoint หลัก) และ `image` (docker build อย่างเดียว ไม่ push) |
| merge เข้า `main` | push `:main` และ `:sha-xxxxxxx` ไป GHCR แล้วเครื่อง staging อัปเดตเองภายใน 5 นาที |
| `git tag v1.0.0 && git push origin v1.0.0` | push `:v1.0.0` จากนั้นแก้ `BONLAB_TAG` บน production เพื่อปล่อยเวอร์ชันนี้ |

ขั้นตอน `scripts/deploy.sh`:
1. pull image ตาม `BONLAB_TAG`
2. ถ้ามี image ใหม่: backup ข้อมูลก่อน แล้ว restart
3. รอให้ healthcheck (`/health`) ผ่าน
4. ถ้าไม่ผ่าน: กลับไปใช้ image เดิม และไม่ deploy image ที่พังซ้ำ

---

## แนวทางที่เลือกและเหตุผล

| เรื่อง | ที่เลือก | เหตุผล |
|---|---|---|
| เก็บข้อมูล | `DATA_DIR` (`./data`) แยกจาก image เปิดครั้งแรก copy หน้าเว็บมาให้ และไม่ทับไฟล์ที่มีอยู่แล้ว | อัปเดตโค้ดได้โดยไม่ทับงานของแอดมิน และ backup หรือย้ายเครื่องได้ด้วยโฟลเดอร์เดียว |
| HTTPS | Caddy + Let's Encrypt ใช้ sslip.io ระหว่างที่ยังไม่มีโดเมน | ไม่ต้องตั้งใบ HTTPS เอง เปลี่ยนเป็นโดเมนจริงได้ด้วยการแก้ `SITE_ADDRESS` บรรทัดเดียว |
| Deploy | server pull เอง (cron + `deploy.sh`) ไม่ใช้ GitHub SSH เข้าเครื่อง | server มหาลัยน่าจะอยู่หลัง firewall ที่เปิดแค่ขาออก และไม่ต้องเก็บ SSH key ไว้ใน GitHub |
| Registry | GHCR แบบ public | ฟรี ใช้ `GITHUB_TOKEN` push ได้ server pull ได้โดยไม่ต้อง login |
| Staging กับ production | staging ตาม `main` ส่วน production ล็อกไว้ที่ tag | ลูกค้าได้เฉพาะเวอร์ชันที่ตั้งใจปล่อย |
| Container | `read_only`, `cap_drop: ALL`, `mem_limit` และจำกัดขนาด log | VM มี RAM 4GB ดิสก์ 20GB ต้องกันไม่ให้ตัวไหนกินทรัพยากรจนเต็ม |
| ข่าว Facebook | 3 ชั้น (Plugin / เพิ่มเอง / Graph API) | rss.app เป็นบริการเสียเงิน (trial หมดแล้วตอบ `402`) scraper ใช้กับ Facebook ได้ไม่เสถียร และลิงก์รูปจาก fbcdn หมดอายุ วิธีที่ฟรีและเสถียรมีแค่ Page token จากแอดมินเพจ |
| Backup | ไฟล์เดิมทุกครั้งที่ save, snapshot ทุกคืน (เก็บ 14 วัน) และก่อน deploy, GCP disk snapshot | กันพลาดได้ทั้งระดับ 1 หน้า ทั้งระบบ และทั้งเครื่อง |

## สถานะ / งานค้าง

- Staging: GCP VM (e2-medium, asia-southeast1, sslip.io) ใช้ทดสอบระหว่างรอ server มหาลัย
- Production: server มหาลัย ยังไม่มีข้อมูล ต้องยื่นขอโดเมน (เช่น `bonlab.<โดเมนมหาลัย>`) และถาม IT เรื่อง Docker, firewall ขาออก และ backup
- [ ] ขอ Page token จากแอดมินเพจ BONLAB (ขั้นตอนใน `docs/FACEBOOK_FEED.md`)
- [ ] ตั้ง GCP disk snapshot schedule
- [ ] ซ้อม restore และ rollback บน staging
- [ ] ลบ `*.html` ที่ root ของ repo เมื่อไม่ใช้โหมดที่ไม่ตั้ง `DATA_DIR` แล้ว

## โครงสร้างไฟล์

```text
admin/                 # visual editor (index.html, editor.js) และ news.html
docs/                  # FACEBOOK_FEED.md
public/assets/         # CSS, JS (i18n, ฟิลเตอร์ข่าว, โหลดการ์ดข่าว), รูป
scripts/               # backup.sh, deploy.sh
src/layouts/           # Layout.astro (header, footer, meta)
src/pages/             # หน้าเว็บ 9 หน้า (.astro)
src/data/news.json     # ข่าวตั้งต้นที่ copy เข้า data/ ตอนเปิดครั้งแรก
.github/workflows/     # ci.yml
server.js              # Express: auth, editor API, news API, /health
Dockerfile             # multi-stage, node:22-alpine, รันด้วย user node
docker-compose.yml     # web + Caddy
Caddyfile
DEPLOY.md
```
