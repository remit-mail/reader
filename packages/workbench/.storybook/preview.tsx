import type { Preview } from "@storybook/react-vite";
import { initialize, mswLoader } from "msw-storybook-addon";
import { withTheme } from "../src/decorators/theme.js";
import { handlers } from "../src/mocks/handlers.js";
import "./tailwind.css";

initialize({ onUnhandledRequest: "bypass" });

const preview: Preview = {
	parameters: {
		layout: "fullscreen",
		controls: { expanded: true },
		msw: { handlers },
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
