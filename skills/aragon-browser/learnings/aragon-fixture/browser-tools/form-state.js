/**
 * Page-side site tool: a function expression evaluated in the page.
 *
 * It must be a single expression (the harness wraps it as
 * `const fn = <source>; await fn(args)`), and it may be async. Keep it
 * read-only unless the tool description says otherwise.
 */
() => {
  const email = document.getElementById("email");
  const result = document.getElementById("result");
  return {
    email: email ? email.value : null,
    result: result ? result.textContent : null,
    hasForm: Boolean(document.getElementById("form")),
    frameSrc: (() => {
      const frame = document.getElementById("pay");
      return frame ? frame.getAttribute("src") : null;
    })(),
  };
}
