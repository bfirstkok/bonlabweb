import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = __dirname;
const envPath = path.join(rootDir, ".env");
if (fs.existsSync(envPath)) process.loadEnvFile(envPath);

const distDir = path.join(rootDir, "dist");
const htmlDir = fs.existsSync(path.join(distDir, "index.html")) ? distDir : rootDir;

const app = express();
const port = Number(process.env.PORT || 8000);
const adminUser = process.env.BONLAB_ADMIN_USER || "adminbonlab";
const adminPassword = process.env.BONLAB_ADMIN_PASSWORD || "change-this-password";
const sessionSecret = process.env.BONLAB_SESSION_SECRET || getLocalSessionSecret();
const sessionLifetimeMs = 8 * 60 * 60 * 1000;

const pageFiles = [
    "index.html",
    "about.html",
    "contact.html",
    "news.html",
    "news-detail.html",
    "partners.html",
    "research.html",
    "research-detail.html",
    "team.html"
];

if (!adminUser || !adminPassword) {
    throw new Error("Set BONLAB_ADMIN_USER and BONLAB_ADMIN_PASSWORD in .env before starting the server.");
}

app.disable("x-powered-by");
app.use(express.json({ limit: "15mb" }));

app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    res.setHeader("Referrer-Policy", "same-origin");
    next();
});

app.use("/vendor/grapesjs", express.static(path.join(rootDir, "node_modules", "grapesjs", "dist")));
app.use("/vendor/lucide", express.static(path.join(rootDir, "node_modules", "lucide", "dist", "umd")));
app.use("/admin", express.static(path.join(rootDir, "admin"), { index: "index.html" }));
app.use("/assets", express.static(path.join(rootDir, "public", "assets"), { dotfiles: "deny" }));
if (fs.existsSync(path.join(distDir, "assets"))) {
    app.use("/assets", express.static(path.join(distDir, "assets"), { dotfiles: "deny" }));
}

app.post("/api/admin/login", (req, res) => {
    const username = String(req.body?.username || "");
    const password = String(req.body?.password || "");

    if (!safeEqual(username, adminUser) || !safeEqual(password, adminPassword)) {
        return res.status(401).json({ error: "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง" });
    }

    const expiresAt = Date.now() + sessionLifetimeMs;
    const payload = Buffer.from(JSON.stringify({ username, expiresAt })).toString("base64url");
    const token = `${payload}.${sign(payload)}`;
    res.setHeader("Set-Cookie", `bonlab_admin=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${sessionLifetimeMs / 1000}`);
    res.json({ ok: true, username });
});

app.post("/api/admin/logout", (req, res) => {
    res.setHeader("Set-Cookie", "bonlab_admin=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0");
    res.json({ ok: true });
});

app.get("/api/admin/session", requireAdmin, (req, res) => {
    res.json({ ok: true, username: req.admin.username });
});

app.get("/api/admin/pages", requireAdmin, (req, res) => {
    const pages = pageFiles.filter(f => fs.existsSync(path.join(htmlDir, f)) || fs.existsSync(path.join(rootDir, f))).map((file) => {
        const filePath = fs.existsSync(path.join(htmlDir, file)) ? path.join(htmlDir, file) : path.join(rootDir, file);
        const html = fs.readFileSync(filePath, "utf8");
        const title = html.match(/<title>([\s\S]*?)<\/title>/i)?.[1]?.trim() || file;
        return { file, title };
    });
    res.json({ pages });
});

app.get("/api/admin/page", requireAdmin, (req, res) => {
    const file = validatePageName(req.query.file);
    if (!file) return res.status(400).json({ error: "ไม่พบหน้าเว็บที่เลือก" });

    const filePath = fs.existsSync(path.join(htmlDir, file)) ? path.join(htmlDir, file) : path.join(rootDir, file);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: "ไม่พบไฟล์หน้าเว็บ" });

    const html = fs.readFileSync(filePath, "utf8");
    res.json({ file, html });
});

app.post("/api/admin/save", requireAdmin, (req, res) => {
    const file = validatePageName(req.body?.file);
    const html = String(req.body?.html || "");
    if (!file) return res.status(400).json({ error: "ไม่พบหน้าเว็บที่เลือก" });
    if (!looksLikeHtmlDocument(html)) return res.status(400).json({ error: "รูปแบบหน้าเว็บไม่สมบูรณ์ จึงยังไม่บันทึก" });
    if (Buffer.byteLength(html, "utf8") > 2_000_000) return res.status(413).json({ error: "หน้าเว็บมีขนาดใหญ่เกินไป" });

    const backupDir = path.join(rootDir, "backups");
    fs.mkdirSync(backupDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");

    const targetDist = path.join(htmlDir, file);
    if (fs.existsSync(targetDist)) {
        fs.copyFileSync(targetDist, path.join(backupDir, `${file}.${stamp}.bak`));
        fs.writeFileSync(targetDist, html, "utf8");
    }

    const targetRoot = path.join(rootDir, file);
    if (fs.existsSync(targetRoot) && targetRoot !== targetDist) {
        fs.writeFileSync(targetRoot, html, "utf8");
    }

    res.json({ ok: true, savedAt: new Date().toISOString() });
});

app.post("/api/admin/upload", requireAdmin, (req, res) => {
    const dataUrl = String(req.body?.dataUrl || "");
    const originalName = String(req.body?.name || "image");
    const match = dataUrl.match(/^data:(image\/(?:png|jpeg|webp|gif));base64,([a-z0-9+/=]+)$/i);
    if (!match) return res.status(400).json({ error: "รองรับไฟล์ PNG, JPG, WEBP และ GIF เท่านั้น" });

    const bytes = Buffer.from(match[2], "base64");
    if (bytes.length > 10 * 1024 * 1024) return res.status(413).json({ error: "รูปต้องมีขนาดไม่เกิน 10 MB" });

    const extensions = { "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/gif": ".gif" };
    const cleanBase = path.basename(originalName, path.extname(originalName)).replace(/[^a-z0-9-]+/gi, "-").replace(/^-+|-+$/g, "") || "image";
    const filename = `${Date.now()}-${cleanBase.toLowerCase()}${extensions[match[1].toLowerCase()]}`;
    
    const uploadDirs = [
        path.join(rootDir, "public", "assets", "uploads"),
        path.join(distDir, "assets", "uploads")
    ];

    uploadDirs.forEach(dir => {
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, filename), bytes);
    });

    res.json({ ok: true, url: `/assets/uploads/${filename}` });
});

app.get("/", (req, res) => {
    const indexPath = fs.existsSync(path.join(htmlDir, "index.html")) ? path.join(htmlDir, "index.html") : path.join(rootDir, "index.html");
    res.sendFile(indexPath);
});

app.get("/:file", (req, res, next) => {
    if (!pageFiles.includes(req.params.file)) return next();
    const filePath = fs.existsSync(path.join(htmlDir, req.params.file)) ? path.join(htmlDir, req.params.file) : path.join(rootDir, req.params.file);
    res.sendFile(filePath);
});

app.use((req, res) => res.status(404).send("Not found"));

app.listen(port, () => {
    console.log(`BONLAB is ready at http://localhost:${port}`);
    console.log(`Visual editor: http://localhost:${port}/admin`);
});

function requireAdmin(req, res, next) {
    const cookies = Object.fromEntries(String(req.headers.cookie || "").split(";").map((part) => {
        const index = part.indexOf("=");
        return index < 0 ? ["", ""] : [part.slice(0, index).trim(), part.slice(index + 1).trim()];
    }));
    const token = cookies.bonlab_admin || "";
    const separator = token.lastIndexOf(".");
    if (separator < 1) return res.status(401).json({ error: "กรุณาเข้าสู่ระบบ" });

    const payload = token.slice(0, separator);
    const signature = token.slice(separator + 1);
    if (!safeEqual(signature, sign(payload))) return res.status(401).json({ error: "เซสชันไม่ถูกต้อง" });

    try {
        const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
        if (session.expiresAt < Date.now() || session.username !== adminUser) throw new Error("expired");
        req.admin = session;
        next();
    } catch {
        res.status(401).json({ error: "เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง" });
    }
}

function validatePageName(value) {
    const file = String(value || "");
    return pageFiles.includes(file) ? file : null;
}

function looksLikeHtmlDocument(html) {
    return /^\s*<!doctype html>/i.test(html) && /<html[\s>]/i.test(html) && /<head[\s>]/i.test(html)
        && /<body[\s>]/i.test(html) && /<\/body>/i.test(html) && /<\/html>\s*$/i.test(html);
}

function sign(payload) {
    return crypto.createHmac("sha256", sessionSecret).update(payload).digest("base64url");
}

function safeEqual(left, right) {
    const a = Buffer.from(String(left));
    const b = Buffer.from(String(right));
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function getLocalSessionSecret() {
    const secretPath = path.join(rootDir, ".bonlab-session-secret");
    if (fs.existsSync(secretPath)) return fs.readFileSync(secretPath, "utf8").trim();
    const secret = crypto.randomBytes(48).toString("hex");
    fs.writeFileSync(secretPath, secret, { encoding: "utf8", mode: 0o600 });
    return secret;
}
