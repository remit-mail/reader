import {
	configOperationsGetConfigOptions,
	mailboxOperationsListMailboxesOptions,
} from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import type { RemitImapMailboxResponse } from "@remit/api-http-client/types.gen.ts";
import {
	createFileRoute,
	type ErrorComponentProps,
	redirect,
} from "@tanstack/react-router";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { sortAccountsByCreatedAt } from "@/lib/account-order";
import { getMailboxPriority } from "@/lib/mailbox-order";

const MailIndexError = ({ error, reset }: ErrorComponentProps) => (
	<div className="flex h-full items-center justify-center bg-background p-4">
		<ErrorState
			title="Couldn't load your mailboxes"
			error={error}
			onRetry={reset}
		/>
	</div>
);

const pickPreferredMailbox = (
	mailboxes: RemitImapMailboxResponse[],
): RemitImapMailboxResponse | undefined => {
	if (mailboxes.length === 0) return undefined;
	return [...mailboxes].sort(
		(a, b) => getMailboxPriority(a.fullPath) - getMailboxPriority(b.fullPath),
	)[0];
};

export const Route = createFileRoute("/mail/")({
	loader: async ({ context: { queryClient } }) => {
		const config = await queryClient.ensureQueryData(
			configOperationsGetConfigOptions(),
		);
		const accounts = sortAccountsByCreatedAt(config.accounts ?? []);
		for (const account of accounts) {
			const mailboxes = await queryClient.ensureQueryData(
				mailboxOperationsListMailboxesOptions({
					path: { accountId: account.accountId },
				}),
			);
			const preferred = pickPreferredMailbox(mailboxes.items ?? []);
			if (preferred) {
				throw redirect({
					to: "/mail/$mailboxId",
					params: { mailboxId: preferred.mailboxId },
					replace: true,
				});
			}
		}
		return null;
	},
	component: MailIndex,
	errorComponent: MailIndexError,
});

function MailIndex() {
	return (
		<div className="flex flex-1 items-center justify-center bg-background">
			<EmptyState message="Select a mailbox to view messages" />
		</div>
	);
}
