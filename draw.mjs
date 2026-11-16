// draw.mjs — deterministic generative artwork for ai-excited-01.
// Scene: a colossal koi leaps in a great arc through a ring of aurora
// above a tiny neon city at night, full moon, stars, splash below.
// Draws raw RGBA pixels and encodes a PNG with node:zlib only.
// Fixed seed everywhere: re-running produces byte-identical output.
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const W = 1024;
const H = 1024;
const buf = new Uint8Array(W * H * 4);

// ---- deterministic RNG (mulberry32) ----
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20261116);

// ---- pixel helpers ----
function px(x, y, r, g, b, a) {
  x = x | 0; y = y | 0;
  if (x < 0 || x >= W || y < 0 || y >= H) return;
  const i = (y * W + x) * 4;
  const da = 1 - a;
  buf[i] = Math.round(r * a + buf[i] * da);
  buf[i + 1] = Math.round(g * a + buf[i + 1] * da);
  buf[i + 2] = Math.round(b * a + buf[i + 2] * da);
  buf[i + 3] = 255;
}
function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
function lerp(a, b, t) { return a + (b - a) * t; }
function mix(c1, c2, t) {
  return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
}

// Filled circle with a 1px soft edge.
function circle(cx, cy, rad, r, g, b, a) {
  const x0 = Math.max(0, Math.floor(cx - rad - 1));
  const x1 = Math.min(W - 1, Math.ceil(cx + rad + 1));
  const y0 = Math.max(0, Math.floor(cy - rad - 1));
  const y1 = Math.min(H - 1, Math.ceil(cy + rad + 1));
  const inner = (rad - 0.5) * (rad - 0.5);
  const outer = (rad + 0.5) * (rad + 0.5);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 >= outer) continue;
      let cov = 1;
      if (d2 > inner) cov = clamp01(rad + 0.5 - Math.sqrt(d2));
      if (cov <= 0) continue;
      px(x, y, r, g, b, a * cov);
    }
  }
}

// Soft radial glow (quadratic falloff).
function glow(cx, cy, rad, r, g, b, a) {
  const x0 = Math.max(0, Math.floor(cx - rad));
  const x1 = Math.min(W - 1, Math.ceil(cx + rad));
  const y0 = Math.max(0, Math.floor(cy - rad));
  const y1 = Math.min(H - 1, Math.ceil(cy + rad));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / rad;
      if (d >= 1) continue;
      const f = (1 - d) * (1 - d);
      px(x, y, r, g, b, a * f);
    }
  }
}

// Filled ellipse, rotated, with a soft edge.
function ellipse(cx, cy, rx, ry, rot, r, g, b, a) {
  const cos = Math.cos(rot), sin = Math.sin(rot);
  const ext = Math.max(rx, ry) + 2;
  const x0 = Math.max(0, Math.floor(cx - ext));
  const x1 = Math.min(W - 1, Math.ceil(cx + ext));
  const y0 = Math.max(0, Math.floor(cy - ext));
  const y1 = Math.min(H - 1, Math.ceil(cy + ext));
  const feather = Math.min(rx, ry);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
      const u = (dx * cos + dy * sin) / rx;
      const v = (-dx * sin + dy * cos) / ry;
      const d = Math.hypot(u, v);
      const cov = clamp01((1 - d) * feather + 0.5);
      if (cov <= 0) continue;
      px(x, y, r, g, b, a * cov);
    }
  }
}

// Scanline polygon fill.
function poly(pts, r, g, b, a) {
  let minY = Infinity, maxY = -Infinity;
  for (const p of pts) { minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]); }
  minY = Math.max(0, Math.floor(minY)); maxY = Math.min(H - 1, Math.ceil(maxY));
  for (let y = minY; y <= maxY; y++) {
    const xs = [];
    for (let i = 0; i < pts.length; i++) {
      const x1 = pts[i][0], y1 = pts[i][1];
      const x2 = pts[(i + 1) % pts.length][0], y2 = pts[(i + 1) % pts.length][1];
      if ((y1 <= y && y2 > y) || (y2 <= y && y1 > y)) {
        xs.push(x1 + (y - y1) * (x2 - x1) / (y2 - y1));
      }
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const x0 = Math.max(0, Math.ceil(xs[k]));
      const x1 = Math.min(W - 1, Math.floor(xs[k + 1]));
      for (let x = x0; x <= x1; x++) px(x, y, r, g, b, a);
    }
  }
}

// Thick line as a quad with round caps.
function thickLine(x0, y0, x1, y1, w, r, g, b, a) {
  const dx = x1 - x0, dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len * w / 2, ny = dx / len * w / 2;
  poly(
    [[x0 + nx, y0 + ny], [x1 + nx, y1 + ny], [x1 - nx, y1 - ny], [x0 - nx, y0 - ny]],
    r, g, b, a
  );
  circle(x0, y0, w / 2, r, g, b, a);
  circle(x1, y1, w / 2, r, g, b, a);
}

// Quadratic bezier point.
function qbez(p0, p1, p2, t) {
  const u = 1 - t;
  return [
    u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0],
    u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1],
  ];
}
// Quadratic bezier tangent (normalized).
function qbezTan(p0, p1, p2, t) {
  const dx = 2 * (1 - t) * (p1[0] - p0[0]) + 2 * t * (p2[0] - p1[0]);
  const dy = 2 * (1 - t) * (p1[1] - p0[1]) + 2 * t * (p2[1] - p1[1]);
  const len = Math.hypot(dx, dy) || 1;
  return [dx / len, dy / len];
}

// Tube along a quadratic bezier: circles of lerped radius.
function tube(p0, p1, p2, r0, r1, r, g, b, a, steps) {
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const p = qbez(p0, p1, p2, t);
    circle(p[0], p[1], lerp(r0, r1, t), r, g, b, a);
  }
}

// ================= SKY =================
const skyStops = [
  [0.0, [6, 10, 32]],
  [0.45, [19, 26, 74]],
  [0.70, [42, 33, 96]],
  [0.85, [88, 44, 104]],
  [1.0, [26, 15, 51]],
];
for (let y = 0; y < H; y++) {
  const t = y / (H - 1);
  let s = 0;
  while (s < skyStops.length - 2 && t > skyStops[s + 1][0]) s++;
  const a = skyStops[s], b = skyStops[s + 1];
  const f = clamp01((t - a[0]) / (b[0] - a[0]));
  const c = mix(a[1], b[1], f);
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    buf[i] = c[0]; buf[i + 1] = c[1]; buf[i + 2] = c[2]; buf[i + 3] = 255;
  }
}

// ================= STARS =================
for (let i = 0; i < 260; i++) {
  const x = rand() * W, y = rand() * 780;
  const br = 0.35 + rand() * 0.65;
  const r = 0.6 + rand() * 1.5;
  circle(x, y, r, 255, 250, 235, br);
  if (rand() < 0.12) {
    // sparkle cross
    const s = 4 + rand() * 6;
    thickLine(x - s, y, x + s, y, 1, 255, 250, 235, br * 0.7);
    thickLine(x, y - s, x, y + s, 1, 255, 250, 235, br * 0.7);
  }
}

// Shooting star.
thickLine(150, 118, 292, 196, 2.5, 255, 255, 255, 0.85);
glow(292, 196, 14, 255, 255, 255, 0.5);
glow(150, 118, 8, 255, 255, 255, 0.3);

// ================= AURORA BANDS =================
function auroraBand(yBase, amp, phase, c1, c2, alpha) {
  for (let x = -20; x <= W + 20; x += 6) {
    const y = yBase + Math.sin(x * 0.006 + phase) * amp + Math.sin(x * 0.013 + 2) * 16;
    const c = mix(c1, c2, clamp01(x / W));
    glow(x, y, 26, c[0], c[1], c[2], alpha);
    glow(x, y, 9, 255, 255, 255, alpha * 0.22);
  }
}
auroraBand(258, 42, 1.2, [57, 255, 136], [46, 230, 200], 0.30);
auroraBand(150, 30, 4.0, [160, 107, 255], [46, 200, 255], 0.22);

// Moon in front of the bands.
glow(800, 195, 210, 240, 235, 200, 0.16);
glow(800, 195, 130, 247, 242, 214, 0.20);
circle(800, 195, 88, 247, 242, 214, 1);
circle(772, 172, 14, 226, 220, 190, 0.55);
circle(828, 214, 10, 226, 220, 190, 0.5);
circle(806, 158, 7, 226, 220, 190, 0.45);
circle(838, 168, 5, 226, 220, 190, 0.4);

// ================= AURORA RING (the koi jumps through it) =================
const RING = { cx: 500, cy: 405, rx: 275, ry: 130, rot: -0.21 };
const ringCols = [[57, 255, 136], [46, 230, 200], [80, 180, 255], [160, 107, 255]];
for (let pass = 0; pass < 2; pass++) {
  const rad = pass === 0 ? 22 : 6;
  const al = pass === 0 ? 0.55 : 0.95;
  for (let i = 0; i < 260; i++) {
    const th = (i / 260) * Math.PI * 2;
    const c = ringCols[Math.floor((i / 260) * ringCols.length) % ringCols.length];
    const lx = Math.cos(th) * RING.rx, ly = Math.sin(th) * RING.ry;
    const x = RING.cx + lx * Math.cos(RING.rot) - ly * Math.sin(RING.rot);
    const y = RING.cy + lx * Math.sin(RING.rot) + ly * Math.cos(RING.rot);
    const cc = pass === 1 ? mix(c, [255, 255, 255], 0.55) : c;
    glow(x, y, rad, cc[0], cc[1], cc[2], al);
  }
}

// ================= CITY + WATER =================
const WATER_Y = 950;
// Distant hills.
poly([[0, 950], [0, 880], [140, 830], [300, 878], [470, 838], [640, 884], [820, 842], [1024, 890], [1024, 950]], 16, 14, 44, 1);
// Buildings (bases sit at WATER_Y).
let bx = -10;
while (bx < W + 10) {
  const bw = 34 + rand() * 72;
  const bh = 90 + rand() * 165 + (rand() < 0.12 ? 110 : 0);
  const top = WATER_Y - bh;
  const shade = 4 + rand() * 5;
  poly([[bx, WATER_Y], [bx, top], [bx + bw, top], [bx + bw, WATER_Y]], shade, shade + 2, shade + 10, 1);
  // Rooftop antenna on some.
  if (rand() < 0.3) {
    thickLine(bx + bw / 2, top, bx + bw / 2, top - 16 - rand() * 14, 2, shade, shade + 2, shade + 10, 1);
    circle(bx + bw / 2, top - 18 - rand() * 12, 2.5, 255, 70, 70, 0.95);
  }
  // Lit windows.
  const cols = Math.floor(bw / 11), rows = Math.floor(bh / 15);
  for (let cx = 0; cx < cols; cx++) {
    for (let cy = 0; cy < rows; cy++) {
      if (rand() < 0.30) {
        const wx = bx + 5 + cx * 11, wy = top + 8 + cy * 15;
        const warm = rand() < 0.7;
        const wc = warm ? [255, 209, 102] : [139, 233, 255];
        poly([[wx, wy], [wx + 4, wy], [wx + 4, wy + 5], [wx, wy + 5]], wc[0], wc[1], wc[2], 0.9);
      }
    }
  }
  bx += bw + 2 + rand() * 8;
}
// Water: dark reflective band.
for (let y = WATER_Y; y < H; y++) {
  const f = (y - WATER_Y) / (H - WATER_Y);
  const c = mix([12, 18, 52], [5, 8, 26], f);
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    buf[i] = c[0]; buf[i + 1] = c[1]; buf[i + 2] = c[2]; buf[i + 3] = 255;
  }
}
// Reflection streaks on the water.
for (let i = 0; i < 90; i++) {
  const y = WATER_Y + 4 + rand() * (H - WATER_Y - 8);
  const x = rand() * W;
  const len = 18 + rand() * 90;
  const warm = rand() < 0.6;
  const c = warm ? [255, 170, 80] : [90, 210, 255];
  thickLine(x, y, x + len, y, 2, c[0], c[1], c[2], 0.10 + rand() * 0.16);
}

// ================= SPLASH (tail still in the spray) =================
for (let i = 0; i < 46; i++) {
  const a = Math.PI * (0.9 + rand() * 0.9);
  const d = 20 + rand() * 130;
  const x = 150 + Math.cos(a) * d;
  const y = 832 + Math.abs(Math.sin(a)) * d * 0.7;
  circle(x, y, 2 + rand() * 5, 220, 245, 255, 0.45 + rand() * 0.5);
  if (rand() < 0.4) glow(x, y, 10 + rand() * 8, 140, 220, 255, 0.25);
}

// ================= KOI =================
const P0 = [150, 832], P1 = [470, 120], P2 = [872, 618];
function koiPoint(t) { return qbez(P0, P1, P2, t); }
function koiTan(t) { return qbezTan(P0, P1, P2, t); }
function koiRadius(t) {
  return 14 + 72 * Math.sin(Math.PI * (0.10 + 0.80 * t));
}

// Light trail above the body (energy wake).
for (let i = 0; i < 60; i++) {
  const t = 0.04 + rand() * 0.5;
  const p = koiPoint(t);
  const tan = koiTan(t);
  const nx = -tan[1], ny = tan[0];
  const off = koiRadius(t) + 12 + rand() * 26;
  const x = p[0] + nx * off, y = p[1] + ny * off;
  glow(x, y, 3 + rand() * 5, 160, 235, 255, 0.35 + rand() * 0.4);
}

// Tail fins (drawn first, behind the body): short, full, fan-like.
tube([150, 832], [95, 880], [50, 950], 34, 6, 255, 214, 160, 0.9, 26);
tube([150, 832], [115, 900], [105, 960], 28, 5, 255, 170, 90, 0.85, 26);
tube([150, 832], [75, 855], [20, 895], 20, 4, 255, 236, 210, 0.8, 22);

// Body: dark-orange rim, then cream body.
for (let i = 0; i <= 170; i++) {
  const t = i / 170;
  const p = koiPoint(t);
  circle(p[0], p[1], koiRadius(t) + 5, 179, 60, 0, 0.9);
}
for (let i = 0; i <= 170; i++) {
  const t = i / 170;
  const p = koiPoint(t);
  circle(p[0], p[1], koiRadius(t), 255, 246, 230, 1);
}
// Belly shade (warm tint along the lower edge).
for (let i = 0; i <= 120; i++) {
  const t = 0.08 + (i / 120) * 0.84;
  const p = koiPoint(t);
  const tan = koiTan(t);
  const nx = -tan[1], ny = tan[0];
  const r = koiRadius(t);
  circle(p[0] - nx * r * 0.35, p[1] - ny * r * 0.35, r * 0.55, 255, 226, 180, 0.5);
}
// Orange patches (classic koi markings).
const patches = [
  [0.16, 0.95, 0.62, [255, 123, 28]],
  [0.36, 1.0, 0.6, [255, 123, 28]],
  [0.55, 0.9, 0.58, [232, 93, 4]],
  [0.72, 0.85, 0.55, [255, 123, 28]],
  [0.87, 0.7, 0.5, [255, 150, 60]],
];
for (const [t, fx, fy, c] of patches) {
  const p = koiPoint(t);
  const tan = koiTan(t);
  const ang = Math.atan2(tan[1], tan[0]);
  const r = koiRadius(t);
  ellipse(p[0], p[1], r * fx, r * fy, ang, c[0], c[1], c[2], 0.96);
}
// Black spots (in clean cream gaps between the orange patches).
for (const [t, fx, fy] of [[0.26, 0.30, 0.24], [0.80, 0.26, 0.20]]) {
  const p = koiPoint(t);
  const tan = koiTan(t);
  const ang = Math.atan2(tan[1], tan[0]);
  const r = koiRadius(t);
  ellipse(p[0], p[1], r * fx, r * fy, ang, 28, 28, 40, 0.95);
}
// Dorsal fin: small zigzag ridge along the OUTER (top) edge of the arc.
{
  const top = [], base = [];
  for (let i = 0; i <= 40; i++) {
    const t = 0.12 + (i / 40) * 0.62;
    const p = koiPoint(t);
    const tan = koiTan(t);
    const nx = tan[1], ny = -tan[0]; // outer side of the curve
    const r = koiRadius(t);
    base.push([p[0] + nx * (r + 2), p[1] + ny * (r + 2)]);
    const tip = (i % 2 === 0) ? r + 18 : r + 8;
    top.push([p[0] + nx * tip, p[1] + ny * tip]);
  }
  // Ribbon order: all base points forward, then all tip points backward,
  // so the closing edge is short and the fill stays a thin spiky strip.
  const fin = base.concat(top.slice().reverse());
  poly(fin, 255, 140, 46, 0.9);
}
// Pectoral fin near the head, sweeping back below the body.
{
  const p = koiPoint(0.8);
  const tan = koiTan(0.8);
  const ang = Math.atan2(tan[1], tan[0]) + 1.15;
  ellipse(p[0] - tan[1] * 30, p[1] + tan[0] * 30, 36, 11, ang, 255, 160, 60, 0.9);
}
// Eye + whiskers (barbels).
{
  const p = koiPoint(0.94);
  const tan = koiTan(0.94);
  const ex = p[0] + tan[1] * 14, ey = p[1] - tan[0] * 14;
  circle(ex, ey, 9, 20, 20, 28, 1);
  circle(ex - 3, ey - 3, 3, 255, 255, 255, 1);
  const head = koiPoint(0.99);
  tube(head, [head[0] + 40, head[1] + 30], [head[0] + 78, head[1] + 20], 3.5, 1.2, 255, 246, 230, 0.85, 12);
  tube(head, [head[0] + 36, head[1] + 38], [head[0] + 70, head[1] + 38], 3.5, 1.2, 255, 246, 230, 0.85, 12);
}

// ================= VIGNETTE =================
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const dx = (x + 0.5 - W / 2) / (W / 2);
    const dy = (y + 0.5 - H / 2) / (H / 2);
    const d = Math.hypot(dx, dy);
    const f = 1 - 0.22 * clamp01((d - 0.62) / 0.5);
    const i = (y * W + x) * 4;
    buf[i] = Math.round(buf[i] * f);
    buf[i + 1] = Math.round(buf[i + 1] * f);
    buf[i + 2] = Math.round(buf[i + 2] * f);
  }
}

// ================= PNG ENCODE (filter 0, zlib level 9) =================
function crc32(data) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = table[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
const raw = Buffer.alloc((W * 4 + 1) * H);
for (let y = 0; y < H; y++) {
  raw[y * (W * 4 + 1)] = 0;
  Buffer.from(buf.buffer, y * W * 4, W * 4).copy(raw, y * (W * 4 + 1) + 1);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);
writeFileSync(new URL("./art.png", import.meta.url), png);
console.log("wrote art.png", png.length, "bytes");
