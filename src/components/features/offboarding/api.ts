// JSON request helper for the offboarding screens: null on success, else
// the server's error message.
export async function send(url: string, method: string, body?: unknown): Promise<string | null> {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.ok) return null;
  const b = await res.json().catch(() => ({}));
  return typeof b.error === "string" ? b.error : "Something went wrong";
}
