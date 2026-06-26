import { X } from "lucide-react";
import { cn } from "../lib/cn.js";

export interface AddressTagProps {
	email: string;
	displayName?: string;
	onRemove: () => void;
	className?: string;
}

/**
 * Dismissible recipient chip for compose fields and filter UIs. Shows the
 * display name when present, falling back to the bare address, and truncates
 * to keep long addresses from breaking the field layout.
 */
export const AddressTag = ({
	email,
	displayName,
	onRemove,
	className,
}: AddressTagProps) => (
	<span
		className={cn(
			"inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-accent-2-soft text-sm max-w-[200px]",
			className,
		)}
	>
		<span className="truncate">{displayName || email}</span>
		<button
			type="button"
			onClick={onRemove}
			className="shrink-0 p-0.5 rounded-full hover:bg-fg-muted/20 transition-colors"
			aria-label={`Remove ${email}`}
		>
			<X className="size-3" />
		</button>
	</span>
);
