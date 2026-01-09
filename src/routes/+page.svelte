<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { createInfiniteGrid } from "$lib/grid/infiniteGrid";
  import { createPickerScroll } from "$lib/scroll/pickerScroll";
  import type { Image } from "$lib/types";

  type Screen = "grid" | "scroll";

  const TOTAL_IMAGES = 20;
  const images: Image[] = Array.from({ length: TOTAL_IMAGES }, (_, i) => ({
    id: i,
    url: `https://picsum.photos/seed/${i}/200/200`,
  }));

  const grid = createInfiniteGrid({
    cellSize: 200,
    gridSize: 7,
    images,
  });

  // Grid stores (Svelte $-syntax works on these)
  const { visibleTiles, currentOffsetX, currentOffsetY, isDragging } = grid;

  let gridEl: HTMLDivElement | null = null;
  let scrollViewport: HTMLDivElement | null = null;

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

  // Picker stores
  const { scrollFrac, scrollBaseIndex, scrollStretch, scrollDir } = picker;

  let screen: Screen = "grid";

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

  onMount(() => {
    if (gridEl) grid.bind(gridEl);
    grid.centerInViewport();

    if (typeof window !== "undefined" && screen === "scroll") {
      window.addEventListener("wheel", picker.onWheel as any, { passive: false } as any);
      picker.start();
    }
  });

  onDestroy(() => {
    if (typeof window === "undefined") return;
    window.removeEventListener("wheel", picker.onWheel as any);
  });
</script>

<svelte:window
  on:pointermove={grid.onPointerMove}
  on:pointerup={grid.onPointerUp}
  on:pointercancel={grid.onPointerUp}
/>

<div class="container">
  <div class="topbar">
    <button class:active={screen === "grid"} on:click={() => setScreen("grid")}>Grid</button>
    <button class:active={screen === "scroll"} on:click={() => setScreen("scroll")}>Scroll</button>
  </div>

  {#if screen === "grid"}
    <div
      class="grid"
      class:dragging={$isDragging}
      bind:this={gridEl}
      on:pointerdown={grid.onPointerDown}
      role="application"
      tabindex="0"
    >
      <div
        class="gridInner"
        style="transform: translate3d({$currentOffsetX}px, {$currentOffsetY}px, 0);"
      >
        {#each $visibleTiles as tile (tile.x + "_" + tile.y)}
          <div class="tile" style="transform: translate3d({tile.x}px, {tile.y}px, 0);">
            <img
              src={tile.image.url}
              alt={`Grid item ${tile.image.id}`}
              draggable="false"
              decoding="async"
            />
          </div>
        {/each}
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
                  scaleY({picker.labelScaleY(slot, $scrollFrac, $scrollStretch)});
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
  .container {
    position: relative;
    width: 100vw;
    height: 100vh;
    overflow: hidden;
    background: #1a1a1a;
    color: #fff;
  }

  .topbar {
    position: absolute;
    top: 16px;
    left: 16px;
    display: flex;
    gap: 10px;
    z-index: 20;
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

  /* Grid (match original) */
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
    -webkit-user-drag: none;
    display: block;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  }

  /* Picker scroll */
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
</style>