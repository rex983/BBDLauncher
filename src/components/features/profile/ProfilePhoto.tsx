"use client";

import { useRef, useState } from "react";
import { Camera, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AVATAR_CHANGED_EVENT, LauncherAvatar } from "../../../../kit/launcher-kit/launcher-avatar";

const SIZE = 256;

// Center-crops to a square and scales to 256px, so every app gets a small,
// even photo whatever was picked (phone photos are often 5+ MB).
async function toSquare(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, SIZE, SIZE);
  bitmap.close();
  // Browsers without WebP encoding hand back PNG, which the server also takes.
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/webp", 0.88));
  if (!blob) throw new Error("Couldn't read that image");
  return blob;
}

export function ProfilePhoto({
  profileId,
  name,
  hasPhoto,
  fallbackSrc,
  readOnly,
}: {
  profileId: string;
  name: string;
  hasPhoto: boolean;
  fallbackSrc?: string | null;
  readOnly: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [has, setHas] = useState(hasPhoto);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const changed = () => window.dispatchEvent(new CustomEvent(AVATAR_CHANGED_EVENT, { detail: { profileId } }));

  const upload = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const blob = await toSquare(file);
      const form = new FormData();
      form.append("file", new File([blob], `avatar.${blob.type === "image/webp" ? "webp" : "png"}`, { type: blob.type }));
      const res = await fetch("/api/profile/avatar", { method: "POST", body: form });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(typeof body.error === "string" ? body.error : "Upload failed");
      }
      setHas(true);
      changed();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/profile/avatar", { method: "DELETE" });
    setBusy(false);
    if (!res.ok) return setError("Couldn't remove it");
    setHas(false);
    changed();
  };

  return (
    <div className="flex items-center gap-4">
      <button
        type="button"
        className="group relative rounded-full disabled:cursor-default"
        onClick={() => input.current?.click()}
        disabled={readOnly || busy}
        aria-label="Change profile photo"
      >
        <LauncherAvatar profileId={profileId} name={name} fallbackSrc={fallbackSrc} size={72} />
        {!readOnly && (
          <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40 text-white opacity-0 transition group-hover:opacity-100">
            <Camera className="h-5 w-5" />
          </span>
        )}
      </button>
      {!readOnly && (
        <div className="space-y-1">
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => input.current?.click()} disabled={busy}>
              <Camera className="mr-2 h-4 w-4" />
              {busy ? "Saving…" : has ? "Change photo" : "Add photo"}
            </Button>
            {has && (
              <Button size="sm" variant="ghost" onClick={remove} disabled={busy} aria-label="Remove photo">
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">Shows next to your name in every BBD app.</p>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
      )}
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        className="sr-only"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) upload(f);
        }}
      />
    </div>
  );
}
