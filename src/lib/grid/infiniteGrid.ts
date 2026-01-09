import { writable, type Writable } from "svelte/store";
import type { Image, Tile } from "$lib/types";

export type GridController = ReturnType<typeof createInfiniteGrid>;

export function createInfiniteGrid(opts: {
  cellSize: number;
  gridSize: number;
  images: Image[];
}) {
  const { cellSize, gridSize, images } = opts;

  // Public stores
  const visibleTiles: Writable<Tile[]> = writable([]);
  const currentOffsetX = writable(0);
  const currentOffsetY = writable(0);
  const isDraggingStore = writable(false);

  // Internal state
  let container: HTMLDivElement | null = null;

  let isPointerDown = false;
  let isDragging = false;
  const DRAG_THRESHOLD_PX = 4;

  let startX = 0;
  let startY = 0;

  let offsetX = 0;
  let offsetY = 0;

  let targetOffsetX = 0;
  let targetOffsetY = 0;

  // dt smoothing
  let lastRafTime = 0;
  let rafId: number | null = null;

  // Feel
  const DRAG_RESP = 12;
  const INERTIA_RESP = 10;
  const FRICTION_PER_SEC = 3.2;
  const STOP_SPEED = 8;

  let velocityX = 0;
  let velocityY = 0;

  const VEL_SMOOTH = 0.18;
  const INERTIA_BOOST = 1.35;

  let lastMoveTime = 0;
  let lastClientX = 0;
  let lastClientY = 0;

  let lastCenterCol = Number.NaN;
  let lastCenterRow = Number.NaN;

  function getCenterCell(cx: number, cy: number) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const col = Math.floor((-cx + vw / 2) / cellSize);
    const row = Math.floor((-cy + vh / 2) / cellSize);
    return { col, row };
  }

  function computeVisibleTiles(cx: number, cy: number): Tile[] {
    const tiles: Tile[] = [];
    const { col: centerCol, row: centerRow } = getCenterCell(cx, cy);
    const halfGrid = Math.ceil(gridSize / 2);
    const total = images.length;

    for (let row = centerRow - halfGrid; row <= centerRow + halfGrid; row++) {
      for (let col = centerCol - halfGrid; col <= centerCol + halfGrid; col++) {
        const imageIndex = ((row % total) + total) % total;
        const altIndex = ((col % total) + total) % total;
        const finalIndex = (imageIndex + altIndex) % total;

        tiles.push({
          x: col * cellSize,
          y: row * cellSize,
          image: images[finalIndex],
        });
      }
    }
    return tiles;
  }

  function ensureTiles(cx: number, cy: number) {
    const { col, row } = getCenterCell(cx, cy);
    if (col !== lastCenterCol || row !== lastCenterRow) {
      lastCenterCol = col;
      lastCenterRow = row;
      visibleTiles.set(computeVisibleTiles(cx, cy));
    }
  }

  function startLoop() {
    if (rafId !== null) return;

    const tick = () => {
      const now = performance.now();
      if (!lastRafTime) lastRafTime = now;
      const dt = Math.min(0.05, (now - lastRafTime) / 1000);
      lastRafTime = now;

      let cx = 0;
      let cy = 0;
      currentOffsetX.update((v) => ((cx = v), v));
      currentOffsetY.update((v) => ((cy = v), v));

      const resp = isDragging ? DRAG_RESP : INERTIA_RESP;
      const alpha = 1 - Math.exp(-resp * dt);

      cx += (targetOffsetX - cx) * alpha;
      cy += (targetOffsetY - cy) * alpha;

      // inertia
      if (!isDragging) {
        const friction = Math.exp(-FRICTION_PER_SEC * dt);
        velocityX *= friction;
        velocityY *= friction;

        targetOffsetX += velocityX * dt;
        targetOffsetY += velocityY * dt;

        if (Math.hypot(velocityX, velocityY) < STOP_SPEED) {
          velocityX = 0;
          velocityY = 0;
        }
      }

      currentOffsetX.set(cx);
      currentOffsetY.set(cy);

      ensureTiles(cx, cy);

      const dist = Math.hypot(targetOffsetX - cx, targetOffsetY - cy);
      const speed = Math.hypot(velocityX, velocityY);

      if (!isDragging && speed === 0 && dist < 0.25) {
        rafId = null;
        lastRafTime = 0;
        return;
      }

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
  }

  function bind(el: HTMLDivElement) {
    container = el;
  }

  function centerInViewport() {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const cx = vw / 2;
    const cy = vh / 2;

    currentOffsetX.set(cx);
    currentOffsetY.set(cy);

    targetOffsetX = cx;
    targetOffsetY = cy;

    ensureTiles(cx, cy);
    startLoop();
  }

  function onPointerDown(e: PointerEvent) {
    if (!container) return;

    isPointerDown = true;
    isDragging = false;
    isDraggingStore.set(false);

    startX = e.clientX;
    startY = e.clientY;

    let cx = 0;
    let cy = 0;
    currentOffsetX.update((v) => ((cx = v), v));
    currentOffsetY.update((v) => ((cy = v), v));

    offsetX = cx;
    offsetY = cy;

    velocityX = 0;
    velocityY = 0;

    const now = performance.now();
    lastMoveTime = now;
    lastClientX = e.clientX;
    lastClientY = e.clientY;

    targetOffsetX = cx;
    targetOffsetY = cy;

    startLoop();
  }

  function onPointerMove(e: PointerEvent) {
    if (!isPointerDown) return;

    // Only start dragging after threshold (prevents click = drag)
    if (!isDragging) {
      const dx0 = e.clientX - startX;
      const dy0 = e.clientY - startY;
      if (Math.hypot(dx0, dy0) < DRAG_THRESHOLD_PX) return;

      isDragging = true;
      isDraggingStore.set(true);
      container?.setPointerCapture?.(e.pointerId);

      // reset baseline at drag start so it doesn't jump
      let cx = 0;
      let cy = 0;
      currentOffsetX.update((v) => ((cx = v), v));
      currentOffsetY.update((v) => ((cy = v), v));
      offsetX = cx;
      offsetY = cy;

      const now0 = performance.now();
      lastMoveTime = now0;
      lastClientX = e.clientX;
      lastClientY = e.clientY;

      targetOffsetX = cx;
      targetOffsetY = cy;
    }

    const deltaX = e.clientX - startX;
    const deltaY = e.clientY - startY;

    targetOffsetX = offsetX + deltaX;
    targetOffsetY = offsetY + deltaY;

    const now = performance.now();
    const dt = Math.max(0.001, (now - lastMoveTime) / 1000);

    const dx = e.clientX - lastClientX;
    const dy = e.clientY - lastClientY;

    const vx = dx / dt;
    const vy = dy / dt;

    velocityX += (vx - velocityX) * VEL_SMOOTH;
    velocityY += (vy - velocityY) * VEL_SMOOTH;

    lastMoveTime = now;
    lastClientX = e.clientX;
    lastClientY = e.clientY;

    startLoop();
  }

  function onPointerUp(e: PointerEvent) {
    if (!isPointerDown) return;
    isPointerDown = false;

    if (!isDragging) {
      isDraggingStore.set(false);
      return;
    }

    isDragging = false;
    isDraggingStore.set(false);

    container?.releasePointerCapture?.(e.pointerId);

    velocityX *= INERTIA_BOOST;
    velocityY *= INERTIA_BOOST;

    startLoop();
  }

  return {
    // stores
    visibleTiles,
    currentOffsetX,
    currentOffsetY,
    isDragging: isDraggingStore,

    // methods
    bind,
    centerInViewport,
    onPointerDown,
    onPointerMove,
    onPointerUp,
  };
}