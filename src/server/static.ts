import { randomBytes } from "crypto";
import * as fs from "fs";
import * as http from "http";
import type { Socket } from "net";
import { Workspace } from "../build/workspace";
import { isInside, joinPosix, mimeType, normalizeAbsolute } from "../util/paths";
import { log } from "../util/log";
import { themeAssets, viewerAssets } from "../vendor/assets";
import { EPAGE_PARAM, withKeepPageScript } from "./keepPage";

const HOST = "127.0.0.1";

export interface ServerOptions {
  /** Absolute path of the vault root. */
  vaultRoot: string;
  /** 0 lets the OS choose an ephemeral port. */
  fixedPort?: number;
}

/**
 * Static HTTP server for the preview and the export webview.
 *
 * Vivliostyle fetches the document, its stylesheets and its images over XHR,
 * which rules out `file://` and `srcdoc` (SPEC 3.2). Serving the vault over
 * loopback is effectively exposing it to every process on the machine, so the
 * defences of SPEC 5.12 are part of the contract here:
 *
 *  1. bind 127.0.0.1 only
 *  2. every URL carries a per-session token, wrong token -> 404 (not 403)
 *  3. the `Host` header must be the loopback address (DNS rebinding)
 *  4. no CORS headers, ever
 *  5. paths are resolved and checked against a root allowlist
 *  6. GET / HEAD only
 *  7. the token is never logged
 */
export class PreviewServer {
  private server: http.Server | null = null;
  private sockets = new Set<Socket>();
  private workspaces = new Map<string, Workspace>();
  private token = "";
  private port = 0;
  private vaultRoot = "";
  private options: ServerOptions | null = null;

  get running(): boolean {
    return this.server !== null;
  }

  /** `http://127.0.0.1:<port>` — scheme, host and port, and nothing else. */
  get origin(): string {
    return `http://${HOST}:${this.port}`;
  }

  /** `http://127.0.0.1:<port>/s/<token>` — never write this to the log. */
  get base(): string {
    return `${this.origin}/s/${this.token}`;
  }

  async start(options: ServerOptions): Promise<void> {
    if (this.server) return;
    this.options = options;
    this.vaultRoot = normalizeAbsolute(options.vaultRoot);
    this.token = randomBytes(16).toString("hex");

    const server = http.createServer((req, res) => {
      this.handle(req, res).catch((error) => {
        log.error("request failed", error);
        if (!res.headersSent) res.writeHead(500);
        res.end();
      });
    });
    server.on("connection", (socket) => {
      this.sockets.add(socket);
      socket.on("close", () => this.sockets.delete(socket));
    });

    this.port = await listen(server, options.fixedPort ?? 0);
    this.server = server;
    log.info(`preview server listening on ${HOST}:${this.port}`);
  }

  async stop(): Promise<void> {
    const server = this.server;
    if (!server) return;
    this.server = null;
    for (const socket of this.sockets) socket.destroy();
    this.sockets.clear();
    this.workspaces.clear();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    this.token = "";
    this.port = 0;
    log.info("preview server stopped");
  }

  addWorkspace(workspace: Workspace): void {
    this.workspaces.set(workspace.id, workspace);
  }

  removeWorkspace(id: string): void {
    this.workspaces.delete(id);
  }

  get workspaceCount(): number {
    return this.workspaces.size;
  }

  /** URL of a file inside a workspace. */
  workspaceUrl(workspace: Workspace, path = ""): string {
    return `${this.base}/w/${workspace.id}/${path}`;
  }

  viewerUrl(): string {
    return `${this.base}/viewer/index.html`;
  }

  /**
   * The viewer, pointed at a book.
   *
   * `src` must be the plain URL: the viewer does not percent-decode the
   * fragment, so an encoded URL is taken as a relative path and looked up
   * under the viewer's own directory, where it 404s and the viewer waits for
   * a document that never arrives. The URLs handed in here are built from
   * hex tokens and fixed file names, so they carry nothing that would need
   * escaping in a fragment.
   */
  bookViewerUrl(
    publicationUrl: string,
    options: { renderAllPages: boolean; cacheBust?: boolean; epage?: number } = {
      renderAllPages: true,
    },
  ): string {
    const params = [
      `src=${publicationUrl}`,
      "bookMode=true",
      `renderAllPages=${options.renderAllPages}`,
      "spread=false",
      // Vivliostyle runs the scripts it finds in a publication, and its
      // default is to allow them. A book has no use for that: the documents
      // served here are typeset from the vault, and `hast/sanitize.ts`
      // already takes the executable parts out of them. This is the second
      // lock on the same door, on the side the viewer answers to, and it
      // covers the export webview as well as the preview.
      "allowScripts=false",
    ];
    // The viewer drops a `page` of its own from the fragment, so the page to
    // return to travels under a name of ours and is applied by the script in
    // keepPage.ts.
    //
    // Rounded, not truncated. While the preview composes only as far as it
    // has been asked to, the viewer reports the page as a fraction - 6.91 for
    // the page it was told to call 7 - and taking the floor of that put the
    // reader back one page short of where they were.
    if (options.epage) params.push(`${EPAGE_PARAM}=${Math.round(options.epage)}`);
    if (options.cacheBust) params.push(`t=${Date.now()}`);
    return `${this.viewerUrl()}#${params.join("&")}`;
  }

  themeUrl(path: string): string {
    return `${this.base}/themes/${path}`;
  }

  vaultUrl(vaultPath: string): string {
    return `${this.base}/vault/${vaultPath.split("/").map(encodeURIComponent).join("/")}`;
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { Allow: "GET, HEAD" });
      res.end();
      return;
    }

    // Defence 3: DNS rebinding. Only the loopback literal is accepted.
    const host = req.headers.host ?? "";
    if (host !== `${HOST}:${this.port}` && host !== `[::1]:${this.port}`) {
      notFound(res);
      return;
    }

    const url = new URL(req.url ?? "/", this.origin);
    const segments = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);

    // Defence 2: /s/<token>/... , wrong token is indistinguishable from a typo.
    if (segments.length < 2 || segments[0] !== "s" || segments[1] !== this.token) {
      notFound(res);
      return;
    }
    const rest = segments.slice(2);
    if (rest.length === 0) {
      notFound(res);
      return;
    }

    switch (rest[0]) {
      case "viewer":
        this.serveEmbedded(res, req, viewerAssets, rest.slice(1).join("/"));
        return;
      case "themes":
        this.serveEmbedded(res, req, themeAssets, rest.slice(1).join("/"));
        return;
      case "vault":
        await this.serveVault(res, req, rest.slice(1).join("/"));
        return;
      case "w":
        await this.serveWorkspace(res, req, rest[1], rest.slice(2).join("/"));
        return;
      default:
        notFound(res);
    }
  }

  private serveEmbedded(
    res: http.ServerResponse,
    req: http.IncomingMessage,
    table: Record<string, { text?: string; base64?: string }>,
    path: string,
  ): void {
    const key = joinPosix(path);
    const entry = table[key];
    if (!entry) {
      notFound(res);
      return;
    }
    const text =
      entry.text !== undefined && table === viewerAssets && key === "index.html"
        ? withKeepPageScript(entry.text)
        : entry.text;
    const body =
      text !== undefined
        ? Buffer.from(text, "utf8")
        : Buffer.from(entry.base64 ?? "", "base64");
    send(res, req, body, mimeType(key));
  }

  private async serveWorkspace(
    res: http.ServerResponse,
    req: http.IncomingMessage,
    id: string,
    path: string,
  ): Promise<void> {
    const workspace = this.workspaces.get(id);
    if (!workspace) {
      notFound(res);
      return;
    }
    const key = joinPosix(path) || "index.html";

    const file = workspace.getFile(key);
    if (file) {
      const body =
        file.bytes !== undefined
          ? Buffer.from(file.bytes)
          : Buffer.from(file.text ?? "", "utf8");
      send(res, req, body, file.mime);
      return;
    }

    if (key.startsWith("assets/")) {
      const asset = workspace.getAsset(key);
      if (!asset) {
        notFound(res);
        return;
      }
      if (asset.bytes) {
        send(res, req, Buffer.from(asset.bytes), asset.mime);
        return;
      }
      const absolute =
        asset.kind === "vault"
          ? `${this.vaultRootRaw()}/${asset.vaultPath}`
          : (asset.absolutePath ?? "");
      await this.streamFile(res, req, absolute, asset.mime, workspace);
      return;
    }

    notFound(res);
  }

  private async serveVault(
    res: http.ServerResponse,
    req: http.IncomingMessage,
    path: string,
  ): Promise<void> {
    const relative = joinPosix(path);
    if (!relative) {
      notFound(res);
      return;
    }
    await this.streamFile(res, req, `${this.vaultRootRaw()}/${relative}`, mimeType(relative));
  }

  private vaultRootRaw(): string {
    return this.options?.vaultRoot ?? "";
  }

  /** Defence 5: the resolved path must sit under an allowed root. */
  private async streamFile(
    res: http.ServerResponse,
    req: http.IncomingMessage,
    absolute: string,
    mime: string,
    workspace?: Workspace,
  ): Promise<void> {
    if (!absolute) {
      notFound(res);
      return;
    }
    let real: string;
    try {
      real = await fs.promises.realpath(absolute);
    } catch {
      notFound(res);
      return;
    }

    const roots = [this.vaultRoot, ...(workspace?.extraRoots ?? [])];
    if (!roots.some((root) => isInside(root, real))) {
      notFound(res);
      return;
    }

    let stat: fs.Stats;
    try {
      stat = await fs.promises.stat(real);
    } catch {
      notFound(res);
      return;
    }
    if (!stat.isFile()) {
      notFound(res);
      return;
    }

    res.writeHead(200, {
      "Content-Type": mime,
      "Content-Length": String(stat.size),
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const stream = fs.createReadStream(real);
      stream.on("error", reject);
      stream.on("end", resolve);
      stream.pipe(res);
    }).catch((error) => {
      log.error("stream failed", error);
      res.end();
    });
  }
}

function send(
  res: http.ServerResponse,
  req: http.IncomingMessage,
  body: Buffer,
  mime: string,
): void {
  // Defence 4: no Access-Control-Allow-Origin, ever.
  res.writeHead(200, {
    "Content-Type": mime,
    "Content-Length": String(body.length),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(req.method === "HEAD" ? undefined : body);
}

function notFound(res: http.ServerResponse): void {
  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("not found");
}

function listen(server: http.Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      const address = server.address();
      resolve(typeof address === "object" && address ? address.port : port);
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, HOST);
  });
}
