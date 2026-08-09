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
import { z } from "zod";
import { MailShell } from "@/components/layout/MailShell";
import { BriefPane } from "@/components/mail/BriefPane";
import { ErrorState } from "@/components/ui/ErrorState";
import { useSearchMirror } from "@/hooks/useSearchMirror";

const BriefError = ({ error, reset }: ErrorComponentProps) => (
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
	// A tapped semantic "Related" hit can point at a message outside the loaded
	// brief list; carrying its thread + mailbox lets the brief open it directly.
	selectedThreadId: z.string().optional(),
	selectedMailboxId: z.string().optional(),
	q: z.string().optional(),
});

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
