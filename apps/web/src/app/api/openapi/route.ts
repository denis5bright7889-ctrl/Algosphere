import { NextResponse } from 'next/server'

/**
 * Public OpenAPI 3.1 spec for the AlgoSphere public API.
 *
 * This is the canonical contract for /api/v1/* (VIP-key authenticated)
 * endpoints. Returned as JSON; rendered by /api-docs as Swagger UI.
 *
 * Sourced inline from Zod schemas in the actual route handlers — keeping
 * spec drift impossible is a roadmap item (zod-to-openapi conversion).
 */

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://algospherequant.com'

const spec = {
  openapi: '3.1.0',
  info: {
    title:       'AlgoSphere Quant API',
    version:     '1.0.0',
    description: [
      'Institutional REST API for AlgoSphere Quant. VIP tier required.',
      '',
      'Auth: send `Authorization: Bearer aq_live_<key>` on every request.',
      'Rate limit: 60 req/min by default (configurable per key).',
      'Monthly quota: 10,000 calls (Premium) or 100,000 (VIP). Overage billed at $0.0005/call.',
    ].join('\n'),
    contact: { name: 'AlgoSphere Quant', url: APP_URL },
    license: { name: 'Proprietary' },
  },
  servers: [
    { url: `${APP_URL}/api/v1`, description: 'Production' },
  ],
  security: [{ BearerAuth: [] }],
  components: {
    securitySchemes: {
      BearerAuth: {
        type:   'http',
        scheme: 'bearer',
        bearerFormat: 'aq_live_<48-char-secret>',
      },
    },
    schemas: {
      Error: {
        type: 'object',
        properties: {
          error:               { type: 'string' },
          retry_after_seconds: { type: 'integer', nullable: true },
        },
        required: ['error'],
      },
      Signal: {
        type: 'object',
        properties: {
          id:               { type: 'string', format: 'uuid' },
          pair:             { type: 'string', example: 'XAUUSD' },
          direction:        { type: 'string', enum: ['buy', 'sell'] },
          entry_price:      { type: 'number', example: 2050.50 },
          stop_loss:        { type: 'number', example: 2045.00 },
          take_profit_1:    { type: 'number', nullable: true },
          take_profit_2:    { type: 'number', nullable: true },
          take_profit_3:    { type: 'number', nullable: true },
          risk_reward:      { type: 'number', nullable: true },
          confidence_score: { type: 'integer', minimum: 0, maximum: 100, nullable: true },
          regime:           { type: 'string', nullable: true },
          tier_required:    { type: 'string', enum: ['free','starter','premium','vip'] },
          published_at:     { type: 'string', format: 'date-time' },
        },
      },
      JournalEntry: {
        type: 'object',
        properties: {
          id:            { type: 'string', format: 'uuid' },
          pair:          { type: 'string' },
          direction:     { type: 'string', enum: ['buy','sell'] },
          entry_price:   { type: 'number', nullable: true },
          exit_price:    { type: 'number', nullable: true },
          pnl:           { type: 'number', nullable: true },
          ai_score:      { type: 'integer', minimum: 0, maximum: 100, nullable: true },
          ai_review:     { type: 'string', nullable: true },
          trade_date:    { type: 'string', format: 'date' },
        },
      },
    },
    responses: {
      Unauthorized: {
        description: 'Missing, malformed, or revoked API key',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
      },
      Forbidden: {
        description: 'VIP tier required, demo account, or insufficient key permissions',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
      },
      RateLimited: {
        description: 'Per-minute rate limit exceeded',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
      },
    },
  },
  paths: {
    '/signals': {
      get: {
        summary: 'List recent signals',
        description: 'Returns up to 50 most recent signals visible to your tier.',
        parameters: [
          { name: 'limit',  in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } },
          { name: 'pair',   in: 'query', schema: { type: 'string' }, description: 'Filter by symbol' },
          { name: 'status', in: 'query', schema: { type: 'string', enum: ['active','closed'] } },
        ],
        responses: {
          200: {
            description: 'Signal list',
            content: { 'application/json': {
              schema: {
                type: 'object',
                properties: {
                  data:  { type: 'array', items: { $ref: '#/components/schemas/Signal' } },
                  count: { type: 'integer' },
                },
              },
            }},
          },
          401: { $ref: '#/components/responses/Unauthorized' },
          403: { $ref: '#/components/responses/Forbidden' },
          429: { $ref: '#/components/responses/RateLimited' },
        },
        'x-required-permission': 'signals:read',
      },
    },
    '/journal': {
      get: {
        summary: 'List your journal entries',
        responses: {
          200: {
            description: 'Journal entries',
            content: { 'application/json': {
              schema: {
                type: 'object',
                properties: {
                  data: { type: 'array', items: { $ref: '#/components/schemas/JournalEntry' } },
                },
              },
            }},
          },
        },
        'x-required-permission': 'journal:read',
      },
      post: {
        summary: 'Log a trade',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: {
            type: 'object',
            required: ['pair','direction','trade_date'],
            properties: {
              pair:        { type: 'string' },
              direction:   { type: 'string', enum: ['buy','sell'] },
              entry_price: { type: 'number' },
              exit_price:  { type: 'number' },
              lot_size:    { type: 'number', exclusiveMinimum: 0 },
              pnl:         { type: 'number' },
              trade_date:  { type: 'string', format: 'date' },
              setup_tag:   { type: 'string' },
              notes:       { type: 'string' },
            },
          }}},
        },
        responses: {
          201: { description: 'Created — AI review is queued non-blocking', content: { 'application/json': { schema: { $ref: '#/components/schemas/JournalEntry' } } } },
        },
        'x-required-permission': 'journal:write',
      },
    },
    '/analytics': {
      get: {
        summary: 'Performance analytics rollup',
        description: 'Returns Sharpe, Sortino, max DD, profit factor over the requested lookback window.',
        parameters: [
          { name: 'days', in: 'query', schema: { type: 'integer', minimum: 7, maximum: 365, default: 90 } },
        ],
        responses: { 200: { description: 'Analytics object' } },
        'x-required-permission': 'analytics:read',
      },
    },
    '/positions': {
      get: {
        summary: 'Open positions across connected brokers',
        responses: { 200: { description: 'Position list' } },
        'x-required-permission': 'positions:read',
      },
    },
    '/risk': {
      get: {
        summary: 'Live risk telemetry',
        description: 'Equity, drawdown %, consecutive losses, kill-switch state.',
        responses: { 200: { description: 'Risk state' } },
        'x-required-permission': 'risk:read',
      },
    },
  },
  tags: [
    { name: 'signals',   description: 'Trading signals (read-only)' },
    { name: 'journal',   description: 'Trade journal CRUD' },
    { name: 'analytics', description: 'Performance metrics' },
    { name: 'positions', description: 'Broker-side positions' },
    { name: 'risk',      description: 'Risk engine telemetry' },
  ],
}

export function GET() {
  return NextResponse.json(spec, {
    headers: {
      // Public spec — cache aggressively at the edge
      'cache-control': 'public, max-age=300, s-maxage=300',
      'access-control-allow-origin': '*',
    },
  })
}
