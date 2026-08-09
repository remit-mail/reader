/**
 * /mail/$mailboxId — one folder, the fullest of the four list layouts: list,
 * reading pane and intelligence rail.
 *
 * The literal lists are declared as siblings and TanStack matches literals
 * first, so a mailbox id can never be read as one of them.
 */
import { createFileRoute, Outlet } from "@tanstack/react-router";
import { z } from "zod";
import { MailShell } from "@/components/layout/MailShell";
import { MailboxPane } from "@/components/mail/MailboxPane";
import { useSearchMirror } from "@/hooks/useSearchMirror";

// `q` is inherited from the parent /mail route; re-declared here so it survives
// this route's own search validation and isn't dropped when navigating with a
// functional search updater.
const mailboxSearchSchema = z.object({
	selectedMessageId: z.string().optional(),
	// A tapped semantic "Related" hit can point at a message outside the loaded
	// list; carrying its thread lets the mailbox open it directly (the mailbox is
	// the route param). See `buildConversationTarget`.
	selectedThreadId: z.string().optional(),
	q: z.string().optional(),
});

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
