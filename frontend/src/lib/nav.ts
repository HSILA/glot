/**
 * Shared helper used by the sidebar and bottom nav to decide whether a
 * given nav entry is the active one for the current pathname.
 *
 * Rule:
 *   - The root "/" link is active only on an exact match. Otherwise every
 *     route under the dashboard would highlight it.
 *   - Every other link is active on exact match OR if the current pathname
 *     is nested under it, e.g. `/decks/42` should still mark `/decks` as
 *     active. The boundary check ensures `/decks` does not match
 *     `/decks-archive`.
 */
export function isActiveNavLink(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  if (pathname === href) return true;
  return pathname.startsWith(`${href}/`);
}
