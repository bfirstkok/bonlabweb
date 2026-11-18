# Facebook news on the BONLAB site

The news page shows Facebook content in three layers. If one layer fails, the others still work.

| Layer | Needs | When it breaks |
|---|---|---|
| Live Page Plugin (sidebar) | nothing | almost never (official Facebook embed) |
| Posts added by hand in `/admin/news.html` | admin login | never (stored in `data/news.json`, images in `data/uploads`) |
| Auto-sync every 30 min | `FB_PAGE_ACCESS_TOKEN` (or `FB_FEED_URL`) in `.env` | token revoked, feed service down; old posts stay, admin page shows the error |

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
