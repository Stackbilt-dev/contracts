import { z } from 'zod';

/**
 * McpToolInvocation — MCP JSON-RPC wire contract for service-binding callers.
 *
 * Reference implementation: stackbilt-mcp-gateway `src/gateway.ts` (`handleMcpRequest`
 * et al.) — the gateway is the canonical server; this contract documents its actual
 * wire behavior in typed form so callers (tarotscript's `McpClient`, and any future
 * agent-loop tool executor) can conform without re-deriving the protocol by reading
 * gateway source. The gateway does not import these types in this revision — see
 * tarotscript#438 for the consumer that does.
 *
 * Scope: only the subset of MCP Streamable HTTP actually exercised by internal,
 * service-binding-authenticated callers (`initialize`, `tools/list`, `tools/call`).
 * SSE (`GET`) and session termination (`DELETE`) are out of scope — no current
 * caller uses them.
 *
 * Closes tarotscript#438 (McpClient spoke an invented REST facade — `GET /tools`,
 * `POST /invoke` — that never existed on the gateway; every tool-bound agent loop
 * failed turn 1 with `mcp_invoke_failed:404`).
 */

// ---------------------------------------------------------------------------
// Envelope
// ---------------------------------------------------------------------------

export const JSON_RPC_VERSION = '2.0' as const;

/** Matches `MCP_PROTOCOL_VERSION` in stackbilt-mcp-gateway/src/gateway.ts. The
 * gateway accepts any value here (forward-compatible, no hard rejection) but
 * callers should send this exact string. */
export const MCP_PROTOCOL_VERSION = '2025-03-26' as const;

export const JsonRpcIdSchema = z.union([z.string(), z.number(), z.null()]);
export type JsonRpcId = z.infer<typeof JsonRpcIdSchema>;

/** Standard JSON-RPC 2.0 error codes the gateway actually emits. */
export const JSON_RPC_PARSE_ERROR = -32700;
export const JSON_RPC_INVALID_REQUEST = -32600;
export const JSON_RPC_METHOD_NOT_FOUND = -32601;
export const JSON_RPC_INVALID_PARAMS = -32602;
export const JSON_RPC_INTERNAL_ERROR = -32603;

export const JsonRpcErrorSchema = z.object({
  code: z.number().int(),
  message: z.string(),
  data: z.record(z.string(), z.unknown()).optional(),
});
export type JsonRpcError = z.infer<typeof JsonRpcErrorSchema>;

/** Generic JSON-RPC response envelope — `result` XOR `error`, never both. */
export const JsonRpcResponseSchema = z.object({
  jsonrpc: z.literal(JSON_RPC_VERSION),
  id: JsonRpcIdSchema,
  result: z.unknown().optional(),
  error: JsonRpcErrorSchema.optional(),
});
export type JsonRpcResponse = z.infer<typeof JsonRpcResponseSchema>;

// ---------------------------------------------------------------------------
// initialize
// ---------------------------------------------------------------------------

export const McpClientInfoSchema = z.object({
  name: z.string(),
  version: z.string().optional(),
});

export const InitializeParamsSchema = z.object({
  protocolVersion: z.string().optional(),
  clientInfo: McpClientInfoSchema.optional(),
  capabilities: z.record(z.string(), z.unknown()).optional(),
});
export type InitializeParams = z.infer<typeof InitializeParamsSchema>;

export const InitializeRequestSchema = z.object({
  jsonrpc: z.literal(JSON_RPC_VERSION),
  id: JsonRpcIdSchema,
  method: z.literal('initialize'),
  params: InitializeParamsSchema.optional(),
});
export type InitializeRequest = z.infer<typeof InitializeRequestSchema>;

/** Gateway session/quota metadata embedded in `serverInfo.metadata` — informational,
 * not required for a caller to function, but useful for capability discovery. */
export const InitializeSessionMetadataSchema = z.object({
  tier: z.string(),
  scopes: z.array(z.string()),
  ttlSeconds: z.number().int().positive(),
  quota: z.object({ credits: z.number(), note: z.string() }).optional(),
});

export const InitializeResultSchema = z.object({
  protocolVersion: z.string(),
  capabilities: z.object({
    tools: z.object({ listChanged: z.boolean() }),
  }),
  serverInfo: z.object({
    name: z.string(),
    version: z.string(),
    metadata: z
      .object({
        products: z.array(z.object({ name: z.string(), prefix: z.string(), status: z.string() })).optional(),
        toolSummary: z
          .array(z.object({ name: z.string(), riskLevel: z.string(), readOnly: z.boolean() }))
          .optional(),
        session: InitializeSessionMetadataSchema.optional(),
        riskLevels: z.record(z.string(), z.string()).optional(),
      })
      .optional(),
  }),
});
export type InitializeResult = z.infer<typeof InitializeResultSchema>;

/** The gateway returns the session id as a response HEADER (`MCP-Session-Id`),
 * not in the JSON body — callers must read it off the HTTP response and send it
 * back on every subsequent request via the same header. */
export const MCP_SESSION_HEADER = 'MCP-Session-Id' as const;

// ---------------------------------------------------------------------------
// tools/list
// ---------------------------------------------------------------------------

export const ToolsListRequestSchema = z.object({
  jsonrpc: z.literal(JSON_RPC_VERSION),
  id: JsonRpcIdSchema,
  method: z.literal('tools/list'),
});
export type ToolsListRequest = z.infer<typeof ToolsListRequestSchema>;

export const ToolDescriptorSchema = z.object({
  name: z.string(),
  title: z.string().optional(),
  description: z.string().optional(),
  inputSchema: z.record(z.string(), z.unknown()).optional(),
  annotations: z
    .object({
      readOnlyHint: z.boolean().optional(),
      destructiveHint: z.boolean().optional(),
      idempotentHint: z.boolean().optional(),
      openWorldHint: z.boolean().optional(),
      riskLevel: z.string().optional(),
    })
    .optional(),
});
export type ToolDescriptor = z.infer<typeof ToolDescriptorSchema>;

export const ToolsListResultSchema = z.object({
  tools: z.array(ToolDescriptorSchema),
});
export type ToolsListResult = z.infer<typeof ToolsListResultSchema>;

// ---------------------------------------------------------------------------
// tools/call
// ---------------------------------------------------------------------------

export const ToolsCallParamsSchema = z.object({
  name: z.string(),
  arguments: z.record(z.string(), z.unknown()).optional(),
});
export type ToolsCallParams = z.infer<typeof ToolsCallParamsSchema>;

export const ToolsCallRequestSchema = z.object({
  jsonrpc: z.literal(JSON_RPC_VERSION),
  id: JsonRpcIdSchema,
  method: z.literal('tools/call'),
  params: ToolsCallParamsSchema,
});
export type ToolsCallRequest = z.infer<typeof ToolsCallRequestSchema>;

export const ToolContentBlockSchema = z.object({
  type: z.string(),
  text: z.string(),
});

/** Matches `BackendToolResult` in stackbilt-mcp-gateway/src/types.ts. A scope
 * shortfall on a `STRUCTURED_SCOPE_ESCALATION_TOOLS` entry (e.g. billing tools)
 * also arrives shaped this way — `isError: true` with a structured JSON string in
 * `content[0].text` — rather than as a JSON-RPC protocol error. Callers that need
 * to distinguish "tool ran and failed" from "tool call was rejected" must inspect
 * `isError`, not rely on JSON-RPC `error` alone. */
export const ToolsCallResultSchema = z.object({
  content: z.array(ToolContentBlockSchema),
  isError: z.boolean().optional(),
});
export type ToolsCallResult = z.infer<typeof ToolsCallResultSchema>;

// ---------------------------------------------------------------------------
// Transport / auth
// ---------------------------------------------------------------------------

/**
 * HTTP-layer requirements the gateway enforces, not expressible as a JSON-RPC
 * body schema:
 *
 * - Every request is `POST` to `/api/mcp` (NOT `/`). The root path routes through
 *   `@cloudflare/workers-oauth-provider`, which validates OAuth-issued access
 *   tokens and rejects anything else before the request reaches JSON-RPC handling.
 *   `/api/mcp` bypasses that wrapper so `resolveAuth()` can fall through to
 *   Bearer-token validation (API keys, JWTs, and the internal bypass below).
 * - `initialize` requires no `MCP-Session-Id` header (there is no session yet).
 *   Every other method requires it; the gateway responds with a JSON-RPC
 *   `-32600 Invalid Request` if it's missing.
 * - `Content-Type: application/json` on the request; `Accept` should include
 *   `application/json` (an absent `Accept` header is tolerated, but don't rely
 *   on that — the gateway accepts any Accept value containing "application/json"
 *   or a wildcard media range, or an empty header).
 */
export const McpTransportRequirementsSchema = z.object({
  method: z.literal('POST'),
  path: z.literal('/api/mcp'),
  headers: z.object({
    'Content-Type': z.literal('application/json'),
    Accept: z.literal('application/json').optional(),
    Authorization: z.string().startsWith('Bearer '),
    'MCP-Session-Id': z.string().optional(),
    'X-Internal-User': z.string().optional(),
  }),
});
export type McpTransportRequirements = z.infer<typeof McpTransportRequirementsSchema>;

/**
 * Service-binding caller auth — the internal bypass path (`resolveAuth()` in
 * gateway.ts), live in staging + production since commit 660596e. This is the
 * ONLY auth path available to a Worker calling the gateway over a Service
 * Binding fetch: OAuth requires a browser redirect flow a Worker can't do, and
 * ordinary API keys (`ea_*`) are per-user, not per-service.
 *
 * `Authorization: Bearer <INTERNAL_API_KEY>` — shared secret, provisioned via
 * `wrangler secret put INTERNAL_API_KEY` on the gateway and distributed to
 * callers out of band (never committed). Resolves to tier `'internal'`: all
 * scopes granted, quota/rate-limit bypassed.
 *
 * `X-Internal-User: <caller-id>` — scopes the internal identity
 * (`internal:<caller-id>`) per calling agent/service so testers and agent
 * sessions don't bleed into each other's memory/audit namespaces. Optional;
 * defaults to `'default'` server-side if omitted, but callers SHOULD set it to
 * a stable identifier (e.g. the calling DO's agent name) for audit hygiene.
 */
export const InternalServiceBindingAuthSchema = z.object({
  authorizationHeader: z.string().startsWith('Bearer '),
  internalUserHeader: z.string().min(1).optional(),
});
export type InternalServiceBindingAuth = z.infer<typeof InternalServiceBindingAuthSchema>;

export function buildInternalAuthHeaders(auth: InternalServiceBindingAuth): Record<string, string> {
  const headers: Record<string, string> = { Authorization: auth.authorizationHeader };
  if (auth.internalUserHeader) headers['X-Internal-User'] = auth.internalUserHeader;
  return headers;
}
