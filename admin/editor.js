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
const selectionEmpty = document.querySelector("#selection-empty");
const quickStyleControls = document.querySelector("#quick-style-controls");
const selectionToolbar = document.querySelector("#selection-toolbar");
const selectedComponentName = document.querySelector("#selected-component-name");
const toolbarSelectionName = document.querySelector("#toolbar-selection-name");
const brandPalette = document.querySelector("#brand-palette");

const bonlabPalette = [
    "#1746A2", "#0EA5A8", "#7C3AED", "#E5484D", "#F59E0B",
    "#172033", "#667085", "#FFFFFF", "#F7F9FC", "#101828"
];
const colorFallbacks = { color: "#172033", "background-color": "#FFFFFF", "border-color": "#E5E9F2" };

let editor;
let currentFile = "";
let documentState = null;
let isDirty = false;
let isLoading = false;
let changesArmed = false;
let activeColorProperty = "background-color";
let toastTimer;

initializeQuickDesignControls();
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
    editor.on("component:styleUpdate", () => requestAnimationFrame(syncQuickStyleControls));
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
    selectionEmpty.hidden = Boolean(selected);
    quickStyleControls.hidden = !selected;
    selectionToolbar.hidden = !selected;

    if (!selected) return;

    const label = componentLabel(selected);
    selectedComponentName.textContent = label;
    toolbarSelectionName.textContent = label;
    syncQuickStyleControls();
}

function initializeQuickDesignControls() {
    brandPalette.innerHTML = bonlabPalette.map((color) => `
        <button type="button" class="palette-swatch" data-palette-color="${color}" style="--swatch:${color}" aria-label="ใช้สี ${color}" title="${color}"></button>
    `).join("");

    document.querySelectorAll("[data-color-control]").forEach((control) => {
        control.addEventListener("pointerdown", () => activateColorProperty(control.dataset.colorControl));
    });

    document.querySelectorAll("[data-palette-color]").forEach((button) => {
        button.addEventListener("click", () => applyColor(activeColorProperty, button.dataset.paletteColor));
    });

    document.querySelectorAll("[data-color-input]").forEach((input) => {
        input.addEventListener("input", () => applyColor(input.dataset.colorInput, input.value));
    });

    document.querySelectorAll("[data-hex-input]").forEach((input) => {
        const commit = () => {
            const color = normalizeHexColor(input.value);
            if (!color) {
                syncQuickStyleControls();
                showToast("กรุณาใส่รหัสสี เช่น #1746A2", true);
                return;
            }
            applyColor(input.dataset.hexInput, color);
        };
        input.addEventListener("change", commit);
        input.addEventListener("keydown", (event) => {
            if (event.key === "Enter") {
                event.preventDefault();
                commit();
                input.blur();
            }
        });
    });

    document.querySelectorAll("[data-reset-style]").forEach((button) => {
        button.addEventListener("click", () => resetStyle(button.dataset.resetStyle));
    });

    document.querySelectorAll("[data-eyedropper]").forEach((button) => {
        button.hidden = !("EyeDropper" in window);
        button.addEventListener("click", () => pickColorFromScreen(button.dataset.eyedropper));
    });

    document.querySelectorAll("[data-style-range]").forEach((input) => {
        input.addEventListener("input", () => applyRangeStyle(input.dataset.styleRange, Number(input.value)));
    });

    document.querySelectorAll("[data-component-action]").forEach((button) => {
        button.addEventListener("click", () => runComponentAction(button.dataset.componentAction));
    });

    document.querySelectorAll("[data-open-color]").forEach((button) => {
        button.addEventListener("click", () => {
            openStylePanel();
            const property = button.dataset.openColor;
            activateColorProperty(property);
            const control = document.querySelector(`[data-color-control="${property}"]`);
            control?.scrollIntoView({ behavior: "smooth", block: "center" });
            setTimeout(() => control?.querySelector("input[type=color]")?.click(), 180);
        });
    });
}

function activateColorProperty(property) {
    activeColorProperty = property;
    document.querySelectorAll("[data-color-control]").forEach((control) => {
        control.classList.toggle("active", control.dataset.colorControl === property);
    });
}

function applyColor(property, value) {
    const selected = editor?.getSelected();
    const color = normalizeHexColor(value);
    if (!selected || !color) return;

    changesArmed = true;
    const styles = { [property]: color };
    if (property === "border-color") {
        const computed = selected.getEl()?.ownerDocument?.defaultView?.getComputedStyle(selected.getEl());
        if (!computed || computed.borderStyle === "none") {
            styles["border-style"] = "solid";
            styles["border-width"] = "1px";
        }
    }
    selected.addStyle(styles);
    setDirty(true);
    syncQuickStyleControls();
}

function resetStyle(property) {
    const selected = editor?.getSelected();
    if (!selected) return;
    changesArmed = true;
    selected.removeStyle(property);
    if (property === "border-color") {
        selected.removeStyle("border-style");
        selected.removeStyle("border-width");
    }
    setDirty(true);
    syncQuickStyleControls();
}

async function pickColorFromScreen(property) {
    if (!("EyeDropper" in window)) return;
    try {
        const result = await new EyeDropper().open();
        applyColor(property, result.sRGBHex);
    } catch (error) {
        if (error.name !== "AbortError") showToast("ไม่สามารถดูดสีจากหน้าจอได้", true);
    }
}

function applyRangeStyle(property, value) {
    const selected = editor?.getSelected();
    if (!selected) return;
    changesArmed = true;

    const styleValue = property === "opacity" ? String(value / 100) : `${value}px`;
    selected.addStyle({ [property]: styleValue });
    setDirty(true);
    updateRangeOutput(property, value);
}

function syncQuickStyleControls() {
    const selected = editor?.getSelected();
    const element = selected?.getEl();
    if (!selected || !element) return;

    const computed = element.ownerDocument.defaultView.getComputedStyle(element);
    ["color", "background-color", "border-color"].forEach((property) => {
        const color = cssColorToHex(computed.getPropertyValue(property), colorFallbacks[property]);
        const picker = document.querySelector(`[data-color-input="${property}"]`);
        const hex = document.querySelector(`[data-hex-input="${property}"]`);
        const preview = document.querySelector(`[data-color-preview="${property}"]`);
        const toolbarColor = document.querySelector(`[data-toolbar-color="${property}"]`);
        if (picker) picker.value = color;
        if (hex) hex.value = color.toUpperCase();
        if (preview) preview.style.backgroundColor = color;
        if (toolbarColor) toolbarColor.style.backgroundColor = color;
    });

    const opacity = Math.round((Number.parseFloat(computed.opacity) || 1) * 100);
    const radius = Math.min(80, Math.round(Number.parseFloat(computed.borderRadius) || 0));
    const fontSize = Math.min(120, Math.max(8, Math.round(Number.parseFloat(computed.fontSize) || 16)));
    setRangeValue("opacity", opacity);
    setRangeValue("border-radius", radius);
    setRangeValue("font-size", fontSize);

    const tagName = String(selected.get("tagName") || "div").toLowerCase();
    const textTags = ["a", "button", "p", "span", "strong", "small", "label", "li", "h1", "h2", "h3", "h4", "h5", "h6"];
    const textControl = document.querySelector(".text-only-control");
    const fontInput = textControl.querySelector("input");
    const supportsText = textTags.includes(tagName);
    textControl.classList.toggle("disabled", !supportsText);
    fontInput.disabled = !supportsText;
}

function setRangeValue(property, value) {
    const input = document.querySelector(`[data-style-range="${property}"]`);
    if (input) input.value = value;
    updateRangeOutput(property, value);
}

function updateRangeOutput(property, value) {
    const output = document.querySelector(`[data-range-output="${property}"]`);
    if (!output) return;
    output.textContent = property === "opacity" ? `${value}%` : `${value} px`;
}

function runComponentAction(action) {
    const selected = editor?.getSelected();
    const parent = selected?.parent();
    if (!selected || !parent) return;

    changesArmed = true;
    const index = selected.index();
    const lastIndex = parent.components().length - 1;

    if (action === "duplicate") {
        const copy = selected.clone();
        parent.components().add(copy, { at: index + 1 });
        editor.select(copy);
    } else if (action === "delete") {
        selected.remove();
        editor.select(null);
    } else if (action === "move-up" && index > 0) {
        selected.move(parent, { at: index - 1 });
        editor.select(selected);
    } else if (action === "move-down" && index < lastIndex) {
        selected.move(parent, { at: index + 2 });
        editor.select(selected);
    } else {
        showToast(action === "move-up" ? "ชิ้นงานอยู่บนสุดแล้ว" : "ชิ้นงานอยู่ล่างสุดแล้ว");
        return;
    }
    setDirty(true);
}

function openStylePanel() {
    const button = document.querySelector('[data-panel="styles-panel"]');
    if (!button) return;
    document.querySelectorAll(".tab-button").forEach((item) => item.classList.toggle("active", item === button));
    document.querySelectorAll(".tool-panel").forEach((panel) => panel.classList.toggle("active", panel.id === "styles-panel"));
}

function componentLabel(component) {
    const tagName = String(component.get("tagName") || "div").toLowerCase();
    const classes = component.getClasses?.() || [];
    const friendlyNames = {
        section: "Section", img: "รูปภาพ", a: "ลิงก์ / ปุ่ม", p: "ข้อความ", span: "ข้อความ",
        h1: "หัวข้อใหญ่", h2: "หัวข้อ", h3: "หัวข้อย่อย", button: "ปุ่ม", article: "การ์ด", div: "กล่อง"
    };
    const className = classes[0] ? ` · .${classes[0]}` : "";
    return `${friendlyNames[tagName] || tagName.toUpperCase()}${className}`;
}

function normalizeHexColor(value) {
    const raw = String(value || "").trim().replace(/^#/, "");
    if (/^[0-9a-f]{3}$/i.test(raw)) return `#${raw.split("").map((character) => character + character).join("")}`.toUpperCase();
    if (/^[0-9a-f]{6}$/i.test(raw)) return `#${raw}`.toUpperCase();
    return null;
}

function cssColorToHex(value, fallback) {
    const normalized = normalizeHexColor(value);
    if (normalized) return normalized;
    const match = String(value || "").match(/rgba?\(\s*(\d+(?:\.\d+)?)\s*,?\s*(\d+(?:\.\d+)?)\s*,?\s*(\d+(?:\.\d+)?)(?:\s*[,/]\s*([\d.]+))?\s*\)/i);
    if (!match || Number(match[4]) === 0) return fallback;
    return `#${[match[1], match[2], match[3]].map((part) => Math.max(0, Math.min(255, Math.round(Number(part)))).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
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
