/**
 * Server-side launch policy for Agent sessions.
 *
 * The policy is read from the environment of the process that spawns the Agent (worker or
 * desktop main), never from a launch payload, so an API caller cannot widen it.
 */

export const AGENT_FULL_ACCESS_POLICY_ENV = 'OPENCOVE_AGENT_FULL_ACCESS'
export const ALLOW_LAUNCH_OVERRIDES_ENV = 'OPENCOVE_ALLOW_LAUNCH_OVERRIDES'

/**
 * - `deny`: never start an Agent with its permission-bypass flags.
 * - `setting`: the user's `agentFullAccess` setting decides; a launch request may only turn it off.
 * - `allow`: a launch request may turn it on or off; the setting is the fallback.
 */
export type AgentFullAccessPolicy = 'deny' | 'setting' | 'allow'

type PolicyEnvironment = Readonly<Record<string, string | undefined>>

export function resolveAgentFullAccessPolicy(env: PolicyEnvironment): AgentFullAccessPolicy {
  const raw = env[AGENT_FULL_ACCESS_POLICY_ENV]?.trim().toLowerCase() ?? ''
  if (raw.length === 0 || raw === 'setting') {
    return 'setting'
  }
  if (raw === 'allow') {
    return 'allow'
  }
  // `deny` and any value we do not understand fail closed.
  return 'deny'
}

export function resolveEffectiveAgentFullAccess(input: {
  policy: AgentFullAccessPolicy
  setting: boolean
  requested: boolean | null | undefined
}): boolean {
  switch (input.policy) {
    case 'deny':
      return false
    case 'allow':
      return input.requested ?? input.setting
    case 'setting':
    default:
      return input.setting && input.requested !== false
  }
}

export function areLaunchOverridesAllowed(env: PolicyEnvironment): boolean {
  const raw = env[ALLOW_LAUNCH_OVERRIDES_ENV]?.trim().toLowerCase() ?? ''
  return raw === '1' || raw === 'true'
}
