// The tenant search database (#1420) holds one FTS5 virtual table, which
// drizzle-kit cannot express: its DDL is the custom migration committed in
// deploy/vps/migrations-sqlite/search. This set therefore declares no table,
// and the drift guard holds it to that.
export {};
