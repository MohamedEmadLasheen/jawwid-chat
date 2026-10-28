# Headers the lessons origin must send

```
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; media-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors <admin-web origin> <teacher-web origin>
Referrer-Policy: no-referrer
X-Content-Type-Options: nosniff
Permissions-Policy: camera=(), microphone=(), geolocation=()
```

- `frame-ancestors` can only be set as a header, never in the page's meta CSP. **It is enforced by these deploy headers (P0-6), nowhere else**: a host that serves the build without them lets any site frame the lessons.
- Fill it with Chat's origins when the deploy PR (P0-6) lands.
- Every path falls back to `index.html`.

# What may be deployed

- **Only the `lessons-dist-<sha>` artifact of a CI run triggered by a push to `main`.** Never an artifact from a pull-request run (its code has not been merged), from another branch, or from a local build.
- The bundle carries the Quran snapshot's fingerprints (`vite.config.ts`, "THE TRUST ANCHOR"), so the deployed `data/quran/` must be the snapshot from that same run's `dist/`. The engine refuses any other.
