import type {
	RemitImapAccountResponse,
	RemitImapDescribeMessageResponse,
} from "@remit/api-http-client/types.gen.ts";
import { useState } from "react";
import { ComposeForm } from "./ComposeForm";
import type { ComposeMode } from "./ComposeProvider";

interface InlineComposeProps {
	mode: ComposeMode;
	account?: RemitImapAccountResponse;
	sourceMessage?: RemitImapDescribeMessageResponse;
	onClose: () => void;
}

/**
 * The reply, as the top block of the conversation it answers. It takes no
 * height of its own: it is as tall as what has been written in it and pushes
 * the thread down as that grows, so the pane keeps the one scrollbar it had
 * before the reply opened. A height here would give the pane a second one, with
 * the caret in the inner track.
 */
export const InlineCompose = ({
	mode,
	account,
	sourceMessage,
	onClose,
}: InlineComposeProps) => {
	// The reply's draft lives and dies with the reply. It is not addressable yet
	// — that is the `$mode` child route (#720) — so it is held here, where the
	// composer is, rather than anywhere a later composer could read it back.
	const [outboxMessageId, setOutboxMessageId] = useState<string>();

	return (
		<div className="border-b border-line bg-canvas">
			<ComposeForm
				layout="flow"
				mode={mode}
				account={account}
				sourceMessage={sourceMessage}
				outboxMessageId={outboxMessageId}
				onDraftCreated={setOutboxMessageId}
				onClose={onClose}
			/>
		</div>
	);
};
