/**
 * The coded 409 a delete is refused with when the message's folder and uid do
 * not name the same message (#845). Read the `code`, never the message: the
 * server's sentence names a uuid and no remedy, and a message-string match
 * would start firing on an unrelated conflict the moment the copy changes.
 */
import type { PushErrorInput } from "@/components/ui/error-banners";
import { type CodedApiErrorBody, codedApiErrorBody } from "@/lib/api";

/**
 * `in_flight` clears on its own once the mail server confirms the move;
 * `unverified` does not, because the move gave up without confirming and
 * nothing routine repairs the row.
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

const stringAt = (
	details: CodedApiErrorBody["details"],
	key: string,
): string | undefined => {
	const value = details?.[key];
	return typeof value === "string" ? value : undefined;
};

export const isPlacementRefusal = (
	error: unknown,
): PlacementRefusal | undefined => {
	const body = codedApiErrorBody(error);
	if (body?.code !== "message_placement_unsettled") return undefined;
	const { details } = body;
	if (!details) return undefined;
	const reason = stringAt(details, "reason");
	const messageId = stringAt(details, "messageId");
	if (!reason || !REASONS.has(reason) || !messageId) return undefined;
	return { reason: reason as PlacementRefusalReason, messageId };
};

/**
 * The banner copy. Both reasons say what happened and what to do; neither is a
 * dead end, and neither repeats the server's uuid at the user.
 */
export const placementRefusalBanner = (
	refusal: PlacementRefusal,
	count: number,
): PushErrorInput => ({
	severity: "warning",
	title:
		count > 1
			? `Couldn't delete ${count} messages yet`
			: "Couldn't delete this message yet",
	detail:
		refusal.reason === "in_flight"
			? "It is still being moved on the mail server. Try again in a moment."
			: "An earlier move never finished, so where this message sits is unknown. Sync the folder, then delete it again.",
});
