# Facebook news on the BONLAB site

The news page shows Facebook content in three layers. If one layer fails, the others still work.

| Layer | Needs | When it breaks |
|---|---|---|
| Live Page Plugin (sidebar) | nothing | almost never (official Facebook embed) |
| Posts added by hand in `/admin/news.html` | admin login | never (stored in `data/news.json`, images in `data/uploads`) |
| Auto-sync every 30 min | `FB_PAGE_ACCESS_TOKEN`, or `APIFY_TOKEN`, or `FB_FEED_URL` in `.env` (first one set wins) | token revoked, Apify credit used up, feed service down; old posts stay, admin page shows the error |

## Auto-sync with Apify (no page token needed)

Use this while no page admin can create a token. Apify scrapes the public page on its own servers; the site only reads the result.

1. Sign up at <https://apify.com> on the **Free** plan ($5 of usage each month, no credit card).
2. Open the Actor `apify/facebook-posts-scraper`. Check its price says **per 1,000 posts** (pay per result). Do not use an Actor that says "trial, then $X/month".
3. Input: `startUrls` = `https://www.facebook.com/profile.php?id=100076231050286`, `resultsLimit` = `5`. Under **Run options** set **Maximum cost per run** to `0.10`. Run it once and check the Output has text, date and image.
4. **Schedules** → create a schedule for this Actor, once a day. The page posts every 2–3 days, so this costs about $0.75 a month.
5. Copy the API token from **Settings → API & Integrations**. On the server, edit `.env`:
   ```
   APIFY_TOKEN=<token>
   APIFY_ACTOR=apify~facebook-posts-scraper
   ```
   Then run `docker compose up -d` and press **ดึงข่าวจาก Facebook ตอนนี้** in `/admin/news.html`.

The server reads `runs/last/dataset/items` every 30 minutes. Reading does not start a run, so it costs nothing. When the monthly credit runs out, runs stop until next month and the site keeps the posts it already has.

## Turning on auto-sync (done once, by a page admin)

Only someone with full control of the BONLAB Facebook Page can do this. No app review and no cost are needed, because the app only reads its own admin's page.

1. Log in to Facebook as the page admin, open <https://developers.facebook.com/apps>, and create an app (type: Business, or "Other").
2. Open <https://developers.facebook.com/tools/explorer>, pick that app, choose **Get User Access Token**, and tick `pages_show_list` and `pages_read_engagement`. Press **Generate Access Token** and allow access to the BONLAB page.
3. Copy the token into <https://developers.facebook.com/tools/debug/accesstoken>, press **Debug**, then **Extend Access Token**. Copy the new long-lived token.
4. Back in Graph API Explorer, paste the long-lived token and run `GET me/accounts`. Copy the `access_token` of the BONLAB page.
5. Check that token in the Access Token Debugger: **Expires** must say **Never**.
6. On the server, edit `.env`:
   ```
   FB_PAGE_ID=100076231050286
   FB_PAGE_ACCESS_TOKEN=<page token from step 4>
   ```
   Then run `docker compose up -d`.
7. Open `/admin/news.html` and press **ดึงข่าวจาก Facebook ตอนนี้**. The status line should turn green.

The token stops working if the admin changes their Facebook password, removes the app, or loses the page role. Repeat steps 2–6 when the status line turns red.

Keep the token only in `.env` on the server. Never commit it or send it in chat.

## Without a token

Leave `FB_PAGE_ACCESS_TOKEN` empty. The site still shows the live Page Plugin, and the lab admin adds important posts in `/admin/news.html`: paste the post link, write a title, and upload a picture. Uploaded pictures are stored on the server, so they never expire like Facebook image links do.
