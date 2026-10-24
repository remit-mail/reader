import type { ReactNode } from "react";
import { AuthCard } from "./auth-card.js";
import { AuthHero } from "./auth-hero.js";

export interface McpPermission {
	scope: string;
	description: string;
}

export interface McpPageError {
	message: string;
	fix: string;
	reportUrl: string;
}

export interface McpPageProps {
	heading: string;
	intro?: ReactNode;
	children: ReactNode;
}

export function McpPage({ heading, intro, children }: McpPageProps) {
	return (
		<AuthCard>
			<AuthHero wordmark="remit" tagline="Connect your AI assistant" />
			<main className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-7 shadow-lg">
				<div className="flex flex-col gap-1">
					<h2 className="text-lg font-semibold text-fg">{heading}</h2>
					{intro && <p className="text-sm text-fg-muted">{intro}</p>}
				</div>
				{children}
			</main>
		</AuthCard>
	);
}
