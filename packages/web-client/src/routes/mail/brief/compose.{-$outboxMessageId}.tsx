// biome-ignore lint/style/useFilenamingConvention: TanStack Router convention
/**
 * /mail/brief/compose — the compose surface, open over the daily brief, and
 * /mail/brief/compose/<outboxMessageId> once it has a draft to write to.
 *
 * A sibling of the thread route, so navigating here unmatches whatever the list
 * had open in the same transition: nothing has to be closed first, and "opened"
 * and "rendered" are one fact.
 *
 * The draft is an optional segment of this one route rather than a child route,
 * because the first autosave adopts the id it just created while the reader is
 * still typing. Two routes would unmount the composer mid-sentence; one route
 * with a param that arrives is a rewritten address and nothing more.
 */
import { createFileRoute } from "@tanstack/react-router";
import { FullCompose } from "@/components/compose/FullCompose";

export const Route = createFileRoute("/mail/brief/compose/{-$outboxMessageId}")(
	{
		component: FullCompose,
	},
);
