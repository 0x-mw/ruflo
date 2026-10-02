/**
 * ADR-406 §19.7 — MCP adapter for the mission semantic operations.
 *
 * A thin transport: input goes to the same `MissionService` (and the same zod
 * schemas) the CLI uses, unchanged. Policy authorization of the tool call
 * itself happens in `mcp-client.ts` before any handler runs; nothing here
 * accepts an approval, principal or permission flag from input.
 */

import type { MCPTool } from './types.js';
import { getProjectCwd } from './types.js';
import { MissionService, type MissionResult } from '../missions/service.js';

/** The operations an adapter needs; London-school tests substitute it. */
export interface MissionPort {
  create(raw: unknown): Promise<MissionResult<unknown>>;
  plan(raw: unknown): Promise<MissionResult<unknown>>;
  get(raw: unknown): Promise<MissionResult<unknown>>;
  events(raw: unknown): Promise<MissionResult<unknown>>;
  requestAction(raw: unknown): Promise<MissionResult<unknown>>;
}

export type MissionPortFactory = (projectRoot: string) => MissionPort;

const defaultFactory: MissionPortFactory = (projectRoot) => new MissionService({ projectRoot, channel: 'mcp' });

function rootOf(context?: Record<string, unknown>): string {
  return typeof context?.projectRoot === 'string' ? context.projectRoot : getProjectCwd();
}

const MISSION_ID = { type: 'string', pattern: '^msn_[a-f0-9]{24}$', description: 'Mission id' };
const REQUEST_ID = { type: 'string', maxLength: 128, description: 'Caller-chosen idempotency key; reuse only to retry the same request' };
const EXPECTED_REVISION = { type: 'integer', minimum: 1, description: 'Mission revision the request was prepared against' };

export function createMissionTools(factory: MissionPortFactory = defaultFactory): MCPTool[] {
  const call = (op: keyof MissionPort) => async (input: Record<string, unknown>, context?: Record<string, unknown>) =>
    factory(rootOf(context))[op](input);
  return [
    {
      name: 'mission_create',
      description: 'Create a mission (objective only; draft state). Idempotent per requestId. Recording a mission does not execute anything.',
      category: 'mission',
      inputSchema: { type: 'object', properties: { requestId: REQUEST_ID, objective: { type: 'string', maxLength: 2000 } }, required: ['requestId', 'objective'] },
      handler: call('create'),
    },
    {
      name: 'mission_plan',
      description: 'Submit or revise a mission plan (task graph, acceptance criteria, budget). Requires expectedRevision; a stale revision returns a conflict with the current one. Revising invalidates prior authorization.',
      category: 'mission',
      inputSchema: {
        type: 'object',
        properties: { requestId: REQUEST_ID, missionId: MISSION_ID, expectedRevision: EXPECTED_REVISION, plan: { type: 'object', description: '{ tasks[], acceptance[], budget{currency, ceilingMinor}, scope }' } },
        required: ['requestId', 'missionId', 'expectedRevision', 'plan'],
      },
      handler: call('plan'),
    },
    {
      name: 'mission_get',
      description: 'Read one mission (record, plan, budget, tasks, evidence, executor observation) or list missions. Read only; task status is recorded state, only evidence.verified is verified.',
      category: 'mission',
      inputSchema: { type: 'object', properties: { missionId: MISSION_ID } },
      handler: call('get'),
    },
    {
      name: 'mission_events',
      description: 'Mission events after a cursor (afterSequence). Delivery may repeat: deduplicate by (missionId, seq). gap=true means reload with mission_get before replaying.',
      category: 'mission',
      inputSchema: {
        type: 'object',
        properties: { missionId: MISSION_ID, afterSequence: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 500 } },
        required: ['missionId'],
      },
      handler: call('events'),
    },
    {
      name: 'mission_request_action',
      description: 'Request a scoped control action: requestAuthorization, pause, cancel (admit/resume report executor-unavailable until a durable executor is admitted). A request is not authorization; the runtime decides.',
      category: 'mission',
      inputSchema: {
        type: 'object',
        properties: {
          requestId: REQUEST_ID, missionId: MISSION_ID, expectedRevision: EXPECTED_REVISION,
          action: { type: 'string', enum: ['requestAuthorization', 'pause', 'cancel', 'admit', 'resume'] },
          reason: { type: 'string', maxLength: 500 },
        },
        required: ['requestId', 'missionId', 'expectedRevision', 'action'],
      },
      handler: call('requestAction'),
    },
  ];
}

export const missionTools: MCPTool[] = createMissionTools();
