// sighting-tools.js — virtual caliper, plumb lines, and the angle finder.
// Points are stored normalized (0..1) against the *original* image so
// measurements stay correct across zoom, pan, rotation of the viewport.

let uid = 0;
const nextId = () => `m${Date.now().toString(36)}${(uid++).toString(36)}`;

export class SightingTools {
  constructor() {
    this.calipers = [];       // { id, a:{x,y}, b:{x,y}, color }
    this.plumbLines = [];     // { id, orientation:'h'|'v', pos:0..1 }
    this.angles = [];         // { id, a,b,c: {x,y}, deg }
    this.pendingAngle = [];
    this.onChange = () => {};
  }

  reset() {
    this.calipers = []; this.plumbLines = []; this.angles = []; this.pendingAngle = [];
    this.onChange();
  }

  // ---- Caliper -----------------------------------------------------------
  addCaliper(a, b) {
    const c = { id: nextId(), a, b, color: "#89aec2" };
    this.calipers.push(c);
    this.onChange();
    return c;
  }
  removeCaliper(id) { this.calipers = this.calipers.filter(c => c.id !== id); this.onChange(); }

  caliperReadouts(imgW, imgH) {
    return this.calipers.map((c, i) => {
      const dist = this._dist(c, imgW, imgH);
      const baseline = this.calipers[0] ? this._dist(this.calipers[0], imgW, imgH) : dist;
      return { id: c.id, label: i === 0 ? "Baseline" : `#${i + 1}`, dist, ratio: baseline ? dist / baseline : 1 };
    });
  }
  _dist(c, imgW, imgH) { return Math.hypot((c.b.x - c.a.x) * imgW, (c.b.y - c.a.y) * imgH); }

  // ---- Plumb lines ---------------------------------------------------------
  addPlumb(orientation, pos) {
    const p = { id: nextId(), orientation, pos };
    this.plumbLines.push(p);
    this.onChange();
    return p;
  }
  movePlumb(id, pos) {
    const p = this.plumbLines.find(p => p.id === id);
    if (p) { p.pos = Math.min(1, Math.max(0, pos)); this.onChange(); }
  }
  removePlumb(id) { this.plumbLines = this.plumbLines.filter(p => p.id !== id); this.onChange(); }
  clearPlumb() { this.plumbLines = []; this.onChange(); }

  hitTestPlumb(xNorm, yNorm, tolPx, width, height) {
    for (const p of this.plumbLines) {
      if (p.orientation === "v" && Math.abs(p.pos * width - xNorm * width) < tolPx) return p;
      if (p.orientation === "h" && Math.abs(p.pos * height - yNorm * height) < tolPx) return p;
    }
    return null;
  }

  // ---- Angle finder --------------------------------------------------------
  addAnglePoint(pt) {
    this.pendingAngle.push(pt);
    if (this.pendingAngle.length === 3) {
      const [a, b, c] = this.pendingAngle;
      const deg = this._angleDeg(a, b, c);
      this.angles.push({ id: nextId(), a, b, c, deg });
      this.pendingAngle = [];
    }
    this.onChange();
  }
  _angleDeg(a, b, c) {
    const v1 = { x: a.x - b.x, y: a.y - b.y };
    const v2 = { x: c.x - b.x, y: c.y - b.y };
    const dot = v1.x * v2.x + v1.y * v2.y;
    const mag = Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y);
    if (mag === 0) return 0;
    return (Math.acos(Math.min(1, Math.max(-1, dot / mag))) * 180) / Math.PI;
  }
  removeAngle(id) { this.angles = this.angles.filter(a => a.id !== id); this.onChange(); }
  cancelPendingAngle() { this.pendingAngle = []; this.onChange(); }

  // ---- Drawing ---------------------------------------------------------
  draw(ctx, width, height) {
    ctx.save();
    ctx.font = "500 11px 'IBM Plex Mono', monospace";
    ctx.lineCap = "round";

    this.plumbLines.forEach(p => {
      ctx.strokeStyle = "rgba(137,174,194,0.85)";
      ctx.lineWidth = 1.25;
      ctx.setLineDash([5, 4]);
      if (p.orientation === "v") {
        const x = p.pos * width;
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
      } else {
        const y = p.pos * height;
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
      }
    });
    ctx.setLineDash([]);

    this.calipers.forEach((c, i) => {
      const ax = c.a.x * width, ay = c.a.y * height, bx = c.b.x * width, by = c.b.y * height;
      ctx.strokeStyle = c.color; ctx.fillStyle = c.color; ctx.lineWidth = 1.75;
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
      [[ax, ay], [bx, by]].forEach(([x, y]) => {
        ctx.beginPath(); ctx.arc(x, y, 4.5, 0, Math.PI * 2); ctx.fill();
      });
      if (i === 0) {
        const midX = (ax + bx) / 2, midY = (ay + by) / 2;
        ctx.fillStyle = "rgba(15,14,13,0.75)";
        ctx.fillRect(midX - 16, midY - 9, 32, 16);
        ctx.fillStyle = c.color;
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText("1.0×", midX, midY);
      }
    });

    const drawAngle = (pts, deg, committed) => {
      ctx.strokeStyle = committed ? "#d1a13f" : "rgba(209,161,63,0.6)";
      ctx.fillStyle = ctx.strokeStyle;
      ctx.lineWidth = 1.5;
      if (pts.length >= 2) {
        ctx.beginPath(); ctx.moveTo(pts[0].x * width, pts[0].y * height); ctx.lineTo(pts[1].x * width, pts[1].y * height); ctx.stroke();
      }
      if (pts.length >= 3) {
        ctx.beginPath(); ctx.moveTo(pts[1].x * width, pts[1].y * height); ctx.lineTo(pts[2].x * width, pts[2].y * height); ctx.stroke();
      }
      pts.forEach(p => {
        ctx.beginPath(); ctx.arc(p.x * width, p.y * height, 4, 0, Math.PI * 2); ctx.fill();
      });
      if (deg != null && pts[1]) {
        ctx.fillStyle = "rgba(15,14,13,0.75)";
        const bx = pts[1].x * width, by = pts[1].y * height;
        const txt = deg.toFixed(1) + "°";
        ctx.fillRect(bx + 8, by - 18, 44, 16);
        ctx.fillStyle = "#d1a13f";
        ctx.textAlign = "left"; ctx.textBaseline = "middle";
        ctx.fillText(txt, bx + 12, by - 10);
      }
    };
    this.angles.forEach(a => drawAngle([a.a, a.b, a.c], a.deg, true));
    if (this.pendingAngle.length) drawAngle(this.pendingAngle, null, false);

    ctx.restore();
  }

  serialize() {
    return { calipers: this.calipers, plumbLines: this.plumbLines, angles: this.angles };
  }
  restore(data) {
    if (!data) return;
    this.calipers = data.calipers || [];
    this.plumbLines = data.plumbLines || [];
    this.angles = data.angles || [];
    this.pendingAngle = [];
    this.onChange();
  }
}
