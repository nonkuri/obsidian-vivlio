import type { TFile } from "obsidian";
import { warn, type BuildContext } from "../context";
import { visit, type UNode } from "../../util/tree";

const MAX_DEPTH = 3;

/** `![[Note]]`, `![[Note#Heading]]`, `![[Note^block-id]]`, `![[Note|alias]]` */
const EMBED = /!\[\[([^\]|#^]+)(?:#\^?([^\]|]+))?(?:\|([^\]]*))?\]\]/;

interface EmbedTarget {
  raw: string;
  linkpath: string;
  section: string | null;
}

function parseEmbed(match: RegExpMatchArray): EmbedTarget {
  return {
    raw: match[0],
    linkpath: match[1].trim(),
    section: match[2]?.trim() ?? null,
  };
}

/**
 * Expand `![[Note]]` embeds (SPEC 5.3 #1).
 *
 * This is the one preprocessing stage that cannot be a replace rule: it has to
 * read another file and splice its mdast in, so it runs as an async remark
 * transformer at the head of the mdast plugin list.
 */
export function embedPlugin(context: BuildContext, sourcePath: string) {
  // `this` is the unified processor, so embedded notes get parsed by exactly
  // the parser VFM configured.
  return function attach(this: { parse(value: string): UNode }) {
    const parse = (value: string) => this.parse(value);
    return async (tree: UNode): Promise<void> => {
      await expand(context, tree, sourcePath, parse, new Set([sourcePath]), 0);
    };
  };
}

async function expand(
  context: BuildContext,
  tree: UNode,
  sourcePath: string,
  parse: (value: string) => UNode,
  chain: Set<string>,
  depth: number,
): Promise<void> {
  if (depth >= MAX_DEPTH) return;

  // Collect first, rewrite afterwards: resolving an embed is async, and the
  // tree must not move while the walker is on it.
  const blocks: { parent: UNode; index: number; target: EmbedTarget }[] = [];
  const inlines: { node: UNode; target: EmbedTarget }[] = [];

  visit(tree, (node, index, parent) => {
    if (node.type === "paragraph" && parent && Array.isArray(parent.children)) {
      const only = onlyEmbed(node);
      if (only) {
        blocks.push({ parent, index, target: only });
        return;
      }
    }
    if (node.type === "text") {
      const match = String((node as { value?: unknown }).value ?? "").match(EMBED);
      if (match) inlines.push({ node, target: parseEmbed(match) });
    }
  });

  for (const job of blocks.slice().reverse()) {
    const nodes = await resolve(context, sourcePath, job.target, parse, chain, depth);
    if (!nodes) continue;
    const children = job.parent.children;
    if (Array.isArray(children)) children.splice(job.index, 1, ...nodes);
  }

  for (const job of inlines) {
    const nodes = await resolve(context, sourcePath, job.target, parse, chain, depth);
    if (!nodes) continue;
    // Blocks cannot sit inside a paragraph, so an inline embed contributes its
    // text only; a note embedded on its own line keeps full structure above.
    const value = String((job.node as { value?: unknown }).value ?? "");
    (job.node as unknown as { value: string }).value = value.replace(
      job.target.raw,
      plainText(nodes),
    );
  }
}

/** The embed target when a paragraph holds nothing but one embed. */
function onlyEmbed(paragraph: UNode): EmbedTarget | null {
  const children = paragraph.children ?? [];
  if (children.length !== 1 || children[0].type !== "text") return null;
  const value = String((children[0] as { value?: unknown }).value ?? "").trim();
  const match = value.match(EMBED);
  if (!match || match[0] !== value) return null;
  return parseEmbed(match);
}

async function resolve(
  context: BuildContext,
  sourcePath: string,
  target: EmbedTarget,
  parse: (value: string) => UNode,
  chain: Set<string>,
  depth: number,
): Promise<UNode[] | null> {
  const file = context.app.metadataCache.getFirstLinkpathDest(target.linkpath, sourcePath);
  if (!file) {
    warn(context, {
      kind: "broken-link",
      message: `![[${target.linkpath}]]`,
      source: sourcePath,
    });
    return null;
  }
  // Images, PDFs and canvases are resolved later, on the hast side.
  if (file.extension !== "md") return null;

  if (chain.has(file.path)) {
    warn(context, {
      kind: "unsupported",
      message: `circular embed: ${file.path}`,
      source: sourcePath,
    });
    return null;
  }

  return loadEmbed(context, file, target, parse, chain, depth);
}

async function loadEmbed(
  context: BuildContext,
  file: TFile,
  target: EmbedTarget,
  parse: (value: string) => UNode,
  chain: Set<string>,
  depth: number,
): Promise<UNode[] | null> {
  let source: string;
  try {
    source = await context.app.vault.cachedRead(file);
  } catch {
    warn(context, { kind: "missing-asset", message: file.path });
    return null;
  }

  const root = parse(stripFrontmatter(source));
  let children = (root.children ?? []).filter(
    (node) => node.type !== "yaml" && node.type !== "toml",
  );
  if (target.section) children = sliceSection(children, target.section);

  const nested: UNode = { type: "root", children };
  chain.add(file.path);
  await expand(context, nested, file.path, parse, chain, depth + 1);
  chain.delete(file.path);

  return nested.children ?? [];
}

/**
 * `![[Note#Heading]]` takes the heading and everything under it, up to the
 * next heading of the same or higher level.
 */
function sliceSection(children: UNode[], section: string): UNode[] {
  const wanted = section.toLowerCase();
  const start = children.findIndex(
    (node) => node.type === "heading" && plainText([node]).toLowerCase() === wanted,
  );
  if (start === -1) return [];
  const level = Number((children[start] as { depth?: number }).depth ?? 1);
  const out: UNode[] = [children[start]];
  for (let i = start + 1; i < children.length; i++) {
    const node = children[i];
    if (node.type === "heading" && Number((node as { depth?: number }).depth ?? 1) <= level) {
      break;
    }
    out.push(node);
  }
  return out;
}

function plainText(nodes: UNode[]): string {
  const parts: string[] = [];
  for (const node of nodes) {
    visit(node, (child) => {
      const value = (child as { value?: unknown }).value;
      if (typeof value === "string" && child.type === "text") parts.push(value);
    });
  }
  return parts.join("").trim();
}

function stripFrontmatter(source: string): string {
  if (!source.startsWith("---")) return source;
  const end = source.indexOf("\n---", 3);
  if (end === -1) return source;
  const lineEnd = source.indexOf("\n", end + 1);
  return lineEnd === -1 ? "" : source.slice(lineEnd + 1);
}
