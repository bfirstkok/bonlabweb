// Checks news date normalization and newest-first order. Usage: node scripts/test-news.mjs
import assert from "node:assert/strict";
import { toIsoDate, sortNewestFirst } from "../news.js";

assert.equal(toIsoDate("2026-11-18"), "2026-11-18");
assert.equal(toIsoDate("2026-11-18T08:38:01.000Z"), "2026-11-18");
assert.equal(toIsoDate("2026-11-18T08:38:01+0000"), "2026-11-18");          // Graph API created_time
assert.equal(toIsoDate("Mon, 31 Aug 2026 10:00:00 GMT"), "2026-08-31");      // RSS pubDate
assert.equal(toIsoDate(""), "");
assert.equal(toIsoDate("not a date"), "");

const sorted = sortNewestFirst([
    { id: "rss", date: "Mon, 31 Aug 2026 10:00:00 GMT" },
    { id: "none", date: "" },
    { id: "apify", date: "2026-11-18" },
    { id: "manual", date: "2026-09-02" },
]);
assert.deepEqual(sorted.map(p => p.id), ["apify", "manual", "rss", "none"]);
assert.equal(sorted[2].date, "2026-08-31");

console.log("news order: ok");
