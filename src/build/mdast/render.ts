import { MarkdownRenderer } from "obsidian";
import { warn, type BuildContext } from "../context";
import { visit, type UNode } from "../../util/tree";
import { waitForDomIdle } from "../../util/async";

/** Fenced languages that only exist once another plugin has drawn them. */
const DYNAMIC_LANGUAGES = new Set([
  "dataview",
  "dataviewjs",
  "mermaid",
  "tasks",
  "chart",
  "templater",
]);

/** Languages that execute arbitrary code from the note (SPEC 5.8(8)). */
const SCRIPTED_LANGUAGES = new Set(["dataviewjs", "templater"]);

/**
 * Draw dataview / mermaid blocks with Obsidian's own renderer and embed the
 * result as raw HTML (SPEC 5.3 #2).
 *
 * `MarkdownRenderer.render()` resolves before those plugins finish drawing, so
 * every block additionally waits for its container to stop mutating.
 */
export function dynamicRenderPlugin(context: BuildContext, sourcePath: string) {
  return function attach() {
    return async (tree: UNode): Promise<void> => {
      const jobs: { node: UNode; parent: UNode; index: number }[] = [];
      visit(tree, (node, index, parent) => {
        if (node.type !== "code" || !parent) return;
        const lang = String((node as { lang?: unknown }).lang ?? "").toLowerCase();
        if (!DYNAMIC_LANGUAGES.has(lang)) return;
        jobs.push({ node, parent, index });
      });
      if (jobs.length === 0) return;

      for (const job of jobs) {
        const lang = String((job.node as { lang?: unknown }).lang ?? "").toLowerCase();
        const value = String((job.node as { value?: unknown }).value ?? "");

        if (SCRIPTED_LANGUAGES.has(lang) && !context.settings.allowDynamicScripts) {
          warn(context, {
            kind: "unsupported",
            message: `${lang} block skipped (running scripts is turned off)`,
            source: sourcePath,
          });
          continue;
        }

        const html = await renderBlock(context, sourcePath, lang, value);
        if (!html) {
          warn(context, {
            kind: "unsupported",
            message: `${lang} block produced nothing; the source is kept as a code block`,
            source: sourcePath,
          });
          continue;
        }
        // `html` nodes reach rehype-raw, which VFM already runs first.
        job.parent.children![job.index] = {
          type: "html",
          value: `<figure class="vivlio-rendered vivlio-${lang}">${html}</figure>`,
        } as UNode;
      }
    };
  };
}

async function renderBlock(
  context: BuildContext,
  sourcePath: string,
  lang: string,
  source: string,
): Promise<string | null> {
  const host = document.createElement("div");
  host.addClass("vivlio-offscreen");
  document.body.appendChild(host);
  try {
    await MarkdownRenderer.render(
      context.app,
      "```" + lang + "\n" + source + "\n```",
      host,
      sourcePath,
      context.component,
    );
    await waitForDomIdle(host, { timeoutMs: 5000, quietMs: 250 });

    // Mermaid draws an <svg>; taking it alone keeps Obsidian's wrapper markup
    // (and its theme classes) out of the book.
    const svg = host.querySelector("svg");
    if (lang === "mermaid" && svg) return svg.outerHTML;

    const html = host.innerHTML.trim();
    if (!html || host.textContent?.trim() === "") return null;
    return html;
  } catch (error) {
    warn(context, {
      kind: "unsupported",
      message: `${lang} block failed: ${String(error)}`,
      source: sourcePath,
    });
    return null;
  } finally {
    host.remove();
  }
}
