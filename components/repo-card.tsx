import Link from "next/link";
import { GitFork, CircleDot, Scale, Code2, Clock, FileCode2, ExternalLink, Github } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Panel } from "@/components/panel";
import { getI18n } from "@/cortex/locale";
import { formatCompact, timeAgo } from "@/lib/utils";
import type { GithubSource } from "@/types/skill";

/** Repository snapshot for skills imported from GitHub. */
export async function RepoCard({ source }: { source: GithubSource }) {
  const i18n = await getI18n();
  const { t } = i18n;
  const manifestUrl = `https://github.com/${source.fullName}/blob/${source.defaultBranch}/${source.manifestPath}`;
  return (
    <Panel title={t("repo.title")} icon={<Github className="h-4 w-4 shrink-0 text-muted-foreground" />} corners footer={<span>{t("repo.crawled", { ago: timeAgo(source.crawledAt, i18n) })}</span>}>
      <div className="p-4 text-sm">
        <div className="mb-3 flex items-center gap-2">
          {source.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={source.avatarUrl} alt="" className="h-6 w-6 rounded-md" />
          ) : (
            <Github className="h-5 w-5" />
          )}
          <a href={`https://github.com/${source.fullName}`} target="_blank" rel="noreferrer" className="truncate font-mono text-xs hover:text-synapse">
            {source.fullName}
          </a>
        </div>
        <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
          <dt className="inline-flex items-center gap-1 text-muted-foreground"><Code2 className="h-3.5 w-3.5" /> {t("repo.language")}</dt>
          <dd>{source.language ?? "—"}</dd>
          <dt className="inline-flex items-center gap-1 text-muted-foreground"><Scale className="h-3.5 w-3.5" /> {t("repo.license")}</dt>
          <dd>{source.license ?? "—"}</dd>
          <dt className="inline-flex items-center gap-1 text-muted-foreground"><GitFork className="h-3.5 w-3.5" /> {t("repo.forks")}</dt>
          <dd>{formatCompact(source.forks)}</dd>
          <dt className="inline-flex items-center gap-1 text-muted-foreground"><CircleDot className="h-3.5 w-3.5" /> {t("repo.issues")}</dt>
          <dd>{formatCompact(source.openIssues)}</dd>
          <dt className="inline-flex items-center gap-1 text-muted-foreground"><Clock className="h-3.5 w-3.5" /> {t("repo.lastPush")}</dt>
          <dd title={source.pushedAt}>{timeAgo(source.pushedAt, i18n)}</dd>
          <dt className="inline-flex items-center gap-1 text-muted-foreground"><FileCode2 className="h-3.5 w-3.5" /> {t("repo.manifest")}</dt>
          <dd>
            <a href={manifestUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono hover:text-synapse">
              {source.manifestFile} <ExternalLink className="h-3 w-3" />
            </a>
          </dd>
        </dl>
        {source.topics.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1">
            {source.topics.slice(0, 8).map((t) => (
              <Link key={t} href={`/explore?q=${encodeURIComponent(`tag:${t}`)}`}>
                <Badge variant="chip">{t}</Badge>
              </Link>
            ))}
          </div>
        )}
      </div>
    </Panel>
  );
}
