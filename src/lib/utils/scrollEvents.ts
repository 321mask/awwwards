import type { ScrollVelocity } from './scrollVelocity';
import { scrollConfig } from '$lib/config/scrollConfig';

/**
 * Creates scroll event manager for wheel and touch events
 */
export function createScrollEvents(container: HTMLElement, scrollVelocity: ScrollVelocity) {
	let touchLastY = 0;

	function onWheel(e: WheelEvent) {
		e.preventDefault();
		scrollVelocity.updateTarget(e.deltaY * scrollConfig.scrollSensitivity);
	}

	function onTouchStart(e: TouchEvent) {
		touchLastY = e.touches[0].clientY;
	}

	function onTouchMove(e: TouchEvent) {
		e.preventDefault();
		const currentY = e.touches[0].clientY;
		const delta = touchLastY - currentY;
		scrollVelocity.updateTarget(delta);
		touchLastY = currentY;
	}

	return {
		/**
		 * Attach event listeners
		 */
		attach() {
			container.addEventListener('wheel', onWheel, { passive: false });
			container.addEventListener('touchstart', onTouchStart, { passive: true });
			container.addEventListener('touchmove', onTouchMove, { passive: false });
		},

		/**
		 * Detach event listeners
		 */
		detach() {
			container.removeEventListener('wheel', onWheel);
			container.removeEventListener('touchstart', onTouchStart);
			container.removeEventListener('touchmove', onTouchMove);
		}
	};
}

export type ScrollEvents = ReturnType<typeof createScrollEvents>;
