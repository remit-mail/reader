/**
 * A separate config for the helper unit checks under `./unit`. They exercise the
 * client's own logic with a stubbed `fetch`, so — unlike the specs — they need
 * no running deployment, no browser, and no global setup. The env the real
 * config reads at import time is filled with placeholders here; nothing reaches
 * a socket.
 */
process.env.E2E_HTTP_PORT ??= "0";
process.env.E2E_IMAP_PORT ??= "0";
process.env.E2E_IMAP_PASSWORD ??= "unit";
process.env.E2E_IMAP_HOST ??= "127.0.0.1";
process.env.E2E_SMTP_HOST ??= "127.0.0.1";
process.env.E2E_SMTP_HTTP_PORT ??= "0";
process.env.E2E_SMTP_REJECT_HOST ??= "127.0.0.1";
process.env.E2E_SMTP_REJECT_HTTP_PORT ??= "0";
process.env.E2E_QUEUE_PORT ??= "0";

import { defineConfig } from "@playwright/test";

export default defineConfig({
	testDir: "./unit",
	fullyParallel: false,
	workers: 1,
	forbidOnly: !!process.env.CI,
	retries: 0,
	reporter: [["list"]],
	timeout: 10_000,
});
