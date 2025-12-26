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

  // --- Scroll screen (smooth/inertial virtual scroll + velocity-based distortion) ---
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
let scrollWrap: HTMLDivElement | null = null;
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

  let scrollTarget = 0;    // px
  let scrollCurrent = 0;   // px
  let scrollVel = 0;       // px/s (smoothed)
  let scrollPrev = 0;

  let scrollRafId: number | null = null;
  let scrollLastT = 0;

  // Tune the scroll feel
  const SCROLL_RESP = 7.5;        // lower = floatier
  const SCROLL_FRICTION_PER_SEC = 2.4; // lower = longer glide
  const SCROLL_MAX_VEL = 2600;    // clamp px/s

  function clamp(n: number, a: number, b: number): number {
    return Math.max(a, Math.min(b, n));
  }

  function enableScrollMode(): void {
    if (typeof window === 'undefined') return;
    // Reset so it always feels consistent when switching in
    scrollTarget = 0;
    scrollCurrent = 0;
    scrollVel = 0;
    scrollPrev = 0;
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
  }

  function onWheelScroll(e: WheelEvent): void {
    if (typeof window === 'undefined') return;
    if (screen !== 'scroll') return;
    e.preventDefault();

    // Trackpads can be tiny deltas; normalize a bit for "designed" feel
    scrollTarget += e.deltaY;
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

      // Ease current -> target (frame-rate independent)
      const alpha = 1 - Math.exp(-SCROLL_RESP * dt);
      scrollCurrent += (scrollTarget - scrollCurrent) * alpha;

      // Velocity (px/s) + friction smoothing
      const rawVel = (scrollCurrent - scrollPrev) / Math.max(0.0001, dt);
      scrollPrev = scrollCurrent;

      const friction = Math.exp(-SCROLL_FRICTION_PER_SEC * dt);
      scrollVel = scrollVel * friction + rawVel * (1 - friction);
      scrollVel = clamp(scrollVel, -SCROLL_MAX_VEL, SCROLL_MAX_VEL);

      // Virtual scroll translate
      if (scrollWrap) {
        scrollWrap.style.transform = `translate3d(0, ${-scrollCurrent}px, 0)`;
      }

      // Distortion per item (strongest around center)
      const vh = window.innerHeight;
      const vNorm = scrollVel / SCROLL_MAX_VEL; // -1..1

      for (const el of scrollItems) {
        if (!el) continue;
        const r = el.getBoundingClientRect();
        const y = (r.top + r.height / 2) / vh;   // 0..1
        const w = Math.sin(y * Math.PI);         // 0..1..0

        // Strong rubber stretch: use a non-linear curve so small scrolls don't overreact,
        // but fast scrolls stretch a lot.
        const vAbs = Math.abs(vNorm);
        const vEase = Math.pow(vAbs, 0.6); // 0..1, more “punch” at higher speeds

        // Really noticeable vertical stretch (up to ~2.4x in the center at max speed)
        const stretchY = 1 + vEase * 1.4 * w;

        // Counter-squash X so it feels like elastic material
        const squashX = 1 - vEase * 0.28 * w;

        // No translate bounce — pure stretch
        el.style.transform = `scaleX(${squashX}) scaleY(${stretchY})`;
      }

      // Stop when settled
      const dist = Math.abs(scrollTarget - scrollCurrent);
      const speed = Math.abs(scrollVel);

      if (dist < 0.3 && speed < 12) {
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
      <div class="scrollWrap" bind:this={scrollWrap}>
        {#each scrollProjects as p, i (p)}
          <div class="scrollItem" use:scrollItemRef={i}>
            {p}
          </div>
        {/each}
      </div>
      <div class="scrollHint">Use mouse wheel / trackpad to scroll</div>
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

  .scrollWrap {
    will-change: transform;
    padding: 14vh 8vw;
    transform: translate3d(0, 0, 0);
  }

  .scrollItem {
    font: 700 clamp(44px, 7vw, 120px) / 0.95 system-ui, -apple-system, sans-serif;
    letter-spacing: -0.03em;
    padding: 18px 0;
    transform-origin: center;
    will-change: transform;
    user-select: none;
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