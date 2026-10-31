// The Node built-ins vite.config.ts uses (the lessons-release plugin), typed by hand:
// the engine declares no @types/node, and nothing under src/ may import a built-in
// (scripts/qa/check-lessons-supply-chain.py). Only what the config calls.
declare module 'node:fs' {
  export function readFileSync(path: string, encoding: 'utf-8'): string;
  export function writeFileSync(path: string, data: string): void;
}
declare module 'node:path' {
  export const sep: string;
  export function join(...parts: string[]): string;
  export function relative(from: string, to: string): string;
}
