/**
 * /mail/ route (Daily Brief) — shell activation only.
 *
 * The component returns null because rendering is lifted to `mail.tsx`
 * which detects the brief route via `useRouterState` and mounts
 * `<BriefPane>` directly into `<AppShellSlotted>` slots.
 */
import {
	createFileRoute,
	type ErrorComponentProps,
} from "@tanstack/react-router";
import { z } from "zod";
import { ErrorState } from "@/components/ui/ErrorState";

const MailIndexError = ({ error, reset }: ErrorComponentProps) => (
	<div className="flex h-full items-center justify-center bg-canvas p-4">
		<ErrorState
			title="Couldn't load your mailboxes"
			error={error}
			onRetry={reset}
		/>
	</div>
);

// `q` is inherited from the parent /mail route; re-declared here so it
// survives this route's own search validation and isn't dropped when
// navigating with a functional search updater.
const briefSearchSchema = z.object({
	selectedMessageId: z.string().optional(),
	q: z.string().optional(),
});

export const Route = createFileRoute("/mail/")({
	component: () => null,
	validateSearch: briefSearchSchema,
	errorComponent: MailIndexError,
});
