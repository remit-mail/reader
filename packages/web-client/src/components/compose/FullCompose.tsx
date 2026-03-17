import { X } from "lucide-react";
import { ComposeForm } from "./ComposeForm";
import { useCompose } from "./ComposeProvider";

export const FullCompose = () => {
	const { state, closeCompose } = useCompose();

	if (!state.isOpen) return null;

	return (
		<div className="h-full flex flex-col">
			<header className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
				<h2 className="text-lg font-semibold">
					{state.mode === "reply" && "Reply"}
					{state.mode === "reply_all" && "Reply All"}
					{state.mode === "forward" && "Forward"}
					{state.mode === "new" && "New Message"}
				</h2>
				<button
					type="button"
					onClick={closeCompose}
					className="p-1 rounded hover:bg-accent transition-colors"
					aria-label="Close"
				>
					<X className="size-5" />
				</button>
			</header>
			<div className="flex-1 overflow-hidden">
				<ComposeForm
					mode={state.mode}
					account={state.account}
					sourceMessage={state.sourceMessage}
					onClose={closeCompose}
				/>
			</div>
		</div>
	);
};
