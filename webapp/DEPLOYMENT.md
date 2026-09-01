# MirrorPin Webapp deployment

- Upload every file from the ZIP root without changing the directory structure.
- Serve `.mjs` as `text/javascript` or `application/javascript`.
- The app is fully static; image processing, generation, rendering, and exports run in the browser.
- Images and generated results remain on the user's device.
- Root `index.html` redirects to `pages/index.html`; no rewrite rule is required.
- Physical alias directories provide extensionless `/generating`, `/result`, and `/error` routes and redirect to the corresponding files under `pages/`.
