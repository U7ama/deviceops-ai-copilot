# Original synthetic evidence fixtures

All files are original demonstration material. They are not vendor measurements, real rack photographs or surveyed installation drawings.

- `staged-rack.png`: drawn rack illustration for bounded visual observations.
- `manual.pdf`: short synthetic equipment manual for document/page citations.
- `telemetry.csv`: generated temperature history for isolated statistics and charts.
- `floorplan-building-c.png`: rack elevation with Rack 3 below HVAC-4. No HVAC fault telemetry is supplied. Location and device identity require technician confirmation; proximity alone does not establish causation.
- `floorplan-building-c.svg`: editable source of the elevation, rendered to PNG for the supported upload pipeline.

Upload the PNG/PDF/CSV files through the Enterprise incident evidence panel. Set `OPS_APPROVED_FIXTURE_HASHES` from `manifest.json` for these exact reviewed fixture bytes. Arbitrary uploads require the configured malware scanner and remain unavailable until clean. Do not add an arbitrary upload's hash to bypass scanning.

Optical replay generates 48 stable received-power samples near -3 dBm followed by a synthetic decline to -11 dBm. The replay is compressed timestamped history, not a measured three-day failure forecast. The default -10 dBm threshold is for the synthetic example; configure `opticalRxMinDbm` through the manager device-policy API according to the actual transceiver specification before interpreting real equipment.

The critical-campus scenario marks the simulated downstream display critical and injects the existing switch fault. The stored topology has three dependent devices. Backend policy blocks recovery; it does not create a VP or medical approval workflow. Restore the simulated display's criticality using the manager policy control after reviewing the scenario.

`optical-manual-30-pages.pdf` is an original 30-page synthetic manual. Page 30 contains the relevant optical/temperature passage and a simple port/trunk diagram. `scripts/generate-pdf-fixture.py` reproduces it with the parser image's pinned pypdf dependency. The isolated parser ranks pages from the incident query, renders at most two, and preserves page-number citations. Previews start at 1200 pixels and downscale if necessary to stay below 100,000 base64 characters per image. Existing uploads retain their old previews; upload the fixture again to exercise selected-page rendering.
