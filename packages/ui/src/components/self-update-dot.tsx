import type { ReactNode } from "react";

export interface UpdateAvailableDotProps {
	/** The icon or control the hint is attached to. */
	children?: ReactNode;
	show: boolean;
	/** Read out to assistive tech in place of the bare dot. */
	label?: string;
}

/**
 * The only place an available update is allowed to reach outside settings: a
 * dot on the way there. It carries no count, no copy and no action, so it can
 * never grow into a prompt over someone's mail.
 */
export function UpdateAvailableDot({
	children,
	show,
	label = "Update available",
}: UpdateAvailableDotProps) {
	return (
		<span className="relative inline-flex">
			{children}
			{show && (
				<>
					<span className="absolute -right-0.5 -top-0.5 size-1.5 rounded-full bg-accent-2" />
					<span className="sr-only">{label}</span>
				</>
			)}
		</span>
	);
}
