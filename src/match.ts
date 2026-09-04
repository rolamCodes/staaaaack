export function matchCodeFromLocation(): string | null {
  const params = new URLSearchParams(window.location.search);
  const query = params.get("m");
  if (query && /^[a-zA-Z0-9]+$/.test(query)) {
    return query.toLowerCase();
  }
  const path = window.location.pathname.replace(/\/+$/, "");
  const found = path.match(/^\/m\/([a-zA-Z0-9]+)$/);
  return found?.[1] ? found[1].toLowerCase() : null;
}

export function matchShareUrl(code: string): string {
  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  return `${window.location.origin}${path === "/" ? "" : path}/?m=${encodeURIComponent(code)}`;
}

export function formatDayId(dayId: string): string {
  const parts = dayId.split("-");
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  const d = Number(parts[2]);
  if (!y || !m || !d) return dayId;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function setMatchQuery(code: string): void {
  const url = new URL(window.location.href);
  url.searchParams.set("m", code);
  window.history.replaceState({}, "", url);
}
