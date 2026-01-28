import { Menu, Settings } from "lucide-react";
import { SearchBar } from "./SearchBar";

interface HeaderProps {
	searchQuery: string;
	onSearchChange: (query: string) => void;
	onSearchClear: () => void;
}

export const Header = ({
	searchQuery,
	onSearchChange,
	onSearchClear,
}: HeaderProps) => (
	<header className="flex items-center gap-4 px-4 h-12 border-b border-border bg-background shrink-0">
		{/* Left: App branding */}
		<div className="flex items-center gap-2 shrink-0">
			<button
				type="button"
				className="p-1.5 rounded-md hover:bg-accent transition-colors"
				aria-label="Menu"
			>
				<Menu className="size-5" />
			</button>
			<span className="font-semibold text-foreground">Remit</span>
		</div>

		{/* Center: Search bar */}
		<div className="flex-1 max-w-xl mx-auto">
			<SearchBar
				value={searchQuery}
				onChange={onSearchChange}
				onClear={onSearchClear}
			/>
		</div>

		{/* Right: Settings */}
		<div className="flex items-center gap-2 shrink-0">
			<button
				type="button"
				className="p-1.5 rounded-md hover:bg-accent transition-colors"
				aria-label="Settings"
			>
				<Settings className="size-5" />
			</button>
		</div>
	</header>
);
