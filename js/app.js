import { GLFilterPipeline } from "./gl-filters.js";
import { ViewportEngine } from "./canvas-engine.js";
import { SightingTools } from "./sighting-tools.js";
import { calibrate, formatLength, convert, PRESETS } from "./paper-calibration.js";
import { exportReferencePNG, exportBlankGridPDF, exportProjectJSON, importProjectJSON } from "./export.js";
import { Storage, makeId } from "./storage.js";

// ---------------------------------------------------------------------------
// Safety net: surface any unexpected error visibly instead of failing silently.
// Registered first, before anything else can throw.
// ---------------------------------------------------------------------------
function showFatalBanner(message) {
  let banner = document.getElementById("fatalBanner");
  if (!banner) {
    banner = document.createElement("div");
    banner.id = "fatalBanner";
    banner.className = "fatal-banner";
    banner.innerHTML = `<strong>Something went wrong:</strong> <code id="fatalBannerMsg"></code><button type="button">Dismiss</button>`;
    banner.querySelector("button").addEventListener("click", () => banner.remove());
    document.body.prepend(banner);
  }
  banner.querySelector("#fatalBannerMsg").textContent = message;
}
window.addEventListener("error", (e) => {
  console.error("Uncaught error:", e.error || e.message);
  showFatalBanner((e.error && e.error.message) || e.message || "an unknown error occurred");
});
window.addEventListener("unhandledrejection", (e) => {
  console.error("Unhandled promise rejection:", e.reason);
  showFatalBanner((e.reason && e.reason.message) || String(e.reason));
});

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

// ---------------------------------------------------------------------------
// DOM references
// ---------------------------------------------------------------------------
const stage = $("#stage");
const baseCanvas = $("#baseCanvas");
const overlayCanvas = $("#overlayCanvas");
const viewportEl = $("#viewport");
const emptyState = $("#emptyState");
const hud = $("#hud");
const toast = $("#toast");

// ---------------------------------------------------------------------------
// Core engine
// ---------------------------------------------------------------------------
const gl = new GLFilterPipeline(baseCanvas);
const sighting = new SightingTools();
const engine = new ViewportEngine({ stage, baseCanvas, overlayCanvas, glPipeline: gl, sightingTools: sighting });

let activeTool = "pan";
let currentProjectId = null;
let currentImageName = "reference";
let currentImageBlob = null;
let spaceHeld = false;
// Declared up-front (not just where first used) because setTool("pan") below
// runs at module-init time and calls removeCropToolbar(), which reads these —
// a `let` declared later would still be in the temporal dead zone at that point.
let dragState = null;
let cropRect = null; // {x,y,w,h} normalized, in progress or committed-pending
let cropToolbarEl = null;

function showToast(msg, ms = 2600) {
  toast.textContent = msg;
  toast.hidden = false;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => { toast.hidden = true; }, ms);
}

function setEmptyState(visible) {
  emptyState.hidden = !visible;
  hud.hidden = visible;
  baseCanvas.style.visibility = visible ? "hidden" : "visible";
  overlayCanvas.style.visibility = visible ? "hidden" : "visible";
}
setEmptyState(true);

// ===========================================================================
// TOOL SELECTION
// ===========================================================================
function setTool(tool) {
  activeTool = tool;
  $$(".tool-btn[data-tool]").forEach(b => b.classList.toggle("is-active", b.dataset.tool === tool));
  stage.className = "viewport__stage tool-" + tool;
  $("#statusHint").textContent = {
    pan: "Drag to pan · scroll or +/- to zoom.",
    crop: "Drag a rectangle over the image, then confirm.",
    loupe: "Click anywhere on the image to sample its color.",
    caliper: "Click two points to measure a proportion (first pair sets the 1.0× baseline).",
    plumb: "Click to drop a vertical guide · shift-click for horizontal · drag an existing guide to move it.",
    angle: "Click three points: A, the vertex, then C.",
  }[tool] || "";
  if (tool !== "crop") removeCropToolbar();
  if (tool !== "angle") sighting.cancelPendingAngle();
}
$$(".tool-btn[data-tool]").forEach(btn => {
  btn.addEventListener("click", () => {
    const t = btn.dataset.tool;
    if (t === "rotate-l") { engine.rotate90(-1); return; }
    if (t === "rotate-r") { engine.rotate90(1); return; }
    setTool(t);
  });
});
setTool("pan");

// ===========================================================================
// IMAGE IMPORT
// ===========================================================================
async function loadFile(file) {
  if (!file) return;
  if (!/^image\/(png|jpeg|jpg|webp|avif)$/.test(file.type)) {
    showToast("Unsupported format — use JPEG, PNG, WEBP, or AVIF.");
    return;
  }
  if (file.size > 50 * 1024 * 1024) {
    showToast("That file is over the 50MB limit.");
    return;
  }
  const bitmap = await blobToImage(file);
  currentImageBlob = file;
  currentImageName = file.name.replace(/\.[^.]+$/, "") || "reference";
  currentProjectId = makeId();
  sighting.reset();
  await engine.loadImage(bitmap);
  setEmptyState(false);
  updateHudAndStatus();
  scheduleAutoSave(true);
}

function blobToImage(blobOrUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not decode that image."));
    img.src = typeof blobOrUrl === "string" ? blobOrUrl : URL.createObjectURL(blobOrUrl);
  });
}

$("#fileInput").addEventListener("change", (e) => { if (e.target.files[0]) loadFile(e.target.files[0]); e.target.value = ""; });

["dragenter", "dragover"].forEach(evt => viewportEl.addEventListener(evt, (e) => { e.preventDefault(); viewportEl.classList.add("is-dragover"); }));
["dragleave", "drop"].forEach(evt => viewportEl.addEventListener(evt, (e) => { e.preventDefault(); viewportEl.classList.remove("is-dragover"); }));
viewportEl.addEventListener("drop", (e) => { const f = e.dataTransfer.files[0]; if (f) loadFile(f); });

window.addEventListener("paste", (e) => {
  const item = Array.from(e.clipboardData?.items || []).find(i => i.type.startsWith("image/"));
  if (item) loadFile(item.getAsFile());
});

const urlHint = document.createElement("p");
urlHint.className = "empty-state__hint";
urlHint.innerHTML = `or <button class="link-btn" id="btnImportUrl" type="button">load from a URL</button>`;
emptyState.appendChild(urlHint);
$("#btnImportUrl").addEventListener("click", async () => {
  const url = prompt("Paste an image URL:");
  if (!url) return;
  try {
    const img = await blobToImage(url);
    // Cross-origin images without CORS headers will taint the canvas — warn up front.
    img.crossOrigin = "anonymous";
    currentImageBlob = null;
    currentImageName = url.split("/").pop()?.split("?")[0] || "reference";
    currentProjectId = makeId();
    sighting.reset();
    await engine.loadImage(img);
    setEmptyState(false);
    updateHudAndStatus();
  } catch {
    showToast("Couldn't load that URL — the host may block cross-origin image access.");
  }
});

// ===========================================================================
// QUICK ACTIONS (header)
// ===========================================================================
$("#btnFit").addEventListener("click", () => engine.fitToWindow());
$("#btnFlipH").addEventListener("click", () => engine.flipHorizontal());
$("#btnFlipV").addEventListener("click", () => engine.flipVertical());
$("#btnGray").addEventListener("click", () => {
  engine.filters.grayscale = !engine.filters.grayscale;
  $("#toneGrayscale").checked = engine.filters.grayscale;
  $("#btnGray").classList.toggle("is-active", engine.filters.grayscale);
  engine.requestRender(); scheduleAutoSave();
});
function setInspectorOpen(open) {
  $("#inspector").classList.toggle("is-open", open);
  $("#inspectorBackdrop").hidden = !open;
  $("#btnToggleToolbox").setAttribute("aria-expanded", String(open));
}
$("#btnToggleToolbox").addEventListener("click", () => {
  // On narrow screens the toolbox already fits alongside the canvas, and the
  // inspector (Grid/Tone/Paper/Measure) is the panel that's off-screen by
  // default — so the "menu" people expect the hamburger to open is that one.
  // On wider screens the inspector is always visible, so the hamburger's job
  // goes back to reclaiming space by collapsing the tool rail.
  if (window.innerWidth <= 700) {
    setInspectorOpen(!$("#inspector").classList.contains("is-open"));
    return;
  }
  const wa = $(".workarea");
  wa.classList.toggle("toolbox-collapsed");
  $("#btnToggleToolbox").setAttribute("aria-expanded", String(!wa.classList.contains("toolbox-collapsed")));
});
$("#inspectorBackdrop").addEventListener("click", () => setInspectorOpen(false));

// ===========================================================================
// GRID PANEL
// ===========================================================================
const gridEls = {
  type: $("#gridType"), cols: $("#gridCols"), rows: $("#gridRows"),
  lockSquare: $("#gridLockSquare"), diagonals: $("#gridDiagonals"),
  labels: $("#gridLabels"), labelPosition: $("#labelPosition"),
  color: $("#gridColor"), width: $("#gridWidth"), opacity: $("#gridOpacity"), dash: $("#gridDash"),
};
function syncGridFromUI() {
  const cfg = engine.gridConfig;
  cfg.type = gridEls.type.value;
  cfg.enabled = cfg.type !== "none";
  cfg.columns = Math.max(1, parseInt(gridEls.cols.value) || 1);
  cfg.rows = Math.max(1, parseInt(gridEls.rows.value) || 1);
  cfg.cellAspectLocked = gridEls.lockSquare.checked;
  cfg.showDiagonals = gridEls.diagonals.checked;
  cfg.showLabels = gridEls.labels.checked;
  cfg.labelPosition = gridEls.labelPosition.value;
  cfg.strokeColor = gridEls.color.value;
  cfg.labelColor = gridEls.color.value;
  cfg.strokeWidth = parseFloat(gridEls.width.value);
  cfg.opacity = parseInt(gridEls.opacity.value);
  cfg.lineDash = gridEls.dash.value;
  $("#gridWidthVal").textContent = cfg.strokeWidth.toFixed(1);
  $("#gridOpacityVal").textContent = cfg.opacity;
  $("#gridDivRow").style.display = ["cartesian", "rowcol"].includes(cfg.type) ? "flex" : "none";
  engine.requestRender();
  refreshPaperCalc();
  scheduleAutoSave();
}
Object.values(gridEls).forEach(el => el.addEventListener("input", syncGridFromUI));
$$(".chip").forEach(chip => chip.addEventListener("click", () => { gridEls.color.value = chip.dataset.color; syncGridFromUI(); }));
// Note: the initial sync call is deferred to the bottom of this file — it
// transitively calls refreshPaperCalc(), which needs `paperEls` (declared
// further down, in the Paper Calibration section) to already exist.

// ===========================================================================
// TONE PANEL
// ===========================================================================
const toneEls = {
  grayscale: $("#toneGrayscale"), invert: $("#toneInvert"), brightness: $("#toneBrightness"),
  contrast: $("#toneContrast"), posterize: $("#tonePosterize"), threshold: $("#toneThreshold"), blur: $("#toneBlur"),
};
function syncToneFromUI() {
  const f = engine.filters;
  f.grayscale = toneEls.grayscale.checked;
  f.invert = toneEls.invert.checked;
  f.brightness = parseInt(toneEls.brightness.value);
  f.contrast = parseInt(toneEls.contrast.value);
  f.posterizeLevels = parseInt(toneEls.posterize.value);
  f.thresholdValue = parseInt(toneEls.threshold.value);
  f.blurRadius = parseInt(toneEls.blur.value);
  $("#tonePosterizeVal").textContent = f.posterizeLevels === 0 ? "Off" : f.posterizeLevels;
  $("#toneThresholdVal").textContent = f.thresholdValue === 0 ? "Off" : f.thresholdValue;
  $("#toneBrightnessVal").textContent = f.brightness;
  $("#toneContrastVal").textContent = f.contrast;
  $("#toneBlurVal").textContent = f.blurRadius;
  $("#btnGray").classList.toggle("is-active", f.grayscale);
  engine.requestRender();
  scheduleAutoSave();
}
Object.values(toneEls).forEach(el => el.addEventListener("input", syncToneFromUI));
// initial sync deferred to the bottom of this file, alongside syncGridFromUI()

$("#btnPenArt").addEventListener("click", () => {
  engine.filters.penArt = !engine.filters.penArt;
  $("#btnPenArt").classList.toggle("is-active", engine.filters.penArt);
  $$("#panel-tone .field, #panel-tone .check").forEach(el => {
    if (el.contains($("#btnPenArt"))) return;
    el.style.opacity = engine.filters.penArt ? 0.4 : 1;
  });
  engine.requestRender();
  scheduleAutoSave();
});

// ===========================================================================
// COLOR LOUPE
// ===========================================================================
const pickCtx = document.createElement("canvas").getContext("2d");
let pinnedSwatches = [];
function pickColorAt(clientX, clientY) {
  if (!engine.hasImage()) return;
  const norm = engine.clientToNorm(clientX, clientY);
  if (norm.x < 0 || norm.x > 1 || norm.y < 0 || norm.y > 1) return;
  const px = Math.min(gl.canvas.width - 1, Math.round(norm.x * gl.canvas.width));
  const py = Math.min(gl.canvas.height - 1, Math.round(norm.y * gl.canvas.height));
  pickCtx.canvas.width = 1; pickCtx.canvas.height = 1;
  try {
    pickCtx.drawImage(gl.canvas, px, py, 1, 1, 0, 0, 1, 1);
    const [r, g, b] = pickCtx.getImageData(0, 0, 1, 1).data;
    renderLoupe(r, g, b);
  } catch {
    /* canvas may be tainted by a cross-origin image without CORS headers */
    showToast("Can't sample this image's color — it was loaded from a URL without CORS access.");
  }
}
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h, s, l = (max + min) / 2;
  if (max === min) { h = s = 0; }
  else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      default: h = (r - g) / d + 4;
    }
    h /= 6;
  }
  return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
}
let lastPicked = null;
function renderLoupe(r, g, b) {
  const hex = "#" + [r, g, b].map(v => v.toString(16).padStart(2, "0")).join("");
  const [h, s, l] = rgbToHsl(r, g, b);
  lastPicked = hex;
  $("#loupeSwatch").style.background = hex;
  $("#loupeValues").textContent = `RGB ${r}, ${g}, ${b}\nHEX ${hex}\nHSL ${h}°, ${s}%, ${l}%`;
}
$("#loupeSwatch").addEventListener("click", () => {
  if (!lastPicked || pinnedSwatches.length >= 10) return;
  pinnedSwatches.push(lastPicked);
  renderPins();
});
function renderPins() {
  $("#swatchPins").innerHTML = "";
  pinnedSwatches.forEach((hex) => {
    const b = document.createElement("button");
    b.className = "swatch-pin"; b.style.background = hex; b.dataset.hex = hex;
    b.title = hex;
    b.addEventListener("click", () => { gridEls.color.value = hex; syncGridFromUI(); });
    $("#swatchPins").appendChild(b);
  });
}

// ===========================================================================
// POINTER INTERACTION (pan / crop / caliper / plumb / angle / loupe)
// ===========================================================================
function removeCropToolbar() {
  cropToolbarEl?.remove(); cropToolbarEl = null;
  $(".crop-box")?.remove();
  cropRect = null;
}

function drawCropBox() {
  $(".crop-box")?.remove();
  if (!cropRect) return;
  const rect = overlayCanvas.getBoundingClientRect();
  const box = document.createElement("div");
  box.className = "crop-box";
  box.style.left = cropRect.x * rect.width + "px";
  box.style.top = cropRect.y * rect.height + "px";
  box.style.width = cropRect.w * rect.width + "px";
  box.style.height = cropRect.h * rect.height + "px";
  stage.appendChild(box);

  if (!cropToolbarEl) {
    cropToolbarEl = document.createElement("div");
    cropToolbarEl.className = "crop-toolbar";
    cropToolbarEl.innerHTML = `<button class="btn btn--accent" id="cropApply">Apply crop</button><button class="btn btn--ghost" id="cropCancel">Cancel</button>`;
    stage.appendChild(cropToolbarEl);
    cropToolbarEl.querySelector("#cropApply").addEventListener("click", () => {
      if (cropRect && cropRect.w > 0.01 && cropRect.h > 0.01) engine.applyCrop(cropRect);
      removeCropToolbar();
    });
    cropToolbarEl.querySelector("#cropCancel").addEventListener("click", removeCropToolbar);
  }
  cropToolbarEl.style.left = Math.max(0, cropRect.x * rect.width) + "px";
  cropToolbarEl.style.top = Math.max(0, cropRect.y * rect.height - 40) + "px";
}

overlayCanvas.addEventListener("pointerdown", (e) => {
  if (!engine.hasImage() || spaceHeld) return;
  const norm = engine.clientToNorm(e.clientX, e.clientY);
  overlayCanvas.setPointerCapture(e.pointerId);

  if (activeTool === "crop") {
    dragState = { type: "crop", startX: norm.x, startY: norm.y };
    cropRect = { x: norm.x, y: norm.y, w: 0, h: 0 };
    drawCropBox();
  } else if (activeTool === "loupe") {
    pickColorAt(e.clientX, e.clientY);
  } else if (activeTool === "caliper") {
    dragState = { type: "caliper", start: norm };
  } else if (activeTool === "plumb") {
    const hit = sighting.hitTestPlumb(norm.x, norm.y, 8, overlayCanvas.width, overlayCanvas.height);
    if (hit) dragState = { type: "plumb-move", id: hit.id, orientation: hit.orientation };
    else sighting.addPlumb(e.shiftKey ? "h" : "v", e.shiftKey ? norm.y : norm.x);
  } else if (activeTool === "angle") {
    sighting.addAnglePoint(norm);
  }
});

overlayCanvas.addEventListener("pointermove", (e) => {
  if (activeTool === "loupe" && e.buttons === 1) pickColorAt(e.clientX, e.clientY);
  if (!dragState) return;
  const norm = engine.clientToNorm(e.clientX, e.clientY);
  if (dragState.type === "crop") {
    cropRect = {
      x: Math.min(dragState.startX, norm.x), y: Math.min(dragState.startY, norm.y),
      w: Math.abs(norm.x - dragState.startX), h: Math.abs(norm.y - dragState.startY),
    };
    drawCropBox();
  } else if (dragState.type === "caliper") {
    engine.requestRender();
    const octx = overlayCanvas.getContext("2d");
    octx.save(); octx.strokeStyle = "#89aec2"; octx.lineWidth = 1.75;
    octx.beginPath();
    octx.moveTo(dragState.start.x * overlayCanvas.width, dragState.start.y * overlayCanvas.height);
    octx.lineTo(norm.x * overlayCanvas.width, norm.y * overlayCanvas.height);
    octx.stroke(); octx.restore();
  } else if (dragState.type === "plumb-move") {
    sighting.movePlumb(dragState.id, dragState.orientation === "v" ? norm.x : norm.y);
  }
});

overlayCanvas.addEventListener("pointerup", (e) => {
  if (dragState?.type === "caliper") {
    const norm = engine.clientToNorm(e.clientX, e.clientY);
    if (Math.hypot(norm.x - dragState.start.x, norm.y - dragState.start.y) > 0.005) {
      sighting.addCaliper(dragState.start, norm);
    }
  }
  dragState = null;
});

// pan via space+drag or the pan tool
viewportEl.addEventListener("pointerdown", (e) => {
  if (activeTool !== "pan" && !spaceHeld) return;
  if (e.target.closest(".crop-toolbar")) return;
  const startX = e.clientX, startY = e.clientY;
  const startScrollL = viewportEl.scrollLeft, startScrollT = viewportEl.scrollTop;
  stage.classList.add("is-panning");
  const move = (ev) => {
    viewportEl.scrollLeft = startScrollL - (ev.clientX - startX);
    viewportEl.scrollTop = startScrollT - (ev.clientY - startY);
  };
  const up = () => {
    stage.classList.remove("is-panning");
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
});

viewportEl.addEventListener("wheel", (e) => {
  if (!engine.hasImage()) return;
  if (e.ctrlKey || e.metaKey) {
    e.preventDefault();
    engine.zoomBy(e.deltaY < 0 ? 1.08 : 0.93);
    updateHudAndStatus();
  }
}, { passive: false });

// ===========================================================================
// HUD / STATUS BAR
// ===========================================================================
function updateHudAndStatus() {
  if (!engine.hasImage()) return;
  const pct = Math.round(engine.zoom * 100) + "%";
  $("#hudZoom").textContent = pct;
  $("#hudDims").textContent = `${engine.naturalW} × ${engine.naturalH}`;
  $("#statusZoom").textContent = "zoom " + pct;
  $("#statusRes").textContent = `${engine.naturalW} × ${engine.naturalH} px`;
}
overlayCanvas.addEventListener("pointermove", (e) => {
  if (!engine.hasImage()) return;
  const norm = engine.clientToNorm(e.clientX, e.clientY);
  const x = Math.round(norm.x * engine.naturalW), y = Math.round(norm.y * engine.naturalH);
  $("#hudCoords").textContent = `x ${x} · y ${y}`;
  $("#statusPos").textContent = `x ${x} · y ${y}`;
});
const _origRender = engine.render.bind(engine);
engine.render = function () { _origRender(); updateHudAndStatus(); };

// ===========================================================================
// TABS (inspector)
// ===========================================================================
$$(".itab").forEach(tab => tab.addEventListener("click", () => {
  $$(".itab").forEach(t => t.classList.remove("is-active"));
  $$(".ipanel").forEach(p => p.classList.remove("is-active"));
  tab.classList.add("is-active");
  $("#" + tab.dataset.panel).classList.add("is-active");
  if (tab.dataset.panel === "panel-measure") renderMeasureLists();
  if (window.innerWidth <= 700) setInspectorOpen(true);
}));

// ===========================================================================
// PAPER CALIBRATION PANEL
// ===========================================================================
const paperEls = {
  width: $("#paperWidth"), height: $("#paperHeight"), unit: $("#paperUnit"),
  preset: $("#paperPreset"), marginTB: $("#paperMarginTB"), marginLR: $("#paperMarginLR"),
};
function currentPaper() {
  return {
    paperWidth: parseFloat(paperEls.width.value) || 1,
    paperHeight: parseFloat(paperEls.height.value) || 1,
    unit: paperEls.unit.value,
    marginTop: parseFloat(paperEls.marginTB.value) || 0,
    marginBottom: parseFloat(paperEls.marginTB.value) || 0,
    marginLeft: parseFloat(paperEls.marginLR.value) || 0,
    marginRight: parseFloat(paperEls.marginLR.value) || 0,
  };
}
function refreshPaperCalc() {
  const paper = currentPaper();
  const calib = calibrate({ ...paper, columns: engine.gridConfig.columns, rows: engine.gridConfig.rows, lockSquare: engine.gridConfig.cellAspectLocked });
  $("#calcDx").textContent = formatLength(calib.dxPaper, paper.unit);
  $("#calcDy").textContent = formatLength(calib.dyPaper, paper.unit);
  $("#calcNote").textContent = calib.square ? "" : "Cells aren't square at this ratio — enable “lock square cells” in the Grid tab for uniform spacing.";
  scheduleAutoSave();
}
[paperEls.width, paperEls.height, paperEls.unit, paperEls.marginTB, paperEls.marginLR].forEach(el => el.addEventListener("input", refreshPaperCalc));
let lastUnit = paperEls.unit.value;
paperEls.unit.addEventListener("change", () => {
  const nu = paperEls.unit.value;
  paperEls.width.value = convert(parseFloat(paperEls.width.value) || 0, lastUnit, nu).toFixed(2);
  paperEls.height.value = convert(parseFloat(paperEls.height.value) || 0, lastUnit, nu).toFixed(2);
  paperEls.marginTB.value = convert(parseFloat(paperEls.marginTB.value) || 0, lastUnit, nu).toFixed(2);
  paperEls.marginLR.value = convert(parseFloat(paperEls.marginLR.value) || 0, lastUnit, nu).toFixed(2);
  lastUnit = nu;
  refreshPaperCalc();
});
paperEls.preset.addEventListener("change", () => {
  const p = PRESETS[paperEls.preset.value];
  if (!p) return;
  paperEls.unit.value = p.unit; lastUnit = p.unit;
  paperEls.width.value = p.w; paperEls.height.value = p.h;
  refreshPaperCalc();
});
$("#btnExportBlankGrid").addEventListener("click", () => doExportBlankPDF());
refreshPaperCalc();

// ===========================================================================
// MEASURE PANEL (lists react to SightingTools changes)
// ===========================================================================
function renderMeasureLists() {
  const cList = $("#caliperList");
  const readouts = sighting.caliperReadouts(engine.naturalW || 1, engine.naturalH || 1);
  cList.innerHTML = readouts.length ? "" : `<li class="measure-empty">No measurements yet — select the caliper tool and click two points.</li>`;
  readouts.forEach(r => {
    const li = document.createElement("li");
    li.innerHTML = `<span>${r.label} · ${r.dist.toFixed(1)}px · ${r.ratio.toFixed(2)}×</span>`;
    const btn = document.createElement("button"); btn.textContent = "✕";
    btn.addEventListener("click", () => sighting.removeCaliper(r.id));
    li.appendChild(btn); cList.appendChild(li);
  });

  const pList = $("#plumbList");
  pList.innerHTML = sighting.plumbLines.length ? "" : `<li class="measure-empty">Select the plumb line tool and click on the image to drop a guide.</li>`;
  sighting.plumbLines.forEach((p, i) => {
    const li = document.createElement("li");
    li.innerHTML = `<span>${p.orientation === "v" ? "Vertical" : "Horizontal"} #${i + 1} · ${(p.pos * 100).toFixed(1)}%</span>`;
    const btn = document.createElement("button"); btn.textContent = "✕";
    btn.addEventListener("click", () => sighting.removePlumb(p.id));
    li.appendChild(btn); pList.appendChild(li);
  });

  const aList = $("#angleList");
  aList.innerHTML = sighting.angles.length ? "" : `<li class="measure-empty">Select the angle tool and click three points: A, vertex B, C.</li>`;
  sighting.angles.forEach((a, i) => {
    const li = document.createElement("li");
    li.innerHTML = `<span>Angle #${i + 1} · ${a.deg.toFixed(1)}°</span>`;
    const btn = document.createElement("button"); btn.textContent = "✕";
    btn.addEventListener("click", () => sighting.removeAngle(a.id));
    li.appendChild(btn); aList.appendChild(li);
  });
}
sighting.onChange = () => { engine.requestRender(); renderMeasureLists(); scheduleAutoSave(); };
$("#btnClearPlumb").addEventListener("click", () => sighting.clearPlumb());

// ===========================================================================
// EXPORT
// ===========================================================================
const modalOverlay = $("#modalOverlay");
function openModal(id) {
  modalOverlay.hidden = false;
  $$(".modal").forEach(m => m.hidden = m.id !== id);
}
function closeModals() { modalOverlay.hidden = true; }
modalOverlay.addEventListener("click", (e) => { if (e.target === modalOverlay) closeModals(); });
$$("[data-close-modal]").forEach(b => b.addEventListener("click", closeModals));

$("#btnExport").addEventListener("click", () => openModal("modalExport"));
$("#btnHelp").addEventListener("click", () => openModal("modalHelp"));
$("#btnShortcutsInline").addEventListener("click", () => openModal("modalHelp"));

function downloadReferencePNG() {
  if (!engine.hasImage()) { showToast("Import an image first."); return; }
  exportReferencePNG({
    glPipeline: gl, gridConfig: engine.gridConfig, filters: engine.filters,
    naturalW: engine.naturalW, naturalH: engine.naturalH,
    filename: `${currentImageName}-artref.png`,
  });
  engine.requestRender();
  showToast("Downloading full-resolution PNG…");
}
$("#btnDownload").addEventListener("click", downloadReferencePNG);

async function doExportBlankPDF() {
  try {
    await exportBlankGridPDF({ gridConfig: engine.gridConfig, paper: currentPaper(), filename: `${currentImageName}-blank-grid.pdf` });
  } catch (err) {
    showToast(err.message || "Couldn't export the PDF.");
  }
  closeModals();
}
$("#exportBlankPDF").addEventListener("click", doExportBlankPDF);
$("#exportJSON").addEventListener("click", () => {
  exportProjectJSON(buildProjectState(), `${currentImageName}-project.json`);
  closeModals();
});
$("#importJSON").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const state = await importProjectJSON(file);
    applyProjectState(state);
    showToast("Project settings restored.");
  } catch (err) { showToast(err.message); }
  e.target.value = "";
  closeModals();
});

function buildProjectState() {
  return {
    version: "1.0", timestamp: Date.now(),
    imageMetadata: { name: currentImageName, originalWidth: engine.naturalW, originalHeight: engine.naturalH, rotation: engine.rotation, flipHorizontal: engine.flipH, flipVertical: engine.flipV },
    grid: engine.gridConfig,
    filters: engine.filters,
    calibration: currentPaper(),
    sighting: sighting.serialize(),
  };
}
function applyProjectState(state) {
  if (!state) return;
  if (state.grid) Object.assign(engine.gridConfig, state.grid);
  if (state.filters) Object.assign(engine.filters, state.filters);
  if (state.calibration) {
    paperEls.width.value = state.calibration.paperWidth;
    paperEls.height.value = state.calibration.paperHeight;
    paperEls.unit.value = state.calibration.unit; lastUnit = state.calibration.unit;
    paperEls.marginTB.value = state.calibration.marginTop;
    paperEls.marginLR.value = state.calibration.marginLeft;
  }
  if (state.sighting) sighting.restore(state.sighting);
  reflectEngineIntoUI();
  engine.requestRender();
  refreshPaperCalc();
}
function reflectEngineIntoUI() {
  const cfg = engine.gridConfig, f = engine.filters;
  gridEls.type.value = cfg.type; gridEls.cols.value = cfg.columns; gridEls.rows.value = cfg.rows;
  gridEls.lockSquare.checked = cfg.cellAspectLocked; gridEls.diagonals.checked = cfg.showDiagonals;
  gridEls.labels.checked = cfg.showLabels; gridEls.labelPosition.value = cfg.labelPosition;
  gridEls.color.value = cfg.strokeColor; gridEls.width.value = cfg.strokeWidth; gridEls.opacity.value = cfg.opacity; gridEls.dash.value = cfg.lineDash;
  $("#gridWidthVal").textContent = cfg.strokeWidth.toFixed(1); $("#gridOpacityVal").textContent = cfg.opacity;
  $("#gridDivRow").style.display = ["cartesian", "rowcol"].includes(cfg.type) ? "flex" : "none";
  toneEls.grayscale.checked = f.grayscale; toneEls.invert.checked = f.invert;
  toneEls.brightness.value = f.brightness; toneEls.contrast.value = f.contrast;
  toneEls.posterize.value = f.posterizeLevels; toneEls.threshold.value = f.thresholdValue; toneEls.blur.value = f.blurRadius;
  $("#tonePosterizeVal").textContent = f.posterizeLevels === 0 ? "Off" : f.posterizeLevels;
  $("#toneThresholdVal").textContent = f.thresholdValue === 0 ? "Off" : f.thresholdValue;
  $("#toneBrightnessVal").textContent = f.brightness; $("#toneContrastVal").textContent = f.contrast; $("#toneBlurVal").textContent = f.blurRadius;
}

// ===========================================================================
// RECENT ITEMS (IndexedDB)
// ===========================================================================
let autoSaveTimer = null;
function scheduleAutoSave(immediate = false) {
  if (!engine.hasImage()) return;
  clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(doAutoSave, immediate ? 50 : 1400);
}
async function doAutoSave() {
  try {
    const thumb = document.createElement("canvas");
    const scale = Math.min(1, 320 / engine.naturalW);
    thumb.width = Math.max(1, Math.round(engine.naturalW * scale));
    thumb.height = Math.max(1, Math.round(engine.naturalH * scale));
    thumb.getContext("2d").drawImage(engine.workingCanvas, 0, 0, thumb.width, thumb.height);
    const thumbBlob = await new Promise(res => thumb.toBlob(res, "image/jpeg", 0.72));
    let imageBlob = currentImageBlob;
    if (!imageBlob) imageBlob = await new Promise(res => engine.workingCanvas.toBlob(res, "image/png"));
    await Storage.saveProject({
      id: currentProjectId, name: currentImageName, imageBlob, thumbBlob,
      projectState: buildProjectState(), updatedAt: Date.now(),
    });
  } catch (err) {
    console.warn("Auto-save skipped:", err);
  }
}

$("#btnRecent").addEventListener("click", async () => {
  openModal("modalRecent");
  const grid = $("#recentGrid");
  let items = [];
  try {
    items = await Storage.listRecent();
  } catch (err) {
    console.warn("Recent list unavailable:", err);
    grid.innerHTML = `<p class="hint-text">On-device storage isn't available in this browser context (this can happen in private browsing, or when the page is opened directly from a file instead of a server). Everything else still works — recent references just won't be remembered.</p>`;
    return;
  }
  if (!items.length) { grid.innerHTML = `<p class="hint-text">Nothing saved yet — images you work on are stored on this device automatically.</p>`; return; }
  grid.innerHTML = "";
  items.forEach(item => {
    const el = document.createElement("button");
    el.className = "recent-item";
    const url = URL.createObjectURL(item.thumbBlob);
    el.innerHTML = `<img src="${url}" alt="" /><div class="recent-item__meta"><span class="recent-item__name">${item.name}</span><br/><span class="recent-item__date">${new Date(item.updatedAt).toLocaleDateString()}</span></div>`;
    el.addEventListener("click", async () => {
      try {
        const img = await blobToImage(item.imageBlob);
        currentImageBlob = item.imageBlob;
        currentImageName = item.name;
        currentProjectId = item.id;
        await engine.loadImage(img);
        applyProjectState(item.projectState);
        setEmptyState(false);
        closeModals();
      } catch (err) {
        showToast("Couldn't reload that reference — it may be corrupted.");
        console.warn(err);
      }
    });
    grid.appendChild(el);
  });
});

// ===========================================================================
// KEYBOARD SHORTCUTS
// ===========================================================================
window.addEventListener("keydown", (e) => {
  if (["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement?.tagName)) return;
  if (e.code === "Space") { spaceHeld = true; stage.classList.add("tool-pan"); e.preventDefault(); return; }
  switch (e.key) {
    case "+": case "=": engine.zoomBy(1.15); break;
    case "-": case "_": engine.zoomBy(1 / 1.15); break;
    case "0": engine.fitToWindow(); break;
    case "h": case "H": engine.flipHorizontal(); break;
    case "v": case "V": engine.flipVertical(); break;
    case "g": case "G": engine.gridConfig.enabled = !engine.gridConfig.enabled; engine.requestRender(); break;
    case "m": case "M": toneEls.grayscale.checked = !toneEls.grayscale.checked; syncToneFromUI(); break;
    case "p": case "P": {
      const cycle = [0, 2, 3, 4, 5];
      const idx = cycle.indexOf(engine.filters.posterizeLevels);
      engine.filters.posterizeLevels = cycle[(idx + 1) % cycle.length];
      toneEls.posterize.value = engine.filters.posterizeLevels;
      syncToneFromUI();
      break;
    }
    case "t": case "T": toneEls.threshold.value = engine.filters.thresholdValue > 0 ? 0 : 128; syncToneFromUI(); break;
    case "c": case "C": setTool("caliper"); break;
    case "l": case "L": setTool("plumb"); break;
    case "e": case "E": openModal("modalExport"); break;
    case "d": case "D": downloadReferencePNG(); break;
    case "Escape": closeModals(); removeCropToolbar(); setInspectorOpen(false); break;
  }
});
window.addEventListener("keyup", (e) => { if (e.code === "Space") { spaceHeld = false; stage.classList.remove("tool-pan"); } });

// ===========================================================================
// PWA: service worker + install prompt
// ===========================================================================
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register(new URL("../service-worker.js", import.meta.url)).catch(() => {});
  });
}
let deferredInstall = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredInstall = e;
  if (!$("#btnInstall")) {
    const btn = document.createElement("button");
    btn.id = "btnInstall"; btn.className = "icon-btn"; btn.title = "Install ArtRef Studio";
    btn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M12 3v13m0 0 4-4m-4 4-4-4M5 19h14"/></svg>`;
    btn.addEventListener("click", () => { deferredInstall?.prompt(); });
    $(".header__actions").insertBefore(btn, $("#btnHelp"));
  }
});

// ===========================================================================
// Restore last-used preferences (non-image UI defaults only)
// ===========================================================================
(function restorePrefs() {
  const prefs = Storage.getPrefs();
  if (prefs.gridConfig) Object.assign(engine.gridConfig, prefs.gridConfig);
  reflectEngineIntoUI();
})();
window.addEventListener("beforeunload", () => {
  Storage.setPrefs({ gridConfig: engine.gridConfig });
});

// Deferred from the Grid/Tone panel sections above — see the notes there.
// By this point every section (including Paper Calibration's `paperEls`)
// has been declared, so it's safe to run the full sync chain.
syncGridFromUI();
syncToneFromUI();
engine.requestRender();
