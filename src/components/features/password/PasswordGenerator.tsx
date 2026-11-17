"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy, Dices } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const MIN_LENGTH = 4;
const MAX_LENGTH = 64;
const DEFAULT_LENGTH = 16;

const CHARSETS = [
  { id: "upper", label: "Uppercase letters", hint: "A-Z", chars: "ABCDEFGHIJKLMNOPQRSTUVWXYZ" },
  { id: "lower", label: "Lowercase letters", hint: "a-z", chars: "abcdefghijklmnopqrstuvwxyz" },
  { id: "numbers", label: "Numbers", hint: "0-9", chars: "0123456789" },
  { id: "symbols", label: "Symbols", hint: "!@#$%", chars: "!@#$%^&*()-_=+[]{};:,.?/~" },
] as const;

type CharsetId = (typeof CHARSETS)[number]["id"];

// Uniform random integer in [0, max) from the browser's crypto source.
// Values that would skew the spread are thrown away and drawn again.
function randomInt(max: number): number {
  const limit = Math.floor(0x1_0000_0000 / max) * max;
  const buf = new Uint32Array(1);
  do {
    crypto.getRandomValues(buf);
  } while (buf[0] >= limit);
  return buf[0] % max;
}

function generatePassword(length: number, sets: string[]): string {
  const all = sets.join("");
  // One character from every ticked type, so each is always present.
  const out = sets.map((set) => set[randomInt(set.length)]);
  while (out.length < length) out.push(all[randomInt(all.length)]);
  // Shuffle so the guaranteed ones don't always sit at the front.
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out.join("");
}

function clampLength(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_LENGTH;
  return Math.min(MAX_LENGTH, Math.max(MIN_LENGTH, Math.round(n)));
}

// Nothing here is saved anywhere: the password lives only in this
// component's memory and is gone on reload or when leaving the page.
export function PasswordGenerator() {
  const [length, setLength] = useState(DEFAULT_LENGTH);
  // What's typed in the number box; only clamped once they leave it.
  const [lengthText, setLengthText] = useState(String(DEFAULT_LENGTH));
  const [picked, setPicked] = useState<Record<CharsetId, boolean>>({
    upper: true,
    lower: true,
    numbers: true,
    symbols: true,
  });
  const [password, setPassword] = useState("");
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
  }, []);

  const sets = CHARSETS.filter((c) => picked[c.id]).map((c) => c.chars);
  const nothingPicked = sets.length === 0;

  const changeLength = (n: number) => {
    const next = clampLength(n);
    setLength(next);
    setLengthText(String(next));
  };

  const generate = () => {
    if (nothingPicked) return;
    setPassword(generatePassword(length, sets));
    setCopied(false);
  };

  const copy = async () => {
    if (!password) return;
    try {
      await navigator.clipboard.writeText(password);
    } catch {
      return;
    }
    setCopied(true);
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Card>
      <CardContent className="space-y-6">
        <div className="flex items-stretch gap-2">
          <div
            aria-live="polite"
            className={cn(
              "flex min-h-14 flex-1 items-center rounded-md border bg-muted/40 px-4 py-3 font-mono text-lg break-all select-all",
              !password && "text-muted-foreground select-none",
            )}
          >
            {password || "Click Generate"}
          </div>
          <Button
            type="button"
            variant="outline"
            className="h-auto min-w-24"
            onClick={copy}
            disabled={!password}
          >
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>

        <div className="space-y-2">
          <label htmlFor="pw-length" className="text-sm font-medium">
            Length
          </label>
          <div className="flex items-center gap-4">
            <input
              type="range"
              aria-label="Length"
              min={MIN_LENGTH}
              max={MAX_LENGTH}
              value={length}
              onChange={(e) => changeLength(Number(e.target.value))}
              className="flex-1 accent-primary"
            />
            <Input
              id="pw-length"
              type="number"
              inputMode="numeric"
              min={MIN_LENGTH}
              max={MAX_LENGTH}
              value={lengthText}
              onChange={(e) => {
                setLengthText(e.target.value);
                const n = Number(e.target.value);
                if (e.target.value !== "" && n >= MIN_LENGTH && n <= MAX_LENGTH) {
                  setLength(Math.round(n));
                }
              }}
              onBlur={() => changeLength(lengthText === "" ? length : Number(lengthText))}
              className="w-20 text-center tabular-nums"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            {MIN_LENGTH} to {MAX_LENGTH} characters
          </p>
        </div>

        <fieldset className="space-y-2">
          <legend className="mb-2 text-sm font-medium">Include</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {CHARSETS.map((c) => (
              <label
                key={c.id}
                className="flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2.5 text-sm transition-colors hover:bg-accent"
              >
                <input
                  type="checkbox"
                  checked={picked[c.id]}
                  onChange={(e) => setPicked((p) => ({ ...p, [c.id]: e.target.checked }))}
                  className="h-4 w-4 accent-primary"
                />
                <span className="flex-1">{c.label}</span>
                <span className="font-mono text-xs text-muted-foreground">{c.hint}</span>
              </label>
            ))}
          </div>
          {nothingPicked && (
            <p className="text-sm text-destructive">Tick at least one box.</p>
          )}
        </fieldset>

        <Button type="button" size="lg" className="w-full" onClick={generate} disabled={nothingPicked}>
          <Dices className="h-4 w-4" />
          Generate
        </Button>

        <p className="text-center text-xs text-muted-foreground">
          Made on your computer and never saved. Copy it before you leave this page.
        </p>
      </CardContent>
    </Card>
  );
}
