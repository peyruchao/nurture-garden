export class SeededRandom {
  private value: number;

  constructor(seed: number) {
    this.value = seed >>> 0 || 1;
  }

  next(): number {
    this.value |= 0;
    this.value = (this.value + 0x6d2b79f5) | 0;
    let result = Math.imul(this.value ^ (this.value >>> 15), 1 | this.value);
    result = (result + Math.imul(result ^ (result >>> 7), 61 | result)) ^ result;
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  }

  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)] as T;
  }
}

export const hashString = (value: string): number => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};
