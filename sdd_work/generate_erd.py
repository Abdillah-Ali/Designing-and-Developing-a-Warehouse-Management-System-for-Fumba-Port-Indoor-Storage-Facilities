from PIL import Image, ImageDraw, ImageFont
from pathlib import Path

ROOT = Path(r"D:\BCS\THIRD YEAR\PROJECT-Final Year Project\Project\WMS-FumbaPort")
OUT = ROOT / "Fumba_Port_WMS_ERD.png"

W, H = 5000, 3900
img = Image.new("RGB", (W, H), "#F5F8FC")
d = ImageDraw.Draw(img)

def font(name, size):
    candidates = [
        rf"C:\Windows\Fonts\{name}.ttf",
        r"C:\Windows\Fonts\arial.ttf",
    ]
    for p in candidates:
        try: return ImageFont.truetype(p, size)
        except OSError: pass
    return ImageFont.load_default()

F_TITLE = font("arialbd", 78)
F_SUB = font("arial", 32)
F_DOMAIN = font("arialbd", 34)
F_HEAD = font("arialbd", 30)
F_FIELD = font("consola", 24)
F_LEGEND = font("arial", 25)

COLORS = {
    "identity": (42, 99, 156),
    "storage": (27, 133, 108),
    "cargo": (197, 113, 36),
    "finance": (108, 76, 150),
    "clearance": (181, 68, 91),
    "governance": (76, 89, 105),
}

tables = {
    # name: (domain, x, y, fields)
    "roles": ("identity", 120, 400, ["PK id", "UQ public_reference", "name", "key"]),
    "permissions": ("identity", 120, 850, ["PK permission_key", "name", "module"]),
    "role_permissions": ("identity", 120, 1300, ["PK/FK role_id", "PK/FK permission_key"]),
    "users": ("identity", 760, 400, ["PK id", "FK role_id", "FK warehouse_id", "FK shift_id", "UQ username", "status"]),
    "user_sessions": ("identity", 760, 1030, ["PK id", "FK user_id", "FK scanner_account_id", "token_family", "status"]),
    "scanner_sessions": ("identity", 760, 1580, ["PK id", "FK staff_user_id", "session_code", "status"]),

    "warehouses": ("storage", 1500, 360, ["PK id", "UQ public_reference", "name", "status"]),
    "zones": ("storage", 1500, 850, ["PK id", "FK warehouse_id", "code", "status"]),
    "racks": ("storage", 1500, 1300, ["PK id", "FK zone_id", "code", "status"]),
    "levels": ("storage", 1500, 1750, ["PK id", "FK rack_id", "level_number", "status"]),
    "bins": ("storage", 1500, 2200, ["PK id", "FK level_id", "UQ barcode", "max_weight", "max_volume", "status"]),
    "bin_rules": ("storage", 1500, 2850, ["PK id", "FK category_id", "rule_key", "evaluator_key", "priority", "enabled"]),

    "cargo": ("cargo", 2350, 470, ["PK id", "UQ public_reference", "FK warehouse_id", "FK current_bin_id", "registration_status", "customs_status", "placement_status", "weight / volume"]),
    "cargo_documents": ("cargo", 2350, 1220, ["PK id", "FK cargo_id", "FK uploaded_by", "file_name", "mime_type"]),
    "approval_requests": ("cargo", 2350, 1720, ["PK id", "FK cargo_id", "FK requested_by", "FK assigned_to", "status", "decision"]),
    "cargo_locations": ("cargo", 2350, 2320, ["PK id", "FK cargo_id", "FK bin_id", "FK assigned_by", "is_current"]),
    "cargo_movements": ("cargo", 2350, 2850, ["PK id", "FK cargo_id", "FK from_bin_id", "FK to_bin_id", "FK moved_by_user_id"]),

    "tariffs": ("finance", 3280, 350, ["PK id", "UQ public_reference", "name", "status"]),
    "tariff_versions": ("finance", 3280, 820, ["PK id", "FK tariff_id", "version", "rates", "approval_status"]),
    "cargo_charge_ledgers": ("finance", 3280, 1370, ["PK id", "FK cargo_id", "FK tariff_version_id", "amount", "status"]),
    "invoices": ("finance", 3280, 1940, ["PK id", "UQ invoice_number", "FK cargo_id", "FK tariff_version_id", "total_amount", "paid_amount", "status"]),
    "invoice_line_items": ("finance", 3280, 2650, ["PK id", "FK invoice_id", "description", "quantity", "amount"]),
    "payments": ("finance", 4050, 1940, ["PK id", "UQ payment_reference", "FK invoice_id", "amount", "provider", "status"]),
    "payment_webhook_events": ("finance", 4050, 2650, ["PK id", "UQ provider_event_id", "FK payment_id", "signature_valid", "processed_at"]),

    "customs_records": ("clearance", 4050, 350, ["PK id", "FK cargo_id", "FK officer_id", "status", "inspection_notes"]),
    "customs_status_history": ("clearance", 4050, 950, ["PK id", "FK cargo_id", "FK customs_record_id", "FK changed_by", "from / to status"]),
    "dispatch_requests": ("clearance", 4050, 1370, ["PK id", "FK cargo_id", "FK requested_by", "status", "FK decided_by"]),
    "gate_out_records": ("clearance", 4050, 3200, ["PK id", "UQ/FK cargo_id", "FK dispatch_request_id", "FK released_by", "released_at"]),
    "management_release_requests": ("clearance", 2350, 3320, ["PK id", "FK cargo_id", "FK requested_by", "FK decided_by", "status"]),
}

BOX_W = 650
LINE_H = 34

def box_height(fields): return 70 + 24 + len(fields) * LINE_H + 25

boxes = {name: (x, y, x + BOX_W, y + box_height(fields)) for name, (_, x, y, fields) in tables.items()}

relationships = [
    ("roles", "users", "1", "N"), ("roles", "role_permissions", "1", "N"),
    ("permissions", "role_permissions", "1", "N"), ("users", "user_sessions", "1", "N"),
    ("users", "scanner_sessions", "1", "N"), ("warehouses", "users", "1", "N"),
    ("warehouses", "zones", "1", "N"), ("zones", "racks", "1", "N"),
    ("racks", "levels", "1", "N"), ("levels", "bins", "1", "N"),
    ("warehouses", "cargo", "1", "N"), ("bins", "cargo", "1", "N"),
    ("cargo", "cargo_documents", "1", "N"), ("cargo", "approval_requests", "1", "N"),
    ("cargo", "cargo_locations", "1", "N"), ("bins", "cargo_locations", "1", "N"),
    ("cargo", "cargo_movements", "1", "N"), ("bins", "cargo_movements", "1", "N"),
    ("tariffs", "tariff_versions", "1", "N"), ("tariff_versions", "cargo_charge_ledgers", "1", "N"),
    ("cargo", "cargo_charge_ledgers", "1", "N"), ("cargo", "invoices", "1", "N"),
    ("tariff_versions", "invoices", "1", "N"), ("invoices", "invoice_line_items", "1", "N"),
    ("invoices", "payments", "1", "N"), ("payments", "payment_webhook_events", "1", "N"),
    ("cargo", "customs_records", "1", "N"), ("customs_records", "customs_status_history", "1", "N"),
    ("cargo", "dispatch_requests", "1", "N"), ("dispatch_requests", "gate_out_records", "1", "0..1"),
    ("cargo", "gate_out_records", "1", "0..1"), ("cargo", "management_release_requests", "1", "N"),
]

def anchor(a, b):
    A, B = boxes[a], boxes[b]
    ac=((A[0]+A[2])//2,(A[1]+A[3])//2); bc=((B[0]+B[2])//2,(B[1]+B[3])//2)
    if abs(bc[0]-ac[0]) >= abs(bc[1]-ac[1]):
        p1=(A[2] if bc[0]>ac[0] else A[0], ac[1]); p2=(B[0] if bc[0]>ac[0] else B[2], bc[1])
    else:
        p1=(ac[0], A[3] if bc[1]>ac[1] else A[1]); p2=(bc[0], B[1] if bc[1]>ac[1] else B[3])
    return p1,p2

# Header
d.rectangle((0,0,W,250), fill="#17365D")
d.text((120,55), "FUMBA PORT WAREHOUSE MANAGEMENT SYSTEM", font=F_TITLE, fill="white")
d.text((125,155), "Entity–Relationship Diagram • PostgreSQL implementation baseline • 2 September 2026", font=F_SUB, fill="#D9EAF7")

# Domain bands
bands=[("IDENTITY & ACCESS", "identity", 80, 2130), ("STORAGE TOPOLOGY", "storage", 1460, 2180),
       ("CARGO WORKFLOW", "cargo", 2310, 3060), ("FINANCE", "finance", 3240, 3990),
       ("CUSTOMS & RELEASE", "clearance", 4010, 4930)]
for label,dom,x1,x2 in bands:
    c=COLORS[dom]; d.rounded_rectangle((x1,275,x2,335),20,fill=c); d.text(((x1+x2)//2,305),label,font=F_DOMAIN,fill="white",anchor="mm")

# Relationship lines behind tables
for a,b,ca,cb in relationships:
    p1,p2=anchor(a,b)
    mid=((p1[0]+p2[0])//2, (p1[1]+p2[1])//2)
    # orthogonal elbow, using the least disruptive primary direction
    if abs(p2[0]-p1[0]) >= abs(p2[1]-p1[1]): pts=[p1,(mid[0],p1[1]),(mid[0],p2[1]),p2]
    else: pts=[p1,(p1[0],mid[1]),(p2[0],mid[1]),p2]
    d.line(pts, fill="#9AA9B8", width=5)
    d.ellipse((p1[0]-7,p1[1]-7,p1[0]+7,p1[1]+7),fill="#56687A")
    # arrow head at child end
    d.polygon([(p2[0],p2[1]),(p2[0]-18,p2[1]-12),(p2[0]-18,p2[1]+12)],fill="#56687A")
    d.text((p1[0]+10,p1[1]-28),ca,font=F_LEGEND,fill="#3D4D5C")
    d.text((p2[0]-45,p2[1]-28),cb,font=F_LEGEND,fill="#3D4D5C")

# Entity boxes
for name,(dom,x,y,fields) in tables.items():
    x2,y2=boxes[name][2],boxes[name][3]; color=COLORS[dom]
    d.rounded_rectangle((x,y,x2,y2),radius=16,fill="white",outline=color,width=5)
    d.rounded_rectangle((x,y,x2,y+70),radius=16,fill=color)
    d.rectangle((x,y+52,x2,y+70),fill=color)
    d.text((x+20,y+35),name,font=F_HEAD,fill="white",anchor="lm")
    yy=y+92
    for field in fields:
        if field.startswith("PK"): fill="#17365D"
        elif "FK" in field: fill="#8A3E54"
        else: fill="#334455"
        d.text((x+22,yy),field,font=F_FIELD,fill=fill,anchor="lm")
        yy += LINE_H

# Legend
d.rounded_rectangle((110,3680,2050,3850),20,fill="white",outline="#B7C9D9",width=4)
d.text((145,3720),"Notation",font=F_HEAD,fill="#17365D")
d.text((145,3775),"PK primary key   •   FK foreign key   •   UQ unique   •   1:N parent-to-child",font=F_LEGEND,fill="#3D4D5C")
d.text((2800,3835),"Core operational ERD derived from schema.sql and database migrations. Configuration, policy-history and audit-support tables are summarized by domain.",font=F_LEGEND,fill="#5B6573",anchor="ms")

img.save(OUT, quality=95, dpi=(180,180))
print(OUT)
