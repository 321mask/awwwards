<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { createPickerScroll } from "$lib/scroll/pickerScroll";

  type Screen = "grid" | "scroll";

  // --- Scroll screen (kept) ---
  const picker = createPickerScroll({
    items: [
      "Dior",
      "Renault",
      "Biotherm",
      "Diptyque",
      "Chanel",
      "Van Cleef",
      "Beau Band",
      "Cartier",
      "Saint Laurent",
      "Loewe",
    ],
    itemHeight: 112,
    radius: 8,
  });

  const { scrollFrac, scrollBaseIndex, scrollStretch, scrollDir } = picker;

  let screen: Screen = "grid";
  let scrollViewport: HTMLDivElement | null = null;

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
      window.addEventListener("wheel", picker.onWheel as any, { passive: false } as any);
      picker.start();
    } else {
      window.removeEventListener("wheel", picker.onWheel as any);
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
      window.addEventListener("wheel", picker.onWheel as any, { passive: false } as any);
      picker.start();
    }
  });

  onDestroy(() => {
    if (typeof window === "undefined") return;

    window.removeEventListener("wheel", picker.onWheel as any);
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
    <div class="scrollViewport" bind:this={scrollViewport}>
      <div class="picker">
        {#each picker.slots as slot (slot)}
          <div
            class="scrollItem pickerItem"
            style="
              top: calc(50% + {slot * picker.itemHeight - $scrollFrac}px);
              opacity: {picker.labelOpacity(slot, $scrollFrac)};
              transform: translateY(calc(-50% + {picker.edgePullPx(slot, $scrollFrac, $scrollStretch, $scrollDir)}px));
            "
          >
            <div
              class="pickerLabel"
              style="
                transform-origin: {$scrollDir > 0 ? '50% 0%' : '50% 100%'};
                transform: translateY({$scrollDir * $scrollStretch * 14}px)
                  scaleY({picker.labelScaleY(slot, $scrollFrac, $scrollStretch, $scrollDir)});
              "
            >
              {picker.items[(((($scrollBaseIndex + slot) % picker.items.length) + picker.items.length) % picker.items.length)]}
            </div>
          </div>
        {/each}
      </div>
    </div>
  {/if}
</div>

<style>
  :global(body) {
    margin: 0;
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
  }

  .tileInner {
    position: absolute;
    inset: 0;
    padding: 28px;
    box-sizing: border-box;
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
    /* Use a fixed number of rows so items keep proportions at any height */
    grid-template-rows: repeat(30, 1fr);
    column-gap: 0;
    row-gap: 0;

    z-index: 1;
  }

  .gridItem {
    position: relative;
    box-sizing: border-box;
    overflow: hidden; /* clip to column edges */
    height: 100%;
    min-height: 0;
  }

  .imageItem {
    align-self: start;
    justify-self: stretch;
  }

  figure.imageItem {
    margin: 0;              /* remove default figure margins */
    display: flex;
    flex-direction: column;
    align-self: stretch;
    justify-self: stretch;
  }

  figure.imageItem img {
    flex: 1 1 auto;
    min-height: 0;          /* IMPORTANT: allows image to shrink to make room for caption */
  }

  figure.imageItem figcaption {
    flex: 0 0 auto;
    margin: 0;
    padding-top: 6px;
  }

  .imageItem img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
    border-radius: 0;
    filter: grayscale(1);
  }

  .imageItem figcaption {
    display: flex;
    justify-content: space-between;
    gap: 10px;
    font-family: system-ui, -apple-system, sans-serif;
    font-size: 11px;
    letter-spacing: 0.02em;
    color: rgba(0, 0, 0, 0.75);
  }

  .textItem {
    font-family: system-ui, -apple-system, sans-serif;
    font-size: 12px;
    color: rgba(0, 0, 0, 0.8);
    line-height: 1.35;
  }

  .metaSmall {
    font-family: system-ui, -apple-system, sans-serif;
    font-size: 12px;
    color: rgba(0, 0, 0, 0.8);
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

  /* Picker scroll screen (unchanged) */
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
    background: linear-gradient(to bottom, rgba(11, 11, 11, 1), rgba(11, 11, 11, 0));
  }

  .scrollViewport::after {
    bottom: 0;
    background: linear-gradient(to top, rgba(11, 11, 11, 1), rgba(11, 11, 11, 0));
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
    height: 112px;
    display: flex;
    align-items: center;
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
    display: inline-block;
    transform-origin: center;
    will-change: transform;
    backface-visibility: hidden;
  }
  .colLines, .colBoundary::before, .colBoundary::after {
    transform: translateZ(0);
  }
</style>
  