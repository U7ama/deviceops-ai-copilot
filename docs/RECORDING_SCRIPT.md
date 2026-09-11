# DeviceOps recording script

Target: 4 minutes 45 seconds, leaving 15 seconds for transitions. Rehearse at roughly 115–125 words per minute. Use the exact tested release and hide terminals containing credentials. Synthetic fixtures and fixture investigations must remain labeled.

## Before recording

- Open `/operations` and select Enterprise. Confirm the displayed provider mode.
- Have `staged-rack.png`, `floorplan-building-c.png`, `optical-manual-30-pages.pdf` and `telemetry.csv` ready.
- Use the synthetic campus tenant. Set detector mode to observation-only initially. Review simulator criticality deliberately; the critical-dependency example leaves the display critical until a manager changes it.
- Prepare completed evidence processing and chart generation on an incident. Do not imply that an edited waiting period was instantaneous.
- Record live specialist results only after a successful complete live investigation. Current Gemini authentication is blocked; the default narration below describes the verified fixture demonstration.

## 0:00–0:35 — Operations overview

**Screen:** Fleet, then Enterprise; keep provider label visible.

“DeviceOps helps campus and facilities teams investigate recurring infrastructure incidents. A device alert rarely tells the whole story: the problem may be upstream, the evidence may conflict, and the obvious restart may affect other rooms.

This demonstration uses synthetic telemetry and equipment evidence. Investigations here use labeled fixture responses. The Strands specialist workflow is implemented and tested, but live provider authentication is currently blocked. Real equipment remains read-only.”

**Only after successful live verification, replace the last two sentences with:** “This investigation uses the verified Gemini provider through AWS Strands. Real equipment remains read-only.”

## 0:35–1:15 — Proactive optical evidence

**Screen:** Replay optical loss; show dBm chart, baseline and timestamp.

“Here we replay a stable optical receiver signal followed by a sustained decline. The detector evaluates the measurements without sending every sample to a language model. It requires baseline history, checks the direction of change, and applies a cooldown.

The result is evidence of weakening received power. It is not proof of a dirty connector and it does not predict an exact failure time. Thresholds must match the real transceiver specification. With investigation triggers enabled, this evidence opens a proactive incident before the simulated outage.”

## 1:15–2:00 — Dependencies and specialist reasoning

**Screen:** Select Campus switch in the dependency map; show recorded specialist findings only if available.

“The map comes from stored device relationships. This switch has three downstream devices. When a dependent device is critical, backend policy blocks recovery and requires escalation.

The specialist workflow collects shared evidence, routes the incident to relevant network, system or power specialists, and asks a critic to examine contradictions and impact. Specialists cannot approve execution. Model calls, evidence reads and execution time have shared limits. If a specialist fails or evidence is incomplete, the result must say so.”

**Fixture recording:** Show the test/verification record instead of presenting unpopulated panels as live specialist execution.

## 2:00–3:05 — Evidence and selected manual page

**Screen:** Incident evidence; normalized rack image, floorplan and manual page 30.

“A technician can attach an image, a manual or a floorplan to the incident. Files pass checksum validation and a clean-scan or exact reviewed-fixture gate before isolated parsing. Device associations require confirmation.

This staged floorplan places Rack 3 beneath a vent. That relationship is a clue, not an HVAC diagnosis.

The relevant manual passage is on page thirty. DeviceOps retrieves its text and renders the selected page, preserving the document and page citation. The model can receive that bounded image alongside the excerpt, rather than only seeing the document cover.”

## 3:05–3:40 — Actual isolated analysis

**Screen:** Approved CSV, completed analysis statistics and chart.

“This chart was generated from the approved telemetry CSV inside a disposable container. The analysis has no network, provider credentials, application mounts or Docker socket. Runtime, memory and output are bounded, and the script hash is recorded.

The resulting statistics are evidence for the investigation. They cannot grant permissions or override policy.”

## 3:40–4:25 — Approval and recovery

**Screen:** Prepared standard-criticality simulator switch incident; manager approval and completed recovery report.

“For an eligible shared-switch restart, the manager approves the exact proposal. A stale or replayed approval cannot authorize a different action. The backend checks current evidence and dependency policy again before dispatch.

Recovery requires sustained fresh healthy observations. A command acknowledgement alone is not success. In the critical-dependency example, the same recovery is blocked and no command is dispatched.”

## 4:25–4:45 — Memory and architecture

**Screen:** Organizational memory, then architecture image.

“DeviceOps also retrieves prior incident outcomes and reviewed runbooks, while keeping tenant information separate. Historical advice cannot override current evidence.

The architecture combines Strands, MCP, deterministic policy, PostgreSQL and isolated evidence processing. This is a bounded infrastructure demonstration with explicit provider and deployment limitations—not a claim of production certification.”
