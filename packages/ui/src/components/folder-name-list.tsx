import { FolderNameRow, type FolderRole } from "./folder-name-row.js";

export interface FolderDescriptor {
	/** Stable row key (e.g. the mailbox id). */
	id: string;
	providerPath: string;
	detectedRole: FolderRole;
	role: FolderRole;
	name: string;
}

export interface FolderNameListProps {
	accountEmail: string;
	folders: readonly FolderDescriptor[];
	onCommit: (id: string, next: { role: FolderRole; name: string }) => void;
	onReset: (id: string) => void;
}

/**
 * The per-account "Folder names" settings section: a titled header, a one-line
 * description, and the list of {@link FolderNameRow}. Pure and controlled — the
 * caller owns the committed override state and routes each row's commit/reset
 * back by id.
 *
 * Only folders with a system role render. A folder whose committed role is
 * "custom" (no system role) is filtered out — demoting a row to Custom in the
 * picker is the escape hatch that drops it from this list.
 */
export function FolderNameList({
	accountEmail,
	folders,
	onCommit,
	onReset,
}: FolderNameListProps) {
	const systemFolders = folders.filter((folder) => folder.role !== "custom");
	return (
		<section className="space-y-3">
			<header className="space-y-1">
				<h2 className="text-sm font-semibold text-fg">
					System folders — {accountEmail}
				</h2>
				<p className="text-xs text-fg-muted">
					Rename a recognized folder, or correct the role we detected. Set a row
					to Custom to drop it from this list. The sidebar shows the display
					name; leave it blank to use the canonical default.
				</p>
			</header>
			<div className="rounded-sm border border-line bg-surface">
				{systemFolders.map((folder) => (
					<FolderNameRow
						key={folder.id}
						providerPath={folder.providerPath}
						detectedRole={folder.detectedRole}
						role={folder.role}
						name={folder.name}
						onCommit={(next) => onCommit(folder.id, next)}
						onReset={() => onReset(folder.id)}
					/>
				))}
			</div>
		</section>
	);
}
