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

type Schema = {
	$ref?: string;
	type?: string;
	required?: string[];
	properties?: Record<string, unknown>;
};

const resolve = (schema: Schema | undefined): Schema | undefined => {
	if (!schema?.$ref) return schema;
	const name = schema.$ref.replace("#/components/schemas/", "");
	return (OpenAPISpec.components?.schemas?.[name] ?? undefined) as
		| Schema
		| undefined;
};

const errorBodySchemas = (): Array<{
	operationId: string;
	status: string;
	schema: Schema | undefined;
}> => {
	const found: Array<{
		operationId: string;
		status: string;
		schema: Schema | undefined;
	}> = [];
	for (const item of Object.values(OpenAPISpec.paths ?? {})) {
		for (const operation of Object.values(item ?? {})) {
			const { operationId, responses } = operation as {
				operationId?: string;
				responses?: Record<
					string,
					{ content?: Record<string, { schema?: Schema }> }
				>;
			};
			if (!operationId || !responses) continue;
			for (const [status, response] of Object.entries(responses)) {
				if (Number(status) < 400) continue;
				const schema = response.content?.["application/json"]?.schema;
				if (!schema) continue;
				found.push({ operationId, status, schema: resolve(schema) });
			}
		}
	}
	return found;
};

// Issue #371: one error shape for the whole API. Every JSON refusal body is
// flat — `code` and `message` at the top level, no `error` envelope — and
// `code` is required, because it is the only field a client may branch on.
describe("the declared shape of an error response", () => {
	it("is a flat object carrying a required code and message", () => {
		const offenders = errorBodySchemas()
			.filter(({ schema }) => {
				const required = schema?.required ?? [];
				return (
					schema?.type !== "object" ||
					!required.includes("code") ||
					!required.includes("message")
				);
			})
			.map(({ operationId, status }) => `${operationId}.${status}`);

		assert.deepEqual(offenders, []);
	});

	it("never wraps the body in an envelope property", () => {
		const offenders = errorBodySchemas()
			.filter(({ schema }) => schema?.properties?.error !== undefined)
			.map(({ operationId, status }) => `${operationId}.${status}`);

		assert.deepEqual(offenders, []);
	});
});

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
