// biome-ignore lint/style/useFilenamingConvention: TanStack Router convention
/**
 * /mail/flagged/compose — the compose surface, open over the starred list, and
 * /mail/flagged/compose/<outboxMessageId> once it has a draft to write to.
 */
import { createFileRoute } from "@tanstack/react-router";
import { FullCompose } from "@/components/compose/FullCompose";

export const Route = createFileRoute(
	"/mail/flagged/compose/{-$outboxMessageId}",
)({
	component: FullCompose,
});
