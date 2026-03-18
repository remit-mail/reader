import type {
	RemitImapAccountResponse,
	RemitImapDescribeMessageResponse,
} from "@remit/api-http-client/types.gen.ts";
import { ComposeForm } from "./ComposeForm";
import type { ComposeMode } from "./ComposeProvider";

interface InlineComposeProps {
	mode: ComposeMode;
	account?: RemitImapAccountResponse;
	sourceMessage?: RemitImapDescribeMessageResponse;
	onClose: () => void;
}

export const InlineCompose = ({
	mode,
	account,
	sourceMessage,
	onClose,
}: InlineComposeProps) => (
	<div className="border-t border-border bg-background max-h-[400px] flex flex-col">
		<ComposeForm
			mode={mode}
			account={account}
			sourceMessage={sourceMessage}
			onClose={onClose}
		/>
	</div>
);
