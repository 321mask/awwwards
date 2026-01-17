import * as THREE from 'three';

/**
 * Creates and manages Three.js scene, camera, and renderer
 */
export function createWebGLScene(canvas: HTMLCanvasElement) {
	// Scene setup
	const scene = new THREE.Scene();

	// Camera setup
	const camera = new THREE.OrthographicCamera(
		window.innerWidth / -2,
		window.innerWidth / 2,
		window.innerHeight / 2,
		window.innerHeight / -2,
		0.1,
		1000
	);
	camera.position.z = 10;

	// Renderer setup
	const renderer = new THREE.WebGLRenderer({
		canvas,
		alpha: true,
		antialias: true
	});
	renderer.setSize(window.innerWidth, window.innerHeight);
	renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
	renderer.autoClear = true;

	renderer.setClearColor(0x000000, 0);

	return {
		scene,
		camera,

		/**
		 * Render the scene
		 */
		render() {
			// Clear color, depth, and stencil buffers every frame to avoid ghosting
			renderer.clear(true, true, true);
			renderer.render(scene, camera);
		},

		/**
		 * Handle window resize
		 */
		resize(width: number, height: number) {
			camera.left = width / -2;
			camera.right = width / 2;
			camera.top = height / 2;
			camera.bottom = height / -2;
			camera.updateProjectionMatrix();

			renderer.setSize(width, height);
		},

		/**
		 * Cleanup resources
		 */
		dispose() {
			renderer.dispose();
		}
	};
}

export type WebGLScene = ReturnType<typeof createWebGLScene>;
