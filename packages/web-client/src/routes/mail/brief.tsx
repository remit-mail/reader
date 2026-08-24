/**
 * /mail/brief — the daily brief, one of the four list layouts.
 *
 * The route mounts the list and the shell around it, and the reading pane is
 * the `Outlet`, so what the pane shows is whatever route is matched under this
 * one rather than a decision made somewhere above. The open thread and the
 * message inside it are the segments below, which is why nothing here reads a
 * selection out of the query.
 */
import {
	createFileRoute,
	type ErrorComponentProps,
	Outlet,
} from "@tanstack/react-router";
import { MailShell } from "@/components/layout/MailShell";
import { BriefPane } from "@/components/mail/BriefPane";
import { ErrorState } from "@/components/ui/ErrorState";
import { briefSearchSchema } from "@/lib/mail-search";
import { useOpenThreadPath, useSearchMirror } from "@/routing";

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
	const thread = useOpenThreadPath();
	useSearchMirror({ to: "/mail/brief" });

	return (
		<BriefPane thread={thread}>
			<MailShell
				phone={<BriefPane.Phone />}
				list={<BriefPane.List />}
				reading={<Outlet />}
				intelligence={<BriefPane.Intelligence />}
				hasThread={Boolean(thread)}
			/>
		</BriefPane>
	);
}

export const Route = createFileRoute("/mail/brief")({
	component: BriefLayout,
	validateSearch: briefSearchSchema,
	errorComponent: BriefError,
});
