import * as THREE from 'three';
import { vertexShader, fragmentShader } from '$lib/shaders/velocityStretch';
import { createTextTexture } from '$lib/utils/textureCreator';
import { scrollConfig } from '$lib/config/scrollConfig';

/**
 * Creates a mesh manager for handling WebGL meshes
 */
export function createMeshManager(scene: THREE.Scene) {
	let meshes: THREE.Mesh[] = [];

	return {
		/**
		 * Create meshes for all items
		 */
		createMeshes(items: readonly string[], domElements: HTMLElement[]) {
			items.forEach((text, index) => {
				const domElement = domElements[index];
				if (!domElement) return;

				const texture = createTextTexture(text, domElement);
				const width = domElement.offsetWidth;
				const height = domElement.offsetHeight;

				const geometry = new THREE.PlaneGeometry(width, height);
				const material = new THREE.ShaderMaterial({
					vertexShader,
					fragmentShader,
					uniforms: {
						uTexture: { value: texture },
						uViewportSizes: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
						uVelocity: { value: 0 },
						uScaleX: { value: 1.0 },
						uScaleY: { value: 1.0 },
						uAlpha: { value: 1.0 },
						uColor: {
							value: new THREE.Color(
								scrollConfig.hoverColor.r,
								scrollConfig.hoverColor.g,
								scrollConfig.hoverColor.b
							)
						},
						uHover: { value: 0.0 }
					},
					transparent: true,
					depthTest: false,
					depthWrite: false
				});

				const mesh = new THREE.Mesh(geometry, material);
				scene.add(mesh);
				meshes.push(mesh);
			});
		},

		/**
		 * Setup hover interactions for meshes
		 */
		setupHoverHandlers(domElements: HTMLElement[]) {
			domElements.forEach((element, index) => {
				element.addEventListener('mouseenter', () => {
					const mesh = meshes[index];
					if (mesh) {
						const material = mesh.material as THREE.ShaderMaterial;
						material.uniforms.uHover.value = 1.0;
					}
				});

				element.addEventListener('mouseleave', () => {
					const mesh = meshes[index];
					if (mesh) {
						const material = mesh.material as THREE.ShaderMaterial;
						material.uniforms.uHover.value = 0.0;
					}
				});
			});
		},

		/**
		 * Update mesh positions and shader uniforms
		 */
		updateMesh(index: number, position: { x: number; y: number }, velocity: number, alpha: number) {
			const mesh = meshes[index];
			if (mesh) {
				mesh.position.y = position.y;

				const material = mesh.material as THREE.ShaderMaterial;
				material.uniforms.uVelocity.value = velocity;
				material.uniforms.uAlpha.value = alpha;
			}
		},

		/**
		 * Update viewport size uniform for all meshes
		 */
		updateViewportSize(width: number, height: number) {
			meshes.forEach((mesh) => {
				const material = mesh.material as THREE.ShaderMaterial;
				material.uniforms.uViewportSizes.value.set(width, height);
			});
		},

		/**
		 * Get total number of meshes
		 */
		get count() {
			return meshes.length;
		},

		/**
		 * Clear all meshes
		 */
		clear() {
			meshes.forEach((mesh) => {
				mesh.geometry.dispose();
				(mesh.material as THREE.ShaderMaterial).dispose();
				scene.remove(mesh);
			});
			meshes = [];
		},

		/**
		 * Dispose all resources
		 */
		dispose() {
			meshes.forEach((mesh) => {
				mesh.geometry.dispose();
				(mesh.material as THREE.ShaderMaterial).dispose();
				scene.remove(mesh);
			});
			meshes = [];
		}
	};
}

export type MeshManager = ReturnType<typeof createMeshManager>;
