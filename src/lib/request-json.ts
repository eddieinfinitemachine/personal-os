// Guarded `request.json()` for write routes. Malformed JSON, an empty body or
// a body that isn't an object (an array, a string, null) all come back as
// null, so the route answers 400 "invalid json" instead of throwing a 500.
export async function readJsonObject<T extends object>(request: Request): Promise<T | null> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return null;
  }
  return body && typeof body === "object" && !Array.isArray(body) ? (body as T) : null;
}
