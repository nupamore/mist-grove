// ============================================================================
// quality presets and persisted state (LV: 0 High, 1 Medium, 2 Low)
// ============================================================================
const mob = matchMedia('(pointer:coarse)').matches, mem = navigator.deviceMemory;
const SV = (() => { try { return (localStorage.mistgroveClaude || '').split(','); } catch { return []; } })();
const keep = (v) => { try { localStorage.mistgroveClaude = v; } catch {} };
const LV = SV[0] !== '' && SV[0] >= 0 ? Math.min(+SV[0], 2) : (mob ? (mem >= 8 ? 1 : 2) : (mem && mem <= 4 ? 2 : 0));
const AA = LV > 1 ? 1 : 4;
const RAY_STEPS = [28, 20, 12][LV];
const LEAF_KEEP = [1, 0.6, 0.3][LV];
const REFL_SCALE = [0.5, 0.4, 0.25][LV];
const SHADOW_SIZE = [4096, 2048, 1024][LV];
const SHELL_N = [14, 8, 0][LV];
const TREE_DENS = 4.2;
const SPRITES = [2200, 1400, 700][LV];
