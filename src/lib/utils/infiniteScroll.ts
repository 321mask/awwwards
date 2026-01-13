import { scrollConfig } from '$lib/config/scrollConfig';

/**
 * Creates infinite scroll position calculator with wrapping logic
 */
export function createInfiniteScroll() {
	let itemHeight = 0;
	let totalHeight = 0;

	return {
		/**
		 * Initialize with item dimensions
		 */
		initialize(height: number, count: number) {
			itemHeight = height;
			totalHeight = height * count;
		},

		/**
		 * Calculate wrapped Y position for an item
		 */
		calculateItemPosition(index: number, scrollY: number): number {
			const scrollOffset = scrollY % totalHeight;
			const baseY = index * itemHeight;
			let y = baseY - scrollOffset;

			// Wrap around logic for infinite scroll
			if (y < -itemHeight * 2) {
				y += totalHeight * Math.ceil(Math.abs(y) / totalHeight);
			} else if (y > window.innerHeight + itemHeight) {
				y -= totalHeight * Math.ceil((y - window.innerHeight) / totalHeight);
			}

			return y;
		},

		/**
		 * Calculate WebGL mesh Y position from DOM position
		 */
		calculateMeshY(domY: number): number {
			return window.innerHeight / 2 - domY - itemHeight / 2;
		},

		/**
		 * Calculate alpha (opacity) based on distance from center
		 */
		calculateAlpha(meshY: number): number {
			const distanceFromCenter = Math.abs(meshY);
			const fadeStart = window.innerHeight * scrollConfig.fadeStartDistance;
			const fadeEnd = window.innerHeight * scrollConfig.fadeEndDistance;

			return (
				1.0 - Math.max(0, Math.min(1, (distanceFromCenter - fadeStart) / (fadeEnd - fadeStart)))
			);
		},

		/**
		 * Check if infinite scroll is ready
		 */
		get isReady(): boolean {
			return itemHeight > 0;
		},

		/**
		 * Get item height
		 */
		getItemHeight(): number {
			return itemHeight;
		}
	};
}

export type InfiniteScroll = ReturnType<typeof createInfiniteScroll>;
