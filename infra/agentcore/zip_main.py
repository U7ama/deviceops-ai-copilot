"""Direct-code bootstrap for the existing Strands service and scoped Node MCP."""
import os
from pathlib import Path
import sys
import json

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / 'python'))
sys.path.insert(0, str(ROOT / 'apps' / 'strands-agent'))
os.environ['PYTHONPATH'] = str(ROOT / 'python')
os.environ['DEVICEOPS_MCP_COMMAND'] = str(ROOT / 'node')
os.environ['DEVICEOPS_MCP_ARGS'] = json.dumps([str(ROOT / 'operations-mcp.cjs')])

if __name__ == '__main__':
    import uvicorn
    uvicorn.run('agentcore_app:app', host='0.0.0.0', port=8080, access_log=False)
