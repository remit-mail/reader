import type {
	ConfigImportItem,
	CreateConfigImportInput,
	UpdateConfigImportInput,
} from "../types.js";

export interface IConfigImportRepository {
	create(input: CreateConfigImportInput): Promise<ConfigImportItem>;
	get(importId: string): Promise<ConfigImportItem>;
	update(
		importId: string,
		input: UpdateConfigImportInput,
	): Promise<ConfigImportItem>;
	/** Newest first, so the caller reads the import a person just ran. */
	listByAccountConfig(accountConfigId: string): Promise<ConfigImportItem[]>;
}
