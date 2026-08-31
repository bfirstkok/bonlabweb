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
app.use(express.json({ limit: "300mb" }));
app.use(express.urlencoded({ limit: "300mb", extended: true }));

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

    if (username !== adminUser || password !== adminPassword) {
        return res.status(401).json({ error: "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง" });
    }

    const token = createSessionToken();
    res.setHeader("Set-Cookie", serializeSessionCookie(token));
    res.json({ ok: true });
});

app.post("/api/admin/logout", (req, res) => {
    res.setHeader("Set-Cookie", clearSessionCookie());
    res.json({ ok: true });
});

app.get("/api/admin/session", requireAdmin, (req, res) => {
    res.json({ ok: true, user: adminUser });
});

app.get("/api/admin/pages", requireAdmin, (req, res) => {
    const available = pageFiles.map((file) => {
        const filePath = fs.existsSync(path.join(htmlDir, file)) ? path.join(htmlDir, file) : path.join(rootDir, file);
        const stats = fs.existsSync(filePath) ? fs.statSync(filePath) : null;
        return { file, updatedAt: stats?.mtime?.toISOString() || null };
    });
    res.json({ pages: available });
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
    let html = String(req.body?.html || "");
    if (!file) return res.status(400).json({ error: "ไม่พบหน้าเว็บที่เลือก" });
    if (!looksLikeHtmlDocument(html)) return res.status(400).json({ error: "รูปแบบหน้าเว็บไม่สมบูรณ์ จึงยังไม่บันทึก" });
    if (Buffer.byteLength(html, "utf8") > 300_000_000) return res.status(413).json({ error: "หน้าเว็บมีขนาดใหญ่เกินไป (เกิน 300 MB)" });

    // Auto-extract any inline base64 images to uploads directory to keep HTML lean and fast
    const uploadDirs = [
        path.join(rootDir, "public", "assets", "uploads"),
        path.join(distDir, "assets", "uploads")
    ];
    uploadDirs.forEach(dir => fs.mkdirSync(dir, { recursive: true }));

    html = html.replace(/src="data:(image\/(?:png|jpeg|webp|gif|svg\+xml));base64,([a-z0-9+/=]+)"/gi, (match, mime, b64) => {
        try {
            const extMap = { "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/gif": ".gif", "image/svg+xml": ".svg" };
            const ext = extMap[mime.toLowerCase()] || ".png";
            const filename = `img-${Date.now()}-${crypto.randomBytes(4).toString("hex")}${ext}`;
            const imgBuffer = Buffer.from(b64, "base64");
            uploadDirs.forEach(dir => fs.writeFileSync(path.join(dir, filename), imgBuffer));
            return `src="/assets/uploads/${filename}"`;
        } catch {
            return match;
        }
    });

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

    // Auto-sync into src/pages/*.astro to prevent build overwriting
    try {
        const astroPageName = file.replace(/\.html$/i, ".astro");
        const astroPath = path.join(rootDir, "src", "pages", astroPageName);
        if (fs.existsSync(astroPath)) {
            const mainMatch = html.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
            if (mainMatch) {
                const currentAstro = fs.readFileSync(astroPath, "utf8");
                const frontmatterMatch = currentAstro.match(/^---[\s\S]*?---/);
                const frontmatter = frontmatterMatch ? frontmatterMatch[0] : "";
                if (frontmatter) {
                    const newAstroContent = `${frontmatter}\n\n<Layout title={title} description={description}>\n<main>\n${mainMatch[1]}\n</main>\n</Layout>\n`;
                    fs.writeFileSync(astroPath, newAstroContent, "utf8");
                }
            }
        }
    } catch (syncErr) {
        console.error("Astro auto-sync error:", syncErr);
    }

    res.json({ ok: true, savedAt: new Date().toISOString() });
});


app.post("/api/admin/upload", requireAdmin, (req, res) => {
    const dataUrl = String(req.body?.dataUrl || "");
    const originalName = String(req.body?.name || "image");
    const match = dataUrl.match(/^data:(image\/(?:png|jpeg|webp|gif));base64,([a-z0-9+/=]+)$/i);
    if (!match) return res.status(400).json({ error: "รองรับไฟล์ PNG, JPG, WEBP และ GIF เท่านั้น" });

    const bytes = Buffer.from(match[2], "base64");
    if (bytes.length > 50 * 1024 * 1024) return res.status(413).json({ error: "รูปต้องมีขนาดไม่เกิน 50 MB" });

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

// News API (Public Feed & Admin CRUD)
const newsDataPath = path.join(rootDir, "src", "data", "news.json");
const facebookFeedUrl = "https://rss.app/feeds/v1.1/ElM4FpwMcAN350mf.json";

async function fetchAndSyncFacebookPosts() {
    try {
        const response = await fetch(facebookFeedUrl);
        if (!response.ok) return { ok: false, error: "Feed status " + response.status };
        const feed = await response.json();
        const items = feed.items || [];
        if (!items.length) return { ok: true, count: 0 };

        const safeTrim = (str, max) => {
            if (!str) return "";
            const wellFormed = typeof str.toWellFormed === "function" ? str.toWellFormed() : str;
            const arr = Array.from(wellFormed);
            if (arr.length <= max) return arr.join("");
            return arr.slice(0, max).join("").trim() + "...";
        };

        const mappedPosts = items.map((item, index) => {
            const fullText = (item.content_text || item.title || "").trim();
            const lines = fullText.split("\n").map(l => l.trim()).filter(Boolean);
            const title = lines[0] ? safeTrim(lines[0], 90) : "BONLAB Activity";
            const rawExcerpt = lines.slice(1).join(" ") || lines[0] || "";
            const excerpt = safeTrim(rawExcerpt, 180);

            let category = "BONLAB · ACTIVITY";
            const lower = fullText.toLowerCase();
            if (lower.includes("narit") || lower.includes("ดาราศาสตร์") || lower.includes("ฉางเอ๋อ")) category = "RESEARCH & COLLABORATION";
            else if (lower.includes("eecon") || lower.includes("16-qam")) category = "EXPERIMENTS · EECON";
            else if (lower.includes("พยาบาล") || lower.includes("arduino")) category = "STUDENT MENTORING";
            else if (lower.includes("fpga")) category = "TRAINING · WORKSHOP";
            else if (lower.includes("แรงบันดาลใจ") || lower.includes("พะเยา")) category = "SEMINAR · GUEST SPEAKER";

            let fbUrl = item.url || "https://web.facebook.com/profile.php?id=100076231050286";
            fbUrl = fbUrl.replace("https://m.facebook.com/", "https://web.facebook.com/");

            return {
                id: item.id || `fb-post-${index}`,
                category,
                title,
                excerpt,
                date: (item.date_published || "").split("T")[0] || new Date().toISOString().split("T")[0],
                image: item.image || "/assets/bonlab-lab-cover.jpg",
                facebookUrl: fbUrl
            };
        });

        // Keep news purely 100% real Facebook posts from feed
        // Accumulate new posts with existing posts without duplication
        let existingPosts = [];
        if (fs.existsSync(newsDataPath)) {
            try {
                existingPosts = JSON.parse(fs.readFileSync(newsDataPath, "utf8") || "[]");
            } catch (e) {}
        }

        // Only keep items that have real Facebook permalinks
        const validExisting = existingPosts.filter(p => p.facebookUrl && p.facebookUrl.includes("facebook.com") && !p.id.startsWith("research-"));
        
        const merged = [...mappedPosts];
        for (const prev of validExisting) {
            if (!merged.some(m => m.id === prev.id || m.facebookUrl === prev.facebookUrl)) {
                merged.push(prev);
            }
        }

        fs.mkdirSync(path.dirname(newsDataPath), { recursive: true });
        fs.writeFileSync(newsDataPath, JSON.stringify(merged, null, 2), "utf8");
        return { ok: true, count: merged.length };
    } catch (err) {
        console.error("Facebook sync error:", err);
        return { ok: false, error: err.message };
    }
}


// Auto-sync every 30 minutes
setInterval(() => {
    fetchAndSyncFacebookPosts().then(res => {
        if (res.ok) console.log(`[BONLAB] Auto-synced ${res.count} posts from Facebook feed`);
    });
}, 30 * 60 * 1000);

app.get("/api/news", (req, res) => {
    try {
        if (!fs.existsSync(newsDataPath)) {
            return res.json({ posts: [] });
        }
        const raw = fs.readFileSync(newsDataPath, "utf8");
        const posts = JSON.parse(raw || "[]");
        res.json({ posts });
    } catch (err) {
        res.status(500).json({ error: "Failed to load news" });
    }
});

app.post("/api/news/sync", async (req, res) => {
    const result = await fetchAndSyncFacebookPosts();
    if (result.ok) {
        res.json({ ok: true, count: result.count, message: "ซิงค์ข้อมูลจาก Facebook สำเร็จ" });
    } else {
        res.status(500).json({ ok: false, error: result.error });
    }
});

app.post("/api/admin/news", requireAdmin, (req, res) => {
    try {
        const { posts } = req.body;
        if (!Array.isArray(posts)) {
            return res.status(400).json({ error: "Invalid posts format" });
        }
        fs.mkdirSync(path.dirname(newsDataPath), { recursive: true });
        fs.writeFileSync(newsDataPath, JSON.stringify(posts, null, 2), "utf8");
        res.json({ ok: true, count: posts.length });
    } catch (err) {
        res.status(500).json({ error: "Failed to save news" });
    }
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

function createSessionToken(username = adminUser) {
    const expiresAt = Date.now() + sessionLifetimeMs;
    const payload = Buffer.from(JSON.stringify({ username, expiresAt })).toString("base64url");
    return `${payload}.${sign(payload)}`;
}

function serializeSessionCookie(token) {
    return `bonlab_admin=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${sessionLifetimeMs / 1000}`;
}

function clearSessionCookie() {
    return `bonlab_admin=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`;
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
