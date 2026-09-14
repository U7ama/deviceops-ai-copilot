export * from "./types.js";
export * from "./scope.js";
export * from "./catalog.js";
export * from "./vault.js";
export * from "./http.js";
export * from "./pjlink.js";
export * from "./snmp.js";
export * from "./ping.js";
export * from "./extron.js";
export * from "./axis.js";
export * from "./sony.js";
export * from "./netio.js";
export * from "./barco.js";
export * from "./biamp.js";
export * from "./crestron-nvx.js";
export * from "./zoom.js";

import { pingConnector } from "./ping.js";
import { pjlinkConnector } from "./pjlink.js";
import { snmpConnector, snmpSwitchConnector } from "./snmp.js";
import { simulatorConnector } from "./http.js";
import { extronConnector } from "./extron.js";
import { axisConnector } from "./axis.js";
import { sonyConnector } from "./sony.js";
import { netioConnector } from "./netio.js";
import { barcoConnector } from "./barco.js";
import { biampConnector } from "./biamp.js";
import { crestronNvxConnector } from "./crestron-nvx.js";
import { zoomConnector } from "./zoom.js";
import type { Connector, ConnectorId } from "./types.js";

export const connectors: Readonly<Record<ConnectorId, Connector>> = {
  ping: pingConnector,
  "snmp-v2c": snmpConnector,
  "snmp-switch-ports": snmpSwitchConnector,
  pjlink: pjlinkConnector,
  "simulator-http": simulatorConnector,
  "extron-sis": extronConnector,
  "axis-vapix": axisConnector,
  "sony-pro": sonyConnector,
  "netio-pdu": netioConnector,
  "barco-clickshare": barcoConnector,
  "biamp-tesira": biampConnector,
  "crestron-nvx-nax": crestronNvxConnector,
  "zoom-rooms": zoomConnector,
};
