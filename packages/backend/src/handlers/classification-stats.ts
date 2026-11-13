import { readClassifierStats } from "@remit/mailbox-service";
import { defaultErrorCode } from "../error.js";
import type {
	ClassificationStatsOperationIds,
	OperationHandler,
} from "../types.js";

export const ClassificationStatsOperations: Record<
	ClassificationStatsOperationIds,
	OperationHandler<ClassificationStatsOperationIds>
> = {
	ClassificationStatsOperations_getClassificationStats: async (
		context,
		ctx,
	) => {
		const { since } = context.request.query;
		const stats = await readClassifierStats(
			{
				account: ctx.client.account,
				mailbox: ctx.client.mailbox,
				message: ctx.client.message,
				address: ctx.client.address,
			},
			ctx.identity.accountConfigId,
			since,
		);
		if (!stats.ok) {
			return {
				statusCode: 400,
				body: { code: defaultErrorCode(400), message: stats.message },
			};
		}
		return stats.value;
	},
};
