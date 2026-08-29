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
 *
 * `mobileShort` is the same phone tier at the smallest height a real device
 * leaves for the page — Android Chrome with its address bar and the system nav
 * showing (411×759, from #405). Anything sized off the viewport height is
 * tightest here, so a surface with a `dvh` ceiling gets a story pinned to it.
 *
 * `laptopShort` is the desktop tier at a laptop's real page height rather than
 * a monitor's — 1512×827, the MacBook the config import wizard was found
 * unusable on (#1021). Wide enough to be nobody's idea of a small screen, and
 * short enough that a long step runs off the bottom.
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
	mobileShort: {
		name: "Mobile (short)",
		type: "mobile",
		styles: { width: "411px", height: "759px" },
	},
	laptopShort: {
		name: "Laptop (short)",
		type: "desktop",
		styles: { width: "1512px", height: "827px" },
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
