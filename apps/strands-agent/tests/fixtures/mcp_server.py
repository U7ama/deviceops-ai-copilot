import os
from mcp.server.fastmcp import FastMCP

server = FastMCP('DeviceOps offline MCP contract fixture')


@server.tool()
def get_incident_context() -> dict:
    return {'grantPresent': os.getenv('DEVICEOPS_MCP_GRANT') == 'scoped-grant',
            'databasePresent': 'DATABASE_URL' in os.environ,
            'awsPresent': any(name in os.environ for name in ['AWS_ACCESS_KEY_ID', 'AWS_SESSION_TOKEN'])}


if __name__ == '__main__':
    server.run(transport='stdio')
