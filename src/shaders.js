// ============================================================================
// WGSL: scene materials, water, far forest, volumetrics, bloom, tonemap
// ============================================================================
const WGSL_U = /*wgsl*/`
struct U { vp:mat4x4f, ivp:mat4x4f, svp:mat4x4f, cam:vec4f, sun:vec4f, res:vec4f, misc:vec4f };
`;
const WGSL_COMMON = WGSL_U + /*wgsl*/`
@group(0) @binding(0) var<uniform> u:U;
@group(0) @binding(1) var shT:texture_depth_2d;
@group(0) @binding(2) var shS:sampler_comparison;
@group(0) @binding(3) var giT:texture_3d<f32>;
@group(0) @binding(4) var lin:sampler;
@group(0) @binding(5) var noiseT:texture_2d<f32>;
@group(0) @binding(6) var atlasT:texture_2d<f32>;
@group(0) @binding(7) var hT:texture_2d<f32>;
@group(0) @binding(8) var detailT:texture_2d<f32>;
@group(0) @binding(9) var barkT:texture_2d<f32>;

const SUNC = vec3f(6.4, 4.5, 2.5);
const SKYC = vec3f(.34, .62, .66);
const FOGC = vec3f(.16, .37, .38);

fn sat(x:f32)->f32 { return clamp(x, 0., 1.); }
fn zones(p:vec3f)->vec3f {
  let c = smoothstep(9., 23., p.x - p.z * .15);
  let b = smoothstep(7., 22., max(-p.x - 6., p.z - 17.)) * (1. - c);
  return vec3f(1. - b - c, b, c);
}
fn fogTint(p:vec3f)->vec3f {
  let z = zones(p);
  return FOGC * z.x + vec3f(.09, .31, .29) * z.y + vec3f(.32, .36, .37) * z.z;
}
fn skyColor(rd:vec3f)->vec3f {
  let s = sat(dot(rd, u.sun.xyz)); let y = sat(rd.y);
  var c = mix(vec3f(.33, .55, .55), vec3f(.1, .28, .37), pow(y, .62));
  c += vec3f(1., .68, .34) * (pow(s, 5.) * .13 + pow(s, 42.) * .5) + SUNC * pow(s, 900.) * 2.;
  return c;
}
fn applyFog(col:vec3f, p:vec3f, rd:vec3f, dist:f32)->vec3f {
  let k = .055; let cy = u.cam.y; let dy = p.y - cy;
  var hf = exp(-k * max(cy, -2.));
  if (abs(dy) > .01) { hf = (exp(-k * max(cy, -2.)) - exp(-k * max(p.y, -2.))) / (k * dy); }
  let a = 1. - exp(-dist * .0105 * clamp(hf, .1, 1.5));
  let s = pow(sat(dot(rd, u.sun.xyz)), 7.);
  return mix(col, fogTint(p) + vec3f(1., .66, .34) * s * .16, a);
}
fn shadow(p:vec3f, n:vec3f, bias:f32)->f32 {
  let q = u.svp * vec4f(p + n * bias, 1.);
  let uv = q.xy * vec2f(.5, -.5) + .5;
  let t = 1.15 / f32(textureDimensions(shT).x); let z = q.z - .00035;
  return (textureSampleCompareLevel(shT, shS, uv + vec2f(-t, -.4 * t), z) + textureSampleCompareLevel(shT, shS, uv + vec2f(t, .4 * t), z)
    + textureSampleCompareLevel(shT, shS, uv + vec2f(-.4 * t, t), z) + textureSampleCompareLevel(shT, shS, uv + vec2f(.4 * t, -t), z)) * .25;
}
fn shadow1(p:vec3f, n:vec3f, bias:f32)->f32 {
  let q = u.svp * vec4f(p + n * bias, 1.);
  return textureSampleCompareLevel(shT, shS, q.xy * vec2f(.5, -.5) + .5, q.z - .00035);
}
fn giAt(p:vec3f)->vec2f {
  let q = (p + vec3f(80., 10., 80.)) / vec3f(160., 50., 160.);
  return textureSampleLevel(giT, lin, q.xzy, 0.).rg;
}
fn shaftPool(p:vec3f)->f32 {
  let d = length(p.xz - vec2f(0., 33.));
  return (1. - smoothstep(1.6, 6.6, d));
}
fn ign(f:vec2f)->f32 { return fract(52.9829189 * fract(dot(f, vec2f(.06711056, .00583715)))); }
`;

// moss shared by the lit surface and the fur shells, so both agree on where it grows
const WGSL_MOSS = /*wgsl*/`
fn mossTint(p:vec3f)->vec3f {
  let z = zones(p);
  return vec3f(.105, .245, .06) * z.x + vec3f(.055, .205, .082) * z.y + vec3f(.13, .245, .075) * z.z;
}
fn mossCover(p:vec3f, ny:f32, mi:u32, dx:vec3f, dy:vec3f)->f32 {
  let a = textureSampleGrad(noiseT, lin, p.xz * .037, dx.xz * .037, dy.xz * .037).a;
  let b = textureSampleGrad(noiseT, lin, p.xz * .19, dx.xz * .19, dy.xz * .19).r;
  let c = textureSampleGrad(detailT, lin, p.xz * .65, dx.xz * .65, dy.xz * .65);
  let m = smoothstep(.34, .64, c.a * .65 + a * .55);
  if (mi == 0u) {
    let shore = smoothstep(.04, .42, p.y + (b - .5) * .18);
    return smoothstep(.32, .68, smoothstep(.62, .9, ny) * shore * (.45 + .55 * m) + (c.b - .5) * .3);
  }
  return smoothstep(.48, .74, ny * .4 + (c.a - .45) * .55 + m * .42) * smoothstep(-.1, .25, p.y) * smoothstep(.3, .65, ny);
}
// x: cushion height, y: strand
fn mossPile(p:vec3f, dx:vec3f, dy:vec3f)->vec2f {
  let cu = textureSampleGrad(detailT, lin, p.xz * 1.6, dx.xz * 1.6, dy.xz * 1.6).b;
  let st = textureSampleGrad(noiseT, lin, p.xz * 2.1, dx.xz * 2.1, dy.xz * 2.1).b;
  return vec2f(smoothstep(.22, .82, cu), st);
}
// lay: 0 at the dark roots of the moss, 1 at the sunlit strand tips
fn mossAlb(p:vec3f, k:f32, lay:f32)->vec3f {
  let t = mossTint(p);
  let c = mix(t * .4, t * 1.08 + vec3f(0., .012, .006), lay);
  return mix(c, c * vec3f(1.28, 1.08, .55), smoothstep(.55, .9, k) * .5);
}
fn mossShade(alb:vec3f, n:vec3f, rd:vec3f, l:vec3f, sh:f32, g:vec2f, lay:f32, z:vec3f)->vec3f {
  let wrap = sat((dot(n, l) + .25) / 1.25);
  let vis = pow(g.r, 1.22);
  let hemi = mix(vec3f(.075, .115, .085), SKYC * 1.08, n.y * .5 + .5);
  var c = alb * (SUNC * wrap * sh * (.32 + .34 * lay) + (hemi * (.2 + z.y * .34 + 1.72 * vis) + vec3f(.5, .38, .2) * g.g * .95) * (.4 + .6 * lay));
  // light glows through the strand tips against the sun; a soft velvet sheen at grazing angles
  c += alb * vec3f(.9, 1.1, .5) * SUNC * pow(sat(dot(rd, l)), 4.) * sh * lay * .16;
  c += hemi * vec3f(.6, .8, .5) * pow(1. - abs(dot(n, rd)), 5.) * .28 * lay * (.4 + .6 * vis);
  return c;
}
`;

const WGSL_WORLD = WGSL_COMMON + WGSL_MOSS + /*wgsl*/`
override SHELLS:f32 = 0.;
struct VI { @location(0) p:vec3f, @location(1) n:vec3f, @location(2) uv:vec2f, @location(3) mt:f32 };
struct VO { @builtin(position) pos:vec4f, @location(0) p:vec3f, @location(1) n:vec3f, @location(2) uv:vec2f, @location(3) @interpolate(flat) mt:f32 };
@vertex fn vs(v:VI)->VO {
  var o:VO; o.pos = u.vp * vec4f(v.p, 1.); o.p = v.p; o.n = v.n; o.uv = v.uv; o.mt = v.mt; return o;
}
struct TP { h:f32, c:f32, n:vec3f };
// triplanar detail; projections with negligible weight are skipped
fn triD(p:vec3f, w:vec3f, s:f32, dx:vec3f, dy:vec3f)->TP {
  var o:TP; o.h = 0.; o.c = 0.; o.n = vec3f(0.);
  if (w.x > 0.) { let t = textureSampleGrad(detailT, lin, p.zy * s, dx.zy * s, dy.zy * s); let a = t.rg * 2. - 1.; o.h += t.b * w.x; o.c += t.a * w.x; o.n += vec3f(0., a.y, a.x) * w.x; }
  if (w.y > 0.) { let t = textureSampleGrad(detailT, lin, p.xz * s, dx.xz * s, dy.xz * s); let a = t.rg * 2. - 1.; o.h += t.b * w.y; o.c += t.a * w.y; o.n += vec3f(a.x, 0., a.y) * w.y; }
  if (w.z > 0.) { let t = textureSampleGrad(detailT, lin, p.xy * s, dx.xy * s, dy.xy * s); let a = t.rg * 2. - 1.; o.h += t.b * w.z; o.c += t.a * w.z; o.n += vec3f(a.x, a.y, 0.) * w.z; }
  return o;
}
fn triN(p:vec3f, w:vec3f, s:f32, dx:vec3f, dy:vec3f)->vec4f {
  var r = vec4f(0.);
  if (w.x > 0.) { r += textureSampleGrad(noiseT, lin, p.zy * s, dx.zy * s, dy.zy * s) * w.x; }
  if (w.y > 0.) { r += textureSampleGrad(noiseT, lin, p.xz * s, dx.xz * s, dy.xz * s) * w.y; }
  if (w.z > 0.) { r += textureSampleGrad(noiseT, lin, p.xy * s, dx.xy * s, dy.xy * s) * w.z; }
  return r;
}
fn sg(t:texture_2d<f32>, uv:vec2f, s:vec2f, du:vec2f, dv:vec2f)->vec4f { return textureSampleGrad(t, lin, uv * s, du * s, dv * s); }
@fragment fn fs(v:VO)->@location(0) vec4f {
  if (u.misc.x > .5 && v.p.y < 0.) { discard; }
  let refl = u.misc.x > .5;
  let n0 = normalize(v.n);
  let mi = u32(round(v.mt)); let tv = (v.mt - round(v.mt)) / .8 + .5;
  let dx = dpdx(v.p); let dy = dpdy(v.p); let du = dpdx(v.uv); let dv = dpdy(v.uv);
  let dist = length(v.p - u.cam.xyz);
  let fine = select(1. - smoothstep(5., 36., dist), 0., refl);
  let z = zones(v.p);
  var w = pow(abs(n0), vec3f(5.)); w /= w.x + w.y + w.z; w = max(w - .04, vec3f(0.)); w /= w.x + w.y + w.z;
  var alb = vec3f(.1); var rough = .85; var nrm = vec3f(0.); var bumpA = 1.; var cav = 1.; var ambT = vec3f(1.); var moss = 0.; var mossN = .35;
  if (mi == 0u || mi == 3u) {
    let A = triD(v.p, w, .14, dx, dy); let B = triD(v.p, w, .65, dx, dy);
    var Cn = vec3f(0.); var Ch = .5;
    if (fine > 0.) { let C = triD(v.p, w, 2.4, dx, dy); Cn = C.n * fine; Ch = mix(.5, C.h, fine); }
    let hgt = A.h * .5 + B.h * .35 + Ch * .15;
    nrm = A.n * .9 + B.n * .7 + Cn * .45;
    cav = smoothstep(.06, .5, hgt);
    moss = mossCover(v.p, n0.y, mi, dx, dy);
    if (mi == 0u) {
      let slope = smoothstep(.62, .9, n0.y);
      let soil = mix(vec3f(.075, .052, .034), vec3f(.15, .105, .065), B.h);
      let rock = mix(vec3f(.07, .09, .085), vec3f(.24, .23, .19), sat(A.c * 1.4)) * (.4 + .95 * hgt);
      let wet = 1. - smoothstep(-.04, .2, v.p.y);
      alb = mix(rock, soil, slope) * mix(1., .45, wet);
      bumpA = 1.35; rough = mix(.88, .42, wet);
    } else {
      let crack = smoothstep(.05, .16, triN(v.p, w, .19, dx, dy).g);
      let wet = 1. - smoothstep(.0, .55, v.p.y);
      alb = mix(vec3f(.13, .14, .13), vec3f(.31, .3, .26), sat(A.c * 1.2)) * (.55 + .75 * hgt) * mix(.55, 1., crack) * mix(1., .55, wet);
      ambT = vec3f(1.45, 1.38, 1.26); bumpA = 1.15; rough = mix(.8, .35, wet);
    }
  } else if (mi == 1u || mi == 2u) {
    // long furrowed plates, pale lichen on the plates, moss climbing from the ground and over the tops
    let bA = sg(barkT, v.uv, vec2f(1., .5), du, dv);
    let bB = sg(barkT, v.uv + .37, vec2f(2.3, 1.15), du, dv);
    let nz = sg(noiseT, v.uv, vec2f(.23, .09), du, dv);
    let bh = bA.b * .68 + bB.b * .32;
    let plate = smoothstep(.2, .55, bh);
    var bark = mix(vec3f(.15, .125, .125), vec3f(.17, .115, .105), tv) * mix(.82, 1.18, nz.r) * (.3 + .95 * plate) * (.85 + .3 * bB.a);
    bark = mix(bark, vec3f(.1, .055, .04), (1. - smoothstep(.25, .5, bA.b)) * .5);
    rough = mix(.88, .5, plate * (1. - tv * .4));
    let lich = smoothstep(.6, .8, nz.a * .7 + bA.a * .45 + tv * .12) * plate;
    alb = mix(bark, vec3f(.34, .38, .32) * (.75 + .3 * bB.b), lich * .65);
    let a1 = cross(dy, n0); let b1 = cross(n0, dx); let sgn = sign(dot(dx, a1));
    let T = normalize((a1 * du.x + b1 * dv.x) * sgn + vec3f(1e-7)); let Bt = normalize((a1 * du.y + b1 * dv.y) * sgn + vec3f(1e-7));
    let sl = (bA.rg * 2. - 1.) * .95 + (bB.rg * 2. - 1.) * .55 * fine;
    nrm = T * sl.x + Bt * sl.y;
    let gy = textureSampleLevel(hT, lin, (v.p.xz + 80.) / 160., 0.).r;
    let low = 1. - smoothstep(.3, 2.2 + tv * 2.2, v.p.y - gy + (nz.b - .5) * 1.4);
    let away = sat(-dot(n0.xz, normalize(u.sun.xz)) * .8 + .25);
    var mm = smoothstep(.3, .75, n0.y + (nz.g - .45) * .6) * (.4 + .6 * smoothstep(.3, .7, nz.a));
    mm = max(mm, low * (.5 + .5 * away));
    if (mi == 2u) { mm = max(mm, smoothstep(.35, .8, n0.y * .6 + nz.a * .45)); }
    moss = smoothstep(.25, .7, mm + (bB.b - .5) * .35) * mix(.7, 1., tv);
    ambT = vec3f(1.25, 1., .8); bumpA = 1.7; cav = smoothstep(.06, .5, bh); mossN = .2;
  } else {
    alb = vec3f(.2, .13, .04); bumpA = 0.;
  }
  let n = normalize(n0 + nrm * bumpA * (1. - moss * .6));
  let rd = normalize(v.p - u.cam.xyz); let l = u.sun.xyz;
  var sh = 0.;
  if (refl) { sh = shadow1(v.p, n0, .1); } else { sh = shadow(v.p, n0, .1); }
  let g = giAt(v.p + n0 * .7);
  let vis = pow(g.r, 1.22);
  let hemi = mix(vec3f(.075, .115, .085), SKYC * 1.08, n.y * .5 + .5);
  var col = alb * (SUNC * sat(dot(n, l)) * sh + (hemi * (.2 + z.y * .34 + 1.72 * vis) + vec3f(.5, .38, .2) * g.g * .95) * ambT * (.35 + .65 * cav));
  let hv = normalize(l - rd);
  col += SUNC * sh * pow(sat(dot(n, hv)), mix(90., 12., rough)) * (.05 + .95 * pow(1. - sat(dot(hv, -rd)), 5.)) * .22 * (1. - rough * .55) * (1. - moss);
  var albF = alb;
  if (moss > 0.) {
    // under the fur shells the surface is the dark floor of the moss; beyond them it stands in for the whole pile
    let shell = select(0., 1. - smoothstep(14., 24., dist), SHELLS > 0. && !refl && (mi == 0u || mi == 3u));
    let lay = mix(.62, .1, shell);
    let k = textureSampleGrad(noiseT, lin, v.p.xz * .11, dx.xz * .11, dy.xz * .11).r;
    let ma = mossAlb(v.p, k, lay);
    col = mix(col, mossShade(ma, normalize(n0 + nrm * mossN), rd, l, sh, g, lay, z), moss);
    albF = mix(alb, ma, moss);
  }
  let pool = shaftPool(v.p) * (1. - smoothstep(3., 12., v.p.y));
  col += albF * vec3f(3.4, 2.5, 1.3) * pool * smoothstep(.35, .9, n.y);
  if (mi == 4u) {
    col += vec3f(3.5, 2.1, .72) * (.8 + .2 * sin(u.cam.w * 1.4));
  } else if (mi == 3u) {
    let gc = vec3f(3.8, 2.3, .85);
    let dl = distance(v.p, vec3f(.8, 1.8, 2.34));
    col += albF * gc * sat(dot(n, normalize(vec3f(.8, 1.8, 2.34) - v.p)) * .8 + .2) / (1. + dl * dl * 1.2);
  }
  return vec4f(applyFog(col, v.p, rd, dist), 1.);
}
`;

// fur shells: offset copies of the terrain and stones, kept only where moss strands reach that high
const WGSL_SHELL = WGSL_COMMON + WGSL_MOSS + /*wgsl*/`
override NSH:f32 = 12.;
struct VI { @location(0) p:vec3f, @location(1) n:vec3f, @location(2) uv:vec2f, @location(3) mt:f32 };
struct SO { @builtin(position) pos:vec4f, @location(0) p:vec3f, @location(1) b:vec3f, @location(2) n:vec3f, @location(3) @interpolate(flat) k:vec2f };
@vertex fn vs(v:VI, @builtin(instance_index) ii:u32)->SO {
  var o:SO;
  let mi = u32(round(v.mt)); let lay = (f32(ii) + 1.) / NSH;
  o.k = vec2f(lay, f32(mi));
  if (mi != 0u && mi != 3u) { o.pos = vec4f(0., 0., -1., 1.); return o; }
  let p = v.p + v.n * select(.075, .045, mi == 3u) * lay;
  o.pos = u.vp * vec4f(p, 1.); o.p = p; o.b = v.p; o.n = v.n;
  return o;
}
@fragment fn fs(v:SO)->@location(0) vec4f {
  let lay = v.k.x; let mi = u32(v.k.y + .5);
  let dx = dpdx(v.b); let dy = dpdy(v.b);
  let dist = length(v.p - u.cam.xyz);
  if (lay > 1.04 - smoothstep(12., 24., dist) || v.b.y < -.05) { discard; }
  let n0 = normalize(v.n);
  let cov = mossCover(v.b, n0.y, mi, dx, dy);
  let pile = mossPile(v.b, dx, dy);
  let H = cov * (.3 + .7 * pile.x) * (.35 + .85 * pile.y);
  let a = sat((H - lay) * 16. + .5);
  if (a < .02) { discard; }
  let tip = sat(lay / max(H, .05));
  let rd = normalize(v.p - u.cam.xyz); let l = u.sun.xyz;
  let k = textureSampleGrad(noiseT, lin, v.b.xz * .11, dx.xz * .11, dy.xz * .11).r;
  let col = mossShade(mossAlb(v.b, k, tip), n0, rd, l, shadow1(v.p, n0, .1), giAt(v.b + n0 * .7), tip, zones(v.b));
  return vec4f(applyFog(col, v.p, rd, dist), a);
}
`;

const WGSL_LEAF = WGSL_COMMON + /*wgsl*/`
override CUT:f32 = .5;
struct LI { @location(0) p:vec4f, @location(1) n:vec4f, @location(2) t:vec4f, @location(3) c:vec4f, @builtin(vertex_index) vi:u32 };
struct LO { @builtin(position) pos:vec4f, @location(0) p:vec3f, @location(1) n:vec3f, @location(2) uv:vec2f, @location(3) col:vec3f, @location(4) @interpolate(flat) cell:vec2f, @location(5) @interpolate(flat) ao:f32 };
const Q = array<vec2f,6>(vec2f(-1,-1), vec2f(1,-1), vec2f(1,1), vec2f(-1,-1), vec2f(1,1), vec2f(-1,1));
@vertex fn vs(v:LI)->LO {
  var o:LO;
  let q = Q[v.vi]; let n = v.n.xyz; var t = normalize(v.t.xyz - n * dot(v.t.xyz, n)); let s = v.p.w;
  let k = u32(round(v.c.a * 255.));
  let bl = k == 1u;
  var pn = n;
  if (bl) {
    pn = normalize(mix(n, normalize(u.cam.xyz - v.p.xyz), .8));
    let tt = t - pn * dot(t, pn);
    t = select(normalize(cross(pn, vec3f(0., 1., 0.)) + vec3f(1e-4, 0., 0.)), normalize(tt), length(tt) > .15);
  }
  let b = cross(pn, t);
  let time = u.cam.w * u.misc.y; let ph = v.n.w * 6.28 + v.p.x * .17 + v.p.z * .13;
  let amp = sat((v.p.y - .3) * .08) * .13 + .012;
  let wind = vec3f(sin(time * .9 + ph), sin(time * 1.3 + ph * 1.7) * .4, cos(time * .72 + ph * 1.2)) * amp;
  let bend = select(-(q.x * q.x) * .2 * s, 0., bl);
  let fy = q.y * .5 + .5;
  let arch = select(0., (fy * (1. - fy) * 1.1 - fy * fy * .8) * s, k == 2u);
  let p = v.p.xyz + t * q.x * s + b * q.y * s + pn * bend + vec3f(0., arch, 0.) + wind;
  o.pos = u.vp * vec4f(p, 1.); o.p = p; o.n = normalize(n + t * q.x * select(.42, .22, bl));
  o.uv = q * .5 + .5; o.col = v.c.rgb * v.c.rgb;
  o.cell = vec2f(f32(k & 1u), f32(k >> 1u)); o.ao = v.t.w * .5 + .5;
  return o;
}
@fragment fn fs(v:LO, @builtin(front_facing) ff:bool)->@location(0) vec4f {
  if (u.misc.x > .5 && v.p.y < 0.) { discard; }
  let tx = textureSample(atlasT, lin, (v.cell + v.uv * .996 + .002) * .5);
  let aw = max(fwidth(tx.a), .0001);
  let cov = sat((tx.a - CUT) / aw + .5);
  if (cov < .02) { discard; }
  var n = normalize(v.n); if (!ff) { n = -n; }
  let rd = normalize(v.p - u.cam.xyz); let l = u.sun.xyz;
  let sh = shadow1(v.p, normalize(v.n), .34);
  let g = giAt(v.p + vec3f(0., .95, 0.));
  var alb = v.col * (.46 + tx.r * .72);
  let wrap = sat((dot(n, l) + .45) / 1.45);
  var col:vec3f;
  if (v.cell.y < .5) {
    alb = mix(v.col, v.col * vec3f(.9, .5, .64), tx.b * .8) * (.84 + (tx.r - .7) * .42);
    let vis = sat(g.r);
    let multi = vis / max(vec3f(1.) - alb * (1. - vis), vec3f(.08));
    let shade = mix(vec3f(.3, .25, .31), vec3f(.62, .66, .74), n.y * .5 + .5);
    let key = SUNC * vec3f(.9, 1., 1.28);
    let through = pow(sat(dot(rd, l)), 2.5) * 1.25 + sat(dot(-n, l)) * .5;
    let ao = mix(.38, 1., v.ao);
    col = alb * (key * wrap * sh * .36 * mix(.55, 1., v.ao) + shade * (.42 + 1.25 * multi) * ao + vec3f(.46, .4, .34) * g.g * .55 * ao);
    col += pow(alb, vec3f(1.7)) * key * through * sh * .3 * mix(.6, 1., v.ao);
  } else {
    let back = pow(sat(dot(rd, l)), 3.) * 1.8 + sat(dot(-n, l)) * .62 + .16;
    let trans = (v.col * .85 + vec3f(.05, .03, .01)) * (.55 + tx.g * .45);
    let hemi = mix(vec3f(.07, .11, .08), SKYC, n.y * .5 + .5);
    col = alb * (SUNC * wrap * sh * .62 + hemi * (.2 + 1.55 * pow(g.r, 1.12)) + vec3f(.48, .36, .2) * g.g * .7);
    col += trans * SUNC * back * sh * .32;
    col += v.col * vec3f(.42, .25, .3) * (.24 + .8 * g.r);
  }
  let pool = shaftPool(v.p) * (1. - smoothstep(4., 15., v.p.y));
  col += alb * vec3f(2.4, 1.8, 1.) * pool;
  return vec4f(applyFog(col, v.p, rd, length(v.p - u.cam.xyz)), cov);
}
`;

const WGSL_SHADOW = WGSL_U + /*wgsl*/`
@group(0) @binding(0) var<uniform> u:U;
@group(0) @binding(1) var lin:sampler;
@group(0) @binding(2) var atlasT:texture_2d<f32>;
@vertex fn vsWorld(@location(0) p:vec3f)->@builtin(position) vec4f { return u.svp * vec4f(p, 1.); }
const Q = array<vec2f,6>(vec2f(-1,-1), vec2f(1,-1), vec2f(1,1), vec2f(-1,-1), vec2f(1,1), vec2f(-1,1));
struct LO { @builtin(position) pos:vec4f, @location(0) uv:vec2f, @location(1) @interpolate(flat) cell:vec2f };
@vertex fn vsLeaf(@location(0) a:vec4f, @location(1) n:vec4f, @location(2) t0:vec4f, @location(3) c:vec4f, @builtin(vertex_index) vi:u32)->LO {
  var o:LO; let q = Q[vi]; let t = normalize(t0.xyz - n.xyz * dot(t0.xyz, n.xyz)); let b = cross(n.xyz, t);
  o.pos = u.svp * vec4f(a.xyz + t * q.x * a.w + b * q.y * a.w, 1.);
  o.uv = q * .5 + .5; let k = u32(round(c.a * 255.)); o.cell = vec2f(f32(k & 1u), f32(k >> 1u));
  return o;
}
@fragment fn fsLeaf(v:LO) {
  if (textureSampleLevel(atlasT, lin, (v.cell + v.uv * .996 + .002) * .5, 1.).a < .5) { discard; }
}
`;

const WGSL_SKY_FN = /*wgsl*/`
fn h1(x:f32)->f32 { return fract(sin(x * 127.1 + 3.7) * 43758.5453); }
// domain-repeated giant tree silhouette; negative inside
fn forestLayer(uu:f32, y:f32, seed:f32, top:f32)->f32 {
  let id = floor(uu); let f = fract(uu);
  var d = y - (top * .07 + sin(uu * .37 + seed) * top * .025);
  for (var i = -1; i <= 1; i++) {
    let c = id + f32(i); let a = h1(c + seed); let b = h1(c * 1.7 + seed + 9.); let e = h1(c * 2.3 + seed + 4.);
    let cx = f32(i) + .22 + a * .56 - f; let ht = top * (.72 + b * .4);
    let tw = .1 + e * .06 + .09 * exp(-max(y, 0.) / (top * .07));
    d = min(d, max(abs(cx) - tw, y - ht * .6));
    for (var k = 0; k < 4; k++) {
      let kf = f32(k); let o = h1(c + kf * 3.1 + seed) - .5; let r = (.4 + .2 * h1(c + kf * 5.3 + seed)) * (1. - kf * .14);
      let dy = (y - ht * (.6 + kf * .11)) / (top * .2);
      let cd = length(vec2f(cx + o * .7, dy)) * .92 - r + sin((cx + dy) * 11. + kf) * .024 + sin((cx - dy) * 23. + kf * 2.) * .012; let hk = clamp(.5 + .5 * (d - cd) / .14, 0., 1.); d = mix(d, cd, hk) - .14 * hk * (1. - hk);
    }
  }
  return d;
}
fn farForest(ro:vec3f, rd:vec3f, base:vec3f)->vec3f {
  var col = base;
  let px = 1.6 / u.res.y;
  let rl = max(length(rd.xz), .0001); let dir = rd.xz / rl; let oc = ro.xz;
  for (var i = 4; i >= 0; i--) {
    let fi = f32(i); let R = 66. * pow(1.68, fi);
    let bq = dot(oc, dir); let cq = dot(oc, oc) - R * R; let tt = (-bq + sqrt(max(bq * bq - cq, 0.)));
    let t = tt / rl; let p = ro + rd * t;
    let th = atan2(p.x, p.z);
    let spacing = 6.8 + fi * 5.5; let cells = round(6.2831853 * R / spacing);
    let uu = (th / 6.2831853 + .5) * cells;
    let top = 24. + fi * 8.;
    let nuv = vec2f(uu / cells * ceil(cells * .22), (p.y + 1.) / top * 1.8 + fi * .37);
    let nz = textureSampleLevel(noiseT, lin, nuv, 1.).r;
    let band = abs(p.y + 1. - top * .7) / (top * .18) - .82 - (nz - .5) * .7;
    let d = min(forestLayer(uu, p.y + 1., fi * 13.7 + 2., top), band);
    let aa = max(px * t / spacing * 1.2, .012 + fi * .022);
    let cover = (1. - smoothstep(-aa, aa, d));
    if (cover > .001) {
      let lit = .62 + .38 * sat(d * -3.);
      let crown = smoothstep(top * .36, top * .48, p.y + 1.);
      let sg = pow(sat(dot(rd, u.sun.xyz)), 3.);
      let leafC = vec3f(.97, .62, .72) * (.34 + .5 * nz + .26 * smoothstep(top * .62, top, p.y + 1.) + sg * .35);
      let tree = mix(mix(vec3f(.018, .06, .052), vec3f(.04, .12, .09), lit), leafC, crown);
      let s = pow(sat(dot(rd, u.sun.xyz)), 7.);
      let fog = fogTint(p * vec3f(.28, 1., .28)) + vec3f(1., .66, .34) * s * .16;
      let a = 1. - exp(-(t + fi * 22.) * .0165);
      col = mix(col, mix(tree, fog, min(1., a * (1. - crown * .3) + (1. - crown) * (1. - smoothstep(0., top * .32, p.y + 1.)) * .3)), cover);
    }
  }
  return col;
}
`;

const WGSL_SKY = WGSL_COMMON + WGSL_SKY_FN + /*wgsl*/`
struct FV { @builtin(position) pos:vec4f, @location(0) ndc:vec2f };
@vertex fn vs(@builtin(vertex_index) i:u32)->FV {
  let p = array<vec2f,3>(vec2f(-1,-3), vec2f(3,1), vec2f(-1,1))[i];
  var o:FV; o.pos = vec4f(p, 0., 1.); o.ndc = p; return o;
}
@fragment fn fs(v:FV)->@location(0) vec4f {
  let q = u.ivp * vec4f(v.ndc, .001, 1.);
  let rd = normalize(q.xyz / q.w - u.cam.xyz);
  var c = skyColor(rd);
  let mist = (1. - smoothstep(-.06, .34, rd.y));
  let s = pow(sat(dot(rd, u.sun.xyz)), 7.);
  c = mix(c, FOGC * 1.04 + vec3f(1., .66, .34) * s * .16, mist * .92);
  return vec4f(farForest(u.cam.xyz, rd, c), 1.);
}
`;

const WGSL_WATER = WGSL_COMMON + /*wgsl*/`
@group(1) @binding(0) var reflT:texture_2d<f32>;
struct VO { @builtin(position) pos:vec4f, @location(0) p:vec3f };
@vertex fn vs(@builtin(vertex_index) i:u32)->VO {
  let q = array<vec2f,6>(vec2f(-64,-64), vec2f(64,-64), vec2f(64,64), vec2f(-64,-64), vec2f(64,64), vec2f(-64,64))[i];
  var o:VO; o.p = vec3f(q.x, 0., q.y); o.pos = u.vp * vec4f(o.p, 1.); return o;
}
fn waves(p:vec2f, t:f32)->vec2f {
  var g = vec2f(0.);
  for (var i = 0; i < 10; i++) {
    let fi = f32(i); let an = fi * 2.399 + .4; let d = vec2f(cos(an), sin(an));
    let k = 1.05 * pow(1.34, fi); let ph = dot(d, p) * k + t * sqrt(9.8 * k) * .42 + fi * 1.7;
    g += d * k * cos(ph) * (.0034 / (1. + fi * fi * .34));
  }
  return g;
}
@fragment fn fs(v:VO)->@location(0) vec4f {
  let huv = (v.p.xz + 80.) / .3125 + .5;
  let terr = textureSampleLevel(hT, lin, huv / 513., 0.).r;
  let depth = -terr;
  if (depth <= 0.) { discard; }
  let rd = normalize(v.p - u.cam.xyz); let g = waves(v.p.xz, u.cam.w); let n = normalize(vec3f(-g.x, 1., -g.y));
  let dist = length(v.p - u.cam.xyz);
  let suv = v.pos.xy * u.res.zw + n.xz * clamp(2.4 / dist, .002, .022);
  let rt = u.res.zw * 1.15;
  let refl = textureSampleLevel(reflT, lin, suv, 0.).rgb * .36
    + (textureSampleLevel(reflT, lin, suv + rt, 0.).rgb + textureSampleLevel(reflT, lin, suv - rt, 0.).rgb
    + textureSampleLevel(reflT, lin, suv + rt * vec2f(1., -1.), 0.).rgb + textureSampleLevel(reflT, lin, suv + rt * vec2f(-1., 1.), 0.).rgb) * .16;
  let c = sat(dot(n, -rd)); let fr = mix(.62, 1., .02 + .98 * pow(1. - c, 5.));
  let gi = giAt(v.p + vec3f(0., .7, 0.));
  let deep = mix(vec3f(.018, .075, .07), vec3f(.004, .03, .036), sat(depth * 1.4)) * (.35 + 1.4 * gi.r);
  var col = mix(deep, refl, fr);
  let sh = shadow(v.p, vec3f(0., 1., 0.), .05);
  let hv = normalize(u.sun.xyz - rd);
  col += SUNC * sh * pow(sat(dot(n, hv)), 900.) * 3.2;
  let a = smoothstep(0., .13, depth);
  return vec4f(applyFog(col, v.p, rd, dist * .35), a);
}
`;

const WGSL_SPRITE = WGSL_COMMON + /*wgsl*/`
struct SO { @builtin(position) pos:vec4f, @location(0) q:vec2f, @location(1) col:vec4f, @location(2) y:f32 };
fn hs(x:f32, s:f32)->f32 { return fract(sin(x * 91.17 + s * 37.3) * 43758.5453); }
@vertex fn vs(@builtin(vertex_index) vi:u32, @builtin(instance_index) ii:u32)->SO {
  let q = array<vec2f,6>(vec2f(-1,-1), vec2f(1,-1), vec2f(1,1), vec2f(-1,-1), vec2f(1,1), vec2f(-1,1))[vi];
  let f = f32(ii); let t = u.cam.w; let kind = ii % 5u;
  let a = hs(f, 1.) * 6.2831853; let rad = sqrt(hs(f, 2.)) * 46.;
  var c = vec3f(cos(a) * rad, 0., sin(a) * rad);
  var size = .05; var col = vec4f(0.);
  if (kind < 3u) {
    let rate = .28 + hs(f, 3.) * .24; let H = 15.;
    c.y = H - fract(t * rate / H + hs(f, 4.)) * H;
    c.x += sin(t * .42 + f) * 1.15 + c.y * .22; c.z += cos(t * .35 + f * 1.3) * 1.15;
    size = .021 + hs(f, 5.) * .024;
    let pink = vec3f(.95, .53, .65);
    let base = pink * (.72 + .28 * abs(sin(t * (1. + hs(f, 6.)) + f)));
    let lit = .62 + 1.1 * sat(dot(normalize(vec3f(.0, 1., 0.)), u.sun.xyz));
    col = vec4f(base * lit, 1.);
  } else if (kind == 3u) {
    c.y = .45 + hs(f, 3.) * 3.4 + sin(t * .55 + f) * .42;
    c.x += sin(t * .33 + f * 2.) * 1.2; c.z += cos(t * .29 + f) * 1.2;
    size = .018 + hs(f, 5.) * .016;
    let pulse = pow(.5 + .5 * sin(t * (1.1 + hs(f, 6.)) + f), 3.);
    col = vec4f(vec3f(5.2, 7.4, 1.9) * (.1 + pulse * 2.8), 0.);
  } else {
    let shafted = step(.45, hs(f, 8.));
    if (shafted > .5) { let r2 = sqrt(hs(f, 2.)) * 5.4; c.x = cos(a) * r2; c.z = 33. + sin(a) * r2; }
    c.y = 22. - fract(t * .13 + hs(f, 3.)) * 21.5;
    c.x += sin(t * .24 + f) * .55; c.z += cos(t * .21 + f) * .55;
    size = .011 + hs(f, 5.) * .014;
    col = vec4f(vec3f(7.2, 4.8, 1.8) * (.28 + 1.5 * pow(.5 + .5 * sin(t * 2.3 + f * 3.), 4.)), 0.);
  }
  let rot = t * (hs(f, 9.) - .5) * 2.4 + f;
  let rq = vec2f(q.x * cos(rot) - q.y * sin(rot), q.x * sin(rot) + q.y * cos(rot));
  var w = u.vp * vec4f(c, 1.);
  size *= smoothstep(.9, 4.2, w.w);
  w = vec4f(w.xy + rq * size * u.res.y / u.res.x * vec2f(1., u.res.x / u.res.y) * 1.8, w.z, w.w);
  var o:SO; o.pos = w; o.q = q; o.col = col; o.y = c.y; return o;
}
@fragment fn fs(v:SO)->@location(0) vec4f {
  if (u.misc.x > .5 && v.y < 0.) { discard; }
  let r = length(v.q);
  if (v.col.a > .5) {
    let a = (1. - smoothstep(.72, 1., length(v.q * vec2f(1.65, 1.))));
    return vec4f(v.col.rgb * a, a);
  }
  let g = pow(sat(1. - r), 2.6);
  return vec4f(v.col.rgb * g, 0.);
}
`;

const WGSL_FS = /*wgsl*/`
struct FV { @builtin(position) pos:vec4f, @location(0) uv:vec2f };
@vertex fn vs(@builtin(vertex_index) i:u32)->FV {
  let p = array<vec2f,3>(vec2f(-1,-3), vec2f(3,1), vec2f(-1,1))[i];
  var o:FV; o.pos = vec4f(p, 0., 1.); o.uv = p * vec2f(.5, -.5) + .5; return o;
}
`;

// tileable R fbm, G cell edges, B fine grain, A clumps
const WGSL_GEN_NOISE = WGSL_FS + /*wgsl*/`
fn wrapv(p:vec2f, n:f32)->vec2f { return p - floor(p / n) * n; }
fn h22(p:vec2f)->vec2f {
  var q = fract(vec3f(p.xyx) * vec3f(.1031, .1030, .0973)); q += dot(q, q.yzx + 33.33);
  return fract((q.xx + q.yz) * q.zy);
}
fn vn(p:vec2f, n:f32)->f32 {
  let i = floor(p); let f = fract(p); let w = f * f * (3. - 2. * f);
  let a = h22(wrapv(i, n)).x; let b = h22(wrapv(i + vec2f(1, 0), n)).x; let c = h22(wrapv(i + vec2f(0, 1), n)).x; let d = h22(wrapv(i + vec2f(1, 1), n)).x;
  return mix(mix(a, b, w.x), mix(c, d, w.x), w.y);
}
fn pf(p:vec2f, base:f32, oct:i32)->f32 {
  var s = 0.; var a = .5; var n = base; var t = 0.;
  for (var i = 0; i < oct; i++) { s += a * vn(p * n + f32(i) * 17., n); t += a; a *= .55; n *= 2.; }
  return s / t;
}
fn cellEdge(p:vec2f, n:f32)->f32 {
  let q = p * n; let i = floor(q); let f = fract(q);
  var d1 = 9.; var d2 = 9.;
  for (var y = -1; y <= 1; y++) { for (var x = -1; x <= 1; x++) {
    let g = vec2f(f32(x), f32(y)); let o = h22(wrapv(i + g, n)); let d = length(g + o - f);
    if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) { d2 = d; }
  } }
  return sat2(d2 - d1);
}
fn sat2(x:f32)->f32 { return clamp(x, 0., 1.); }
@fragment fn fs(v:FV)->@location(0) vec4f {
  let w = vec2f(pf(v.uv, 7., 3), pf(v.uv + .37, 7., 3)) - .5;
  let r = pf(v.uv, 6., 7);
  let g = sat2(cellEdge(v.uv + w * .025, 14.) * .55 + cellEdge(v.uv - w * .018, 37.) * .45 + .08);
  let b = pf(v.uv + .13, 64., 4);
  let a = sat2((pf(v.uv + .71, 9., 6) - .3) * 2.5);
  return vec4f(sat2((r - .26) * 2.1), g, sat2((b - .24) * 2.), a);
}
`;

// tileable surface detail: RG slope, B height, A large clumps
const WGSL_GEN_DETAIL = WGSL_FS + /*wgsl*/`
fn wrapv(p:vec2f, n:f32)->vec2f { return p - floor(p / n) * n; }
fn h22(p:vec2f)->vec2f {
  var q = fract(vec3f(p.xyx) * vec3f(.1031, .1030, .0973)); q += dot(q, q.yzx + 33.33);
  return fract((q.xx + q.yz) * q.zy);
}
fn vn(p:vec2f, n:f32)->f32 {
  let i = floor(p); let f = fract(p); let w = f * f * (3. - 2. * f);
  let a = h22(wrapv(i, n)).x; let b = h22(wrapv(i + vec2f(1, 0), n)).x; let c = h22(wrapv(i + vec2f(0, 1), n)).x; let d = h22(wrapv(i + vec2f(1, 1), n)).x;
  return mix(mix(a, b, w.x), mix(c, d, w.x), w.y);
}
fn pf(p:vec2f, base:f32, oct:i32)->f32 {
  var s = 0.; var a = .5; var n = base; var t = 0.;
  for (var i = 0; i < oct; i++) { s += a * vn(p * n + f32(i) * 7., n); t += a; a *= .5; n *= 2.; }
  return s / t;
}
fn pits(p:vec2f, n:f32)->f32 {
  let q = p * n; let i = floor(q); let f = fract(q); var d = 9.; var id = 0.;
  for (var y = -1; y <= 1; y++) { for (var x = -1; x <= 1; x++) {
    let g = vec2f(f32(x), f32(y)); let o = h22(wrapv(i + g, n)); let l = length(g + o - f);
    if (l < d) { d = l; id = o.x * .5 + o.y * .5; }
  } }
  return (1. - smoothstep(0., .34, d)) * step(.6, id);
}
fn H(uv:vec2f)->f32 {
  let wq = uv + .09 * (vec2f(pf(uv, 3., 4), pf(uv + .5, 3., 4)) - .5);
  let f = pf(wq, 4., 7);
  let r1 = 1. - abs(pf(wq + .7, 6., 5) * 2. - 1.);
  let cr = min(abs(pf(wq + .41, 5., 4) * 2. - 1.) * 6., 1.);
  return f * .52 + r1 * r1 * .26 + cr * .22 - pits(wq, 24.) * .08;
}
@fragment fn fs(v:FV)->@location(0) vec4f {
  let e = 1. / 1024.; let h = H(v.uv);
  let s = clamp(vec2f(H(v.uv + vec2f(e, 0.)) - h, H(v.uv + vec2f(0., e)) - h) * 1024. * .08, vec2f(-1.), vec2f(1.));
  return vec4f(-s * .5 + .5, h, pf(v.uv + .37, 4., 5));
}
`;

// 2x2 leaf atlas: maple sprig, sakura cluster, fern frond, oval cluster
const WGSL_GEN_ATLAS = WGSL_FS + /*wgsl*/`
fn hh(x:f32)->f32 { return fract(sin(x * 113.1 + 1.3) * 43758.5453); }
fn rot(p:vec2f, a:f32)->vec2f { return vec2f(p.x * cos(a) - p.y * sin(a), p.x * sin(a) + p.y * cos(a)); }
fn mapleLeaf(p0:vec2f)->vec3f {
  let p = p0 + vec2f(0., .12); let a = atan2(p.x, p.y); let r = length(p);
  let lobes = pow(abs(cos(a * 2.5)), .55); let edge = .34 + .66 * lobes;
  let serr = .035 * abs(sin(a * 17.));
  let body = edge * (.92 - .3 * smoothstep(1.7, 3.14, abs(a))) - serr;
  let vein = (1. - smoothstep(.0, .055, abs(fract(a * 5. / 6.2831853 + .5) - .5) * r * 4.));
  return vec3f(body - r, .66 + .3 * r - vein * .28, .55 + vein * .3);
}
fn sakura(p:vec2f)->vec3f {
  let a = atan2(p.x, p.y); let r = length(p); let s = abs(fract(a * 5. / 6.2831853 + .5) - .5) * 2.;
  let petal = .62 + .38 * sqrt(max(1. - s * s, 0.)) - .17 * (1. - smoothstep(.0, .13, s));
  let centre = (1. - smoothstep(.06, .34, r));
  return vec3f(petal - r, .86 - centre * .2 + r * .08, centre);
}
fn oval(p:vec2f)->vec3f {
  let q = vec2f(p.x * 2.05 * (1. + p.y * .32), p.y); let r = length(q);
  let vein = (1. - smoothstep(0., .05, abs(p.x)));
  return vec3f(1. - r, .7 + p.y * .18 - vein * .24, .62 + vein * .3);
}
fn cluster(q:vec2f, kind:i32)->vec2f {
  var best = -9.; var shade = .5; let n = select(9, 8, kind == 0);
  for (var i = 0; i < n; i++) {
    let fi = f32(i); let g = 2.399 * fi; let rad = sqrt((fi + .4) / f32(n)) * .68;
    let c = vec2f(cos(g), sin(g)) * rad + (vec2f(hh(fi), hh(fi + 7.)) - .5) * .16;
    let sc = select(.34, .3, kind == 1) * (.76 + hh(fi + 3.) * .46);
    let pl = rot(q - c, g + hh(fi + 11.) * 2.) / sc;
    var res:vec3f;
    if (kind == 0) { res = mapleLeaf(pl); } else if (kind == 1) { res = sakura(pl); } else { res = oval(pl); }
    let d = res.x * sc;
    if (d > -.012 && (d > best || best < 0.)) { best = max(best, d); shade = res.y * (.72 + hh(fi + 5.) * .42); }
  }
  return vec2f(best, shade);
}
// one fallen petal: egg-shaped, widening to a notched tip
fn petal(q:vec2f)->vec2f {
  let p = rot(q, .5) * vec2f(1.3, 1.05);
  var d = .88 - length(vec2f(p.x * (1.2 - p.y * .3), p.y));
  d = min(d, -((p.y - .6) - abs(p.x) * 1.5) * .6);
  return vec2f(d, .82 + p.y * .12 - (1. - smoothstep(0., .05, abs(p.x))) * .08);
}
fn blossoms(q:vec2f)->vec3f {
  var best = -9.; var shade = .5; var cen = 0.;
  for (var i = 0; i < 30; i++) {
    let fi = f32(i); let g = 2.399 * fi; let rad = sqrt((fi + .5) / 30.) * .7;
    let c = vec2f(cos(g), sin(g)) * rad + (vec2f(hh(fi), hh(fi + 7.)) - .5) * .14;
    let bud = hh(fi + 21.) < .12;
    let sc = select(.19 * (.8 + hh(fi + 3.) * .4), .07, bud);
    let pl = rot(q - c, g + hh(fi + 11.) * 2.) / sc;
    var res:vec3f;
    if (bud) { res = vec3f(1. - length(pl * vec2f(1., .75)), .78, .85); } else { res = sakura(pl); }
    let d = res.x * sc;
    if (d > -.012 && (d > best || best < 0.)) { best = max(best, d); shade = res.y * (.74 + hh(fi + 5.) * .36) * (.86 + .14 * (1. - rad)); cen = res.z; }
  }
  return vec3f(best, shade, cen);
}
fn fern(q:vec2f)->vec2f {
  let y = q.y * .5 + .5;
  let bx = q.x - sin(y * 2.2) * .08 * y;
  let wid = .5 * pow(sin(sqrt(sat3(y)) * 3.14159), 1.1) * (1. - y * .2);
  let rach = .014 * (1. - y) + .004 - abs(bx);
  let along = sat3(abs(bx) / max(wid, .001));
  let row = y * 26. - abs(bx) * 5.5;
  let fr = fract(row) - .5;
  let pw = .36 * (1. - along * .7) * (.82 + .3 * sin(along * 19.));
  let pinna = min((pw - abs(fr)) / 26., wid - abs(bx));
  let d = max(rach, pinna);
  return vec2f(d, .55 + (1. - abs(fr) * 2.) * .28 + along * .12 - (1. - smoothstep(.0, .02, abs(bx))) * .16);
}
fn sat3(x:f32)->f32 { return clamp(x, 0., 1.); }
@fragment fn fs(v:FV)->@location(0) vec4f {
  let cf = floor(v.uv * 2.); let q = (fract(v.uv * 2.) * 2. - 1.) * 1.04; let k = i32(cf.x) + i32(cf.y) * 2;
  var r:vec2f;
  var cen = .8;
  if (k == 2) { r = fern(q); } else if (k == 1) { let b = blossoms(q); r = b.xy; cen = b.z; } else if (k == 0) { r = petal(q); cen = .3 * (1. - smoothstep(-.9, -.4, q.y)); } else { r = cluster(q, 2); }
  let sc = 1024.;
  let a = sat3(r.x * sc * .32 + .5);
  return vec4f(sat3(r.y), sat3(r.y * 1.1), cen, a);
}
`;

const WGSL_GEN_BARK = WGSL_FS + /*wgsl*/`
fn wr(p:vec2f, n:vec2f)->vec2f { return p - floor(p / n) * n; }
fn h22(p:vec2f)->vec2f {
  var q = fract(vec3f(p.xyx) * vec3f(.1031, .1030, .0973)); q += dot(q, q.yzx + 33.33);
  return fract((q.xx + q.yz) * q.zy);
}
fn vn(p:vec2f, n:vec2f)->f32 {
  let i = floor(p); let f = fract(p); let w = f * f * (3. - 2. * f);
  let a = h22(wr(i, n)).x; let b = h22(wr(i + vec2f(1, 0), n)).x; let c = h22(wr(i + vec2f(0, 1), n)).x; let d = h22(wr(i + vec2f(1, 1), n)).x;
  return mix(mix(a, b, w.x), mix(c, d, w.x), w.y);
}
fn fb(p:vec2f, n:vec2f, oct:i32)->f32 {
  var s = 0.; var a = .5; var q = p; var m = n; var t = 0.;
  for (var i = 0; i < oct; i++) { s += a * vn(q + f32(i) * 13., m); t += a; a *= .5; q *= 2.; m *= 2.; }
  return s / t;
}
// cherry bark: smooth grey skin in faint rings, short horizontal lenticels in loose rows, old cracks between
fn H(uv:vec2f)->vec2f {
  let wq = uv + vec2f(0., fb(uv * vec2f(2., 6.), vec2f(2., 6.), 3) - .5) * .025;
  let n = vec2f(14., 40.); let q = wq * n; let i = floor(q); let f = fract(q);
  var dash = 0.;
  for (var y = -1; y <= 1; y++) { for (var x = -1; x <= 1; x++) {
    let g = vec2f(f32(x), f32(y)); let o = h22(wr(i + g, n)); let o2 = h22(wr(i + g, n) + 17.);
    if (o.x < .38) {
      let c = g + vec2f(o2.x, .3 + o2.y * .4) - f;
      let e = max(abs(c.x) / (.5 + o.y * .7), abs(c.y) / (.16 + o2.y * .08));
      dash = max(dash, 1. - smoothstep(.65, 1., e));
    }
  } }
  let ring = fb(wq * vec2f(3., 40.), vec2f(3., 40.), 3);
  let f1 = fb(wq * vec2f(5., 1.5), vec2f(5., 1.5), 4);
  let crack = (1. - smoothstep(0., .07, abs(f1 - .5))) * smoothstep(.45, .7, fb(wq * vec2f(4., 3.) + 7., vec2f(4., 3.), 3));
  let fib = vn(wq * vec2f(150., 5.), vec2f(150., 5.));
  let h = .62 + (ring - .5) * .14 - dash * .3 - crack * .4 + fib * .05;
  return vec2f(sat3(h), fb(uv * vec2f(4., 2.) + 9., vec2f(4., 2.), 4));
}
@fragment fn fs(v:FV)->@location(0) vec4f {
  let e = 1. / 1024.; let h = H(v.uv);
  let s = clamp(vec2f(H(v.uv + vec2f(e, 0.)).x - h.x, H(v.uv + vec2f(0., e)).x - h.x) * 1024. * .035, vec2f(-1.), vec2f(1.));
  return vec4f(-s * .5 + .5, h.x, sat3((h.y - .25) * 2.));
}
fn sat3(x:f32)->f32 { return clamp(x, 0., 1.); }
`;

const WGSL_BLIT = WGSL_FS + /*wgsl*/`
@group(0) @binding(0) var t:texture_2d<f32>;
@group(0) @binding(1) var s:sampler;
@fragment fn fs(v:FV)->@location(0) vec4f { return textureSampleLevel(t, s, v.uv, 0.); }
`;

const WGSL_RAY = (ms) => WGSL_FS + WGSL_U + /*wgsl*/`
@group(0) @binding(0) var<uniform> u:U;
@group(0) @binding(1) var shT:texture_depth_2d;
@group(0) @binding(2) var shS:sampler_comparison;
@group(0) @binding(3) var dT:${ms ? 'texture_depth_multisampled_2d' : 'texture_depth_2d'};
@group(0) @binding(4) var nT:texture_2d<f32>;
@group(0) @binding(5) var lin:sampler;
const STEPS = ${RAY_STEPS};
fn ign(f:vec2f)->f32 { return fract(52.9829189 * fract(dot(f, vec2f(.06711056, .00583715)))); }
@fragment fn fs(v:FV)->@location(0) vec4f {
  let px = vec2i(v.pos.xy * 2.);
  let d = max(textureLoad(dT, px, 0), .00012);
  let ndc = vec2f(v.uv.x * 2. - 1., 1. - v.uv.y * 2.);
  let wp = u.ivp * vec4f(ndc, d, 1.); let p = wp.xyz / wp.w;
  let dv = p - u.cam.xyz; let full = length(dv); let rd = dv / full; let mx = min(full, 92.);
  let dt = mx / f32(STEPS); let j = ign(v.pos.xy + u.misc.z * 5.588238);
  let mu = dot(rd, u.sun.xyz); let g = .62; let hg = (1. - g * g) / pow(1. + g * g - 2. * g * mu, 1.5) * .25;
  var sun = 0.; var shaft = 0.;
  for (var i = 0; i < STEPS; i++) {
    let q = u.cam.xyz + rd * dt * (f32(i) + j);
    let c = u.svp * vec4f(q, 1.); let uv = c.xy * vec2f(.5, -.5) + .5;
    let vis = textureSampleCompareLevel(shT, shS, uv, c.z - .0005);
    let n = textureSampleLevel(nT, lin, (q.xz + q.y * .4) * .018 + u.cam.w * .0035, 0.).r;
    let den = exp(-max(q.y, 0.) * .115) * (.35 + n * 1.2);
    sun += vis * den;
    let sd = length(q.xz - vec2f(sin(q.y * .09) * .55, 33.));
    shaft += (1. - smoothstep(.7, 3.7, sd)) * (.72 + .28 * sin(atan2(q.x, q.z - 33.) * 7. + q.y * .12 + u.cam.w * .1)) * (1. - smoothstep(7., 25., q.y)) * smoothstep(-.2, 1.2, q.y);
  }
  let col = vec3f(1., .69, .36) * (sun * dt * .021 * (min(hg, .55) * 1.5 + .13)) * 1.02 + vec3f(1., .73, .38) * shaft * dt * .05;
  return vec4f(col, 1.);
}
`;

const WGSL_BLUR = WGSL_FS + /*wgsl*/`
@group(0) @binding(0) var t:texture_2d<f32>;
@group(0) @binding(1) var s:sampler;
@group(0) @binding(2) var<uniform> dir:vec4f;
@fragment fn fs(v:FV)->@location(0) vec4f {
  var c = textureSampleLevel(t, s, v.uv, 0.) * .227;
  c += (textureSampleLevel(t, s, v.uv + dir.xy * 1.385, 0.) + textureSampleLevel(t, s, v.uv - dir.xy * 1.385, 0.)) * .316;
  c += (textureSampleLevel(t, s, v.uv + dir.xy * 3.231, 0.) + textureSampleLevel(t, s, v.uv - dir.xy * 3.231, 0.)) * .07;
  return c;
}
`;

const WGSL_COMBINE = WGSL_FS + /*wgsl*/`
@group(0) @binding(0) var a:texture_2d<f32>;
@group(0) @binding(1) var b:texture_2d<f32>;
@group(0) @binding(2) var s:sampler;
@fragment fn fs(v:FV)->@location(0) vec4f {
  return vec4f(textureSampleLevel(a, s, v.uv, 0.).rgb + textureSampleLevel(b, s, v.uv, 0.).rgb, 1.);
}
`;

const WGSL_DOWN = WGSL_FS + /*wgsl*/`
@group(0) @binding(0) var t:texture_2d<f32>;
@group(0) @binding(1) var s:sampler;
@group(0) @binding(2) var<uniform> p:vec4f;
fn L(c:vec3f)->f32 { return 1. / (1. + max(c.r, max(c.g, c.b))); }
fn S(uv:vec2f)->vec3f { return min(textureSampleLevel(t, s, uv, 0.).rgb, vec3f(40.)); }
@fragment fn fs(v:FV)->@location(0) vec4f {
  let d = p.xy;
  let a = S(v.uv + d * vec2f(-1,-1)); let b = S(v.uv + d * vec2f(1,-1)); let c = S(v.uv + d * vec2f(-1,1)); let e = S(v.uv + d * vec2f(1,1));
  let m = S(v.uv); let g = S(v.uv + d * vec2f(-2,0)); let h = S(v.uv + d * vec2f(2,0)); let i = S(v.uv + d * vec2f(0,-2)); let j = S(v.uv + d * vec2f(0,2));
  if (p.z > .5) {
    let w0 = L(a) + L(b) + L(c) + L(e); let w1 = L(m) + L(g) + L(i); let w2 = L(m) + L(h) + L(j);
    let k = (a * L(a) + b * L(b) + c * L(c) + e * L(e)) / w0 * .5 + (m * L(m) + g * L(g) + i * L(i)) / w1 * .25 + (m * L(m) + h * L(h) + j * L(j)) / w2 * .25;
    return vec4f(k, 1.);
  }
  return vec4f((a + b + c + e) * .125 + m * .125 + (g + h + i + j) * .0938, 1.);
}
`;

const WGSL_UP = WGSL_FS + /*wgsl*/`
@group(0) @binding(0) var t:texture_2d<f32>;
@group(0) @binding(1) var s:sampler;
@group(0) @binding(2) var<uniform> p:vec4f;
@fragment fn fs(v:FV)->@location(0) vec4f {
  let d = p.xy;
  var c = textureSampleLevel(t, s, v.uv, 0.).rgb * 4.;
  c += (textureSampleLevel(t, s, v.uv + vec2f(d.x, 0.), 0.).rgb + textureSampleLevel(t, s, v.uv - vec2f(d.x, 0.), 0.).rgb + textureSampleLevel(t, s, v.uv + vec2f(0., d.y), 0.).rgb + textureSampleLevel(t, s, v.uv - vec2f(0., d.y), 0.).rgb) * 2.;
  c += textureSampleLevel(t, s, v.uv + d, 0.).rgb + textureSampleLevel(t, s, v.uv - d, 0.).rgb + textureSampleLevel(t, s, v.uv + d * vec2f(1,-1), 0.).rgb + textureSampleLevel(t, s, v.uv + d * vec2f(-1,1), 0.).rgb;
  return vec4f(c / 16. * p.z, 1.);
}
`;

const WGSL_FINAL = WGSL_FS + /*wgsl*/`
@group(0) @binding(0) var a:texture_2d<f32>;
@group(0) @binding(1) var b:texture_2d<f32>;
@group(0) @binding(2) var s:sampler;
fn aces(x:vec3f)->vec3f {
  let m1 = mat3x3f(.59719,.07600,.02840, .35458,.90834,.13383, .04823,.01566,.83777);
  let m2 = mat3x3f(1.60475,-.10208,-.00327, -.53108,1.10813,-.07276, -.07367,-.00605,1.07602);
  let v = m1 * x;
  return clamp(m2 * ((v * (v + .0245786) - .000090537) / (v * (.983729 * v + .432951) + .238081)), vec3f(0.), vec3f(1.));
}
@fragment fn fs(v:FV)->@location(0) vec4f {
  var c = textureSampleLevel(a, s, v.uv, 0.).rgb;
  c = mix(c, textureSampleLevel(b, s, v.uv, 0.).rgb, .085);
  let q = v.uv - .5;
  c *= 1. - dot(q, q) * .62;
  c = aces(c * 1.04);
  c = pow(c, vec3f(1. / 2.2));
  c = mix(vec3f(dot(c, vec3f(.2126, .7152, .0722))), c, 1.06);
  c = clamp(c, vec3f(0.), vec3f(1.));
  c = mix(c, c * c * (3. - 2. * c), .24);
  let d = fract(52.9829189 * fract(dot(v.pos.xy, vec2f(.06711056, .00583715))));
  return vec4f(c + (d - .5) / 255., 1.);
}
`;
