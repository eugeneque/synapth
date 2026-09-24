import type { Metadata } from "next";
import { UserPlus, Users } from "lucide-react";
import { auth } from "@/cortex/auth";
import { getI18n } from "@/cortex/locale";
import { listRequests, searchPeople } from "@/cortex/friends";
import { PeopleSearch } from "@/components/people-search";
import { FriendTile, PersonCard } from "@/components/person-card";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("people.meta"), description: t("people.lead") };
}
export const dynamic = "force-dynamic";

type Search = Record<string, string | string[] | undefined>;
const pick = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** People search + the viewer's unanswered friend requests on top. */
export default async function PeoplePage({ searchParams }: { searchParams: Promise<Search> }) {
  const q = (pick((await searchParams).q) ?? "").slice(0, 80);
  const [session, { t, n }] = await Promise.all([auth(), getI18n()]);
  const viewerId = session?.user?.id ?? null;
  const [people, requests] = await Promise.all([searchPeople(q, viewerId, 60), viewerId && !q ? listRequests(viewerId) : Promise.resolve(null)]);

  return (
    <div className="container max-w-5xl space-y-10 py-12 md:py-16">
      <header className="space-y-5">
        <div className="space-y-2">
          <h1 className="font-display text-4xl font-medium tracking-tight sm:text-5xl">{t("people.title")}</h1>
          <p className="max-w-xl text-base text-muted-foreground">{t("people.lead")}</p>
        </div>
        <PeopleSearch initial={q} />
      </header>

      {requests && requests.incoming.length > 0 && (
        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <UserPlus className="h-4 w-4 text-synapse" /> {t("people.requests")}
            <span className="rounded-full bg-synapse/15 px-2 py-px text-xs tabular-nums text-synapse">{requests.incoming.length}</span>
          </h2>
          <div className="stagger grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {requests.incoming.map((p) => (
              <FriendTile key={p.id} person={p} state="incoming" />
            ))}
          </div>
        </section>
      )}

      <section className="space-y-4">
        <p className="text-sm text-muted-foreground">{q ? n("people.found", people.length, { q }) : t("people.newest")}</p>
        {people.length ? (
          <div className="stagger grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {people.map((p) => (
              <PersonCard key={p.id} person={p} />
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border px-6 py-16 text-center">
            <Users className="h-6 w-6 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">{t("people.none")}</p>
          </div>
        )}
      </section>
    </div>
  );
}
