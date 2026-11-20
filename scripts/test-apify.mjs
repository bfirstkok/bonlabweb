// Checks the Apify -> news item mapping against a real (trimmed) dataset export.
// Usage: node scripts/test-apify.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { apifyPostToFeedItem, apifyItemsUrl } from "../apify.js";

const posts = JSON.parse(readFileSync(new URL("./fixtures/apify-facebook-posts.json", import.meta.url), "utf8"));
const items = posts.map(p => apifyPostToFeedItem(p, "100076231050286"));

assert.equal(items.length, 3);
for (const item of items) {
    assert.match(item.id, /^100076231050286_\d+$/);
    assert.ok(item.content_text.length > 0);
    assert.match(item.url, /^https:\/\/web\.facebook\.com\/permalink\.php\?story_fbid=pfbid/);
    assert.match(item.date_published, /^2026-11-\d\dT/);
    assert.match(item.image, /^https:\/\/scontent[^/]*\.fbcdn\.net\//);
}
// Album post: first media entry is the album link, the image comes from a later entry.
assert.equal(items[0].id, "100076231050286_1167245542493137");
// Single photo post uses photo_image.
assert.ok(items[2].image.includes("912057064_1165301002687591"));
// Missing fields do not throw.
assert.deepEqual(apifyPostToFeedItem({}, "1"), { id: "", content_text: "", url: "", date_published: "", image: "" });
assert.equal(apifyItemsUrl("apify~facebook-posts-scraper"),
    "https://api.apify.com/v2/acts/apify~facebook-posts-scraper/runs/last/dataset/items?status=SUCCEEDED&clean=true");

console.log("apify mapping: ok");
