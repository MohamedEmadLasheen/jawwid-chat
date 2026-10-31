// Tests read a content file exactly as written with `?raw`. Never in the bundle: the
// lessons-release plugin (vite.config.ts) refuses a JSON import with a query.
declare module '*?raw' {
  const text: string;
  export default text;
}
