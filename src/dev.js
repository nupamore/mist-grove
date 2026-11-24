// ============================================================================
// verification hooks (dev.html only)
// ============================================================================
const gpuSamples = [];
onGpuSample = (ms) => { gpuSamples.push(ms); if (gpuSamples.length > 600) gpuSamples.shift(); };
window.__MG = {
  ready: false,
  get frameId() { return frameCounter; },
  get adapterInfo() { return adapterDesc; },
  setPose(i) {
    const k = clamp(i | 0, 0, POSES.length - 1), p = POSES[k];
    tourActive = false; lookAtPose(p); gpuSamples.length = 0;
    return { index: k, pos: p.slice(0, 3), lookAt: p.slice(3) };
  },
  setCam(p) { tourActive = false; lookAtPose(p); gpuSamples.length = 0; },
  // vertices inside a box, grouped by material and contiguous runs (finds which mesh owns a stray shape)
  probe(b) {
    const v = world.vb, runs = [];
    for (let i = 0; i < v.length / 9; i++) {
      const o = i * 9;
      if (v[o] < b[0] || v[o] > b[1] || v[o + 1] < b[2] || v[o + 1] > b[3] || v[o + 2] < b[4] || v[o + 2] > b[5]) continue;
      const r = runs[runs.length - 1];
      if (r && i - r.last < 400 && r.mt === v[o + 8]) { r.last = i; r.n++; } else runs.push({ first: i, last: i, n: 1, mt: v[o + 8], at: [v[o], v[o + 1], v[o + 2]].map((q) => +q.toFixed(2)) });
    }
    return runs.slice(0, 30);
  },
  setSkip(o) { skip = o || {}; gpuSamples.length = 0; },
  setMode(mode) { setMoveMode(mode === 'fly'); return flyMode ? 'fly' : 'walk'; },
  setTime(t) { fixedTime = t; },
  // walks a waypoint route through the real movement code and reports where it ended up
  walkTest(start, route) {
    const wasPlaying = playing, wasFly = flyMode;
    setMoveMode(false); tourActive = false;
    cam.x = start[0]; cam.z = start[1]; cam.y = world.walkH(start[0], start[1], 99) + 1.65; cam.vy = 0; poseHold = false; grounded = true;
    let reached = 0, ticks = 0, maxY = cam.y, minClear = 9;
    input.f = 1;
    for (const [x, z] of route) {
      for (let k = 0; k < 2400 && hypot(cam.x - x, cam.z - z) > 0.7; k++, ticks++) {
        cam.yaw = atan2(x - cam.x, z - cam.z); stepCamera(1 / 60); maxY = max(maxY, cam.y);
        minClear = min(minClear, cam.y - 1.65 - world.walkH(cam.x, cam.z, cam.y - 1.65));
      }
      if (hypot(cam.x - x, cam.z - z) <= 0.7) reached++; else break;
    }
    input.f = 0; const end = [+cam.x.toFixed(2), +cam.y.toFixed(2), +cam.z.toFixed(2)];
    setMoveMode(wasFly); playing = wasPlaying; lookAtPose(POSES[0]);
    return { reached, of: route.length, seconds: +(ticks / 60).toFixed(1), end, maxEye: +maxY.toFixed(2), minClear: +minClear.toFixed(2) };
  },
  // samples the cinematic tour path against trunk colliders and the walkable ground
  tourCheck() {
    let worstGap = 9, worstAt = null, low = 9;
    for (let i = 0; i < tourPts.length - 1; i++) for (let s = 0; s < 4; s++) {
      const q = tourPts[i].map((v, k) => mix(v, tourPts[i + 1][k], s / 4));
      low = min(low, q[1] - world.walkH(q[0], q[2], q[1] - 1.65));
      for (const [px, pz, pr] of world.colliders) {
        const g = hypot(q[0] - px, q[2] - pz) - pr;
        if (g < worstGap) { worstGap = g; worstAt = q.slice(0, 3).map((v) => +v.toFixed(1)); }
      }
    }
    return { worstGap: +worstGap.toFixed(2), worstAt, minEyeAboveGround: +low.toFixed(2) };
  },
  getStats() {
    const s = gpuSamples.slice().sort((a, b) => a - b), n = s.length;
    return {
      width: W, height: H_, lv: LV, hasTS, gpuSamples: n,
      gpuMsAvg: n ? +(s.reduce((a, b) => a + b, 0) / n).toFixed(3) : null,
      gpuMsP99: n ? +s[min(n - 1, floor(n * 0.99))].toFixed(3) : null,
      gpuMsMax: n ? +s[n - 1].toFixed(3) : null,
      drawCounts: { terrainTri: world.terrainIdx / 3, solidTri: world.nTri - world.terrainIdx / 3, leaves: world.nLeaves, sprites: SPRITES },
    };
  },
};
