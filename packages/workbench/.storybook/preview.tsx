import type { Preview } from "@storybook/react-vite";
import { initialize, mswLoader } from "msw-storybook-addon";
import { uiPreview } from "../../ui/.storybook/preview-base.tsx";
import { handlers } from "../src/mocks/handlers.js";
import "./tailwind.css";

initialize({
	onUnhandledRequest: "bypass",
	quiet: true,
	serviceWorker: { url: "./mockServiceWorker.js" },
});

const preview: Preview = {
	...uiPreview,
	parameters: { ...uiPreview.parameters, msw: { handlers } },
	loaders: [mswLoader],
};

export default preview;
