/**
 * `/metrics` is on the container network and nowhere else
 * (docs/design/standalone-observability.md D2). The endpoint carries per-account
 * series and answers without credentials, so the guarantee that protects it is
 * that no route reaches it from the public origin.
 *
 * The e2e stack publishes one listener that a real deployment does not: the
 * queue sidecar, so a spec can redeliver an event the way an at-least-once
 * queue does (#925 spec 6). It serves its own exposition on that port, which
 * makes it the exception this file has to state rather than pass over. What
 * bounds it is the same thing that bounds the mail-server ports — 127.0.0.1 and
 * nothing else — and the last test here holds the compose file to it.
 */
import { networkInterfaces } from "node:os";
import { baseUrl, queueApi } from "../src/env.js";
import { expect, test } from "../src/fixtures.js";
import { imageStackOnly } from "../src/stack.js";

/** An address of this host that is not the loopback one, if it has any. */
const externalAddress = (): string | null => {
	for (const entries of Object.values(networkInterfaces())) {
		for (const entry of entries ?? []) {
			if (entry.family === "IPv4" && !entry.internal) return entry.address;
		}
	}
	return null;
};

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

	// The queue coordinate, which is published on purpose. A port on 127.0.0.1
	// is reachable from the machine running the suite and from nothing on the
	// network, which is the whole of the allowance — so the thing worth pinning
	// is that the binding really is loopback and not 0.0.0.0 with a loopback
	// address written next to it.
	test("publishes the queue port on loopback and not on the network", async () => {
		const address = externalAddress();
		if (address === null) {
			test.skip(true, "this host has no non-loopback address to probe from");
			return;
		}
		const { port } = new URL(queueApi);
		const answered = await fetch(`http://${address}:${port}/health`, {
			signal: AbortSignal.timeout(2_000),
		}).then(
			(response) => response.ok,
			() => false,
		);
		expect(
			answered,
			`the queue sidecar answers on ${address}:${port}, so it is bound to every interface`,
		).toBe(false);
	});
});
