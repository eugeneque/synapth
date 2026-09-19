# Synapth

**Synapse + labyrinth.** Маркетплейс навыков, инструментов и MCP-серверов для ИИ-агентов — «Modrinth для ИИ». Индексирует, проверяет и раздаёт когнитивные модификации; агент может найти и установить их сам, без браузера.

```
Cortex  — серверное ядро (auth, каталог, ранжирование, сканер, биллинг)     → cortex/
Axon    — клиентский слой (typed API-клиент, установка, React-хуки)          → axon/
```

## Стек

Next.js 15 (App Router, Route Handlers) · TypeScript · Tailwind CSS · shadcn-style UI · Lucide · Auth.js v5 · Prisma / PostgreSQL · Zod.

## Быстрый старт

```bash
npm install
cp .env.example .env      # без DATABASE_URL всё работает на in-memory каталоге
npm run dev               # http://localhost:3000
```

Демо-вход: `demo@synapth.dev` / `synapth-demo`. Демо-ключ агента (только in-memory): `syn_demo_0000000000000000`.

С PostgreSQL:

```bash
npm run db:push && npm run db:seed
```

Тесты (node:test через tsx): `npm test`.

## Каталог из GitHub

```bash
npm run crawl -- --max 300 --min-stars 3      # discovery + импорт, пишет data/catalog.json
npm run crawl -- --repo anthropics/skills     # конкретные репозитории
npm run crawl -- --query "topic:mcp-server"   # свой запрос к Search API
npm run rescan                                # пересчитать бейджи после смены правил сканера
```

Токен берётся из `GITHUB_TOKEN`, а если пусто — из `gh auth token`. Без токена лимиты GitHub делают обход бессмысленным (10 поисков/мин, 60 вызовов/ч).

Discovery: поиск репозиториев по темам и словам (`topic:claude-skills`, `topic:mcp-server`, …) плюс code search `filename:SKILL.md`. Внутри репозитория парсер находит `synapth.json`, `mcp-server.json`, `server.json` (формат MCP registry), `.mcp.json`, `tool.json`, все `SKILL.md` (коллекции: `skills/*/`, `.claude/skills/*/`) и, если ничего нет, README с явными признаками навыка. Состояние обхода — `data/crawl-state.json`; повторный запуск трогает только новые репозитории (`--refresh` — все).

Тот же обход запускается из дашборда (`/dashboard#crawl`) или через `POST /api/v1/crawl`.

## Структура

```
app/
  (auth)/signin, signup        страницы входа/регистрации
  api/auth/[...nextauth]       Auth.js
  api/auth/register            регистрация (bcrypt)
  api/v1/skills                GET каталог (+ X-Agent-Request), POST публикация
  api/v1/skills/[id]           карточка / ?format=prompt / install
  api/v1/skills/[id]/execute   pay-per-task шлюз
  api/v1/import/github         импорт репозитория
  api/v1/account/wallet        кошелёк и леджер
  page.tsx                     витрина (поиск, категории, сортировка)
  skills/[slug]                карточка навыка + визуализатор + скан
  dashboard                    кошелёк, публикация
  faq                          база знаний
components/                    skill-card, sort-control, prompt-visualizer, …
cortex/                        auth, db, repository, ranking, billing, agent-context, api-keys, seed
axon/                          client, install, hooks
lib/                           sandbox-scanner, github-parser, diff, utils, api
types/                         skill, economy, agent, auth
prisma/                        schema.prisma, seed.ts
tests/                         сканер, парсер, ранжирование, биллинг, diff
```

## Ключевые механики

**Agent-first API.** `GET /api/v1/skills` с заголовком `X-Agent-Request: true` возвращает минифицированный payload: объединённый системный промпт, tool-схемы в формате function calling и подсказку установки на каждый навык.

```bash
curl -s -H 'X-Agent-Request: true' 'http://localhost:3000/api/v1/skills?q=postgres&limit=2'
```

**Sandbox Scanner** (`lib/sandbox-scanner.ts`). Статический анализ манифеста: prompt-injection, опасные shell-команды, утечки ключей, эксфильтрация, избыточные разрешения. Итог — бейдж `Sandbox` / `Community`; `Verified` выдаётся только после ручной проверки.

**Prompt & Logic Visualizer** (`components/prompt-visualizer.tsx`). Граф потока исполнения (trigger → tools → decision → output) с раскладкой по слоям и построчный diff системного промпта «до/после установки».

**Pay-per-task** (`cortex/billing.ts`). Кошельки в микродолларах, три записи леджера на исполнение, автоматический возврат при сбое. `POST /api/v1/skills/:id/execute` с `X-Synapth-Key`.

**GitHub-агрегатор** (`lib/github-parser.ts`). `synapth.json` / `mcp-server.json` / `tool.json` / `SKILL.md` → внутренний формат. Сетевой слой инжектируется; без БД используется mock-репозитории.

**Поиск** (`cortex/search.ts`). Собственный движок без внешних сервисов: BM25F по полям с весами (название ≫ теги ≫ описание ≫ инструменты ≫ README), консервативный стеммер, префиксное дополнение последнего слова, исправление опечаток (Damerau-Levenshtein с триграммным префильтром), фасеты по категории/уровню/языку/тегам/автору, подсветка совпадений, подсказки. Синтаксис: `category:MCP is:verified lang:python author:anthropics tag:pdf stars:>100 price:free "точная фраза" -исключить`. API: `GET /api/v1/search?q=…` и `?suggest=1`.

**Сортировка** (`cortex/ranking.ts`). Trending — log-скорость установок × звёзды × удержание; Hidden Gems — Verified, удержание ≥ 60 %, ≤ 5k установок; Recent — хронология.
