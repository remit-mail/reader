import { MailboxScreen } from "@remit/ui";
import {
	account,
	inboxId,
	mailboxes,
	messages,
} from "@remit/ui/fixtures";
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	RouterProvider,
	useNavigate,
	useParams,
} from "@tanstack/react-router";

/**
 * A minimal-but-real TanStack memory router. Routes:
 *   /mailbox/$mailboxId                       — list, empty reading pane
 *   /mailbox/$mailboxId/message/$messageId    — list + reading pane
 * Clicking a folder or message navigates for real; the URL drives selection.
 */

function MailboxRoute({ messageId }: { messageId?: string }) {
	const navigate = useNavigate();
	const { mailboxId } = useParams({ strict: false }) as { mailboxId: string };

	return (
		<MailboxScreen
			accountEmail={account.email}
			mailboxes={mailboxes}
			messages={messages.filter((m) => m.message.mailboxId === mailboxId)}
			selectedMailboxId={mailboxId}
			selectedMessageId={messageId}
			onSelectMailbox={(id) =>
				navigate({ to: "/mailbox/$mailboxId", params: { mailboxId: id } })
			}
			onSelectMessage={(id) =>
				id
					? navigate({
							to: "/mailbox/$mailboxId/message/$messageId",
							params: { mailboxId, messageId: id },
						})
					: navigate({ to: "/mailbox/$mailboxId", params: { mailboxId } })
			}
		/>
	);
}

const rootRoute = createRootRoute();

const mailboxRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/mailbox/$mailboxId",
	component: () => <MailboxRoute />,
});

const messageRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/mailbox/$mailboxId/message/$messageId",
	component: () => {
		const { messageId } = useParams({
			from: "/mailbox/$mailboxId/message/$messageId",
		});
		return <MailboxRoute messageId={messageId} />;
	},
});

const routeTree = rootRoute.addChildren([mailboxRoute, messageRoute]);

export function makeInboxTriageRouter(startUrl = `/mailbox/${inboxId}`) {
	const history = createMemoryHistory({ initialEntries: [startUrl] });
	return createRouter({ routeTree, history });
}

export function InboxTriage({ startUrl }: { startUrl?: string }) {
	const router = makeInboxTriageRouter(startUrl);
	return <RouterProvider router={router} />;
}
