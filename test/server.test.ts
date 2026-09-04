/**
 * Local server test.
 *
 * The preview serves the vault over loopback, so the defences of SPEC 5.12
 * are behaviour worth pinning down: token, Host check, method allowlist,
 * path containment, and no CORS headers.
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { PreviewServer } from "../src/server/static";
import { Workspace } from "../src/build/workspace";
import { EPAGE_PARAM, PAGE_MESSAGE } from "../src/server/keepPage";

interface Result {
  status: number;
  body: string;
  headers: Record<string, string>;
}

async function get(
  url: string,
  options: { method?: string; host?: string } = {},
): Promise<Result> {
  const parsed = new URL(url);
  const http = await import("http");
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname + parsed.search,
        method: options.method ?? "GET",
        headers: options.host ? { Host: options.host } : undefined,
      },
      (response) => {
        let body = "";
        response.on("data", (chunk) => (body += chunk));
        response.on("end", () =>
          resolve({
            status: response.statusCode ?? 0,
            body,
            headers: response.headers as Record<string, string>,
          }),
        );
      },
    );
    request.on("error", reject);
    request.end();
  });
}

const checks: { label: string; ok: boolean; detail?: string }[] = [];
function check(label: string, ok: boolean, detail?: string): void {
  checks.push({ label, ok, detail });
}

async function main(): Promise<void> {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "vivlio-vault-"));
  fs.writeFileSync(path.join(vault, "note.md"), "hello vault");
  fs.mkdirSync(path.join(vault, "sub"));
  fs.writeFileSync(path.join(vault, "sub", "fig.txt"), "figure");

  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "vivlio-outside-"));
  fs.writeFileSync(path.join(outside, "secret.txt"), "should never be served");

  const server = new PreviewServer();
  await server.start({ vaultRoot: vault });

  const workspace = new Workspace("book");
  workspace.putText("index.html", "<p>generated</p>");
  server.addWorkspace(workspace);

  const base = server.base;
  const port = new URL(base).port;

  const generated = await get(`${base}/w/book/index.html`);
  check("serves a generated document", generated.body === "<p>generated</p>", generated.body);
  check(
    "no CORS header",
    generated.headers["access-control-allow-origin"] === undefined,
    JSON.stringify(generated.headers),
  );

  const vaultFile = await get(`${base}/vault/sub/fig.txt`);
  check("serves a vault file", vaultFile.body === "figure", vaultFile.body);

  const badToken = await get(
    `http://127.0.0.1:${port}/s/${"0".repeat(32)}/vault/note.md`,
  );
  check("wrong token is 404, not 403", badToken.status === 404, String(badToken.status));

  const badHost = await get(`${base}/vault/note.md`, { host: "book.example.com" });
  check("foreign Host is rejected", badHost.status === 404, String(badHost.status));

  const post = await get(`${base}/vault/note.md`, { method: "POST" });
  check("POST is 405", post.status === 405, String(post.status));

  const escape = await get(`${base}/vault/../../etc/passwd`);
  check("path traversal is refused", escape.status === 404, String(escape.status));

  const encodedEscape = await get(
    `http://127.0.0.1:${port}/s/${base.split("/").pop()}/vault/%2e%2e%2f%2e%2e%2fsecret.txt`,
  );
  check("encoded traversal is refused", encodedEscape.status === 404, String(encodedEscape.status));

  // An asset registered as an absolute path outside the vault is only served
  // when its directory was explicitly allowed.
  workspace.addAsset({
    publicPath: "assets/secret.txt",
    kind: "absolute",
    absolutePath: path.join(outside, "secret.txt"),
    mime: "text/plain",
    label: "secret",
  });
  const denied = await get(`${base}/w/book/assets/secret.txt`);
  check("unlisted outside root is refused", denied.status === 404, String(denied.status));

  workspace.extraRoots.add(outside);
  const allowed = await get(`${base}/w/book/assets/secret.txt`);
  check(
    "explicitly allowed root is served",
    allowed.body === "should never be served",
    `${allowed.status} ${allowed.body}`,
  );

  // The viewer resolves `src` as written: a percent-encoded URL becomes a
  // relative path under the viewer's own directory, 404s, and leaves the
  // viewer waiting for a document that never arrives.
  const bookUrl = server.bookViewerUrl(`${base}/w/book/publication.json`, {
    renderAllPages: true,
  });
  check(
    "viewer url keeps src unencoded",
    bookUrl.includes(`#src=${base}/w/book/publication.json&`),
    bookUrl,
  );
  check("viewer url asks for a book", bookUrl.includes("bookMode=true"), bookUrl);
  // Vivliostyle runs the scripts it finds in a publication unless it is told
  // not to, and its default is to allow them. The documents served here are
  // typeset from the vault, and nothing in a book needs to run.
  check(
    "viewer url turns scripting off",
    bookUrl.includes("allowScripts=false"),
    bookUrl,
  );

  // A rebuild replaces the frame's src, so the page the reader had reached
  // travels back in the fragment and is applied by the served script.
  check(
    "the viewer url carries no page when there is none to return to",
    !server
      .bookViewerUrl(`${base}/w/book/publication.json`, { renderAllPages: true, epage: 0 })
      .includes(EPAGE_PARAM),
  );
  const resumed = server.bookViewerUrl(`${base}/w/book/publication.json`, {
    renderAllPages: true,
    epage: 7,
  });
  check("the viewer url carries the page to return to", resumed.includes(`${EPAGE_PARAM}=7`), resumed);

  // What the frame's messages have to be checked against. `base` carries the
  // session path too, and a MessageEvent's origin never does, so comparing
  // against it silently discards every message the frame sends.
  check(
    "the origin is an origin",
    /^http:\/\/127\.0\.0\.1:\d+$/.test(server.origin),
    server.origin,
  );
  check("and the base is not", server.base !== server.origin && server.base.startsWith(server.origin));

  // The script rides with the viewer the plugin serves; the app itself is on
  // another origin and cannot reach into the frame to ask.
  const viewerPage = await get(`${base}/viewer/index.html`);
  check(
    "the served viewer carries the script that keeps the page",
    viewerPage.body.includes(PAGE_MESSAGE) && viewerPage.body.includes("navigateToPage"),
    String(viewerPage.status),
  );
  check(
    "the script is inside the document it was put in",
    viewerPage.body.lastIndexOf(PAGE_MESSAGE) < viewerPage.body.lastIndexOf("</body>"),
  );

  await server.stop();
  const afterStop = await get(`${base}/w/book/index.html`).catch(() => null);
  check("nothing is listening after stop", afterStop === null);

  let failed = 0;
  for (const result of checks) {
    if (!result.ok) failed += 1;
    console.log(
      `${result.ok ? "ok  " : "FAIL"} ${result.label}${
        result.detail && !result.ok ? `\n     ${result.detail}` : ""
      }`,
    );
  }
  if (failed > 0) {
    console.error(`\n${failed} check(s) failed`);
    process.exit(1);
  }
  console.log("\nall checks passed");
}

void main();
