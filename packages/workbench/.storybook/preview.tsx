import type { Preview } from "@storybook/react-vite";
import { initialize, mswLoader } from "msw-storybook-addon";
import { withTheme } from "../src/decorators/theme.js";
import { handlers } from "../src/mocks/handlers.js";
import "./tailwind.css";

initialize({
	onUnhandledRequest: "bypass",
	serviceWorker: { url: "./mockServiceWorker.js" },
});

/**
 * The app's three layout tiers, as Storybook viewports so any responsive story
 * can be flipped between them from the toolbar. Widths match the real
 * breakpoints: desktop ≥1024 (multi-pane), tablet 768–1023 (two-pane, no
 * intelligence rail), phone (single-pane list↔conversation, iPhone 14 frame).
 */
const appViewports = {
	desktop: {
		name: "Desktop",
		type: "desktop",
		styles: { width: "1440px", height: "900px" },
	},
	tablet: {
		name: "Tablet",
		type: "tablet",
		styles: { width: "834px", height: "1112px" },
	},
	mobile: {
		name: "Mobile",
		type: "mobile",
		styles: { width: "390px", height: "844px" },
	},
} as const;

const preview: Preview = {
	parameters: {
		layout: "fullscreen",
		controls: { expanded: true },
		msw: { handlers },
		viewport: { options: appViewports },
		options: {
			storySort: {
				order: ["Primitives", "Screens", "Flows"],
			},
		},
	},
	globalTypes: {
		theme: {
			description: "Light / dark theme",
			defaultValue: "light",
			toolbar: {
				title: "Theme",
				icon: "circlehollow",
				items: [
					{ value: "light", title: "Light", icon: "sun" },
					{ value: "dark", title: "Dark", icon: "moon" },
				],
				dynamicTitle: true,
			},
		},
	},
	initialGlobals: { theme: "light" },
	loaders: [mswLoader],
	decorators: [withTheme],
};

export default preview;
