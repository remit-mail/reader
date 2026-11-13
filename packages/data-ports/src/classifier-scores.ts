import {
	ClassifierLabelCountSchema,
	ClassifierScoreSchema,
	type ClassifierStatsSchema,
	SpamDayCountSchema,
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

const SpamDayCountRowsSchema = z.array(SpamDayCountSchema);

export const readSpamDayCounts = (
	rows: unknown,
): ClassifierStatsItem["spamByDay"] => SpamDayCountRowsSchema.parse(rows);

export const SPAM_SCORE_BAND_WIDTH = 0.05;

const SpamBandRowsSchema = z.array(
	z.object({ band: z.number().int().min(0), count: z.number().int() }),
);

export const readSpamScoreBands = (
	rows: unknown,
): ClassifierStatsItem["spamScoreBands"] =>
	SpamBandRowsSchema.parse(rows).map(({ band, count }) => ({
		from: Math.round(band * SPAM_SCORE_BAND_WIDTH * 100) / 100,
		count,
	}));
