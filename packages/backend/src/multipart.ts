import type { APIGatewayProxyEvent } from "aws-lambda";
import type { Operation } from "openapi-backend";

/**
 * A `multipart/form-data` body is bytes. openapi-backend hands its JSON-schema
 * validator whatever `parseRequest` produced, which for a binary body is an
 * unparsed string, and then fails the request for a missing `requestBody` — so
 * an operation that declares one validates its own payload instead. Derived
 * from the spec rather than an operation-id list, so a second upload endpoint
 * needs nothing here.
 */
export const declaresMultipartBody = (
	operation: Operation | undefined,
): boolean => {
	const requestBody = operation?.requestBody;
	if (!requestBody || !("content" in requestBody)) return false;
	return "multipart/form-data" in requestBody.content;
};

export interface UploadedFile {
	filename: string;
	contentType: string;
	content: Buffer;
}

export type ParsedUpload =
	| { readonly outcome: "Parsed"; readonly file: UploadedFile }
	| { readonly outcome: "Malformed" }
	| { readonly outcome: "NoSuchPart" };

const readHeader = (
	headers: APIGatewayProxyEvent["headers"],
	name: string,
): string | undefined => {
	for (const [key, value] of Object.entries(headers ?? {})) {
		if (key.toLowerCase() === name && typeof value === "string") return value;
	}
	return undefined;
};

const readBody = (event: APIGatewayProxyEvent) => {
	const decoded = Buffer.from(
		event.body ?? "",
		event.isBase64Encoded ? "base64" : "utf8",
	);
	const bytes = new Uint8Array(decoded.byteLength);
	bytes.set(decoded);
	return bytes;
};

/**
 * Pull one named file part out of a `multipart/form-data` request body.
 *
 * A body the platform parser refuses is a malformed request, not a fault: it
 * comes back as an outcome the caller turns into a typed refusal, the same way
 * a missing part does.
 */
export const readUploadedFile = async (
	event: APIGatewayProxyEvent,
	partName: string,
): Promise<ParsedUpload> => {
	const contentType = readHeader(event.headers, "content-type");
	if (!contentType?.toLowerCase().startsWith("multipart/form-data")) {
		return { outcome: "Malformed" };
	}

	const form = await new Response(readBody(event), {
		headers: { "content-type": contentType },
	})
		.formData()
		.catch(() => null);
	if (form === null) return { outcome: "Malformed" };

	const part = form.get(partName);
	if (part === null || typeof part === "string") {
		return { outcome: "NoSuchPart" };
	}

	return {
		outcome: "Parsed",
		file: {
			filename: part.name,
			contentType: part.type,
			content: Buffer.from(await part.arrayBuffer()),
		},
	};
};
