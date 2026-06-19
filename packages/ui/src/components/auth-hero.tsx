import type { ReactNode } from "react";

export interface AuthHeroProps {
	wordmark?: string;
	tagline?: string;
	mark?: ReactNode;
}

const EnvelopeMark = () => (
	<svg
		width="36"
		height="36"
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		strokeWidth="1.75"
		strokeLinecap="round"
		strokeLinejoin="round"
		aria-hidden="true"
		className="text-accent"
	>
		<rect x="3" y="5" width="18" height="14" rx="2" />
		<path d="M3 7l9 6 9-6" />
	</svg>
);

export function AuthHero({
	wordmark = "remit,",
	tagline = "your email client in the cloud.",
	mark = <EnvelopeMark />,
}: AuthHeroProps) {
	return (
		<div className="text-center pb-6">
			<div className="flex items-center justify-center pb-3">{mark}</div>
			<h1 className="text-[1.75rem] font-semibold tracking-[-0.01em] text-fg">
				{wordmark}
			</h1>
			<p className="mt-1 text-sm text-fg-muted">{tagline}</p>
		</div>
	);
}
