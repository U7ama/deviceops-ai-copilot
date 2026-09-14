# DeviceOps edge collector

This workspace runs read-only LAN probes, sends normalized observations to DeviceOps using an outbound scoped collector credential, and executes only the two named recovery operations on explicitly enrolled HTTP simulator targets. The parent backend owns investigation, approval, authorization, incident state, and sustained recovery verification.

## Run locally

Prerequisites: Node 22.16.0, the root workspace dependencies (`npm ci`), and Linux `iputils-ping` for ICMP. Run the following commands from this workspace directory. For a Docker network, configure a fixed literal target IP in its allowlist; hostname targets are intentionally rejected to avoid DNS rebinding and accidental scope expansion.

1. Enroll collector devices through the authenticated DeviceOps v2 collector-enrollment API. Keep the returned token in `DEVICEOPS_COLLECTOR_TOKEN`. The returned device UUIDs are authoritative. Existing hosted simulator device IDs must not be re-enrolled into this collector.
2. Copy `edge.config.example.json` to `edge.config.json` and `simulator.config.example.json` to `simulator.config.json`. Replace the sample IDs in both with the corresponding newly enrolled backend UUIDs, and set the returned `collectorId`. Use matching IDs everywhere. `kind: "device"` in the standalone simulator represents the named telemetry service; the backend enrollment must use `kind: "service"` to expose automatic service recovery. A switch uses `kind: "switch"` in both.
3. Set `DEVICEOPS_URL` to the backend origin and `DEVICEOPS_COLLECTOR_TOKEN` to that collector's token. Remote connections require HTTPS. `allowInsecureHttp: true` is available for a trusted private Docker network; it is an explicit transport choice.
4. Supply a securely generated 32-byte key, encoded as canonical base64, through `DEVICEOPS_VAULT_KEY`. Store this key separately from the encrypted vault. Supply the chosen simulator bearer token through `DEVICEOPS_CREDENTIAL_VALUE`, then run `npm start -- vault-set simulator`. Remove `DEVICEOPS_CREDENTIAL_VALUE` from the parent shell afterward. The CLI never accepts secret values as arguments or prints them.
5. In a separate shell, set `DEVICEOPS_SIMULATOR_TOKEN` to that same simulator token and set a distinct `DEVICEOPS_SIMULATOR_ADMIN_TOKEN`. Start the simulator with `npm run simulator`. It binds to loopback on port 4410 by default. Set `DEVICEOPS_SIMULATOR_BIND` explicitly only when exposing it inside the controlled Docker network.
6. Start the edge with `npm start -- run`, or perform one durable poll/flush cycle with `npm start -- once`.

The simulator is separate from the backend's built-in hosted scenarios. It allows an actual HTTP transport demonstration without hardware. Its authenticated admin-only `POST /faults/{deviceId}` accepts `{ "fault": "offline" }`, `service_hang`, `authentication_failure`, `recovery_failure`, or `none`. Use the admin token, not the collector's simulator credential. Resetting a fault does not erase the command journal.

The collector token belongs only to core API requests. Device/simulator credentials remain in the local encrypted vault. The simulator token cannot inject faults, and the admin token cannot be used as a normal device credential.

## Configuration and commands

- `DEVICEOPS_EDGE_CONFIG`: config path; default `edge.config.json`.
- `DEVICEOPS_EDGE_DATA`: state directory; default `.data`.
- `DEVICEOPS_SIMULATOR_CONFIG`: simulator inventory path; default `simulator.config.json`.
- `DEVICEOPS_SIMULATOR_DATA`: simulator state directory; default `.data/simulator`.
- `PORT`: standalone simulator port; default `4410`.
- `npm start -- discover 192.168.1.0/24`: ICMP candidates only, entirely within `allowedTargets`, at most 256 addresses and four concurrent probes. Results require review/enrollment; the command does not create inventory. No guessed credentials, automatic enrollment, or intrusive fingerprinting.
- `npm start -- vault-set REF`: create/replace a secret from `DEVICEOPS_CREDENTIAL_VALUE` and clear its authentication pause.
- `npm start -- vault-revoke REF`: remove its encrypted secret and pause related adapters.
- `npm start -- resume-credential REF`: explicitly re-enable a paused credential after the problem has been corrected.

Stop the collector before vault administration. A process lock prevents two collector processes from sharing the same state and executing the same command. A stale lock is recovered only after proving its recorded process no longer exists; malformed locks require operator inspection. Keep one state directory per collector identity.

Supported connector IDs:

| ID | Configuration and tested boundary |
|---|---|
| `ping` | Literal IPv4, Linux ICMP; no device-health inference |
| `snmp-v2c` | `credentialRef` for community, optional UDP `port` (161); standard description/uptime/name GET |
| `snmp-switch-ports` | Same credentials plus 1–32 explicit `interfaceIndexes`; read-only IF-MIB GET |
| `pjlink` | Optional vault password, TCP `port` (4352); Class 1 POWR/ERST/LAMP/INPT reads |
| `simulator-http` | Explicit `sourceMode: "simulated"`, local token, port 4410; fixed health/actions/reconciliation paths |

Every target has an explicit `sourceMode: "live" | "simulated"`. Tag hardware as live even when developing against it. Source mode does not enable write methods on physical adapters. The 57-entry public catalog is exported by `@deviceops/connectors`; 12 catalog adapters are implemented with mock/protocol fixture coverage (Extron, Axis, Sony, NETIO, Barco, Biamp, Crestron, Zoom, ping, snmp-v2c, snmp-switch-ports, pjlink) and 45 are planned. Physical hardware compatibility remains unverified. The additional HTTP simulator adapter is excluded from the 57 count.

## Durability and errors

Observations include timestamp, source, reachability, device health, authentication, and bounded scalar metrics. Nested interface readings become paths such as `ports.1.index` and `ports.1.operStatus`. Strings are capped at 400 characters and metric keys at 80. Unsupported readings remain absent/null rather than being fabricated.

Polling defaults to 30 seconds, a 3-second timeout, and four concurrent devices. Exponential transport backoff has jitter and a five-minute base cap. Credential-sharing probes are serialized; the first explicit authentication rejection persistently pauses every adapter using that reference. SNMPv2c may silently discard a wrong community: its timeout is reported as unknown authentication/reachability rather than claiming a bad credential or offline device.

A local fsynced JSON journal stores up to 10,000 queued observations and 10,000 command records. Oldest observations are dropped at the queue limit, with a persisted counter. Samples older than the backend's 24-hour acceptance window are dropped before flushing so they do not block new telemetry. The overall state file is capped at 32 MiB. A full command history fails closed and must be archived while the collector is stopped. Command records are never automatically evicted.

The edge records command intent before making a request. Recovery names are `restart_switch` and `restart_service`; both accept exactly `{}` arguments. `restart_service` means the simulator's named telemetry service. A crash in a prepared command triggers read-only reconciliation on restart without requiring backend redelivery. Unknown execution outcomes are reported as unknown and are not automatically repeated. The simulator also journals command IDs, rejects an ID reused for a different operation, and returns a persisted result for a duplicate. Backend command acknowledgments still require independent fresh observations for incident resolution.

Core API response failures preserve queued data. A lost acknowledgment may resend the same observation timestamps; the backend deduplicates by enrolled device, source, and timestamp. Authentication, parser, transport, unsupported capability, and unhealthy application outcomes stay distinct. Diagnostic logs use fixed event names and omit raw exception/credential text.

## Verification and limitations

Run from the repository root:

```sh
npm run typecheck --workspace @deviceops/connectors
npm run typecheck --workspace @deviceops/edge
node node_modules/vitest/vitest.mjs run packages/connectors/src/connectors.test.ts apps/edge/src/edge.test.ts
```

Tests use local ICMP, TCP PJLink fixtures (challenge, rejected password, deadline), UDP SNMP fixtures (system/ports and dropped bad community), vault integrity/permissions, outbound ingestion, offline spool recovery, credential pauses, crash reconciliation, and simulator command idempotency. Tests require local socket/ICMP permission. Actual physical devices and vendor cloud services have not been tested. SNMPv2c and PJLink are unencrypted protocols intended here for a controlled lab; vault encryption does not change their transport. SNMPv3, automatic topology discovery, IPv6, vendor cloud connectors, and real-device actuation remain future work.

Upstream protocol references: [net-snmp](https://github.com/markabrahams/node-net-snmp), [IF-MIB](https://www.rfc-editor.org/rfc/rfc2863), [PJLink](https://pjlink.jbmia.or.jp/english/dl.html), [iputils](https://github.com/iputils/iputils).
