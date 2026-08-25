# BONLAB Website

Static BONLAB pages with a server-backed visual editor at `/admin`.

## Local setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy `.env.example` to `.env` and set the admin username, password, and a long random session secret.

3. Start the website:

   ```bash
   npm start
   ```

The public website runs at `http://localhost:8000/` and the editor at `http://localhost:8000/admin/`.

## Editor

The editor can update text, links, images, styles, and page structure across all HTML pages. Every save creates a local backup in `backups/` before replacing the page file.

The admin editor requires the Node server. Static-only hosting such as GitHub Pages cannot persist editor changes.
