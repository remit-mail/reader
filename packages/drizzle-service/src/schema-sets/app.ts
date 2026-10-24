// The app database's entity tables (#1420): what lives in the client —
// accounts, config, rules, settings and calendars. The better-auth identity
// tables join them from auth-service; the app migration set's drizzle-kit
// config lists both sources.
export {
	accountConfigs,
	accountExportRequests,
	accountSettings,
	accounts,
	calendarCollections,
	calendarEventIndexes,
	calendarFeedTokens,
	calendarObjects,
	configImports,
	filters,
	labels,
} from "@remit/drizzle-sqlite-schema";
