/**
 * /mail/flagged — the Flagged virtual mailbox, one of the four list layouts.
 *
 * A flat starred list across accounts; same slots as the brief, intelligence
 * rail included.
 */
import {
	createFileRoute,
	type ErrorComponentProps,
	Outlet,
} from "@tanstack/react-router";
import { z } from "zod";
import { MailShell } from "@/components/layout/MailShell";
import { FlaggedPane } from "@/components/mail/FlaggedPane";
import { ErrorState } from "@/components/ui/ErrorState";
import { useSearchMirror } from "@/hooks/useSearchMirror";

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

function FlaggedLayout() {
	const { selectedMessageId } = Route.useSearch();
	useSearchMirror({ to: "/mail/flagged" });

	return (
		<FlaggedPane selectedMessageId={selectedMessageId}>
			<MailShell
				phone={<FlaggedPane.Phone />}
				list={<FlaggedPane.List />}
				reading={<Outlet />}
				intelligence={<FlaggedPane.Intelligence />}
				hasThread={Boolean(selectedMessageId)}
			/>
		</FlaggedPane>
	);
}

export const Route = createFileRoute("/mail/flagged")({
	component: FlaggedLayout,
	validateSearch: flaggedSearchSchema,
	errorComponent: FlaggedError,
});
