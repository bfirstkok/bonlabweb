// Reads the latest successful run of an Apify Actor (default: apify/facebook-posts-scraper)
// and converts its posts to the same item shape parseFeedContent() returns in server.js.
// The Actor runs on a schedule set in Apify Console; reading its dataset does not start a new run.

export function apifyItemsUrl(actor) {
    return `https://api.apify.com/v2/acts/${encodeURIComponent(actor)}/runs/last/dataset/items?status=SUCCEEDED&clean=true`;
}

export function apifyPostToFeedItem(post, pageId) {
    const photo = (post.media || []).find(m => m.photo_image?.uri || m.image?.uri || m.thumbnail);
    return {
        // Same id shape as the Graph API (<pageId>_<postId>), so switching to a page token later does not duplicate posts.
        id: post.postId ? `${pageId}_${post.postId}` : "",
        content_text: (post.text || "").trim(),
        url: (post.url || post.topLevelUrl || "").replace("https://www.facebook.com/", "https://web.facebook.com/"),
        date_published: post.time || (post.timestamp ? new Date(post.timestamp * 1000).toISOString() : ""),
        image: photo?.photo_image?.uri || photo?.image?.uri || photo?.thumbnail || "",
    };
}

export async function fetchApifyItems(token, actor, pageId) {
    const response = await fetch(apifyItemsUrl(actor), {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) return { ok: false, error: `Apify status ${response.status}` };
    const posts = await response.json();
    if (!Array.isArray(posts)) return { ok: false, error: "Apify returned no dataset items" };
    return { ok: true, items: posts.map(p => apifyPostToFeedItem(p, pageId)).filter(i => i.id && i.content_text) };
}
