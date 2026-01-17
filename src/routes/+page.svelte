<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { createWebGLScene } from "$lib/webgl/WebGLScene";
  import { createMeshManager } from "$lib/webgl/MeshManager";
  import { createScrollVelocity } from "$lib/utils/scrollVelocity";
  import { createScrollEvents } from "$lib/utils/scrollEvents";
  import { createInfiniteScroll } from "$lib/utils/infiniteScroll";
  import { brands } from "$lib/config/scrollConfig";

  type Screen = "grid" | "scroll";

let screen: Screen = "grid";


const SHOW_COLUMN_GUIDES = true;

const TILE_BLEED_PX = 64; // extra padding around each repeating tile so dragged images can overflow without being clipped

// Grid sizing (must match CSS)
const GRID_COLS = 12;
const GRID_ROWS = 7;
const GRID_ROW_H = 150;
const GRID_GUTTER = 16;
const GRID_PADDING = 16; // .tileInner padding

function baseTileW() {
  // Prefer the actual grid viewport size (more reliable during intro/hydration)
  const w = gridViewport?.clientWidth ?? vw;
  return w || 0;
}

function baseTileH() {
  // total grid height = rows*rowH + (rows-1)*gutter, plus top+bottom padding
  const gridH = GRID_ROWS * GRID_ROW_H + (GRID_ROWS - 1) * GRID_GUTTER;
  const contentH = gridH + GRID_PADDING * 2;

  // Prefer the actual grid viewport size (more reliable during intro/hydration)
  const h = gridViewport?.clientHeight ?? vh;
  return Math.max(h || 0, contentH);
}

  // --- Scroll screen (WebGL + DOM list) ---
  let canvasElement: HTMLCanvasElement | null = null;
  let scrollContainerElement: HTMLDivElement | null = null;
  let listItems: HTMLLIElement[] = [];

  function listItemRef(node: HTMLLIElement, index: number) {
    listItems[index] = node;
    return {
      destroy() {
        if (listItems[index] === node) listItems[index] = undefined as unknown as HTMLLIElement;
      }
    };
  }

  // WebGL scroll runtime handles (so we can start/stop when toggling screens)
  let scrollInited = false;
  let scrollRunning = false;
  let scrollRaf: number | null = null;

  let webglScene: ReturnType<typeof createWebGLScene> | null = null;
  let meshManager: ReturnType<typeof createMeshManager> | null = null;
  let scrollVelocity: ReturnType<typeof createScrollVelocity> | null = null;
  let scrollEvents: ReturnType<typeof createScrollEvents> | null = null;
  let infiniteScroll: ReturnType<typeof createInfiniteScroll> | null = null;

  let scrollCleanup: (() => void) | null = null;

  // --- Infinite grid camera (repeating “page tiles”) ---
  let gridViewport: HTMLDivElement | null = null;

  let camX = 0;
  let camY = 0;
  let camTargetX = 0;
  let camTargetY = 0;

  let isPointerDown = false;
  let isDragging = false;
  const DRAG_THRESHOLD_PX = 4;

  let startX = 0;
  let startY = 0;
  let startCamX = 0;
  let startCamY = 0;

  let velX = 0; // px/s
  let velY = 0; // px/s
  let lastMoveT = 0;
  let lastPX = 0;
  let lastPY = 0;

  let rafCam: number | null = null;
  let lastRafT = 0;

  const DRAG_RESP = 14;
  const INERTIA_RESP = 10;
  const FRICTION_PER_SEC = 3.0;
  const STOP_SPEED = 10;
  const VEL_SMOOTH = 0.18;
  const INERTIA_BOOST = 1.25;

let vw = 0;
let vh = 0;
let ro: ResizeObserver | null = null;

// Per-device starting Y offset for the infinite grid (matches Figma exports)
// Air 13" 1280x800  -> -16
// Pro 14" 1512x945  -> -39
// Pro 16" 1728x1080 -> -52
let gridYOffset = 0;

function computeGridYOffset(w: number, _h: number) {
  // Key off width only because browser UI (Safari top bar, etc.) makes innerHeight unreliable.
  const targets = [
    { w: 1280, y: -16 }, // MacBook Air 13"
    { w: 1512, y: -39 }, // MacBook Pro 14"
    { w: 1728, y: -52 }  // MacBook Pro 16"
  ];

  // Pick the closest target by absolute width distance
  let best = targets[0];
  let bestD = Number.POSITIVE_INFINITY;
  for (const t of targets) {
    const d = Math.abs(w - t.w);
    if (d < bestD) {
      bestD = d;
      best = t;
    }
  }

  return best.y;
}

function readViewportSize() {
  if (typeof window === "undefined") {
    vw = 0;
    vh = 0;
    return;
  }

  // Prefer actual element size when mounted; fall back to window.
  const nextVW = gridViewport?.clientWidth ?? window.innerWidth;
  const nextVH = gridViewport?.clientHeight ?? window.innerHeight;

  // Update viewport vars
  vw = nextVW;
  vh = nextVH;

  // Update the baseline grid offset, but do NOT interfere mid-drag.
  const nextOffset = computeGridYOffset(vw, vh);
  if (nextOffset !== gridYOffset) {
    const diff = nextOffset - gridYOffset;
    gridYOffset = nextOffset;

    // Keep the visual position stable while changing device presets.
    // Only apply when not actively dragging/pressing.
    if (!isPointerDown && !isDragging) {
      camY += diff;
      camTargetY += diff;
    }
  }
}

  function startCamLoop() {
    if (rafCam !== null) return;

    const tick = () => {
      const now = performance.now();
      if (!lastRafT) lastRafT = now;
      const dt = Math.min(0.05, (now - lastRafT) / 1000);
      lastRafT = now;

      const resp = isDragging ? DRAG_RESP : INERTIA_RESP;
      const a = 1 - Math.exp(-resp * dt);

      camX += (camTargetX - camX) * a;
      camY += (camTargetY - camY) * a;

      if (!isDragging) {
        const fr = Math.exp(-FRICTION_PER_SEC * dt);
        velX *= fr;
        velY *= fr;

        camTargetX += velX * dt;
        camTargetY += velY * dt;

        if (Math.hypot(velX, velY) < STOP_SPEED) {
          velX = 0;
          velY = 0;
        }
      }

      const dist = Math.hypot(camTargetX - camX, camTargetY - camY);
      const speed = Math.hypot(velX, velY);

      if (!isDragging && speed === 0 && dist < 0.2) {
        rafCam = null;
        lastRafT = 0;
        return;
      }

      rafCam = requestAnimationFrame(tick);
    };

    rafCam = requestAnimationFrame(tick);
  }

  function onGridPointerDown(e: PointerEvent) {
    // Prevent any native selection/drag behavior while initiating a drag
    e.preventDefault();
    if (screen !== "grid") return;

    isPointerDown = true;
    isDragging = false;

    startX = e.clientX;
    startY = e.clientY;

    startCamX = camX;
    startCamY = camY;

    camTargetX = camX;
    camTargetY = camY;

    velX = 0;
    velY = 0;

    const now = performance.now();
    lastMoveT = now;
    lastPX = e.clientX;
    lastPY = e.clientY;

    gridViewport?.setPointerCapture?.(e.pointerId);

    startCamLoop();
  }

  function onGridPointerMove(e: PointerEvent) {
    if (screen !== "grid") return;
    if (!isPointerDown) return;

    const dx0 = e.clientX - startX;
    const dy0 = e.clientY - startY;

    if (!isDragging) {
      if (Math.hypot(dx0, dy0) < DRAG_THRESHOLD_PX) return;
      isDragging = true;
    }

    camTargetX = startCamX + dx0;
    camTargetY = startCamY + dy0;

    const now = performance.now();
    const dt = Math.max(0.001, (now - lastMoveT) / 1000);

    const dx = e.clientX - lastPX;
    const dy = e.clientY - lastPY;

    const vx = dx / dt;
    const vy = dy / dt;

    velX += (vx - velX) * VEL_SMOOTH;
    velY += (vy - velY) * VEL_SMOOTH;

    lastMoveT = now;
    lastPX = e.clientX;
    lastPY = e.clientY;

    startCamLoop();
  }

  function onGridPointerUp(e: PointerEvent) {
    if (screen !== "grid") return;
    if (!isPointerDown) return;

    isPointerDown = false;

    gridViewport?.releasePointerCapture?.(e.pointerId);

    if (!isDragging) return;

    isDragging = false;
    velX *= INERTIA_BOOST;
    velY *= INERTIA_BOOST;

    startCamLoop();
  }

  // 3x3 repeating tiles around the current “page index”
  const tileOffsets = [-1, 0, 1];
  function floorDiv(a: number, b: number) {
    return Math.floor(a / b);
  }
  function mod(n: number, m: number) {
    return ((n % m) + m) % m;
  }

  function tileIndexX() {
    // camera translate moves world; invert so index follows world position
    const tw = baseTileW();
    return tw ? floorDiv(-camX, tw) : 0;
  }
  function tileIndexY() {
    const th = baseTileH();
    return th ? floorDiv(-camY, th) : 0;
  }

  function tileLeft(ix: number) {
    return ix * baseTileW();
  }
  function tileTop(iy: number) {
    return iy * baseTileH();
  }

  function setScreen(next: Screen) {
    screen = next;
    if (typeof window === "undefined") return;

    if (screen === "scroll") {
      startWebGLScroll();
    } else {
      stopWebGLScroll();
    }
  }

  function initWebGLScroll() {
    if (scrollInited) return;
    if (typeof window === "undefined") return;
    if (!canvasElement || !scrollContainerElement) return;

    // Initialize systems
    webglScene = createWebGLScene(canvasElement);
    meshManager = createMeshManager(webglScene.scene);
    scrollVelocity = createScrollVelocity();
    infiniteScroll = createInfiniteScroll();
    scrollEvents = createScrollEvents(scrollContainerElement, scrollVelocity);

    function initialize() {
      if (!infiniteScroll || !meshManager) return;

      // Calculate item height from first element
      if (listItems[0]) {
        const rect = listItems[0].getBoundingClientRect();
        infiniteScroll.initialize(rect.height, brands.length);
      }

      // Create meshes and setup interactions
      meshManager.createMeshes(brands, listItems);
      meshManager.setupHoverHandlers(listItems);

      // Attach scroll event listeners
      scrollEvents?.attach();
    }

    // Wait for DOM to render
    window.setTimeout(initialize, 0);

    function updatePositions(scrollY: number, velocity: number) {
      if (!infiniteScroll || !infiniteScroll.isReady || !meshManager) return;

      const inf = infiniteScroll;
      const mm = meshManager;

      listItems.forEach((item, index) => {
        if (!item) return;

        const y = inf.calculateItemPosition(index, scrollY);
        item.style.transform = `translate3d(0, ${y}px, 0)`;

        const meshY = inf.calculateMeshY(y);
        const alpha = inf.calculateAlpha(meshY);
        mm.updateMesh(index, { x: 0, y: meshY }, velocity, alpha);
      });
    }

    function animate() {
      if (!scrollRunning) return;
      scrollRaf = requestAnimationFrame(animate);

      const sv = scrollVelocity?.update();
      if (!sv || !infiniteScroll || !meshManager || !infiniteScroll.isReady) return;

      const inf = infiniteScroll;
      const mm = meshManager;

      updatePositions(sv.scrollY, sv.velocity);
      webglScene?.render();
    }

    function onResize() {
      if (!webglScene || !meshManager || !infiniteScroll) return;

      const width = window.innerWidth;
      const height = window.innerHeight;

      webglScene.resize(width, height);
      meshManager.updateViewportSize(width, height);

      // Recalculate and recreate
      if (listItems[0]) {
        const rect = listItems[0].getBoundingClientRect();
        infiniteScroll.initialize(rect.height, brands.length);
      }

      meshManager.clear();
      meshManager.createMeshes(brands, listItems);
    }

    window.addEventListener("resize", onResize, { passive: true } as any);

    scrollCleanup = () => {
      window.removeEventListener("resize", onResize as any);
      scrollEvents?.detach();
      meshManager?.dispose();
      webglScene?.dispose();
      meshManager = null;
      webglScene = null;
      scrollVelocity = null;
      scrollEvents = null;
      infiniteScroll = null;
    };

    scrollInited = true;

    // Start immediately if we're on the scroll screen
    scrollRunning = true;
    animate();
  }

  function startWebGLScroll() {
    if (typeof window === "undefined") return;
    scrollRunning = true;

    // If markup isn't mounted yet, defer init to next tick
    if (!scrollInited) {
      window.setTimeout(() => {
        initWebGLScroll();
      }, 0);
      return;
    }

    // Resume animation loop
    if (scrollRaf === null) {
      const loop = () => {
        if (!scrollRunning) {
          scrollRaf = null;
          return;
        }

        scrollRaf = requestAnimationFrame(loop);

        const sv = scrollVelocity?.update();
        if (!sv || !infiniteScroll || !meshManager || !infiniteScroll.isReady) return;

        const inf = infiniteScroll;
        const mm = meshManager;

        listItems.forEach((item, index) => {
          if (!item) return;
          const y = inf.calculateItemPosition(index, sv.scrollY);
          item.style.transform = `translate3d(0, ${y}px, 0)`;
          const meshY = inf.calculateMeshY(y);
          const alpha = inf.calculateAlpha(meshY);
          mm.updateMesh(index, { x: 0, y: meshY }, sv.velocity, alpha);
        });

        webglScene?.render();
      };

      scrollRaf = requestAnimationFrame(loop);
    }
  }

  function stopWebGLScroll() {
    scrollRunning = false;
    if (scrollRaf !== null) {
      cancelAnimationFrame(scrollRaf);
      scrollRaf = null;
    }
  }

  // --- Editorial grid layout (12 columns) ---
  type GridItem =
    | {
        kind: "image";
        id: string;
        src: string;
        col: [number, number]; // [start, end)
        row: [number, number]; // [start, end)
        captionLeft?: string;
        captionRight?: string;
      }
    | {
        kind: "text";
        id: string;
        col: [number, number];
        row: [number, number];
        html: string;
        align?: "left" | "right";
      };

  // NOTE: gridItems positions are aligned to a 12-column grid and a 7-row baseline.
  const gridItems: GridItem[] = [
    // Row 1 (top)
    {
      kind: "image",
      id: "img-01",
      src: "https://picsum.photos/seed/renata-01/720/300",
      col: [2, 3],
      row: [1, 2],
      captionLeft: "01",
      captionRight: "london, uk"
    },

    {
      kind: "image",
      id: "img-02",
      src: "https://picsum.photos/seed/renata-02/940/360",
      col: [9, 11],
      row: [1, 2],
      captionLeft: "02",
      captionRight: "funchal, madeira"
    },

    // Row 3–4 cluster (matches Figma: one 2×2, one 2×1, several 1×1)
    {
      kind: "image",
      id: "img-04",
      src: "https://picsum.photos/seed/renata-04/1200/900",
      col: [1, 3],
      row: [3, 5],
      captionLeft: "04",
      captionRight: "étretat, france"
    },

    {
      kind: "image",
      id: "img-03",
      src: "https://picsum.photos/seed/renata-03/980/420",
      col: [6, 8],
      row: [2, 3],
      captionLeft: "03",
      captionRight: "eastbourne, uk"
    },

    {
      kind: "image",
      id: "img-05",
      src: "https://picsum.photos/seed/renata-05/520/680",
      col: [8, 9],
      row: [3, 4],
      captionLeft: "05",
      captionRight: "madeira"
    },

    {
      kind: "image",
      id: "img-06",
      src: "https://picsum.photos/seed/renata-06/1100/700",
      col: [5, 7],
      row: [4, 5],
      captionLeft: "06",
      captionRight: "gudauri, georgia"
    },

    {
      kind: "image",
      id: "img-07",
      src: "https://picsum.photos/seed/renata-07/520/620",
      col: [12, 13],
      row: [4, 5],
      captionLeft: "07",
      captionRight: "paris, france"
    },

    // Mid-lower composition
    {
      kind: "image",
      id: "img-08",
      src: "https://picsum.photos/seed/renata-08/520/680",
      col: [3, 4],
      row: [5, 6],
      captionLeft: "08",
      captionRight: "spain"
    },

    {
      kind: "image",
      id: "img-10",
      src: "https://picsum.photos/seed/renata-10/900/1200",
      col: [6, 8],
      row: [6, 8],
      captionLeft: "10",
      captionRight: "paris, france"
    },

    {
      kind: "image",
      id: "img-09",
      src: "https://picsum.photos/seed/renata-09/1400/900",
      col: [10, 12],
      row: [5, 7],
      captionLeft: "09",
      captionRight: "edinburgh, uk"
    },

    // Footer smalls
    {
      kind: "image",
      id: "img-11",
      src: "https://picsum.photos/seed/renata-11/420/420",
      col: [2, 3],
      row: [7, 8],
      captionLeft: "01",
      captionRight: "plane"
    },

    {
      kind: "image",
      id: "img-12",
      src: "https://picsum.photos/seed/renata-12/420/420",
      col: [9, 10],
      row: [7, 8],
      captionLeft: "01",
      captionRight: "plane"
    },

    // Bottom meta
    {
      kind: "text",
      id: "time-left",
      col: [1, 4],
      row: [7, 8],
      html: `<div class="metaSmall">ldn, uk_16:05</div>`,
      align: "left"
    },
    {
      kind: "text",
      id: "made-right",
      col: [10, 13],
      row: [7, 8],
      html: `<div class="metaSmall" style="text-align:right">made in 2025</div>`,
      align: "right"
    }
  ];

  // --- Animated title (center typing → becomes top-left logo) ---
  const FULL_TITLE = "renata zaripzianova — traveler, designer";
  let typed = "";
  let typingDone = false;
  let titleToLogo = false;
  let gridVisible = false;

  let typeTimer: number | null = null;
  let stageTimer1: number | null = null;
  let stageTimer2: number | null = null;

  function startTitleIntro() {
    // reset
    typed = "";
    typingDone = false;
    titleToLogo = false;
    gridVisible = false;

    let i = 0;
    const speed = 36; // ms per char

    typeTimer = window.setInterval(() => {
      i++;
      typed = FULL_TITLE.slice(0, i);
      if (i >= FULL_TITLE.length) {
        if (typeTimer) window.clearInterval(typeTimer);
        typeTimer = null;
        typingDone = true;

        // small pause, then travel to logo
        stageTimer1 = window.setTimeout(() => {
          titleToLogo = true;

          // Reveal the grid only AFTER the travel/scale animation finishes (matches the reference behavior)
          // Travel transition duration in CSS is 900ms; add a tiny buffer.
          stageTimer2 = window.setTimeout(() => {
            // Ensure viewport size is correct right before showing the grid
            readViewportSize();
            gridVisible = true;
          }, 940);
        }, 420);
      }
    }, speed);
  }

  onMount(() => {
    if (typeof window === "undefined") return;

    readViewportSize();

    // Start centered on the “home tile” with the correct per-device Y offset
    camX = 0;
    camY = gridYOffset;
    camTargetX = camX;
    camTargetY = camY;

    // start title intro on initial load only
    startTitleIntro();

    window.addEventListener("resize", readViewportSize, { passive: true } as any);
    ro = new ResizeObserver(() => readViewportSize());
    if (gridViewport) ro.observe(gridViewport);

    if (screen === "scroll") {
      startWebGLScroll();
    }
  });

  onDestroy(() => {
    if (typeof window === "undefined") return;

    stopWebGLScroll();
    scrollCleanup?.();
    scrollCleanup = null;
    window.removeEventListener("resize", readViewportSize);
    try { ro?.disconnect(); } catch {}

    if (typeTimer) window.clearInterval(typeTimer);
    if (stageTimer1) window.clearTimeout(stageTimer1);
    if (stageTimer2) window.clearTimeout(stageTimer2);
  });
</script>

<svelte:window
  on:pointermove={onGridPointerMove}
  on:pointerup={onGridPointerUp}
  on:pointercancel={onGridPointerUp}
/>

<div class="container">
  <div class="topbar">
    {#if screen === "grid" && gridVisible}
      <div class="menuButtons" aria-label="Primary navigation">
        <button class="menuBtn" type="button">intro</button>
        <button class="menuBtn" type="button">visited</button>
        <button class="menuBtn" type="button">about</button>
      </div>
    {/if}

    {#if gridVisible}
      <div class="modeButtons" aria-label="Mode toggle">
        <button class="modeBtn" class:active={screen === "grid"} on:click={() => setScreen("grid")} type="button">Grid</button>
        <button class="modeBtn" class:active={screen === "scroll"} on:click={() => setScreen("scroll")} type="button">Scroll</button>
      </div>
    {/if}
  </div>
  {#if screen === "grid"}
    <div
      class="gridViewport"
      bind:this={gridViewport}
      on:pointerdown={onGridPointerDown}
      class:dragging={isDragging}
      class:ready={gridVisible}
      role="application"
      tabindex="0"
    >
      {#if gridVisible}
        <!-- Fixed overlay (does NOT move with dragging/camera) -->
        <div class="fixedOverlay" aria-hidden="false">
          <div class="fixedOverlayGrid">
            <div class="fixedMeta" aria-label="travel stats">
              <span class="fixedMetaLine fixedMetaLine--1">been in <b>19</b> countries in the past 1.5 years,</span>
              <span class="fixedMetaLine fixedMetaLine--2">took 32 flights over the last year</span>
            </div>
          </div>
        </div>
      {/if}
      <div class="world" style="transform: translate3d({camX}px, {camY}px, 0);">
        {#each tileOffsets as ty (ty)}
          {#each tileOffsets as tx (tx)}
            {@const ix = tileIndexX() + tx}
            {@const iy = tileIndexY() + ty}

            <section
              class="pageTile"
              style="--tile-bleed:{TILE_BLEED_PX}px; left:{tileLeft(ix) - TILE_BLEED_PX}px; top:{tileTop(iy) - TILE_BLEED_PX}px; width:{baseTileW() + (TILE_BLEED_PX * 2)}px; height:{baseTileH() + (TILE_BLEED_PX * 2)}px;"
              aria-label={`tile-${ix}-${iy}`}
            >
              <div class="tileInner">
                <div class="contentGrid">
                  {#if SHOW_COLUMN_GUIDES}
                    <div class="gridGuides" aria-hidden="true" />
                  {/if}
                  {#each gridItems as it (it.id + '-' + ix + '-' + iy)}
                    {#if it.kind === "image"}
                      <figure
                        class="gridItem imageItem"
                        class:hasCaption={Boolean(it.captionLeft || it.captionRight)}
                        style="grid-column: {it.col[0]} / {it.col[1]}; grid-row: {it.row[0]} / {it.row[1]};"
                      >
                        <div class="media" aria-hidden="true">
                          <img src={it.src} alt={it.id} draggable="false" decoding="async" />
                        </div>
                        {#if it.captionLeft || it.captionRight}
                          <figcaption>
                            <span class="capLeft">{it.captionLeft}</span>
                            <span class="capRight">{it.captionRight}</span>
                          </figcaption>
                        {/if}
                      </figure>
                    {:else}
                      <div
                        class="gridItem textItem"
                        style="grid-column: {it.col[0]} / {it.col[1]}; grid-row: {it.row[0]} / {it.row[1]};"
                      >
                        {@html it.html}
                      </div>
                    {/if}
                  {/each}
                </div>
              </div>
            </section>
          {/each}
        {/each}
      </div>
    </div>
  {/if}

  {#if screen === "grid"}
    <div class="titleIntro" class:toLogo={titleToLogo}>
      <div class="titleText">
        {typed}<span class="cursor" class:hide={typingDone}>█</span>
      </div>
    </div>
  {:else}
    <div bind:this={scrollContainerElement} class="scrollWebGL">
      <canvas bind:this={canvasElement} class="scrollCanvas"></canvas>

      <ul class="scrollList">
        {#each brands as brand, i (brand)}
          <li use:listItemRef={i} class="scrollListItem">
            {brand}
          </li>
        {/each}
      </ul>
    </div>
  {/if}
</div>

<style>
  :global(body) {
    margin: 0;
  }

  /* Responsive layout tokens (simplified) */
  :global(:root) {
    --text-h: 16px;
  }

  /* MacBook Pro 16" */
  @media (min-width: 1700px) {
    :global(:root) {
      --text-h: 20px;
    }
  }

  .container {
    position: relative;
    width: 100vw;
    height: 100vh;
    overflow: hidden;
    --page-bg: #fff;
    background: var(--page-bg);
    color: #111;
  }

  .topbar {
    position: absolute;
    top: 16px;
    right: 16px;
    left: auto;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 10px;
    z-index: 50;
    mix-blend-mode: difference;
  }

  .menuButtons {
    display: flex;
    flex-direction: column;
    gap: 6px;
    align-items: flex-end;
  }

  .modeButtons {
    display: flex;
    flex-direction: row;
    gap: 10px;
    align-items: center;
    justify-content: flex-end;
  }

  .menuBtn,
  .modeBtn {
    appearance: none;
    border: 1px solid rgba(0, 0, 0, 0.12);
    background: rgba(255, 255, 255, 0.65);
    color: rgba(0, 0, 0, 0.9);
    padding: 10px 12px;
    border-radius: 10px;
    font-family: system-ui, -apple-system, sans-serif;
    font-size: 13px;
    cursor: pointer;
    backdrop-filter: blur(10px);
    text-transform: lowercase;
  }

  .modeBtn.active {
    background: rgba(0, 0, 0, 0.9);
    color: #fff;
    border-color: rgba(0, 0, 0, 0.18);
  }

  /* GRID PAGE */
  .gridViewport {
    position: absolute;
    inset: 0;
    overflow: hidden;
    background: #fff;
    cursor: grab;
    touch-action: none;
    isolation: isolate;
    -webkit-user-select: none;
    user-select: none;
    -webkit-touch-callout: none;
  }
  /* Hard-disable selection/dragging across the entire app surface */
  .container,
  .container * {
    -webkit-user-select: none;
    user-select: none;
    -webkit-touch-callout: none;
  }

  /* Prevent images from becoming draggable/ghost-dragged */
  img {
    -webkit-user-drag: none;
    user-drag: none;
  }

  .gridViewport.dragging {
    cursor: grabbing;
  }

  .world {
    position: absolute;
    inset: 0;
    will-change: transform, opacity;
    opacity: 0;
    transition: opacity 420ms ease;
    pointer-events: none;
  }

  .gridViewport.ready .world {
    opacity: 1;
    pointer-events: auto;
  }

  .pageTile {
    position: absolute;
    box-sizing: border-box;
    background: #fff;
    overflow: hidden; /* CRITICAL: prevents neighboring repeated tiles from overlapping visually */
  }

  .tileInner {
    position: absolute;
    /* Inset the inner content by the tile bleed so dragging expansions have room
       before hitting the tile's clipping boundary. */
    inset: var(--tile-bleed, 0px);
    padding: 16px;
    box-sizing: border-box;

    /* Keep `.pageTile { overflow: hidden; }` so tiles don't bleed into each other,
       but DO NOT clip inside the tile, otherwise expansion into column/row gutters
       is cut off on the right/bottom and looks like it only grows up/left. */
    overflow: visible;
  }



  /* Content grid */
  .contentGrid {
    position: relative;
    width: 100%;
    height: 100%;

    /* Figma grid: 12 columns, 7 rows (150px each), 16px gutter, 16px frame padding */
    display: grid;
    grid-template-columns: repeat(12, minmax(0, 1fr));
    grid-template-rows: repeat(7, 150px);
    column-gap: 16px;
    row-gap: 16px;
    align-content: stretch;

    z-index: 1;

    --gutter: 16px;
    --half-gutter: 8px;
    --guide-line: rgba(0, 0, 0, 0.35);
    --colW: calc((100% - (11 * var(--gutter))) / 12);
    --rowH: 150px;
  }

  /* Fixed overlay aligned to the same 12×6 grid (does not move with camera) */
  .fixedOverlay {
    position: absolute;
    inset: 0;
    pointer-events: none;
    z-index: 40; /* above grid items and guides */

    opacity: 0;
    transition: opacity 220ms ease;
  }

  .gridViewport.ready .fixedOverlay {
    opacity: 1;
  }

  .fixedOverlayGrid {
    position: absolute;
    inset: 16px; /* same as .tileInner padding */
    display: grid;
    grid-template-columns: repeat(12, minmax(0, 1fr));
    grid-template-rows: repeat(7, 150px);
    column-gap: 16px;
    row-gap: 16px;
  }

  /* Place the meta text in the same cell area you used before: col 7-12, row 2-3 */
  .fixedMeta {
    grid-column: 7 / 12;
    grid-row: 1 / 3;

    font-family: "Satoshi", system-ui, -apple-system, sans-serif;
    font-size: 13px;
    line-height: 16px;
    font-weight: 500;
    font-style: normal;
    color: #000;

    /* prevent selection */
    user-select: none;
    -webkit-user-select: none;

    /* two separate lines exactly like in Figma */
    display: inline-flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0;
  }

  .fixedMetaLine {
    display: inline-block;
    /* safe padding around each line */
    padding: 2px 6px;
    background: var(--page-bg);
    /* keep each line on its own */
    white-space: nowrap;
  }

  /* Figma: the first line starts further to the right than the second line */
  .fixedMetaLine--1 {
    margin-left: 120px;
  }

  .fixedMetaLine--2 {
    margin-left: 0;
  }

  /* Grid guides overlay: 12 columns + 6 rows, 16px gutters, two thin lines at gutter edges */
  .gridGuides {
    position: absolute;
    inset: 0;
    pointer-events: none;
    z-index: 6;
    mix-blend-mode: multiply;

    /*
      We draw guides at the actual gutter edges: two 1px lines per gutter, at left/right and top/bottom edges.
      Pattern size for each track = track + gutter.
    */
    background-image:
      /* vertical line at right edge of each column */
      repeating-linear-gradient(
        to right,
        transparent 0,
        transparent calc(var(--colW) - 1px),
        var(--guide-line) calc(var(--colW) - 1px),
        var(--guide-line) var(--colW),
        transparent var(--colW),
        transparent calc(var(--colW) + var(--gutter))
      ),
      /* vertical line at left edge of each next column (i.e., right edge + gutter) */
      repeating-linear-gradient(
        to right,
        transparent 0,
        transparent calc(var(--colW) + var(--gutter) - 1px),
        var(--guide-line) calc(var(--colW) + var(--gutter) - 1px),
        var(--guide-line) calc(var(--colW) + var(--gutter)),
        transparent calc(var(--colW) + var(--gutter)),
        transparent calc(var(--colW) + var(--gutter))
      ),
      /* horizontal line at bottom edge of each row */
      repeating-linear-gradient(
        to bottom,
        transparent 0,
        transparent calc(var(--rowH) - 1px),
        var(--guide-line) calc(var(--rowH) - 1px),
        var(--guide-line) var(--rowH),
        transparent var(--rowH),
        transparent calc(var(--rowH) + var(--gutter))
      ),
      /* horizontal line at top edge of each next row (i.e., bottom edge + gutter) */
      repeating-linear-gradient(
        to bottom,
        transparent 0,
        transparent calc(var(--rowH) + var(--gutter) - 1px),
        var(--guide-line) calc(var(--rowH) + var(--gutter) - 1px),
        var(--guide-line) calc(var(--rowH) + var(--gutter)),
        transparent calc(var(--rowH) + var(--gutter)),
        transparent calc(var(--rowH) + var(--gutter))
      );
  }

  .gridItem {
    position: relative;
    z-index: 2;
    box-sizing: border-box;
    overflow: visible;
    height: 100%;
    min-height: 0;
    width: 100%;
    padding: 0;
  }

  .imageItem {
    align-self: start;
    justify-self: stretch;
  }

  figure.imageItem {
    margin: 0;                 /* remove default figure margins */
    display: flex;
    flex-direction: column;
    align-self: stretch;
    justify-self: stretch;
    height: 100%;
    min-height: 0;
    width: 100%;
    max-width: 100%;
    gap: 4px;
  }

  /* Media wrapper: keeps layout size, lets the image animate beyond its box */
  figure.imageItem .media {
    position: relative;
    flex: 1 1 auto;
    min-height: 0;
    width: 100%;
    overflow: visible;
  }

  /* Image fills media box; animate inset/scale to overlap gutters while dragging */
  figure.imageItem .media img {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
    border-radius: 0;
    filter: grayscale(1);

    will-change: transform, top, left, width, height;
    transition:
      top 260ms cubic-bezier(0.2, 0.8, 0.2, 1),
      left 260ms cubic-bezier(0.2, 0.8, 0.2, 1),
      width 260ms cubic-bezier(0.2, 0.8, 0.2, 1),
      height 260ms cubic-bezier(0.2, 0.8, 0.2, 1),
      transform 260ms cubic-bezier(0.2, 0.8, 0.2, 1);

    transform: scale(1);
  }

  /* While dragging: overlap the FULL 16px gutters on every side */
  .gridViewport.dragging figure.imageItem .media img {
    /* Expand by the FULL gutter on ALL sides (16px) */
    top: calc(-1 * var(--gutter));
    left: calc(-1 * var(--gutter));
    width: calc(100% + (2 * var(--gutter)));
    height: calc(100% + (2 * var(--gutter)));
    transform: scale(1);
  }

  figure.imageItem img {
    /* handled by .media img */
  }

  figure.imageItem.hasCaption figcaption {
    flex: 0 0 auto;
    height: var(--text-h);
    line-height: var(--text-h);
    margin: 0;
    padding: 0;
    overflow: hidden;
  }

  .imageItem img {
    height: 100%;
  }

  .imageItem figcaption {
    display: flex;
    justify-content: space-between;
    gap: 10px;
    font-family: system-ui, -apple-system, sans-serif;
    font-size: 11px;
    letter-spacing: 0.02em;
    color: rgba(0, 0, 0, 0.75);
    height: var(--text-h);
    line-height: var(--text-h);
    user-select: none;
    -webkit-user-select: none;
    pointer-events: none;
    transition: opacity 180ms ease;
  }

  /* Hide captions while dragging the infinite grid */
  .gridViewport.dragging .imageItem figcaption {
    opacity: 0;
  }

  /* While dragging, remove the caption's layout space so the image can fill to the row boundary */
  .gridViewport.dragging figure.imageItem {
    gap: 0;
  }

  .gridViewport.dragging figure.imageItem figcaption {
    height: 0;
    line-height: 0;
    margin: 0;
    padding: 0;
  }

  .imageItem figcaption span {
    user-select: none;
    -webkit-user-select: none;
  }

  .textItem {
    font-family: system-ui, -apple-system, sans-serif;
    font-size: 12px;
    color: rgba(0, 0, 0, 0.8);
    line-height: 1.2;
    max-width: 100%;
  }

  .metaSmall {
    font-family: system-ui, -apple-system, sans-serif;
    font-size: 12px;
    color: rgba(0, 0, 0, 0.8);
    line-height: 1;
  }

  .rightNav {
    display: grid;
    gap: 4px;
    justify-items: end;
    text-transform: lowercase;
  }

  /* Title intro animation (mix-blend-mode:difference so it's readable on any background) */
  .titleIntro {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%) scale(1);
    transform-origin: top left;
    z-index: 999;
    mix-blend-mode: difference;
    pointer-events: none;
    isolation: isolate;

    transition:
      top 900ms cubic-bezier(0.2, 0.8, 0.2, 1),
      left 900ms cubic-bezier(0.2, 0.8, 0.2, 1),
      transform 900ms cubic-bezier(0.2, 0.8, 0.2, 1);
  }

  .titleIntro.toLogo {
    top: 18px;
    left: 18px;
    transform: translate(0, 0) scale(0.32);
  }

  .titleText {
    font-family: system-ui, -apple-system, sans-serif;
    font-weight: 800;
    letter-spacing: -0.045em;
    line-height: 0.95;
    color: #fff;
    font-size: clamp(42px, 6.3vw, 96px);
    white-space: nowrap;
  }

  .cursor {
    display: inline-block;
    margin-left: 4px;
    animation: blink 900ms steps(2, end) infinite;
  }

  .cursor.hide {
    opacity: 0;
    animation: none;
  }

  @keyframes blink {
    0%, 49% { opacity: 1; }
    50%, 100% { opacity: 0; }
  }

  /* Scroll screen (WebGL + DOM list) */
  .scrollWebGL {
    position: absolute;
    inset: 0;
    overflow: hidden;
    background: #000;
    touch-action: none;
  }

  .scrollCanvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
  }

  .scrollList {
    position: absolute;
    inset: 0;
    list-style: none;
    padding: 0;
    margin: 0;
    pointer-events: auto;
  }

  .scrollListItem {
    position: absolute;
    left: 0;
    width: 100%;
    cursor: pointer;
    text-align: left;
    font-family: system-ui, -apple-system, sans-serif;
    font-weight: 800;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    opacity: 0; /* MeshManager should drive opacity via alpha */
    will-change: transform, opacity;
    line-height: 1;
    font-size: 160px;
    color: #fff;
    user-select: none;
    -webkit-user-select: none;
  }
   /* Make sure the expanded media is not hidden under other items or guides */
  .gridViewport.dragging figure.imageItem {
    z-index: 20;
  }
</style>
  
 