import type { AgentModelOption } from '@shared/contracts/dto'

// The built-in Gemini CLI model list. This build does not fetch Gemini CLI's settings schema from
// GitHub to refresh it; the CLI itself accepts any model id the user types.
const GEMINI_CLI_FALLBACK_MODELS: AgentModelOption[] = [
  {
    id: 'auto',
    displayName: 'auto',
    description: 'Gemini CLI model alias',
    isDefault: true,
  },
  {
    id: 'pro',
    displayName: 'pro',
    description: 'Gemini CLI model alias',
    isDefault: false,
  },
  {
    id: 'flash',
    displayName: 'flash',
    description: 'Gemini CLI model alias',
    isDefault: false,
  },
  {
    id: 'flash-lite',
    displayName: 'flash-lite',
    description: 'Gemini CLI model alias',
    isDefault: false,
  },
  {
    id: 'auto-gemini-3',
    displayName: 'auto-gemini-3',
    description: 'Gemini CLI model',
    isDefault: false,
  },
  {
    id: 'auto-gemini-2.5',
    displayName: 'auto-gemini-2.5',
    description: 'Gemini CLI model',
    isDefault: false,
  },
  {
    id: 'gemini-3.1-pro-preview',
    displayName: 'gemini-3.1-pro-preview',
    description: 'Gemini CLI model',
    isDefault: false,
  },
  {
    id: 'gemini-3-pro-preview',
    displayName: 'gemini-3-pro-preview',
    description: 'Gemini CLI model',
    isDefault: false,
  },
  {
    id: 'gemini-3-flash-preview',
    displayName: 'gemini-3-flash-preview',
    description: 'Gemini CLI model',
    isDefault: false,
  },
  {
    id: 'gemini-2.5-pro',
    displayName: 'gemini-2.5-pro',
    description: 'Gemini CLI model',
    isDefault: false,
  },
  {
    id: 'gemini-2.5-flash',
    displayName: 'gemini-2.5-flash',
    description: 'Gemini CLI model',
    isDefault: false,
  },
  {
    id: 'gemini-2.5-flash-lite',
    displayName: 'gemini-2.5-flash-lite',
    description: 'Gemini CLI model',
    isDefault: false,
  },
]

export function listGeminiCliFallbackModels(): AgentModelOption[] {
  return GEMINI_CLI_FALLBACK_MODELS.map(model => ({ ...model }))
}
