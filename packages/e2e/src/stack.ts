/**
 * Which deployment the suite is pointed at.
 *
 * The suite is target-agnostic — every coordinate comes from the environment,
 * and the same specs run against both stacks. This is the one thing they cannot
 * infer: whether the packaged edge is in front of the app.
 *
 *   "image"  the published-image stack (`npm run e2e`). Caddy terminates the
 *            request and APISIX gates every business route on the JWT. This is
 *            the deploy signal, and it runs the whole suite.
 *   "dev"    the source-built stack (`npm run e2e:dev`). The browser talks to
 *            the vite dev server, whose proxy table mirrors the Caddy routing
 *            1:1, and which forwards to the backend directly. There is no edge
 *            in the path, so assertions ABOUT the edge have nothing to assert
 *            against and are skipped by name.
 *
 * Set from E2E_STACK, which the dev lane's env carries and the image lane's
 * does not.
 */
import { test } from "@playwright/test";

export const stack: "image" | "dev" =
	process.env.E2E_STACK === "dev" ? "dev" : "image";

export const isDevStack = stack === "dev";

/**
 * Declare a group as belonging to the packaged deployment only. Call it in a
 * `test.describe` body.
 *
 * The skip is named, not silent: every test in the group still appears in the
 * dev lane's report, marked skipped and carrying `reason`, and the reason is
 * printed once when the file is collected. A green dev run therefore says what
 * it did not cover instead of quietly covering less.
 */
export const imageStackOnly = (reason: string): void => {
	if (isDevStack) {
		console.log(`e2e: skipped on the source-built stack — ${reason}`);
	}
	test.skip(isDevStack, `image stack only: ${reason}`);
};
