import { applyPreference, getThemePreference } from "./theme-preference.js";

/**
 * installThemeSync — call once at app startup (before first paint).
 *
 * Reads the stored preference (see theme-preference.ts) and applies it.
 * The matchMedia listener stays attached for the whole session and re-reads
 * the *live* preference on each OS change: while "system" it follows the OS,
 * while "light"/"dark" it is a no-op. This means switching System → explicit
 * → System within one session resumes OS-following immediately, with no
 * reload required (the listener is never detached).
 */
export const installThemeSync = (): void => {
	if (typeof window === "undefined") return;

	applyPreference(getThemePreference());

	if (typeof window.matchMedia !== "function") return;

	const media = window.matchMedia("(prefers-color-scheme: dark)");
	const handler = (): void => {
		// applyPreference only reacts to the OS when the live preference is
		// "system"; an explicit light/dark choice makes this a no-op.
		applyPreference(getThemePreference());
	};

	if (typeof media.addEventListener === "function") {
		media.addEventListener("change", handler);
	} else {
		// Safari <14 fallback
		media.addListener(handler);
	}
};
