export interface AndroidScopeEvent {
  before?: string;
  after?: string;
  pull_request?: { base?: { sha?: string }; head?: { sha?: string } };
}

export function affectsAndroidRuntime(path: string): boolean;
export function androidInstrumentationScope(
  eventName: string,
  event: AndroidScopeEvent,
  git?: (args: string[]) => string
): { required: boolean; reason: string };
