export * from "./types.js";
export * from "./scope.js";
export * from "./catalog.js";
export * from "./vault.js";
export * from "./http.js";
export * from "./pjlink.js";
export * from "./snmp.js";
export * from "./ping.js";
import { pingConnector } from "./ping.js";
import { pjlinkConnector } from "./pjlink.js";
import { snmpConnector, snmpSwitchConnector } from "./snmp.js";
import { simulatorConnector } from "./http.js";
import type { Connector, ConnectorId } from "./types.js";
export const connectors: Readonly<Record<ConnectorId, Connector>> = {
  ping: pingConnector, "snmp-v2c": snmpConnector, "snmp-switch-ports": snmpSwitchConnector, pjlink: pjlinkConnector, "simulator-http": simulatorConnector,
};
