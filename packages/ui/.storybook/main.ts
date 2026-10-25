import type { StorybookConfig } from "@storybook/react-vite";
import { uiFramework, uiStories, withUiVite } from "./shared.ts";

const config: StorybookConfig = {
	stories: [uiStories],
	framework: uiFramework,
	core: { disableTelemetry: true },
	viteFinal: withUiVite,
};

export default config;
