import { configOperationsGetConfigOptions } from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { ErrorState } from "@/components/ui/ErrorState";
import { useIsDesktop } from "@/hooks/useMediaQuery";
import { ComposeForm } from "./ComposeForm";
import { useCompose } from "./ComposeProvider";
import { MobileComposeSheet } from "./MobileComposeSheet";

const MODE_LABELS: Record<string, string> = {
	reply: "Reply",
	reply_all: "Reply All",
	forward: "Forward",
	new: "New Message",
};

export const FullCompose = () => {
	const { state, closeCompose } = useCompose();
	const isDesktop = useIsDesktop();

	if (!isDesktop) return <MobileComposeSheet />;

	const {
		isError: isConfigError,
		error: configError,
		refetch: refetchConfig,
	} = useQuery({
		...configOperationsGetConfigOptions(),
		staleTime: Infinity,
	});

	if (!state.isOpen) return null;

	const title = MODE_LABELS[state.mode] ?? "New Message";

	const header = (
		<header className="flex items-center justify-between gap-2 px-4 py-3 border-b border-line shrink-0">
			<div className="flex items-center gap-2 min-w-0">
				<h2 className="text-lg font-semibold truncate">{title}</h2>
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
		<div className="h-full flex flex-col bg-canvas">
			{header}
			<div className="flex-1 overflow-hidden">
				<ComposeForm
					key={state.outboxMessageId ?? "new"}
					mode={state.mode}
					account={state.account}
					sourceMessage={state.sourceMessage}
					onClose={closeCompose}
				/>
			</div>
		</div>
	);
};
