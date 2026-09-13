// grid-renderer.js — Layer 2 (Overlay Canvas): grids, armatures, and labels.
// Pure function of (ctx, width, height, config) — cheap enough to redraw
// every animation frame during pan/zoom without touching Layer 1.

const PHI = 1.6180339887;

function applyStroke(ctx, cfg) {
  ctx.strokeStyle = hexToRgba(cfg.strokeColor, cfg.opacity / 100);
  ctx.lineWidth = cfg.strokeWidth;
  ctx.setLineDash(
    cfg.lineDash === "dashed" ? [cfg.strokeWidth * 4, cfg.strokeWidth * 3] :
    cfg.lineDash === "dotted" ? [cfg.strokeWidth, cfg.strokeWidth * 2] : []
  );
  ctx.lineCap = "round";
}

function hexToRgba(hex, alpha) {
  const h = hex.replace("#", "");
  const r = parseInt(h.length === 3 ? h[0] + h[0] : h.slice(0, 2), 16);
  const g = parseInt(h.length === 3 ? h[1] + h[1] : h.slice(2, 4), 16);
  const b = parseInt(h.length === 3 ? h[2] + h[2] : h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function line(ctx, x1, y1, x2, y2) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function colLabel(i) {
  // 0,1,2... -> A, B, C ... Z, AA, AB ...
  let s = "";
  i += 1;
  while (i > 0) {
    const rem = (i - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    i = Math.floor((i - 1) / 26);
  }
  return s;
}

function drawLabel(ctx, text, x, y, cfg) {
  ctx.font = `600 ${cfg.labelSize}px "IBM Plex Mono", monospace`;
  const pad = 3;
  const metrics = ctx.measureText(text);
  const w = metrics.width + pad * 2;
  const h = cfg.labelSize + pad * 1.4;
  ctx.fillStyle = "rgba(15,14,13,0.72)";
  ctx.fillRect(x - w / 2, y - h / 2, w, h);
  ctx.fillStyle = cfg.labelColor;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x, y + 0.5);
}

function cellRects(width, height, cols, rows, lockSquare) {
  let cw = width / cols, ch = height / rows;
  if (lockSquare) {
    const s = Math.min(cw, ch);
    cw = s; ch = s;
  }
  return { cw, ch, offX: (width - cw * cols) / 2, offY: (height - ch * rows) / 2 };
}

function drawCartesian(ctx, width, height, cfg) {
  const cols = cfg.columns, rows = cfg.rows;
  const { cw, ch, offX, offY } = cellRects(width, height, cols, rows, cfg.cellAspectLocked);
  applyStroke(ctx, cfg);
  for (let c = 0; c <= cols; c++) {
    const x = offX + c * cw;
    line(ctx, x, offY, x, offY + ch * rows);
  }
  for (let r = 0; r <= rows; r++) {
    const y = offY + r * ch;
    line(ctx, offX, y, offX + cw * cols, y);
  }
  if (cfg.showDiagonals) {
    ctx.setLineDash([]);
    ctx.lineWidth = Math.max(0.75, cfg.strokeWidth * 0.6);
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        const x0 = offX + c * cw, y0 = offY + r * ch;
        line(ctx, x0, y0, x0 + cw, y0 + ch);
        line(ctx, x0 + cw, y0, x0, y0 + ch);
      }
    }
  }
  if (cfg.showLabels) {
    ctx.setLineDash([]);
    if (cfg.labelPosition === "edge") {
      for (let c = 0; c < cols; c++) {
        drawLabel(ctx, colLabel(c), offX + (c + 0.5) * cw, Math.max(10, offY - 12), cfg);
      }
      for (let r = 0; r < rows; r++) {
        drawLabel(ctx, String(r + 1), Math.max(10, offX - 14), offY + (r + 0.5) * ch, cfg);
      }
    } else {
      for (let c = 0; c < cols; c++) {
        for (let r = 0; r < rows; r++) {
          drawLabel(ctx, `${colLabel(c)}${r + 1}`, offX + c * cw + 12, offY + r * ch + 11, cfg);
        }
      }
    }
  }
  return { cw, ch, offX, offY };
}

function drawThirds(ctx, width, height, cfg) {
  drawCartesian(ctx, width, height, { ...cfg, columns: 3, rows: 3, showDiagonals: false, showLabels: false });
}

function drawHarmonic(ctx, width, height, cfg) {
  applyStroke(ctx, cfg);
  line(ctx, 0, 0, width, height);
  line(ctx, width, 0, 0, height);
  const cx = width / 2, cy = height / 2;
  // reciprocal diagonals: perpendiculars from the far corners to the primary diagonals
  const diag = Math.hypot(width, height);
  const angle1 = Math.atan2(height, width);
  const angle2 = Math.atan2(height, -width);
  [[0, 0, angle1], [width, 0, angle2], [width, height, angle1], [0, height, angle2]].forEach(([x, y, ang]) => {
    const perp = ang + Math.PI / 2;
    const len = diag * 0.62;
    line(ctx, x, y, x + Math.cos(perp) * len, y + Math.sin(perp) * len);
    line(ctx, x, y, x - Math.cos(perp) * len, y - Math.sin(perp) * len);
  });
  ctx.setLineDash([]);
  ctx.lineWidth = Math.max(0.75, cfg.strokeWidth * 0.7);
  line(ctx, cx, 0, cx, height);
  line(ctx, 0, cy, width, cy);
}

function drawGolden(ctx, width, height, cfg) {
  applyStroke(ctx, cfg);
  const gx1 = width / PHI, gx2 = width - width / PHI;
  const gy1 = height / PHI, gy2 = height - height / PHI;
  [gx1, gx2].forEach(x => line(ctx, x, 0, x, height));
  [gy1, gy2].forEach(y => line(ctx, 0, y, width, y));

  // True logarithmic golden spiral (r = a * phi^(2theta/pi)), converging on
  // the phi-grid intersection nearest the frame center.
  ctx.setLineDash([]);
  const cx = gx2, cy = gy1;
  const rMax = Math.min(width, height) * 0.46;
  const a = Math.min(width, height) * 0.012;
  const b = Math.log(PHI) / (Math.PI / 2);
  const thetaMax = Math.log(rMax / a) / b;
  ctx.beginPath();
  const STEPS = 160;
  for (let i = 0; i <= STEPS; i++) {
    const theta = (i / STEPS) * thetaMax;
    const r = a * Math.exp(b * theta);
    const x = cx - r * Math.cos(theta);
    const y = cy - r * Math.sin(theta);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

function drawPerspective(ctx, width, height, cfg, points) {
  applyStroke(ctx, cfg);
  const horizonY = height * 0.5;
  ctx.setLineDash([6, 5]);
  line(ctx, 0, horizonY, width, horizonY);
  ctx.setLineDash(cfg.lineDash === "dashed" ? [cfg.strokeWidth * 4, cfg.strokeWidth * 3] : cfg.lineDash === "dotted" ? [cfg.strokeWidth, cfg.strokeWidth * 2] : []);

  const vps = points && points.length ? points : (cfg.type === "perspective2"
    ? [{ x: width * 0.12, y: horizonY }, { x: width * 0.88, y: horizonY }]
    : [{ x: width * 0.5, y: horizonY }]);

  const corners = [[0, 0], [width, 0], [0, height], [width, height], [width / 2, 0], [width / 2, height], [0, height / 2], [width, height / 2]];
  vps.forEach(vp => {
    corners.forEach(([cx0, cy0]) => line(ctx, vp.x, vp.y, cx0, cy0));
  });
  vps.forEach(vp => {
    ctx.setLineDash([]);
    ctx.fillStyle = hexToRgba(cfg.strokeColor, 0.9);
    ctx.beginPath();
    ctx.arc(vp.x, vp.y, 5, 0, Math.PI * 2);
    ctx.fill();
  });
}

function drawLoomis(ctx, width, height, cfg) {
  applyStroke(ctx, cfg);
  const top = height * 0.08, bottom = height * 0.92;
  const cx = width / 2;
  const span = bottom - top;
  line(ctx, cx, top, cx, bottom); // center line
  const rows = [
    ["Brow line", top + span * 0.42],
    ["Base of nose", top + span * 0.62],
    ["Chin line", bottom],
    ["Lip / lower lip", top + span * 0.78],
  ];
  rows.forEach(([label, y]) => {
    line(ctx, width * 0.15, y, width * 0.85, y);
  });
  if (cfg.showLabels) {
    ctx.setLineDash([]);
    rows.forEach(([label, y]) => drawLabel(ctx, label, width * 0.85 + 4 + label.length * 3, y, { ...cfg, labelSize: Math.max(9, cfg.labelSize * 0.8) }));
  }
}

/** Returns geometry info (cell size) for downstream tools like paper calibration preview. */
export function renderGrid(ctx, width, height, cfg, extra = {}) {
  ctx.clearRect(0, 0, width, height);
  if (!cfg.enabled || cfg.type === "none") return null;
  ctx.save();
  let geo = null;
  switch (cfg.type) {
    case "cartesian": geo = drawCartesian(ctx, width, height, cfg); break;
    case "rowcol": geo = drawCartesian(ctx, width, height, { ...cfg, cellAspectLocked: false }); break;
    case "thirds": drawThirds(ctx, width, height, cfg); break;
    case "harmonic": drawHarmonic(ctx, width, height, cfg); break;
    case "golden": drawGolden(ctx, width, height, cfg); break;
    case "perspective1": drawPerspective(ctx, width, height, { ...cfg, type: "perspective1" }, extra.vanishingPoints); break;
    case "perspective2": drawPerspective(ctx, width, height, { ...cfg, type: "perspective2" }, extra.vanishingPoints); break;
    case "loomis": drawLoomis(ctx, width, height, cfg); break;
  }
  ctx.restore();
  return geo;
}

export { hexToRgba, colLabel };
