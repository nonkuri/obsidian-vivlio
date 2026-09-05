import type { BuildContext, Chapter } from "./context";

/**
 * Web Publication manifest (`publication.json`).
 *
 * Vivliostyle loads a whole book from one of these, which is what lets the
 * viewer page across chapter boundaries and keep a single page counter, so it
 * is generated even for a single note.
 */
export function publicationManifest(context: BuildContext, chapters: Chapter[]): string {
  const { config } = context;

  const manifest: Record<string, unknown> = {
    "@context": ["https://schema.org", "https://www.w3.org/ns/pub-context"],
    type: "Book",
    conformsTo: "https://github.com/vivliostyle/vivliostyle-cli",
    name: config.title || "Untitled",
    inLanguage: config.lang || "ja",
    readingOrder: chapters.map((chapter, index) => ({
      url: chapter.docName,
      name: chapter.title,
      ...(chapter.role === "doc-cover" ? { rel: "cover" } : {}),
      ...(index > 0 && chapters[index - 1].role === "doc-cover"
        ? { vivlioAfterCover: true }
        : {}),
      ...(context.config.pageNumbering === "continuous" && chapter.startPage !== undefined
        ? { startPage: chapter.startPage }
        : {}),
    })),
  };

  if (config.author) manifest.author = config.author;
  if (config.publisher) manifest.publisher = config.publisher;
  if (config.date) manifest.datePublished = config.date;
  if (config.subtitle) manifest.alternateName = config.subtitle;

  const resources = [...context.workspace.assets.values()].map((asset) => ({
    url: asset.publicPath,
    encodingFormat: asset.mime,
  }));
  if (resources.length > 0) manifest.resources = resources;

  return JSON.stringify(manifest, null, 2);
}
