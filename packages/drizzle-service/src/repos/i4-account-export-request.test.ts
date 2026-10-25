import { openSqliteTestStores } from "../test-stores.js";
import { accountExportRequestRepoSuite } from "./i4-account-export-request.suite.js";

accountExportRequestRepoSuite(openSqliteTestStores);
