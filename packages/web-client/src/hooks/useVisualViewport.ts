import { useEffect, useState } from "react";

interface VisualViewportState {
	/** Current visual viewport height in pixels. */
	viewportHeight: number;
	/** True when the viewport has shrunk significantly (e.g. software keyboard open). */
	isKeyboardOpen: boolean;
}

/** Minimum shrinkage (px) from window.innerHeight to consider the keyboard open. */
const KEYBOARD_THRESHOLD = 150;

/**
 * Tracks `window.visualViewport` resize events and reports whether the
 * software keyboard is likely open. SSR-safe — returns safe defaults
 * when `window` or `visualViewport` are unavailable.
 */
export const useVisualViewport = (): VisualViewportState => {
	const [state, setState] = useState<VisualViewportState>(() => {
		if (typeof window === "undefined" || !window.visualViewport) {
			return { viewportHeight: 0, isKeyboardOpen: false };
		}
		const h = window.visualViewport.height;
		return {
			viewportHeight: h,
			isKeyboardOpen: window.innerHeight - h > KEYBOARD_THRESHOLD,
		};
	});

	useEffect(() => {
		if (typeof window === "undefined" || !window.visualViewport) return;

		const vv = window.visualViewport;

		const update = () => {
			const h = vv.height;
			setState({
				viewportHeight: h,
				isKeyboardOpen: window.innerHeight - h > KEYBOARD_THRESHOLD,
			});
		};

		// Sync on mount
		update();

		vv.addEventListener("resize", update);
		return () => vv.removeEventListener("resize", update);
	}, []);

	return state;
};
