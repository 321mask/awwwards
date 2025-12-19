<script lang="ts">
  import { onMount } from 'svelte';
  
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
});
</script>


<svelte:window
  on:pointermove={handlePointerMove}
  on:pointerup={handlePointerUp}
  on:pointercancel={handlePointerUp}
/>
<div class="container">
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
  
  <div class="instructions">
    Click and drag to explore the endless grid
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