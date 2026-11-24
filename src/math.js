// ============================================================================
// math, noise, matrices (left-handed world: +x east, +y up, +z north)
// ============================================================================
const { abs, sin, cos, atan2, sqrt, floor, ceil, min, max, hypot, exp, pow, PI, sign, round } = Math;
const TAU = PI * 2;
const clamp = (x, a, b) => min(b, max(a, x));
const mix = (a, b, t) => a + (b - a) * t;
const ss = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const smin = (a, b, k) => { const h = clamp(0.5 + 0.5 * (b - a) / k, 0, 1); return mix(b, a, h) - k * h * (1 - h); };
const rng = (s) => () => {
  s = (s + 0x6d2b79f5) | 0;
  let t = Math.imul(s ^ (s >>> 15), 1 | s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const hash2 = (x, y) => {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
const vnoise = (x, y) => {
  const ix = floor(x), iy = floor(y), fx = x - ix, fy = y - iy;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  return mix(mix(hash2(ix, iy), hash2(ix + 1, iy), u), mix(hash2(ix, iy + 1), hash2(ix + 1, iy + 1), u), v);
};
const fbm = (x, y, oct = 4) => {
  let a = 0.5, s = 0, n = 0;
  for (let i = 0; i < oct; i++) { s += a * vnoise(x, y); n += a; a *= 0.5; const t = x; x = x * 1.62 + y * 1.18 + 3.1; y = y * 1.62 - t * 1.18 + 1.7; }
  return s / n;
};
const norm3 = (v) => { const l = hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

// column-major mat4
const mul4 = (a, b) => {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  }
  return o;
};
const inv4 = (m) => {
  const a = Array.from(m), o = new Float32Array(16);
  const b = [a[0]*a[5]-a[1]*a[4], a[0]*a[6]-a[2]*a[4], a[0]*a[7]-a[3]*a[4], a[1]*a[6]-a[2]*a[5], a[1]*a[7]-a[3]*a[5], a[2]*a[7]-a[3]*a[6],
    a[8]*a[13]-a[9]*a[12], a[8]*a[14]-a[10]*a[12], a[8]*a[15]-a[11]*a[12], a[9]*a[14]-a[10]*a[13], a[9]*a[15]-a[11]*a[13], a[10]*a[15]-a[11]*a[14]];
  const d = 1 / (b[0]*b[11]-b[1]*b[10]+b[2]*b[9]+b[3]*b[8]-b[4]*b[7]+b[5]*b[6]);
  o[0]=(a[5]*b[11]-a[6]*b[10]+a[7]*b[9])*d; o[1]=(a[2]*b[10]-a[1]*b[11]-a[3]*b[9])*d; o[2]=(a[13]*b[5]-a[14]*b[4]+a[15]*b[3])*d; o[3]=(a[10]*b[4]-a[9]*b[5]-a[11]*b[3])*d;
  o[4]=(a[6]*b[8]-a[4]*b[11]-a[7]*b[7])*d; o[5]=(a[0]*b[11]-a[2]*b[8]+a[3]*b[7])*d; o[6]=(a[14]*b[2]-a[12]*b[5]-a[15]*b[1])*d; o[7]=(a[8]*b[5]-a[10]*b[2]+a[11]*b[1])*d;
  o[8]=(a[4]*b[10]-a[5]*b[8]+a[7]*b[6])*d; o[9]=(a[1]*b[8]-a[0]*b[10]-a[3]*b[6])*d; o[10]=(a[12]*b[4]-a[13]*b[2]+a[15]*b[0])*d; o[11]=(a[9]*b[2]-a[8]*b[4]-a[11]*b[0])*d;
  o[12]=(a[5]*b[7]-a[4]*b[9]-a[6]*b[6])*d; o[13]=(a[0]*b[9]-a[1]*b[7]+a[2]*b[6])*d; o[14]=(a[13]*b[1]-a[12]*b[3]-a[14]*b[0])*d; o[15]=(a[8]*b[3]-a[9]*b[1]+a[10]*b[0])*d;
  return o;
};
const viewLH = (eye, at, up = [0, 1, 0]) => {
  const f = norm3([at[0] - eye[0], at[1] - eye[1], at[2] - eye[2]]);
  const r = norm3(cross3(up, f)), u = cross3(f, r);
  return new Float32Array([r[0], u[0], f[0], 0, r[1], u[1], f[1], 0, r[2], u[2], f[2], 0, -dot3(r, eye), -dot3(u, eye), -dot3(f, eye), 1]);
};
// infinite reversed-Z, left-handed
const perspLH = (fovy, aspect, near) => {
  const f = 1 / Math.tan(fovy / 2);
  return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, 0, 1, 0, 0, near, 0]);
};
const orthoLH = (r, n, f) => new Float32Array([1 / r, 0, 0, 0, 0, 1 / r, 0, 0, 0, 0, 1 / (f - n), 0, 0, 0, -n / (f - n), 1]);
const MIRROR_Y = new Float32Array([1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

// Catmull-Rom through [x,y,z,r] control points
const curve = (c, segs) => {
  const out = [], n = c.length - 1;
  for (let i = 0; i <= segs; i++) {
    const t = i / segs * n, k = min(floor(t), n - 1), f = t - k;
    const p0 = c[max(k - 1, 0)], p1 = c[k], p2 = c[k + 1], p3 = c[min(k + 2, n)], q = [];
    for (let d = 0; d < 4; d++) {
      q[d] = 0.5 * (2 * p1[d] + (p2[d] - p0[d]) * f + (2 * p0[d] - 5 * p1[d] + 4 * p2[d] - p3[d]) * f * f + (3 * p1[d] - p0[d] - 3 * p2[d] + p3[d]) * f * f * f);
    }
    q[3] = max(q[3], 0.005);
    out.push(q);
  }
  return out;
};
