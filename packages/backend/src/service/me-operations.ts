import type {
	CreateExportResponse,
	QuarantineListResponse,
	VipSuggestionsResponse,
} from "@remit/api-openapi-types";
import { SYNC_WARNING_SURFACE_ATTEMPTS } from "@remit/data-ports/sync-warning-state";
import { logger } from "@remit/logger";
import { toVipSuggestionEntry } from "../handlers/vip-suggestions.js";
import type { RemitClient } from "./data-client.js";

const SURFACED_WARNING_CAP = 200;

export const listVipSuggestionsFor = async (
	client: RemitClient<never>,
	accountConfigId: string,
): Promise<VipSuggestionsResponse> => ({
	suggestions: (
		await client.address.listSuggestedVips({ accountConfigId })
	).map(toVipSuggestionEntry),
});

export const listQuarantineFor = async (
	client: RemitClient<never>,
	accountConfigId: string,
): Promise<QuarantineListResponse> => {
	const [entries, warnings] = await Promise.all([
		client.quarantine.listByAccountConfigId(accountConfigId),
		client.syncWarning.listSurfacedByAccountConfigId(
			accountConfigId,
			SYNC_WARNING_SURFACE_ATTEMPTS,
			SURFACED_WARNING_CAP,
		),
	]);
	return { entries, warnings: warnings.items, warningsTotal: warnings.total };
};

export const createExportFor = async (
	client: RemitClient<"accountFanout">,
	accountConfigId: string,
	userId: string,
): Promise<CreateExportResponse> => {
	const exportRequest = await client.accountExportRequest.create({
		accountConfigId,
		userId,
		state: "Pending",
	});
	await client.queues.accountFanout.send({
		body: {
			type: "AccountExport",
			accountConfigId,
			accountExportRequestId: exportRequest.accountExportRequestId,
		},
	});
	// biome-ignore lint/plugin/no-logger-info: account export is an audit-grade signal
	logger.info(
		{
			accountConfigId,
			accountExportRequestId: exportRequest.accountExportRequestId,
		},
		"Account export initiated",
	);
	return { statusCode: 202, exportId: exportRequest.accountExportRequestId };
};
