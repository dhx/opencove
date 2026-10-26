import type {
  AgentLaunchPlan,
  AgentProviderDescriptor,
  AgentProviderDetector,
  CreateAgentLaunchPlanCommand,
} from '../../../application/ports/AgentProviderContribution'
import {
  buildAgentLaunchCommand,
  type BuiltinAgentCommandProviderId,
} from '../../cli/AgentCommandFactory'
import { TerminalCliAgentProviderContribution } from '../terminal-cli/TerminalCliContribution'
import { createOpenCodeEmbeddedTuiConfig } from '../../opencode/OpenCodeTuiConfig'

export class CatalogTerminalCliProvider extends TerminalCliAgentProviderContribution {
  readonly descriptor: AgentProviderDescriptor & { readonly id: BuiltinAgentCommandProviderId }

  constructor(
    descriptor: AgentProviderDescriptor & { readonly id: BuiltinAgentCommandProviderId },
    options: { readonly detector?: AgentProviderDetector } = {},
  ) {
    super(descriptor.id, descriptor.launch.executable, options)
    this.descriptor = descriptor
  }

  protected override async createTerminalLaunchPlan(
    command: CreateAgentLaunchPlanCommand,
  ): Promise<AgentLaunchPlan> {
    const plan = buildAgentLaunchCommand({
      provider: this.descriptor.id,
      mode: command.mode,
      prompt: command.prompt,
      model: command.model,
      resumeSessionId: command.resumeSessionId,
      agentFullAccess: command.agentFullAccess,
      opencodeServer: command.opencodeServer,
    })
    if (this.descriptor.id === 'opencode' && !process.env.OPENCODE_TUI_CONFIG?.trim()) {
      const tuiConfig = command.artifacts.track(
        'opencode-tui-config',
        await createOpenCodeEmbeddedTuiConfig(),
      )
      return { ...plan, env: { OPENCODE_TUI_CONFIG: tuiConfig.path } }
    }
    return { ...plan, env: {} }
  }
}
