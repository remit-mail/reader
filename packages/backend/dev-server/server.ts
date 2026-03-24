#!/usr/bin/env node --import tsx

import type { APIGatewayProxyResult } from "aws-lambda";
import { env } from "expect-env";
import express, {
	type NextFunction,
	type Request,
	type Response,
} from "express";
import * as swaggerUi from "swagger-ui-express";
import { handler, OpenAPISpec } from "../src/index.js";
import { createLambdaContext, createLambdaEvent } from "./lambda-helpers.js";

const app = express();

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

app.use((req: Request, res: Response, next: NextFunction) => {
	res.header("Access-Control-Allow-Origin", "*");
	res.header(
		"Access-Control-Allow-Methods",
		"GET, POST, PUT, DELETE, OPTIONS, PATCH",
	);
	res.header(
		"Access-Control-Allow-Headers",
		"Origin, X-Requested-With, Content-Type, Accept, Authorization",
	);

	if (req.method === "OPTIONS") {
		res.sendStatus(200);
	} else {
		next();
	}
});

app.get("/.well-known/appspecific/com.chrome.devtools.json", () => ({}));

app.get("/health", (_req: Request, res: Response) => {
	res.json({
		status: "ok",
		timestamp: new Date().toISOString(),
		service: "remit-backend-local",
	});
});

// Swagger UI with modified spec for local development
const localSpec = { ...OpenAPISpec };
if (localSpec.servers) {
	localSpec.servers[0].url = "/";
}

app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(localSpec));

app.all(/(.*)/, async (req: Request, res: Response) => {
	const event = createLambdaEvent(req);
	const context = createLambdaContext();

	const result: APIGatewayProxyResult = await handler(event, context);
	const headers = (result.headers ?? {}) as Record<string, string>;

	let body = result.body;

	if (
		typeof body === "string" &&
		headers["Content-Type"]?.includes("application/json")
	) {
		try {
			const parsed = JSON.parse(body);
			if (
				parsed &&
				typeof parsed === "object" &&
				"statusCode" in parsed &&
				"body" in parsed
			) {
				body =
					typeof parsed.body === "string"
						? JSON.parse(parsed.body)
						: parsed.body;
			} else {
				body = parsed;
			}
		} catch (e) {
			console.error("[dev-server] Failed to parse JSON:", e);
		}
	}

	res
		.setHeaders(new Map(Object.entries(headers)))
		.status(result.statusCode)
		.send(body);
});

const port = env.SERVER_PORT;

app.listen(Number(port), "0.0.0.0", () => {
	console.log(`Remit Backend running on http://localhost:${port}`);
	console.log(
		`OpenAPI documentation available at http://localhost:${port}/api-docs`,
	);

	console.table({
		SERVER_PORT: port,
		DYNAMODB_PORT: env.DYNAMODB_PORT,
		DYNAMODB_TABLE: env.DYNAMODB_TABLE_NAME,
		NODE_ENV: env.NODE_ENV,
	});

	process.send?.("ready");
});

export default app;
