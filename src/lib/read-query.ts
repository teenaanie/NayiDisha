/** Bound UI reads, including time spent waiting for a pooled connection. Never use for writes. */
export function readQuery<T>(query: PromiseLike<T> & {cancel(): void}, timeoutMs = 12000): Promise<T> {
 return new Promise<T>((resolve, reject) => {
  const timer = setTimeout(() => {
   reject(new Error('Data is taking too long to load. Please try again.'));
   try { query.cancel(); } catch { /* The timeout is already reported. */ }
  }, timeoutMs);
  Promise.resolve(query).then(value => {clearTimeout(timer); resolve(value);}, error => {clearTimeout(timer); reject(error);});
 });
}
