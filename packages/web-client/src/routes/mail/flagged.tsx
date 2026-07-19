/**
 * /mail/flagged route (Flagged virtual mailbox) — shell activation only.
 *
 * The component returns null because rendering is lifted to `mail.tsx`, which
 * detects the flagged route via `useRouterState` and mounts `<FlaggedPane>`
 * directly into `<AppShellSlotted>` slots — the same pattern the brief uses.
 */
import {
	createFileRoute,
	type ErrorComponentProps,
} from "@tanstack/react-router";
import { z } from "zod";
import { ErrorState } from "@/components/ui/ErrorState";

const FlaggedError = ({ error, reset }: ErrorComponentProps) => (
	<div className="flex h-full items-center justify-center bg-canvas p-4">
		<ErrorState
			title="Couldn't load your starred mail"
			error={error}
			onRetry={reset}
		/>
	</div>
);

// `q` is inherited from the parent /mail route; re-declared here so it survives
// this route's own search validation and isn't dropped when navigating with a
// functional search updater.
const flaggedSearchSchema = z.object({
	selectedMessageId: z.string().optional(),
	q: z.string().optional(),
});

export const Route = createFileRoute("/mail/flagged")({
	component: () => null,
	validateSearch: flaggedSearchSchema,
	errorComponent: FlaggedError,
});
