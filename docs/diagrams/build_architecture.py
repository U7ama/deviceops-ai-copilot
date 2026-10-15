"""Generate the editable architecture SVG without third-party dependencies."""
from pathlib import Path
from html import escape
OUT = Path(__file__).parent
s=[]
def add(v):s.append(v)
def text(x,y,value,size=20,color='#41516b',weight=400):
    add(f'<text x="{x}" y="{y}" font-size="{size}" fill="{color}" font-weight="{weight}">{escape(value)}</text>')
def rect(x,y,w,h,fill,stroke='none',r=18,dash=''):
    add(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{r}" fill="{fill}" stroke="{stroke}" stroke-width="1.5" stroke-dasharray="{dash}"/>')
def box(x,y,w,h,kicker,title,lines,color='#2263bb',fill='#ffffff',dash=''):
    rect(x,y,w,h,fill,'#d4deeb',16,dash)
    rect(x,y,5,h,color,r=2)
    text(x+24,y+30,kicker,14,color,700)
    text(x+24,y+62,title,25,'#132745',700)
    for n,line in enumerate(lines):text(x+24,y+92+n*25,line,19)
def arrow(d,color='#56718f',dash=False):
    add(f'<path d="{d}" fill="none" stroke="{color}" stroke-width="2.5" stroke-linejoin="round" stroke-dasharray="{ "7 6" if dash else ""}" marker-end="url(#{"optional" if dash else "arrow"})"/>')
def label(x,y,value):
    w=len(value)*8.2+16
    rect(x-8,y-16,w,22,'#ffffff','#d4deeb',r=4)
    text(x,y,value,14,'#284768',600)
add('<svg xmlns="http://www.w3.org/2000/svg" width="1800" height="1640" viewBox="0 0 1800 1640" role="img" aria-labelledby="title desc">')
add('<title id="title">DeviceOps — Autonomous Operations &amp; Incident Resolution architecture</title><desc id="desc">Device observations enter a tenant-scoped Next.js API. Mobile photos upload directly to that API. A PostgreSQL-backed worker detects incidents. Strands multi-agent specialist reasoning runs with Alibaba Cloud Qwen models; backend controls approval, simulator execution and verified recovery.</desc>')
add('<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10Z" fill="#56718f"/></marker><marker id="optional" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10Z" fill="#9a7a3d"/></marker></defs>')
add('<g font-family="Arial, Helvetica, sans-serif">')
rect(0,0,1800,1640,'#f4f7fc',r=0)
rect(0,0,1800,166,'#112642',r=0)
text(60,44,'DEVICEOPS  /  PROFESSIONAL AGENTS',16,'#8fc9ff',700)
text(60,93,'Autonomous Operations & Incident Resolution',43,'#ffffff',700)
text(60,133,'Observe → investigate → authorize → act → verify. Multi-agent reasoning on AWS Bedrock AgentCore & Alibaba Qwen.',22,'#d5e3f4')
# Lane headings
for x,w,title,subtitle in [(40,420,'01  DEVICE & DELIVERY LAYER','Controlled LAN / local notification services'),(500,660,'02  DEVICEOPS APPLICATION','Next.js + TypeScript worker + PostgreSQL'),(1200,560,'03  AWS AGENTCORE & REASONING','Bedrock AgentCore + Alibaba Cloud Qwen')]:
    rect(x,191,w,851,'#eaf0f8',r=20)
    text(x+20,223,title,17,'#284768',700)
    text(x+20,248,subtitle,16)
# Edges behind cards
arrow('M250 432 V448')
arrow('M420 515 H475 V318 H540')
arrow('M820 413 V468')
arrow('M820 623 V678')
arrow('M1100 540 H1240')
arrow('M1480 490 V455')
arrow('M1480 715 V752')
arrow('M1240 830 H1160 V340 H1100')
arrow('M1100 575 H1132 V943 H1100')
arrow('M785 848 V898')
arrow('M540 778 H455 V570 H420')
arrow('M605 848 V873 H250 V898')
arrow('M420 960 H478 V390 H540')
# cards
box(70,277,350,155,'OBSERVATION SOURCES','Devices & simulators',['LAN equipment: read-only probes','Standalone HTTP simulator','Physical/cloud writes disabled'])
box(70,448,350,179,'NODE.JS EDGE COLLECTOR','Normalize & deliver',['Ping · SNMP system / ports · PJLink','Encrypted vault + durable spool','Outbound API + command journal'])
rect(70,644,350,84,'#ffffff','#d4deeb',16)
text(94,669,'MOBILE PHOTO CAPTURE',14,'#2263bb',700)
text(94,695,'Authenticated upload to v2 API',18,'#132745',700)
text(94,716,'SHA-256 + incident association',16)
arrow('M420 684 H488 V390 H540')
rect(70,744,350,128,'#f5f8fc','#d4deeb',16)
text(94,771,'INTEGRATION BOUNDARY',14,'#547091',700)
text(94,800,'57-entry connector catalog',22,'#132745',700)
text(94,826,'12 mock-tested adapters; 45 planned.',16)
text(94,851,'Physical hardware unverified.',16)
box(70,898,350,124,'LOCAL NOTIFICATIONS','n8n → Mailpit',['Email delivery + signed callback'])
box(540,277,560,136,'OPERATOR ENTRY POINT','Next.js operations UI + v2 API',['Sessions · tenant scope · manager approvals','Collector ingestion · MCP tool endpoint'])
box(540,468,560,155,'AUTONOMOUS ORCHESTRATION','TypeScript operations worker',['EWMA drift: temp, memory, optical loss','PostgreSQL-backed pg-boss investigation jobs','Campus topology & calculated impact'])
box(540,678,560,170,'BACKEND OWNS AUTHORIZATION','Policy → execution → verification',['Service restart: automatic when policy allows','Switch restart: manager approval + exact hash','One command; 3 fresh healthy samples or escalate'])
box(540,898,560,124,'PERSISTENCE','PostgreSQL 17',['Tenant RLS · baselines · memory · jobs · audit'])
box(1240,277,480,175,'ACTIVE REASONING PROVIDER','Alibaba Cloud Model Studio',['qwen3.7-max in recorded recovery','OpenAI-compatible model inference','Explicit model selection · cited findings'],'#216e65','#f0f9f6')
box(1240,490,480,225,'SERVERLESS AGENT RUNTIME','Amazon Bedrock AgentCore',['Strands SDK · bounded specialist workflow','Network / System / Power → Critic','Python 3.12 ARM64 microVM in AWS us-east-1','Direct S3 code bundle · HTTP invocations','Proposes actions; backend owns authorization'],'#2263bb','#f0f5fc')
box(1240,755,480,215,'RESTRICTED HYBRID TOOL BRIDGE','Cloudflare Tunnel → Tool Proxy',['Grant checks enforced by local backend','Ephemeral HTTPS/QUIC tunnel to loopback :3035','Allowed tool + invocation-status callbacks','DB stays local; evidence goes to cloud'],'#216e65','#f0f9f6')
# labels over routes, no line intersections imply connections
label(477,300,'telemetry')
label(835,443,'persisted state')
label(1125,520,'investigate')
label(1500,475,'inference')
label(1500,738,'tool calls')
label(556,661,'validated proposal')
# narrow data row beneath diagram
text(60,1074,'RETRIEVAL',14,'#2263bb',700)
text(180,1074,'Local lexical runbook search; optional Titan embeddings. The recorded cloud recovery does not establish live vector retrieval.',18)
rect(60,1100,1680,120,'#112642',r=18)
text(86,1133,'END-TO-END INCIDENT LIFECYCLE',14,'#8fc9ff',700)
steps=['Observe','Detect & group','Investigate','Authorize','Execute','Verify','Report / notify']
for i,t in enumerate(steps):
    x=86+i*235
    text(x,1177,t,22,'#ffffff',700)
    if i<6:text(x+195,1177,'→',23,'#8fc9ff')
text(60,1574,'RECORDED VERIFICATION  ·  14 SEP 2026',14,'#216e65',700)
text(60,1604,'AgentCore + Qwen: autonomous service recovery verified in 100.5s; authenticated manager approval & switch recovery verified in 114.3s.',18)
box(60,1260,530,260,'MULTIMODAL EVIDENCE','Quarantine → scan → isolated parser',['Mobile photo & manual PDF (>pg 5 citations)','ClamAV malware scan + SHA-256 integrity','Device associations require confirmation','Only clean, approved artifacts enter context'])
box(630,1260,530,260,'SANDBOXED ANALYSIS','Private broker → disposable container',['No network · credentials · application mounts','1 CPU · 256 MiB · 64 PIDs · 30 seconds','Telemetry CSV + synthetic waveform FFT','Measured spectra; no bearing-fault diagnosis'])
box(1200,1260,540,260,'ORGANIZATIONAL MEMORY','Incident / knowledge / fleet memory',['Factual outcomes + reviewed runbooks','Source IDs, versions and tenant isolation','EWMA baselines + explicit evidence gaps','Lexical retrieval; optional Titan embeddings'])
add('</g></svg>')
(OUT/'deviceops-architecture.svg').write_text('\n'.join(s), encoding='utf-8')
print(OUT/'deviceops-architecture.svg')
