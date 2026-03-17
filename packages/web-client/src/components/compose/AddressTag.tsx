import { X } from "lucide-react";

interface AddressTagProps {
	email: string;
	displayName?: string;
	onRemove: () => void;
}

export const AddressTag = ({
	email,
	displayName,
	onRemove,
}: AddressTagProps) => (
	<span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-accent text-sm max-w-[200px]">
		<span className="truncate">{displayName || email}</span>
		<button
			type="button"
			onClick={onRemove}
			className="shrink-0 p-0.5 rounded-full hover:bg-muted-foreground/20 transition-colors"
			aria-label={`Remove ${email}`}
		>
			<X className="size-3" />
		</button>
	</span>
);
