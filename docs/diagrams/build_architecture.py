"""Generate the editable submission SVG without third-party dependencies."""
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
    w=len(value)*8.4+18
    rect(x-9,y-17,w,24,'#f4f7fc',r=5)
    text(x,y,value,15,'#4e6280',600)
add('<svg xmlns="http://www.w3.org/2000/svg" width="1800" height="1640" viewBox="0 0 1800 1640" role="img" aria-labelledby="title desc">')
add('<title id="title">DeviceOps — Autonomous Operations &amp; Incident Resolution architecture</title><desc id="desc">Device observations enter a tenant-scoped Next.js API. Mobile photos upload directly to that API. A PostgreSQL-backed worker detects incidents. Optional live Strands reasoning uses scoped evidence and analysis tools; the current demonstration uses fixtures. The backend controls approval, simulator execution and verified recovery. Bedrock and Titan are optional account-blocked paths.</desc>')
add('<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10Z" fill="#56718f"/></marker><marker id="optional" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10Z" fill="#9a7a3d"/></marker></defs>')
add('<g font-family="Arial, Helvetica, sans-serif">')
rect(0,0,1800,1640,'#f4f7fc',r=0)
rect(0,0,1800,166,'#112642',r=0)
text(60,44,'DEVICEOPS  /  PROFESSIONAL AGENTS',16,'#8fc9ff',700)
text(60,93,'Autonomous Operations & Incident Resolution',43,'#ffffff',700)
text(60,133,'Observe → investigate → authorize → act → verify. Built with the AWS Strands Agents SDK.',22,'#d5e3f4')
# Lane headings
for x,w,title,subtitle in [(40,420,'01  DEVICE & DELIVERY LAYER','Controlled LAN / local notification services'),(500,660,'02  DEVICEOPS APPLICATION','Next.js + TypeScript worker + PostgreSQL'),(1200,560,'03  AGENT & MODEL LAYER','Private Python service + external model API')]:
    rect(x,191,w,851,'#eaf0f8',r=20)
    text(x+20,223,title,17,'#284768',700)
    text(x+20,248,subtitle,16)
# Edges behind cards
arrow('M250 432 V448')
arrow('M420 515 H475 V318 H540')
arrow('M820 413 V468')
arrow('M820 623 V678')
arrow('M1100 510 H1240')
arrow('M1480 468 V405')
arrow('M1480 623 V668')
arrow('M1240 740 H1178 V360 H1100')
arrow('M1100 575 H1132 V943 H1100')
arrow('M785 848 V898')
arrow('M540 778 H455 V570 H420')
arrow('M605 848 V873 H250 V898')
arrow('M420 960 H478 V390 H540')
arrow('M1718 550 H1743 V928 H1720','#9a7a3d',True)
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
text(94,826,'4 adapters implemented; 53 planned.',17)
text(94,851,'Physical/cloud writes disabled.',17)
box(70,898,350,124,'LOCAL NOTIFICATIONS','n8n → Mailpit',['Email delivery + signed callback'])
box(540,277,560,136,'OPERATOR ENTRY POINT','Next.js operations UI + v2 API',['Sessions · tenant scope · manager approvals','Collector ingestion · MCP tool endpoint'])
box(540,468,560,155,'AUTONOMOUS ORCHESTRATION','TypeScript operations worker',['EWMA drift: temp, memory, optical loss','PostgreSQL-backed pg-boss investigation jobs','Campus topology & calculated impact'])
box(540,678,560,170,'BACKEND OWNS AUTHORIZATION','Policy → execution → verification',['Service restart: automatic when policy allows','Switch restart: manager approval + exact hash','One command; 3 fresh healthy samples or escalate'])
box(540,898,560,124,'PERSISTENCE','PostgreSQL 17',['Tenant RLS · baselines · memory · jobs · audit'])
box(1240,277,480,128,'CONFIGURED / ACCESS BLOCKED','Google Gemini API',['gemini-3.7-flash · external to AWS','Latest auth: HTTP 401; live retest pending'],'#9a7a3d','#fffaf0','7 5')
box(1240,468,480,155,'PYTHON / FASTAPI','AWS Strands Agents SDK',['Supervisor → specialists → critic → diagnosis','Shared budget + cancellation + scoped evidence','Proposes actions; backend owns authorization'],'#216e65')
box(1240,668,480,169,'STDIO MCP → SCOPED API READS','Scoped evidence & analysis tools',['Incident · health · logs · topology','Recent changes · runbooks · capabilities','Short-lived invocation grant; no device secrets'],'#216e65')
box(1240,898,480,124,'OPTIONAL / ACCOUNT-BLOCKED','Amazon Bedrock + Titan',['Nova reasoning; Titan semantic runbooks'],'#9a7a3d','#fffaf0','7 5')
# labels over routes, no line intersections imply connections
label(477,300,'telemetry')
label(835,443,'persisted state')
label(1110,490,'investigate')
label(1493,439,'inference')
label(1493,651,'tool calls')
label(1186,858,'MCP reads use tenant-scoped API')
label(556,661,'validated proposal')
label(84,654,'↑ simulator-only commands')
# narrow data row beneath diagram
text(60,1074,'RETRIEVAL',14,'#2263bb',700)
text(180,1074,'Gemini uses lexical runbook search. Optional Titan vectors are evaluated in the service; no hosted vector database is claimed.',18)
rect(60,1100,1680,120,'#112642',r=18)
text(86,1133,'END-TO-END INCIDENT LIFECYCLE',14,'#8fc9ff',700)
steps=['Observe','Detect & group','Investigate','Authorize','Execute','Verify','Report / notify']
for i,t in enumerate(steps):
    x=86+i*235
    text(x,1177,t,22,'#ffffff',700)
    if i<6:text(x+195,1177,'→',23,'#8fc9ff')
text(60,1574,'VERIFICATION SNAPSHOT  ·  10 SEP 2026',14,'#547091',700)
text(60,1604,'Current demo: fixture reasoning. Live specialist inference, phone camera and AWS adapters need separate verification.',18)
box(60,1260,530,260,'MULTIMODAL EVIDENCE','Quarantine → scan → isolated parser',['Mobile photo & manual PDF (>pg 5 citations)','ClamAV malware scan + SHA-256 integrity','Device associations require confirmation','Only clean, approved artifacts enter context'])
box(630,1260,530,260,'SANDBOXED ANALYSIS','Private broker → disposable container',['No network · credentials · application mounts','1 CPU · 256 MiB · 64 PIDs · 30 seconds','Telemetry CSV + synthetic waveform FFT','Measured spectra; no bearing-fault diagnosis'])
box(1200,1260,540,260,'ORGANIZATIONAL MEMORY','Incident / knowledge / fleet memory',['Factual outcomes + reviewed runbooks','Source IDs, versions and tenant isolation','EWMA baselines + explicit evidence gaps','AgentCore: separately unverified'])
add('</g></svg>')
(OUT/'deviceops-architecture.svg').write_text('\n'.join(s))
print(OUT/'deviceops-architecture.svg')
