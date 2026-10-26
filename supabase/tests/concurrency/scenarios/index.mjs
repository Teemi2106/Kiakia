import a from "./s01_03_accept.mjs";
import b from "./s04_07_expiry.mjs";
import c from "./s08_09_workers.mjs";
import d from "./s10_12_lifecycle.mjs";
import e from "./s13_16_search_outbox.mjs";
export const allScenarios = [...a, ...b, ...c, ...d, ...e].sort((x, y) => x.id - y.id);
