// biome-ignore lint/style/useFilenamingConvention: TanStack Router convention
/**
 * /mail/outbox/compose — the compose surface, open over the outbox, and
 * /mail/outbox/compose/<outboxMessageId> for the draft it is editing.
 *
 * `draft/<outboxMessageId>` beside it reads an outbox message; this writes one.
 * The two are separate addresses because they are separate surfaces, and "Edit
 * as draft" is the move from one to the other.
 */
import { createFileRoute } from "@tanstack/react-router";
import { FullCompose } from "@/components/compose/FullCompose";

export const Route = createFileRoute(
	"/mail/outbox/compose/{-$outboxMessageId}",
)({
	component: FullCompose,
});
