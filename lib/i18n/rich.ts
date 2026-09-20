import { createElement, type ReactNode } from "react";

/**
 * Renders the inline markup used in dictionaries:
 *   **strong**   → <strong>
 *   *em*         → <em>
 *   `code`       → <code className={codeClassName}>
 * No nesting; the dictionaries are written to that rule. Uses `createElement`
 * (not JSX) so the module also runs under the plain `tsx` test runner.
 */
export function rich(text: string, { codeClassName = "font-mono text-foreground" }: { codeClassName?: string } = {}): ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|`[^`]+`)/g).filter(Boolean);
  if (parts.length === 1 && !/^(\*\*|\*|`)/.test(parts[0])) return text;
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) return createElement("strong", { key: i }, part.slice(2, -2));
    if (part.startsWith("`") && part.endsWith("`")) return createElement("code", { key: i, className: codeClassName }, part.slice(1, -1));
    if (part.startsWith("*") && part.endsWith("*") && part.length > 2) return createElement("em", { key: i }, part.slice(1, -1));
    return part;
  });
}
