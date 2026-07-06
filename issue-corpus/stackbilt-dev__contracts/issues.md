# Open Issues Corpus: stackbilt-dev/contracts
Exported: 2026-07-04T10:39:14.685Z  |  Total: 10

## #27: RFC: defineCapability() — a sibling primitive for operations-without-an-entity
URL: https://github.com/Stackbilt-dev/contracts/issues/27  |  Labels: enhancement  |  Updated: 2026-07-04T10:19:05Z  |  Comments: 0

## Proposal

Add \`defineCapability()\` as an additive sibling to \`defineContract()\`, for the "operations + a conformance obligation, no entity, no lifecycle" category of problem — the shape three independent repos have each hand-rolled a plain TypeScript interface for instead: edge-auth's \`ResourceQuotaProvider\`, aegis-daemon's \`ITaskExecutorDO\`, llm-providers' \`LLMProvider\`.

\`defineContract()\`'s ontology (schema/states/authority over a persisted, owned entity) is a confirmed category error for these — forcing \`LLMProvider\` into it would mean inventing a phantom entity with no lifecycle, the same mistake class as keeping a service's between-calls state as if it were a data state.

## Evidence: a rule-of-three experiment, not a proposal on spec

Rather than propose this shape speculatively, we hand-mocked \`defineCapability()\` in Stackbilt-dev/contracts-lab (\`capability/define-capability.ts\` — explicitly NOT built into this package, per the additive/no-speculative-abstraction discipline) and tested it against all three real interfaces:

- \`capability/llm-provider.capability.ts\` — translated from the real \`LLMProvider\` (6 operations, 4 capability flags)
- \`capability/resource-quota.capability.ts\` — translated from the real \`ResourceQuotaProvider\` (3 operations; edge-auth already had real Zod schemas at the param/result boundary, just never wrapped in an operations+flags shape)
- \`capability/task-executor.capability.ts\` — translated from the real \`ITaskExecutorDO\` (2 operations)

**Result: the shape fit all three cleanly, no phantom fields needed anywhere.** A conformance checker (\`checkConformance()\`) run against realistic sample payloads for each caught a deliberately-planted real violation precisely (a missing required field in a \`ConsumeQuotaResult\` sample), and a test generator (\`generateConformanceTests()\`) emitted real, runnable Vitest per capability — the concrete payoff a hand-rolled TS interface can never give. Full writeup: \`CAPABILITY-FINDINGS.md\` in contracts-lab.

## Two caveats to carry into any real design (from the findings doc)

1. **\`flags\` isn't universal.** Only \`LLMProvider\` used capability flags meaningfully (streaming/tools/batching/vision genuinely vary by provider). \`ResourceQuotaProvider\` and \`ITaskExecutorDO\` both had zero flags — every conformer implements every operation unconditionally. \`flags\` should stay optional on the primitive, not a required part of what makes something a capa

## #26: generateSQL() emits boolean literal DEFAULT false/true instead of 0/1
URL: https://github.com/Stackbilt-dev/contracts/issues/26  |  Labels: enhancement  |  Updated: 2026-07-04T10:01:51Z  |  Comments: 0

## Observation

For a \`z.boolean().default(false)\` field, \`generateSQL()\` emits:

\`\`\`sql
retryable INTEGER NOT NULL DEFAULT false
\`\`\`

Every real, hand-written migration in the org's D1 schemas that stores a boolean as \`INTEGER\` uses the \`0\`/\`1\` literal convention instead (e.g. aegis-daemon's real \`cc_tasks.retryable INTEGER NOT NULL DEFAULT 0\`). Modern SQLite (3.23+) does accept \`TRUE\`/\`FALSE\` as keyword aliases for \`1\`/\`0\`, so this likely isn't a hard syntax error — but it's inconsistent with the codebase-wide convention, and it's exactly the kind of thing a drift-check gate (comparing generated SQL against real schemas) will flag as a false discrepancy on every boolean column, every time.

## Where this surfaced

Same drift-check exercise as #25 (Stackbilt-dev/contracts-lab, `CcTask` vs the real `cc_tasks` table) — `retryable` was the only boolean column in that contract, and it was the only column-type mismatch left standing after fixing the real gaps in the contract itself.

## Possible fix

Emit \`0\`/\`1\` for boolean column defaults in SQLite-targeting output, matching the convention already used everywhere else in generated DDL (matches SQLite's own storage class for booleans — there's no native BOOLEAN type, it's always INTEGER 0/1 under the hood).

Filed to record it, not blocking — the current output is very likely valid SQLite, just stylistically inconsistent.

## #25: generateSQL() silently ignores db.columnOverrides — reproduced on the package's own Recipe example
URL: https://github.com/Stackbilt-dev/contracts/issues/25  |  Labels: bug  |  Updated: 2026-07-04T10:01:39Z  |  Comments: 0

## Bug

`DbSurface.columnOverrides?: Record<string, { default?: string }>` is declared in `core/define.ts` and used in the package's own reference example (`src/examples/recipe.contract.ts`):

```ts
db: {
 table: 'recipes',
 indexes: [...],
 columnOverrides: {
 createdAt: { default: 'CURRENT_TIMESTAMP' },
 updatedAt: { default: 'CURRENT_TIMESTAMP' },
 },
},
```

But `generateSQL(RecipeContract)` emits:

```sql
created_at TEXT NOT NULL,
updated_at TEXT NOT NULL,
```

No `DEFAULT CURRENT_TIMESTAMP` anywhere — the override is silently dropped. Reproduced fresh against the published package (`@stackbilt/contracts@0.7.0`) with nothing customized:

```bash
npx tsx -e "
import('@stackbilt/contracts/examples').then(async (m) => {
 const { generateSQL } = await import('@stackbilt/contracts/generators');
 console.log(generateSQL(m.RecipeContract));
});
"
```

## Where this surfaced

Building a drift-check gate in Stackbilt-dev/contracts-lab that regenerates SQL from a contract and diffs it against a real, live D1 table (`cc_tasks` in aegis-daemon). The real table has `created_at TEXT NOT NULL DEFAULT (datetime('now'))`; the contract (with a `columnOverrides` entry matching this) generates `created_at TEXT NOT NULL` — a false drift signal caused entirely by this bug, not by anything wrong in the contract.

## Impact

Any contract relying on `columnOverrides` for a DB-level default (timestamps being the obvious case — `CURRENT_TIMESTAMP`, `datetime('now')`, etc.) currently gets silently incorrect SQL, with no error or warning. This is worse than a missing feature because the type system and the reference example both imply it works.

Not attempting a fix here — filing per the gaps-filed-not-fixed-inline discipline this lab follows. No urgency framing needed; it's a real bug, just not blocking anything critical.

## #22: ref() can't express a self-referential FK (same contract references itself)
URL: https://github.com/Stackbilt-dev/contracts/issues/22  |  Labels: enhancement  |  Updated: 2026-07-04T09:17:14Z  |  Comments: 1

## Gap

\`ref(contract, field)\` takes a \`ContractDefinition\` argument, which means the target contract must already exist and be fully constructed before you can reference it. This makes same-contract self-references impossible to express — you can't write `ref(ThisContract, 'id')` inside `ThisContract`'s own `defineContract()` call, because `ThisContract` doesn't exist yet at that point.

## Where this surfaced

Writing a real `GenerationJob` contract (Stackbilt-dev/contracts-lab, translated from img-forge's actual `GenerateRequestSchema`) — img2img jobs chain off a prior job via `input_job_id`, which is genuinely a self-referential FK (`generation_jobs.input_job_id → generation_jobs.id`). Had to fall back to a plain `z.string().uuid()` with a comment, losing the FK metadata that `generateSQL`/`generateOpenAPI`/etc. would otherwise produce.

## Possible shapes for a fix

- A lazy/thunk form: `ref(() => ThisContract, 'id')`, resolved after the whole module evaluates
- A `selfRef(field)` helper used inside `schema` before `defineContract` wraps it, resolved by `defineContract` itself since it has access to the full definition at call time

Not attempting a fix here — filing per the additive-only/no-inline-fix discipline. No urgency; contracts-lab worked around it with a plain uuid + comment.

## #24: Transitions can't carry a guard (predicate over sibling fields)
URL: https://github.com/Stackbilt-dev/contracts/issues/24  |  Labels: enhancement  |  Updated: 2026-07-04T09:16:52Z  |  Comments: 0

## Gap

A `ContractOperation.transition` is unconditional: `{ from: string | string[]; to: string }`. There's no way to declare that a transition is only valid when some other field on the entity satisfies a predicate — a guard.

## Where this surfaced

Modeling a real `CcTask` contract (Stackbilt-dev/contracts-lab, translated from aegis-daemon's actual `cc_tasks` table). The real `approve` operation's SQL is:

```sql
UPDATE cc_tasks SET authority = 'operator'
WHERE authority = 'proposed' AND status = 'pending'
```

That's a state change (`authority: proposed → operator`) gated by a precondition on a *different* field (`status = 'pending'`). Initially this looked like "the entity has two state machines" (`status` and `authority`), but on closer analysis that's a misdiagnosis — `authority` only has one real edge (`proposed → operator`, monotone, one-shot). It's not a peer state machine, it's an **approval operation with a guard**. Modeling it as a second `states` block would over-dignify a single guarded transition.

Same root cause shows up more generally: `cc_tasks.executor` determines which operations are even meaningful (the `workers_ai` executor's own docs say it cannot do git/file/shell operations — only `claude_code`/`do_sandbox` can). That's "operation availability conditional on a field value" — the same guard concept, at the operation-definition level rather than the transition level.

## What this is NOT asking for

Not asking for a general statechart/hierarchical-state engine. A nested phase machine also showed up in this exercise (`TaskExecutorDO`'s internal `idle → planning → executing → committing → done|failed`, living in a Durable Object, not the D1 row) — the correct resolution there is a **separate contract for the separate component**, related to CcTask, not a feature to bolt onto one contract's `states`. Please don't read this issue as "support multiple state machines per entity" — guarded transitions cover the real cases found so far without that scope expansion.

## Possible shape

```ts
transition?: {
 from: string | string[];
 to: string;
 guard?: (entity: unknown) => true | string; // same signature as ContractInvariant.check
};
```

`generateTests` could then emit a real test per guarded transition: "transition rejected when guard fails" — a concrete win, not just schema decoration.

Filing to record the gap and the reasoning, not proposing this is the only viable shape — no urgency.

## #23: No way to express a cross-contract/aggregate invariant
URL: https://github.com/Stackbilt-dev/contracts/issues/23  |  Labels: enhancement  |  Updated: 2026-07-04T08:55:17Z  |  Comments: 0

## Gap

\`ContractInvariant.check: (entity: unknown) => true | string\` operates on a single entity instance, scoped to one contract. There's no first-class way to express an invariant that spans multiple rows or multiple contracts — e.g. an aggregate check like "the sum of a user's committed credit reservations must never exceed their balance."

## Where this surfaced

Writing a `CreditLedger` contract (Stackbilt-dev/contracts-lab) modeling edge-auth's real 3-phase reservation pattern (`checkQuota`/`consumeQuota`/`commitOrRefundQuota`). The invariant that actually matters most in that system — the aggregate balance check — can't be expressed inside `CreditLedgerContract.invariants`, because it needs to reason across all of a user's reservation rows, not just the one being reserved/committed/refunded. Left a comment noting the gap instead of faking a same-entity check that doesn't cover the real rule.

## Possible shapes for a fix

- A separate `crossContractInvariants` concept that takes a query/aggregation function plus the set of contracts it spans, rather than a single `entity: unknown`
- Or explicitly scope this out of `@stackbilt/contracts` (it's arguably a runtime/DB-transaction concern, not something a schema-level ontology should own) and document that aggregate invariants belong in the generated route handlers, not the contract

Filing to record the gap, not proposing a specific fix — this might reasonably be a "won't fix, out of scope" call. No urgency.

## #20: feat: add apiSurface / camelCase input-shape generator for API consumers
URL: https://github.com/Stackbilt-dev/contracts/issues/20  |  Labels: enhancement  |  Updated: 2026-06-17T10:27:32Z  |  Comments: 0

## Problem

Contracts use snake_case column names aligned to the database (e.g. `expiry_date`, `created_at`). FoodFiles API inputs use camelCase (e.g. `expiryDate` in `services/pantry.ts`). The package currently has no mechanism to derive a camelCase Zod schema or TypeScript type from a contract definition.

As a result, consumers must hand-roll casing transforms in every service file. This creates a divergence point: the contract schema and the API input schema drift independently, and there is no type-level guarantee that the two shapes agree.

## Acceptance Criteria

- [ ] A `toApiShape(contract)` (or `apiSurface(contract)`) export returns a Zod schema with camelCase keys derived from the contract's snake_case fields
- [ ] The transform is mechanical (snake_to_camel on field names) so no manual per-field mapping is needed
- [ ] `z.infer<ReturnType<typeof toApiShape<typeof PantryItemContract>>>` produces the correct camelCase TypeScript type
- [ ] Nested `ref()` fields are also camelCase in the output (e.g. `userId` not `user_id`)
- [ ] Optional: a `toDbShape(apiInput)` inverse transform is provided for writing validated input back to D1
- [ ] At least one round-trip test: camelCase parse → DB write shape → matches original snake_case contract fields

## Context

FoodFiles `services/pantry.ts` is the concrete failure case: `expiryDate` in the Zod schema vs `expiry_date` in `PantryItemContract`. Resolving this is a prerequisite for collapsing the dual schema sets (the hand-rolled Zod objects in each service file) into contract-derived types.

Ref: CONTRACT-4 gap analysis (phase-0 integration audit)

## #19: feat: add UserContract as a first-party primitive for ownership FK refs
URL: https://github.com/Stackbilt-dev/contracts/issues/19  |  Labels: enhancement  |  Updated: 2026-06-17T10:27:16Z  |  Comments: 0

## Problem

`recipe.contract.ts` and `pantry.contract.ts` both include comments noting "user ref omitted, no UserContract yet." The `ref()` FK primitive exists in the package but cannot be used for user ownership links until a canonical `UserContract` is defined and exported.

This affects every entity in the FoodFiles schema — all top-level resources are user-scoped. Without `UserContract`, contracts that model ownership relationships must either:
- Leave the FK untyped (losing referential integrity at the contract layer)
- Define a one-off local user shape, fragmenting the contract graph

## Acceptance Criteria

- [ ] `UserContract` is exported from `@stackbilt/contracts` (or a `@stackbilt/contracts/user` sub-path)
- [ ] `UserContract` includes at minimum: `id` (uuid), `email` (string), `created_at` (timestamp)
- [ ] `ref(UserContract)` resolves correctly in `generateSQL` to a FK column (`user_id UUID REFERENCES users(id)`)
- [ ] `ref(UserContract)` in `generateRoutes` / typed output preserves the `userId` field in the inferred TypeScript surface type
- [ ] Existing contracts that omit the user ref (`recipe`, `pantry`, `organization`) can be updated to use `ref(UserContract)` without a breaking schema change
- [ ] A migration snippet is documented for adding the FK column to tables that predate this contract

## Context

FoodFiles is the phase-0 consumer. All seven of its entity contracts need a `user_id` FK once `UserContract` is available. This is a blocking primitive for making contracts the authoritative source-of-truth for the FoodFiles data model.

Ref: CONTRACT-3 gap analysis (phase-0 integration audit)

## #18: feat: add ALTER TABLE diff mode to generateSQL for existing production schemas
URL: https://github.com/Stackbilt-dev/contracts/issues/18  |  Labels: enhancement  |  Updated: 2026-06-17T10:27:03Z  |  Comments: 0

## Problem

`generateSQL` currently emits only `CREATE TABLE` DDL. Running this output against any table that already exists in production will fail with a duplicate table error.

FoodFiles has 14 migrations already applied to its production D1 database. Adding contract-generated DDL to an established schema requires either:
- `ALTER TABLE ... ADD COLUMN` statements for new fields
- A diff mode that computes the delta between the current contract definition and an existing schema snapshot

Without this, `generateSQL` is unusable for any phase-0 or later consumer whose tables are already live. The only workaround is to manually translate contract changes into migration files, which defeats the purpose of the package.

## Acceptance Criteria

- [ ] `generateSQL(contract, { mode: 'diff', baseline: SchemaSnapshot })` emits only `ALTER TABLE ADD COLUMN` statements for columns present in the contract but absent from the baseline
- [ ] `SchemaSnapshot` can be produced from a D1 `PRAGMA table_info()` result (or equivalent JSON shape)
- [ ] Diff mode never emits `DROP COLUMN` statements without an explicit `{ destructive: true }` opt-in flag
- [ ] Default (no `baseline`) behavior remains `CREATE TABLE` for backwards compatibility
- [ ] A `generateMigration(contract, baseline)` convenience export wraps diff mode and returns a migration file string with a timestamped filename
- [ ] Unit tests cover: new table (no baseline), additive column, renamed column warning, type-change warning

## Context

FoodFiles is the designated phase-0 consumer. Its 14-migration history is the concrete stress-test for this feature. The pantry and organization contracts are the first candidates for diff-mode adoption once this lands.

Ref: CONTRACT-2 gap analysis (phase-0 integration audit)

## #17: feat: add typed route generator for Hono (generateRoutes v2)
URL: https://github.com/Stackbilt-dev/contracts/issues/17  |  Labels: enhancement  |  Updated: 2026-06-17T10:26:49Z  |  Comments: 0

## Problem

`generateRoutes` currently emits handler bodies as plain strings, requiring manual paste or eval at the consumer site. This is incompatible with typed Cloudflare Workers frameworks.

FoodFiles uses Hono with a typed app environment (`Hono<AppEnv>`). String-emitted handlers:
- Cannot be type-checked by tsc
- Cannot be composed with `AppEnv` generics (bindings, variables)
- Cannot be tree-shaken or statically analyzed by bundlers

This blocks any automated route wiring for phase-0 consumers and makes `generateRoutes` unusable in a typed Hono project.

## Acceptance Criteria

- [ ] `generateRoutes` returns importable route handler functions (or a Hono router instance) instead of strings
- [ ] Output is parameterized by an `Env` generic so consumers can pass `Hono<AppEnv>` context through
- [ ] Generated handlers preserve the full input/output types derived from the contract schema
- [ ] A `toHonoRouter<Env>(contract, handlers)` helper (or equivalent) is exported from the package
- [ ] At least one generated route passes `tsc --strict` in an isolated test fixture
- [ ] Existing `generateRoutes` string-output API is deprecated with a migration note in the changelog

## Context

FoodFiles is the designated phase-0 consumer for `@stackbilt/contracts`. The pantry and recipe routes are the primary integration targets. Without typed route generation, the contract layer cannot replace the hand-rolled Zod schemas in `services/pantry.ts` and `services/recipe.ts`.

Ref: CONTRACT-1 gap analysis (phase-0 integration audit)
