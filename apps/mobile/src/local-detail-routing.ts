import type { Detail } from "./workspace";

/**
 * Which detail sheets the local app shell can actually open.
 *
 * Today only the cross-dialog trace is wired (P1-2: the promised audit log
 * must be openable in the mode she uses). Other detail types are silently
 * ignored rather than pretending to open — no dead buttons.
 */
export function canOpenDetail(detail: Detail): boolean {
  return detail.type === "crossDialogTrace";
}
