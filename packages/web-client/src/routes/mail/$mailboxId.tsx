/**
 * /mail/$mailboxId — one folder, the fullest of the four list layouts: list,
 * reading pane and intelligence rail.
 *
 * The literal lists are declared as siblings and TanStack matches literals
 * first, so a mailbox id can never be read as one of them.
 *
 * The open thread and the message inside it are the segments below, which is why
 * nothing here reads a selection out of the query.
 */
import { createFileRoute, Outlet } from "@tanstack/react-router";
import { MailShell } from "@/components/layout/MailShell";
import { MailboxPane } from "@/components/mail/MailboxPane";
import { useSearchMirror } from "@/hooks/useSearchMirror";
import { mailboxSearchSchema } from "@/lib/mail-search";
import { useMailboxThreadPath } from "@/routing";

function MailboxLayout() {
	const { mailboxId } = Route.useParams();
	const thread = useMailboxThreadPath();
	useSearchMirror({ to: "/mail/$mailboxId", params: { mailboxId } });

	return (
		<MailboxPane mailboxId={mailboxId} thread={thread}>
			<MailShell
				phone={<MailboxPane.Phone />}
				list={<MailboxPane.List />}
				reading={<Outlet />}
				intelligence={<MailboxPane.Intelligence />}
				hasThread={Boolean(thread)}
			/>
		</MailboxPane>
	);
}

export const Route = createFileRoute("/mail/$mailboxId")({
	component: MailboxLayout,
	validateSearch: mailboxSearchSchema,
});
