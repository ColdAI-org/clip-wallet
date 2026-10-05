# Background text i18n (r1/bg-i18n)

Approval titles, line labels, warnings, ClipError messages, activity titles, staking/swap step titles and
notification bodies used to be English strings made in the background. They still are (every existing
consumer keeps working), and now a structured `Msg` travels alongside so the UI can show them in the
person's language.

## Contract (packages/core/src/messages)

```ts
interface Msg { id: string; values?: Record<string, string | number | Msg>; fallback: string; approx?: true }
```

- `id` is a `"bg.*"` key of `BG_MESSAGES` (English, `en/*.ts`); translations are `locales/<code>.ts`, loaded
  lazily with `loadBgMessages(locale)`.
- `fallback` is the module's exact English. English always renders `fallback`; other languages render the
  translation of `id` with `values`, else `fallback`. Values are data (amounts with their symbol, symbols,
  addresses, names) and are never translated; a value may be a nested Msg ("Schedule: {inner}").
- Additive fields: `DecodedRequest.titleMsg`, `lines[].labelMsg/valueMsg`, `Warning.msg`, `ClipError.msg`
  (`new ClipError(msgOrString, code)`), `ActivityEntry.titleMsg`, `ActivityLeg.titleMsg`, `PlanStep.titleMsg`,
  features `Step.titleMsg`, `QueuedApprovals.stepMsgs`, `SwapQuoteView.stepMsgs`, `TradeReviewView.titleMsg/stepMsgs`,
  `StakeOptionView.titleMsg/detailMsg`; notification snapshots carry `titleMsg`.
- A Msg is used only while `msg.fallback` equals the string it sits next to (`current()`), so code that
  rewrites a title and forgets the Msg can never get the old meaning translated.

How modules attach a Msg:

| Way | When |
| --- | --- |
| `titled(msg(id, values))`, `warning(level, code, msg(...))`, `new ClipError(msg(...), code)` | Explicit, at the site. |
| `say(id, values)` → English string, remembered | Titles built as strings through helpers (NEAR action lists, `out(title, …)`, ternaries). `attachMsgs()` in the background (right after `decode` and after the refine passes) attaches the Msg by that exact text. Only text the wallet's modules said; a dapp's message/data/memo lines are never matched. |
| Exact text (`knownMsg`) | Fixed sentences and labels that are in the catalog verbatim ("To", "Network fee", "That's your own address."). |
| General message (`approx`) | Every Warning code (`WARNING_DEFAULT_IDS`) and common error kinds by code suffix (`ERROR_CATEGORIES`): shown when the module's specific sentence has no translation. Warnings also show the module's English underneath (`lang="en"`). |

## Shared files touched (already applied, all small and additive)

- `packages/engine/src/engine.ts`, `apps/extension/src/background/service.ts`: `attachMsgs(...)` after decode
  and after refine; `titleMsg` on activity entries/legs (`activityTitleMsg`, `connectedMsg`) and on
  `socialApprovals()`.
- `packages/engine/src/adapters.ts`, `apps/extension/src/background/real.ts`: `titleMsg` on plan steps.
- `apps/extension/src/background/main.ts`, `apps/extension/src/shared/{messages,bus,features-bus,security-bus,social-bus}.ts`:
  the error envelope carries `msg` (optional, `z.unknown()`, shape-checked with `isMsg` in the UI).
- `packages/ui/src/context.tsx`: `BgTextProvider` inside `LocaleProvider`.

## UI

`useBgText()` (`packages/ui/src/i18n/bg.tsx`, exported from `@clip-wallet/ui`): `title(d)`, `label(l)`,
`value(l)`, `warning(w)`, `error(e)`, `msg(m, fallback)`. `userMessageOf(e)` uses the provider's current
renderer, so every error note translates without per-screen changes. Mobile wraps its provider the same way.

## Tests

`packages/ui/test/bg-i18n.test.ts` (catalog completeness, ICU/plural lint, glossary, Arabic isolation, every
Warning code's message translated, Msg contract), `packages/ui/test/bg-render.test.tsx` (rendering, fallback,
English detail), Msg assertions in chains-evm, chains-hedera, chains-near and features tests.
