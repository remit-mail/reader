all: build/remit-openapi3/openapi.json build/remit-openapi3/request-validators.mjs build/remit-client build/drizzle-entities/dist build/drizzle-entities-sqlite/dist build/zod-schemas/schemas.js

build/remit-openapi3/openapi.json: $(shell find typespec/ -type f)
	npx tsp compile ./typespec
	node npm-scripts/mark-side-effect-free.mjs build/ts-enums build/openapi-types build/zod-schemas build/ddb-entities build/drizzle-entities
	echo '{"name":"@remit/api-openapi-spec","version":"0.0.0","description":"Remit API OpenAPI 3 document, generated from TypeSpec, and its precompiled request validators.","sideEffects":false,"exports":{".":"./openapi.json","./openapi.json":"./openapi.json","./request-validators":{"types":"./request-validators.d.mts","default":"./request-validators.mjs"}},"files":["openapi.json","request-validators.mjs","request-validators.d.mts"]}' > build/remit-openapi3/package.json

build/remit-openapi3/request-validators.mjs: build/remit-openapi3/openapi.json npm-scripts/generate-request-validators.mjs
	node npm-scripts/generate-request-validators.mjs build/remit-openapi3

build/remit-client: build/remit-openapi3/openapi.json openapi-ts.config.js npm-scripts/build-api-client.mjs
	npx @hey-api/openapi-ts
	node npm-scripts/build-api-client.mjs
	touch $@

build/drizzle-entities/dist: build/remit-openapi3/openapi.json
	npm run build --prefix build/drizzle-entities
	touch $@

build/drizzle-entities-sqlite/schema.ts: $(shell find typespec/ -type f)
	npx tsp compile ./typespec --config ./typespec/tspconfig.sqlite.yaml
	node npm-scripts/mark-side-effect-free.mjs build/drizzle-entities-sqlite

build/drizzle-entities-sqlite/dist: build/drizzle-entities-sqlite/schema.ts
	npm run build --prefix build/drizzle-entities-sqlite
	touch $@

build/zod-schemas/schemas.js: build/remit-openapi3/openapi.json
	npx tsc -p build/zod-schemas

clean:
	rm -rf build */dist

.PHONY: clean
