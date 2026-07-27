/**
 * `/metrics` is on the container network and nowhere else
 * (docs/design/standalone-observability.md D2). The endpoint carries per-account
 * series and answers without credentials, so the guarantee that protects it is
 * that no route reaches it from the public origin.
 */
import { baseUrl } from "../src/env.js";
import { expect, test } from "../src/fixtures.js";
import { imageStackOnly } from "../src/stack.js";

const looksLikeExpositionText = (body: string): boolean =>
	/^# (HELP|TYPE) /m.test(body) || /^remit_[a-z_]+[{ ]/m.test(body);

test.describe("the metrics endpoint is not on the public origin", () => {
	// The routing table is a property of the packaged deployment. The
	// source-built stack puts vite in front, so a pass there would say nothing
	// about what Caddy serves.
	imageStackOnly("the Caddy routing table exists only on the packaged stack");

	for (const path of [
		"/metrics",
		"/api/metrics",
		"/api/auth/metrics",
		"/content/metrics",
	]) {
		test(`serves no metrics at ${path}`, async () => {
			const response = await fetch(`${baseUrl}${path}`);
			const body = await response.text();
			expect(
				looksLikeExpositionText(body),
				`${path} answered ${response.status} with Prometheus exposition text`,
			).toBe(false);
		});
	}

	// The worker listener's own port, in case a compose change ever publishes it.
	// A refused connection is the expected outcome; anything that does answer on
	// this port belongs to something else on the host, not to this stack.
	test("publishes no worker metrics port on the host", async () => {
		const response = await fetch("http://127.0.0.1:9464/metrics").catch(
			() => null,
		);
		if (response === null) return;
		expect(looksLikeExpositionText(await response.text())).toBe(false);
	});
});
