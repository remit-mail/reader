// biome-ignore lint/style/useFilenamingConvention: TanStack Router convention
/**
 * /mail/brief/<thread>/<message>/reply — the answer to that message, written at
 * the head of the conversation it answers, and
 * /mail/brief/<thread>/<message>/reply/<outboxMessageId> once it has a draft.
 *
 * A child of the message, so a reply cannot exist without a source and the
 * conversation stays matched behind it. `reply`, `reply-all` and `forward` are
 * one param rather than three literal routes: they differ in what the composer
 * opens on, not in what the address mounts.
 *
 * The draft is an optional segment of this one route rather than a child of it,
 * because the first autosave adopts the id it just created while the reader is
 * still typing. Two routes would unmount the composer mid-sentence; one route
 * with a param that arrives is a rewritten address and nothing more.
 *
 * The route declares the segments and mounts nothing itself. The composer opens
 * inside the conversation, above the turn it answers, and the conversation is
 * the single pane on a phone — where there is no reading `Outlet` to fill — so
 * the pane reads the reply off the address, the way the shell reads compose.
 */
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute(
	"/mail/brief/$threadId/$messageId/$mode/{-$outboxMessageId}",
)({});
