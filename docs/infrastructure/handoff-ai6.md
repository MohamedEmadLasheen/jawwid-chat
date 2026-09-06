# Handoff → AI #6 (UX / design system)

From AI #7 (infrastructure) · 2026-09-06

Infrastructure does not dictate UX. This is the short list of states the
*infrastructure* can actually produce, so the design system has a home for each.
What they look like is entirely yours.

| State | When it happens | What the user needs to understand |
|---|---|---|
| **Offline** | No connectivity | Their message is kept and will send. It is not lost. |
| **Reconnecting** | Socket dropped, server restarted, or a deploy | Transient. Deploys are rolling with a 15s drain, so a normal release should feel like a blink, not an error. |
| **Server unavailable** | An instance is draining because a dependency is down (503) | Temporary and being retried. **Not** a reason to show a login screen. |
| **Session revoked** | Auth rejected with a distinguishable code | Genuinely signed out — must look different from "server unavailable", because the required action is different. |
| **Upload failed** | Storage error, size limit, or an expired signed URL (300s) | Retryable. Size limits differ per media type. |
| **Call could not connect** | LiveKit unavailable or token expired | Calling alone is affected; messaging still works. Saying so prevents a support ticket. |
| **Notification not delivered** | Push provider failure or an invalid device token | Push is best-effort; in-app state is authoritative. Users should not conclude a message was never sent. |
| **Degraded feature** | Jawwid Core unavailable | Specific data is temporarily unavailable. The rest of the product is fine — this must not read as a total outage. |

Two things worth designing deliberately:

- **"Retrying" is a distinct state from "failed".** Infrastructure retries a
  great deal — jobs, Core calls, reconnects. Collapsing both into an error makes
  a self-healing system look broken.
- **A request id is available** (`X-Request-Id`, exposed to the browser).
  Surfacing it discreetly in an error state makes a support ticket traceable to
  a single request in the logs.
