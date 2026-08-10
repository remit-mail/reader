import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { storybookTest } from "@storybook/addon-vitest/vitest-plugin";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

const here = dirname(fileURLToPath(import.meta.url));

// Two live Chromium contexts is what a 12 GB dev box has room for.
const maxWorkers = process.env.CI ? "100%" : 2;

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
		maxWorkers,
		browser: {
			enabled: true,
			headless: true,
			provider: playwright({}),
			instances: [{ browser: "chromium" }],
		},
		setupFiles: [join(here, ".storybook/vitest.setup.ts")],
	},
});
