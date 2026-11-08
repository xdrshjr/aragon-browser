import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Local fixture for the smoke run.
 *
 * Deliberate design choices, each of which exercises a real failure mode:
 *  - the iframe is served from `localhost` while the page is `127.0.0.1`, so it
 *    is genuinely cross-site (out-of-process) rather than a same-origin frame;
 *  - the page has a duplicate-text button and a shadow-DOM component, so the
 *    locator grammar's nth and shadow-piercing paths are actually used;
 *  - one button opens a `confirm()`, so dialog handling is not theoretical.
 */
export function startFixture(port = 0, artifactDir) {
  const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), "aragon-upload-"));
  const uploadFile = path.join(uploadDir, "upload me.txt");
  fs.writeFileSync(uploadFile, "a file the agent attached\n");

  const server = http.createServer((request, response) => {
    const host = request.headers.host ?? "127.0.0.1";
    const url = new URL(request.url ?? "/", `http://${host}`);
    const port = server.address().port;

    if (url.pathname === "/frame") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(`<!doctype html>
<html><body style="margin:0;padding:8px;font:13px sans-serif">
  <h2 style="margin:4px 0">Payment frame</h2>
  <label for="code">Code</label>
  <input id="code" aria-label="Code" style="width:90px" />
  <button id="paybtn" type="button">Pay now</button>
  <p id="frame-note">frame loaded</p>
  <script>
    document.getElementById('paybtn').addEventListener('click', () => {
      document.getElementById('frame-note').textContent =
        'frame-clicked:' + document.getElementById('code').value;
    });
  </script>
</body></html>`);
      return;
    }

    if (url.pathname === "/submit") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end("<!doctype html><html><body><h1>Submitted</h1></body></html>");
      return;
    }

    if (url.pathname === "/") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(`<!doctype html>
<html>
  <head><title>aragon fixture</title></head>
  <body>
    <h1>Sign in</h1>
    <form id="form" action="/submit">
      <label for="email">Email</label>
      <input id="email" aria-label="Email" required />
      <button id="go" type="button">Continue</button>
    </form>
    <div id="result"></div>

    <section id="dup">
      <button class="dup" type="button">Same</button>
      <button class="dup" type="button">Same</button>
    </section>

    <button id="ask" type="button">Ask</button>
    <p id="ask-result">no dialog yet</p>

    <input id="file" type="file" aria-label="Attachment" />
    <p id="file-result">no file yet</p>

    <div id="dropzone" style="width:120px;height:40px;background:#ddd">drop here</div>
    <div id="dragsource" style="width:60px;height:20px;background:#bbb">drag me</div>
    <p id="drag-result">no drag yet</p>

    <div id="shadow-host"></div>

    <iframe id="pay" title="payment" src="http://localhost:${port}/frame"></iframe>

    <script>
      document.getElementById('go').addEventListener('click', () => {
        const value = document.getElementById('email').value;
        document.getElementById('result').textContent = 'clicked:' + value;
      });

      document.getElementById('ask').addEventListener('click', () => {
        const answer = window.confirm('Delete everything?');
        document.getElementById('ask-result').textContent = 'answer:' + answer;
      });

      document.getElementById('file').addEventListener('change', (event) => {
        const file = event.target.files && event.target.files[0];
        document.getElementById('file-result').textContent = file
          ? 'file:' + file.name + ':' + file.size
          : 'file:none';
      });

      const source = document.getElementById('dragsource');
      const zone = document.getElementById('dropzone');
      let dragging = false;
      source.addEventListener('pointerdown', () => { dragging = true; });
      zone.addEventListener('pointerenter', () => {
        if (dragging) document.getElementById('drag-result').textContent = 'drag:entered';
      });
      source.addEventListener('pointerup', () => { dragging = false; });

      // A shadow-DOM component: the locator grammar pierces it, plain
      // document.querySelectorAll cannot.
      const host = document.getElementById('shadow-host');
      const root = host.attachShadow({ mode: 'open' });
      root.innerHTML = '<button type="button">Shadow action</button>';
      root.querySelector('button').addEventListener('click', () => {
        document.getElementById('result').textContent = 'shadow-clicked';
      });
    </script>
  </body>
</html>`);
      return;
    }

    response.writeHead(404, { "content-type": "text/plain" });
    response.end("not found");
  });

  return new Promise((resolve) => {
    server.listen(port, "0.0.0.0", () => {
      const address = server.address();
      resolve({
        server,
        port: address.port,
        baseUrl: `http://127.0.0.1:${address.port}/`,
        uploadFile,
        uploadDir,
        artifactDir,
        close: () =>
          new Promise((done) => {
            server.close(done);
            fs.rmSync(uploadDir, { recursive: true, force: true });
          }),
      });
    });
  });
}
