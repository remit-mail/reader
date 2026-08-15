import { configOperationsGetConfigOptions } from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { ErrorState } from "@/components/ui/ErrorState";
import { useKeyboardNavigation } from "@/hooks/useKeyboardNavigation";
import { useIsDesktop } from "@/hooks/useMediaQuery";
import {
	useAdoptComposeDraft,
	useCloseCompose,
	useComposeDraftId,
} from "@/routing";
import { ComposeForm } from "./ComposeForm";
import { composeSurfaceTitle } from "./compose-title";
import { MobileComposeSheet } from "./MobileComposeSheet";

/**
 * The compose surface, mounted by the compose route and by nothing else. It is
 * on screen because the address says so, and writing to the draft the address
 * names — so there is no flag to consult and nothing to be out of step with.
 */
export const FullCompose = () => {
	const outboxMessageId = useComposeDraftId();
	const adoptCreatedDraft = useAdoptComposeDraft();
	const closeCompose = useCloseCompose();
	const isDesktop = useIsDesktop();
	const {
		isError: isConfigError,
		error: configError,
		refetch: refetchConfig,
	} = useQuery({
		...configOperationsGetConfigOptions(),
		staleTime: Infinity,
	});

	useKeyboardNavigation({
		bindings: [{ key: "Escape", handler: closeCompose, preventDefault: true }],
	});

	if (!isDesktop) return <MobileComposeSheet />;

	const header = (
		<header className="flex items-center justify-between gap-2 px-4 py-3 border-b border-line shrink-0">
			<div className="flex items-center gap-2 min-w-0">
				<h2 className="text-lg font-semibold truncate">
					{composeSurfaceTitle(outboxMessageId)}
				</h2>
			</div>
			<button
				type="button"
				onClick={closeCompose}
				className="p-2 rounded-md hover:bg-surface-raised transition-colors min-h-11 min-w-11 inline-flex items-center justify-center"
				aria-label="Close"
			>
				<X className="size-5" />
			</button>
		</header>
	);

	if (isConfigError) {
		return (
			<div className="h-full flex flex-col bg-canvas">
				{header}
				<div className="flex-1 flex items-center justify-center p-4">
					<ErrorState
						title="Couldn't load compose"
						error={configError}
						onRetry={() => {
							refetchConfig();
						}}
					/>
				</div>
			</div>
		);
	}

	return (
		<div className="flex h-full min-h-0 flex-col bg-canvas">
			{header}
			<div className="min-h-0 flex-1 overflow-hidden">
				{/* No key on the draft: the first autosave writes the id it created
				    into the address, and remounting the form on that would take the
				    caret out of the sentence being typed. Switching to a different
				    draft is the form's own `outboxMessageId` effect. */}
				<ComposeForm
					mode="new"
					outboxMessageId={outboxMessageId}
					onDraftCreated={adoptCreatedDraft}
					onClose={closeCompose}
				/>
			</div>
		</div>
	);
};
