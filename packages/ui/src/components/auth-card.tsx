import type { ReactNode } from "react";
import { cn } from "../lib/cn.js";

export interface AuthCardProps {
	children: ReactNode;
	className?: string;
}

/**
 * Sign-in page frame: full-height radial-gradient background that follows the
 * active theme, centring a max-width card column. Carries `data-auth-page` so
 * the co-located Amplify structural overrides (auth.css) apply to the
 * Authenticator rendered inside. One source of truth for the auth page frame
 * so it can't drift between the live shell and the story.
 */
export function AuthCard({ children, className }: AuthCardProps) {
	return (
		<div
			data-auth-page
			className={cn(
				"flex min-h-dvh w-full flex-col items-center justify-center overflow-y-auto bg-surface-sunken px-4 py-8 text-fg",
				className,
			)}
			style={{
				backgroundImage:
					"radial-gradient(at 20% 0%, color-mix(in oklch, var(--accent) 8%, transparent) 0px, transparent 50%), radial-gradient(at 80% 100%, color-mix(in oklch, var(--accent) 8%, transparent) 0px, transparent 50%)",
			}}
		>
			<div className="w-full max-w-[26rem]">{children}</div>
		</div>
	);
}
