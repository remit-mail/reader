import type { RemitImapSenderTrust } from "@remit/api-http-client/types.gen.ts";
import type { Telemetry } from "@/lib/telemetry";

/**
 * Rescue-from-Spam telemetry. Shapes the small, privacy-safe payloads (counts,
 * folder roles, booleans — never bodies or addresses) and emits them through the
 * shared `recordEvent` channel, matching the `domain.action` event-name
 * convention used across the client.
 */

export function recordRescueCandidatesSurfaced(
	telemetry: Telemetry,
	count: number,
): void {
	telemetry.recordEvent("rescue.candidates_surfaced", { count: String(count) });
}

export function recordRescueFlowOpened(
	telemetry: Telemetry,
	count: number,
): void {
	telemetry.recordEvent("rescue.flow_opened", { count: String(count) });
}

export function recordRescueCommitted(
	telemetry: Telemetry,
	input: { selected: number; total: number; toInbox: boolean },
): void {
	telemetry.recordEvent("rescue.committed", {
		selected: String(input.selected),
		total: String(input.total),
		destination: input.toInbox ? "inbox" : "other",
	});
}

/**
 * The reverse signal: a message moved back into Junk. `wasRescuable` is the best
 * cheaply-available prior-rescue proxy — the sender is one we can verify, so the
 * user is overriding our trust. There is no per-message "was previously rescued"
 * flag in the client, so we do not claim one.
 */
export function recordRescueSentToJunk(
	telemetry: Telemetry,
	input: {
		count: number;
		senderTrust: RemitImapSenderTrust;
		wasRescuable: boolean;
	},
): void {
	telemetry.recordEvent("rescue.sent_to_junk", {
		count: String(input.count),
		senderTrust: input.senderTrust,
		wasRescuable: String(input.wasRescuable),
	});
}
