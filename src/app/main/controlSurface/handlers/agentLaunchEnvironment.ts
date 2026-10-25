import type { AgentProviderId } from '../../../../shared/contracts/dto'

interface OpenCodeServerBinding {
  readonly hostname: string
  readonly port: number
}

export async function prepareAgentSessionEnvironment(options: {
  provider: AgentProviderId
  opencodeServer: OpenCodeServerBinding | null
  userDataPath: string
}): Promise<NodeJS.ProcessEnv> {
  if (options.provider !== 'opencode' || !options.opencodeServer) {
    return {}
  }
  // OPENCODE_TUI_CONFIG comes from the OpenCode launch plan (a per-launch temp file).
  return {
    OPENCOVE_OPENCODE_SERVER_HOSTNAME: options.opencodeServer.hostname,
    OPENCOVE_OPENCODE_SERVER_PORT: String(options.opencodeServer.port),
    XDG_STATE_HOME: options.userDataPath.trim() || process.cwd(),
  }
}

export function mergeAgentLaunchEnvironment(options: {
  providerEnvironment: Readonly<NodeJS.ProcessEnv>
  requestedEnvironment?: NodeJS.ProcessEnv | null
  sessionEnvironment: NodeJS.ProcessEnv
  testEnvironment?: NodeJS.ProcessEnv
}): NodeJS.ProcessEnv {
  return {
    ...(options.testEnvironment ?? {}),
    ...options.sessionEnvironment,
    ...(options.requestedEnvironment ?? {}),
    ...options.providerEnvironment,
  }
}
