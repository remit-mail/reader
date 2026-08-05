export interface TestViewport {
	width: number;
	orientation: "portrait" | "landscape";
	pointer: "coarse" | "fine";
}
export declare const DEFAULT_VIEWPORT_WIDTH: number;
export declare const DEFAULT_VIEWPORT: TestViewport;
export declare const setViewport: (viewport: TestViewport) => void;
export declare const window: Window & typeof globalThis;
