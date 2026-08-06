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
	// Capped against the viewport as well as in pixels: on a short one — a phone
	// in landscape, or one with the keyboard up — a flat 400px is taller than
	// the pane, and the surface's own header scrolls off before its verbs do.
	<div className="border-t border-line bg-canvas max-h-[min(400px,60dvh)] flex flex-col">
		<ComposeForm
			mode={mode}
			account={account}
			sourceMessage={sourceMessage}
			onClose={onClose}
		/>
	</div>
);
