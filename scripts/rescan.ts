/**
 * Re-run the sandbox scanner over the whole catalogue (after a rules update)
 * and rewrite security levels. Reviewed levels (Verified, Gov) stay while the
 * scan still allows them; a new finding drops them to what the scanner says.
 *
 *   npm run rescan
 */
import { skillRepository } from "@/cortex/repository";
import { scanSkill } from "@/lib/sandbox-scanner";
import { parseFrontmatter } from "@/lib/frontmatter";

async function main() {
  const skills = await skillRepository.all();
  const changed: Record<string, number> = {};
  const batch: Parameters<typeof skillRepository.upsertMany>[0] = [];
  for (const s of skills) {
    const scan = scanSkill(s);
    const reviewed = s.securityLevel === "Verified" || s.securityLevel === "Gov";
    // Rejected is an intake outcome; an entry that is already published keeps its place in Sandbox.
    // A stricter score threshold alone does not revoke a past review; new high/critical findings do.
    const level = reviewed && scan.outcome === "Community" ? s.securityLevel : scan.level;
    if (level !== s.securityLevel) changed[`to${level}`] = (changed[`to${level}`] ?? 0) + 1;
    // SKILL.md pages store the body only; older crawls kept the frontmatter — normalise (idempotent).
    const full = (await skillRepository.readme(s.id)) ?? s.readme;
    const readme = full && s.source?.manifestFile === "SKILL.md" ? parseFrontmatter(full).body : full;
    batch.push({
      input: { name: s.name, slug: s.slug, description: s.description, version: s.version, category: s.category, pricePerCall: s.pricePerCall, manifest: s.manifest.systemPromptTruncated && readme ? { ...s.manifest, systemPrompt: readme, systemPromptTruncated: false } : s.manifest, repoUrl: s.repoUrl, tags: s.tags, githubStars: s.githubStars, origin: s.origin, source: s.source, readme },
      authorId: s.authorId,
      authorName: s.authorName,
      securityLevel: level,
    });
  }
  const counts = await skillRepository.upsertMany(batch);
  console.log(JSON.stringify({ scanned: skills.length, ...changed, ...counts }));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
