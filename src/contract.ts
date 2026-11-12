import { Rpc } from '@opencode/plugin/rpc';

const choice = { type: 'object', properties: { providerID: { type: 'string' }, id: { type: 'string' }, variant: { anyOf: [{ type: 'string' }, { type: 'null' }] } }, required: ['providerID', 'id', 'variant'], additionalProperties: false } as const;
const roles = { type: 'object', properties: { planner: { type: 'array', items: choice }, coder: { type: 'array', items: choice }, reviewer: { type: 'array', items: choice } }, required: ['planner', 'coder', 'reviewer'], additionalProperties: false } as const;
const settings = { type: 'object', properties: { revision: { type: 'integer', minimum: 0 }, roles }, required: ['revision', 'roles'], additionalProperties: false } as const;
const response = { type: 'object', properties: { directory: { type: 'string' }, settings }, required: ['directory', 'settings'], additionalProperties: false } as const;

const amount = { type: 'object', properties: { knownUsd: { type: 'string' }, unknownCount: { type: 'integer' } }, required: ['knownUsd', 'unknownCount'], additionalProperties: false } as const;
const bucketProperties = { attempts: { type: 'integer' }, gross: amount, credit: amount, cash: amount, estimated: { type: 'integer' }, providerReported: { type: 'integer' } } as const;
const bucketRequired = ['attempts', 'gross', 'credit', 'cash', 'estimated', 'providerReported'] as const;
const bucket = { type: 'object', properties: bucketProperties, required: bucketRequired, additionalProperties: false } as const;
const group = { type: 'array', items: { type: 'object', properties: { key: { type: 'string' }, ...bucketProperties }, required: ['key', ...bucketRequired], additionalProperties: false } } as const;
const usageResponse = { type: 'object', properties: {
  directory: { type: 'string' }, coverage: { type: 'object', properties: { complete: { type: 'boolean' }, projectSessions: { type: 'integer' }, unavailableSessions: { type: 'integer' }, skippedMessages: { type: 'integer' }, truncated: { type: 'boolean' }, timestamp: { type: 'string' } }, required: ['complete', 'projectSessions', 'unavailableSessions', 'skippedMessages', 'truncated', 'timestamp'], additionalProperties: false },
  summary: { type: 'object', properties: { calendarMonth: { type: 'string' }, timeZone: { type: 'string' }, total: bucket, days: { type: 'array', items: { type: 'object', properties: { date: { type: 'string' }, ...bucketProperties }, required: ['date', ...bucketRequired], additionalProperties: false } }, breakdown: { type: 'object', properties: { provider: group, model: group, effort: group, role: group, project: group }, required: ['provider', 'model', 'effort', 'role', 'project'], additionalProperties: false } }, required: ['calendarMonth', 'timeZone', 'total', 'days', 'breakdown'], additionalProperties: false },
}, required: ['directory', 'coverage', 'summary'], additionalProperties: false } as const;

const runSummary = { type: 'object', properties: { id: { type: 'string' }, requirement: { type: 'string' }, baseCommit: { type: 'string' }, revision: { type: 'integer' }, state: { type: 'string' }, planHash: { anyOf: [{ type: 'string' }, { type: 'null' }] } }, required: ['id', 'requirement', 'baseCommit', 'revision', 'state', 'planHash'], additionalProperties: false } as const;
const nullableString = { anyOf: [{ type: 'string' }, { type: 'null' }] } as const;
const draftDetail = { type: 'object', properties: { ...runSummary.properties, clarification: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, question: { type: 'string' }, answer: nullableString }, required: ['id', 'question', 'answer'], additionalProperties: false } }, planJson: nullableString }, required: [...runSummary.required, 'clarification', 'planJson'], additionalProperties: false } as const;
const detailOutput = { type: 'object', properties: { directory: { type: 'string' }, run: draftDetail }, required: ['directory', 'run'], additionalProperties: false } as const;
const budgetLimit = { anyOf: [{ type: 'null' }, { type: 'object', properties: { amount: { type: 'string' }, revision: { type: 'integer', minimum: 1 } }, required: ['amount', 'revision'], additionalProperties: false }] } as const;
const budgetUsage = { anyOf: [{ type: 'null' }, { type: 'object', properties: { committedUsd: { type: 'string' }, pendingUsd: { type: 'string' }, pendingCount: { type: 'integer' }, remainingUsd: nullableString, overLimitUsd: nullableString }, required: ['committedUsd', 'pendingUsd', 'pendingCount', 'remainingUsd', 'overLimitUsd'], additionalProperties: false }] } as const;
const budgetOutput = { type: 'object', properties: { directory: { type: 'string' }, available: { type: 'boolean' }, period: nullableString, monthly: budgetLimit, feature: budgetLimit, monthlyUsage: budgetUsage, featureUsage: budgetUsage }, required: ['directory', 'available', 'period', 'monthly', 'feature', 'monthlyUsage', 'featureUsage'], additionalProperties: false } as const;
export const FeaturePilot = Rpc.define({
  id: 'feature-pilot',
  events: {},
  methods: {
    getBudget: { input: { type: 'object', properties: { runID: { anyOf: [{ type: 'string' }, { type: 'null' }] } }, required: ['runID'], additionalProperties: false }, output: budgetOutput },
    setBudget: { input: { type: 'object', properties: { scope: { type: 'string', enum: ['monthly', 'feature'] }, runID: { anyOf: [{ type: 'string' }, { type: 'null' }] }, amount: { type: 'string' }, revision: { type: 'integer', minimum: 0 } }, required: ['scope', 'runID', 'amount', 'revision'], additionalProperties: false }, output: budgetOutput },
    exportDraft: { input: { type: 'object', properties: { id: { type: 'string' }, revision: { type: 'integer', minimum: 0 } }, required: ['id', 'revision'], additionalProperties: false }, output: { type: 'object', properties: { directory: { type: 'string' }, preview: { type: 'string' } }, required: ['directory', 'preview'], additionalProperties: false } },
    getDraft: { input: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false }, output: detailOutput },
    answerDraft: { input: { type: 'object', properties: { id: { type: 'string' }, revision: { type: 'integer', minimum: 0 }, answers: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, answer: { type: 'string' } }, required: ['id', 'answer'], additionalProperties: false } } }, required: ['id', 'revision', 'answers'], additionalProperties: false }, output: detailOutput },
    approveDraft: { input: { type: 'object', properties: { id: { type: 'string' }, revision: { type: 'integer', minimum: 0 }, planHash: { type: 'string' } }, required: ['id', 'revision', 'planHash'], additionalProperties: false }, output: detailOutput },
    listIntelligence: { input: { type: 'object', properties: {}, additionalProperties: false }, output: { type: 'object', properties: { directory: { type: 'string' }, source: { type: 'string' }, indexVersion: { type: 'number' }, entries: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, slug: { type: 'string' }, name: { type: 'string' }, creator: { type: 'string' }, score: { anyOf: [{ type: 'number' }, { type: 'null' }] } }, required: ['id','slug','name','creator','score'], additionalProperties: false } } }, required: ['directory','source','indexVersion','entries'], additionalProperties: false } },
    createDraft: { input: { type: 'object', properties: { requirement: { type: 'string' } }, required: ['requirement'], additionalProperties: false }, output: { type: 'object', properties: { directory: { type: 'string' }, run: runSummary }, required: ['directory', 'run'], additionalProperties: false } },
    listDrafts: { input: { type: 'object', properties: {}, additionalProperties: false }, output: { type: 'object', properties: { directory: { type: 'string' }, runs: { type: 'array', items: runSummary } }, required: ['directory', 'runs'], additionalProperties: false } },
    observedUsage: { input: { type: 'object', properties: { month: { type: 'string' }, timeZone: { type: 'string' } }, required: ['month', 'timeZone'], additionalProperties: false }, output: usageResponse },
    refreshPrices: { input: { type: 'object', properties: {}, additionalProperties: false }, output: { type: 'object', properties: {
      directory: { type: 'string' }, status: { type: 'string', enum: ['fresh', 'stale'] }, snapshot: { type: 'object', properties: {
        source: { type: 'string' }, checkedAt: { type: 'string' }, models: { type: 'array', items: { type: 'object', properties: {
          id: { type: 'string' }, inputPerMillionUsd: { anyOf: [{ type: 'string' }, { type: 'null' }] }, outputPerMillionUsd: { anyOf: [{ type: 'string' }, { type: 'null' }] },
          conditional: { type: 'boolean' }, dynamicRouter: { type: 'boolean' }, extraPriceFields: { type: 'array', items: { type: 'string' } }, usableForBudget: { type: 'boolean' },
        }, required: ['id', 'inputPerMillionUsd', 'outputPerMillionUsd', 'conditional', 'dynamicRouter', 'extraPriceFields', 'usableForBudget'], additionalProperties: false } },
      }, required: ['source', 'checkedAt', 'models'], additionalProperties: false },
    }, required: ['directory', 'status', 'snapshot'], additionalProperties: false } },
    getSelections: { input: { type: 'object', properties: {}, additionalProperties: false }, output: response },
    saveSelections: { input: { type: 'object', properties: { revision: { type: 'integer', minimum: 0 }, roles }, required: ['revision', 'roles'], additionalProperties: false }, output: response },
    listModels: {
      input: { type: 'object', properties: {}, additionalProperties: false },
      output: { type: 'object', properties: { directory: { type: 'string' }, models: { type: 'array', items: {
        type: 'object', properties: {
          providerID: { type: 'string' }, id: { type: 'string' }, name: { type: 'string' }, enabled: { type: 'boolean' }, status: { type: 'string' },
          variants: { type: 'array', items: { type: 'string' } },
          capabilities: { type: 'object', properties: { input: { type: 'array', items: { type: 'string' } }, output: { type: 'array', items: { type: 'string' } }, tools: { type: 'boolean' } }, required: ['input', 'output', 'tools'], additionalProperties: false },
          limit: { type: 'object', properties: { context: { type: 'number' }, output: { type: 'number' } }, required: ['context', 'output'], additionalProperties: false },
        }, required: ['providerID', 'id', 'name', 'enabled', 'status', 'variants', 'capabilities', 'limit'], additionalProperties: false,
      } } }, required: ['directory', 'models'], additionalProperties: false },
    },
  },
});

