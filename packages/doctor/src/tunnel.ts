import { attempt } from "./attempt.js";
import type { Fetcher } from "./scrape.js";

/**
 * Whether the reverse-tunnel agent still holds a connection to the provider's
 * edge (D12 of the tunnel design). `cloudflared` answers 200 on its metrics
 * port's `/ready` only while at least one edge connection is established, so a
 * refused connection, a timeout and a non-200 all say the same thing: nothing
 * on the internet can reach this deployment right now.
 *
 * A failure is a value, for the reason every other reading here is one — the
 * condition is what the verdict exists to report, and a throw would take the
 * rest of the check down with it.
 */
export interface TunnelReading {
	/** Why the readiness endpoint did not answer 200. `undefined` when it did. */
	readonly error: string | undefined;
}

export const probeTunnel = async (
	url: string,
	timeoutMs: number,
	fetcher: Fetcher = fetch,
): Promise<TunnelReading> => {
	const response = await attempt(
		fetcher(url, { signal: AbortSignal.timeout(timeoutMs) }),
	);
	if (!response.ok) return { error: response.error };
	if (!response.value.ok) return { error: `HTTP ${response.value.status}` };
	return { error: undefined };
};
