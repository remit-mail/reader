// biome-ignore lint/style/useFilenamingConvention: TanStack Router convention
/**
 * The reply, reply-all or forward under a conversation opened from Starred.
 *
 * The same shape as the brief's: a child of the message so the source is the
 * address, the mode as one param rather than three literal routes, and the
 * draft as an optional segment so recording it does not unmount the composer.
 * The conversation reads it off the address and opens it at its head.
 */
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute(
	"/mail/flagged/$threadId/$messageId/$mode/{-$outboxMessageId}",
)({});
