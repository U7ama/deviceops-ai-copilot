import autocannon from 'autocannon';

const url = process.env.LOAD_URL ?? 'http://127.0.0.1:3000/healthz';
const connections = Number(process.env.LOAD_CONNECTIONS ?? 10);
const duration = Number(process.env.LOAD_DURATION_SECONDS ?? 5);

const result = await new Promise((resolve, reject) => {
  const instance = autocannon({ url, connections, duration, pipelining: 1 });
  instance.on('error', reject);
  instance.on('done', resolve);
});

const errors = result.errors + result.timeouts;
console.log(JSON.stringify({
  target: url,
  mode: 'local-http-only',
  connections,
  durationSeconds: duration,
  requests: result.requests.total,
  throughputBytes: result.throughput.total,
  errors,
  latencyMs: {
    p50: result.latency.p50,
    p95: result.latency.p95,
    p99: result.latency.p99
  },
  note: 'This measures the local HTTP process only. It is not cloud capacity or production-scale evidence.'
}, null, 2));

if (errors > 0 || result.non2xx > 0) {
  process.exitCode = 1;
}
