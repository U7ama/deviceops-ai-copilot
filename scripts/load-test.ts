import { MockAiProvider, type DiagnosisRequest } from "@deviceops/ai";
import { executeHybridSearch } from "@deviceops/retrieval";
import { TEST_USERS, TEST_ROOMS, TEST_DEVICES } from "@deviceops/testkit";

async function runLoadTest() {
  console.log("[load:test] Running provider microbenchmark.");

  const iterations = 20;
  const latencies: number[] = [];

  const provider = new MockAiProvider();

  for (let i = 0; i < iterations; i++) {
    const start = performance.now();

    const docs = await executeHybridSearch({
      query: "troubleshoot power cable seating",
      tenantId: "00000000-0000-4000-8000-000000000001",
      topK: 5
    });

    const request: DiagnosisRequest = {
      actor: TEST_USERS.techAlpha,
      run: {
        id: "50000000-0000-4000-8000-000000000001",
        tenantId: "00000000-0000-4000-8000-000000000001",
        roomId: TEST_ROOMS.room101.id,
        deviceId: TEST_DEVICES.display101.id
      },
      question: "troubleshoot power cable seating",
      limits: { maxTurns: 6, maxToolCalls: 4, maxCostUsd: 0.1 },
      searchManual: async () => docs,
      getDeviceStatus: async () => ({
        deviceId: TEST_DEVICES.display101.id,
        online: true,
        powerState: "on",
        temperatureC: 45,
        input: "HDMI-1",
        firmwareVersion: "v1.0",
        observedAt: new Date().toISOString(),
        simulated: true
      })
    };

    await provider.diagnose(request);

    const elapsed = performance.now() - start;
    latencies.push(elapsed);
  }

  latencies.sort((a, b) => a - b);
  const p50 = latencies[Math.floor(latencies.length * 0.50)];
  const p95 = latencies[Math.floor(latencies.length * 0.95)];

  console.log("\n================ LOAD TEST LATENCY REPORT ================");
  console.log(`Samples: ${iterations}`);
  console.log(`p50 Latency: ${p50.toFixed(2)} ms`);
  console.log(`p95 Latency: ${p95.toFixed(2)} ms (reference benchmark)`);
  console.log("==========================================================");

  if (p95 > 2000) {
    console.error("[load:test] Load test failed p95 latency target!");
    process.exit(1);
  }

  console.log("[load:test] Load test PASSED latency targets.");
}

runLoadTest().catch((err) => {
  console.error("[load:test] Load test error:", err);
  process.exit(1);
});
