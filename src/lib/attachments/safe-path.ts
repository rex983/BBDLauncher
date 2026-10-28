// Storage object paths reach us as URL segments (download routes) or as
// client JSON (POST bodies). Checking only the first segment isn't enough:
// `owner/../other/file` passes a prefix check but walks out of the owner's
// folder. Reject any segment that is empty, `.`, `..`, or carries a path
// separator once decoded. Upload names are sanitized to [A-Za-z0-9._-], so
// real paths never trip this.
export function isSafePathSegments(segments: string[]): boolean {
  if (segments.length === 0) return false;
  return segments.every((raw) => {
    let seg: string;
    try {
      seg = decodeURIComponent(raw);
    } catch {
      return false;
    }
    return seg !== "" && seg !== "." && seg !== ".." && !/[\\/]/.test(seg);
  });
}

// `{ownerId}/...` with at least one safe segment after the owner folder.
export function isOwnedObjectPath(path: string, ownerId: string): boolean {
  const segments = path.split("/");
  return segments.length >= 2 && segments[0] === ownerId && isSafePathSegments(segments);
}
