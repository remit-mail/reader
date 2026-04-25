import {
	configOperationsGetConfigOptions,
	mailboxOperationsListMailboxesOptions,
} from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import type { RemitImapMailboxResponse } from "@remit/api-http-client/types.gen.ts";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { EmptyState } from "@/components/ui/EmptyState";

const SYSTEM_MAILBOX_ORDER = [
	"inbox",
	"starred",
	"flagged",
	"sent",
	"drafts",
	"draft",
	"all",
	"archive",
	"spam",
	"junk",
	"trash",
	"deleted",
] as const;

const getMailboxPriority = (fullPath: string): number => {
	const name = fullPath.toLowerCase();
	for (let i = 0; i < SYSTEM_MAILBOX_ORDER.length; i++) {
		if (name.includes(SYSTEM_MAILBOX_ORDER[i])) {
			return i;
		}
	}
	return SYSTEM_MAILBOX_ORDER.length;
};

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
		const accounts = config.accounts ?? [];
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
});

function MailIndex() {
	return (
		<div className="flex flex-1 items-center justify-center bg-background">
			<EmptyState message="Select a mailbox to view messages" />
		</div>
	);
}
