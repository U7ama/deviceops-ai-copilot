export type IntegrationStatus = "planned" | "access-blocked" | "implemented" | "simulator-tested" | "hardware/service-verified";
export type IntegrationCategory = "cloud" | "on-lan" | "server" | "manufacturer-cloud";
export interface IntegrationEntry {
  id: string; name: string; category: IntegrationCategory; status: IntegrationStatus;
  capabilities: readonly string[]; supportedScope: string; authentication: string;
  timeoutMs: number | null; pollIntervalMs: number | null; documentationUrl: string | null; verification: string | null;
}
const planned = (id: string, name: string, category: IntegrationCategory): IntegrationEntry => ({
  id, name, category, status: "planned", capabilities: [], supportedScope: "Models, firmware, API entitlement, and test access require verification.",
  authentication: "Unverified", timeoutMs: null, pollIntervalMs: null, documentationUrl: null, verification: null,
});
const cloud: [string, string][] = [
  ["appspace", "Appspace"], ["biamp-cloud", "Biamp"], ["cisco-control-hub", "Cisco Control Hub / Webex"], ["crestron-xio", "Crestron XiO Cloud"],
  ["logitech-sync", "Logitech Sync"], ["teams-rooms", "Microsoft Teams Rooms"], ["poly-lens", "Poly Lens"], ["qsys-reflect", "Q-SYS Reflect"],
  ["sennheiser", "Sennheiser"], ["yealink-ymcs", "Yealink YMCS"], ["zoom-rooms", "Zoom Rooms"],
];
const lan: [string, string][] = [
  ["ping", "Ping (reachability)"], ["snmp-v2c", "SNMP (v2c)"], ["snmp-switch-ports", "SNMP switch ports (v2c)"], ["netgear-rest", "Netgear switch native REST (M4250/M4300/M4350)"],
  ["pjlink", "PJLink (projectors)"], ["crestron-cip", "Crestron CIP"], ["extron-sis", "Extron SIS"], ["lightware", "Lightware (LW3/LW2)"],
  ["crestron-nvx-nax", "Crestron DM NVX / NAX"], ["crestron-hd", "Crestron HD switcher (HD-MD/HD-PS)"], ["crestron-3-series", "Crestron 3-Series (SSH console)"],
  ["crestron-4-series", "Crestron 4-Series (REST)"], ["crestron-odt", "Crestron CEN-ODT-C-POE sensor"], ["crestron-tsw", "Crestron TSW-70 touch panel"],
  ["crestron-airmedia", "Crestron AirMedia 3 (AM-3000/3100)"], ["brightsign", "BrightSign signage (LDWS)"], ["amx-netlinx", "AMX NetLinx (ICSP)"],
  ["onvif", "ONVIF camera (generic)"], ["axis-vapix", "Axis camera (VAPIX)"], ["hikvision-isapi", "Hikvision camera (ISAPI)"], ["panasonic-aw", "Panasonic PTZ (AW)"],
  ["sony-pro", "Sony pro display/projector (BRAVIA)"], ["lg-display", "LG commercial display"], ["samsung-mdc", "Samsung commercial display (MDC)"],
  ["sharp-display", "Sharp commercial display"], ["nec-display", "NEC large-format display"], ["viewsonic", "ViewSonic commercial display"], ["commbox", "CommBox interactive display"],
  ["atlona", "Atlona (matrix / OmniStream)"], ["bluestream", "Bluestream (HDBaseT / AVoIP)"], ["biamp-tesira", "Biamp Tesira DSP (TTP)"],
  ["lumens", "Lumens PTZ / doc camera"], ["barco-clickshare", "Barco ClickShare"], ["vivi", "Vivi (wireless presentation)"],
  ["apc-pdu", "APC Switched Rack PDU (SNMP)"], ["thor-pdu", "Thor PDU (HTTP)"], ["netio-pdu", "NETIO PDU (Open API)"], ["screen-lift", "Projection screen / lift"], ["shure-system", "Shure System API"],
];
const server: [string, string][] = [
  ["extron-gve", "Extron GVE"], ["crestron-fusion", "Crestron Fusion"], ["dante-domain-manager", "Dante Domain Manager"],
  ["crestron-vc4", "Crestron VC-4"], ["crestron-avf", "Crestron .AV Framework (AVF)"], ["roomconnect", "RoomConnect"],
];
const implemented: Record<string, Partial<IntegrationEntry>> = {
  ping: { status: "implemented", capabilities: ["reachability", "latency"], supportedScope: "IPv4 ICMP using Linux iputils ping; no application-health inference.", authentication: "None", documentationUrl: "https://github.com/iputils/iputils", verification: "Input validation and subprocess behavior tested; hardware/service verification pending." },
  "snmp-v2c": { status: "simulator-tested", capabilities: ["system-description", "uptime", "system-name"], supportedScope: "Read-only SNMPv2c GET for system OIDs; vendor sensors not inferred.", authentication: "Community from local vault; unencrypted v2c transport", documentationUrl: "https://github.com/markabrahams/node-net-snmp", verification: "Local UDP SNMP agent fixture; no hardware verification." },
  "snmp-switch-ports": { status: "simulator-tested", capabilities: ["interface-admin-status", "interface-oper-status", "interface-description"], supportedScope: "Read-only IF-MIB GET for up to 32 configured interface indexes.", authentication: "Community from local vault; unencrypted v2c transport", documentationUrl: "https://www.rfc-editor.org/rfc/rfc2863", verification: "Local UDP SNMP agent fixture; no switch hardware verification." },
  pjlink: { status: "simulator-tested", capabilities: ["power", "errors", "lamp", "input"], supportedScope: "PJLink Class 1 read-only POWR/ERST/LAMP/INPT queries over IPv4 TCP.", authentication: "PJLink challenge/MD5 with local vault password, or unauthenticated greeting", documentationUrl: "https://pjlink.jbmia.or.jp/english/dl.html", verification: "Local TCP fixtures with challenge and failure handling; no projector hardware verification." },

  "extron-sis": { status: "simulator-tested", capabilities: ["firmware-version", "part-number"], supportedScope: "Extron Simple Instruction Set read-only I/N queries over TCP.", authentication: "Extron telnet password from local vault", documentationUrl: "https://www.extron.com", verification: "Mock TCP SIS ASCII fixture; vendor hardware verification pending." },
  "axis-vapix": { status: "simulator-tested", capabilities: ["model", "serial-number", "firmware-version", "uptime"], supportedScope: "Axis VAPIX basicdeviceinfo.cgi HTTP GET.", authentication: "HTTP Basic from local vault (Digest pending)", documentationUrl: "https://www.axis.com/developer-community/vapix", verification: "Mock HTTP VAPIX JSON fixture; vendor hardware compatibility pending." },
  "sony-pro": { status: "simulator-tested", capabilities: ["power-status", "system-info"], supportedScope: "Sony BRAVIA B2B JSON-RPC over HTTP /sony/system.", authentication: "Pre-Shared Key (X-Auth-PSK) from local vault", documentationUrl: "https://pro-bravia.sony.net/develop/integrate/rest-api/", verification: "Mock HTTP JSON-RPC fixture; hardware verification pending." },
  "netio-pdu": { status: "simulator-tested", capabilities: ["voltage", "frequency", "total-power", "outlet-count"], supportedScope: "NETIO M2M JSON API read-only netio.json over HTTP.", authentication: "HTTP Basic from local vault", documentationUrl: "https://www.netio-products.com/en/glossary/json-protocol-m2m-api", verification: "Mock HTTP JSON fixture; hardware verification pending." },
  "barco-clickshare": { status: "simulator-tested", capabilities: ["health", "model", "serial", "temperature"], supportedScope: "Barco ClickShare REST API v2 /v2/system over HTTP.", authentication: "Bearer token from local vault", documentationUrl: "https://www.barco.com", verification: "Mock HTTP REST fixture; hardware verification pending." },
  "biamp-tesira": { status: "simulator-tested", capabilities: ["version"], supportedScope: "Biamp Tesira Text Protocol read-only queries over TCP.", authentication: "Session login password from local vault", documentationUrl: "https://support.biamp.com", verification: "Mock TCP TTP fixture; hardware verification pending." },
  "crestron-nvx-nax": { status: "simulator-tested", capabilities: ["model", "serial", "firmware"], supportedScope: "Crestron DM NVX REST API /Device/DeviceInfo over HTTP.", authentication: "Bearer token from local vault", documentationUrl: "https://www.crestron.com", verification: "Mock HTTP REST fixture; hardware verification pending." },
  "zoom-rooms": { status: "simulator-tested", capabilities: ["room-status", "health", "mic-health", "speaker-health", "camera-health"], supportedScope: "Zoom Rooms Cloud REST API /v2/rooms.", authentication: "OAuth 2.0 Bearer token from local vault", documentationUrl: "https://marketplace.zoom.us/docs/api-reference/zoom-api/methods/#operation/getZRProfile", verification: "Mock HTTP REST fixture; live OAuth verification pending." },
};
/** Requested catalog: 11 cloud + 39 LAN + 6 server + 1 manufacturer cloud. Simulator adapter is deliberately excluded. */
export const integrationCatalog: readonly IntegrationEntry[] = [
  ...cloud.map(([id, name]) => ({ ...planned(id, name, "cloud"), ...(implemented[id] ?? {}), ...(implemented[id] ? { timeoutMs: 3000, pollIntervalMs: 30000 } : {}) })),
  ...lan.map(([id, name]) => ({ ...planned(id, name, "on-lan"), ...(implemented[id] ?? {}), ...(implemented[id] ? { timeoutMs: 3000, pollIntervalMs: 30000 } : {}) })),
  ...server.map(([id, name]) => planned(id, name, "server")), planned("shure-cloud", "Shure Cloud", "manufacturer-cloud"),
];
