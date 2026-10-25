#!/usr/bin/env node
// openapi-backend compiles its request validators with ajv, and ajv compiles
// with `new Function`, which a Cloudflare Worker refuses. This builds the same
// validators from the same OpenAPI document ahead of time, through
// openapi-backend's own schema construction, and writes them as ajv standalone
// code next to the document, so no host compiles a validator at runtime.
//
// The options below must match the router's in @remit/backend's `api.ts`;
// `code` only changes how ajv emits the validator, not what it accepts.
//
// Usage: generate-request-validators.mjs <dir holding openapi.json>
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import Ajv, { _ } from "ajv";
import standaloneCode from "ajv/dist/standalone/index.js";
import { OpenAPIBackend } from "openapi-backend";

const dir = process.argv[2];
if (!dir) throw new Error("usage: generate-request-validators.mjs <dir>");

const definition = JSON.parse(readFileSync(join(dir, "openapi.json"), "utf8"));

const FORMAT_FUNCTIONS = {
	int32: "(value) => value >= -(2 ** 31) && value < 2 ** 31",
	int64: "(value) => value >= -(2 ** 63) && value < 2 ** 63",
	float: "() => true",
	double: "() => true",
	binary: "() => true",
	password: "() => true",
};

const formatSource = new Map();

const formatCode = (name, { type, validate }) => {
	if (validate instanceof RegExp)
		return `{ type: "${type}", validate: ${validate} }`;
	const fn = FORMAT_FUNCTIONS[name];
	if (!fn) throw new Error(`format "${name}" has no standalone implementation`);
	return `{ type: "${type}", validate: ${fn} }`;
};

let operationId = "";

class OperationAjv extends Ajv.default {
	operationIds = [];

	compile(schema, meta) {
		this.operationIds.push(operationId);
		return super.compile({ ...schema, $id: operationId }, meta);
	}
}

const ajvByContext = new Map();

const api = new OpenAPIBackend({
	definition,
	quick: true,
	coerceTypes: true,
	ajvOpts: { code: { source: true, formats: _`formats` } },
	customizeAjv: (original, ajvOpts, context) => {
		const existing = ajvByContext.get(context);
		if (existing) return existing;
		const ajv = new OperationAjv(ajvOpts);
		for (const [name, format] of Object.entries(original.formats)) {
			formatSource.set(name, formatCode(name, format));
			ajv.addFormat(name, format);
		}
		ajvByContext.set(context, ajv);
		return ajv;
	},
});
api.init();

const operations = api.router.getOperations();
for (const operation of operations) {
	operationId = operation.operationId;
	api.validator.buildRequestValidatorsForOperation(operation);
}

const CONTEXT_ORDER = ["requestBodyValidator", "paramsValidator"];
for (const context of ajvByContext.keys()) {
	if (!CONTEXT_ORDER.includes(context)) {
		throw new Error(`unexpected validation context ${context}`);
	}
}

const contexts = CONTEXT_ORDER.filter((context) =>
	ajvByContext.has(context),
).map((context) => {
	const ajv = ajvByContext.get(context);
	const name = context;
	const refs = Object.fromEntries(ajv.operationIds.map((id) => [id, id]));
	const code = standaloneCode
		.default(ajv, refs)
		.replaceAll('require("ajv/dist/runtime/ucs2length").default', "ucs2length");
	if (/\brequire\(/.test(code)) {
		throw new Error(`${context} validators need an ajv runtime module`);
	}
	return {
		name,
		ajv,
		source: `const ${name} = (() => {\nconst exports = {};\n${code}\nreturn exports;\n})();`,
	};
});

const entries = operations.map(({ operationId: id }) => {
	const validators = contexts
		.filter(({ ajv }) => ajv.operationIds.includes(id))
		.map(({ name }) => `${name}[${JSON.stringify(id)}]`);
	return `\t${JSON.stringify(id)}: [${validators.join(", ")}],`;
});

writeFileSync(
	join(dir, "request-validators.mjs"),
	[
		"const ucs2length = (value) => Array.from(value).length;",
		`const formats = {\n${[...formatSource].map(([name, code]) => `\t${name}: ${code},`).join("\n")}\n};`,
		...contexts.map(({ source }) => source),
		`export const requestValidators = {\n${entries.join("\n")}\n};`,
		"",
	].join("\n"),
);

writeFileSync(
	join(dir, "request-validators.d.mts"),
	[
		'import type { ValidateFunction } from "ajv";',
		"export declare const requestValidators: Readonly<Record<string, ValidateFunction[]>>;",
		"",
	].join("\n"),
);

console.log(
	`request validators: ${operations.length} operations in ${join(dir, "request-validators.mjs")}`,
);
