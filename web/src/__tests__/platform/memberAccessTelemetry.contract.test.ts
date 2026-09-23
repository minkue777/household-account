import type { ClientStartupDiagnostics } from '@/platform/functions-api/clientStartupDiagnosticsContract';

jest.mock('@/composition/clientSessionScope', () => ({ getClientSessionScope: jest.fn(() => ({ accessMode: 'member' })) }));
jest.mock('@/platform/android-host/androidHostBridge', () => ({ isAndroidHostAvailable: jest.fn(() => false) }));
jest.mock('@/platform/performance/clientStartupObservation', () => ({ readCapturedClientStartupObservation: jest.fn() }));
jest.mock('@/features/access-household/application/householdCommands', () => ({ householdCommands: { recordAppVisit: jest.fn(async () => ({})) } }));

describe('member access startup diagnostics forwarding', () => {
  const diagnostics: ClientStartupDiagnostics = { version: 1, initialVisibility: 'visible', visibilityTrackingStartedAtMs: 100,
    hiddenMs: 0, hiddenCount: 0, timingsMs: { bootstrapStarted: 100, firstHomeCompletePaint: 500 } };
  beforeEach(() => jest.resetModules());

  function dependencies() {
    return {
      observation: require('@/platform/performance/clientStartupObservation') as typeof import('@/platform/performance/clientStartupObservation'),
      commands: require('@/features/access-household/application/householdCommands').householdCommands as typeof import('@/features/access-household/application/householdCommands').householdCommands,
      telemetry: require('@/platform/usage/memberAccessTelemetry') as typeof import('@/platform/usage/memberAccessTelemetry'),
    };
  }

  it('iPhone 전체 paint에서 동결한 진단을 문서당 같은 visit으로 한 번만 전송한다', async () => {
    const { observation, commands, telemetry } = dependencies();
    jest.mocked(observation.readCapturedClientStartupObservation).mockResolvedValue({ platform: 'ios-pwa', durationMs: 500, diagnostics });
    const first = telemetry.recordCurrentAppVisit();
    expect(telemetry.recordCurrentAppVisit()).toBe(first);
    await first;
    expect(commands.recordAppVisit).toHaveBeenCalledTimes(1);
    expect(commands.recordAppVisit).toHaveBeenCalledWith(expect.objectContaining({
      visitId: expect.stringMatching(/^app-visit-/), clientStartupDurationMs: 500, clientStartupDiagnostics: diagnostics,
    }));
  });

  it('Android 총시간은 유지하고 iPhone 전용 상세 진단은 보내지 않는다', async () => {
    const { observation, commands, telemetry } = dependencies();
    jest.mocked(observation.readCapturedClientStartupObservation).mockResolvedValue({ platform: 'android', durationMs: 700, diagnostics });
    await telemetry.recordCurrentAppVisit();
    expect(commands.recordAppVisit).toHaveBeenCalledWith(expect.objectContaining({ clientStartupDurationMs: 700 }));
    expect(jest.mocked(commands.recordAppVisit).mock.calls[0][0]).not.toHaveProperty('clientStartupDiagnostics');
  });

  it('실패한 통계는 사용자 오류로 전파하거나 재전송하지 않는다', async () => {
    const { observation, commands, telemetry } = dependencies();
    jest.mocked(observation.readCapturedClientStartupObservation).mockResolvedValue(undefined);
    jest.mocked(commands.recordAppVisit).mockRejectedValue(new Error('offline'));
    await expect(telemetry.recordCurrentAppVisit()).resolves.toBeUndefined();
    await expect(telemetry.recordCurrentAppVisit()).resolves.toBeUndefined();
    expect(commands.recordAppVisit).toHaveBeenCalledTimes(1);
    expect(jest.mocked(commands.recordAppVisit).mock.calls[0][0]).not.toHaveProperty('clientStartupDiagnostics');
  });
});
