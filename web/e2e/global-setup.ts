import { createTestAccount, resetEmulatorState } from './emulator';

export default async function globalSetup(): Promise<void> {
  await resetEmulatorState();
  await createTestAccount();
}

