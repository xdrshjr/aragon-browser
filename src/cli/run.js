import { skillSummary } from "./helpers.js";

/**
 * Executes agent JavaScript the way the ego lite CLI does: the script body is
 * wrapped in an async IIFE and every helper is injected as a parameter, so
 * `return` works at the top level and nothing has to be imported.
 */
export async function runScript(code, helpers, { log = console.log } = {}) {
  const names = Object.keys(helpers);
  const values = names.map((name) => helpers[name]);
  const wrapped = `return (async () => {\n${code}\n})();`;
  let fn;
  try {
    fn = new Function(...names, wrapped);
  } catch (error) {
    throw new Error(`script did not compile: ${error.message}`);
  }
  const previousArgon = globalThis.aragon;
  globalThis.aragon = { ...helpers, helpers: skillSummary() };
  try {
    const result = await fn(...values);
    if (result !== undefined) {
      log(typeof result === "string" ? result : JSON.stringify(result, null, 2));
    }
    return result;
  } finally {
    globalThis.aragon = previousArgon;
  }
}
