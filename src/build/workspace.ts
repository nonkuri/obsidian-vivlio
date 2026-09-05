import { randomBytes } from "crypto";
import { mimeType } from "../util/paths";

/** A generated file living only in memory and served over the local server. */
export interface WorkspaceFile {
  text?: string;
  bytes?: Uint8Array;
  mime: string;
}

export type AssetKind = "vault" | "absolute" | "external";

/**
 * A binary the book refers to. Generated documents point at
 * `assets/<sha1-8>-<basename>`, which the server maps back to the real file
 * (SPEC 5.8(2)); nothing is copied for the preview, and EPUB reads the bytes
 * only while packing.
 */
export interface AssetRef {
  /** Workspace-relative path used in the HTML, e.g. `assets/3f2a91c4-fig.png`. */
  publicPath: string;
  kind: AssetKind;
  /** Vault-relative path when `kind === "vault"`. */
  vaultPath?: string;
  /** Absolute filesystem path when `kind === "absolute"`. */
  absolutePath?: string;
  /** Source URL when `kind === "external"`. */
  url?: string;
  /** Downloaded or converted bytes; set for external assets after fetching. */
  bytes?: Uint8Array;
  mime: string;
  /**
   * Path inside the EPUB, when the file had to be re-encoded to reach a core
   * media type (SPEC 5.8(7)). The documents still refer to `publicPath`, so
   * the packer rewrites the references as it serializes.
   */
  epubPath?: string;
  /** Intrinsic pixel size, when it could be read. */
  width?: number;
  height?: number;
  /** Widest on-paper placement requested for this asset, in px (dpi check). */
  displayWidthPx?: number;
  /** At least one placement runs from one bleed edge to the other. */
  fullBleed?: boolean;
  /** Human-readable origin, used in warnings. */
  label: string;
}

/**
 * One book's build output. The workspace is in memory: generated documents are
 * small, and binaries are streamed from their real location, which keeps
 * rebuilds cheap and leaves nothing behind on disk to clean up.
 */
export class Workspace {
  readonly id: string;
  readonly files = new Map<string, WorkspaceFile>();
  readonly assets = new Map<string, AssetRef>();
  /** Extra filesystem roots the server may serve (fonts outside the vault). */
  readonly extraRoots = new Set<string>();

  constructor(id?: string) {
    this.id = id ?? randomBytes(8).toString("hex");
  }

  putText(path: string, text: string, mime = mimeType(path)): void {
    this.files.set(path, { text, mime });
  }

  putBytes(path: string, bytes: Uint8Array, mime = mimeType(path)): void {
    this.files.set(path, { bytes, mime });
  }

  getFile(path: string): WorkspaceFile | undefined {
    return this.files.get(path);
  }

  addAsset(asset: AssetRef): AssetRef {
    const existing = this.assets.get(asset.publicPath);
    if (existing) return existing;
    this.assets.set(asset.publicPath, asset);
    return asset;
  }

  getAsset(publicPath: string): AssetRef | undefined {
    return this.assets.get(publicPath);
  }

  clear(): void {
    this.files.clear();
    this.assets.clear();
    this.extraRoots.clear();
  }
}
