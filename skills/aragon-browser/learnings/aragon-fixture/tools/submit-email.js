/**
 * Fill the email input and click Continue, then report what the page did.
 *
 * Note the locators: stable CSS and role locators, never a snapshot ref. A ref
 * would still work the first time and fail the second, which is exactly the bug
 * the validator rejects.
 */
export async function submitEmail(ctx, args = {}) {
  const { box } = ctx;
  if (!box) throw new Error("submitEmail needs ctx.box (a bound Page)");
  const email = String(args.email ?? "");
  if (!email) throw new Error("submitEmail requires args.email");

  await box.fill("css:#email", email);
  await box.click('loc=role:button[name="Continue"]');

  const result = await box.evaluate("document.getElementById('result').textContent");
  return { filled: email, result: String(result ?? "") };
}
