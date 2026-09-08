/**
 * Postgres's jsonb type rejects two things outright at write time: U+0000
 * (NUL) and unpaired UTF-16 surrogates - both raise "unsupported Unicode
 * escape sequence" (code 22P05). Neither is rare in real-world scraped
 * content: a page can embed a literal NUL byte, and truncated/mis-decoded
 * multi-byte text (e.g. a lightweight fetch's 5MB body cap landing mid
 * character, or a site serving mojibake) produces lone surrogates. Nothing
 * upstream (fetch, Cheerio, JSON.stringify) validates for this, so anything
 * derived from fetched HTML/text must be sanitized before it crosses into a
 * Prisma `Json` column - observed failing live on `crawlObservation.create()`
 * for a real site (x.com).
 */
export function sanitizeForJsonb<T>(value: T): T {
  if (typeof value === 'string') {
    return sanitizeString(value) as unknown as T;
  }
  if (Array.isArray(value)) {
    return (value as unknown[]).map((item) =>
      sanitizeForJsonb(item),
    ) as unknown as T;
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(
      value as Record<string, unknown>,
    )) {
      out[key] = sanitizeForJsonb(item);
    }
    return out as T;
  }
  return value;
}

function sanitizeString(input: string): string {
  let out = '';
  let changed = false;
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);

    if (code === 0) {
      changed = true;
      continue; // strip NUL
    }

    if (code >= 0xd800 && code <= 0xdbff) {
      // High surrogate - valid only when immediately followed by a low one.
      const next = input.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        out += input[i] + input[i + 1];
        i++;
        continue;
      }
      out += '�';
      changed = true;
      continue;
    }

    if (code >= 0xdc00 && code <= 0xdfff) {
      // Lone low surrogate (no preceding high surrogate consumed it above).
      out += '�';
      changed = true;
      continue;
    }

    out += input[i];
  }
  return changed ? out : input;
}
