import {
	ClassifierLabelCountSchema,
	ClassifierScoreSchema,
	type ClassifierStatsSchema,
} from "@remit/api-zod-schemas";
import { z } from "zod";
import type { ClassifierScoreItem } from "./types.js";

const StoredClassifierScoresSchema = z.array(ClassifierScoreSchema);

export const readStoredClassifierScores = (
	stored: unknown,
): ClassifierScoreItem[] => StoredClassifierScoresSchema.parse(stored);

export type ClassifierStatsItem = z.infer<typeof ClassifierStatsSchema>;

const LabelCountRowsSchema = z.array(ClassifierLabelCountSchema);

export const readClassifierLabelCounts = (
	rows: unknown,
): ClassifierStatsItem["byLabel"] => LabelCountRowsSchema.parse(rows);
