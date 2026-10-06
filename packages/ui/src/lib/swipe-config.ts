export const SWIPE_AXIS_THRESHOLD = 10;

export const SWIPE_DRAG_CONFIG = {
	axisThreshold: {
		mouse: SWIPE_AXIS_THRESHOLD,
		touch: SWIPE_AXIS_THRESHOLD,
		pen: SWIPE_AXIS_THRESHOLD,
	},
	swipe: { distance: 60, velocity: 0.3, duration: 600 },
	pointer: { keys: false, capture: false },
} as const;
