// Image types accepted for app icons (uploaded or fetched as a favicon),
// mapped to the extension the stored file gets.
const EXT_FROM_TYPE: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "image/x-icon": "ico",
  "image/vnd.microsoft.icon": "ico",
  "image/gif": "gif",
};

// Stored extension for an allowed icon type; null when the type isn't allowed.
export function iconExtension(type: string): string | null {
  return Object.hasOwn(EXT_FROM_TYPE, type) ? EXT_FROM_TYPE[type] : null;
}
