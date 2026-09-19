# Cortex

Серверное ядро Synapth — «кора». Всё, что исполняется только на сервере:
идентификация, каталог, ранжирование, сканер и pay-per-task биллинг.
Route handlers в `app/api/**` — тонкие обёртки над модулями отсюда.

| Модуль | Роль |
|---|---|
| `auth.ts` | Auth.js v5: Credentials + GitHub, JWT-сессии, роль в токене |
| `db.ts` | Prisma singleton |
| `repository.ts` | `SkillRepository` — Prisma или in-memory seed (без `DATABASE_URL`) |
| `ranking.ts` | Trending / Hidden Gems / Recent |
| `billing.ts` | кошельки, списание за вызов, доля автора |
| `agent-context.ts` | сборка минифицированного payload для `X-Agent-Request` |
| `seed.ts` | демонстрационный каталог |
