import {
	configOperationsGetConfigOptions,
	messageOperationsDescribeMessageOptions,
} from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import { useQuery } from "@tanstack/react-query";
import { useMailboxAccount } from "@/hooks/useMailboxAccount";
import {
	type ReplyAddress,
	useAdoptReplyDraft,
	useCloseReply,
} from "@/routing";
import { ComposeForm } from "./ComposeForm";

/**
 * The answer to a message, as the top block of the conversation it answers.
 *
 * It takes no height of its own: it is as tall as what has been written in it
 * and pushes the thread down as that grows, so the pane keeps the one scrollbar
 * it had before the reply opened. A height here would give the pane a second
 * one, with the caret in the inner track.
 *
 * Mode, source and draft are all segments of the address, so the surface is on
 * screen because the path says so and is writing to what the path names. The
 * conversation renders it because it belongs inside the thread and because the
 * phone has no reading `Outlet` for a route to fill.
 */
export const ConversationCompose = ({ surface }: { surface: ReplyAddress }) => {
	const adoptCreatedDraft = useAdoptReplyDraft();
	const closeReply = useCloseReply();

	const { data: sourceMessage } = useQuery({
		...messageOperationsDescribeMessageOptions({
			path: { messageId: surface.sourceMessageId },
		}),
	});

	const { data: config } = useQuery({
		...configOperationsGetConfigOptions(),
		staleTime: Infinity,
	});

	// The answer leaves from the identity the message reached, so the account is
	// the one owning the mailbox it was delivered to. Taking the head of the
	// configured list answered every account's mail from the first identity, and
	// left the reader's own address in the Cc of a Reply All (#819).
	const { accountId: deliveredToAccountId } = useMailboxAccount(
		sourceMessage?.message.mailboxId,
	);
	const account = config?.accounts?.find(
		(candidate) => candidate.accountId === deliveredToAccountId,
	);

	return (
		<div className="border-b border-line bg-canvas">
			{/* No key on the draft: the first autosave writes the id it created into
			    the address, and remounting the form on that would take the caret out
			    of the sentence being typed. */}
			<ComposeForm
				layout="flow"
				mode={surface.mode}
				account={account}
				sourceMessage={sourceMessage}
				outboxMessageId={surface.outboxMessageId}
				onDraftCreated={adoptCreatedDraft}
				onClose={closeReply}
			/>
		</div>
	);
};
