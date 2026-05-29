import type { Decorator } from "@storybook/react-vite";
import { useEffect } from "react";

/**
 * Toggles the `.dark` class on a full-bleed wrapper based on the Storybook
 * theme global, and paints the canvas token behind every story.
 */
export const withTheme: Decorator = (Story, context) => {
	const theme = (context.globals.theme as string) ?? "light";

	useEffect(() => {
		document.documentElement.classList.toggle("dark", theme === "dark");
	}, [theme]);

	return (
		<div className={theme === "dark" ? "dark" : ""}>
			<div className="min-h-dvh bg-canvas text-fg font-sans">
				<Story />
			</div>
		</div>
	);
};
