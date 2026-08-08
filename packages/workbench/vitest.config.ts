import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { storybookTest } from "@storybook/addon-vitest/vitest-plugin";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
	plugins: [
		storybookTest({
			configDir: join(here, ".storybook"),
			storybookScript: "npm run storybook",
			storybookUrl: "http://localhost:6007",
		}),
	],
	test: {
		name: "storybook",
		browser: {
			enabled: true,
			headless: true,
			provider: playwright({}),
			instances: [{ browser: "chromium" }],
		},
		setupFiles: [join(here, ".storybook/vitest.setup.ts")],
	},
});
