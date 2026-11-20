// Date handling shared by every news source. Sources give ISO dates (Graph API, Apify) or
// RFC 822 dates (RSS pubDate, e.g. "Mon, 31 Aug 2026 10:00:00 GMT"). Stored dates must be
// YYYY-MM-DD so that sorting by string puts the newest post first.

export function toIsoDate(value) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return value;
    const date = new Date(value || NaN);
    // ponytail: UTC day, a post made just after midnight Thai time can show the previous day.
    return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

// Newest first; posts without a date go last.
export function sortNewestFirst(posts) {
    return posts
        .map(post => ({ ...post, date: toIsoDate(post.date) }))
        .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
}
