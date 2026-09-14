import type { Role } from "@deviceops/contracts";
import { MockAiProvider } from "@deviceops/ai";

export const TEST_TENANT_ALPHA_ID = "00000000-0000-4000-8000-000000000001";
export const TEST_TENANT_BETA_ID = "00000000-0000-4000-8000-000000000002";

export const TEST_USERS = {
  adminAlpha: {
    id: "10000000-0000-4000-8000-000000000001",
    email: "hashim@deviceops.cloud",
    displayName: "Hashim Khan",
    tenantId: TEST_TENANT_ALPHA_ID,
    role: "admin" as Role
  },
  managerAlpha: {
    id: "10000000-0000-4000-8000-000000000002",
    email: "usamaaslam8726@gmail.com",
    displayName: "Usama Aslam",
    tenantId: TEST_TENANT_ALPHA_ID,
    role: "manager" as Role
  },
  techAlpha: {
    id: "10000000-0000-4000-8000-000000000003",
    email: "tariq@deviceops.cloud",
    displayName: "Tariq Mehmood",
    tenantId: TEST_TENANT_ALPHA_ID,
    role: "technician" as Role
  },
  techBeta: {
    id: "10000000-0000-4000-8000-000000000004",
    email: "bilal@deviceops.cloud",
    displayName: "Bilal Ahmed",
    tenantId: TEST_TENANT_BETA_ID,
    role: "technician" as Role
  }
};

export const TEST_ROOMS = {
  room101: {
    id: "20000000-0000-4000-8000-000000000001",
    tenantId: TEST_TENANT_ALPHA_ID,
    name: "Executive Boardroom 101",
    location: "Tower Alpha, Floor 4"
  },
  room202: {
    id: "20000000-0000-4000-8000-000000000002",
    tenantId: TEST_TENANT_ALPHA_ID,
    name: "NOC Operations Suite 202",
    location: "Core DC, Suite 2"
  },
  betaLab: {
    id: "20000000-0000-4000-8000-000000000003",
    tenantId: TEST_TENANT_BETA_ID,
    name: "Regional Operations Lab",
    location: "Tech Park Campus"
  }
};

export const TEST_DEVICES = {
  display101: {
    id: "30000000-0000-4000-8000-000000000001",
    tenantId: TEST_TENANT_ALPHA_ID,
    roomId: TEST_ROOMS.room101.id,
    name: "Executive Boardroom Display",
    manufacturer: "Sony Professional",
    model: "BRAVIA FW-85BZ40H",
    kind: "display"
  },
  audio202: {
    id: "30000000-0000-4000-8000-000000000002",
    tenantId: TEST_TENANT_ALPHA_ID,
    roomId: TEST_ROOMS.room202.id,
    name: "DSP Conference Processor",
    manufacturer: "Biamp Systems",
    model: "TesiraFORTE AVB CI",
    kind: "audio"
  },
  betaDisplay: {
    id: "30000000-0000-4000-8000-000000000003",
    tenantId: TEST_TENANT_BETA_ID,
    roomId: TEST_ROOMS.betaLab.id,
    name: "Regional Staging Display",
    manufacturer: "Sony Professional",
    model: "BRAVIA FW-55BZ35F",
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
