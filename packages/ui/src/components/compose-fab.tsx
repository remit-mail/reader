import { Pencil } from "lucide-react";

export interface ComposeFabProps {
	onCompose: () => void;
}

export function ComposeFab({ onCompose }: ComposeFabProps) {
	return (
		<button
			type="button"
			onClick={onCompose}
			aria-label="Compose new message"
			className="lg:hidden fixed right-4 z-30 h-14 w-14 rounded-full bg-accent text-accent-fg shadow-lg flex items-center justify-center hover:opacity-90 active:scale-95 transition-all"
			style={{ bottom: "calc(env(safe-area-inset-bottom, 0) + 1rem)" }}
		>
			<Pencil className="size-6" />
		</button>
	);
}
