export async function api<T = Record<string, unknown>>(url: string, method = "GET", body?: unknown): Promise<T> {
  const isForm = typeof FormData !== "undefined" && body instanceof FormData;
  const response = await fetch(url, { method, credentials: "same-origin", cache: "no-store", headers: isForm ? undefined : { "Content-Type": "application/json" }, body: body === undefined ? undefined : isForm ? body : JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "Something went wrong. Please try again.");
  return result as T;
}
export const money = (cents: number, decimals = 0) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(cents / 100);
export const compactMoney = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 }).format(cents / 100);
export const initials = (name: string) => name.split(/[\s&]+/).filter(Boolean).slice(0, 2).map(v => v[0]).join("").toUpperCase();
export function relativeTime(date: string) { const minutes = Math.max(1, Math.floor((Date.now() - new Date(date).getTime()) / 60000)); if (minutes < 60) return `${minutes} min ago`; const hours = Math.floor(minutes / 60); return hours < 24 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`; }
export const shortDate = (date: string) => new Date(date.length === 10 ? `${date}T12:00:00` : date).toLocaleDateString("en-US", { month: "short", day: "numeric" });
