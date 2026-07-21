import type { AtomicCommandResult } from "../../../domain/atomicCommand";

export interface AtomicCommandInput {
  readonly commandId: string;
  readonly recordId: string;
  readonly value: string;
}

export interface AtomicCommandInputPort {
  execute(input: AtomicCommandInput): Promise<AtomicCommandResult>;
}

export type { AtomicCommandResult };
