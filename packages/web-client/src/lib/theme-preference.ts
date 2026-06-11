/**
 * User theme preference — persistent, immediate-apply.
 *
 * "system" (default) follows the OS prefers-color-scheme media query.
 * "light" / "dark" override it and survive page reloads via localStorage.
 */

export type ThemePreference = "system" | "light" | "dark";

const STORAGE_KEY = "remit.theme";
const DARK_CLASS = "dark";

/** Read the stored preference; defaults to "system" if not set. */
export function getThemePreference(): ThemePreference {
	if (typeof localStorage === "undefined") return "system";
	return (
		(localStorage.getItem(STORAGE_KEY) as ThemePreference | null) ?? "system"
	);
}

/** Apply a preference to <html> immediately, without persisting. */
export function applyPreference(pref: ThemePreference): void {
	if (typeof document === "undefined") return;
	const isDark =
		pref === "dark" ||
		(pref === "system" &&
			typeof window !== "undefined" &&
			typeof window.matchMedia === "function" &&
			window.matchMedia("(prefers-color-scheme: dark)").matches);
	document.documentElement.classList.toggle(DARK_CLASS, isDark);
}

/**
 * Persist the preference and apply it immediately.
 * Passing "system" removes the key so the default kicks in.
 */
export function setThemePreference(pref: ThemePreference): void {
	if (typeof localStorage !== "undefined") {
		if (pref === "system") {
			localStorage.removeItem(STORAGE_KEY);
		} else {
			localStorage.setItem(STORAGE_KEY, pref);
		}
	}
	applyPreference(pref);
}
