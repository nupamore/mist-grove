// ============================================================================
// procedural forest and lake ambience
// ============================================================================
let audioCtx = null, audioGain = null, muted = false;
function startAudio() {
  if (audioCtx) { audioCtx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  const ac = audioCtx = new AC();
  audioGain = ac.createGain();
  audioGain.gain.value = 0;
  audioGain.gain.linearRampToValueAtTime(muted ? 0 : 0.55, ac.currentTime + 3);
  audioGain.connect(ac.destination);
  const noise = ac.createBuffer(2, ac.sampleRate * 6, ac.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = noise.getChannelData(c);
    let last = 0;
    for (let i = 0; i < d.length; i++) { last = last * 0.985 + (Math.random() * 2 - 1) * 0.08; d[i] = last; }
  }
  const bed = (freq, q, level, rate) => {
    const src = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain(), lfo = ac.createOscillator(), lg = ac.createGain();
    src.buffer = noise; src.loop = true; f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q; g.gain.value = level;
    lfo.frequency.value = rate; lg.gain.value = level * 0.55;
    lfo.connect(lg).connect(g.gain); src.connect(f).connect(g).connect(audioGain);
    src.start(); lfo.start();
  };
  bed(420, 0.5, 0.42, 0.07); bed(1500, 0.7, 0.08, 0.11); bed(150, 0.8, 0.5, 0.05);
  const chirp = () => {
    if (ac.state === 'running' && !muted) {
      const t = ac.currentTime, n = 2 + floor(Math.random() * 4), base = 2100 + Math.random() * 1700, pan = ac.createStereoPanner();
      pan.pan.value = Math.random() * 1.6 - 0.8; pan.connect(audioGain);
      for (let i = 0; i < n; i++) {
        const o = ac.createOscillator(), g = ac.createGain(), s = t + i * 0.16;
        o.type = 'sine'; o.frequency.setValueAtTime(base, s); o.frequency.exponentialRampToValueAtTime(base * 1.28, s + 0.07);
        g.gain.setValueAtTime(0, s); g.gain.linearRampToValueAtTime(0.018, s + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, s + 0.12);
        o.connect(g).connect(pan); o.start(s); o.stop(s + 0.14);
      }
    }
    setTimeout(chirp, 2400 + Math.random() * 7000);
  };
  setTimeout(chirp, 2500);
}
function mute() {
  muted = !muted;
  if (audioCtx) audioGain.gain.setTargetAtTime(muted ? 0 : 0.55, audioCtx.currentTime, 0.2);
}
