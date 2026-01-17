import * as THREE from 'three';

/**
 * Creates a WebGL texture from text that matches DOM element styling
 * @param text - The text to render
 * @param domElement - DOM element to copy styles from
 * @returns THREE.CanvasTexture with rendered text
 */
export function createTextTexture(text: string, domElement: HTMLElement): THREE.CanvasTexture {
	const canvas = document.createElement('canvas');
	const ctx = canvas.getContext('2d')!;

	// Get computed styles from DOM element
	const computedStyle = window.getComputedStyle(domElement);
	const fontSize = parseFloat(computedStyle.fontSize);
	const fontWeight = computedStyle.fontWeight;
	const fontFamily = computedStyle.fontFamily;
	const letterSpacing = computedStyle.letterSpacing;

	// High-res canvas for crisp text rendering
	const scale = 4;
	canvas.width = domElement.offsetWidth * scale;
	canvas.height = domElement.offsetHeight * scale;

	ctx.scale(scale, scale);
	// Transparent background; clear in unscaled (CSS-pixel) coordinates
	ctx.clearRect(0, 0, domElement.offsetWidth, domElement.offsetHeight);
	ctx.fillStyle = '#000';
	ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
	ctx.textAlign = 'left';
	ctx.textBaseline = 'middle';

	// Apply letter-spacing if set
	if (letterSpacing !== 'normal') {
		ctx.letterSpacing = letterSpacing;
	}

	ctx.fillText(text, 0, domElement.offsetHeight / 2);

	const texture = new THREE.CanvasTexture(canvas);
	texture.minFilter = THREE.LinearFilter;
	texture.magFilter = THREE.LinearFilter;

	return texture;
}
