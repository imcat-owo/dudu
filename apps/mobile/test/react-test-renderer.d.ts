/**
 * Ambient types for the theme-ui test's react-test-renderer usage.
 * The package is NOT a repo dependency — the theme harness maps it at runtime
 * (/tmp/rtr). This declaration keeps `tsc --noEmit` happy without installing it.
 */
declare module "react-test-renderer" {
  export function create(element: unknown): { unmount(): void };
  export function act<T>(fn: () => T | Promise<T>): Promise<T>;
}
