import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { parseHttpUrl } from "@/lib/url-safety";

interface Props {
  source: string;
  /** Base URL used to resolve relative links/images (the repo's blob URL). */
  baseUrl?: string | null;
  className?: string;
}

/**
 * READMEs come from arbitrary repositories, so a link target is only emitted
 * when it is an in-document anchor, a mailto:, or a real http(s) URL — a
 * `javascript:` href in a crawled README would otherwise execute on click.
 */
function resolve(href: string | undefined, base: string | null | undefined, raw = false): string | undefined {
  if (!href) return undefined;
  if (/^(#|mailto:[^\s]+$)/i.test(href)) return href;
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return parseHttpUrl(href)?.toString();
  if (!base) return undefined; // relative path with nothing to resolve against
  const root = base.replace(/\/$/, "");
  const target = raw ? root.replace("github.com", "raw.githubusercontent.com").replace("/blob/", "/") : root;
  return parseHttpUrl(`${target}/${href.replace(/^\.?\//, "")}`)?.toString();
}

/** README / SKILL.md renderer. Raw HTML is dropped by react-markdown and link targets go through `resolve()`. */
export function Markdown({ source, baseUrl, className }: Props) {
  return (
    <div className={className}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a href={resolve(href, baseUrl)} target="_blank" rel="noreferrer nofollow" className="text-synapse underline-offset-2 hover:underline">
              {children}
            </a>
          ),
          // eslint-disable-next-line @next/next/no-img-element
          img: ({ src, alt }) => <img src={resolve(typeof src === "string" ? src : undefined, baseUrl, true)} alt={alt ?? ""} loading="lazy" className="my-3 max-h-80 border border-border" />,
          h1: ({ children }) => <h1 className="mb-3 mt-6 text-xl font-semibold first:mt-0">{children}</h1>,
          h2: ({ children }) => <h2 className="mb-2 mt-6 border-b border-border pb-1 text-lg font-semibold">{children}</h2>,
          h3: ({ children }) => <h3 className="mb-2 mt-4 text-base font-semibold">{children}</h3>,
          h4: ({ children }) => <h4 className="mb-1 mt-3 text-sm font-semibold">{children}</h4>,
          p: ({ children }) => <p className="my-2 leading-relaxed">{children}</p>,
          ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5">{children}</ul>,
          ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5">{children}</ol>,
          blockquote: ({ children }) => <blockquote className="my-3 border-l-2 border-synapse/40 pl-3 text-muted-foreground">{children}</blockquote>,
          code: ({ className: lang, children }) =>
            lang ? (
              <code className="font-mono text-xs">{children}</code>
            ) : (
              <code className="bg-muted px-1 py-0.5 font-mono text-[0.85em]">{children}</code>
            ),
          pre: ({ children }) => <pre className="my-3 overflow-auto border border-border bg-background p-3 text-xs leading-relaxed">{children}</pre>,
          table: ({ children }) => (
            <div className="my-3 overflow-auto">
              <table className="w-full border-collapse text-xs">{children}</table>
            </div>
          ),
          th: ({ children }) => <th className="border border-border bg-muted px-2 py-1 text-left font-medium">{children}</th>,
          td: ({ children }) => <td className="border border-border px-2 py-1 align-top">{children}</td>,
          hr: () => <hr className="my-4 border-border" />,
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}
