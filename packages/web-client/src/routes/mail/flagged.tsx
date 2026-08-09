/**
 * /mail/flagged — the Flagged virtual mailbox, one of the four list layouts.
 *
 * A flat starred list across accounts; same slots as the brief, intelligence
 * rail included. The reading pane is the `Outlet`, so what it shows is whatever
 * route matched below this one, and the open thread and the message inside it
 * are the segments there rather than a selection read out of the query.
 */
import {
	createFileRoute,
	type ErrorComponentProps,
	Outlet,
} from "@tanstack/react-router";
import { MailShell } from "@/components/layout/MailShell";
import { FlaggedPane } from "@/components/mail/FlaggedPane";
import { ErrorState } from "@/components/ui/ErrorState";
import { useSearchMirror } from "@/hooks/useSearchMirror";
import { flaggedSearchSchema } from "@/lib/mail-search";
import { useOpenThreadPath } from "@/routing";

const FlaggedError = ({ error, reset }: ErrorComponentProps) => (
	<div className="flex h-full items-center justify-center bg-canvas p-4">
		<ErrorState
			title="Couldn't load your starred mail"
			error={error}
			onRetry={reset}
		/>
	</div>
);

function FlaggedLayout() {
	const thread = useOpenThreadPath();
	useSearchMirror({ to: "/mail/flagged" });

	return (
		<FlaggedPane thread={thread}>
			<MailShell
				phone={<FlaggedPane.Phone />}
				list={<FlaggedPane.List />}
				reading={<Outlet />}
				intelligence={<FlaggedPane.Intelligence />}
				hasThread={Boolean(thread)}
			/>
		</FlaggedPane>
	);
}

export const Route = createFileRoute("/mail/flagged")({
	component: FlaggedLayout,
	validateSearch: flaggedSearchSchema,
	errorComponent: FlaggedError,
});
