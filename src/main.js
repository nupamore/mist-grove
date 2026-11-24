// ============================================================================
// WebGPU renderer, input, walk/fly camera, cinematic tour
// ============================================================================
const $ = (id) => document.getElementById(id);
const canvas = $('c'), info = $('i');
const HDR = 'rgba16float', DEPTH = 'depth32float', BLOOM_LEVELS = 6;
const cam = { x: POSES[0][0], y: POSES[0][1], z: POSES[0][2], yaw: 0, pitch: 0, vy: 0 };
const input = { f: 0, b: 0, l: 0, r: 0, u: 0, d: 0, run: 0 };
let flyMode = false, tourActive = false, tourT = 0, hud = false, playing = false, poseHold = true, grounded = true;
let fixedTime = null, sceneTime = 0, frameCounter = 0, gpuMs = 0, cpuFps = 60, W = 0, H_ = 0, adapterDesc = {}, world = null, hasTS = false;
let onGpuSample = null, skip = {};

function lookAtPose(p) {
  cam.x = p[0]; cam.y = p[1]; cam.z = p[2];
  const dx = p[3] - p[0], dy = p[4] - p[1], dz = p[5] - p[2];
  cam.yaw = atan2(dx, dz); cam.pitch = atan2(dy, hypot(dx, dz)); cam.vy = 0; poseHold = true;
}
function setMoveMode(fly) {
  flyMode = fly; cam.vy = 0;
  $('mw').classList.toggle('on', !fly); $('mf').classList.toggle('on', fly);
}
const tourPts = (() => {
  const c = TOUR, n = c.length, seg = 20, out = [];
  for (let k = 0; k < n - 1; k++) for (let s = 0; s < seg; s++) {
    const t = s / seg, a = c[max(k - 1, 0)], b = c[k], d = c[k + 1], e = c[min(k + 2, n - 1)], q = [];
    for (let i = 0; i < 6; i++) q[i] = 0.5 * (2 * b[i] + (d[i] - a[i]) * t + (2 * a[i] - 5 * b[i] + 4 * d[i] - e[i]) * t * t + (3 * b[i] - a[i] - 3 * d[i] + e[i]) * t * t * t);
    out.push(q);
  }
  out.push(c[n - 1]);
  return out;
})();

function stepCamera(dt) {
  if (tourActive) {
    tourT = (tourT + dt / 60) % 1;
    const f = tourT * tourPts.length, i = floor(f), u = f - i, a = tourPts[i], b = tourPts[min(i + 1, tourPts.length - 1)], q = a.map((v, k) => mix(v, b[k], u));
    const ground = world.walkH(q[0], q[2], q[1] - 1.65) + 1.25;
    lookAtPose([q[0], max(q[1], ground), q[2], q[3], q[4], q[5]]);
    return;
  }
  const mx = input.r - input.l, mz = input.f - input.b;
  if (mx || mz || input.u || input.d) poseHold = false;
  const speed = (flyMode ? 8 : 3.6) * (input.run ? 2.2 : 1), l = hypot(mx, mz) || 1, sy = sin(cam.yaw), cy = cos(cam.yaw);
  let vx = (sy * mz + cy * mx) / l * speed, vz = (cy * mz - sy * mx) / l * speed;
  if (flyMode) {
    const cp = cos(cam.pitch);
    cam.x += vx * dt * (mz ? cp : 1); cam.z += vz * dt * (mz ? cp : 1);
    cam.y = clamp(cam.y + (sin(cam.pitch) * mz + input.u - input.d) * speed * dt, 0.35, 48);
    return;
  }
  if (poseHold) return;
  const feet = cam.y - 1.65, nx = cam.x + vx * dt, nz = cam.z + vz * dt;
  const stepOK = world.walkH(nx, nz, feet) - feet < 0.72;
  if (stepOK) { cam.x = nx; cam.z = nz; }
  for (const [px, pz, pr] of world.colliders) {
    const dx = cam.x - px, dz = cam.z - pz, d = hypot(dx, dz), rr = pr + 0.3;
    if (d < rr && d > 1e-4) { cam.x = px + dx / d * rr; cam.z = pz + dz / d * rr; }
  }
  const rad = hypot(cam.x, cam.z);
  if (rad > 58) { cam.x *= 58 / rad; cam.z *= 58 / rad; }
  const floorY = world.walkH(cam.x, cam.z, cam.y - 1.65) + 1.65;
  if (input.u && grounded) { cam.vy = 4.6; grounded = false; }
  cam.vy -= 12 * dt; cam.y += cam.vy * dt;
  if (cam.y <= floorY) { cam.y = grounded ? mix(cam.y, floorY, 1 - exp(-dt * 16)) : floorY; if (floorY - cam.y > 0.3) cam.y = floorY - 0.3; cam.vy = 0; grounded = true; }
  else if (cam.y - floorY > 0.08) grounded = false;
  else { cam.y = floorY; cam.vy = 0; grounded = true; }
}

function bindInput(openMenu) {
  const key = (e, v) => {
    const c = e.code;
    if (c === 'KeyW' || c === 'ArrowUp') input.f = v;
    else if (c === 'KeyS' || c === 'ArrowDown') input.b = v;
    else if (c === 'KeyA' || c === 'ArrowLeft') input.l = v;
    else if (c === 'KeyD' || c === 'ArrowRight') input.r = v;
    else if (c === 'Space' || c === 'KeyE') { input.u = v; e.preventDefault(); }
    else if (c === 'KeyQ' || c === 'KeyC') input.d = v;
    else if (c === 'ShiftLeft' || c === 'ShiftRight') input.run = v;
    if (!v || e.repeat) return;
    if (c >= 'Digit1' && c <= 'Digit6') { tourActive = false; lookAtPose(POSES[+c[5] - 1]); }
    else if (c === 'KeyG') setMoveMode(!flyMode);
    else if (c === 'KeyF') tourActive = !tourActive;
    else if (c === 'KeyM') mute();
    else if (c === 'KeyH') { hud = !hud; if (!hud) info.textContent = ''; }
    else if (c === 'Escape') openMenu();
  };
  addEventListener('keydown', (e) => key(e, 1));
  addEventListener('keyup', (e) => key(e, 0));
  addEventListener('blur', () => { for (const k in input) input[k] = 0; });
  const look = (dx, dy, s) => { cam.yaw += dx * s; cam.pitch = clamp(cam.pitch - dy * s, -1.45, 1.45); };
  addEventListener('mousemove', (e) => { if (document.pointerLockElement === canvas) look(e.movementX, e.movementY, 0.0021); });
  document.addEventListener('pointerlockchange', () => { if (!document.pointerLockElement && playing && !mob) openMenu(); });
  canvas.addEventListener('click', () => { if (playing && !mob) canvas.requestPointerLock?.(); });
  const touches = new Map();
  canvas.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') { touches.set(e.pointerId, [e.clientX, e.clientY]); input.f = 1; input.run = touches.size > 1 ? 1 : 0; } });
  canvas.addEventListener('pointermove', (e) => {
    const t = touches.get(e.pointerId);
    if (t) { look(e.clientX - t[0], e.clientY - t[1], 0.004); t[0] = e.clientX; t[1] = e.clientY; }
  });
  const up = (e) => { if (touches.delete(e.pointerId)) { input.f = touches.size ? 1 : 0; input.run = touches.size > 1 ? 1 : 0; } };
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
}

async function boot() {
  const setP = (t, msg) => { $('b').style.transform = `scaleX(${t})`; if (msg) $('s').textContent = msg; };
  if (!navigator.gpu) { $('w').hidden = false; throw new Error('WebGPU is not available in this browser'); }
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) { $('w').hidden = false; throw new Error('No WebGPU adapter found'); }
  adapterDesc = { vendor: adapter.info?.vendor, architecture: adapter.info?.architecture, description: adapter.info?.description };
  hasTS = adapter.features.has('timestamp-query');
  const device = await adapter.requestDevice({ requiredFeatures: hasTS ? ['timestamp-query'] : [] });
  device.addEventListener('uncapturederror', (e) => console.error('GPU error:', e.error.message));
  device.lost.then((i) => { if (i.reason !== 'destroyed') console.error('GPU device lost:', i.message); });
  const ctx = canvas.getContext('webgpu'), fmt = navigator.gpu.getPreferredCanvasFormat();
  ctx.configure({ device, format: fmt, alphaMode: 'opaque' });

  world = await buildWorld(setP);
  setP(0.94, 'Compiling the light…');
  await new Promise((r) => setTimeout(r));

  const buffer = (data, usage) => {
    const b = device.createBuffer({ size: (data.byteLength + 3) & ~3, usage: usage | GPUBufferUsage.COPY_DST, mappedAtCreation: true });
    new Uint8Array(b.getMappedRange()).set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    b.unmap();
    return b;
  };
  const vb = buffer(world.vb, GPUBufferUsage.VERTEX), ib = buffer(world.ib, GPUBufferUsage.INDEX), lb = buffer(world.leaves, GPUBufferUsage.VERTEX);
  const nIdx = world.ib.length;
  const uniforms = ['main', 'refl', 'shadow'].reduce((o, k) => (o[k] = device.createBuffer({ size: 256, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }), o), {});

  // samplers and static textures
  const linRepeat = device.createSampler({ magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear', addressModeU: 'repeat', addressModeV: 'repeat', addressModeW: 'clamp-to-edge', maxAnisotropy: 8 });
  const linClamp = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
  const cmp = device.createSampler({ compare: 'less', magFilter: 'linear', minFilter: 'linear' });
  const module = (code) => device.createShaderModule({ code });
  const fsTarget = (format, blend) => [{ format, ...(blend ? { blend } : {}) }];
  const genPipe = (code, format, blend) => device.createRenderPipeline({ layout: 'auto', vertex: { module: module(code), entryPoint: 'vs' }, fragment: { module: module(code), entryPoint: 'fs', targets: fsTarget(format, blend) }, primitive: { topology: 'triangle-list' } });
  const blitPipe = genPipe(WGSL_BLIT, 'rgba8unorm');
  const mipLevels = (s) => floor(Math.log2(s)) + 1;
  const genTexture = (code, size) => {
    const tex = device.createTexture({ size: [size, size], format: 'rgba8unorm', mipLevelCount: mipLevels(size), usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
    const p = genPipe(code, 'rgba8unorm'), enc = device.createCommandEncoder();
    const first = enc.beginRenderPass({ colorAttachments: [{ view: tex.createView({ baseMipLevel: 0, mipLevelCount: 1 }), loadOp: 'clear', clearValue: [0, 0, 0, 0], storeOp: 'store' }] });
    first.setPipeline(p); first.draw(3); first.end();
    for (let i = 1; i < mipLevels(size); i++) {
      const bg = device.createBindGroup({ layout: blitPipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: tex.createView({ baseMipLevel: i - 1, mipLevelCount: 1 }) }, { binding: 1, resource: linClamp }] });
      const pass = enc.beginRenderPass({ colorAttachments: [{ view: tex.createView({ baseMipLevel: i, mipLevelCount: 1 }), loadOp: 'clear', clearValue: [0, 0, 0, 0], storeOp: 'store' }] });
      pass.setPipeline(blitPipe); pass.setBindGroup(0, bg); pass.draw(3); pass.end();
    }
    device.queue.submit([enc.finish()]);
    return tex;
  };
  const noiseTex = genTexture(WGSL_GEN_NOISE, 1024), atlasTex = genTexture(WGSL_GEN_ATLAS, 1024), detailTex = genTexture(WGSL_GEN_DETAIL, 1024), barkTex = genTexture(WGSL_GEN_BARK, 1024);

  const giTex = device.createTexture({ size: [world.GX, world.GX, world.GY], dimension: '3d', format: 'rg8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  device.queue.writeTexture({ texture: giTex }, world.giTex, { bytesPerRow: world.GX * 2, rowsPerImage: world.GX }, [world.GX, world.GX, world.GY]);
  const toHalf = (() => {
    const f = new Float32Array(1), i = new Uint32Array(f.buffer);
    return (v) => { f[0] = v; const x = i[0], s = (x >>> 16) & 0x8000, e = ((x >>> 23) & 255) - 112, m = x & 0x7fffff; return e <= 0 ? s : e >= 31 ? s | 0x7c00 : s | (e << 10) | (m >>> 13); };
  })();
  const hHalf = new Uint16Array(HN * HN);
  for (let k = 0; k < hHalf.length; k++) hHalf[k] = toHalf(world.H[k]);
  const hTex = device.createTexture({ size: [HN, HN], format: 'r16float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  device.queue.writeTexture({ texture: hTex }, hHalf, { bytesPerRow: HN * 2, rowsPerImage: HN }, [HN, HN]);
  const shadowTex = device.createTexture({ size: [SHADOW_SIZE, SHADOW_SIZE], format: DEPTH, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });

  // pipelines
  const vis = GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, F_ = GPUShaderStage.FRAGMENT;
  const sceneBGL = device.createBindGroupLayout({ entries: [
    { binding: 0, visibility: vis, buffer: {} }, { binding: 1, visibility: F_, texture: { sampleType: 'depth' } }, { binding: 2, visibility: F_, sampler: { type: 'comparison' } },
    { binding: 3, visibility: F_, texture: { viewDimension: '3d' } }, { binding: 4, visibility: F_, sampler: {} }, { binding: 5, visibility: F_, texture: {} }, { binding: 6, visibility: F_, texture: {} }, { binding: 7, visibility: F_, texture: {} }, { binding: 8, visibility: F_, texture: {} }, { binding: 9, visibility: F_, texture: {} },
  ] });
  const waterBGL = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: F_, texture: {} }] });
  const shadowBGL = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: vis, buffer: {} }, { binding: 1, visibility: F_, sampler: {} }, { binding: 2, visibility: F_, texture: {} }] });
  const sceneLayout = device.createPipelineLayout({ bindGroupLayouts: [sceneBGL] });
  const waterLayout = device.createPipelineLayout({ bindGroupLayouts: [sceneBGL, waterBGL] });
  const shadowLayout = device.createPipelineLayout({ bindGroupLayouts: [shadowBGL] });
  const worldVB = [{ arrayStride: 36, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }, { shaderLocation: 1, offset: 12, format: 'float32x3' }, { shaderLocation: 2, offset: 24, format: 'float32x2' }, { shaderLocation: 3, offset: 32, format: 'float32' }] }];
  const leafVB = [{ arrayStride: 28, stepMode: 'instance', attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x4' }, { shaderLocation: 1, offset: 16, format: 'snorm8x4' }, { shaderLocation: 2, offset: 20, format: 'snorm8x4' }, { shaderLocation: 3, offset: 24, format: 'unorm8x4' }] }];
  const shellM = module(WGSL_SHELL), worldM = module(WGSL_WORLD), leafM = module(WGSL_LEAF), skyM = module(WGSL_SKY), waterM = module(WGSL_WATER), spriteM = module(WGSL_SPRITE), shadowM = module(WGSL_SHADOW);
  const premult = { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' } };
  const alphaBlend = { color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' } };
  const scenePipes = (samples, frontFace) => {
    const ds = (over = {}) => ({ format: DEPTH, depthWriteEnabled: true, depthCompare: 'greater', ...over });
    const ms = { count: samples };
    const make = (d) => device.createRenderPipeline(d);
    return {
      world: make({ layout: sceneLayout, vertex: { module: worldM, entryPoint: 'vs', buffers: worldVB }, fragment: { module: worldM, entryPoint: 'fs', targets: [{ format: HDR }], constants: { SHELLS: SHELL_N } }, primitive: { cullMode: 'back', frontFace }, depthStencil: ds(), multisample: ms }),
      shell: SHELL_N && samples > 1 ? make({ layout: sceneLayout, vertex: { module: shellM, entryPoint: 'vs', buffers: worldVB, constants: { NSH: SHELL_N } }, fragment: { module: shellM, entryPoint: 'fs', targets: [{ format: HDR }] }, primitive: { cullMode: 'back', frontFace }, depthStencil: ds(), multisample: { count: samples, alphaToCoverageEnabled: true } }) : null,
      leaf: make({ layout: sceneLayout, vertex: { module: leafM, entryPoint: 'vs', buffers: leafVB }, fragment: { module: leafM, entryPoint: 'fs', targets: [{ format: HDR }], constants: { CUT: samples > 1 ? 0.42 : 0.5 } }, primitive: { cullMode: 'none' }, depthStencil: ds(), multisample: { count: samples, alphaToCoverageEnabled: samples > 1 } }),
      sky: make({ layout: sceneLayout, vertex: { module: skyM, entryPoint: 'vs' }, fragment: { module: skyM, entryPoint: 'fs', targets: [{ format: HDR }] }, depthStencil: ds({ depthWriteEnabled: false, depthCompare: 'equal' }), multisample: ms }),
      sprite: make({ layout: sceneLayout, vertex: { module: spriteM, entryPoint: 'vs' }, fragment: { module: spriteM, entryPoint: 'fs', targets: [{ format: HDR, blend: premult }] }, depthStencil: ds({ depthWriteEnabled: false }), multisample: ms }),
    };
  };
  const mainP = scenePipes(AA, 'cw'), reflP = scenePipes(1, 'ccw');
  const waterP = device.createRenderPipeline({ layout: waterLayout, vertex: { module: waterM, entryPoint: 'vs' }, fragment: { module: waterM, entryPoint: 'fs', targets: [{ format: HDR, blend: alphaBlend }] }, primitive: { cullMode: 'none' }, depthStencil: { format: DEPTH, depthWriteEnabled: false, depthCompare: 'greater' }, multisample: { count: AA } });
  const shWorldP = device.createRenderPipeline({ layout: shadowLayout, vertex: { module: shadowM, entryPoint: 'vsWorld', buffers: [{ arrayStride: 36, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] }] }, primitive: { cullMode: 'none' }, depthStencil: { format: DEPTH, depthWriteEnabled: true, depthCompare: 'less', depthBias: 2, depthBiasSlopeScale: 1.6 } });
  const shLeafP = device.createRenderPipeline({ layout: shadowLayout, vertex: { module: shadowM, entryPoint: 'vsLeaf', buffers: leafVB }, fragment: { module: shadowM, entryPoint: 'fsLeaf', targets: [] }, primitive: { cullMode: 'none' }, depthStencil: { format: DEPTH, depthWriteEnabled: true, depthCompare: 'less' } });
  const postPipe = (code, format, blend) => genPipe(code, format, blend);
  const rayM = WGSL_RAY(AA > 1);
  const rayP = postPipe(rayM, HDR), blurP = postPipe(WGSL_BLUR, HDR), combineP = postPipe(WGSL_COMBINE, HDR), downP = postPipe(WGSL_DOWN, HDR);
  const upP = postPipe(WGSL_UP, HDR, { color: { srcFactor: 'one', dstFactor: 'one' }, alpha: { srcFactor: 'one', dstFactor: 'one' } }), finalP = postPipe(WGSL_FINAL, fmt);

  const sceneEntries = (ub) => [
    { binding: 0, resource: { buffer: ub } }, { binding: 1, resource: shadowTex.createView() }, { binding: 2, resource: cmp },
    { binding: 3, resource: giTex.createView({ dimension: '3d' }) }, { binding: 4, resource: linRepeat }, { binding: 5, resource: noiseTex.createView() }, { binding: 6, resource: atlasTex.createView() }, { binding: 7, resource: hTex.createView() }, { binding: 8, resource: detailTex.createView() }, { binding: 9, resource: barkTex.createView() },
  ];
  const mainBG = device.createBindGroup({ layout: sceneBGL, entries: sceneEntries(uniforms.main) });
  const reflBG = device.createBindGroup({ layout: sceneBGL, entries: sceneEntries(uniforms.refl) });
  const shadowBG = device.createBindGroup({ layout: shadowBGL, entries: [{ binding: 0, resource: { buffer: uniforms.shadow } }, { binding: 1, resource: linRepeat }, { binding: 2, resource: atlasTex.createView() }] });

  // static sun shadow map
  const sunEye = [SUN_DIR[0] * 130, SUN_DIR[1] * 130, SUN_DIR[2] * 130];
  const sunVP = mul4(orthoLH(92, 1, 260), viewLH(sunEye, [0, 0, 0], [0, 0, 1]));
  const uData = new Float32Array(64);
  uData.set(sunVP, 32);
  device.queue.writeBuffer(uniforms.shadow, 0, uData);
  {
    const enc = device.createCommandEncoder();
    const p = enc.beginRenderPass({ colorAttachments: [], depthStencilAttachment: { view: shadowTex.createView(), depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' } });
    p.setBindGroup(0, shadowBG);
    p.setPipeline(shWorldP); p.setVertexBuffer(0, vb); p.setIndexBuffer(ib, 'uint32'); p.drawIndexed(nIdx);
    p.setPipeline(shLeafP); p.setVertexBuffer(0, lb); p.draw(6, world.nLeaves);
    p.end();
    device.queue.submit([enc.finish()]);
  }
  await device.queue.onSubmittedWorkDone();

  // size-dependent targets
  let T = null;
  const blurU = [0, 1].map(() => device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }));
  const bloomU = [];
  for (let i = 0; i < BLOOM_LEVELS * 2; i++) bloomU.push(device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }));
  const RT = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING;
  function resize() {
    const dpr = min(devicePixelRatio || 1, LV === 2 ? 1 : 2), nw = max(2, round(canvas.clientWidth * dpr)), nh = max(2, round(canvas.clientHeight * dpr));
    if (T && nw === W && nh === H_) return;
    if (T) for (const t of T.all) t.destroy();
    W = canvas.width = nw; H_ = canvas.height = nh;
    const tex = (w, h, format, usage, sampleCount = 1, mipLevelCount = 1) => device.createTexture({ size: [max(1, w), max(1, h)], format, usage, sampleCount, mipLevelCount });
    const hw = max(1, W >> 1), hh = max(1, H_ >> 1), rw = max(2, round(W * REFL_SCALE)), rh = max(2, round(H_ * REFL_SCALE));
    const msColor = AA > 1 ? tex(W, H_, HDR, GPUTextureUsage.RENDER_ATTACHMENT, AA) : null;
    const hdr = tex(W, H_, HDR, RT), depth = tex(W, H_, DEPTH, RT, AA), refl = tex(rw, rh, HDR, RT), reflD = tex(rw, rh, DEPTH, GPUTextureUsage.RENDER_ATTACHMENT);
    const ray = tex(hw, hh, HDR, RT), rayB = tex(hw, hh, HDR, RT), scene = tex(W, H_, HDR, RT), bloom = tex(hw, hh, HDR, RT, 1, BLOOM_LEVELS);
    device.queue.writeBuffer(blurU[0], 0, new Float32Array([1 / hw, 0, 0, 0]));
    device.queue.writeBuffer(blurU[1], 0, new Float32Array([0, 1 / hh, 0, 0]));
    const bg = (p, entries) => device.createBindGroup({ layout: p.getBindGroupLayout(0), entries: entries.map((resource, binding) => ({ binding, resource })) });
    const rayBG = bg(rayP, [{ buffer: uniforms.main }, shadowTex.createView(), cmp, depth.createView(), noiseTex.createView(), linRepeat]);
    const blurA = bg(blurP, [ray.createView(), linClamp, { buffer: blurU[0] }]), blurB = bg(blurP, [rayB.createView(), linClamp, { buffer: blurU[1] }]);
    const combine = bg(combineP, [hdr.createView(), ray.createView(), linClamp]);
    const mip = (l) => bloom.createView({ baseMipLevel: l, mipLevelCount: 1 }), down = [], up = [];
    for (let l = 0; l < BLOOM_LEVELS; l++) {
      const sw = l ? max(1, hw >> (l - 1)) : W, sh = l ? max(1, hh >> (l - 1)) : H_;
      device.queue.writeBuffer(bloomU[l], 0, new Float32Array([1 / sw, 1 / sh, l === 0 ? 1 : 0, 0]));
      down.push(bg(downP, [l ? mip(l - 1) : scene.createView(), linClamp, { buffer: bloomU[l] }]));
    }
    for (let l = BLOOM_LEVELS - 1; l > 0; l--) {
      const u = bloomU[BLOOM_LEVELS + l];
      device.queue.writeBuffer(u, 0, new Float32Array([1.2 / max(1, hw >> l), 1.2 / max(1, hh >> l), 0.8, 0]));
      up[l] = bg(upP, [mip(l), linClamp, { buffer: u }]);
    }
    const final = bg(finalP, [scene.createView(), mip(0), linClamp]);
    const waterBG = device.createBindGroup({ layout: waterBGL, entries: [{ binding: 0, resource: refl.createView() }] });
    T = { all: [msColor, hdr, depth, refl, reflD, ray, rayB, scene, bloom].filter(Boolean), msColor, hdr, depth, refl, reflD, ray, rayB, scene, bloom, mip, rayBG, blurA, blurB, combine, down, up, final, waterBG };
  }

  // GPU timing
  let qs = null, qr = null, qm = null, qBusy = false;
  if (hasTS) {
    qs = device.createQuerySet({ type: 'timestamp', count: 2 });
    qr = device.createBuffer({ size: 16, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC });
    qm = device.createBuffer({ size: 16, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  }

  const post = (enc, view, pipe, bg, load = 'clear', ts) => {
    const p = enc.beginRenderPass({ colorAttachments: [{ view, loadOp: load, clearValue: [0, 0, 0, 1], storeOp: 'store' }], ...(ts ? { timestampWrites: ts } : {}) });
    p.setPipeline(pipe); p.setBindGroup(0, bg); p.draw(3); p.end();
  };
  const writeU = (buf, vp, eye, clip, time) => {
    uData.set(vp, 0); uData.set(inv4(vp), 16); uData.set(sunVP, 32);
    uData.set([eye[0], eye[1], eye[2], time], 48);
    uData.set([SUN_DIR[0], SUN_DIR[1], SUN_DIR[2], 0], 52);
    uData.set([W, H_, 1 / W, 1 / H_], 56);
    uData.set([clip, 1, frameCounter % 64, skip.flat ? 1 : 0], 60);
    device.queue.writeBuffer(buf, 0, uData);
  };
  const drawScene = (p, P, bg) => {
    p.setBindGroup(0, bg);
    p.setVertexBuffer(0, vb); p.setIndexBuffer(ib, 'uint32');
    if (!skip.world) { p.setPipeline(P.world); p.drawIndexed(nIdx); }
    if (P.shell && !skip.shell) { p.setPipeline(P.shell); for (const [a, b] of world.shellRanges) p.drawIndexed(b - a, SHELL_N, a); }
    if (!skip.leaf) { p.setPipeline(P.leaf); p.setVertexBuffer(0, lb); p.draw(6, world.nLeaves); }
    p.setPipeline(P.sky); p.draw(3);
  };

  let last = performance.now();
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = min((now - last) / 1000, 0.05); last = now;
    cpuFps = mix(cpuFps, 1 / max(dt, 0.001), 0.05);
    sceneTime = fixedTime ?? sceneTime + dt;
    if (playing || tourActive) stepCamera(dt);
    resize();
    const cp = cos(cam.pitch), f = [sin(cam.yaw) * cp, sin(cam.pitch), cos(cam.yaw) * cp], eye = [cam.x, cam.y, cam.z];
    const proj = perspLH(1.012, W / H_, 0.12), vp = mul4(proj, viewLH(eye, [eye[0] + f[0], eye[1] + f[1], eye[2] + f[2]]));
    const mvp = mul4(vp, MIRROR_Y);
    writeU(uniforms.main, vp, eye, 0, sceneTime);
    writeU(uniforms.refl, mvp, [eye[0], -eye[1], eye[2]], 1, sceneTime);

    const enc = device.createCommandEncoder(), swap = ctx.getCurrentTexture().createView();
    const rp = enc.beginRenderPass({
      colorAttachments: [{ view: T.refl.createView(), loadOp: 'clear', clearValue: [0, 0, 0, 1], storeOp: 'store' }],
      depthStencilAttachment: { view: T.reflD.createView(), depthClearValue: 0, depthLoadOp: 'clear', depthStoreOp: 'discard' },
      ...(hasTS ? { timestampWrites: { querySet: qs, beginningOfPassWriteIndex: 0 } } : {}),
    });
    if (!skip.refl) drawScene(rp, reflP, reflBG); else rp.setBindGroup(0, reflBG);
    rp.setPipeline(reflP.sprite); rp.draw(6, floor(SPRITES / 2));
    rp.end();

    const mp = enc.beginRenderPass({
      colorAttachments: [{ view: AA > 1 ? T.msColor.createView() : T.hdr.createView(), resolveTarget: AA > 1 ? T.hdr.createView() : undefined, loadOp: 'clear', clearValue: [0, 0, 0, 1], storeOp: AA > 1 ? 'discard' : 'store' }],
      depthStencilAttachment: { view: T.depth.createView(), depthClearValue: 0, depthLoadOp: 'clear', depthStoreOp: 'store' },
    });
    drawScene(mp, mainP, mainBG);
    mp.setPipeline(waterP); mp.setBindGroup(1, T.waterBG); mp.draw(6);
    mp.setPipeline(mainP.sprite); mp.draw(6, SPRITES);
    mp.end();

    if (!skip.ray) post(enc, T.ray.createView(), rayP, T.rayBG);
    post(enc, T.rayB.createView(), blurP, T.blurA);
    post(enc, T.ray.createView(), blurP, T.blurB);
    post(enc, T.scene.createView(), combineP, T.combine);
    for (let l = 0; l < BLOOM_LEVELS; l++) post(enc, T.mip(l), downP, T.down[l]);
    for (let l = BLOOM_LEVELS - 1; l > 0; l--) post(enc, T.mip(l - 1), upP, T.up[l], 'load');
    post(enc, swap, finalP, T.final, 'clear', hasTS ? { querySet: qs, endOfPassWriteIndex: 1 } : undefined);

    const canRead = hasTS && !qBusy;
    if (canRead) { enc.resolveQuerySet(qs, 0, 2, qr, 0); enc.copyBufferToBuffer(qr, 0, qm, 0, 16); }
    device.queue.submit([enc.finish()]);
    if (canRead) {
      qBusy = true;
      qm.mapAsync(GPUMapMode.READ).then(() => {
        const t = new BigInt64Array(qm.getMappedRange()), ms = Number(t[1] - t[0]) / 1e6;
        qm.unmap(); qBusy = false;
        if (ms > 0 && ms < 1000) { gpuMs = mix(gpuMs || ms, ms, 0.08); onGpuSample?.(ms); }
      }).catch(() => { qBusy = false; });
    }
    frameCounter++;
    if (hud && frameCounter % 12 === 0) {
      info.textContent = `${W}x${H_}  ${['High', 'Medium', 'Low'][LV]}  ${flyMode ? 'Fly' : 'Walk'}\n${cpuFps.toFixed(0)} fps  GPU ${gpuMs.toFixed(2)} ms\n${cam.x.toFixed(1)}, ${cam.y.toFixed(1)}, ${cam.z.toFixed(1)}`;
    }
  }

  // menu
  const body = document.body, qBtns = [...$('q').querySelectorAll('button')].slice(0, 3);
  qBtns.forEach((b, i) => {
    b.classList.toggle('on', 2 - i === LV);
    b.onclick = () => { if (2 - i !== LV) { keep(String(2 - i)); location.reload(); } };
  });
  const openMenu = () => { playing = false; body.className = 'm'; if (document.pointerLockElement) document.exitPointerLock(); };
  $('d').onclick = () => {
    playing = true; body.className = 'g'; startAudio();
    if (!mob) { try { const r = canvas.requestPointerLock?.(); r?.catch?.(() => {}); } catch {} }
  };
  $('o').onclick = openMenu;
  $('mw').onclick = () => setMoveMode(false);
  $('mf').onclick = () => setMoveMode(true);
  bindInput(openMenu);
  lookAtPose(POSES[0]);
  resize();
  setP(1, 'The grove is awake');
  body.className = 'm';
  requestAnimationFrame(frame);
  if (window.__MG) window.__MG.ready = true;
}
