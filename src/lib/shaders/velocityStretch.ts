/**
 * Velocity-Based Stretch Shader
 * Creates a sine-wave distortion effect based on scroll velocity
 * Text in the middle of the screen stretches most, top/bottom stretches less
 */

export const vertexShader = `
	uniform vec2 uViewportSizes;
	uniform float uVelocity;
	uniform float uScaleX;
	uniform float uScaleY;

	varying vec2 vUv;
	varying float vProgressVisible;

	void main() {
		vUv = uv;
		vec3 newPosition = position;
		newPosition.x *= uScaleX;
		vec4 finalPosition = modelViewMatrix * vec4(newPosition, 1.0);

		// Calculate stretch based on position in viewport
		float ampStretch = 0.05 * uScaleY;
		float M_PI = 3.1415926535897932;

		vProgressVisible = sin(finalPosition.y / uViewportSizes.y * M_PI + M_PI / 2.0) * abs(uVelocity * ampStretch);

		// Apply vertical stretch
		finalPosition.y *= 1.0 + vProgressVisible;

		gl_Position = projectionMatrix * finalPosition;
	}
`;

export const fragmentShader = `
	uniform sampler2D uTexture;
	uniform float uAlpha;
	uniform vec3 uColor;
	uniform float uHover;

	varying vec2 vUv;

	void main() {
		vec4 texColor = texture2D(uTexture, vUv);

		// Mix between white and hover color (red)
		vec3 finalColor = mix(vec3(1.0), uColor, uHover);

		gl_FragColor = vec4(texColor.rgb * finalColor, texColor.a * uAlpha);
	}
`;
