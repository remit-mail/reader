import type { ReactNode } from "react";

export interface AttentionDotProps {
	children?: ReactNode;
	label?: string;
}

export function AttentionDot({ children, label }: AttentionDotProps) {
	return (
		<span className="relative inline-flex">
			{children}
			{label !== undefined && (
				<>
					<span
						data-testid="attention-dot"
						className="absolute -right-1 -top-1 size-2 rounded-full bg-accent-2"
					/>
					<span className="sr-only">{label}</span>
				</>
			)}
		</span>
	);
}
