# Synapth — заметки для агента

- Отвечать по-русски; код и комментарии в коде — по-английски.
- Серверные модули только в `cortex/`, клиентские — в `axon/`; `lib/` — изоморфные утилиты. Route handlers в `app/api` не содержат бизнес-логики.
- Деньги — целые микродоллары (`types/economy.ts`), никакого float в леджере.
- `Verified` никогда не присваивается сканером — только через `reviewed: true`.
- Без `DATABASE_URL` всё работает на in-memory сторе (`cortex/repository.ts`, `cortex/billing.ts`); тесты (`npm test`) рассчитаны на этот режим.
- Проверка: `npm run typecheck && npm test && npm run build`.
- Каталог живёт в `data/catalog.json` (gitignored), обход — `npm run crawl`, бейджи — `npm run rescan`. Тесты пишут в `.test-catalog.json`, реальный каталог не трогают.
- Синглтоны в `globalThis` версионируются ключом (`__synapthRepo_v2`): при смене интерфейса репозитория поднимай версию, иначе HMR оставит старый экземпляр.
- Токен GitHub для краулера/импорта: `GITHUB_TOKEN` или `gh auth token` (`cortex/github-token.ts`); в `.env` его не записывать.
