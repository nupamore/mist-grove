// ============================================================================
// procedural world: terrain SDF + surface nets, trees, root arches, shrine,
// stepping stones, root bridge, leaf instances, baked volume GI
// ============================================================================
const POSES = [
  [0.7, 2.33, -45.5, 0.9, 2.5, -30],
  [0.6, 1.92, -35.5, 0.3, 2.9, 0],
  [-3.2, 1.65, -8.5, 0.8, 2.6, 1.5],
  [0, 2.1, 24.4, 0, 5.2, 43],
  [25, 2.6, 10, 10, 2.5, -4],
  [-17.5, 8.2, 20.5, 3, 2.2, -6],
];
// root tunnel behind the south shore, curving gently so the shrine is revealed at its mouth
const TUN_Z0 = -47.5, TUN_STEP = 3.2, TUN_Z1 = TUN_Z0 + 6 * TUN_STEP;
const tunT = (z) => clamp((z - TUN_Z0) / (TUN_Z1 - TUN_Z0), 0, 1);
const tunCx = (z) => { const t = tunT(z); return 1.6 * sin(t * PI * 1.4) * (1 - ss(0.65, 1, t)); };
const tunFloor = (z) => mix(0.75, 0.05, ss(-50, -27, z));
// open start: through the tunnel, over the stones, round the shrine, east cove, mother tree, up the root bridge
const TOUR = [POSES[0], [1.5, 2.15, -40, 0.6, 2.4, -20], POSES[1], [-0.8, 1.75, -24.6, 0.4, 2.8, 0], POSES[2], [5.4, 1.75, -3, 0.8, 2.6, 1.5], [5.6, 1.8, 3.2, 0.8, 2.6, 1.5], POSES[4], POSES[3], [-10.2, 6.6, 28, -17.5, 7.5, 21], POSES[5]];
// open sightlines the surrounding forest is grown around
const SIGHTLINES = [[0, 1.65, -28, 0, 4.2, 0], [0.8, 2.05, 23.4, 0.8, 2.7, 1.5], [-3.2, 1.65, -8.5, 0.8, 2.6, 1.5], [0, 2.1, 24.4, 0, 5.2, 43], [25, 2.6, 10, 10, 2.5, -4], [-17.5, 8.2, 20.5, 3, 2.2, -6], [-24, 2, -11, -17, 4.2, 16]];
const SUN_DIR = norm3([-0.34, 0.74, 0.58]);
const HALF = 80, HN = 513, HSTEP = 2 * HALF / (HN - 1);
const PADS = [[0, -28, 3.6, 0], [25, 10, 3.2, 0.95], [0, 24.4, 2.2, 0.45]];
const lakeD = (x, z) => smin(hypot(x, z * 0.85) - 19.5, hypot(x - 15, z + 3) - 10.5, 4);

function rawHeight(x, z) {
  const r = hypot(x, z), d = lakeD(x, z) + (fbm(x * 0.07, z * 0.07, 3) - 0.5) * 3;
  let h = d > 0
    ? 0.42 * (1 - exp(-d / 1.6)) + 1.7 * ss(5, 40, d) + (fbm(x * 0.045 + 7, z * 0.045, 4) - 0.5) * 2.6 * ss(1, 14, d) + (fbm(x * 0.22, z * 0.22, 3) - 0.5) * 0.5 * ss(0.4, 4, d)
    : -0.35 * ss(0, 1.3, -d) - 0.75 * ss(1, 9, -d) + (fbm(x * 0.3, z * 0.3, 2) - 0.5) * 0.12;
  const e = ss(14, 24, x) * ss(1, 4, d) * (1 - ss(22, 34, abs(z - 6)));
  if (e > 0) { const q = h / 0.55, f = q - floor(q); h = mix(h, (floor(q) + ss(0.68, 1, f)) * 0.55, e); }
  const isl = 1 - ss(3.9, 6, hypot(x - 0.8, z - 1.5));
  if (isl > 0) h = mix(h, 0.46 + fbm(x * 0.5, z * 0.5, 2) * 0.12, isl);
  const tw = (1 - ss(2.8, 5.6, abs(x - tunCx(z)))) * ss(TUN_Z0 - 6, TUN_Z0 - 2, z) * (1 - ss(TUN_Z1, TUN_Z1 + 3, z));
  if (tw > 0) h = mix(h, tunFloor(z) + (fbm(x * 0.5, z * 0.5, 2) - 0.5) * 0.06, tw);
  const clr = 1 - ss(6.2, 9, hypot(x, z - 33));
  if (clr > 0) h = mix(h, 0.24, clr);
  const pud = 1 - ss(2.6, 4.8, hypot(x, (z - 32) * 1.15));
  if (pud > 0) h = mix(h, -0.22, pud);
  for (const [px, pz, pr, py] of PADS) {
    const k = 1 - ss(pr * 0.45, pr, hypot(x - px, z - pz));
    if (k > 0) h = mix(h, py, k);
  }
  return h - 7 * ss(62, 72, r);
}

class Mesh {
  constructor() { this.v = new Float32Array(9 << 20); this.i = new Uint32Array(1 << 22); this.nv = 0; this.ni = 0; }
  vert(x, y, z, nx, ny, nz, s, t, mt) {
    if ((this.nv + 1) * 9 > this.v.length) { const g = new Float32Array(this.v.length * 2); g.set(this.v); this.v = g; }
    const o = this.nv * 9, v = this.v;
    v[o] = x; v[o + 1] = y; v[o + 2] = z; v[o + 3] = nx; v[o + 4] = ny; v[o + 5] = nz; v[o + 6] = s; v[o + 7] = t; v[o + 8] = mt;
    return this.nv++;
  }
  tri(a, b, c) {
    if (this.ni + 3 > this.i.length) { const g = new Uint32Array(this.i.length * 2); g.set(this.i); this.i = g; }
    const v = this.v, A = a * 9, B = b * 9, C = c * 9;
    const ux = v[B] - v[A], uy = v[B + 1] - v[A + 1], uz = v[B + 2] - v[A + 2], wx = v[C] - v[A], wy = v[C + 1] - v[A + 1], wz = v[C + 2] - v[A + 2];
    const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    const flip = nx * (v[A + 3] + v[B + 3] + v[C + 3]) + ny * (v[A + 4] + v[B + 4] + v[C + 4]) + nz * (v[A + 5] + v[B + 5] + v[C + 5]) < 0;
    this.i[this.ni++] = a; this.i[this.ni++] = flip ? c : b; this.i[this.ni++] = flip ? b : c;
  }
  quad(a, b, c, d) { this.tri(a, b, c); this.tri(a, c, d); }
  smooth(v0, i0) {
    const v = this.v, n = new Float32Array((this.nv - v0) * 3);
    for (let k = i0; k < this.ni; k += 3) {
      const a = this.i[k], b = this.i[k + 1], c = this.i[k + 2], A = a * 9, B = b * 9, C = c * 9;
      const ux = v[B] - v[A], uy = v[B + 1] - v[A + 1], uz = v[B + 2] - v[A + 2], wx = v[C] - v[A], wy = v[C + 1] - v[A + 1], wz = v[C + 2] - v[A + 2];
      const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
      for (const q of [a, b, c]) { const o = (q - v0) * 3; n[o] += nx; n[o + 1] += ny; n[o + 2] += nz; }
    }
    return n;
  }
  applyNormals(v0, n) {
    for (let q = v0; q < this.nv; q++) {
      const o = (q - v0) * 3, l = hypot(n[o], n[o + 1], n[o + 2]);
      if (l > 1e-9) { this.v[q * 9 + 3] = n[o] / l; this.v[q * 9 + 4] = n[o + 1] / l; this.v[q * 9 + 5] = n[o + 2] / l; }
    }
  }
}

function tube(m, pts, sides, mt, o = {}) {
  const v0 = m.nv, i0 = m.ni, n = pts.length, { ridge = 0.05, lobes = 7, flare = 0, seed = 0, flat = 1, twist = 0, nUp = false } = o, avgC = TAU * pts.reduce((a, p) => a + p[3], 0) / n, U = max(1, round(avgC / 1.4)), V = U / avgC;
  let N = !nUp && abs(pts[1][1] - pts[0][1]) > 0.8 * hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1], pts[1][2] - pts[0][2]) ? [1, 0, 0] : [0, 1, 0], len = 0;
  for (let i = 0; i < n; i++) {
    const a = pts[max(i - 1, 0)], b = pts[min(i + 1, n - 1)], p = pts[i], T = norm3([b[0] - a[0], b[1] - a[1], b[2] - a[2]]);
    const dn = dot3(N, T);
    N = norm3([N[0] - T[0] * dn, N[1] - T[1] * dn, N[2] - T[2] * dn]);
    const B = cross3(T, N), t = i / (n - 1);
    if (i) len += hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1], p[2] - pts[i - 1][2]);
    for (let j = 0; j <= sides; j++) {
      const ang = (j % sides) / sides * TAU;
      const fin = flare ? flare * exp(-t * 6.5) * pow(abs(sin(ang * lobes * 0.5 + seed)), 2.2) : 0;
      const sh = 1 + ridge * sin(ang * lobes + seed + len * twist + 0.8 * sin(len * 0.55 + seed)) + ridge * 0.6 * sin(ang * (lobes * 2 + 1) - len * 0.4 + seed * 2) + fin;
      const ca = cos(ang) * p[3] * sh, sa = sin(ang) * p[3] * sh * flat;
      const nx = N[0] * cos(ang) + B[0] * sin(ang), ny = N[1] * cos(ang) + B[1] * sin(ang), nz = N[2] * cos(ang) + B[2] * sin(ang);
      m.vert(p[0] + N[0] * ca + B[0] * sa, p[1] + N[1] * ca + B[1] * sa, p[2] + N[2] * ca + B[2] * sa, nx, ny, nz, j / sides * U, len * V, mt);
    }
  }
  for (let i = 0; i < n - 1; i++) for (let j = 0; j < sides; j++) {
    const a = v0 + i * (sides + 1) + j;
    m.quad(a, a + 1, a + sides + 2, a + sides + 1);
  }
  const nn = m.smooth(v0, i0);
  for (let i = 0; i < n; i++) {
    const a = i * (sides + 1) * 3, b = (i * (sides + 1) + sides) * 3;
    for (let d = 0; d < 3; d++) { const s = nn[a + d] + nn[b + d]; nn[a + d] = s; nn[b + d] = s; }
  }
  m.applyNormals(v0, nn);
}

// rounded box / boulder with optional yaw, roll and surface noise
function shape(m, c, s, o = {}) {
  const { k = 8, res = 8, yaw = 0, roll = 0, amp = 0, mt = 3, seed = 0 } = o, v0 = m.nv, i0 = m.ni;
  const cy = cos(yaw), sy = sin(yaw), cr = cos(roll), sr = sin(roll);
  const FACES = [[0, 1, 2, 1], [0, 1, 2, -1], [1, 2, 0, 1], [1, 2, 0, -1], [2, 0, 1, 1], [2, 0, 1, -1]];
  for (const [a, b, e, sg] of FACES) {
    const base = m.nv;
    for (let j = 0; j <= res; j++) for (let i = 0; i <= res; i++) {
      const q = [0, 0, 0];
      q[a] = i / res * 2 - 1; q[b] = j / res * 2 - 1; q[e] = sg;
      const l = pow(pow(abs(q[0]), k) + pow(abs(q[1]), k) + pow(abs(q[2]), k), 1 / k), d = hypot(q[0], q[1], q[2]);
      let px = q[0] / l, py = q[1] / l, pz = q[2] / l;
      if (amp) { const w = 1 + amp * (fbm(q[0] / d * 1.7 + seed, q[1] / d * 1.7 + q[2] / d * 1.3, 3) - 0.5) * 2; px *= w; py *= w; pz *= w; }
      px *= s[0]; py *= s[1]; pz *= s[2];
      const rx = px * cr - py * sr, ry = px * sr + py * cr;
      m.vert(c[0] + rx * cy + pz * sy, c[1] + ry, c[2] - rx * sy + pz * cy, 0, 0, 0, (q[a] + q[e] * 0.5) * max(s[0], s[2]), (q[b] + q[e] * 0.5) * s[1], mt);
      const o2 = (m.nv - 1) * 9;
      const dx = m.v[o2] - c[0], dy = m.v[o2 + 1] - c[1], dz = m.v[o2 + 2] - c[2], dl = hypot(dx, dy, dz) || 1;
      m.v[o2 + 3] = dx / dl; m.v[o2 + 4] = dy / dl; m.v[o2 + 5] = dz / dl;
    }
    for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) {
      const p = base + j * (res + 1) + i;
      m.quad(p, p + 1, p + res + 2, p + res + 1);
    }
  }
  m.applyNormals(v0, m.smooth(v0, i0));
}

const PAL = {
  // every blossom shares this albedo; variation comes only from light
  sakura: [[250, 206, 220]],
  petal: [[250, 206, 220]],
  fern: [[48, 104, 50], [64, 120, 54], [38, 92, 50], [86, 130, 58]],
};
const CELL = { petal: 0, sakura: 1, fern: 2 };

async function buildWorld(progress) {
  const tick = async (t, msg) => { progress(t, msg); await new Promise((r) => setTimeout(r)); };
  let R = rng(20261124);
  const rr = (a, b) => a + (b - a) * R();

  // --- height field -------------------------------------------------------
  await tick(0.02, 'Shaping the sanctuary…');
  const H = new Float32Array(HN * HN);
  for (let j = 0; j < HN; j++) for (let i = 0; i < HN; i++) H[j * HN + i] = rawHeight(-HALF + i * HSTEP, -HALF + j * HSTEP);
  const gH = (x, z) => {
    const fx = clamp((x + HALF) / HSTEP, 0, HN - 1.001), fz = clamp((z + HALF) / HSTEP, 0, HN - 1.001), i = floor(fx), j = floor(fz), u = fx - i, v = fz - j;
    return mix(mix(H[j * HN + i], H[j * HN + i + 1], u), mix(H[(j + 1) * HN + i], H[(j + 1) * HN + i + 1], u), v);
  };

  // --- surface nets terrain (160 x 50 x 160 m at 0.625 m) --------------------
  await tick(0.1, 'Raising moss and stone…');
  const m = new Mesh(), VS = 0.625, NX = 256, NY = 80, Y0 = -10, SX = NX + 1, SY = NY + 1;
  const field = new Float32Array(SX * SX * SY), idx = new Int32Array(NX * NX * NY).fill(-1);
  for (let k = 0; k < SX; k++) for (let i = 0; i < SX; i++) {
    const x = -HALF + i * VS, z = -HALF + k * VS, h = gH(x, z), o = (k * SX + i) * SY;
    const n3 = (fbm(x * 0.34 + 11, z * 0.34 - 4, 3) - 0.5) * 0.3 * ss(0.3, 3, lakeD(x, z));
    for (let l = 0; l < SY; l++) field[o + l] = Y0 + l * VS - h - n3;
  }
  const FO = (i, k, l) => (k * SX + i) * SY + l;
  for (let k = 0; k < NX; k++) for (let i = 0; i < NX; i++) {
    const cx = -HALF + (i + 0.5) * VS, cz = -HALF + (k + 0.5) * VS;
    if (hypot(cx, cz) > 76) continue;
    const h = gH(cx, cz), l0 = clamp(floor((h - Y0) / VS) - 3, 0, NY - 1), l1 = clamp(floor((h - Y0) / VS) + 3, 0, NY - 1);
    for (let l = l0; l <= l1; l++) {
      let sx = 0, sy = 0, sz = 0, c = 0, mask = 0;
      for (let b = 0; b < 8; b++) if (field[FO(i + (b & 1), k + ((b >> 2) & 1), l + ((b >> 1) & 1))] < 0) mask |= 1 << b;
      if (mask === 0 || mask === 255) continue;
      for (const [a, b] of [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]]) {
        if (((mask >> a) & 1) === ((mask >> b) & 1)) continue;
        const fa = field[FO(i + (a & 1), k + ((a >> 2) & 1), l + ((a >> 1) & 1))], fb = field[FO(i + (b & 1), k + ((b >> 2) & 1), l + ((b >> 1) & 1))], t = fa / (fa - fb);
        sx += mix(a & 1, b & 1, t); sy += mix((a >> 1) & 1, (b >> 1) & 1, t); sz += mix((a >> 2) & 1, (b >> 2) & 1, t); c++;
      }
      const x = -HALF + (i + sx / c) * VS, y = Y0 + (l + sy / c) * VS, z = -HALF + (k + sz / c) * VS, e = 0.32;
      const nv = norm3([gH(x - e, z) - gH(x + e, z), 2 * e, gH(x, z - e) - gH(x, z + e)]);
      idx[(k * NX + i) * NY + l] = m.vert(x, y, z, nv[0], nv[1], nv[2], x, z, 0);
    }
  }
  const ID = (i, k, l) => (i < 0 || k < 0 || l < 0 || i >= NX || k >= NX || l >= NY) ? -1 : idx[(k * NX + i) * NY + l];
  for (let k = 1; k < NX; k++) for (let i = 1; i < NX; i++) {
    const h = gH(-HALF + i * VS, -HALF + k * VS), l0 = clamp(floor((h - Y0) / VS) - 3, 1, NY - 1), l1 = clamp(floor((h - Y0) / VS) + 3, 1, NY - 1);
    for (let l = l0; l <= l1; l++) {
      const f0 = field[FO(i, k, l)] < 0;
      if (f0 !== (field[FO(i + 1, k, l)] < 0)) { const a = ID(i, k - 1, l - 1), b = ID(i, k, l - 1), c = ID(i, k, l), d = ID(i, k - 1, l); if (a >= 0 && b >= 0 && c >= 0 && d >= 0) m.quad(a, b, c, d); }
      if (f0 !== (field[FO(i, k, l + 1)] < 0)) { const a = ID(i - 1, k - 1, l), b = ID(i, k - 1, l), c = ID(i, k, l), d = ID(i - 1, k, l); if (a >= 0 && b >= 0 && c >= 0 && d >= 0) m.quad(a, b, c, d); }
      if (f0 !== (field[FO(i, k + 1, l)] < 0)) { const a = ID(i - 1, k, l - 1), b = ID(i, k, l - 1), c = ID(i, k, l), d = ID(i - 1, k, l); if (a >= 0 && b >= 0 && c >= 0 && d >= 0) m.quad(a, b, c, d); }
    }
  }
  const terrainIdx = m.ni;

  // --- instances and occupancy --------------------------------------------
  const CAP = 1200000, leafBuf = new ArrayBuffer(CAP * 28), LF = new Float32Array(leafBuf), LU = new Uint32Array(leafBuf);
  let nLeaves = 0;
  const packS = (a, b, c, d) => ((round(clamp(a, -1, 1) * 127) & 255) | ((round(clamp(b, -1, 1) * 127) & 255) << 8) | ((round(clamp(c, -1, 1) * 127) & 255) << 16) | ((round(clamp(d, -1, 1) * 127) & 255) << 24)) >>> 0;
  const leaf = (x, y, z, size, n, t, kind, tone = R(), ao = 1) => {
    if (nLeaves >= CAP) return;
    const pal = PAL[kind], a = pal[floor(tone * pal.length) % pal.length], b = pal[floor(R() * pal.length) % pal.length], w = R(), o = nLeaves * 7;
    LF[o] = x; LF[o + 1] = y; LF[o + 2] = z; LF[o + 3] = size;
    LU[o + 4] = packS(n[0], n[1], n[2], R() * 2 - 1);
    LU[o + 5] = packS(t[0], t[1], t[2], ao * 2 - 1);
    LU[o + 6] = (round(mix(a[0], b[0], w)) | (round(mix(a[1], b[1], w)) << 8) | (round(mix(a[2], b[2], w)) << 16) | (CELL[kind] << 24)) >>> 0;
    nLeaves++;
  };
  const randDir = () => { const y = rr(-1, 1), a = rr(0, TAU), s = sqrt(1 - y * y); return [s * cos(a), y, s * sin(a)]; };
  const tangentOf = (n) => { const d = randDir(), k = dot3(d, n); return norm3([d[0] - n[0] * k, d[1] - n[1] * k, d[2] - n[2] * k]); };
  const occS = [], occB = [], colliders = [];
  const occCurve = (pts) => { for (let i = 0; i < pts.length; i += 2) occS.push(pts[i]); };
  const inShaft = (x, y, z) => y > 7 && hypot(x, z - 33) < 8.2 - max(0, y - 18) * 0.35;
  const blob = (cx, cy, cz, rx, ry, rz, dens = 1) => {
    occB.push([cx, cy, cz, rx, ry, rz]);
    const n = round(rx * ry * rz * 3.1 * dens * LEAF_KEEP);
    for (let i = 0; i < n; i++) {
      const d = randDir(), rad = pow(R(), 0.42) * (0.82 + 0.3 * fbm(d[0] * 2 + cx, d[2] * 2 + d[1] + cz, 2));
      const x = cx + d[0] * rad * rx, y = cy + d[1] * rad * ry * (d[1] < 0 ? 0.72 : 1), z = cz + d[2] * rad * rz;
      if (y < 5.8 + fbm(x * 0.2, z * 0.2, 2) * 2.2 || inShaft(x, y, z) || POSES.some((p) => hypot(x - p[0], y - p[1], z - p[2]) < 6.5)) continue;
      const nr = norm3([d[0] + rr(-0.5, 0.5), d[1] + 0.35 + rr(-0.5, 0.5), d[2] + rr(-0.5, 0.5)]);
      leaf(x, y, z, rr(0.36, 0.58), nr, tangentOf(nr), 'sakura', R(), clamp(rad * 0.85 + d[1] * 0.22 - 0.05, 0, 1));
    }
  };

  // --- trees ----------------------------------------------------------------
  // every tree grows from its own random stream, so reshaping one never moves the rest of the world
  const sidesFor = (r) => r > 1.6 ? 36 : r > 0.8 ? 26 : r > 0.4 ? 16 : r > 0.18 ? 10 : r > 0.08 ? 7 : 5;
  const rot = (v, k, a) => {
    const c = cos(a), s = sin(a), d = dot3(k, v) * (1 - c), x = cross3(k, v);
    return [v[0] * c + x[0] * s + k[0] * d, v[1] * c + x[1] * s + k[1] * d, v[2] * c + x[2] * s + k[2] * d];
  };
  const ortho = (d) => norm3(abs(d[1]) < 0.95 ? cross3(d, [0, 1, 0]) : cross3(d, [1, 0, 0]));
  // one limb: sinuous, rising and then levelling out like an old cherry, forking again along its length
  const limb = (p0, d0, len, rad, depth, o) => {
    const n = depth < 2 ? 8 : 5, c = [], tip = rad * (depth < 2 ? 0.12 : 0.2), w0 = rr(0, TAU), w1 = rr(0, TAU), bend = depth < 2 ? rr(0.14, 0.3) : rr(0.1, 0.22);
    const ease = depth === 0 ? 0.3 : 0;
    let d = ease ? norm3([o.ax[0] * 0.45 + d0[0] * 0.55, o.ax[1] * 0.45 + d0[1] * 0.55, o.ax[2] * 0.45 + d0[2] * 0.55]) : d0.slice(), p = p0.slice();
    for (let i = 0; i <= n; i++) {
      const f = i / n;
      c.push([p[0], p[1], p[2], mix(rad, tip, pow(f, 0.85))]);
      d = norm3([mix(d[0], d0[0], ease) + sin(f * 5 + w0) * bend, mix(d[1], d0[1], ease) + o.up[depth], mix(d[2], d0[2], ease) + cos(f * 4.3 + w1) * bend]);
      const s = len / n;
      p = [p[0] + d[0] * s, p[1] + d[1] * s, p[2] + d[2] * s];
    }
    const pts = curve(c, max(5, round(len * (depth < 2 ? 2 : 1.4))));
    if (rad > 0.022) tube(m, pts, sidesFor(rad), o.mt, { ridge: depth ? 0.035 : 0.06, lobes: depth ? 3 : 5, seed: rr(0, 20), twist: depth ? 0 : 0.08 });
    if (depth < 2) occCurve(pts);
    const kids = o.kids[depth] || 0, az = rr(0, TAU);
    for (let k = 0; k < kids; k++) {
      const f = mix(o.from[depth], 0.94, (k + rr(0.2, 0.8)) / kids), i = min(floor(f * (pts.length - 1)), pts.length - 2), q = pts[i], q2 = pts[i + 1];
      const pd = norm3([q2[0] - q[0], q2[1] - q[1], q2[2] - q[2]]), side = rot(ortho(pd), pd, az + k * 2.4);
      const out = norm3([q[0] - o.cx + 1e-3, 0, q[2] - o.cz]), sp = rr(0.5, 0.8);
      const cd = norm3([pd[0] * (1 - sp) + side[0] * sp + out[0] * o.out, pd[1] * (1 - sp) + side[1] * sp * 0.6 + o.lift[depth], pd[2] * (1 - sp) + side[2] * sp + out[2] * o.out]);
      limb([q[0], q[1], q[2]], cd, len * rr(0.5, 0.72) * (1.08 - f * 0.4), q[3] * rr(0.6, 0.78), depth + 1, o);
    }
    // flower clusters line the outer part of every flowering branch, resting on it like low clouds
    if (depth >= o.bloom) {
      const cr = o.crown * [1.3, 1.1, 0.9, 0.75][depth], step = cr * 1.55;
      for (let i = floor(pts.length * (depth === 1 ? 0.45 : 0.25)), acc = step; i < pts.length; i++) {
        if (i) acc += hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]);
        if (acc < step && i < pts.length - 1) continue;
        acc = 0;
        const e = pts[i], s = cr * rr(0.8, 1.15);
        blob(e[0] + rr(-0.3, 0.3), e[1] + s * 0.3, e[2] + rr(-0.3, 0.3), s * 1.25, s * 0.6, s * 1.25, o.dens);
      }
    }
  };
  // a short, twisted, gnarled trunk that splits into scaffold limbs just above head height
  const stem = (x, z, by, r, lean, forkY, nLead, ang, L, o) => {
    const ctrl = [], w1 = rr(0, TAU), w2 = rr(0, TAU), amp = min(r * 0.2 + 0.2, 0.8);
    for (let i = 0; i <= 7; i++) {
      const t = i / 7, y = t * forkY, a = amp * t;
      ctrl.push([x + lean[0] * y + a * (sin(t * 3.1 + w1) + 0.4 * sin(t * 7.7 + w2)), by + y, z + lean[1] * y + a * (cos(t * 2.6 + w2) + 0.4 * sin(t * 6.3 + w1)),
        r * (1 + (r > 3 ? 0.28 : 0.45) * exp(-t * 9)) * (1 - 0.16 * t) * (1 + (0.07 * sin(t * 9 + w1) + 0.05 * sin(t * 17 + w2)) * min(1, 2.4 / r))]);
    }
    const e = ctrl[7], f = ctrl[6], ax = norm3([e[0] - f[0], e[1] - f[1], e[2] - f[2]]);
    ctrl.push([e[0] + ax[0] * r * 0.45, e[1] + ax[1] * r * 0.45, e[2] + ax[2] * r * 0.45, e[3] * 0.45]);
    const pts = curve(ctrl, r > 2 ? 40 : 30);
    tube(m, pts, sidesFor(r), o.mt, { ridge: 0.09, lobes: r > 2.5 ? 11 : 7, flare: r > 3 ? 0.12 : 0.22, seed: rr(0, 40), twist: rr(0.06, 0.14) * (R() < 0.5 ? -1 : 1) });
    occCurve(pts);
    const az = rr(0, TAU);
    o.ax = ax;
    for (let k = 0; k < nLead; k++) {
      const a = ang * rr(0.85, 1.15), b = az + k / nLead * TAU + rr(-0.35, 0.35);
      limb([f[0], f[1], f[2]], norm3([cos(b) * sin(a), cos(a), sin(b) * sin(a)]), L * rr(0.85, 1.1), e[3] * rr(0.95, 1.05) * 1.25 / sqrt(nLead), 0, o);
    }
  };
  // upright vase, broad umbrella, leaning, twin-stemmed; forks always stay above head height
  const tree = (o) => {
    const outer = R;
    R = rng((round(o.x * 131) * 7919) ^ (round(o.z * 173) * 104729) ^ 0x2c1b3c6d);
    const { x, z, h, r } = o, by = gH(x, z) - 0.35, u = R(), tv = R(), lite = !!o.lite;
    const kind = o.kind ?? (u < 0.4 ? 0 : u < 0.7 ? 1 : u < 0.85 ? 2 : 3);
    const opt = {
      mt: 1 + (tv - 0.5) * 0.8, cx: x, cz: z,
      up: [-0.012, 0.012, -0.012, -0.035], lift: [0.08, 0, -0.03], out: kind === 1 ? 0.6 : 0.45,
      kids: lite ? [5, 3, 0] : [6, 3, 2], from: [0.22, 0.3, 0.35],
      bloom: 1, crown: lite ? 1.45 : 1.25, dens: TREE_DENS,
    };
    const forkY = o.fork ?? (kind === 1 ? rr(3.8, 5) : rr(4.6, 6.6));
    const la = rr(0, TAU), ls = kind === 2 ? rr(0.1, 0.18) : rr(0, 0.05), lean = [cos(la) * ls, sin(la) * ls];
    const nLead = o.leaders ?? floor(rr(3, kind === 1 ? 6 : 5));
    const ang = kind === 1 ? rr(0.8, 1) : rr(0.5, 0.75), L = rr(11.5, 15) * h / 30;
    if (kind === 3) {
      const s = rr(0.08, 0.13), d = r * 0.5;
      for (const sg of [1, -1]) stem(x + cos(la) * d * sg, z + sin(la) * d * sg, by, r * 0.68, [cos(la) * s * sg, sin(la) * s * sg], forkY * rr(0.9, 1.1), nLead, ang, L * 0.85, opt);
    } else stem(x, z, by, r, lean, forkY, nLead, ang, L, opt);
    // buttress roots: tall narrow planks that leave the trunk high and sink into the moss
    const nR = o.roots ?? round(rr(5, 8)), a0 = rr(0, TAU), mtR = 2 + (tv - 0.5) * 0.8;
    for (let i = 0; i < nR; i++) {
      const a = a0 + i / nR * TAU + rr(-0.3, 0.3), L = min(r * rr(2, 3.6), r > 3 ? 6.4 : 7.5), wig = rr(-0.5, 0.5), top = by + r * rr(0.9, 1.35), ph = rr(0, TAU), c = [];
      // the mother tree keeps the face toward its clearing and mirror pool clean
      if (r > 3 && sin(a) < -0.55) continue;
      for (let q = 0; q <= 8; q++) {
        const t = q / 8, d = r * 0.35 + (r * 0.8 + L) * t, aa = a + sin(t * 4.2 + ph) * 0.16 * t + wig * t * 0.35, px = x + cos(aa) * d, pz = z + sin(aa) * d, g = gH(px, pz), rad = r * mix(0.4, 0.045, pow(t, 0.7)), span = min(r * 2.4, (r * 0.8 + L) * 0.85), k = pow(1 - ss(0, 1, (d - r * 0.35) / span), 1.6);
        c.push([px, g + rad * 0.35 + (top - by) * (span / (r * 2.4)) * k + sin(t * PI * 2.3 + ph) * r * 0.05 * t - ss(0.75, 1, t) * rad * 1.6, pz, rad]);
      }
      tube(m, curve(c, 26), r > 1.2 ? 12 : 9, mtR, { ridge: 0.1, lobes: 3, seed: i * 3.1, flat: 0.52, nUp: true });
    }
    colliders.push([x, z, r * (r > 3 ? 1.3 : 1.8)]);
    R = outer;
  };

  await tick(0.3, 'Growing the giant trees…');
  const HEROES = [
    { x: 0, z: 43, h: 38, r: 4.7, roots: 13, kind: 0, leaders: 5, fork: 8 },
    { x: -16.5, z: -21.5, h: 30, r: 1.9 }, { x: 16.5, z: -24, h: 29, r: 1.8 },
    { x: -29, z: -20, h: 32, r: 2.2 }, { x: 29, z: -22, h: 30, r: 2 },
    { x: -33, z: -3, h: 33, r: 2.4 }, { x: -33, z: 13, h: 32, r: 2.2 },
    { x: -29, z: 33, h: 33, r: 2.3 }, { x: -15, z: 42, h: 31, r: 2 },
    { x: 16, z: 43, h: 31, r: 2 }, { x: 27, z: 33, h: 30, r: 1.9 },
    { x: 17, z: 26, h: 28, r: 1.6 }, { x: 34, z: 16, h: 30, r: 1.9 },
    { x: 36, z: 2, h: 31, r: 2 }, { x: 33, z: -10, h: 29, r: 1.7 },
  ];
  for (const t of HEROES) tree(t);

  const blocked = (x, z, pad) => {
    for (const p of SIGHTLINES) {
      const dx = p[3] - p[0], dz = p[5] - p[2], l = hypot(dx, dz), ux = dx / l, uz = dz / l, s = clamp((x - p[0]) * ux + (z - p[2]) * uz, -3, l + 22);
      if (hypot(x - p[0] - ux * s, z - p[2] - uz * s) < pad + 2.8 + s * 0.08) return true;
    }
    return false;
  };
  const placed = HEROES.map((t) => [t.x, t.z, t.r]);
  const inTunnel = (x, z, r) => z > TUN_Z0 - 7 && z < TUN_Z1 + 1 && abs(x - tunCx(z)) < 6.5 + r;
  for (let tries = 0, count = 0; tries < 1800 && count < 78; tries++) {
    const a = rr(0, TAU), d = rr(30, 63), x = cos(a) * d, z = sin(a) * d, s = rr(1, 2.1);
    if (lakeD(x, z) < 5 || hypot(x, z - 33) < 12 || blocked(x, z, s) || inTunnel(x, z, s)) continue;
    if (placed.some((p) => hypot(p[0] - x, p[1] - z) < p[2] + s + 4.4)) continue;
    tree({ x, z, h: rr(26, 35), r: s, lite: true });
    placed.push([x, z, s]); count++;
    if (count % 12 === 0) await tick(0.3 + count / 78 * 0.22, 'Growing the giant trees…');
  }

  // --- root arch tunnel: you start inside and step out facing the shrine ---
  await tick(0.54, 'Weaving the root arches…');
  const arches = [];
  for (let a = 0; a < 7; a++) {
    const z0 = TUN_Z0 + a * TUN_STEP, t0 = tunT(z0), cx = tunCx(z0), hw = mix(3.5, 4.6, ss(0.55, 1, t0)), h = mix(4.9, 6.1, ss(0.5, 1, t0));
    arches.push([z0, cx, hw, h]);
    for (let s = 0; s < 3; s++) {
      const c = [], ph = s / 3 * TAU + a * 0.7;
      for (let q = 0; q <= 14; q++) {
        const t = q / 14, th = t * PI, w = 0.56 + 0.12 * sin(t * 9 + a), tw = ph + t * 11;
        const px = cx - cos(th) * hw + cos(tw) * w, pz = z0 + sin(t * 2.2 + a) * 0.45 + sin(tw) * w * 0.9, gy = gH(px, pz) - 0.4;
        c.push([px, gy + sin(th) * (h - gy * sin(th)) + cos(tw * 0.5) * w * 0.3, pz, (0.22 + 0.36 * pow(abs(cos(th)), 4)) * (s === 0 ? 1.12 : 0.84)]);
      }
      const pts = curve(c, 90);
      tube(m, pts, 12, 2, { ridge: 0.08, lobes: 4, seed: a + s });
      occCurve(pts);
    }
    colliders.push([cx - hw, z0, 0.8], [cx + hw, z0, 0.8]);
  }
  for (let f = 0; f < 450 * LEAF_KEEP; f++) {
    const [z0, cx, hw, h] = arches[f % 7];
    const th = R() * PI, px = cx - cos(th) * hw + rr(-0.5, 0.5), pz = z0 + rr(-0.6, 0.6), py = gH(px, pz) + sin(th) * h + 0.42, n = norm3([rr(-0.5, 0.5), 1, rr(-0.5, 0.5)]);
    leaf(px, max(py, 0.22), pz, rr(0.28, 0.5), n, tangentOf(n), 'fern');
  }

  // short diagonal tendrils wind between neighbouring arches and bind them into one tunnel
  const archAt = (z) => { const t = tunT(z); return [tunCx(z), mix(3.5, 4.6, ss(0.55, 1, t)), mix(4.9, 6.1, ss(0.5, 1, t))]; };
  for (let s = 0; s < 36; s++) {
    const z0 = TUN_Z0 + (s % 6) * TUN_STEP + hash2(s, 7) * 0.6, len = TUN_STEP * (1.05 + hash2(s, 3) * 0.75), dir = s % 2 ? 1 : -1, c = [];
    const thA = (0.12 + hash2(s, 1) * 0.76) * PI, thB = clamp(thA + dir * (0.16 + hash2(s, 2) * 0.24) * PI, 0.1 * PI, 0.9 * PI), w = 0.09 + hash2(s, 5) * 0.07;
    for (let q = 0; q <= 8; q++) {
      const t = q / 8, pz = min(z0 + len * t, TUN_Z1 - 0.4), th = mix(thA, thB, t) + sin(t * 6 + s) * 0.05, [cx, hw, h] = archAt(pz), rad = hw + 0.18 + sin(t * 9 + s) * 0.14;
      const px = cx - cos(th) * rad, gy = gH(px, pz) - 0.4;
      c.push([px, gy + sin(th) * (h + 0.12 - gy * sin(th)) + sin(t * 8 + s * 2) * 0.1, pz, mix(0.015, w, pow(sin(t * PI), 0.7))]);
    }
    const pts = curve(c, 28);
    tube(m, pts, 7, 2, { ridge: 0.08, lobes: 3, seed: s });
    occCurve(pts);
  }

  // --- walkable high root bridge --------------------------------------------
  const BR = [[-31, gH(-31, 2) + 0.05, 2], [-28.5, 1.9, 8], [-25, 3.9, 13], [-21, 5.9, 18], [-17.5, 6.6, 20.5], [-13, 6.4, 24], [-10.2, 4.9, 28], [-8.6, 2.9, 31.8], [-7.2, gH(-7.2, 35.4) + 0.05, 35.4]];
  const bridgeLine = curve(BR.map((p) => [p[0], p[1], p[2], 1]), 64);
  const deck = bridgeLine.map((p) => [p[0], p[1] - 0.42, p[2], 0.5]);
  tube(m, deck, 18, 2, { ridge: 0.05, lobes: 5, seed: 2, flat: 2.3 });
  occCurve(deck);
  for (let s = 0; s < 4; s++) {
    const side = s < 2 ? -1 : 1, off = s % 2 ? 1.08 : 0.7, c = bridgeLine.map((p, i) => {
      const a = bridgeLine[max(i - 1, 0)], b = bridgeLine[min(i + 1, bridgeLine.length - 1)], d = norm3([b[0] - a[0], 0, b[2] - a[2]]), w = sin(i * 0.33 + s) * 0.13;
      return [p[0] - d[2] * side * (off + w), p[1] - (s % 2 ? 0.1 : 0.5) + cos(i * 0.28 + s) * 0.12, p[2] + d[0] * side * (off + w), s % 2 ? 0.17 : 0.3];
    });
    tube(m, c, 9, 2, { ridge: 0.08, lobes: 3, seed: s });
  }
  for (const k of [20, 28, 36, 44]) {
    const p = bridgeLine[k], g = gH(p[0], p[2]) - 0.5, c = [[p[0], p[1] - 0.5, p[2], 0.42], [p[0] + 0.3, mix(p[1], g, 0.5), p[2] - 0.2, 0.5], [p[0] - 0.2, g, p[2] + 0.2, 0.95]];
    tube(m, curve(c, 10), 11, 2, { ridge: 0.11, lobes: 4, seed: k });
    colliders.push([p[0], p[2], 0.55]);
  }

  // --- stepping stones ------------------------------------------------------
  await tick(0.6, 'Setting the old stones…');
  const rock0 = m.ni;
  const STONE_LINE = curve([[-1.2, 0, -24, 0], [-3.6, 0, -19, 0], [-1.8, 0, -14, 0], [-3.2, 0, -8.5, 0], [-1.1, 0, -4.2, 0]], 13);
  const stones = STONE_LINE.map((p, i) => {
    const r = rr(0.72, 0.98);
    shape(m, [p[0], -0.34, p[2]], [r, 0.42, r * rr(0.82, 1)], { k: 3.2, res: 7, amp: 0.16, seed: i, yaw: rr(0, 3) });
    return [p[0], p[2], r * 1.02];
  });

  // --- submerged shrine (arched niche stele) -------------------------------
  const C = [0.8, 0.46, 1.5], blocks = [];
  const box = (x, y, z, sx, sy, sz, o = {}) => shape(m, [C[0] + x, C[1] + y, C[2] + z], [sx, sy, sz], { k: 18, res: 5, amp: 0.008, seed: x + z, ...o });
  for (const [hw, y0, t] of [[3.5, 0, 0.26], [2.75, 0.5, 0.23], [2.15, 0.94, 0.2]]) {
    box(0, y0 + t, 0, hw, t, hw);
    blocks.push([C[0], C[2], hw, C[1] + y0 + t * 2]);
  }
  const FLOOR = 1.34;
  box(-1.3, FLOOR + 1.08, 0.62, 0.34, 1.08, 0.42); box(1.3, FLOOR + 1.08, 0.62, 0.34, 1.08, 0.42);
  for (let i = 0; i < 11; i++) {
    const t = (i + 0.5) / 11 * PI;
    box(cos(t) * 1.2, FLOOR + 2.16 + sin(t) * 1.2, 0.62, 0.17, 0.36, 0.42, { roll: t, k: 10 });
  }
  box(0, FLOOR + 1.62, 1.14, 1.42, 1.62, 0.12);
  shape(m, [C[0], C[1] + FLOOR + 1.08, C[2] + 0.84], [0.11, 0.2, 0.11], { k: 2, res: 6, mt: 4 });
  box(0, FLOOR + 3.58, 0, 2.28, 0.14, 2.28); box(0, FLOOR + 3.84, 0, 1.72, 0.13, 1.72); box(0, FLOOR + 4.07, 0, 1.12, 0.11, 1.12);
  shape(m, [C[0], C[1] + FLOOR + 4.3, C[2]], [0.13, 0.15, 0.13], { k: 2, res: 6, mt: 4 });
  for (const [px, pz] of [[-1.72, -1.72], [1.72, -1.72], [-1.72, 1.72], [1.72, 1.72]]) {
    box(px, FLOOR + 1.75, pz, 0.2, 1.75, 0.2);
    colliders.push([C[0] + px, C[2] + pz, 0.34]);
  }
  colliders.push([C[0] - 1.3, C[2] + 0.62, 0.6], [C[0] + 1.3, C[2] + 0.62, 0.6], [C[0], C[2] + 1, 1.1]);
  for (let i = 0; i < 36; i++) {
    const a = rr(0, TAU), d = rr(3.7, 7.2), x = C[0] + cos(a) * d, z = C[2] + sin(a) * d;
    shape(m, [x, gH(x, z) + rr(-0.02, 0.14), z], [rr(0.16, 0.5), rr(0.1, 0.26), rr(0.16, 0.42)], { k: 4, res: 4, amp: 0.14, yaw: rr(0, 3), seed: i });
  }

  // --- terrace boulders, ferns, litter, floating petals ---------------------
  await tick(0.68, 'Scattering ferns and petals…');
  for (let i = 0; i < 88; i++) {
    const a = rr(-0.9, 1.25), d = rr(22, 40), x = cos(a) * d + 3, z = sin(a) * d + 3;
    if (lakeD(x, z) < 0.6 || blocked(x, z, 0.8)) continue;
    const s = rr(0.35, 1.25);
    shape(m, [x, gH(x, z) + s * 0.08, z], [s * rr(0.9, 1.4), s * rr(0.45, 0.72), s], { k: 3.4, res: 6, amp: 0.2, yaw: rr(0, 3), seed: i });
    if (s > 0.8) colliders.push([x, z, s]);
  }
  // mossy rock steps descending from the east terrace toward the cove
  for (let i = 0; i < 15; i++) {
    const a = atan2(-14, -15) + (i / 14 - 0.5) * 2.5, d = 3.5 + (i % 3) * 0.72 + rr(-0.2, 0.2), x = 25 + cos(a) * d, z = 10 + sin(a) * d, s = rr(0.48, 0.95);
    shape(m, [x, gH(x, z) + s * 0.1, z], [s * rr(1, 1.5), s * rr(0.42, 0.62), s], { k: 3.4, res: 7, amp: 0.2, yaw: rr(0, 3), seed: 40 + i });
    colliders.push([x, z, s * 0.8]);
  }
  const rock1 = m.ni;
  for (let i = 0, n = 20000 * LEAF_KEEP; i < n; i++) {
    const a = rr(0, TAU), d = 8 + 54 * sqrt(R()), x = cos(a) * d, z = sin(a) * d, ld = lakeD(x, z), west = ss(4, 22, -x + z * 0.4);
    if (ld < 0.7 || hypot(x, z - 33) < 2.8 || R() > 0.34 + west * 0.66 || fbm(x * 0.09, z * 0.09, 2) < 0.38 || inTunnel(x, z, -4.6)) continue;
    const y = gH(x, z), s = rr(0.34, 0.68), fr = 6 + floor(R() * 4), a0 = rr(0, TAU);
    for (let f = 0; f < fr; f++) {
      // each frond leaves the crown at 45-55 degrees, so its card is centred one half-length out along the frond
      const b = a0 + f / fr * TAU + rr(-0.2, 0.2), o = [cos(b), 0, sin(b)], st = rr(1, 1.45), n3 = norm3([-o[0] * st, 1, -o[2] * st]), sf = s * rr(0.8, 1.15), tf = [-o[2], 0, o[0]], bf = cross3(n3, tf);
      leaf(x + bf[0] * sf, y + 0.03 + bf[1] * sf, z + bf[2] * sf, sf, n3, tf, 'fern');
    }
  }
  for (let i = 0, n = 26000 * LEAF_KEEP; i < n; i++) {
    const a = rr(0, TAU), d = 4 + 48 * sqrt(R()), x = cos(a) * d, z = sin(a) * d, y = gH(x, z);
    if (y < 0.03) continue;
    const n3 = norm3([rr(-0.14, 0.14), 1, rr(-0.14, 0.14)]);
    leaf(x, y + 0.035, z, rr(0.035, 0.06), n3, tangentOf(n3), 'petal');
  }
  for (const s of stones) for (let i = 0; i < 12; i++) {
    const a = rr(0, TAU), d = rr(0, s[2] * 0.76), n3 = norm3([rr(-0.08, 0.08), 1, rr(-0.08, 0.08)]);
    leaf(s[0] + cos(a) * d, 0.095, s[1] + sin(a) * d, rr(0.035, 0.055), n3, tangentOf(n3), 'petal');
  }
  for (let i = 0, n = 7000 * LEAF_KEEP; i < n; i++) {
    const cove = R() < 0.72, x = cove ? 15 + rr(-11, 11) : rr(-20, 20), z = cove ? -3 + rr(-11, 11) : rr(-23, 23);
    if (lakeD(x, z) > -0.25 || fbm(x * 0.18 + 3, z * 0.18, 2) < (cove ? 0.34 : 0.52)) continue;
    const n3 = norm3([rr(-0.04, 0.04), 1, rr(-0.04, 0.04)]);
    leaf(x, 0.014, z, rr(0.035, 0.06), n3, tangentOf(n3), 'petal');
  }

  // --- baked RG8 volume: R sky visibility, G sun bounce -----------------------
  await tick(0.78, 'Baking light through the canopy…');
  const GX = 128, GY = 40, CELLS = 1.25, occ = new Float32Array(GX * GX * GY);
  const GI = (x, y, z) => (z * GX + x) * GY + y;
  for (let z = 0; z < GX; z++) for (let x = 0; x < GX; x++) {
    const h = gH(-HALF + (x + 0.5) * CELLS, -HALF + (z + 0.5) * CELLS);
    for (let y = 0; y < GY; y++) { const wy = -10 + (y + 0.5) * CELLS; if (wy < h) occ[GI(x, y, z)] = 1; }
  }
  const splat = (cx, cy, cz, rx, ry, rz, dens) => {
    const x0 = clamp(floor((cx - rx + HALF) / CELLS), 0, GX - 1), x1 = clamp(ceil((cx + rx + HALF) / CELLS), 0, GX - 1);
    const y0 = clamp(floor((cy - ry + 10) / CELLS), 0, GY - 1), y1 = clamp(ceil((cy + ry + 10) / CELLS), 0, GY - 1);
    const z0 = clamp(floor((cz - rz + HALF) / CELLS), 0, GX - 1), z1 = clamp(ceil((cz + rz + HALF) / CELLS), 0, GX - 1);
    for (let z = z0; z <= z1; z++) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const dx = (-HALF + (x + 0.5) * CELLS - cx) / rx, dy = (-10 + (y + 0.5) * CELLS - cy) / ry, dz = (-HALF + (z + 0.5) * CELLS - cz) / rz, q = dx * dx + dy * dy + dz * dz;
      if (q < 1) { const o = GI(x, y, z); occ[o] = min(1, occ[o] + dens * (1 - q * 0.6)); }
    }
  };
  for (const s of occS) { const r = max(s[3], 0.5); splat(s[0], s[1], s[2], r, r, r, 0.8); }
  for (const b of occB) splat(b[0], b[1], b[2], b[3], b[4], b[5], 0.3);
  const sky = new Float32Array(occ.length);
  const DIRS = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1], [2, 0], [-2, 0], [0, 2], [0, -2]];
  let wSum = 0;
  for (const [dx, dz] of DIRS) {
    const T = new Float32Array(occ.length), w = 1 / (1 + dx * dx + dz * dz);
    wSum += w;
    for (let y = GY - 1; y >= 0; y--) for (let z = 0; z < GX; z++) for (let x = 0; x < GX; x++) {
      const ax = x + dx, az = z + dz;
      const up = y === GY - 1 || ax < 0 || az < 0 || ax >= GX || az >= GX ? 1 : T[GI(ax, y + 1, az)] * (1 - occ[GI(ax, y + 1, az)]);
      T[GI(x, y, z)] = up;
    }
    for (let o = 0; o < T.length; o++) sky[o] += T[o] * w;
  }
  await tick(0.86, 'Baking light through the canopy…');
  const sunT = new Float32Array(occ.length), sdx = SUN_DIR[0] / SUN_DIR[1], sdz = SUN_DIR[2] / SUN_DIR[1];
  for (let y = GY - 1; y >= 0; y--) for (let z = 0; z < GX; z++) for (let x = 0; x < GX; x++) {
    if (y === GY - 1) { sunT[GI(x, y, z)] = 1; continue; }
    const fx = x + sdx, fz = z + sdz, ix = floor(fx), iz = floor(fz), u = fx - ix, v = fz - iz;
    if (ix < 0 || iz < 0 || ix >= GX - 1 || iz >= GX - 1) { sunT[GI(x, y, z)] = 1; continue; }
    const s = (a, b) => { const o = GI(a, y + 1, b); return sunT[o] * (1 - occ[o]); };
    sunT[GI(x, y, z)] = mix(mix(s(ix, iz), s(ix + 1, iz), u), mix(s(ix, iz + 1), s(ix + 1, iz + 1), u), v);
  }
  let bounce = new Float32Array(occ.length);
  for (let o = 0; o < occ.length; o++) bounce[o] = sunT[o] * min(1, occ[o] * 2.2);
  const STEP = [GX * GY, GY, 1];
  for (let pass = 0; pass < 2; pass++) for (const st of STEP) {
    const next = new Float32Array(occ.length);
    for (let z = 1; z < GX - 1; z++) for (let x = 1; x < GX - 1; x++) for (let y = 1; y < GY - 1; y++) {
      const o = GI(x, y, z);
      next[o] = (bounce[o - st] + bounce[o] + bounce[o + st]) / 3;
    }
    bounce = next;
  }
  // texture layout: x, row = z, depth layer = y
  const giTex = new Uint8Array(GX * GX * GY * 2);
  for (let y = 0; y < GY; y++) for (let z = 0; z < GX; z++) for (let x = 0; x < GX; x++) {
    const o = GI(x, y, z), t = (y * GX * GX + z * GX + x) * 2;
    giTex[t] = round(clamp(sky[o] / wSum, 0, 1) * 255);
    giTex[t + 1] = round(clamp(bounce[o] * 2.4, 0, 1) * 255);
  }

  // --- walking ---------------------------------------------------------------
  const walkH = (x, z, feet) => {
    let y = max(gH(x, z), -0.25);
    for (const s of stones) if (hypot(x - s[0], z - s[1]) < s[2]) y = max(y, 0.08);
    for (const b of blocks) if (abs(x - b[0]) < b[2] && abs(z - b[1]) < b[2]) y = max(y, b[3]);
    for (let i = 0; i < bridgeLine.length - 1; i++) {
      const a = bridgeLine[i], b = bridgeLine[i + 1], dx = b[0] - a[0], dz = b[2] - a[2], t = clamp(((x - a[0]) * dx + (z - a[2]) * dz) / (dx * dx + dz * dz), 0, 1);
      if (hypot(x - a[0] - dx * t, z - a[2] - dz * t) < 1.3) {
        const top = mix(a[1], b[1], t);
        if (feet > top - 1) y = max(y, top);
      }
    }
    return y;
  };

  await tick(0.92, 'Waking the mirror lake…');
  return {
    vb: m.v.subarray(0, m.nv * 9), ib: m.i.subarray(0, m.ni), terrainIdx, shellRanges: [[0, terrainIdx], [rock0, rock1]], nTri: m.ni / 3,
    leaves: new Uint8Array(leafBuf, 0, nLeaves * 28), nLeaves, H, giTex, GX, GY, colliders, walkH,
  };
}
