/**
 * Configuration for infinite scroll behavior and visual effects
 */

export const scrollConfig = {
	/** Scroll sensitivity multiplier (0.5 = 50% of normal) */
	scrollSensitivity: 0.5,

	/** Fade start distance from center (as fraction of viewport height) */
	fadeStartDistance: 0.4,

	/** Fade end distance from center (as fraction of viewport height) */
	fadeEndDistance: 0.6,

	/** Hover color (RGB) */
	hoverColor: { r: 1.0, g: 0.0, b: 0.0 }
} as const;

export const brands = [
	'Dior',
	'Renault',
	'Biotherm',
	'Diptyque',
	'Chanel',
	'Van Cleef',
	'Cartier',
	'Hermès',
	'Louis Vuitton',
	'Guerlain',
	'Lancôme',
	'Givenchy'
];
