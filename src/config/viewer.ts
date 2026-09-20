/** Display preferences only; these never participate in book/PDF configuration. */
export interface ViewerPreferences {
  viewerSpread: "false" | "true" | "auto";
  viewerZoom: number;
  viewerFitToScreen: boolean;
}

export function validViewerZoom(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0.1 && value <= 10;
}

export function normalizeViewerPreferences(value: Partial<ViewerPreferences>): ViewerPreferences {
  return {
    viewerSpread: value.viewerSpread === "true" || value.viewerSpread === "auto" ? value.viewerSpread : "false",
    viewerZoom: validViewerZoom(value.viewerZoom) ? value.viewerZoom : 1,
    viewerFitToScreen: typeof value.viewerFitToScreen === "boolean" ? value.viewerFitToScreen : true,
  };
}

export function isViewerPreferences(value: unknown): value is ViewerPreferences {
  if (!value || typeof value !== "object") return false;
  const prefs = value as Partial<ViewerPreferences>;
  return ["false", "true", "auto"].includes(prefs.viewerSpread ?? "") &&
    validViewerZoom(prefs.viewerZoom) && typeof prefs.viewerFitToScreen === "boolean";
}

/** Called only after the iframe source and origin have been checked. */
export function rememberViewerPreferences(
  settings: ViewerPreferences & { rememberViewerSettings: boolean },
  preferences: unknown,
): boolean {
  if (!settings.rememberViewerSettings || !isViewerPreferences(preferences)) return false;
  const zoom = preferences.viewerFitToScreen ? settings.viewerZoom : preferences.viewerZoom;
  if (settings.viewerSpread === preferences.viewerSpread &&
    settings.viewerFitToScreen === preferences.viewerFitToScreen && settings.viewerZoom === zoom) return false;
  // Copy only the supported display fields from the untrusted message.
  settings.viewerSpread = preferences.viewerSpread;
  settings.viewerFitToScreen = preferences.viewerFitToScreen;
  settings.viewerZoom = zoom;
  return true;
}
