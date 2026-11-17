import type { Metadata } from "next";
import { PasswordGenerator } from "@/components/features/password/PasswordGenerator";

export const metadata: Metadata = { title: "Password Generator" };

// Open to every signed-in employee, "apps only" roles included (the
// dashboard layout already requires a session). The password is made in
// the browser: nothing is sent to the server, stored or logged.
export default function PasswordGeneratorPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Password Generator</h1>
        <p className="mt-1 text-muted-foreground">
          Pick a length, tick what it should include, and click Generate.
        </p>
      </div>
      <PasswordGenerator />
    </div>
  );
}
