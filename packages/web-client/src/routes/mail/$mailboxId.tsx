/**
 * /mail/$mailboxId route — shell activation only.
 *
 * The component returns null because rendering is lifted to `mail.tsx`
 * which reads the active mailboxId via `useRouterState` and mounts
 * `<MailboxPane>` directly into `<AppShellSlotted>` slots. TanStack Router
 * still needs this file to:
 *   - Register the route so URL matching works
 *   - Validate the search params so selectedMessageId is properly typed
 */
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

// Search schema includes q from parent route for proper inheritance
const mailboxSearchSchema = z.object({
	selectedMessageId: z.string().optional(),
	q: z.string().optional(),
});

export const Route = createFileRoute("/mail/$mailboxId")({
	component: () => null,
	validateSearch: mailboxSearchSchema,
});
