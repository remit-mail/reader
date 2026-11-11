import { McpErrorPage, type McpPageError } from "@remit/ui/mcp-pages";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { STYLESHEET_PATH } from "./assets.js";

const NEW_ISSUE_URL = "https://github.com/remit-mail/reader/issues/new";

const CONTENT_SECURITY_POLICY = [
	"default-src 'none'",
	"style-src 'self'",
	"style-src-attr 'unsafe-inline'",
	"font-src 'self'",
	"img-src 'self' data:",
	"base-uri 'none'",
	"frame-ancestors 'none'",
].join("; ");

export const reportIssueUrl = (title: string, details: string): string =>
	`${NEW_ISSUE_URL}?${new URLSearchParams({
		title: `MCP sign-in: ${title}`,
		body: `What happened:\n${details}\n\nWhat I was doing:\n`,
	})}`;

export const pageError = (message: string, fix: string): McpPageError => ({
	message,
	fix,
	reportUrl: reportIssueUrl(message, fix),
});

export const renderPage = (
	title: string,
	page: ReactElement,
	status = 200,
): Response =>
	new Response(
		`<!doctype html>${renderToStaticMarkup(
			<html lang="en">
				<head>
					<meta charSet="utf-8" />
					<meta name="viewport" content="width=device-width, initial-scale=1" />
					<meta name="referrer" content="no-referrer" />
					<title>{title}</title>
					<link rel="stylesheet" href={STYLESHEET_PATH} />
				</head>
				<body>{page}</body>
			</html>,
		)}`,
		{
			status,
			headers: {
				"content-type": "text/html; charset=utf-8",
				"cache-control": "no-store",
				"x-frame-options": "DENY",
				"x-content-type-options": "nosniff",
				"content-security-policy": CONTENT_SECURITY_POLICY,
			},
		},
	);

export const errorPage = (
	heading: string,
	message: string,
	fix: string,
	status: number,
): Response =>
	renderPage(
		heading,
		<McpErrorPage heading={heading} error={pageError(message, fix)} />,
		status,
	);
