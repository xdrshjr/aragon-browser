/**
 * Read the sign-in email field.
 *
 * Node-side site tools receive `(ctx, args)`. `ctx` carries the live helpers plus
 * `page`/`space`, so a tool can do real multi-step work rather than just
 * describing it.
 */
export async function readEmailField(ctx) {
  const { box } = ctx;
  if (!box) throw new Error("readEmailField needs ctx.box (a bound Page)");
  const value = await box.evaluate("document.getElementById('email').value");
  return String(value ?? "");
}
