/**
 * The coded 409 a delete or a move is refused with when the message's folder
 * and uid do not name the same message (#845). Read the `code`, never the
 * message: the server's sentence names a uuid and no remedy, and a
 * message-string match
 * would start firing on an unrelated conflict the moment the copy changes.
 */
import type { PushErrorInput } from "@/components/ui/error-banners";
import { type CodedApiErrorBody, codedApiErrorBody } from "@/lib/api";

/**
 * One reason, because one state produces the refusal: a mutation is still in
 * flight and the pair clears on its own, so the copy words a wait. A mutation
 * that gave up hands the row back to a placement the mail server confirmed
 * before it stops (imap-mutations R3), and that row is acted on rather than
 * refused — there is no second reason left to word.
 */
export type PlacementRefusalReason = "in_flight";

export interface PlacementRefusal {
	reason: PlacementRefusalReason;
	messageId: string;
}

const REASONS: ReadonlySet<string> = new Set<PlacementRefusalReason>([
	"in_flight",
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
 * What the user pressed. The same refusal answers a delete and a move, and the
 * banner names the action they took rather than one they never asked for.
 */
export type PlacementRefusalAction = "delete" | "move";

/**
 * The banner copy. It says what happened and what to do, is not a dead end, and
 * does not repeat the server's uuid at the user.
 */
export const placementRefusalBanner = (
	_refusal: PlacementRefusal,
	count: number,
	action: PlacementRefusalAction,
): PushErrorInput => ({
	severity: "warning",
	title:
		count > 1
			? `Couldn't ${action} ${count} messages yet`
			: `Couldn't ${action} this message yet`,
	detail: "It is still being moved on the mail server. Try again in a moment.",
});
