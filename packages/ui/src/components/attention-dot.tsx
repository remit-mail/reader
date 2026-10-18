import type { ReactNode } from "react";

export interface AttentionDotProps {
	/** The icon or control the hint is attached to. */
	children?: ReactNode;
	show: boolean;
	/** Read out to assistive tech in place of the bare dot. */
	label: string;
}

/**
 * The only way something that needs a look reaches outside settings: a dot on
 * the way there. It carries no count, no copy and no action, so it can never
 * grow into a prompt over someone's mail.
 */
export function AttentionDot({ children, show, label }: AttentionDotProps) {
	return (
		<span className="relative inline-flex">
			{children}
			{show && (
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
