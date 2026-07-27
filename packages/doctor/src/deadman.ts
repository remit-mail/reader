import type { Fetcher } from "./scrape.js";

/**
 * D11. A ping on every completed check, whatever the verdict.
 *
 * If the VM is off, the disk is full, the network is gone or this container
 * crashed, no alert fires — and an operator with only a webhook cannot tell
 * that apart from a week with nothing wrong. That silent failure is the one
 * this exists to remove, which is why the configuration refuses a webhook
 * without a heartbeat rather than treating it as an upgrade.
 *
 * A check completes when it produces a verdict, including a `degraded` verdict
 * produced from signals it could not read: a scrape failure degrades the
 * verdict and still pings, because the checker is working. A check that throws
 * before producing one does not ping.
 *
 * GET, not POST. It is the method healthchecks.io, Cronitor and Uptime Kuma's
 * push monitor all accept, and Uptime Kuma accepts nothing else. Nothing is
 * sent in the request beyond the URL the operator configured — the ping carries
 * that the checker ran, not what it found.
 */
export const pingDeadMan = async (
	url: string,
	timeoutMs: number,
	fetcher: Fetcher = fetch,
): Promise<void> => {
	const response = await fetcher(url, {
		method: "GET",
		signal: AbortSignal.timeout(timeoutMs),
	});
	if (!response.ok) {
		throw new Error(`dead-man ping rejected: HTTP ${response.status}`);
	}
};
