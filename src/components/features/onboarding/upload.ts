// Uploads files to a request one at a time. Returns a readable line per
// file that failed (empty when all went through).
export async function uploadDocuments(requestId: string, files: File[]): Promise<string[]> {
  const failed: string[] = [];
  for (const file of files) {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(`/api/onboarding/${requestId}/documents`, { method: "POST", body: form });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      failed.push(`${file.name}: ${typeof body.error === "string" ? body.error : "upload failed"}`);
    }
  }
  return failed;
}

export const ACCEPT_DOCS = "image/*,application/pdf,.doc,.docx,.heic";
