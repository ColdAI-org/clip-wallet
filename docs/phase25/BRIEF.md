# Phase 2.5 / 3 brief

Same rules as docs/phase2/BRIEF.md (read it): only packages/vault signs; tests never generate keys or sign (offline fixtures);
networks are invisible in UX; plain-language ClipError messages; verify every API/standard from current sources and cite it;
no secrets printed or committed; testnets by default; signed commits with the Co-Authored-By trailer; never push.

Shared files (apps/extension/src/background/{wiring,service,real}.ts, apps/extension/src/shared/catalog.ts, packages/ui routing/tab files,
packages/engine/src/engine.ts, packages/1mask/src/{inpage/index,background/router,background/methods}.ts, packages/config):
keep edits minimal and additive. If you need more than ~30 lines there, create new files and write the exact wiring in
docs/phase25/integration/<stream>.md for the integration step.

Finish: pnpm install, pnpm -r typecheck, pnpm -r test, pnpm harness green (and the extension e2e if you touched the extension).
Report: what was built, sources, tests, integration doc, gaps.
