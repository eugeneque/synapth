# Synapth — дизайн-система «Signal»

Единый визуальный язык платформы. Всё, что видит пользователь, собирается из токенов и примитивов, описанных здесь. Если компонент не укладывается в правила ниже — сначала меняем правила, потом компонент.

## 1. Концепция

**Тёмная лаборатория + один сигнал.** Синапс — это вспышка между двумя нейронами; интерфейс — почти чёрное поле, на котором единственный цвет (кислотно-зелёный `synapse`) обозначает *сигнал*: действие, активное состояние, проверенный навык, живые данные. Всё остальное — оттенки графита.

Три опоры:

1. **Terminal, not dashboard.** Моноширинные uppercase-лейблы, `/`-префиксы, мигающий курсор `_`, `curl` вместо маркетинговых иллюстраций. Платформа сделана для агентов и людей, которые их пишут.
2. **Pixel / dot-matrix.** Единственный вид декора — точечная матрица и ASCII. Никаких градиентных блобов, стеклянных карточек и 3D. Всё, что «живёт», живёт на пиксельной сетке и реагирует на курсор.
3. **Чертёж.** Тонкие линии `border`, крестики-прицелы на углах (`Corners`), штриховка (`hatch`) как фон второстепенных зон. Радиусы почти нулевые — 2 px.

## 2. Цвет

Токены — HSL-триплеты в `app/globals.css`, используются как `hsl(var(--x) / alpha)` через Tailwind (`bg-background`, `text-synapse/60` …).

| Токен | Значение | Роль |
|---|---|---|
| `--background` | `90 8% 4%` (#0a0b09) | Фон страницы. Слегка зелёный графит, не чистый чёрный. |
| `--card` | `90 7% 6%` | Поверхность карточек и панелей. |
| `--muted` | `90 6% 9%` | Вторичные поверхности: `<pre>`, сегмент-контролы, инпуты. |
| `--accent` | `90 6% 12%` | Hover-состояния ghost/outline. |
| `--border` | `90 6% 14%` | Все разделители и рамки. Один цвет — везде. |
| `--foreground` | `80 10% 92%` | Основной текст. |
| `--muted-foreground` | `85 5% 56%` | Вторичный текст, лейблы. |
| `--synapse` | `76 100% 60%` (#c6ff33) | **Единственный акцент.** Primary-кнопки, активные состояния, Verified, фокус, живой пиксель. |
| `--synapse-foreground` | `85 40% 6%` | Текст поверх акцента. |
| `--warn` | `40 90% 58%` | Sandbox / medium-high findings. |
| `--danger` | `2 78% 58%` | Critical, ошибки, дебет. |
| `--info` | `85 5% 70%` | Community — нейтральный, *не* синий: второй хроматический цвет размывает сигнал. |
| `--surface-lowest … --surface-highest` | `#0d0e0c` → `#343532` | Тональная лестница (Stitch `surface-container-*`): заголовочные полосы панелей (`lowest`), «колодцы» кода (`.well`), плитки и hover (`surface`, `high`), активный сегмент (`high`). Tailwind: `bg-surface-lowest`, `bg-surface-low`, `bg-surface`, `bg-surface-high`, `bg-surface-highest`. |
| `--secondary-tone` (`moss`) | `#bcccaa` | Тихий мох для второстепенных значений (версии, ключи JSON). |

Правила:

- Акцент занимает ≤ 5 % площади экрана. Если зелёного стало много — что-то не так.
- Полупрозрачные заливки акцента: `synapse/10` фон, `synapse/30` рамка, `synapse` текст — стандартная «подсвеченная» тройка (`Badge variant="synapse"`).
- Свечение только у primary-кнопки и у пикселей. Карточки не светятся; на hover у них появляется рамка `border-foreground/25` и крестики на углах.
- Светлая тема не поддерживается. `color-scheme: dark` зафиксирован.

## 3. Типографика

| Роль | Шрифт | Класс |
|---|---|---|
| Display (h1 hero, крупные цифры) | Space Grotesk 500, tracking −0.03em | `font-display` |
| Заголовки h1–h3 в интерфейсе | Inter 600, tracking −0.02em | `font-sans font-semibold tracking-tight` |
| Текст | Inter 400, 14–16 px, `leading-relaxed` | `font-sans` |
| Лейблы, навигация, метаданные, код | JetBrains Mono, 11 px, uppercase, tracking 0.14em | `label-mono` |
| Код, сниппеты, числа в таблицах | JetBrains Mono 12–13 px | `font-mono` |

Шкала: `text-xs` 12 / `sm` 14 / `base` 16 / `lg` 18 / `2xl` 24 / `4xl` 36 / `6xl` 60 / `7xl` 72. Hero: `text-5xl … text-7xl`.

Лейбл `label-mono` — главный ритмический элемент интерфейса. Каждая секция начинается с него: `/ CATALOGUE`, `SANDBOX SCAN`, `INSTALLS`. Числа-показатели заканчиваются подчёркиванием-курсором `<span class="cursor">`.

## 4. Сетка, отступы, форма

- Контейнер `container`: центр, `max-w 1280`, padding 24 px.
- Вертикальный ритм секций: 64–96 px (`py-16 / py-24`). Внутри карточек — 16–20 px.
- Радиус: `--radius: 2px`. `rounded-md` = 2 px, `rounded-sm` = 0. Кнопки, инпуты, карточки — `rounded-md`. Круглыми остаются только пиксели/точки и аватары.
- Рамки: 1 px `border-border`. Двойных рамок и теней нет.
- Крестики на углах (`<Corners />`) — маркер «интерактивной панели»: hero, карточки навыков на hover, панели установки, статистика.
- Штриховка `hatch` — фон для «пустых»/технических зон: пустое состояние, задник hero-панели, фон `<pre>` в тёмных панелях не используется.

## 5. Движение

- Переходы: 150 ms `ease-out` для цвета/рамки; 200 ms для аккордеона. Никаких bounce/spring.
- Пиксельный фон (`PixelField`) — единственный постоянный анимационный слой: точки на сетке 14 px, вокруг курсора загораются `synapse` с затухающим следом.
- Hero (`AsciiHands`) — руки из «Сотворения Адама» (`public/hero-hands.png`: фрагмент фрески с Wikimedia Commons, public domain, кожа вырезана и затенена на чёрном) халфтонятся в точечную сетку 10 px: яркость → радиус точки. В радиусе курсора точки превращаются в ASCII-символы (`.:-=+*#%@`) и светлеют, руки чуть дрейфуют за курсором, вокруг силуэта — дизеринговая «пыль», между кончиками пальцев вспыхивает «синапс», когда курсор рядом с центром. Цвет: мох `#5c6a4e` → бледно-зелёный → `synapse` только на пике. Без файла рисуется векторный fallback.
- `prefers-reduced-motion: reduce` → канвасы рисуют один статичный кадр, курсор `_` не мигает.

## 6. Компоненты

### Кнопки (`components/ui/button.tsx`)
- `default` — заливка `synapse`, текст `synapse-foreground`, свечение `0 0 16px synapse/35`. Одна на экран/панель.
- `outline` — рамка `border`, на hover `border-foreground/40`. Второе действие.
- `mono` — утопленная mono-кнопка `[RUN CRAWL]`, `[COPY]`: `bg-muted`, рамка, uppercase 11 px.
- `ghost` — без рамки, для навигации и иконок.
- `destructive` — рамка `danger/30`, текст `danger`, без заливки.
- Размеры: `sm` 32 px, `default` 36 px, `lg` 44 px (uppercase mono), `hero` 48 px (Inter 600 16 px — CTA в hero и CTA-панели).

### Бейджи (`components/ui/badge.tsx`)
Прямоугольные, mono 10–11 px uppercase, tracking 0.08em. Варианты: `default` (графит), `outline`, `chip` (нейтральная плашка на `surface`: `TARGET: …`, теги), `synapse`, `solid` (сплошная заливка акцентом — одна на экран, например Verified в hero карточки навыка), `verified` (= synapse), `community` (нейтральный), `sandbox` (`warn`), `danger`.

### Карточки (`components/ui/card.tsx`)
`bg-card border-border rounded-md`. Заголовочная полоса — `.panel-head`: точка-статус + `label-mono` на `surface-lowest`, `border-b`. `SkillCard`: иконка категории в квадрате 40 px, имя + бейдж безопасности в одной строке, mono-мета (`by author • v1.2.0`), справа цена (`Free` зелёным / `$x/call`) и подпись (`open source` / `microescrow`), описание в две строки, теги-`chip`, футер на `surface-low/40` с метриками и кнопками (иконка терминала → страница, `INSTALL` primary). `layout="list"` — компактная строка для списочного вида.

### Инпуты
`bg-muted border-border h-9`, фокус — рамка `synapse/60`, кольцо `synapse/30`. Поиск — «терминальная строка» (`SearchBar`): `>` слева, подсказка `press / to focus` справа, высота 48 px, на фокусе `surface-high`. Под строкой — чипы операторов (`+ category:MCP`, `+ is:verified` …), клик дописывает оператор в запрос. Auth-поля — `/ LABEL` mono над полем, `>` внутри.

### Сегмент-контролы (категории, сортировка, табы)
Навигация и табы (`.tab-line`, `Tabs`): ряд mono-лейблов с нижней линией 2 px `synapse` у активного. Категории (`CategoryPills`): mono-сегменты, активный — на `surface-high` с счётчиком зелёным. Сортировка (`SortControl`): нативный `<select>` в mono. Без «таблеток».

### Панели с крестиками
`<Panel title meta icon actions footer>` — рамка, `.panel-head`, опциональный утопленный футер (`surface-low/60`), `Corners` на hover. Используется для скана, установки, визуализатора, леджера, ключей. `Brackets` — сплошные L-скобки акцентом по углам (auth-gate, 404).

### Статистика (`StatTile`)
Лейбл `label-mono` сверху (справа — опциональный `tag`-бейдж), значение `.stat-value` (Space Grotesk 32/36) с курсором `_` и `unit` зелёным mono рядом, подпись `label-mono-sm` снизу. Плитки разделены `divide-x`, на hover `accent/40`.

### Терминальные блоки
`TerminalCard` — окно с «светофором», mono-строками (`comment` / `command` / `accent` / `output`) и полосой копирования. `CommandChip` — однострочный `$ command` с копированием (hero). `.well` — утопленный код-колодец внутри панели. Крауер-лог в консоли — `cortex-stream.stdout` с нумерацией строк.

## 6a. Карта экранов (по макетам Stitch «Signal»)

| Маршрут | Экран | Состав |
|---|---|---|
| `/` | Overview | hero поверх `AsciiHands` (статус-пилюля, заголовок, CTA `hero` + `CommandChip`), полоса `StatTile`, «Microsecond spark» (3 шага пайплайна), Trending (6 карточек), три «пилара», CTA-панель на `dot-matrix` с `TerminalCard`. |
| `/explore` | Explore registry | шапка с чипом `REGISTRY NODE`, `SearchBar` + операторы, ряд категорий/сортировка/вид, сайдбар фасетов (`FacetGroup`: security grade, язык, паблишер, теги, клиенты, телеметрия), сетка 2 колонки, футер «Showing 1–N», CTA «Building a skill?». |
| `/skills/[slug]` | Skill detail | хлебные крошки + чипы контекста, hero-карточка (solid Verified, версия, лицензия, GitHub, H1 с пульсом, `INSTALL TO AGENT`, `GATEWAY EXEC`), 4 метрики, слева `PromptVisualizer` (pipeline / diff с номерами строк), `ToolSpec`, README; справа `ScanReportView` ([PASS]/[FAIL]), Pay-per-task telemetry, `InstallPanel`, Entry point, `RepoCard`. |
| `/dashboard` | Developer console | заголовок `/ CONSOLE / AGENT RUNTIME & BILLING`, 4 плитки (wallet µUSD, keys, crawler, earnings), Publish from GitHub, GitHub catalogue crawler (stdout), Auth & keys, таблица леджера, статус-полоса. |
| `/signin`, `/signup` | Auth gate | карточка с `Brackets`, `SYNAPTH // CORTEX CORE`, табы Developer login / GitHub identity, `>`-поля, `[USE DEMO CREDENTIALS]`, provision-блок с curl. |
| `/authors/[owner]` | Publisher profile | cover-canvas (`dot-matrix`), аватар с пульсом, имя + `@handle` + Verified creator, чипы категорий/языков, 4 плитки, табы, сетка карточек. |
| `/faq` | Docs | полоса `DOCS ENGINE`, три колонки: нумерованная навигация, контент (чипы, H1, секции с `.panel-head`), «On this page» + действия. |

Шапка: логотип, пилюля `All systems operational` (xl+), mono-навигация с активной линией (`NavLinks`), `SearchTrigger` (⌘K), баланс кошелька (xl+), `Publish`, аватар; ниже lg — `MobileNav`. Футер — одна строка: версия протокола, Cortex API, Scanner, ссылки, ©.

## 7. Голос

Английский интерфейс, короткий, технический. Заголовки — предложения без точки на конце, кроме hero. Лейблы — uppercase mono. Вспомогательный текст — `muted-foreground`, одна строка. Числа — `formatCompact`, деньги — `formatUsd`.

## 8. Чек-лист для нового экрана

1. Есть ли `label-mono` над каждой секцией?
2. Один зелёный primary-элемент в зоне видимости?
3. Все поверхности — `card`/`muted`, все рамки — `border`, радиус 2 px?
4. Пиксельный фон виден (страница не перекрывает его сплошным фоном)?
5. Пустое состояние — `hatch` + mono-подпись?
6. Работает без мыши/с reduced-motion?
