import type { ReactNode } from "react";
import { Panel } from "./Panel";

interface ThreePanelLayoutProps {
	sidebar: ReactNode;
	list: ReactNode;
	detail: ReactNode;
}

export const ThreePanelLayout = ({
	sidebar,
	list,
	detail,
}: ThreePanelLayoutProps) => (
	<div className="flex h-screen bg-background">
		<Panel className="w-[220px] shrink-0">{sidebar}</Panel>
		<Panel className="w-[360px] shrink-0">{list}</Panel>
		<Panel withBorder={false} className="flex-1">
			{detail}
		</Panel>
	</div>
);
