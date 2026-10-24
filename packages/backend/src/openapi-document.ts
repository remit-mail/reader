import spec from "@remit/api-openapi-spec/openapi.json" with { type: "json" };
import type { Document } from "openapi-backend";

const isDocument = (value: unknown): value is Document =>
	typeof value === "object" &&
	value !== null &&
	"openapi" in value &&
	typeof value.openapi === "string" &&
	"paths" in value;

const loadDocument = (value: unknown): Document => {
	if (!isDocument(value)) {
		throw new Error("@remit/api-openapi-spec is not an OpenAPI document");
	}
	return value;
};

// Bundled into whatever imports it, so no host has to place openapi.json on a
// filesystem next to the entry point — a Worker has no filesystem to read.
export const openApiSpec: Document = loadDocument(spec);
