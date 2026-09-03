/**
 * The coded 409 a delete is refused with when the message's folder and uid do
 * not name the same message (#845). Read the `code`, never the message: the
 * server's sentence names a uuid and no remedy, and a message-string match
 * would start firing on an unrelated conflict the moment the copy changes.
 */
import type { PushErrorInput } from "@/components/ui/error-banners";
import { apiErrorBody, apiErrorDetail } from "@/lib/api-error-body";

/**
 * `in_flight` clears on its own once the mail server confirms the move.
 * `unverified` never clears: nothing writes `status: "active"` outside a
 * confirmed move, so no retry and no resync repairs the row (#1005).
 */
export type PlacementRefusalReason = "in_flight" | "unverified";

export interface PlacementRefusal {
	reason: PlacementRefusalReason;
	messageId: string;
}

const REASONS: ReadonlySet<string> = new Set<PlacementRefusalReason>([
	"in_flight",
	"unverified",
]);

export const isPlacementRefusal = (
	error: unknown,
): PlacementRefusal | undefined => {
	const body = apiErrorBody(error);
	if (body?.code !== "message_placement_unsettled") return undefined;
	const { details } = body;
	if (typeof details !== "object" || details === null) return undefined;
	const reason = apiErrorDetail(details, "reason");
	const messageId = apiErrorDetail(details, "messageId");
	if (!reason || !REASONS.has(reason) || !messageId) return undefined;
	return { reason: reason as PlacementRefusalReason, messageId };
};

const STUCK_MOVE_ISSUE = "https://github.com/remit-mail/reader/issues/1005";

/**
 * The banner copy. `in_flight` is transient and says so. `unverified` offers no
 * remedy, because there is none — telling the user to sync and retry would send
 * them round a loop that returns the same refusal and blame them for it.
 */
export const placementRefusalBanner = (
	refusal: PlacementRefusal,
	count: number,
): PushErrorInput =>
	refusal.reason === "in_flight"
		? {
				severity: "warning",
				title:
					count > 1
						? `Couldn't delete ${count} messages yet`
						: "Couldn't delete this message yet",
				detail:
					"It is still being moved on the mail server. Try again in a moment.",
			}
		: {
				severity: "error",
				title:
					count > 1
						? `Couldn't delete ${count} messages`
						: "Couldn't delete this message",
				detail:
					"An earlier move stopped without finishing, so reader no longer knows which folder holds this message. Deleting it would risk destroying a different one, so it stays put. This needs a fix in reader; nothing you can do here clears it.",
				action: { label: "Follow the fix", href: STUCK_MOVE_ISSUE },
			};
