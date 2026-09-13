// paper-calibration.js — FR-5.1 / FR-5.2: translate a digital grid onto
// physical paper dimensions, per section 4.6 of the spec.

export const UNIT_TO_MM = { mm: 1, cm: 10, in: 25.4 };

export const PRESETS = {
  "9x12in":  { w: 9,  h: 12,  unit: "in" },
  "11x14in": { w: 11, h: 14,  unit: "in" },
  "16x20in": { w: 16, h: 20,  unit: "in" },
  "a4":      { w: 210, h: 297, unit: "mm" },
  "a3":      { w: 297, h: 420, unit: "mm" },
  "1x1":     { w: 10, h: 10,  unit: "in" },
  "4x5":     { w: 8,  h: 10,  unit: "in" },
  "3x2":     { w: 9,  h: 6,   unit: "in" },
};

/**
 * @returns {{dxPaper:number, dyPaper:number, square:boolean, drawW:number, drawH:number}}
 */
export function calibrate({ paperWidth, paperHeight, unit, marginTop, marginBottom, marginLeft, marginRight, columns, rows, lockSquare }) {
  const drawW = Math.max(0, paperWidth - (marginLeft + marginRight));
  const drawH = Math.max(0, paperHeight - (marginTop + marginBottom));
  let dx = drawW / Math.max(1, columns);
  let dy = drawH / Math.max(1, rows);
  const square = Math.abs(dx - dy) < Math.max(dx, dy) * 0.03;
  if (lockSquare) {
    const s = Math.min(dx, dy);
    dx = s; dy = s;
  }
  return { dxPaper: dx, dyPaper: dy, square, drawW, drawH, unit };
}

export function formatLength(value, unit) {
  const decimals = unit === "in" ? 3 : 1;
  return `${value.toFixed(decimals)} ${unit}`;
}

export function convert(value, fromUnit, toUnit) {
  return (value * UNIT_TO_MM[fromUnit]) / UNIT_TO_MM[toUnit];
}
