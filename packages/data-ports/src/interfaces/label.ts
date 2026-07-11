import type {
	CreateLabelInput,
	LabelItem,
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
	findByNormalizedName(
		accountConfigId: string,
		normalizedName: string,
	): Promise<LabelItem | null>;
}
