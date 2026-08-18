import type { RemitImapOutboxMessageStatus } from "@remit/api-http-client/types.gen.ts";

/**
 * Visual states for outbox messages.
 *
 * `sent` is included for completeness (the detail view of a sent message
 * uses it before the row gets purged) but the outbox list never renders
 * `sent` rows — they are filtered out (issue #193).
 */
export type OutboxDisplayStatus = Exclude<
	RemitImapOutboxMessageStatus,
	"draft"
>;

export type OutboxStatusTone =
	| "success"
	| "info"
	| "warning"
	| "error"
	| "neutral";

export interface OutboxStatusDescriptor {
	label: string;
	tone: OutboxStatusTone;
}

const STATUS_DESCRIPTORS: Record<OutboxDisplayStatus, OutboxStatusDescriptor> =
	{
		queued: { label: "Queued", tone: "neutral" },
		sending: { label: "Sending…", tone: "info" },
		sent: { label: "Sent", tone: "success" },
		unfiled: { label: "Sent, not filed", tone: "warning" },
		failed: { label: "Failed", tone: "error" },
		blocked: { label: "Blocked", tone: "warning" },
	};

/**
 * Describe an outbox status for UI rendering.
 *
 * `failed` and `blocked` are both terminal non-success states but carry
 * different remediation: `failed` may auto-retry on a transient error, and
 * is the appropriate label for SMTP auth/connection errors. `blocked` means
 * the account is misconfigured (e.g. no SMTP host) — the user must fix the
 * account before any retry can succeed.
 *
 * Returns null for `draft` (drafts live in a separate view).
 */
export const describeOutboxStatus = (
	status: RemitImapOutboxMessageStatus,
): OutboxStatusDescriptor | null => {
	if (status === "draft") return null;
	return STATUS_DESCRIPTORS[status];
};

/**
 * Whether a status carries a `lastError` worth surfacing in the UI.
 *
 * Critically: `sent` is NOT included. A successful send must never display
 * a stale lastError — that is the contradictory "green check + 'SMTP not
 * configured'" UI bug from issue #192. `unfiled` is: the message was
 * delivered but could not be filed, and the reason is the whole point of
 * the row still being there.
 */
export const showsLastError = (status: RemitImapOutboxMessageStatus): boolean =>
	status === "failed" || status === "blocked" || status === "unfiled";

/**
 * Whether the outbox list view should render this row.
 *
 * `draft` belongs in the Drafts view. `sent` rows are deleted by the IMAP
 * APPEND handler (issue #178) — but until that happens we hide them from
 * the Outbox list so a successfully-sent message never appears in two
 * places at once (issue #193). `unfiled` is the settled failure of that
 * APPEND: the message is on no server folder, so the Outbox row is the only
 * copy the user has and it stays listed.
 */
export const isOutboxListRow = (
	status: RemitImapOutboxMessageStatus,
): boolean => status !== "draft" && status !== "sent";
