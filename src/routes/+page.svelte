<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  
  // Types
  interface Image {
    id: number;
    url: string;
  }
  
  interface Tile {
    x: number;
    y: number;
    image: Image;
  }
  
  interface Position {
    x: number;
    y: number;
  }
  
  // Grid configuration
  const CELL_SIZE: number = 200;
  const GRID_SIZE: number = 7; // 3x3 visible grid
  const TOTAL_IMAGES: number = 20;
  
  // Generate placeholder images
  const images: Image[] = Array.from({ length: TOTAL_IMAGES }, (_, i: number): Image => ({
    id: i,
    url: `https://picsum.photos/seed/${i}/200/200`
  }));
  
  // State variables
  let container: HTMLDivElement;
  let isDragging: boolean = false;
  let startX: number = 0;
  let startY: number = 0;
  let offsetX: number = 0;
  let offsetY: number = 0;
  

let currentOffsetX: number = 0;
let currentOffsetY: number = 0;

  // Target offsets that the animation loop eases toward
  let targetOffsetX: number = 0;
  let targetOffsetY: number = 0;

  // Frame-rate independent smoothing (dt-based)
  let lastRafTime: number = 0;

  // Responsiveness in 1/seconds (higher = snappier)
  // Lower = smoother/less snappy
  const DRAG_RESP: number = 12;
  const INERTIA_RESP: number = 10;

  // Lower = longer glide
  const FRICTION_PER_SEC: number = 3.2;

  // Stop threshold in px/s (lower = longer tail)
  const STOP_SPEED: number = 8;

  let velocityX: number = 0;
  let velocityY: number = 0;

  // Smooth pointer velocity so inertia feels less jittery
  const VEL_SMOOTH: number = 0.18; // 0..1 (higher = follows input more)
  const INERTIA_BOOST: number = 1.35; // >1 = more momentum on release

  let lastMoveTime: number = 0;
  let lastClientX: number = 0;
  let lastClientY: number = 0;

  let rafId: number | null = null;

  // --- Screen toggle (single file, two screens) ---
  type Screen = 'grid' | 'scroll';
  let screen: Screen = 'grid';

  function setScreen(next: Screen): void {
    screen = next;

    // Ensure grid drag doesn't "stick" when switching away
    if (screen !== 'grid') {
      isDragging = false;
      velocityX = 0;
      velocityY = 0;
    }

    // Start/stop scroll loop + wheel listener
    if (screen === 'scroll') {
      enableScrollMode();
    } else {
      disableScrollMode();
    }
  }

  // --- Scroll screen (iOS-like picker: inertial scroll + center-weighted vertical stretch + infinite loop) ---
  const scrollProjects: string[] = [
    'Dior',
    'Renault',
    'Biotherm',
    'Diptyque',
    'Chanel',
    'Van Cleef',
    'Beau Band',
    'Cartier',
    'Saint Laurent',
    'Loewe'
  ];

let scrollViewport: HTMLDivElement | null = null;
let scrollWrap: HTMLDivElement | null = null; // unused for picker, but kept for type completeness
let scrollItems: HTMLDivElement[] = [];

function scrollItemRef(node: HTMLDivElement, index: number) {
  scrollItems[index] = node;
  return {
    destroy() {
      if (scrollItems[index] === node) {
        // keep array shape stable; remove reference
        scrollItems[index] = undefined as unknown as HTMLDivElement;
      }
    }
  };
}

  // iOS-like picker scroll state
  let scrollTarget = 0;   // px (wheel input accumulates here)
  let scrollCurrent = 0;  // px (smoothed / inertial)
  let scrollPrev = 0;     // px (for velocity)
  let scrollVel = 0;      // px/s (smoothed velocity)
  // Wheel/trackpad impulse velocity (used for stretch like the reference)
  let wheelVel = 0;        // px/s (signed)
  let lastWheelT = 0;      // ms timestamp
  let scrollDir = 1;       // +1 scrolling down, -1 scrolling up

  // For infinite looping render
  const PICKER_ITEM_H = 112;       // px (fixed step height; tighter spacing like iOS picker)
  const PICKER_RADIUS = 8;         // render (2*R+1) items
  const pickerSlots: number[] = Array.from({ length: PICKER_RADIUS * 2 + 1 }, (_, i) => i - PICKER_RADIUS);

  let scrollBaseIndex = 0; // integer index into the infinite stream
  let scrollFrac = 0;      // 0..PICKER_ITEM_H fractional scroll

  let scrollRafId: number | null = null;
  let scrollLastT = 0;

  // Tuning: position inertia + stretch response
  const SCROLL_POS_RESP = 14;      // higher = less lag, lower = floatier
  const SCROLL_VEL_SMOOTH = 0.22;  // 0..1 (higher = more reactive velocity)
  const SCROLL_MAX_VEL = 5000;     // clamp px/s for normalization
  // Stretch is driven more by wheel impulse than by inertial position velocity
  const WHEEL_MAX_VEL = 8000;      // px/s clamp for wheel impulse normalization
  const WHEEL_VEL_DECAY = 14;      // 1/s decay back to 0 (higher = quicker settle)

  // Stretch response is speed-dependent:
  // - slow scroll -> slow stretch changes
  // - fast scroll -> quick stretch changes
  const STRETCH_RESP_MIN = 3;      // response at very low speed
  const STRETCH_RESP_MAX = 18;     // response at max speed
  const STRETCH_MAX_Y = 1.2;       // extra scaleY at center at max speed (matches reference better)
  const STRETCH_SIGMA = 0.85;      // sigma in "slot units" (smaller = tighter center focus)
  const EDGE_SHRINK_MAX_Y = 0.35;  // max compression at edges at max speed
  const MIN_SCALE_Y = 0.55;        // never shrink below this
  let scrollStretch = 0;           // 0..1

  function clamp(n: number, a: number, b: number): number {
    return Math.max(a, Math.min(b, n));
  }

  function slotWeight(slot: number): number {
    // Continuous center weight: distance from the center line in "slot units".
    // Includes scrollFrac so the weight shifts smoothly between items.
    const dSlots = (slot * PICKER_ITEM_H - scrollFrac) / PICKER_ITEM_H; // 0 means exactly centered
    const sigma = Math.max(0.35, STRETCH_SIGMA); // guard
    const x = dSlots / sigma;
    const w = Math.exp(-(x * x) / 2); // gaussian 0..1

    // Sharpen: make center much stronger, edges fall off faster
    return Math.pow(w, 1.8);
  }

  function enableScrollMode(): void {
    if (typeof window === 'undefined') return;
    // Reset so it always feels consistent when switching in
    scrollTarget = 0;
    scrollCurrent = 0;
    scrollPrev = 0;
    scrollVel = 0;
    wheelVel = 0;
    lastWheelT = 0;
    scrollDir = 1;
    scrollStretch = 0;
    scrollBaseIndex = 0;
    scrollFrac = 0;
    scrollLastT = 0;

    window.addEventListener('wheel', onWheelScroll as any, { passive: false } as any);
    startScrollLoop();
  }

  function disableScrollMode(): void {
    if (typeof window === 'undefined') return;
    window.removeEventListener('wheel', onWheelScroll as any);
    if (scrollRafId !== null) {
      cancelAnimationFrame(scrollRafId);
      scrollRafId = null;
    }
    scrollLastT = 0;
    scrollStretch = 0;
    // Reset any transforms on picker items
    for (const el of scrollItems) {
      if (!el) continue;
      el.style.transform = '';
      el.style.opacity = '';
    }
  }

  function onWheelScroll(e: WheelEvent): void {
    if (typeof window === 'undefined') return;
    if (screen !== 'scroll') return;
    e.preventDefault();

    // Vertical-only wheel input (ignore deltaX from trackpads)
    const dy = e.deltaY;
    scrollTarget += dy;

    // Compute signed wheel impulse velocity (px/s) from event timing
    const now = performance.now();
    if (!lastWheelT) lastWheelT = now;
    const dt = Math.max(0.001, (now - lastWheelT) / 1000);
    lastWheelT = now;

    const instWheelVel = dy / dt; // px/s signed

    // Smooth but keep it responsive (impulse feel)
    wheelVel += (instWheelVel - wheelVel) * 0.55;

    // Update direction immediately for “pulled” look
    if (wheelVel !== 0) scrollDir = wheelVel > 0 ? 1 : -1;

    startScrollLoop();
  }

  function startScrollLoop(): void {
    if (typeof window === 'undefined') return;
    if (scrollRafId !== null) return;

    const tick = (t: number): void => {
      if (screen !== 'scroll') {
        scrollRafId = null;
        return;
      }

      if (!scrollLastT) scrollLastT = t;
      const dt = Math.min(0.05, (t - scrollLastT) / 1000);
      scrollLastT = t;

      // Smooth position toward target (frame-rate independent)
      const alphaPos = 1 - Math.exp(-SCROLL_POS_RESP * dt);
      scrollCurrent += (scrollTarget - scrollCurrent) * alphaPos;

      // Velocity from smoothed position (px/s)
      const rawVel = (scrollCurrent - scrollPrev) / Math.max(0.0001, dt);
      scrollPrev = scrollCurrent;

      // Smooth inertial velocity (no oscillation)
      const vClamped = clamp(rawVel, -SCROLL_MAX_VEL, SCROLL_MAX_VEL);
      scrollVel += (vClamped - scrollVel) * SCROLL_VEL_SMOOTH;

      // Decay wheel impulse velocity toward 0 (keeps “snap” without bounce)
      const wheelDecay = Math.exp(-WHEEL_VEL_DECAY * dt);
      wheelVel *= wheelDecay;
      if (Math.abs(wheelVel) < 5) wheelVel = 0;

      // Direction: wheel impulse wins; fallback to inertial velocity
      const dirSource = wheelVel !== 0 ? wheelVel : scrollVel;
      if (dirSource !== 0) scrollDir = dirSource > 0 ? 1 : -1;

      // Stretch should follow wheel impulse more than inertial motion
      const wheelClamped = clamp(wheelVel, -WHEEL_MAX_VEL, WHEEL_MAX_VEL);
      const speedNorm = clamp(Math.abs(wheelClamped) / WHEEL_MAX_VEL, 0, 1);

      // Speed -> stretch amount: slow scroll barely stretches, fast scroll stretches a lot
      const desiredStretch = clamp(Math.pow(speedNorm, 0.62), 0, 1);

      // Stretch follows speed and returns smoothly (no bounce),
      // with a response that depends on scroll speed so slow scroll feels slow.
      const respStretch = STRETCH_RESP_MIN + (STRETCH_RESP_MAX - STRETCH_RESP_MIN) * speedNorm;
      const alphaStretch = 1 - Math.exp(-respStretch * dt);
      scrollStretch += (desiredStretch - scrollStretch) * alphaStretch;

      // Infinite looping: derive base index and fractional offset
      const base = Math.floor(scrollCurrent / PICKER_ITEM_H);
      scrollBaseIndex = base;

      // Always keep fractional in [0..H)
      scrollFrac = scrollCurrent - base * PICKER_ITEM_H;

      // Stop when position and stretch are settled (including wheel impulse)
      const dist = Math.abs(scrollTarget - scrollCurrent);
      if (dist < 0.6 && scrollStretch < 0.01 && Math.abs(scrollVel) < 3 && wheelVel === 0) {
        scrollRafId = null;
        return;
      }

      scrollRafId = requestAnimationFrame(tick) as unknown as number;
    };

    scrollRafId = requestAnimationFrame(tick) as unknown as number;
  }

  // Only regenerate tiles when we move into a new center cell
  let lastCenterCol: number = Number.NaN;
  let lastCenterRow: number = Number.NaN;

function getCenterCell(): { col: number; row: number } {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  const col = Math.floor((-currentOffsetX + viewportWidth / 2) / CELL_SIZE);
  const row = Math.floor((-currentOffsetY + viewportHeight / 2) / CELL_SIZE);

  return { col, row };
}

// Calculate visible tiles based on offset
function getVisibleTiles(): Tile[] {
  const tiles: Tile[] = [];

  const { col: centerCol, row: centerRow } = getCenterCell();

  const halfGrid = Math.ceil(GRID_SIZE / 2);

  for (let row = centerRow - halfGrid; row <= centerRow + halfGrid; row++) {
    for (let col = centerCol - halfGrid; col <= centerCol + halfGrid; col++) {
      const imageIndex =
        ((row % TOTAL_IMAGES) + TOTAL_IMAGES) % TOTAL_IMAGES;
      const altIndex =
        ((col % TOTAL_IMAGES) + TOTAL_IMAGES) % TOTAL_IMAGES;
      const finalIndex = (imageIndex + altIndex) % TOTAL_IMAGES;

      tiles.push({
        x: col * CELL_SIZE,
        y: row * CELL_SIZE,
        image: images[finalIndex]
      });
    }
  }

  return tiles;
}

let visibleTiles: Tile[] = [];

  function startAnimationLoop(): void {
    if (rafId !== null) return;

    const tick = (): void => {
      const now = performance.now();
      if (lastRafTime === 0) lastRafTime = now;

      // dt in seconds, clamped to avoid giant jumps on tab-switch
      const dt = Math.min(0.05, (now - lastRafTime) / 1000);
      lastRafTime = now;

      // Smoothly approach the target offsets (frame-rate independent)
      const resp = isDragging ? DRAG_RESP : INERTIA_RESP;
      const alpha = 1 - Math.exp(-resp * dt);

      currentOffsetX += (targetOffsetX - currentOffsetX) * alpha;
      currentOffsetY += (targetOffsetY - currentOffsetY) * alpha;

      // During inertia (not dragging), advance target by decaying velocity (px/s)
      if (!isDragging) {
        const friction = Math.exp(-FRICTION_PER_SEC * dt);
        velocityX *= friction;
        velocityY *= friction;

        targetOffsetX += velocityX * dt;
        targetOffsetY += velocityY * dt;

        const speed = Math.hypot(velocityX, velocityY);
        if (speed < STOP_SPEED) {
          velocityX = 0;
          velocityY = 0;
        }
      }

      const { col, row } = getCenterCell();
      if (col !== lastCenterCol || row !== lastCenterRow || visibleTiles.length === 0) {
        lastCenterCol = col;
        lastCenterRow = row;
        visibleTiles = getVisibleTiles();
      }

      // Stop loop when we're effectively settled
      const dist = Math.hypot(targetOffsetX - currentOffsetX, targetOffsetY - currentOffsetY);
      const speed = Math.hypot(velocityX, velocityY);

      if (!isDragging && speed === 0 && dist < 0.25) {
        rafId = null;
        lastRafTime = 0;
        return;
      }

      rafId = requestAnimationFrame(tick) as unknown as number;
    };

    rafId = requestAnimationFrame(tick) as unknown as number;
  }
  
function handlePointerDown(e: PointerEvent): void {
  isDragging = true;

  // Capture pointer so we keep getting events even if cursor leaves the element
  container?.setPointerCapture?.(e.pointerId);

  startX = e.clientX;
  startY = e.clientY;

  offsetX = currentOffsetX;
  offsetY = currentOffsetY;

  // Reset inertia tracking (velocity in px/s)
  velocityX = 0;
  velocityY = 0;

  const now = performance.now();
  lastMoveTime = now;
  lastClientX = e.clientX;
  lastClientY = e.clientY;

  // Start targets from current position
  targetOffsetX = currentOffsetX;
  targetOffsetY = currentOffsetY;

  startAnimationLoop();
}

function handlePointerMove(e: PointerEvent): void {
  if (!isDragging) return;

  const deltaX: number = e.clientX - startX;
  const deltaY: number = e.clientY - startY;

  targetOffsetX = offsetX + deltaX;
  targetOffsetY = offsetY + deltaY;

  // Velocity estimate in px/s
  const now = performance.now();
  const dt = Math.max(0.001, (now - lastMoveTime) / 1000);

  const dx = e.clientX - lastClientX;
  const dy = e.clientY - lastClientY;

  const vx = dx / dt;
  const vy = dy / dt;

  // Low-pass filter so momentum is smooth (avoids jitter from event timing)
  velocityX += (vx - velocityX) * VEL_SMOOTH;
  velocityY += (vy - velocityY) * VEL_SMOOTH;

  lastMoveTime = now;
  lastClientX = e.clientX;
  lastClientY = e.clientY;

  startAnimationLoop();
}

function handlePointerUp(e: PointerEvent): void {
  if (!isDragging) return;
  isDragging = false;

  container?.releasePointerCapture?.(e.pointerId);

  velocityX *= INERTIA_BOOST;
  velocityY *= INERTIA_BOOST;

  // Keep inertia going from last measured velocity
  startAnimationLoop();
}
  
onMount((): void => {
    // Center the grid by offsetting to show middle tiles centered in viewport
    const viewportWidth: number = window.innerWidth;
    const viewportHeight: number = window.innerHeight;

    // We want tile at position (0,0) to be centered, so offset by half viewport minus half cell
    currentOffsetX = viewportWidth / 2;
    currentOffsetY = viewportHeight / 2;

    targetOffsetX = currentOffsetX;
    targetOffsetY = currentOffsetY;

    // Prime tile cache
    const { col, row } = getCenterCell();
    lastCenterCol = col;
    lastCenterRow = row;

    visibleTiles = getVisibleTiles();
    startAnimationLoop();

    if (screen === 'scroll') enableScrollMode();
});

onDestroy(() => {
  disableScrollMode();
});
</script>


<svelte:window
  on:pointermove={handlePointerMove}
  on:pointerup={handlePointerUp}
  on:pointercancel={handlePointerUp}
/>
<div class="container">
  <div class="topbar">
    <button class:active={screen === 'grid'} on:click={() => setScreen('grid')}>
      Infinite grid
    </button>
    <button class:active={screen === 'scroll'} on:click={() => setScreen('scroll')}>
      Scroll
    </button>
  </div>

  {#if screen === 'grid'}
    <div
      class="grid"
      class:dragging={isDragging}
      bind:this={container}
      on:pointerdown={handlePointerDown}
      role="application"
      tabindex="0"
    >
      <div class="gridInner" style="transform: translate3d({currentOffsetX}px, {currentOffsetY}px, 0);">
        {#each visibleTiles as tile (tile.x + '_' + tile.y)}
          <div
            class="tile"
            style="transform: translate3d({tile.x}px, {tile.y}px, 0);"
          >
            <img src={tile.image.url} alt="Grid item {tile.image.id}" draggable="false" decoding="async" />
          </div>
        {/each}
      </div>
    </div>
  {:else}
    <div class="scrollViewport" bind:this={scrollViewport}>
      <div class="picker">

        {#each pickerSlots as slot, i (slot)}
          <div
            class="scrollItem pickerItem"
            use:scrollItemRef={i}
            style="
              top: calc(50% + {(slot * PICKER_ITEM_H - scrollFrac)}px);
              opacity: {0.55 + 0.45 * slotWeight(slot)};
              transform: translateY(-50%);
            "
          >
            <div
              class="pickerLabel"
              style="
                transform-origin: {scrollDir > 0 ? '50% 0%' : '50% 100%'};
                transform: translateY({scrollDir * scrollStretch * slotWeight(slot) * 14}px)
                  scaleY({
                    Math.max(
                      1
                        + scrollStretch * slotWeight(slot) * STRETCH_MAX_Y
                        - scrollStretch * (1 - slotWeight(slot)) * EDGE_SHRINK_MAX_Y,
                      MIN_SCALE_Y
                    )
                  });
              "
            >
              {scrollProjects[((scrollBaseIndex + slot) % scrollProjects.length + scrollProjects.length) % scrollProjects.length]}
            </div>
          </div>
        {/each}
      </div>

      <div class="scrollHint">Scroll like iOS picker</div>
    </div>
  {/if}
  
  <div class="instructions">
    {#if screen === 'grid'}
      Click and drag to explore the endless grid
    {:else}
      Scroll to animate the text list
    {/if}
  </div>
</div>

<style>
  .container {
    width: 100vw;
    height: 100vh;
    overflow: hidden;
    position: relative;
    background: #1a1a1a;
  }

  .topbar {
    position: absolute;
    top: 16px;
    left: 16px;
    display: flex;
    gap: 10px;
    z-index: 10;
  }

  .topbar button {
    appearance: none;
    border: 1px solid rgba(255, 255, 255, 0.18);
    background: rgba(0, 0, 0, 0.35);
    color: rgba(255, 255, 255, 0.92);
    padding: 10px 12px;
    border-radius: 10px;
    font-family: system-ui, -apple-system, sans-serif;
    font-size: 13px;
    cursor: pointer;
    backdrop-filter: blur(10px);
  }

  .topbar button.active {
    background: rgba(255, 255, 255, 0.92);
    color: #111;
    border-color: rgba(255, 255, 255, 0.35);
  }

  .scrollViewport {
    position: absolute;
    inset: 0;
    overflow: hidden;
    background: #0b0b0b;
    color: #fff;
    touch-action: none;
  }

  .scrollViewport::before,
  .scrollViewport::after {
    content: "";
    position: absolute;
    left: 0;
    right: 0;
    height: 28%;
    z-index: 2;
    pointer-events: none;
  }

  .scrollViewport::before {
    top: 0;
    background: linear-gradient(to bottom, rgba(11,11,11,1), rgba(11,11,11,0));
  }

  .scrollViewport::after {
    bottom: 0;
    background: linear-gradient(to top, rgba(11,11,11,1), rgba(11,11,11,0));
  }

  .picker {
    position: absolute;
    inset: 0;
    z-index: 1;
  }


  .pickerItem {
    position: absolute;
    left: 8vw;
    right: 8vw;
    height: 112px; /* must match PICKER_ITEM_H */
    display: flex;
    align-items: center;
    transform-origin: center;
    will-change: transform, opacity;
  }

  .scrollItem {
    font: 700 clamp(44px, 7vw, 120px) / 0.95 system-ui, -apple-system, sans-serif;
    letter-spacing: -0.03em;
    user-select: none;
    transform-origin: center;
    will-change: transform, opacity;
  }

  .pickerLabel {
    width: 100%;
    transform-origin: center;
    will-change: transform;
    display: inline-block;
    backface-visibility: hidden;
  }

  .scrollHint {
    position: absolute;
    bottom: 22px;
    right: 22px;
    color: rgba(255, 255, 255, 0.7);
    font-family: system-ui, -apple-system, sans-serif;
    font-size: 13px;
    pointer-events: none;
  }
  
  .grid {
    width: 100%;
    height: 100%;
    cursor: grab;
    position: relative;
    touch-action: none;
    will-change: transform;
  }
  
  .grid.dragging {
    cursor: grabbing;
  }

  .gridInner {
    position: absolute;
    inset: 0;
    will-change: transform;
  }
  
  .tile {
    position: absolute;
    width: 200px;
    height: 200px;
    padding: 12px;
    box-sizing: border-box;
  }
  
  .tile img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    border-radius: 8px;
    user-select: none;
    pointer-events: none;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  }
  
  .instructions {
    position: absolute;
    bottom: 20px;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(255, 255, 255, 0.9);
    padding: 12px 24px;
    border-radius: 8px;
    font-family: system-ui, -apple-system, sans-serif;
    font-size: 14px;
    color: #1a1a1a;
    pointer-events: none;
    box-shadow: 0 2px 12px rgba(0, 0, 0, 0.2);
  }
</style>