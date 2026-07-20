import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

// Search schema: `selectedOutboxMessageId` is read by `OutboxPane` in the
// parent `/mail` shell via `useSearch({ strict: false })`.
//
// `q` is inherited from the parent /mail route; re-declared here so it survives
// this route's own search validation and isn't dropped when navigating with a
// functional search updater.
const outboxSearchSchema = z.object({
	selectedOutboxMessageId: z.string().optional(),
	q: z.string().optional(),
});

export const Route = createFileRoute("/mail/outbox")({
	component: () => null,
	validateSearch: outboxSearchSchema,
});
