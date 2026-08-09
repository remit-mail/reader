/**
 * /mail/$mailboxId — one folder, the fullest of the four list layouts: list,
 * reading pane and intelligence rail.
 *
 * The literal lists are declared as siblings and TanStack matches literals
 * first, so a mailbox id can never be read as one of them.
 */
import { createFileRoute, Outlet } from "@tanstack/react-router";
import { MailShell } from "@/components/layout/MailShell";
import { MailboxPane } from "@/components/mail/MailboxPane";
import { useSearchMirror } from "@/hooks/useSearchMirror";
import { mailboxSearchSchema } from "@/lib/mail-search";

function MailboxLayout() {
	const { mailboxId } = Route.useParams();
	const { selectedMessageId } = Route.useSearch();
	useSearchMirror({ to: "/mail/$mailboxId", params: { mailboxId } });

	return (
		<MailboxPane mailboxId={mailboxId} selectedMessageId={selectedMessageId}>
			<MailShell
				phone={<MailboxPane.Phone />}
				list={<MailboxPane.List />}
				reading={<Outlet />}
				intelligence={<MailboxPane.Intelligence />}
				hasThread={Boolean(selectedMessageId)}
			/>
		</MailboxPane>
	);
}

export const Route = createFileRoute("/mail/$mailboxId")({
	component: MailboxLayout,
	validateSearch: mailboxSearchSchema,
});
