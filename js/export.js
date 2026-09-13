// export.js — FR-5.3: PNG with grid burned in, printable blank-grid PDF
// (vector, via a lazily-loaded jsPDF), and a portable JSON project file.

import { renderGrid } from "./grid-renderer.js";
import { calibrate } from "./paper-calibration.js";

let jsPDFPromise = null;
function loadJsPDF() {
  if (jsPDFPromise) return jsPDFPromise;
  jsPDFPromise = new Promise((resolve, reject) => {
    if (window.jspdf) { resolve(window.jspdf.jsPDF); return; }
    const script = document.createElement("script");
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.2/jspdf.umd.min.js";
    script.onload = () => resolve(window.jspdf.jsPDF);
    script.onerror = () => reject(new Error("Could not load the PDF export library — check your connection."));
    document.head.appendChild(script);
  });
  return jsPDFPromise;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** Composite the filtered base image + overlay grid at full source resolution. */
export function exportReferencePNG({ glPipeline, image, gridConfig, filters, naturalW, naturalH, filename = "artref-reference.png" }) {
  const out = document.createElement("canvas");
  out.width = naturalW; out.height = naturalH;
  const octx = out.getContext("2d");

  // Base layer: re-render the GL filter pipeline at full resolution.
  glPipeline.render({ width: naturalW, height: naturalH }, filters);
  octx.drawImage(glPipeline.canvas, 0, 0, naturalW, naturalH);

  // Overlay layer at full resolution.
  const overlay = document.createElement("canvas");
  overlay.width = naturalW; overlay.height = naturalH;
  renderGrid(overlay.getContext("2d"), naturalW, naturalH, gridConfig);
  octx.drawImage(overlay, 0, 0);

  out.toBlob(blob => { if (blob) downloadBlob(blob, filename); }, "image/png");
}

/** Printable, paper-matched blank grid with alpha-numeric coordinates. */
export async function exportBlankGridPDF({ gridConfig, paper, filename = "artref-blank-grid.pdf" }) {
  const jsPDF = await loadJsPDF();
  const calib = calibrate({ ...paper, columns: gridConfig.columns, rows: gridConfig.rows, lockSquare: gridConfig.cellAspectLocked });
  const unitMap = { in: "in", cm: "cm", mm: "mm" };
  const doc = new jsPDF({
    orientation: paper.paperWidth > paper.paperHeight ? "landscape" : "portrait",
    unit: unitMap[paper.unit] || "in",
    format: [paper.paperWidth, paper.paperHeight],
  });

  const ox = paper.marginLeft, oy = paper.marginTop;
  const dx = calib.dxPaper, dy = calib.dyPaper;
  doc.setDrawColor(40, 40, 40);
  doc.setLineWidth(Math.max(0.01, dx * 0.004));

  for (let c = 0; c <= gridConfig.columns; c++) {
    const x = ox + c * dx;
    doc.line(x, oy, x, oy + dy * gridConfig.rows);
  }
  for (let r = 0; r <= gridConfig.rows; r++) {
    const y = oy + r * dy;
    doc.line(ox, y, ox + dx * gridConfig.columns, y);
  }

  if (gridConfig.showLabels) {
    doc.setFontSize(Math.max(6, dx * 3));
    doc.setTextColor(90, 90, 90);
    for (let c = 0; c < gridConfig.columns; c++) {
      const letter = String.fromCharCode(65 + (c % 26));
      doc.text(letter, ox + (c + 0.5) * dx, Math.max(0.15, oy - dy * 0.08), { align: "center" });
    }
    for (let r = 0; r < gridConfig.rows; r++) {
      doc.text(String(r + 1), Math.max(0.12, ox - dx * 0.12), oy + (r + 0.5) * dy, { align: "center", baseline: "middle" });
    }
  }

  doc.setFontSize(8);
  doc.setTextColor(140, 140, 140);
  doc.text(
    `ArtRef Studio — ${gridConfig.columns}×${gridConfig.rows} grid on ${paper.paperWidth}×${paper.paperHeight}${paper.unit} paper`,
    ox, paper.paperHeight - Math.max(0.1, paper.marginBottom * 0.4)
  );

  doc.save(filename);
}

export function exportProjectJSON(projectState, filename = "artref-project.json") {
  const blob = new Blob([JSON.stringify(projectState, null, 2)], { type: "application/json" });
  downloadBlob(blob, filename);
}

export function importProjectJSON(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try { resolve(JSON.parse(reader.result)); }
      catch (e) { reject(new Error("That file isn't a valid ArtRef project.")); }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}
