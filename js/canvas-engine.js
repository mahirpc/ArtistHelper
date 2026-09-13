// canvas-engine.js — Module 1 (Image Acquisition & Canvas Viewport) and the
// dual-canvas render loop described in spec §4.3. Rotation/flip/crop are
// baked into a "working" raster once (cheap, infrequent) so that zoom/pan —
// the hot path — never needs to redraw the megapixel source image; only the
// vector overlay layer redraws during interaction.

import { renderGrid } from "./grid-renderer.js";

const MIN_ZOOM = 0.1, MAX_ZOOM = 10;

export class ViewportEngine {
  constructor({ stage, baseCanvas, overlayCanvas, glPipeline, sightingTools }) {
    this.stage = stage;
    this.baseCanvas = baseCanvas;
    this.overlayCanvas = overlayCanvas;
    this.gl = glPipeline;
    this.sighting = sightingTools;

    this.workingCanvas = null; // rotated + flipped raster, source of truth for exports/measurements
    this.naturalW = 0; this.naturalH = 0;

    this.zoom = 1;
    this.rotation = 0;   // degrees, multiple of 90 kept lossless
    this.flipH = false;
    this.flipV = false;

    this.gridConfig = {
      enabled: true, type: "cartesian", columns: 8, rows: 8, cellAspectLocked: true,
      strokeColor: "#f2c14e", strokeWidth: 1.5, opacity: 85, lineDash: "solid",
      showDiagonals: false, showLabels: false, labelPosition: "edge",
      labelColor: "#f2c14e", labelSize: 12,
    };
    this.filters = {
      grayscale: false, brightness: 0, contrast: 0, posterizeLevels: 0,
      thresholdValue: 0, invert: false, blurRadius: 0, penArt: false,
    };
    this.vanishingPoints = null;

    this._rafPending = false;
    this._ro = new ResizeObserver(() => this.requestRender());
    this._ro.observe(this.stage.parentElement);
  }

  hasImage() { return !!this.workingCanvas; }

  /** Load a decoded HTMLImageElement/ImageBitmap as the new source. */
  async loadImage(imgEl) {
    this.sourceImg = imgEl;
    this.rotation = 0; this.flipH = false; this.flipV = false;
    this._rasterize();
    this.fitToWindow();
  }

  rotate90(dir) {
    if (!this.sourceImg && !this.workingCanvas) return;
    this.rotation = (this.rotation + (dir > 0 ? 90 : -90) + 360) % 360;
    this._rasterize();
    this.fitToWindow(true);
  }

  flipHorizontal() { if (!this.hasImage()) return; this.flipH = !this.flipH; this._rasterize(); this.requestRender(); }
  flipVertical()   { if (!this.hasImage()) return; this.flipV = !this.flipV; this._rasterize(); this.requestRender(); }

  /** Re-rasterize the *original* source through current rotation/flip into workingCanvas. */
  _rasterize() {
    const src = this.sourceImg;
    if (!src) return;
    const sw = src.naturalWidth || src.width, sh = src.naturalHeight || src.height;
    const rot = (this.rotation * Math.PI) / 180;
    const swapped = this.rotation === 90 || this.rotation === 270;
    const outW = swapped ? sh : sw, outH = swapped ? sw : sh;

    const c = document.createElement("canvas");
    c.width = outW; c.height = outH;
    const ctx = c.getContext("2d");
    ctx.save();
    ctx.translate(outW / 2, outH / 2);
    ctx.rotate(rot);
    ctx.scale(this.flipH ? -1 : 1, this.flipV ? -1 : 1);
    ctx.drawImage(src, -sw / 2, -sh / 2, sw, sh);
    ctx.restore();

    this.workingCanvas = c;
    this.naturalW = outW; this.naturalH = outH;
    this.gl.setImageSource(c, outW, outH);
  }

  /** Permanently crop the working raster to a normalized rect {x,y,w,h} (0..1). */
  applyCrop(rect) {
    if (!this.workingCanvas) return;
    const px = Math.round(rect.x * this.naturalW), py = Math.round(rect.y * this.naturalH);
    const pw = Math.max(1, Math.round(rect.w * this.naturalW)), ph = Math.max(1, Math.round(rect.h * this.naturalH));
    const c = document.createElement("canvas");
    c.width = pw; c.height = ph;
    c.getContext("2d").drawImage(this.workingCanvas, px, py, pw, ph, 0, 0, pw, ph);
    this.workingCanvas = c;
    this.naturalW = pw; this.naturalH = ph;
    this.gl.setImageSource(c, pw, ph);
    this.fitToWindow(true);
  }

  // ---- Viewport transform -------------------------------------------------
  fitToWindow(keepZoomIfSmaller = false) {
    if (!this.hasImage()) return;
    const parent = this.stage.parentElement;
    const availW = parent.clientWidth - 32, availH = parent.clientHeight - 32;
    const scale = Math.min(availW / this.naturalW, availH / this.naturalH, 1);
    this.zoom = keepZoomIfSmaller ? this.zoom : Math.max(MIN_ZOOM, scale);
    this.requestRender();
  }

  setZoom(z, focal) {
    this.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
    this.requestRender();
  }

  zoomBy(factor) { this.setZoom(this.zoom * factor); }

  displaySize() {
    return { width: Math.round(this.naturalW * this.zoom), height: Math.round(this.naturalH * this.zoom) };
  }

  // ---- Coordinate helpers --------------------------------------------------
  /** Convert a client (mouse) point to normalized [0..1] image coordinates. */
  clientToNorm(clientX, clientY) {
    const rect = this.overlayCanvas.getBoundingClientRect();
    return { x: (clientX - rect.left) / rect.width, y: (clientY - rect.top) / rect.height };
  }

  // ---- Render loop ---------------------------------------------------------
  requestRender() {
    if (this._rafPending) return;
    this._rafPending = true;
    requestAnimationFrame(() => { this._rafPending = false; this.render(); });
  }

  render() {
    if (!this.hasImage()) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const { width, height } = this.displaySize();
    const pxW = Math.max(1, Math.round(width * dpr)), pxH = Math.max(1, Math.round(height * dpr));

    this.stage.style.width = width + "px";
    this.stage.style.height = height + "px";

    this.baseCanvas.style.width = width + "px";
    this.baseCanvas.style.height = height + "px";
    this.gl.render({ width: pxW, height: pxH }, this.filters);

    if (this.overlayCanvas.width !== pxW) this.overlayCanvas.width = pxW;
    if (this.overlayCanvas.height !== pxH) this.overlayCanvas.height = pxH;
    this.overlayCanvas.style.width = width + "px";
    this.overlayCanvas.style.height = height + "px";
    const octx = this.overlayCanvas.getContext("2d");
    renderGrid(octx, pxW, pxH, this.gridConfig, { vanishingPoints: this.vanishingPoints });
    if (this.sighting) this.sighting.draw(octx, pxW, pxH);
  }
}
