/**
 * Release traceability. Owner: AI #7 (infrastructure).
 *
 * Answers the only question that matters during an incident: "what exactly is
 * running right now?" The values are injected at image build time as
 * ARG/ENV, never read from the git working copy at runtime -- a running
 * container has no repository to ask.
 */
export interface BuildInfo {
  /** Git commit the image was built from. `unknown` outside a real build. */
  readonly commit: string;
  /** Human release identifier, e.g. `2026.09.05-3`. */
  readonly version: string;
  /** ISO-8601 image build timestamp. */
  readonly builtAt: string;
  /** local | staging | production. Never inferred -- always explicit. */
  readonly environment: string;
}

export function readBuildInfo(env: NodeJS.ProcessEnv = process.env): BuildInfo {
  return {
    commit: env.GIT_COMMIT ?? 'unknown',
    version: env.BUILD_VERSION ?? 'unknown',
    builtAt: env.BUILD_TIME ?? 'unknown',
    environment: env.APP_ENV ?? 'local',
  };
}
