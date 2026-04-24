const DARK_CLASS = "dark";

const prefersDark = (): boolean =>
	typeof window !== "undefined" &&
	typeof window.matchMedia === "function" &&
	window.matchMedia("(prefers-color-scheme: dark)").matches;

const applyTheme = (isDark: boolean): void => {
	const root = document.documentElement;
	root.classList.toggle(DARK_CLASS, isDark);
};

export const installThemeSync = (): void => {
	if (typeof window === "undefined") return;
	applyTheme(prefersDark());
	if (typeof window.matchMedia !== "function") return;
	const media = window.matchMedia("(prefers-color-scheme: dark)");
	const handler = (event: MediaQueryListEvent): void => {
		applyTheme(event.matches);
	};
	if (typeof media.addEventListener === "function") {
		media.addEventListener("change", handler);
		return;
	}
	media.addListener(handler);
};
