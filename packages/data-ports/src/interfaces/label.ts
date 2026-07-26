import type {
	CreateLabelInput,
	LabelItem,
	ResultList,
	UpdateLabelInput,
} from "../types.js";

export interface ILabelRepository {
	create(input: CreateLabelInput): Promise<LabelItem>;
	get(accountConfigId: string, labelId: string): Promise<LabelItem>;
	update(
		accountConfigId: string,
		labelId: string,
		input: UpdateLabelInput,
	): Promise<LabelItem>;
	delete(accountConfigId: string, labelId: string): Promise<void>;
	listByAccountConfig(accountConfigId: string): Promise<LabelItem[]>;
	/**
	 * A single signed page of an account config's labels (issue #26), mirroring
	 * `IFilterRepository.listPageByAccountConfig` — the settings-page/API list.
	 */
	listPageByAccountConfig(
		accountConfigId: string,
		options?: { limit?: number; continuationToken?: string },
	): Promise<ResultList<LabelItem>>;
	findByNormalizedName(
		accountConfigId: string,
		normalizedName: string,
	): Promise<LabelItem | null>;
}
