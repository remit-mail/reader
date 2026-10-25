import { openD1TestStores } from "../test-d1.js";
import { accountSettingRepoSuite } from "./i4-account-setting.suite.js";

accountSettingRepoSuite(openD1TestStores);
