import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { fetchApifyItems } from "./apify.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = __dirname;
const envPath = path.join(rootDir, ".env");
if (fs.existsSync(envPath)) process.loadEnvFile(envPath);

const distDir = path.join(rootDir, "dist");
const builtHtmlDir = fs.existsSync(path.join(distDir, "index.html")) ? distDir : rootDir;

// DATA_DIR (production/Docker): everything the site writes at runtime lives here, so it survives redeploys
// and can be backed up as one folder. Without DATA_DIR the old local-dev behaviour is kept.
const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : null;
const htmlDir = dataDir ? path.join(dataDir, "pages") : builtHtmlDir;
const uploadDirs = dataDir
    ? [path.join(dataDir, "uploads")]
    : [path.join(rootDir, "public", "assets", "uploads"), path.join(distDir, "assets", "uploads")];
const backupDir = dataDir ? path.join(dataDir, "backups") : path.join(rootDir, "backups");
const newsDataPath = dataDir ? path.join(dataDir, "news.json") : path.join(rootDir, "src", "data", "news.json");

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

// First start with an empty DATA_DIR: copy the built pages + news in. Existing files are never overwritten,
// so redeploying a new image keeps the admin's edits.
if (dataDir) {
    [htmlDir, ...uploadDirs, backupDir].forEach((dir) => fs.mkdirSync(dir, { recursive: true }));
    for (const file of pageFiles) {
        const target = path.join(htmlDir, file);
        const seed = path.join(builtHtmlDir, file);
        if (!fs.existsSync(target) && fs.existsSync(seed)) fs.copyFileSync(seed, target);
    }
    const seedNews = path.join(rootDir, "src", "data", "news.json");
    if (!fs.existsSync(newsDataPath) && fs.existsSync(seedNews)) fs.copyFileSync(seedNews, newsDataPath);
}

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
if (dataDir) app.use("/assets/uploads", express.static(uploadDirs[0], { dotfiles: "deny" }));
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

    fs.mkdirSync(backupDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");

    const targetDist = path.join(htmlDir, file);
    if (fs.existsSync(targetDist)) {
        fs.copyFileSync(targetDist, path.join(backupDir, `${file}.${stamp}.bak`));
        fs.writeFileSync(targetDist, html, "utf8");
    }

    const targetRoot = path.join(rootDir, file);
    // With DATA_DIR the volume is the only source of truth: never write back into the source tree.
    if (!dataDir && fs.existsSync(targetRoot) && targetRoot !== targetDist) {
        fs.writeFileSync(targetRoot, html, "utf8");
    }

    // Auto-sync into src/pages/*.astro to prevent build overwriting
    try {
        const astroPageName = file.replace(/\.html$/i, ".astro");
        const astroPath = path.join(rootDir, "src", "pages", astroPageName);
        if (!dataDir && fs.existsSync(astroPath)) {
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

    uploadDirs.forEach(dir => {
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, filename), bytes);
    });

    res.json({ ok: true, url: `/assets/uploads/${filename}` });
});

// News API (Public Feed & Facebook Graph API)
const fbPageId = process.env.FB_PAGE_ID || "100076231050286";
const fbAccessToken = process.env.FB_PAGE_ACCESS_TOKEN || "";
const fallbackFeedUrl = process.env.FB_FEED_URL || "";
const apifyToken = process.env.APIFY_TOKEN || "";
const apifyActor = process.env.APIFY_ACTOR || "apify~facebook-posts-scraper";
const newsSource = fbAccessToken ? "graph" : apifyToken ? "apify" : fallbackFeedUrl ? "feed" : "none";

// Cache Facebook CDN images locally to prevent broken images from signed token expiration
async function cacheFacebookImage(imageUrl, id) {
    if (!imageUrl || !imageUrl.startsWith("http")) return imageUrl || "/assets/bonlab-lab-cover.jpg";
    try {
        uploadDirs.forEach(dir => fs.mkdirSync(dir, { recursive: true }));
        const cleanId = String(id).replace(/[^a-z0-9_-]/gi, "");
        const filename = `fb-${cleanId}.jpg`;
        const cachedPath = path.join(uploadDirs[0], filename);

        if (fs.existsSync(cachedPath) && fs.statSync(cachedPath).size > 1000) {
            return `/assets/uploads/${filename}`;
        }

        const res = await fetch(imageUrl, { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(10000) });
        if (!res.ok) return imageUrl;
        const buffer = Buffer.from(await res.arrayBuffer());
        uploadDirs.forEach(dir => fs.writeFileSync(path.join(dir, filename), buffer));
        return `/assets/uploads/${filename}`;
    } catch (err) {
        console.warn(`[BONLAB] Failed to cache FB image ${id}:`, err.message);
        return imageUrl;
    }
}

function guessCategory(text) {
    const lower = String(text).toLowerCase();
    if (lower.includes("narit") || lower.includes("ดาราศาสตร์") || lower.includes("ฉางเอ๋อ")) return { category: "RESEARCH & COLLABORATION", filter: "research" };
    if (lower.includes("eecon") || lower.includes("16-qam")) return { category: "EXPERIMENTS · EECON", filter: "research" };
    if (lower.includes("รางวัล") || lower.includes("award")) return { category: "AWARD", filter: "awards" };
    if (lower.includes("พยาบาล") || lower.includes("arduino")) return { category: "STUDENT MENTORING", filter: "students" };
    if (lower.includes("fpga")) return { category: "TRAINING · WORKSHOP", filter: "seminars" };
    if (lower.includes("แรงบันดาลใจ") || lower.includes("พะเยา")) return { category: "SEMINAR · GUEST SPEAKER", filter: "seminars" };
    return { category: "BONLAB · ACTIVITY", filter: "seminars" };
}

function parseFeedContent(text) {
    const trimmed = text.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
        try {
            const json = JSON.parse(trimmed);
            return Array.isArray(json) ? json : (json.items || json.data || []);
        } catch {
            return [];
        }
    }
    
    // Parse RSS / Atom XML (e.g. FetchRSS or standard RSS feeds)
    const items = [];
    const itemRegex = /<(?:item|entry)[\s\S]*?<\/(?:item|entry)>/gi;
    const matches = trimmed.match(itemRegex) || [];
    
    for (const rawItem of matches) {
        const getTag = (tag) => {
            const m = rawItem.match(new RegExp(`<${tag}[^>]*>(?:<\\!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`, "i"));
            return m ? m[1].trim() : "";
        };

        const title = getTag("title");
        const content = getTag("description") || getTag("content:encoded") || getTag("summary") || getTag("content");
        const link = getTag("link") || rawItem.match(/<link[^>]+href=["']([^"']+)["']/i)?.[1] || "";
        const date = getTag("pubDate") || getTag("published") || getTag("updated") || getTag("dc:date");
        
        let image = "";
        const encMatch = rawItem.match(/<enclosure[^>]+url=["']([^"']+)["']/i);
        const mediaMatch = rawItem.match(/<media:(?:content|thumbnail)[^>]+url=["']([^"']+)["']/i);
        const imgTagMatch = content.match(/<img[^>]+src=["']([^"']+)["']/i);
        
        if (encMatch) image = encMatch[1];
        else if (mediaMatch) image = mediaMatch[1];
        else if (imgTagMatch) image = imgTagMatch[1];

        const cleanContent = content.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

        items.push({
            id: link || Buffer.from(title || "post").toString("hex").slice(0, 16),
            title: title.replace(/<[^>]+>/g, "").trim(),
            content_text: cleanContent,
            url: link,
            date_published: date,
            image: image
        });
    }
    return items;
}

let lastSync = { at: null, ok: null, error: newsSource !== "none" ? "" : "ยังไม่ได้ตั้งค่า FB_PAGE_ACCESS_TOKEN, APIFY_TOKEN หรือ FB_FEED_URL" };

async function fetchAndSyncFacebookPosts() {
    const result = await syncFacebookPostsOnce();
    lastSync = { at: new Date().toISOString(), ok: result.ok, error: result.error || "" };
    return result;
}

async function syncFacebookPostsOnce() {
    try {
        let mappedPosts = [];

        // 1. If Facebook Graph API token is provided, use the official Meta Graph API
        if (fbAccessToken) {
            console.log(`[BONLAB] Fetching posts via Facebook Graph API for Page: ${fbPageId}...`);
            const apiUrl = `https://graph.facebook.com/v20.0/${fbPageId}/posts?fields=id,message,created_time,full_picture,permalink_url&limit=25&access_token=${fbAccessToken}`;
            const response = await fetch(apiUrl, { signal: AbortSignal.timeout(20000) });
            const data = await response.json();

            if (!response.ok || data.error) {
                const errMsg = data.error?.message || `Graph API error status: ${response.status}`;
                console.error("[BONLAB] Facebook Graph API error:", errMsg);
                return { ok: false, error: errMsg };
            }

            const items = data.data || [];
            console.log(`[BONLAB] Received ${items.length} posts from Facebook Graph API`);

            for (const item of items) {
                const message = (item.message || "").trim();
                const lines = message.split("\n").map(l => l.trim()).filter(Boolean);
                const title = lines[0] ? (lines[0].length > 90 ? lines[0].slice(0, 90) + "..." : lines[0]) : "BONLAB Activity";
                const rawExcerpt = lines.slice(1).join(" ") || lines[0] || "";
                const excerpt = rawExcerpt.length > 180 ? rawExcerpt.slice(0, 180) + "..." : rawExcerpt;

                const { category, filter } = guessCategory(message);

                const localImage = await cacheFacebookImage(item.full_picture, item.id);

                mappedPosts.push({
                    id: item.id,
                    category,
                    filter,
                    title,
                    excerpt,
                    date: (item.created_time || "").split("T")[0] || new Date().toISOString().split("T")[0],
                    image: localImage,
                    facebookUrl: item.permalink_url || `https://web.facebook.com/profile.php?id=${fbPageId}`
                });
            }
        } 
        // 2. Apify Actor dataset (scheduled in Apify Console), or 3. a JSON/XML feed URL. Both map to the same item shape.
        else if (apifyToken || fallbackFeedUrl) {
            let items;
            if (apifyToken) {
                console.log(`[BONLAB] Fetching posts via Apify Actor ${apifyActor}...`);
                const result = await fetchApifyItems(apifyToken, apifyActor, fbPageId);
                if (!result.ok) return result;
                items = result.items;
            } else {
                console.log(`[BONLAB] Fetching posts via Feed URL: ${fallbackFeedUrl}...`);
                const response = await fetch(fallbackFeedUrl, { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(20000) });
                if (!response.ok) return { ok: false, error: "Feed status " + response.status };
                items = parseFeedContent(await response.text());
            }
            for (let i = 0; i < items.length; i++) {
                const item = items[i];
                const fullText = (item.content_text || item.title || "").trim();
                const lines = fullText.split("\n").map(l => l.trim()).filter(Boolean);
                const title = lines[0] ? (lines[0].length > 90 ? lines[0].slice(0, 90) + "..." : lines[0]) : "BONLAB Activity";
                const rawExcerpt = lines.slice(1).join(" ") || lines[0] || "";
                const excerpt = rawExcerpt.length > 180 ? rawExcerpt.slice(0, 180) + "..." : rawExcerpt;

                const { category, filter } = guessCategory(fullText);

                const cleanId = item.id || `feed-post-${i}`;
                const localImage = await cacheFacebookImage(item.image, cleanId);

                let fbUrl = item.url || `https://web.facebook.com/profile.php?id=${fbPageId}`;
                fbUrl = fbUrl.replace("https://m.facebook.com/", "https://web.facebook.com/");

                mappedPosts.push({
                    id: cleanId,
                    category,
                    filter,
                    title,
                    excerpt,
                    date: (item.date_published || "").split("T")[0] || new Date().toISOString().split("T")[0],
                    image: localImage,
                    facebookUrl: fbUrl
                });
            }
        } else {
            return {
                ok: false,
                error: "กรุณาระบุ FB_PAGE_ACCESS_TOKEN, APIFY_TOKEN หรือ FB_FEED_URL ในไฟล์ .env"
            };
        }

        if (!mappedPosts.length) return { ok: true, count: 0 };

        // Accumulate new posts with existing posts without duplication
        let existingPosts = [];
        if (fs.existsSync(newsDataPath)) {
            try {
                const raw = fs.readFileSync(newsDataPath, "utf8");
                existingPosts = JSON.parse(raw || "[]");
            } catch (e) {}
        }

        const validExisting = existingPosts.filter(p => !p.manual && p.facebookUrl && p.facebookUrl.includes("facebook.com") && !p.id.startsWith("research-"));
        
        const manual = existingPosts.filter(p => p.manual);
        const merged = [...manual];
        for (const post of mappedPosts) {
            if (!merged.some(m => m.id === post.id || m.facebookUrl === post.facebookUrl)) merged.push(post);
        }
        for (const prev of validExisting) {
            if (!merged.some(m => m.id === prev.id || m.facebookUrl === prev.facebookUrl)) {
                merged.push(prev);
            }
        }

        fs.mkdirSync(path.dirname(newsDataPath), { recursive: true });
        fs.writeFileSync(newsDataPath, JSON.stringify(merged, null, 2), "utf8");
        return { ok: true, count: merged.length, latestCount: mappedPosts.length };
    } catch (err) {
        console.error("Facebook sync error:", err);
        return { ok: false, error: err.message };
    }
}


// Auto-sync every 30 minutes, only when a source is configured (token or feed URL)
function autoSync() {
    fetchAndSyncFacebookPosts().then(res => {
        if (res.ok) console.log(`[BONLAB] Auto-synced ${res.count} posts from Facebook feed`);
        else console.warn(`[BONLAB] Auto-sync failed, keeping existing news: ${res.error}`);
    });
}
if (newsSource !== "none") {
    setTimeout(autoSync, 10_000);
    setInterval(autoSync, 30 * 60 * 1000);
}

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

app.all("/api/news/sync", requireAdmin, async (req, res) => {
    const result = await fetchAndSyncFacebookPosts();
    if (result.ok) {
        res.json({ ok: true, count: result.count, latestCount: result.latestCount, message: "ซิงค์ข้อมูลจาก Facebook สำเร็จ" });
    } else {
        res.status(500).json({ ok: false, error: result.error });
    }
});

app.get("/api/admin/news", requireAdmin, (req, res) => {
    let posts = [];
    try { posts = JSON.parse(fs.readFileSync(newsDataPath, "utf8") || "[]"); } catch {}
    res.json({ posts, lastSync, source: newsSource });
});

const newsFilters = ["research", "awards", "students", "seminars"];
const cleanUrl = (value) => /^(https?:\/\/|\/)/i.test(String(value || "")) ? String(value).slice(0, 2000) : "";
function cleanNewsPost(p, i) {
    return {
        id: String(p.id || `manual-${Date.now()}-${i}`).slice(0, 200),
        manual: Boolean(p.manual),
        category: String(p.category || "BONLAB · ACTIVITY").slice(0, 80),
        filter: newsFilters.includes(p.filter) ? p.filter : "seminars",
        title: String(p.title || "").slice(0, 200),
        excerpt: String(p.excerpt || "").slice(0, 600),
        date: /^\d{4}-\d{2}-\d{2}$/.test(p.date) ? p.date : new Date().toISOString().split("T")[0],
        image: cleanUrl(p.image) || "/assets/bonlab-lab-cover.jpg",
        facebookUrl: cleanUrl(p.facebookUrl)
    };
}

app.post("/api/admin/news", requireAdmin, (req, res) => {
    try {
        if (!Array.isArray(req.body?.posts)) {
            return res.status(400).json({ error: "Invalid posts format" });
        }
        const posts = req.body.posts.slice(0, 200).map(cleanNewsPost);
        if (fs.existsSync(newsDataPath)) {
            fs.mkdirSync(backupDir, { recursive: true });
            fs.copyFileSync(newsDataPath, path.join(backupDir, `news.json.${new Date().toISOString().replace(/[:.]/g, "-")}.bak`));
        }
        fs.mkdirSync(path.dirname(newsDataPath), { recursive: true });
        fs.writeFileSync(newsDataPath, JSON.stringify(posts, null, 2), "utf8");
        res.json({ ok: true, count: posts.length });
    } catch (err) {
        res.status(500).json({ error: "Failed to save news" });
    }
});



// Used by the Docker healthcheck and scripts/deploy.sh: fails if the data volume is not writable.
app.get("/health", (req, res) => {
    try {
        fs.accessSync(htmlDir, fs.constants.W_OK);
        res.json({ ok: true });
    } catch {
        res.status(503).json({ ok: false, error: "data directory not writable" });
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

// COOKIE_SECURE=true once the site is served over HTTPS (keeps the admin cookie off plain HTTP).
const cookieSecure = process.env.COOKIE_SECURE === "true" ? "; Secure" : "";

function serializeSessionCookie(token) {
    return `bonlab_admin=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${sessionLifetimeMs / 1000}${cookieSecure}`;
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
    const secretPath = path.join(dataDir || rootDir, ".bonlab-session-secret");
    if (fs.existsSync(secretPath)) return fs.readFileSync(secretPath, "utf8").trim();
    fs.mkdirSync(path.dirname(secretPath), { recursive: true });
    const secret = crypto.randomBytes(48).toString("hex");
    fs.writeFileSync(secretPath, secret, { encoding: "utf8", mode: 0o600 });
    return secret;
}
