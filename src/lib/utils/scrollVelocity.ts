/**
 * Creates a scroll velocity tracker with smooth interpolation and natural decay
 */
export function createScrollVelocity() {
	let scrollY = 0;
	let targetScrollY = 0;
	let lastScrollY = 0;
	let velocity = 0;

	return {
		/**
		 * Update target scroll position (call this from wheel/touch events)
		 */
		updateTarget(delta: number) {
			targetScrollY += delta;
		},

		/**
		 * Update scroll position and calculate velocity (call this in animation loop)
		 */
		update() {
			// Smooth scroll interpolation
			scrollY += (targetScrollY - scrollY) * 0.1;

			// Calculate velocity with smoothing
			const delta = scrollY - lastScrollY;
			velocity += (delta - velocity) * 0.1;
			velocity *= 0.85; // Natural decay
			lastScrollY = scrollY;

			return {
				scrollY,
				velocity
			};
		},

		/**
		 * Get current scroll position
		 */
		getScrollY() {
			return scrollY;
		},

		/**
		 * Get current velocity
		 */
		getVelocity() {
			return velocity;
		}
	};
}

export type ScrollVelocity = ReturnType<typeof createScrollVelocity>;
