import type { Role } from "@deviceops/contracts";
import { MockAiProvider } from "@deviceops/ai";

export const TEST_TENANT_ALPHA_ID = "00000000-0000-4000-8000-000000000001";
export const TEST_TENANT_BETA_ID = "00000000-0000-4000-8000-000000000002";

export const TEST_USERS = {
  adminAlpha: {
    id: "10000000-0000-4000-8000-000000000001",
    email: "admin@alpha.test",
    displayName: "Alpha Admin",
    tenantId: TEST_TENANT_ALPHA_ID,
    role: "admin" as Role
  },
  managerAlpha: {
    id: "10000000-0000-4000-8000-000000000002",
    email: "manager@alpha.test",
    displayName: "Alpha Manager",
    tenantId: TEST_TENANT_ALPHA_ID,
    role: "manager" as Role
  },
  techAlpha: {
    id: "10000000-0000-4000-8000-000000000003",
    email: "tech@alpha.test",
    displayName: "Alpha Tech",
    tenantId: TEST_TENANT_ALPHA_ID,
    role: "technician" as Role
  },
  techBeta: {
    id: "10000000-0000-4000-8000-000000000004",
    email: "tech@beta.test",
    displayName: "Beta Tech",
    tenantId: TEST_TENANT_BETA_ID,
    role: "technician" as Role
  }
};

export const TEST_ROOMS = {
  room101: {
    id: "20000000-0000-4000-8000-000000000001",
    tenantId: TEST_TENANT_ALPHA_ID,
    name: "Conference Room 101",
    location: "Building A, Floor 1"
  },
  room202: {
    id: "20000000-0000-4000-8000-000000000002",
    tenantId: TEST_TENANT_ALPHA_ID,
    name: "Boardroom 202",
    location: "Building A, Floor 2"
  },
  betaLab: {
    id: "20000000-0000-4000-8000-000000000003",
    tenantId: TEST_TENANT_BETA_ID,
    name: "Synthetic Device Lab",
    location: "Beta Campus"
  }
};

export const TEST_DEVICES = {
  display101: {
    id: "30000000-0000-4000-8000-000000000001",
    tenantId: TEST_TENANT_ALPHA_ID,
    roomId: TEST_ROOMS.room101.id,
    name: "Main Wall Display",
    manufacturer: "Acme Display",
    model: "ProView-85",
    kind: "display"
  },
  audio202: {
    id: "30000000-0000-4000-8000-000000000002",
    tenantId: TEST_TENANT_ALPHA_ID,
    roomId: TEST_ROOMS.room202.id,
    name: "DSP Processor",
    manufacturer: "SoundCore",
    model: "DSP-128",
    kind: "audio"
  },
  betaDisplay: {
    id: "30000000-0000-4000-8000-000000000003",
    tenantId: TEST_TENANT_BETA_ID,
    roomId: TEST_ROOMS.betaLab.id,
    name: "Beta Test Display",
    manufacturer: "Fictional Devices",
    model: "SafeView-55",
    kind: "display"
  }
};

export class FakeClock {
  private currentMs: number;

  constructor(initialIso: string = "2026-08-10T12:00:00.000Z") {
    this.currentMs = new Date(initialIso).getTime();
  }

  public now(): Date {
    return new Date(this.currentMs);
  }

  public iso(): string {
    return this.now().toISOString();
  }

  public advanceSeconds(seconds: number): void {
    this.currentMs += seconds * 1000;
  }

  public advanceMinutes(minutes: number): void {
    this.advanceSeconds(minutes * 60);
  }
}

export class FailureInjectors {
  public static simulateStatusTimeout(): never {
    throw new Error("DeviceStatusTimeoutError: Device status tool timed out after 5000ms");
  }

  public static simulateScannerFailure(): never {
    throw new Error("ClamAVScannerError: clamd socket connection refused");
  }

  public static simulateDatabaseFailure(): never {
    throw new Error("PostgresError: connection pool exhausted (fail-closed)");
  }
}

export function createMockTestAiProvider() {
  return new MockAiProvider();
}
