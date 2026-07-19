import { defineConfig, devices } from "@playwright/test";
import { baseUrl } from "./src/env.js";
import { storageStatePath } from "./src/state.js";

/**
 * There is no `webServer` here on purpose. The thing under test is a running
 * deployment of the published images, brought up by `npm run e2e:up`; Playwright
 * only points a browser and a fetch client at it.
 */
export default defineConfig({
	testDir: "./specs",
	fullyParallel: false,
	// One worker: the specs share one Dovecot mailbox and one synced account, and
	// serialising them is what makes a failure mean what it says.
	workers: 1,
	forbidOnly: !!process.env.CI,
	retries: 0,
	// The HTML report is what a CI lane uploads after a failure — annotations
	// name the failing spec, the report carries the trace and screenshot that
	// explain it.
	reporter: process.env.CI
		? [["github"], ["list"], ["html", { open: "never" }]]
		: [["list"]],
	timeout: 60_000,
	globalSetup: "./global-setup.ts",
	use: {
		baseURL: baseUrl,
		storageState: storageStatePath,
		trace: "retain-on-failure",
		screenshot: "only-on-failure",
	},
	projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
