/** Resolve `href` against `base`; returns null when it is not an http(s) URL. */
export function resolveUrl(href: string, base: string): string | null {
  try {
    const u = new URL(href.trim(), base);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    u.hash = "";
    return u.href;
  } catch {
    return null;
  }
}

/** Normalized form used for comparing two URLs (no fragment, lower case host, default port dropped). */
export function normUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    return u.href;
  } catch {
    return url;
  }
}

export function sameUrl(a: string, b: string): boolean {
  return normUrl(a) === normUrl(b);
}

export function originOf(url: string): string {
  return new URL(url).origin;
}

export function isAbsoluteHttp(href: string): boolean {
  return /^https?:\/\//i.test(href.trim());
}
