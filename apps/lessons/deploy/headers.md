# Headers the lessons origin must send

```
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; media-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors <admin-web origin> <teacher-web origin>
Referrer-Policy: no-referrer
X-Content-Type-Options: nosniff
Permissions-Policy: camera=(), microphone=(), geolocation=()
```

- `frame-ancestors` can only be set as a header, never in the page's meta CSP.
- Fill it with Chat's origins when the deploy PR (P0-6) lands.
- Every path falls back to `index.html`.
