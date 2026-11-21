import { createClient } from "@remit/api-http-client/client/index.js";
import type { PeopleDirectory } from "@remit/auth-service/people";
import type { RemitClient } from "@remit/backend/create-remit-client";
import { handlers, publicHandlers } from "@remit/backend/handlers";
import type { ApiConfig } from "@remit/backend/serve";
import { serveApi } from "@remit/backend/serve";
import { deriveAccountConfigId } from "@remit/data-ports/id";
import type { OperatorClient } from "./operator-tools.js";

const api = serveApi({ handlers, publicHandlers });

export interface OperatorApiHost {
	config: ApiConfig;
	client: () => Promise<RemitClient>;
	peopleDirectory: () => Promise<PeopleDirectory | null>;
}

export const createOperatorClient = (
	origin: string,
	host: OperatorApiHost,
	userId: string,
): OperatorClient =>
	createClient({
		baseUrl: origin,
		fetch: (request, init) =>
			api.handleFetch(
				request instanceof Request ? request : new Request(request, init),
				{
					...host,
					identity: async () => ({
						kind: "user",
						accountConfigId: deriveAccountConfigId(userId),
						sub: userId,
						email: `${userId}@subject.invalid`,
					}),
					operator: async () => true,
					operatorGrant: async () => true,
				},
				"mcp-operator",
			),
	});
