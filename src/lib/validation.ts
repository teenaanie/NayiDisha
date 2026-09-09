export function text(value: unknown, label: string, max = 500): string {
 if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`${label} is required (maximum ${max} characters).`);
 return value.trim();
}
export function integer(value: unknown, label: string, min=0, max=1_000_000): number {
 if (typeof value !== 'number' || !Number.isSafeInteger(value) || value<min || value>max) throw new Error(`${label} must be an integer between ${min} and ${max}.`);
 return value;
}
export function choice<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
 if (!allowed.includes(value as T)) throw new Error(`Invalid ${label}.`); return value as T;
}
export function money(value: unknown, label: string): number {
 if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>10_000_000) throw new Error(`Invalid ${label}.`);
 return Math.round(value*100);
}
