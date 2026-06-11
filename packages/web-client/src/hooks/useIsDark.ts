import { useEffect, useState } from "react";

/**
 * Returns true when the app is in dark mode.
 *
 * Observes the `dark` class on `document.documentElement` — the same
 * mechanism Tailwind's `class` darkMode strategy uses. The initial value
 * is read synchronously so there's no flash on first render.
 */
export const useIsDark = (): boolean => {
	const [isDark, setIsDark] = useState(
		() =>
			typeof document !== "undefined" &&
			document.documentElement.classList.contains("dark"),
	);

	useEffect(() => {
		const el = document.documentElement;
		const observer = new MutationObserver(() => {
			setIsDark(el.classList.contains("dark"));
		});
		observer.observe(el, { attributes: true, attributeFilter: ["class"] });
		return () => observer.disconnect();
	}, []);

	return isDark;
};
