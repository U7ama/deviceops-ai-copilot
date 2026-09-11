# Integration catalog

The requested list contains **57 entries**: 11 cloud, 39 LAN, 6 server and 1 manufacturer-cloud. Entries marked planned are roadmap items, not working integrations. The runtime source of truth is `packages/connectors/src/catalog.ts`; the simulator HTTP adapter is separate and is excluded from this count.

| Status | Meaning |
| --- | --- |
| planned | No compatibility or API-access claim |
| access-blocked | Documentation or authorized test access is missing |
| implemented | Adapter code exists; validation scope is stated |
| simulator-tested | Tested against a local protocol/service fixture |
| hardware/service-verified | Requires recorded real device/service evidence; none currently claimed |

## Cloud (11)

| Integration | Delivery status |
| --- | --- |
| Appspace | planned |
| Biamp | planned |
| Cisco Control Hub / Webex | planned |
| Crestron XiO Cloud | planned |
| Logitech Sync | planned |
| Microsoft Teams Rooms | planned |
| Poly Lens | planned |
| Q-SYS Reflect | planned |
| Sennheiser | planned |
| Yealink YMCS | planned |
| Zoom Rooms | planned |

## On-LAN edge (39)

| Integration | Delivery status |
| --- | --- |
| Ping (reachability) | implemented (input/subprocess tests; hardware pending) |
| SNMP (v2c) | simulator-tested (system OIDs) |
| SNMP switch ports (v2c) | simulator-tested (configured IF-MIB ports) |
| Netgear switch native REST (M4250/M4300/M4350) | planned |
| PJLink (projectors) | simulator-tested (Class 1 read-only queries) |
| Crestron CIP | planned |
| Extron SIS | planned |
| Lightware (LW3/LW2) | planned |
| Crestron DM NVX / NAX | planned |
| Crestron HD switcher (HD-MD/HD-PS) | planned |
| Crestron 3-Series (SSH console) | planned |
| Crestron 4-Series (REST) | planned |
| Crestron CEN-ODT-C-POE sensor | planned |
| Crestron TSW-70 touch panel | planned |
| Crestron AirMedia 3 (AM-3000/3100) | planned |
| BrightSign signage (LDWS) | planned |
| AMX NetLinx (ICSP) | planned |
| ONVIF camera (generic) | planned |
| Axis camera (VAPIX) | planned |
| Hikvision camera (ISAPI) | planned |
| Panasonic PTZ (AW) | planned |
| Sony pro display/projector (BRAVIA) | planned |
| LG commercial display | planned |
| Samsung commercial display (MDC) | planned |
| Sharp commercial display | planned |
| NEC large-format display | planned |
| ViewSonic commercial display | planned |
| CommBox interactive display | planned |
| Atlona (matrix / OmniStream) | planned |
| Bluestream (HDBaseT / AVoIP) | planned |
| Biamp Tesira DSP (TTP) | planned |
| Lumens PTZ / doc camera | planned |
| Barco ClickShare | planned |
| Vivi (wireless presentation) | planned |
| APC Switched Rack PDU (SNMP) | planned |
| Thor PDU (HTTP) | planned |
| NETIO PDU (Open API) | planned |
| Projection screen / lift | planned |
| Shure System API | planned |

## Server (6)

| Integration | Delivery status |
| --- | --- |
| Extron GVE | planned |
| Crestron Fusion | planned |
| Dante Domain Manager | planned |
| Crestron VC-4 | planned |
| Crestron .AV Framework (AVF) | planned |
| RoomConnect | planned |

## Manufacturer cloud (1)

| Integration | Delivery status |
| --- | --- |
| Shure Cloud | planned |

## Connector release gate

For each planned entry, confirm official documentation, precise product/model/firmware, API entitlement, authentication, limits, and authorized test access. Implement inventory/health reads first; normalize transport/auth/freshness errors and pass shared contract tests. Record real hardware/service evidence before raising the status. Write operations are separately reviewed capabilities; they do not follow automatically from a working read integration.

Cloud brand names and "projection screen/lift" are not complete API specifications. SNMP v2c is unencrypted in transit; use it only in an authorized controlled network. SNMPv3, broader cloud/server adapters, native mobile approvals, multi-site discovery, scanned PDF OCR, voice/photo diagnosis, and physical-device remediation remain future work.
