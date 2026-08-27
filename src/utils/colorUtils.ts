export const darken = (hex: string, amount: number): string => {
  const clean = hex.replace("#", "");
  const number = Number.parseInt(clean.length === 3 ? clean.split("").map((v) => v + v).join("") : clean, 16);
  const channel = (shift: number) => Math.max(0, Math.min(255, ((number >> shift) & 255) * (1 - amount)));
  return `rgb(${channel(16)}, ${channel(8)}, ${channel(0)})`;
};
