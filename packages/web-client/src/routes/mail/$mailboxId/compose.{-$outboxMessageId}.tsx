// biome-ignore lint/style/useFilenamingConvention: TanStack Router convention
/**
 * /mail/$mailboxId/compose — the compose surface, open over a folder, and
 * /mail/$mailboxId/compose/<outboxMessageId> for the draft it is editing. The
 * Drafts folder's own rows open here.
 */
import { createFileRoute } from "@tanstack/react-router";
import { FullCompose } from "@/components/compose/FullCompose";

export const Route = createFileRoute(
	"/mail/$mailboxId/compose/{-$outboxMessageId}",
)({
	component: FullCompose,
});
