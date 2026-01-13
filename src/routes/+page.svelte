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

  function readViewportSize() {
    vw = typeof window === "undefined" ? 0 : window.innerWidth;
    vh = typeof window === "undefined" ? 0 : window.innerHeight;
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
    return vw ? floorDiv(-camX, vw) : 0;
  }
  function tileIndexY() {
    return vh ? floorDiv(-camY, vh) : 0;
  }

  function tileLeft(ix: number) {
    return ix * vw;
  }
  function tileTop(iy: number) {
    return iy * vh;
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

  // NOTE: gridItems positions are aligned to a 12-column grid and a 30-row baseline.
  const gridItems: GridItem[] = [
    // top left small photo (01)
    {
      kind: "image",
      id: "img-01",
      src: "https://picsum.photos/seed/renata-01/720/300",
      col: [1, 3],
      row: [1, 3],
      captionLeft: "01",
      captionRight: "london, uk",
    },

    // small meta under title (left)
    {
      kind: "text",
      id: "meta-left",
      col: [2, 5],
      row: [3, 5],
      html: `<div class="metaSmall">been in <b>19</b> countries in the past</div><div class="metaSmall">1.5 years, took 29 flights over the last year</div>`,
      align: "left",
    },

    // top right wide photo (02)
    {
      kind: "image",
      id: "img-02",
      src: "https://picsum.photos/seed/renata-02/940/360",
      col: [9, 12],
      row: [1, 3],
      captionLeft: "02",
      captionRight: "eastbourne, uk",
    },

    // center wide photo under “traveller” (03)
    {
      kind: "image",
      id: "img-03",
      src: "https://picsum.photos/seed/renata-03/980/420",
      col: [6, 10],
      row: [4, 6],
      captionLeft: "03",
      captionRight: "funchal, madeira",
    },

    // middle right vertical (05)
    {
      kind: "image",
      id: "img-05",
      src: "https://picsum.photos/seed/renata-05/520/680",
      col: [8, 10],
      row: [7, 13],
      captionLeft: "05",
      captionRight: "madeira",
    },

    // right mid small (07)
    {
      kind: "image",
      id: "img-07",
      src: "https://picsum.photos/seed/renata-07/520/620",
      col: [12, 13],
      row: [11, 15],
      captionLeft: "07",
      captionRight: "paris, france",
    },

    // large left landscape (04)
    {
      kind: "image",
      id: "img-04",
      src: "https://picsum.photos/seed/renata-04/1200/900",
      col: [1, 4],
      row: [7, 16],
      captionLeft: "04",
      captionRight: "étretat, france",
    },

    // center mid landscape (06)
    {
      kind: "image",
      id: "img-06",
      src: "https://picsum.photos/seed/renata-06/1100/700",
      col: [5, 8],
      row: [12, 16],
      captionLeft: "06",
      captionRight: "gudauri, georgia",
    },

    // small left portrait (08)
    {
      kind: "image",
      id: "img-08",
      src: "https://picsum.photos/seed/renata-08/520/680",
      col: [3, 4],
      row: [17, 21],
      captionLeft: "08",
      captionRight: "mallorca, spain",
    },

    // BIG bottom center portrait (10) – missing in previous layout
    {
      kind: "image",
      id: "img-10",
      src: "https://picsum.photos/seed/renata-10/900/1200",
      col: [6, 8],
      row: [19, 28],
      captionLeft: "10",
      captionRight: "paris, france",
    },

    // large bottom right (09)
    {
      kind: "image",
      id: "img-09",
      src: "https://picsum.photos/seed/renata-09/1400/900",
      col: [10, 13],
      row: [19, 28],
      captionLeft: "09",
      captionRight: "edinburgh, uk",
    },

    // bottom left tiny (11)
    {
      kind: "image",
      id: "img-11",
      src: "https://picsum.photos/seed/renata-11/420/420",
      col: [1, 2],
      row: [27, 30],
      captionLeft: "",
      captionRight: "",
    },

    // bottom right tiny (12)
    {
      kind: "image",
      id: "img-12",
      src: "https://picsum.photos/seed/renata-12/420/420",
      col: [9, 10],
      row: [27, 30],
      captionLeft: "",
      captionRight: "",
    },

    // right nav
    {
      kind: "text",
      id: "right-nav",
      col: [12, 13],
      row: [1, 4],
      html: `<div class="rightNav"><div>intro</div><div>visited</div><div>about</div></div>`,
      align: "right",
    },

    // bottom meta
    {
      kind: "text",
      id: "time-left",
      col: [1, 3],
      row: [30, 31],
      html: `<div class="metaSmall">ldn, uk_16:05</div>`,
      align: "left",
    },
    {
      kind: "text",
      id: "made-right",
      col: [12, 13],
      row: [30, 31],
      html: `<div class="metaSmall" style="text-align:right">made in 2025</div>`,
      align: "right",
    },
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
            gridVisible = true;
          }, 940);
        }, 420);
      }
    }, speed);
  }

  onMount(() => {
    if (typeof window === "undefined") return;

    readViewportSize();

    // Start centered on the “home tile”
    camX = vw / 2;
    camY = vh / 2;
    camTargetX = camX;
    camTargetY = camY;

    // start title intro on initial load only
    startTitleIntro();

    window.addEventListener("resize", readViewportSize);

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
    <button class:active={screen === "grid"} on:click={() => setScreen("grid")}>Grid</button>
    <button class:active={screen === "scroll"} on:click={() => setScreen("scroll")}>Scroll</button>
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
      <div class="world" style="transform: translate3d({camX}px, {camY}px, 0);">
        {#each tileOffsets as ty (ty)}
          {#each tileOffsets as tx (tx)}
            {@const ix = tileIndexX() + tx}
            {@const iy = tileIndexY() + ty}

            <section
              class="pageTile"
              style="left:{tileLeft(ix)}px; top:{tileTop(iy)}px; width:{vw}px; height:{vh}px;"
              aria-label={`tile-${ix}-${iy}`}
            >
              <div class="tileInner">
                <!-- 12-column separators: 13 boundaries (including left+right edges) -->
                <div class="colLines" aria-hidden="true">
                  {#each Array(13) as _, i (i)}
                    <div class="colBoundary" style="left: calc({i} * 100% / 12);" />
                  {/each}
                </div>

                <div class="contentGrid">
                  {#each gridItems as it (it.id + '-' + ix + '-' + iy)}
                    {#if it.kind === "image"}
                      <figure
                        class="gridItem imageItem"
                        class:hasCaption={Boolean(it.captionLeft || it.captionRight)}
                        style="grid-column: {it.col[0]} / {it.col[1]}; grid-row: {it.row[0]} / {it.row[1]};"
                      >
                        <img src={it.src} alt={it.id} draggable="false" decoding="async" />
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

  /* Responsive layout tokens (3 MacBook presets) */
  :global(:root) {
    --block-h: 128px;          /* Air 13" default */
    --block-gap: 16px;
    --text-h: 16px;
    --img-text-gap: 4px;       /* distance between image and caption text */
  }

  /* MacBook Pro 14" */
  @media (min-width: 1500px) {
    :global(:root) {
      --block-h: 150px;
      --block-gap: 16px;
      --text-h: 16px;
      --img-text-gap: 4px;
    }
  }

  /* MacBook Pro 16" */
  @media (min-width: 1700px) {
    :global(:root) {
      --block-h: 176px;
      --block-gap: 16px;
      --text-h: 20px;
      --img-text-gap: 4px;
    }
  }

  .container {
    position: relative;
    width: 100vw;
    height: 100vh;
    overflow: hidden;
    background: #fff;
    color: #111;
  }

  .topbar {
    position: absolute;
    top: 16px;
    right: 16px;
    left: auto;
    display: flex;
    gap: 10px;
    z-index: 50;
    mix-blend-mode: difference;
  }

  .topbar button {
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
  }

  .topbar button.active {
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
    inset: 0;
    padding: 28px;
    box-sizing: border-box;
    overflow: hidden; /* clip to the padded layout area */
  }

  /* 12-column vertical lines overlay */
  .colLines {
    position: absolute;
    inset: 0;
    pointer-events: none;
    z-index: 10; /* ALWAYS above items so column edges read and items appear clipped */
    overflow: hidden;
  }

  .colBoundary {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 4px; /* space for 2 lines + 2px gap */
    transform: translateX(-2px); /* center boundary at exact column edge */
  }

  .colBoundary::before,
  .colBoundary::after {
    content: "";
    position: absolute;
    top: 0;
    bottom: 0;
    width: 1px;
    background: rgba(0, 0, 0, 0.06);
  }

  .colBoundary::before {
    left: 0;
  }

  .colBoundary::after {
    left: 3px; /* 2px gap between the two 1px lines */
  }


  /* Content grid */
  .contentGrid {
    position: absolute;
    left: 0;
    right: 0;
    top: 0;
    bottom: 0;

    display: grid;
    grid-template-columns: repeat(12, 1fr);
    /* Block system: each row is a full block, gap is the distance between sections */
    grid-auto-rows: var(--block-h);
    column-gap: 0;
    row-gap: var(--block-gap);
    align-content: start;

    z-index: 1;
  }

  .gridItem {
    position: relative;
    box-sizing: border-box;
    overflow: hidden;
    height: 100%;
    min-height: 0;
    width: 100%;

    /* Cell gutter: ensures items never touch across columns/rows */
    padding: calc(var(--block-gap) / 2);
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
    gap: var(--img-text-gap);  /* distance between image and caption */
  }

  figure.imageItem img {
    flex: 1 1 auto;            /* take remaining height */
    min-height: 0;             /* critical for flex overflow */
    width: 100%;
    object-fit: cover;
    display: block;
    border-radius: 0;
    filter: grayscale(1);
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
  .colLines, .colBoundary::before, .colBoundary::after {
    transform: translateZ(0);
  }
</style>
  