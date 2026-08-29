const loginView = document.querySelector("#login-view");
const editorView = document.querySelector("#editor-view");
const loginForm = document.querySelector("#login-form");
const loginError = document.querySelector("#login-error");
const pageSelect = document.querySelector("#page-select");
const saveButton = document.querySelector("#save-button");
const saveStatus = document.querySelector("#save-status");
const loadingState = document.querySelector("#loading-state");
const toast = document.querySelector("#toast");
const imageInput = document.querySelector("#image-input");
const replaceImageButton = document.querySelector("#replace-image-button");

let editor;
let currentFile = "";
let documentState = null;
let isDirty = false;
let isLoading = false;
let changesArmed = false;
let toastTimer;

lucide.createIcons();
checkSession();

loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    loginError.textContent = "";
    const submitButton = loginForm.querySelector("button");
    submitButton.disabled = true;

    try {
        await api("/api/admin/login", {
            method: "POST",
            body: JSON.stringify({
                username: loginForm.username.value.trim(),
                password: loginForm.password.value
            })
        });
        await openEditor();
    } catch (error) {
        loginError.textContent = error.message;
    } finally {
        submitButton.disabled = false;
    }
});

document.querySelector("#logout-button").addEventListener("click", async () => {
    if (isDirty && !window.confirm("มีการแก้ไขที่ยังไม่ได้บันทึก ต้องการออกจากระบบหรือไม่?")) return;
    await api("/api/admin/logout", { method: "POST" });
    editorView.hidden = true;
    loginView.hidden = false;
    loginForm.reset();
});

pageSelect.addEventListener("change", async () => {
    if (isDirty && !window.confirm("การเปลี่ยนหน้าจะทิ้งการแก้ไขที่ยังไม่ได้บันทึก ดำเนินการต่อหรือไม่?")) {
        pageSelect.value = currentFile;
        return;
    }
    await loadPage(pageSelect.value);
});

saveButton.addEventListener("click", savePage);
document.querySelector("#preview-button").addEventListener("click", () => window.open(`/${currentFile}`, "_blank", "noopener"));
document.querySelector("#undo-button").addEventListener("click", () => editor?.UndoManager.undo());
document.querySelector("#redo-button").addEventListener("click", () => editor?.UndoManager.redo());

document.querySelectorAll("[data-device]").forEach((button) => button.addEventListener("click", () => {
    editor.setDevice(button.dataset.device);
    document.querySelectorAll("[data-device]").forEach((item) => item.classList.toggle("active", item === button));
}));

document.querySelectorAll(".tab-button").forEach((button) => button.addEventListener("click", () => {
    document.querySelectorAll(".tab-button").forEach((item) => item.classList.toggle("active", item === button));
    document.querySelectorAll(".tool-panel").forEach((panel) => panel.classList.toggle("active", panel.id === button.dataset.panel));
}));

replaceImageButton.addEventListener("click", () => imageInput.click());
imageInput.addEventListener("change", uploadSelectedImage);

// Canva-style Alignment & Auto-lock to Center
document.querySelector("#snap-center-button")?.addEventListener("click", () => {
    const selected = editor.getSelected();
    if (!selected) {
        showToast("กรุณาคลิกเลือกองค์ประกอบหรือการ์ดที่ต้องการจัดกึ่งกลางก่อน");
        return;
    }
    
    // Auto Lock to Center (Canva Snap)
    selected.addStyle({
        "margin-left": "auto",
        "margin-right": "auto",
        "position": "relative",
        "left": "0px",
        "right": "auto",
        "transform": "none",
        "text-align": "center"
    });

    const el = selected.getEl();
    if (el) {
        // Visual Canva snap feedback
        el.style.outline = "2px solid #3b82f6";
        setTimeout(() => { if (el) el.style.outline = ""; }, 600);
    }
    
    setDirty(true);
    showToast("🎯 ล็อคเข้าสู่กึ่งกลาง (Auto-Locked to Center) เรียบร้อยแล้ว!");
});

document.querySelector("#align-left-button")?.addEventListener("click", () => {
    const selected = editor.getSelected();
    if (!selected) {
        showToast("กรุณาคลิกเลือกองค์ประกอบก่อน");
        return;
    }
    selected.addStyle({
        "margin-left": "0px",
        "margin-right": "auto",
        "left": "0px",
        "right": "auto",
        "text-align": "left"
    });
    setDirty(true);
    showToast("⬅️ จัดชิดซ้าย (Align Left) แล้ว");
});

document.querySelector("#align-right-button")?.addEventListener("click", () => {
    const selected = editor.getSelected();
    if (!selected) {
        showToast("กรุณาคลิกเลือกองค์ประกอบก่อน");
        return;
    }
    selected.addStyle({
        "margin-left": "auto",
        "margin-right": "0px",
        "left": "auto",
        "right": "0px",
        "text-align": "right"
    });
    setDirty(true);
    showToast("➡️ จัดชิดขวา (Align Right) แล้ว");
});

let isFreeDragMode = false;
const freeDragButton = document.querySelector("#free-drag-button");
freeDragButton?.addEventListener("click", () => {
    isFreeDragMode = !isFreeDragMode;
    freeDragButton.classList.toggle("active", isFreeDragMode);
    
    const selected = editor.getSelected();
    if (selected) {
        if (isFreeDragMode) {
            selected.addStyle({
                "position": "relative",
                "z-index": "10"
            });
            showToast("🖐️ โหมดขยับอิสระ: คุณสามารถปรับตำแหน่งหรือลากชิ้นงานนี้ได้อย่างอิสระ");
        } else {
            showToast("🔒 ปิดโหมดขยับอิสระ");
        }
    } else {
        showToast(isFreeDragMode ? "🖐️ เปิดโหมดขยับอิสระ: คลิกเลือกชิ้นงานเพื่อขยับ" : "🔒 ปิดโหมดขยับอิสระ");
    }
});


window.addEventListener("beforeunload", (event) => {
    if (!isDirty) return;
    event.preventDefault();
    event.returnValue = "";
});

async function checkSession() {
    try {
        await api("/api/admin/session");
        await openEditor();
    } catch {
        loginView.hidden = false;
        editorView.hidden = true;
    }
}

async function openEditor() {
    loginView.hidden = true;
    editorView.hidden = false;
    if (!editor) initializeEditor();

    const data = await api("/api/admin/pages");
    pageSelect.innerHTML = data.pages.map((page) => `<option value="${escapeHtml(page.file)}">${escapeHtml(pageLabel(page.file))}</option>`).join("");
    await loadPage(currentFile || data.pages[0].file);
    lucide.createIcons();
}

function initializeEditor() {
    editor = grapesjs.init({
        container: "#gjs",
        height: "100%",
        width: "auto",
        fromElement: false,
        storageManager: false,
        panels: { defaults: [] },
        blockManager: { appendTo: "#blocks" },
        styleManager: {
            appendTo: "#styles",
            sectors: [
                { name: "ขนาดและตำแหน่ง", open: true, buildProps: ["display", "position", "width", "height", "max-width", "min-height", "margin", "padding"] },
                { name: "ตัวอักษร", open: false, buildProps: ["font-family", "font-size", "font-weight", "line-height", "color", "text-align", "text-decoration"] },
                { name: "พื้นหลังและกรอบ", open: false, buildProps: ["background-color", "border", "border-radius", "box-shadow", "opacity"] },
                { name: "Flex และ Grid", open: false, buildProps: ["flex-direction", "justify-content", "align-items", "gap", "grid-template-columns"] }
            ]
        },
        traitManager: { appendTo: "#traits" },
        layerManager: { appendTo: "#layers" },
        selectorManager: { componentFirst: true },
        canvas: { styles: ["/assets/style.css"] },
        deviceManager: {
            devices: [
                { name: "Desktop", width: "" },
                { name: "Tablet", width: "768px", widthMedia: "950px" },
                { name: "Mobile portrait", width: "390px", widthMedia: "650px" }
            ]
        }
    });

    addBlocks();
    editor.on("load", () => {
        ensureCanvasBase();
        const canvasDocument = editor.Canvas.getDocument();
        canvasDocument.addEventListener("pointerdown", () => { changesArmed = true; }, true);
        canvasDocument.addEventListener("keydown", () => { changesArmed = true; }, true);
    });
    editor.on("component:selected", updateSelectionTools);
    editor.on("component:deselected", updateSelectionTools);
    editor.on("update", () => {
        if (!isLoading && changesArmed) setDirty(true);
    });

    document.querySelector(".editor-sidebar").addEventListener("pointerdown", (event) => {
        if (!event.target.closest(".tab-button")) changesArmed = true;
    }, true);
}

function addBlocks() {
    const blocks = [
        ["section", "Section", "▱", `<section class="section"><div class="container"><h2>หัวข้อ Section</h2><p>เพิ่มเนื้อหาของคุณที่นี่</p></div></section>`],
        ["heading", "หัวข้อ", "H", `<h2>หัวข้อใหม่</h2>`],
        ["text", "ข้อความ", "T", `<p>ดับเบิลคลิกเพื่อแก้ไขข้อความ</p>`],
        ["button", "ปุ่ม", "▣", `<a class="button button-primary" href="#">ข้อความบนปุ่ม</a>`],
        ["image", "รูปภาพ", "▧", { type: "image", src: "/assets/bonlab-lab-cover.jpg", alt: "คำอธิบายรูปภาพ", style: { width: "100%" } }],
        ["two-columns", "2 คอลัมน์", "▥", `<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px"><div><h3>คอลัมน์หนึ่ง</h3><p>เพิ่มเนื้อหาที่นี่</p></div><div><h3>คอลัมน์สอง</h3><p>เพิ่มเนื้อหาที่นี่</p></div></div>`],
        ["card", "การ์ด", "▤", `<article class="feature-card"><h3>ชื่อการ์ด</h3><p>รายละเอียดของการ์ด</p><a href="#" class="card-link">อ่านต่อ →</a></article>`],
        ["quote", "คำคม", "❝", `<blockquote style="padding:24px;border-left:4px solid #175cd3;background:#edf3ff">ข้อความอ้างอิงหรือข้อความสำคัญ</blockquote>`],
        ["divider", "เส้นแบ่ง", "―", `<hr style="border:0;border-top:1px solid #d8dee8;margin:28px 0">`],
        ["spacer", "ระยะห่าง", "↕", `<div style="height:48px" aria-hidden="true"></div>`]
    ];

    blocks.forEach(([id, label, media, content]) => editor.BlockManager.add(id, { label, media, content, category: "ทั่วไป" }));
}

async function loadPage(file) {
    isLoading = true;
    changesArmed = false;
    loadingState.hidden = false;

    try {
        const data = await api(`/api/admin/page?file=${encodeURIComponent(file)}`);
        const parsed = parseDocument(data.html);
        documentState = parsed;
        currentFile = file;
        pageSelect.value = file;

        editor.DomComponents.clear();
        editor.CssComposer.clear();
        editor.setComponents(parsed.bodyHtml);
        editor.setStyle(parsed.editorCss);
        await new Promise((resolve) => setTimeout(resolve, 350));
        editor.UndoManager.clear();
        editor.select(null);
        ensureCanvasBase();
        setDirty(false);
    } catch (error) {
        showToast(error.message, true);
    } finally {
        isLoading = false;
        loadingState.hidden = true;
    }
}

function parseDocument(html) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const editorStyle = doc.head.querySelector("#page-editor-overrides");
    const editorCss = editorStyle?.textContent || "";
    editorStyle?.remove();

    const scripts = [...doc.body.querySelectorAll("script")].map((node) => node.outerHTML);
    doc.body.querySelectorAll("script").forEach((node) => node.remove());

    return {
        htmlAttributes: attributesToString(doc.documentElement),
        headHtml: doc.head.innerHTML.trim(),
        bodyAttributes: attributesToString(doc.body),
        bodyHtml: doc.body.innerHTML.trim(),
        scripts
    };
}

async function savePage() {
    if (!documentState || !currentFile) return;
    saveButton.disabled = true;
    saveButton.querySelector("span").textContent = "กำลังบันทึก";

    try {
        const editorCss = editor.getCss().trim();
        const styleTag = editorCss ? `\n<style id="page-editor-overrides">\n${editorCss}\n</style>` : "";
        const scripts = documentState.scripts.length ? `\n${documentState.scripts.join("\n")}` : "";
        const html = `<!DOCTYPE html>\n<html${documentState.htmlAttributes}>\n<head>\n${documentState.headHtml}${styleTag}\n</head>\n<body${documentState.bodyAttributes}>\n${editor.getHtml()}${scripts}\n</body>\n</html>\n`;

        await api("/api/admin/save", { method: "POST", body: JSON.stringify({ file: currentFile, html }) });
        setDirty(false);
        showToast(`บันทึก ${pageLabel(currentFile)} แล้ว`);
    } catch (error) {
        showToast(error.message, true);
    } finally {
        saveButton.disabled = false;
        saveButton.querySelector("span").textContent = "บันทึก";
    }
}

async function uploadSelectedImage() {
    const file = imageInput.files?.[0];
    const selected = editor.getSelected();
    if (!file || !selected) return;

    replaceImageButton.disabled = true;
    try {
        const dataUrl = await readFileAsDataUrl(file);
        const result = await api("/api/admin/upload", {
            method: "POST",
            body: JSON.stringify({ name: file.name, dataUrl })
        });
        selected.addAttributes({ src: result.url });
        setDirty(true);
        showToast("อัปโหลดรูปแล้ว กดบันทึกเพื่อเผยแพร่บนหน้านี้");
    } catch (error) {
        showToast(error.message, true);
    } finally {
        replaceImageButton.disabled = false;
        imageInput.value = "";
    }
}

function updateSelectionTools() {
    const selected = editor.getSelected();
    const isImage = selected && String(selected.get("tagName") || "").toLowerCase() === "img";
    replaceImageButton.hidden = !isImage;
}

function ensureCanvasBase() {
    const head = editor?.Canvas.getDocument()?.head;
    if (!head || head.querySelector("base[data-bonlab-editor]")) return;
    const base = document.createElement("base");
    base.href = "/";
    base.dataset.bonlabEditor = "true";
    head.prepend(base);
}

function setDirty(value) {
    isDirty = value;
    saveStatus.classList.toggle("dirty", value);
    saveStatus.lastChild.textContent = value ? "มีการแก้ไขที่ยังไม่ได้บันทึก" : "บันทึกแล้ว";
}

function attributesToString(element) {
    const values = [...element.attributes].map((attribute) => `${attribute.name}="${escapeAttribute(attribute.value)}"`);
    return values.length ? ` ${values.join(" ")}` : "";
}

function pageLabel(file) {
    const labels = {
        "index.html": "หน้าแรก", "about.html": "เกี่ยวกับเรา", "research.html": "งานวิจัย",
        "research-detail.html": "รายละเอียดงานวิจัย", "partners.html": "พันธมิตร", "news.html": "ข่าวสาร",
        "news-detail.html": "รายละเอียดข่าว", "team.html": "ทีมงาน", "contact.html": "ติดต่อเรา"
    };
    return labels[file] || file;
}

function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error("อ่านไฟล์รูปไม่สำเร็จ"));
        reader.readAsDataURL(file);
    });
}

async function api(url, options = {}) {
    const response = await fetch(url, {
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", ...(options.headers || {}) },
        ...options
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "เกิดข้อผิดพลาด กรุณาลองอีกครั้ง");
    return data;
}

function showToast(message, isError = false) {
    clearTimeout(toastTimer);
    toast.textContent = message;
    toast.classList.toggle("error", isError);
    toast.classList.add("show");
    toastTimer = setTimeout(() => toast.classList.remove("show"), 3200);
}

function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[character]);
}

function escapeAttribute(value) {
    return String(value).replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}
