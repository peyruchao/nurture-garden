export function createId(prefix: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(9));
  const token = Array.from(bytes, (value) => value.toString(36).padStart(2, "0")).join("");
  return `${prefix}_${token}`;
}

export function createToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(14));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}
