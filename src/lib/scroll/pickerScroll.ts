import { writable, type Writable } from "svelte/store";

export type PickerController = ReturnType<typeof createPickerScroll>;

export function createPickerScroll(opts: {
  items: string[];
  itemHeight: number;
  radius: number;
}) {
  const { items, itemHeight, radius } = opts;

  const scrollTarget = writable(0);
  const scrollCurrent = writable(0);
  const scrollFrac = writable(0);
  const scrollBaseIndex = writable(0);

  // Stretch / pull
  const scrollStretch = writable(0);
  const scrollDir = writable(1); // +1 down, -1 up (last wheel input)
  const wheelSpeed = writable(0);

  const slots = Array.from({ length: radius * 2 + 1 }, (_, i) => i - radius);

  let rafId: number | null = null;
  let lastT = 0;

  // tuning
  const SCROLL_POS_RESP = 14;
  const WHEEL_MAX_VEL = 8000;
  const WHEEL_VEL_DECAY = 14;

  const STRETCH_RESP_MIN = 3;
  const STRETCH_RESP_MAX = 18;
  const STRETCH_MAX_Y = 1.2;
  const STRETCH_SIGMA = 0.85;

  const EDGE_SHRINK_MAX_Y = 0.35;
  const MIN_SCALE_Y = 0.55;

  const EDGE_PULL_MAX = 0.42;
  const EDGE_PULL_POW = 1.35;
  const EDGE_PULL_AHEAD = 1.0;
  const EDGE_PULL_BEHIND = 0.18;

  function clamp(n: number, a: number, b: number) {
    return Math.max(a, Math.min(b, n));
  }

  function slotWeight(slot: number, frac: number) {
    const dSlots = (slot * itemHeight - frac) / itemHeight;
    const sigma = Math.max(0.35, STRETCH_SIGMA);
    const x = dSlots / sigma;
    const w = Math.exp(-(x * x) / 2);
    return Math.pow(w, 1.8);
  }

  function edgePullPx(slot: number, frac: number, stretch: number, dir: number) {
    // IMPORTANT: static base = slot distance only (prevents bounce)
    const base = slot * itemHeight;

    const w = slotWeight(slot, frac);
    const edge = Math.pow(1 - w, EDGE_PULL_POW);

    const isAhead = slot * dir > 0;
    const side = isAhead ? EDGE_PULL_AHEAD : EDGE_PULL_BEHIND;

    const pullFactor = stretch * EDGE_PULL_MAX * edge * side;
    return -base * pullFactor;
  }

  function start() {
    if (typeof window === "undefined") return;
    if (rafId !== null) return;

    const tick = (t: number) => {
      if (!lastT) lastT = t;
      const dt = Math.min(0.05, (t - lastT) / 1000);
      lastT = t;

      let target = 0;
      scrollTarget.update((v) => (target = v, v));

      let current = 0;
      scrollCurrent.update((v) => (current = v, v));

      // inertial position
      const aPos = 1 - Math.exp(-SCROLL_POS_RESP * dt);
      current += (target - current) * aPos;

      scrollCurrent.set(current);

      // base + frac for infinite mapping
      const base = Math.floor(current / itemHeight);
      const frac = current - base * itemHeight;
      scrollBaseIndex.set(base);
      scrollFrac.set(frac);

      // wheelSpeed decay
      let ws = 0;
      wheelSpeed.update((v) => (ws = v, v));
      ws *= Math.exp(-WHEEL_VEL_DECAY * dt);
      if (ws < 5) ws = 0;
      wheelSpeed.set(ws);

      // stretch from wheelSpeed
      const speedNorm = clamp(ws / WHEEL_MAX_VEL, 0, 1);
      const desired = clamp(Math.pow(speedNorm, 0.62), 0, 1);

      let stretch = 0;
      scrollStretch.update((v) => (stretch = v, v));

      const resp =
        STRETCH_RESP_MIN + (STRETCH_RESP_MAX - STRETCH_RESP_MIN) * speedNorm;
      const aStretch = 1 - Math.exp(-resp * dt);
      stretch += (desired - stretch) * aStretch;
      scrollStretch.set(stretch);

      // stop
      const dist = Math.abs(target - current);
      if (dist < 0.6 && stretch < 0.01 && ws === 0) {
        rafId = null;
        lastT = 0;
        return;
      }

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
  }

  let lastWheelT = 0;

  function onWheel(e: WheelEvent) {
    if (typeof window === "undefined") return;
    e.preventDefault();

    const dy = e.deltaY;

    scrollTarget.update((v) => v + dy);

    // direction lock
    if (dy !== 0) scrollDir.set(dy > 0 ? 1 : -1);

    // wheel speed magnitude
    const now = performance.now();
    if (!lastWheelT) lastWheelT = now;
    const dt = Math.max(0.001, (now - lastWheelT) / 1000);
    lastWheelT = now;

    const inst = Math.abs(dy) / dt;
    wheelSpeed.update((v) => v + (inst - v) * 0.55);

    start();
  }

  // Helpers for markup (computed per slot)
  function labelScaleY(slot: number, frac: number, stretch: number) {
    const w = slotWeight(slot, frac);
    return Math.max(
      1 + stretch * w * STRETCH_MAX_Y - stretch * (1 - w) * EDGE_SHRINK_MAX_Y,
      MIN_SCALE_Y
    );
  }

  function labelOpacity(slot: number, frac: number) {
    const w = slotWeight(slot, frac);
    return 0.55 + 0.45 * w;
  }

  return {
    slots,
    items,
    itemHeight,

    // stores
    scrollFrac,
    scrollBaseIndex,
    scrollStretch,
    scrollDir,

    // API
    start,
    onWheel,

    // computed helpers for markup
    labelScaleY,
    labelOpacity,
    edgePullPx,
  };
}