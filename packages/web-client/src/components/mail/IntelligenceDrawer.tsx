import type { RemitImapThreadMessageResponse } from "@remit/api-http-client/types.gen.ts";
import { Drawer } from "@/components/layout/Drawer";
import { IntelligencePane } from "@/components/mail/IntelligencePane";

/**
 * The intelligence pane as a modal drawer — the surface every list pane uses
 * wherever the rail has no room, which is the phone and the two-pane desktop
 * band between 1024 and 1280px. Its open state is the caller's
 * (`useIntelligenceSurface`); what is inside it is the same panel the rail
 * mounts, minus its own close, because the drawer's header already carries one.
 */
export function IntelligenceDrawer({
	isOpen,
	onClose,
	thread,
	mailboxId,
	accountId,
	onAfterOptimisticRemove,
}: {
	isOpen: boolean;
	onClose: () => void;
	thread?: RemitImapThreadMessageResponse;
	mailboxId?: string;
	accountId?: string;
	onAfterOptimisticRemove?: (messageIds: string[]) => void;
}) {
	return (
		<Drawer
			isOpen={isOpen}
			onClose={onClose}
			ariaLabel="Message details"
			side="right"
			// The key that raised it takes it away again (#840); every other verb
			// stays with the list behind the scrim, which is not the subject here.
			answers={{ toggleIntelligence: onClose }}
		>
			<IntelligencePane
				onClose={onClose}
				thread={thread}
				mailboxId={mailboxId}
				accountId={accountId}
				hideCloseButton
				onAfterOptimisticRemove={onAfterOptimisticRemove}
			/>
		</Drawer>
	);
}
