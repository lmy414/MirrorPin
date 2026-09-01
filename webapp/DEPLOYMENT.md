# MirrorPin Webapp deployment

- Upload every file from the ZIP root without changing the directory structure.
- Serve `.mjs` as `text/javascript` or `application/javascript`.
- The app is fully static and performs image decoding, generation, persistence, rendering, PNG export, and CSV export in the browser.
- No image or generated result is uploaded to or stored by a server.
- Root `index.html` redirects to `pages/index.html`; no rewrite rule is required.
- Physical alias directories provide extensionless `/generating`, `/result`, and `/error` routes and redirect to the corresponding files under `pages/`.
