export function makeIO(callback, options) {
  if (!("IntersectionObserver" in window)) return null;
  return new IntersectionObserver(callback, options);
}
