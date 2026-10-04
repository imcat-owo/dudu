import type { Section } from "../../../packages/domain/src";

/**
 * Whether the current app shell can navigate to `section`.
 *
 * Local mode only hosts chat/space/connections/appearance — offering a
 * button that navigates to "goals" there would be a dead button (P1-1).
 * `undefined` means the shell supports every section (cloud mode).
 */
export function supportsSection(
  supportedSections: Section[] | undefined,
  section: Section,
): boolean {
  return !supportedSections || supportedSections.includes(section);
}
