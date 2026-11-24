# AGENTS.md - effect

Optional Effect integration: an Effect Schema `errorDecoder` and an Effect Match
`match` strategy. Regular workspace package; not a submodule.

## Module map

- `src/types.ts` — `EffectSchemaOptions` (`source`, `onFailure`,
  `preserveStatus`, `parseOptions`) and `EffectMatchOptions` (`resolve`,
  `discriminantKeys`).
- `src/schema.ts` — `effectSchemaDecoder` / `effectSchemaPlugin`. Selects the
  input (`raw.body` for `HttpRequestError` when `source` is `"auto"`/`"body"`),
  runs `Schema.decodeUnknownResult`, attaches the HTTP status non-enumerably on
  objects, and applies the `onFailure` policy (`raw`/`error`/`throw`).
- `src/match.ts` — `effectMatchStrategy` / `effectMatchPlugin`. Resolution order:
  `resolve` → client discriminator path → `_tag` → extra `discriminantKeys` →
  declared HTTP status → `__SDK_UNDECLARED_ERROR__` → `_` wildcard.
- `src/plugin.ts` — `effectPlugin`. Attaches only requested capabilities; infers
  `TError` from `schema` so `match.resolve` is typed; throws on empty config.
- `src/effect.ts` — `toEffect` converts any `SdkResultAsync` through `.match()`;
  `effectClient` is a recursive proxy that converts result-returning methods,
  binds to the target, and passes non-result values/arrays through.
- `src/index.ts` — public exports for the above plus their types.

## Invariants

- Peer dependencies: effect ^4.1.0 and `@openapi-sdk-tools/core` ^2.0.0. Effect is
  never bundled. Keep explicit dev dependencies for local build/tests.
- **No result backend.** Never provide the `result` capability, never add an
  `EffectResult` wrapper, and never present this package as a backend. Result
  creation stays with the core default or another backend.
- No success-response decoding; the decoder applies to errors only.
- No dependency from core, generator, NestJS, or generated SDKs on `effect`.
  Effect enters only through `@openapi-sdk-tools/effect` plus `plugins`.
- ESM-only: `"type": "module"`, `module`/`moduleResolution: nodenext`, explicit
  `.js` extensions on relative imports. Node >= 22.19. CJS consumers rely on
  `require(esm)` and see the ESM namespace (no default export, no `__esModule`).
- Effect v4 only. Do not port Effect v3 APIs; use the v4 `Result`-returning
  Schema decoder and v4 Match/Effect signatures.
- `ErrorDecoder.decode` is synchronous: support synchronous schemas only.
- No declarative `patterns` map; matching customisation goes through `resolve`.

## Verification

```bash
pnpm exec tsc --noEmit
pnpm test          # runs prerequisites: pnpm build, then vitest
pnpm build
```

Tests: `test/schema.test.ts` (input selection, status attachment, failure
policies), `test/match.test.ts` (resolution order and metadata), `test/plugin.test.ts`
(capability selection and typing), `test/effect.test.ts` (`toEffect` and the
client proxy), `test/exports.test.ts` (built exports and absence of a result
backend).
