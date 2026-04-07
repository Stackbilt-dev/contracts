# @stackbilt/contracts

Pragmatic [Ontology-Driven Design](https://en.wikipedia.org/wiki/Ontology-based_data_management) for TypeScript. Define your domain once, generate everything.

**TypeScript + Zod instead of RDF/OWL/SHACL.** Same goals: centralized knowledge, grounded reasoning, zero inference. One contract definition produces D1 migrations, Hono route handlers, typed SDK clients, OpenAPI specs, and test fixtures.

## Install

```bash
npm install @stackbilt/contracts zod
```

## Quick Start

Define a contract:

```typescript
import { z } from 'zod';
import { defineContract } from '@stackbilt/contracts';

const TaskContract = defineContract({
  name: 'Task',
  version: '1.0.0',
  description: 'A work item with lifecycle management',

  schema: z.object({
    id: z.string().uuid(),
    userId: z.string(),
    title: z.string().min(1).max(200),
    status: z.enum(['open', 'in_progress', 'done']),
    createdAt: z.string().datetime(),
  }),

  operations: {
    create: {
      input: z.object({
        userId: z.string(),
        title: z.string().min(1).max(200),
      }),
      output: 'self',
      emits: ['task.created'],
    },
    complete: {
      input: z.object({ id: z.string().uuid() }),
      output: 'self',
      transition: { from: 'in_progress', to: 'done' },
      emits: ['task.completed'],
    },
  },

  states: {
    field: 'status',
    initial: 'open',
    transitions: {
      open:        { start: 'in_progress' },
      in_progress: { complete: 'done' },
      done:        {},
    },
  },

  surfaces: {
    api: {
      basePath: '/api/tasks',
      routes: {
        create:   { method: 'POST', path: '/' },
        list:     { method: 'GET',  path: '/' },
        get:      { method: 'GET',  path: '/:id' },
        complete: { method: 'POST', path: '/:id/complete' },
      },
    },
    db: {
      table: 'tasks',
      indexes: ['idx_task_user(user_id, status)'],
    },
  },

  authority: {
    create:   { requires: 'authenticated' },
    list:     { requires: 'public' },
    get:      { requires: 'public' },
    complete: { requires: 'owner', ownerField: 'userId' },
  },
});
```

Generate everything from that single definition:

```typescript
import {
  generateSQL,
  generateRoutes,
  generateSDK,
  generateOpenAPI,
  generateTests,
} from '@stackbilt/contracts/generators';

const sql     = generateSQL(TaskContract);       // CREATE TABLE DDL
const routes  = generateRoutes(TaskContract);    // Hono handler bodies
const sdk     = generateSDK(TaskContract);       // Typed fetch client
const openapi = generateOpenAPI(TaskContract);   // OpenAPI 3.1 spec
const tests   = generateTests(TaskContract);     // Vitest fixtures
```

## What a Contract Defines

A contract is a single source of truth for a domain entity:

| Field | Purpose |
|-------|---------|
| `schema` | Entity shape (Zod schema) |
| `operations` | Valid actions with typed input/output |
| `states` | State machine transitions (optional) |
| `surfaces` | API routes + DB table mapping |
| `authority` | Per-operation access control |
| `invariants` | Runtime business rules (optional) |
| `version` | Semver for schema evolution |

## Core API

### `defineContract(definition)`

Pure declaration factory. No side effects. Returns the definition with full type inference.

```typescript
import { defineContract } from '@stackbilt/contracts';

const MyContract = defineContract({
  name: 'MyEntity',
  version: '1.0.0',
  description: '...',
  schema: z.object({ ... }),
  operations: { ... },
  surfaces: { ... },
  authority: { ... },
});
```

### `ref(contract, field)`

Cross-contract foreign key reference. Generators use the metadata for JOIN clauses and referential integrity.

```typescript
import { ref } from '@stackbilt/contracts';

schema: z.object({
  userId: ref(UserContract, 'id'),  // FK to users.id
})
```

### `extend(base, extension)`

Contract inheritance. Creates a new contract with merged fields. Base contract remains untouched.

```typescript
import { extend } from '@stackbilt/contracts';

const AdminTaskContract = extend(TaskContract, {
  name: 'AdminTask',
  operations: {
    forceClose: {
      input: z.object({ id: z.string().uuid(), reason: z.string() }),
      output: 'self',
      transition: { from: ['open', 'in_progress'], to: 'done' },
    },
  },
  authority: {
    forceClose: { requires: 'role', roles: ['admin'] },
  },
});
```

## Generators

All generators take a `ContractDefinition` and return a string (or object for OpenAPI).

### `generateSQL(contract, options?)`

Emits `CREATE TABLE` DDL for D1 (SQLite).

**Options:**
- `dropFirst` — prepend `DROP TABLE IF EXISTS`
- `ifNotExists` — add `IF NOT EXISTS` (default: `true`)
- `tableName` — override table name

**Output includes:**
- Column types mapped from Zod (string -> TEXT, number.int -> INTEGER, number -> REAL, boolean -> INTEGER, enum -> TEXT with CHECK, array/object -> TEXT as JSON)
- NOT NULL for non-optional fields
- PRIMARY KEY detection
- CHECK constraints for enum fields
- UNIQUE constraints from `surfaces.db.uniqueColumns`
- DEFAULT values from `surfaces.db.columnOverrides`
- Foreign key comments from `ref()` calls
- Index definitions from `surfaces.db.indexes`

### `generateRoutes(contract, options?)`

Emits Hono HTTP handler bodies with D1 operations.

**Options:**
- `contractImport` — import path for the contract
- `appVar` — Hono app variable name
- `includeAuthImports` — include auth middleware imports

**Output includes:**
- Per-route handlers with try/catch error handling
- Input validation via `safeParse()`
- CRUD operations (INSERT, SELECT, UPDATE, DELETE)
- State transition guards (checks current state before allowing transition, returns 409 on invalid state)
- Authority middleware (`requireAuth`, `requireOwner`, `requireRole`)
- Proper HTTP status codes (201, 400, 404, 409, 500)
- Response envelope: `{ data }` or `{ error: { code, message } }`

### `generateSDK(contract, options?)`

Emits a typed fetch client class.

**Options:**
- `contractImport` — import path
- `className` — class name override

**Output includes:**
- Client class with `baseUrl` + `headers` constructor
- Per-operation methods with typed input/output
- Path parameter interpolation
- Error handling with descriptive messages

### `generateOpenAPI(contract, options?)`

Returns an OpenAPI 3.1.0 specification object.

**Options:**
- `title` — API title override
- `version` — API version override
- `serverUrl` — server URL

**Output includes:**
- Paths from `surfaces.api.routes` (`:id` -> `{id}` conversion)
- Request/response schemas from operations
- Security schemes for authenticated routes
- Component schemas for entity + operation inputs

### `generateTests(contract, options?)`

Emits Vitest test fixtures and state machine validation tests.

**Options:**
- `contractImport` — import path

**Output includes:**
- Valid fixture generation with sensible defaults per type
- Enum validation tests (pass/fail for each value)
- State transition tests (allowed and blocked transitions)
- Missing field rejection tests

## Introspection

The Zod schema walker extracts metadata for code generation. Works with both Zod v3 and v4.

```typescript
import { extractColumns, extractEnums, toSnakeCase } from '@stackbilt/contracts/introspect';

const columns = extractColumns(MyContract.schema);
// [{ name: 'id', sqlType: 'TEXT', nullable: false, isPrimaryKey: true, ... }, ...]

const enums = extractEnums(MyContract.schema);
// { status: ['open', 'in_progress', 'done'] }

toSnakeCase('createdAt'); // 'created_at'
```

### `ColumnDef`

```typescript
interface ColumnDef {
  name: string;           // snake_case column name
  sqlType: string;        // TEXT | INTEGER | REAL
  nullable: boolean;
  defaultValue: string | null;
  checkConstraint: string | null;  // SQL CHECK for enums
  isPrimaryKey: boolean;
  isRef: boolean;         // foreign key via ref()
  refTable: string | null;
  refField: string | null;
}
```

## State Machines

Contracts can declare state machines that enforce valid transitions:

```typescript
states: {
  field: 'status',        // which schema field holds state
  initial: 'draft',       // state for new entities
  transitions: {
    draft:     { publish: 'published', archive: 'archived', delete: null },
    published: { archive: 'archived' },
    archived:  {},         // terminal state
  },
}
```

- `null` as a target means deletion (terminal)
- Empty `{}` means no valid transitions (terminal state)
- Route generator emits guards that check current state and return 409 on invalid transitions

## Authority

Four authorization levels per operation:

```typescript
authority: {
  list:    { requires: 'public' },                        // no auth
  create:  { requires: 'authenticated' },                 // any logged-in user
  update:  { requires: 'owner', ownerField: 'userId' },  // entity owner only
  admin:   { requires: 'role', roles: ['admin'] },        // specific roles
}
```

Route generator emits the corresponding middleware calls.

## Invariants

Runtime business rules that guard operations:

```typescript
invariants: [
  {
    name: 'min_ingredients',
    description: 'Published recipes need at least one ingredient',
    check: (entity) => {
      const e = entity as { status: string; ingredients: string[] };
      if (e.status === 'published' && e.ingredients.length === 0) {
        return 'Published recipes need at least one ingredient';
      }
      return true;
    },
    appliesTo: ['publish'],
  },
]
```

- Return `true` to pass, or a string error message to reject
- `appliesTo` lists which operations trigger the check
- Enforcement is delegated to your application code

## Examples

See [`src/examples/recipe.contract.ts`](src/examples/recipe.contract.ts) for a complete contract demonstrating schema, operations, state machine, surfaces, authority, and invariants.

```typescript
import { RecipeContract } from '@stackbilt/contracts/examples';
import { generateSQL, generateRoutes } from '@stackbilt/contracts/generators';

console.log(generateSQL(RecipeContract));
console.log(generateRoutes(RecipeContract));
```

## Design Principles

1. **Contracts are the source of truth.** Schema, API, database, auth, and business rules in one place.
2. **Generate, don't handwrite.** CRUD handlers, SQL migrations, SDKs, and tests derived from contracts.
3. **Zod over RDF.** Same ontological rigor, developer-friendly, no external tooling required.
4. **Extend over modify.** `extend()` creates new contracts from existing ones without mutation.
5. **Surfaces decouple shape from deployment.** Same contract serves different API frameworks and databases.
6. **Authority is declarative.** Per-operation access rules, generated as middleware.
7. **State machines are optional but powerful.** Transitions enforce valid lifecycle changes at the route level.

## License

Apache-2.0
