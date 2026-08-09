/**
 * /mail/brief — the daily brief, one of the four list layouts.
 *
 * The route mounts the list and the shell around it, and the reading pane is
 * the `Outlet`, so what the pane shows is whatever route is matched under this
 * one rather than a decision made somewhere above.
 */
import {
	createFileRoute,
	type ErrorComponentProps,
	Outlet,
} from "@tanstack/react-router";
import { MailShell } from "@/components/layout/MailShell";
import { BriefPane } from "@/components/mail/BriefPane";
import { ErrorState } from "@/components/ui/ErrorState";
import { useSearchMirror } from "@/hooks/useSearchMirror";
import { briefSearchSchema } from "@/lib/mail-search";

const BriefError = ({ error, reset }: ErrorComponentProps) => (
	<div className="flex h-full items-center justify-center bg-canvas p-4">
		<ErrorState
			title="Couldn't load your mailboxes"
			error={error}
			onRetry={reset}
		/>
	</div>
);

function BriefLayout() {
	const { selectedMessageId } = Route.useSearch();
	useSearchMirror({ to: "/mail/brief" });

	return (
		<BriefPane selectedMessageId={selectedMessageId}>
			<MailShell
				phone={<BriefPane.Phone />}
				list={<BriefPane.List />}
				reading={<Outlet />}
				intelligence={<BriefPane.Intelligence />}
				hasThread={Boolean(selectedMessageId)}
			/>
		</BriefPane>
	);
}

export const Route = createFileRoute("/mail/brief")({
	component: BriefLayout,
	validateSearch: briefSearchSchema,
	errorComponent: BriefError,
});
