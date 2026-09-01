/**
 * HTTP header names are case-insensitive; RawObservations.responseHeaders is
 * a plain object that may preserve whatever casing the server sent.
 */
export function getHeader(
  headers: Record<string, string>,
  name: string,
): string | null {
  const lower = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === lower) {
      return headers[key];
    }
  }
  return null;
}
