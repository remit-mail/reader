import type {
	ConfigDescriptionResponse,
	ConfigImportReport,
	ImportConfigInput,
} from "@remit/api-openapi-types";
import type { ReaderConfigDocument } from "@remit/config-format/document";
import type { ConfigExportIdentity } from "@remit/config-transfer";
import type { Context } from "openapi-backend";
import {
	exportConfigFor,
	getConfigFor,
	importConfigFor,
	triggerConfigLoadSyncs,
} from "../service/config-operations.js";
import type { QueueName } from "../service/queues.js";
import type {
	ConfigOperationIds,
	HandlerContext,
	OperationHandler,
} from "../types.js";

export { triggerConfigLoadSyncs };

export const configOperations = (
	exportIdentity: (config: HandlerContext["config"]) => ConfigExportIdentity,
) =>
	({
		ConfigOperations_getConfig: async (
			_context: Context,
			ctx: HandlerContext<"sync">,
		): Promise<ConfigDescriptionResponse> =>
			getConfigFor(ctx.client, ctx.identity.accountConfigId, ctx.config.commit),
		ConfigOperations_exportConfig: async (
			_context: Context,
			ctx: HandlerContext,
		): Promise<{ schemaVersion: number; document: ReaderConfigDocument }> =>
			exportConfigFor(
				ctx.client,
				ctx.identity.accountConfigId,
				exportIdentity(ctx.config),
			),
		ConfigOperations_importConfig: async (
			context: Context,
			ctx: HandlerContext,
		): Promise<ConfigImportReport> =>
			importConfigFor(
				ctx.client,
				ctx.identity.accountConfigId,
				context.request.requestBody as ImportConfigInput,
			),
	}) satisfies Record<
		ConfigOperationIds,
		OperationHandler<ConfigOperationIds, QueueName>
	>;
