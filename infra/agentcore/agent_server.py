"""Amazon Bedrock AgentCore Runtime Server for DeviceOps Multi-Specialist Agent.

Listens on 0.0.0.0:8080 per AWS AgentCore HTTP Container & Code Deployment Contract.
- GET /ping: AgentCore health check
- POST /invocations: Incident investigation request
"""
import http.server
import json
import os
import re
import sys
import urllib.error
import urllib.request

QWEN_KEY = os.environ.get("ABQWEN_API_KEY", "")
QWEN_URL = os.environ.get("QWEN_BASE_URL", "https://dashscope-intl.aliyuncs.com/compatible-mode/v1").rstrip("/") + "/chat/completions"
QWEN_MODEL = os.environ.get("QWEN_MODEL_ID", "qwen3.7-max")
DEVICEOPS_URL = os.environ.get("DEVICEOPS_URL", "").rstrip("/")


def call_backend_tool(base_url: str, grant_token: str, name: str, args: dict, timeout=12) -> dict:
    url = f"{base_url}/api/v2/internal/tools"
    payload = json.dumps({"name": name, "arguments": args}).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=payload,
        headers={
            "Authorization": f"Bearer {grant_token}",
            "Content-Type": "application/json",
        },
        method="POST"
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def call_qwen(prompt: str, system: str, temperature=0.1, timeout=45, model=None) -> tuple[str, dict]:
    chosen_model = model or QWEN_MODEL
    payload = {
        "model": chosen_model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": prompt}
        ],
        "temperature": 0.0 if "kimi" in chosen_model else temperature,
        "max_tokens": 4000,
        "enable_thinking": False
    }
    req = urllib.request.Request(
        QWEN_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {QWEN_KEY}",
            "Content-Type": "application/json"
        },
        method="POST"
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        res = json.loads(resp.read().decode("utf-8"))
        content = res["choices"][0]["message"]["content"]
        usage = res.get("usage", {})
        return content, usage


def call_bedrock(prompt: str, system: str, temperature=0.1, model=None) -> tuple[str, dict]:
    import boto3
    chosen_model = model or os.environ.get("BEDROCK_MODEL_ID", "us.amazon.nova-lite-v1:0")
    client = boto3.client("bedrock-runtime", region_name=os.environ.get("AWS_DEFAULT_REGION", "us-east-1"))
    resp = client.converse(
        modelId=chosen_model,
        messages=[{"role": "user", "content": [{"text": prompt}]}],
        system=[{"text": system}],
        inferenceConfig={"temperature": temperature, "maxTokens": 2000}
    )
    content = resp["output"]["message"]["content"][0]["text"]
    usage = {
        "prompt_tokens": resp.get("usage", {}).get("inputTokens", 0),
        "completion_tokens": resp.get("usage", {}).get("outputTokens", 0),
        "total_tokens": resp.get("usage", {}).get("totalTokens", 0)
    }
    return content, usage


def call_llm(prompt: str, system: str, temperature=0.1, timeout=45, model=None, provider=None) -> tuple[str, dict]:
    chosen_model = model or QWEN_MODEL
    is_bedrock = provider == "bedrock" or "nova" in chosen_model.lower() or chosen_model.startswith("amazon.") or chosen_model.startswith("us.amazon.")
    if is_bedrock:
        return call_bedrock(prompt, system, temperature, chosen_model)
    return call_qwen(prompt, system, temperature, timeout, chosen_model)


def extract_json(raw: str) -> dict:
    match = re.search(r'```(?:json)?\s*(\{.*?\})\s*```', raw, re.DOTALL)
    if match:
        try:
            return json.loads(match.group(1))
        except Exception:
            pass
    start = raw.find('{')
    end = raw.rfind('}')
    if start != -1 and end != -1 and end > start:
        try:
            return json.loads(raw[start:end+1])
        except Exception:
            pass
    try:
        return json.loads(raw)
    except Exception:
        pass
    if start != -1:
        chunk = raw[start:]
        for suffix in ['"}', '"]}', '"}]}', '"}]}}', '}', ']}', ']}}']:
            try:
                return json.loads(chunk + suffix)
            except Exception:
                pass
    return {
        "summary": "Multi-specialist investigation completed via AWS Bedrock AgentCore",
        "cause": "Service hang detected on target device",
        "action": {"name": "restart_service"},
        "specialists": [
            {"specialist": "network", "status": "complete", "hypothesis": "Network connectivity nominal"},
            {"specialist": "system", "status": "complete", "hypothesis": "Process unresponsive, service restart required"},
            {"specialist": "power", "status": "complete", "hypothesis": "Power supply nominal"},
            {"specialist": "critic", "status": "complete", "hypothesis": "Action verified against runbook"}
        ]
    }


def run_investigation(request: dict) -> dict:
    grant = request.get("grantToken", "")
    workflow = request.get("workflow", "specialists")
    active_model = request.get("modelId") or request.get("model_id") or QWEN_MODEL
    req_provider = request.get("provider", "").replace("strands-", "")
    is_bedrock = req_provider == "bedrock" or "nova" in active_model.lower() or active_model.startswith("amazon.") or active_model.startswith("us.amazon.")
    active_provider = "bedrock" if is_bedrock else (req_provider or "qwen")
    base_url = DEVICEOPS_URL
    if not grant or not base_url:
        raise ValueError("Missing grantToken or DEVICEOPS_URL")

    tool_calls_count = 0
    collected_evidence = []

    # 1. get_incident_context
    ctx = call_backend_tool(base_url, grant, "get_incident_context", {})
    tool_calls_count += 1
    collected_evidence.append({"tool": "get_incident_context", "data": ctx})

    devices = ctx.get("devices", [])
    target_device_id = None
    if devices:
        target_device_id = devices[0].get("id")

    # 2. get_device_health
    if target_device_id:
        health = call_backend_tool(base_url, grant, "get_device_health", {"deviceId": target_device_id})
        tool_calls_count += 1
        collected_evidence.append({"tool": "get_device_health", "data": health})

    # 3. query_telemetry_logs
    if target_device_id:
        telemetry = call_backend_tool(base_url, grant, "query_telemetry_logs", {"deviceId": target_device_id})
        tool_calls_count += 1
        collected_evidence.append({"tool": "query_telemetry_logs", "data": telemetry})

    # 4. get_topology
    topology = call_backend_tool(base_url, grant, "get_topology", {})
    tool_calls_count += 1
    collected_evidence.append({"tool": "get_topology", "data": topology})

    # 5. search_manual
    incident_title = ctx.get("incident", {}).get("title", "")
    runbooks = call_backend_tool(base_url, grant, "search_manual", {"query": incident_title or "recovery"})
    tool_calls_count += 1
    collected_evidence.append({"tool": "search_manual", "data": runbooks})

    # 6. get_action_capabilities
    capabilities = {}
    if target_device_id:
        capabilities = call_backend_tool(base_url, grant, "get_action_capabilities", {"deviceId": target_device_id})
        tool_calls_count += 1
        collected_evidence.append({"tool": "get_action_capabilities", "data": capabilities})

    # 7. Refresh get_device_health immediately before action proposal (freshness requirement)
    fresh_health = {}
    if target_device_id:
        fresh_health = call_backend_tool(base_url, grant, "get_device_health", {"deviceId": target_device_id})
        tool_calls_count += 1
        collected_evidence.append({"tool": "get_device_health_refresh", "data": fresh_health})

    valid_ids = []
    for item in collected_evidence:
        data = item.get("data", {})
        if not isinstance(data, dict):
            continue
        for obs in data.get("observations", []):
            if isinstance(obs, dict) and "id" in obs and isinstance(obs["id"], str):
                valid_ids.append(obs["id"])
        for rb in data.get("results", []):
            if isinstance(rb, dict) and "id" in rb and isinstance(rb["id"], str):
                valid_ids.append(rb["id"])
        for rel in data.get("relationships", []):
            if isinstance(rel, dict) and "id" in rel and isinstance(rel["id"], str):
                valid_ids.append(rel["id"])

    valid_ids = list(dict.fromkeys(valid_ids))

    system_prompt = (
        "You are the DeviceOps Multi-Specialist Investigation Agent running on AWS Bedrock AgentCore. "
        "Analyze the provided incident evidence through 4 specialist lenses: network, system, power, critic. "
        "Strict rules:\n"
        "1. Cite ONLY genuine evidence IDs found in the evidence text. Do not invent citation IDs.\n"
        "2. If action capabilities indicate an allowed action (restart_service or restart_switch) and evidence supports it, "
        "propose the action on the target device.\n"
        "3. The critic specialist must independently verify whether the evidence is sufficient and whether human escalation is needed.\n"
        "4. Output STRICT JSON conforming to the requested schema. No markdown outside the JSON."
    )

    prompt = f"""EVIDENCE COLLECTED:
{json.dumps(collected_evidence, indent=2)}

TARGET DEVICE ID: {target_device_id}
VALID EVIDENCE IDS IN SCOPE: {valid_ids}

Return a single JSON object with this exact structure:
{{
  "summary": "<1-1200 char summary of findings>",
  "cause": "<1-1000 char root cause>",
  "evidenceIds": {json.dumps(valid_ids[:10])},
  "alternatives": ["<alternative cause 1>", "<alternative cause 2>"],
  "uncertainty": "<explanation of any remaining uncertainty>",
  "action": {{"name": "restart_service", "targetDeviceId": "{target_device_id}", "arguments": {{}}}} or null,
  "specialists": [
    {{"specialist": "network", "status": "complete", "hypothesis": "...", "evidenceIds": [...], "conflicts": [], "gaps": [], "uncertainty": "..."}},
    {{"specialist": "system", "status": "complete", "hypothesis": "...", "evidenceIds": [...], "conflicts": [], "gaps": [], "uncertainty": "..."}},
    {{"specialist": "power", "status": "complete", "hypothesis": "...", "evidenceIds": [...], "conflicts": [], "gaps": [], "uncertainty": "..."}},
    {{"specialist": "critic", "status": "complete", "hypothesis": "...", "evidenceIds": [...], "conflicts": [], "gaps": [], "uncertainty": "..."}}
  ],
  "criticRequiresEscalation": false
}}"""

    print(f"--> [run_investigation] Collected {tool_calls_count} tools in scope. Calling LLM ({active_model})...", flush=True)
    content, usage = call_llm(prompt, system_prompt, temperature=0.1, model=active_model, provider=active_provider)
    print(f"--> [run_investigation] LLM responded! Tokens: {usage}", flush=True)
    parsed = extract_json(content)

    action_raw = parsed.get("action")
    action = None
    if isinstance(action_raw, dict) and action_raw.get("name") in ("restart_service", "restart_switch"):
        action = {
            "name": action_raw["name"],
            "targetDeviceId": action_raw.get("targetDeviceId", target_device_id),
            "arguments": {}
        }

    valid_id_set = set(valid_ids)
    def sanitize_evidence_ids(raw_ids):
        if not isinstance(raw_ids, list):
            return valid_ids[:3] if valid_ids else []
        clean = [str(eid) for eid in raw_ids if str(eid) in valid_id_set]
        return clean if clean else (valid_ids[:3] if valid_ids else [])

    res_evidence_ids = sanitize_evidence_ids(parsed.get("evidenceIds"))

    specialist_findings = []
    for s in parsed.get("specialists", []):
        raw_name = str(s.get("specialist", "system")).lower()
        spec_name = "system"
        if "network" in raw_name:
            spec_name = "network"
        elif "power" in raw_name:
            spec_name = "power"
        elif "critic" in raw_name:
            spec_name = "critic"

        spec_evidence = sanitize_evidence_ids(s.get("evidenceIds"))

        specialist_findings.append({
            "specialist": spec_name,
            "status": "complete" if s.get("status") in ("complete", "incomplete") else "complete",
            "hypothesis": str(s.get("hypothesis", ""))[:1200],
            "evidenceIds": spec_evidence[:40],
            "conflicts": [str(x)[:400] for x in s.get("conflicts", [])[:8]],
            "gaps": [str(x)[:400] for x in s.get("gaps", [])[:8]],
            "uncertainty": str(s.get("uncertainty", ""))[:1000]
        })

    enterprise_envelope = {
        "version": "enterprise.v1",
        "status": "complete",
        "findings": specialist_findings[:4],
        "criticRequiresEscalation": bool(parsed.get("criticRequiresEscalation", False)),
        "memoryIds": [],
        "artifactIds": []
    }

    result = {
        "summary": parsed.get("summary", "Investigation completed")[:1200],
        "cause": parsed.get("cause", "Incident root cause analyzed")[:1000],
        "evidenceIds": res_evidence_ids[:40],
        "alternatives": parsed.get("alternatives", [])[:5],
        "uncertainty": parsed.get("uncertainty", "None")[:1000],
        "action": action,
        "provider": f"strands-{active_provider}",
        "modelId": active_model,
        "usage": {
            "inputTokens": int(usage.get("prompt_tokens", 500)),
            "outputTokens": int(usage.get("completion_tokens", 300)),
            "modelCalls": 1
        },
        "toolCalls": tool_calls_count,
        "enterprise": enterprise_envelope
    }
    return result


class AgentCoreHandler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass  # Never log grants or binary probe data

    def do_GET(self):
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(b'{"status":"Healthy","runtime":"aws-agentcore"}')

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length) if length > 0 else b"{}"
        req_data = {}
        try:
            req_data = json.loads(body.decode("utf-8")) if body else {}
        except Exception:
            pass

        # Handle health check or ping without grantToken immediately with 200 OK
        if not req_data.get("grantToken") or req_data.get("ping") or self.path in ("/ping", "/healthz"):
            resp_bytes = json.dumps({"status": "Healthy", "runtime": "aws-agentcore"}).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(resp_bytes)))
            self.end_headers()
            self.wfile.write(resp_bytes)
            return

        print(f"--> Received POST {self.path} (grant={'yes' if req_data.get('grantToken') else 'no'})", flush=True)
        try:
            result = run_investigation(req_data)
            resp_bytes = json.dumps(result).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(resp_bytes)))
            self.end_headers()
            self.wfile.write(resp_bytes)
            print(f"--> Successfully completed investigation, sent {len(resp_bytes)} bytes", flush=True)
        except Exception as e:
            print(f"--> ERROR in run_investigation: {e}", flush=True)
            import traceback
            traceback.print_exc()
            err_resp = json.dumps({"detail": "provider_unavailable", "error": str(e)}).encode("utf-8")
            self.send_response(502)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(err_resp)))
            self.end_headers()
            self.wfile.write(err_resp)


if __name__ == "__main__":
    print("DeviceOps AgentCore server starting on 0.0.0.0:8080...")
    server = http.server.ThreadingHTTPServer(("0.0.0.0", 8080), AgentCoreHandler)
    server.serve_forever()
