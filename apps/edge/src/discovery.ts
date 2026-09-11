import { connectors, expandDiscoveryTargets, failedSample, type ConnectorContext, type ConnectorId, type EnrolledTarget, type Observation, type SourceMode } from "@deviceops/connectors";
export interface DiscoveryCandidate { address: string; status: "candidate"; enrollmentRequired: true; observation: Observation }
/** Discovery returns review candidates only. It never inserts devices or changes enrollment. */
export async function discoverTargets(entries: string[], context: ConnectorContext, options: { connectorId?: ConnectorId; sourceMode?: SourceMode; port?: number; interfaceIndexes?: number[] } = {}): Promise<{ scanned: number; candidates: DiscoveryCandidate[]; noResponse: number }> {
  const addresses = expandDiscoveryTargets(entries, context.allowedTargets);
  const connectorId = options.connectorId ?? "ping", sourceMode = options.sourceMode ?? "live";
  if (!Object.hasOwn(connectors, connectorId)) throw new Error("Discovery connector is not implemented");
  if (connectorId !== "ping" && !context.credential) throw new Error("Configure a credential for identification; discovery never guesses credentials");
  // Simulator identities require enrollment IDs and therefore cannot be guessed during subnet discovery.
  if (connectorId === "simulator-http") throw new Error("Use explicit simulator inventory enrollment");
  let cursor = 0, authPaused = false;
  const candidates: DiscoveryCandidate[] = [];
  // Credential-bearing discovery is serial so rejected credentials are not retried against every candidate.
  await Promise.all(Array.from({ length: context.credential ? 1 : 4 }, async () => {
    while (cursor < addresses.length && !authPaused) {
      const address = addresses[cursor++]!;
      const target: EnrolledTarget = { deviceId: `candidate-${address}`, connectorId, sourceMode, address,
        ...(options.port ? { port: options.port } : {}), ...(options.interfaceIndexes ? { interfaceIndexes: options.interfaceIndexes } : {}) };
      let observation: Observation;
      try { observation = await connectors[connectorId].read(target, context); } catch (error) { observation = failedSample(target, error); }
      if (observation.auth === "failed") authPaused = true;
      if (observation.reachability === "reachable") candidates.push({ address, status: "candidate", enrollmentRequired: true, observation });
    }
  }));
  return { scanned: cursor, candidates: candidates.sort((left, right) => left.address.localeCompare(right.address)), noResponse: cursor - candidates.length };
}
