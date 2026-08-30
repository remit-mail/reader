import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { OpenAPISpec } from "./index.js";

type Parameter = {
	name: string;
	in: string;
	explode?: boolean;
};

const queryParameters = (): Array<{
	operationId: string;
	param: Parameter;
}> => {
	const found: Array<{ operationId: string; param: Parameter }> = [];
	for (const item of Object.values(OpenAPISpec.paths ?? {})) {
		for (const operation of Object.values(item ?? {})) {
			const { operationId, parameters } = operation as {
				operationId?: string;
				parameters?: Parameter[];
			};
			if (!operationId || !parameters) continue;
			for (const param of parameters) {
				if (param.in === "query") found.push({ operationId, param });
			}
		}
	}
	return found;
};

describe("the built OpenAPI spec", () => {
	it("declares every query parameter exploded", () => {
		// openapi-backend splits a non-exploded query value on commas before it
		// validates, so `?refresh=true` arrives at the validator as `["true"]` and
		// is refused as "must be boolean" — the handler never runs. Exploded is the
		// wire-identical form for a scalar, so every `@query` in main.tsp carries
		// `#{ explode: true }`.
		const offenders = queryParameters()
			.filter(({ param }) => param.explode === false)
			.map(({ operationId, param }) => `${operationId}.${param.name}`);

		assert.deepEqual(offenders, []);
	});
});
