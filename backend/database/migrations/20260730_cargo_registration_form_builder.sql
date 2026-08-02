CREATE TABLE IF NOT EXISTS cargo_registration_fields (
  id SERIAL PRIMARY KEY,
  field_key VARCHAR(100) UNIQUE NOT NULL,
  core_field BOOLEAN NOT NULL DEFAULT TRUE,
  field_type VARCHAR(30) NOT NULL,
  system_protected BOOLEAN NOT NULL DEFAULT FALSE,
  required_locked BOOLEAN NOT NULL DEFAULT FALSE,
  editable_locked BOOLEAN NOT NULL DEFAULT FALSE,
  conditional_rule JSONB NOT NULL DEFAULT '{}'::jsonb,
  option_values JSONB NOT NULL DEFAULT '[]'::jsonb,
  label VARCHAR(120) NOT NULL,
  help_text TEXT,
  visible BOOLEAN NOT NULL DEFAULT TRUE,
  required BOOLEAN NOT NULL DEFAULT FALSE,
  editable BOOLEAN NOT NULL DEFAULT TRUE,
  display_order INTEGER NOT NULL,
  default_value JSONB,
  placeholder TEXT,
  section_key VARCHAR(80) NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  default_label VARCHAR(120) NOT NULL,
  default_help_text TEXT,
  default_visible BOOLEAN NOT NULL,
  default_required BOOLEAN NOT NULL,
  default_editable BOOLEAN NOT NULL,
  default_display_order INTEGER NOT NULL,
  default_value_snapshot JSONB,
  default_placeholder TEXT,
  default_section_key VARCHAR(80) NOT NULL,
  default_active BOOLEAN NOT NULL,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (field_type IN ('text', 'textarea', 'number', 'datetime', 'select', 'checkbox', 'file', 'system')),
  CHECK (display_order > 0),
  CHECK (default_display_order > 0)
);

CREATE TABLE IF NOT EXISTS cargo_custom_field_values (
  id SERIAL PRIMARY KEY,
  cargo_id INTEGER NOT NULL REFERENCES cargo(id) ON DELETE CASCADE,
  field_id INTEGER NOT NULL REFERENCES cargo_registration_fields(id) ON DELETE RESTRICT,
  field_value JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (cargo_id, field_id)
);

CREATE INDEX IF NOT EXISTS idx_cargo_registration_fields_published
  ON cargo_registration_fields(active, visible, display_order);

CREATE INDEX IF NOT EXISTS idx_cargo_custom_field_values_cargo
  ON cargo_custom_field_values(cargo_id);

INSERT INTO cargo_registration_fields (
  field_key, field_type, system_protected, required_locked, editable_locked,
  conditional_rule, option_values, label, help_text, visible, required, editable,
  display_order, default_value, placeholder, section_key, active,
  default_label, default_help_text, default_visible, default_required,
  default_editable, default_display_order, default_value_snapshot,
  default_placeholder, default_section_key, default_active
)
VALUES
('consignee_name','text',TRUE,TRUE,FALSE,'{}','[]','Consignee Name','Person or organization receiving the cargo.',TRUE,TRUE,TRUE,10,NULL,'"Enter consignee name','consignee',TRUE,'Consignee Name','Person or organization receiving the cargo.',TRUE,TRUE,TRUE,10,NULL,'"Enter consignee name','consignee',TRUE),
('company_name','text',FALSE,FALSE,FALSE,'{}','[]','Company Name','Consignee company or organization.',TRUE,FALSE,TRUE,20,NULL,'"Enter company name','consignee',TRUE,'Company Name','Consignee company or organization.',TRUE,FALSE,TRUE,20,NULL,'"Enter company name','consignee',TRUE),
('contact_person','text',FALSE,FALSE,FALSE,'{}','[]','Contact Person','Primary person to contact about this cargo.',TRUE,FALSE,TRUE,30,NULL,'"Enter contact person','consignee',TRUE,'Contact Person','Primary person to contact about this cargo.',TRUE,FALSE,TRUE,30,NULL,'"Enter contact person','consignee',TRUE),
('phone_number','text',TRUE,TRUE,FALSE,'{}','[]','Phone Number','Validated consignee contact number.',TRUE,TRUE,TRUE,40,NULL,'+255 ...','consignee',TRUE,'Phone Number','Validated consignee contact number.',TRUE,TRUE,TRUE,40,NULL,'+255 ...','consignee',TRUE),
('email','text',FALSE,FALSE,FALSE,'{}','[]','Email Address','Consignee contact email.',TRUE,FALSE,TRUE,50,NULL,'name@company.com','consignee',TRUE,'Email Address','Consignee contact email.',TRUE,FALSE,TRUE,50,NULL,'name@company.com','consignee',TRUE),
('source_of_cargo','select',TRUE,TRUE,FALSE,'{}','["Container","Truck","Ship Transfer","Manual Delivery","Customs Hold Release","Other"]','Source of Cargo','How the cargo arrived at the warehouse.',TRUE,TRUE,TRUE,60,'"Container"','Select cargo source','cargo',TRUE,'Source of Cargo','How the cargo arrived at the warehouse.',TRUE,TRUE,TRUE,60,'"Container"','Select cargo source','cargo',TRUE),
('container_number','text',TRUE,FALSE,FALSE,'{"field":"source_of_cargo","operator":"equals","value":"Container","required":true}','[]','Container Number','Required automatically when cargo source is Container.',TRUE,FALSE,TRUE,70,NULL,'e.g. MSCU1234567','cargo',TRUE,'Container Number','Required automatically when cargo source is Container.',TRUE,FALSE,TRUE,70,NULL,'e.g. MSCU1234567','cargo',TRUE),
('vehicle_number','text',TRUE,FALSE,FALSE,'{"field":"source_of_cargo","operator":"in","value":["Truck","Manual Delivery"],"required":true}','[]','Vehicle Number','Required automatically for Truck or Manual Delivery.',TRUE,FALSE,TRUE,80,NULL,'e.g. T 123 ABC','cargo',TRUE,'Vehicle Number','Required automatically for Truck or Manual Delivery.',TRUE,FALSE,TRUE,80,NULL,'e.g. T 123 ABC','cargo',TRUE),
('cargo_type','select',TRUE,TRUE,FALSE,'{}','["General Goods","Electronics","Machinery","Food Products","Construction Materials","Fragile Goods","Hazardous Cargo","Mixed Cargo"]','Cargo Type','Classification used by storage and workflow rules.',TRUE,TRUE,TRUE,90,'"General Goods"','Select cargo type','cargo',TRUE,'Cargo Type','Classification used by storage and workflow rules.',TRUE,TRUE,TRUE,90,'"General Goods"','Select cargo type','cargo',TRUE),
('hazard_class','select',TRUE,FALSE,FALSE,'{"field":"cargo_type","operator":"equals","value":"Hazardous Cargo","required":true}','["Flammable","Corrosive","Explosive","Toxic","Oxidizing","Compressed Gas","Radioactive","Other Hazardous"]','Hazard Class','Required automatically for Hazardous Cargo.',TRUE,FALSE,TRUE,100,'"Flammable"','Select hazard class','cargo',TRUE,'Hazard Class','Required automatically for Hazardous Cargo.',TRUE,FALSE,TRUE,100,'"Flammable"','Select hazard class','cargo',TRUE),
('packaging_type','select',FALSE,FALSE,FALSE,'{}','["Boxes","Cartons","Pallets","Crates","Bags","Drums","Loose Cargo","Containerized","Other"]','Packaging Type','How the cargo is packaged.',TRUE,FALSE,TRUE,110,'"Boxes"','Select packaging type','cargo',TRUE,'Packaging Type','How the cargo is packaged.',TRUE,FALSE,TRUE,110,'"Boxes"','Select packaging type','cargo',TRUE),
('quantity','number',TRUE,TRUE,FALSE,'{}','[]','Quantity','Cargo item or package quantity; must be greater than zero.',TRUE,TRUE,TRUE,120,NULL,'1','cargo',TRUE,'Quantity','Cargo item or package quantity; must be greater than zero.',TRUE,TRUE,TRUE,120,NULL,'1','cargo',TRUE),
('weight','number',TRUE,TRUE,FALSE,'{}','[]','Weight (kg)','Total cargo weight in kilograms.',TRUE,TRUE,TRUE,130,NULL,'0.00','cargo',TRUE,'Weight (kg)','Total cargo weight in kilograms.',TRUE,TRUE,TRUE,130,NULL,'0.00','cargo',TRUE),
('volume','number',TRUE,TRUE,FALSE,'{}','[]','Volume (m³)','Total cargo volume in cubic metres.',TRUE,TRUE,TRUE,140,NULL,'0.00','cargo',TRUE,'Volume (m³)','Total cargo volume in cubic metres.',TRUE,TRUE,TRUE,140,NULL,'0.00','cargo',TRUE),
('cargo_condition','select',TRUE,TRUE,FALSE,'{}','["Good","Damaged","Wet","Leaking","Broken Packaging","Requires Inspection"]','Cargo Condition','Condition observed when cargo is received.',TRUE,TRUE,TRUE,150,'"Good"','Select cargo condition','cargo',TRUE,'Cargo Condition','Condition observed when cargo is received.',TRUE,TRUE,TRUE,150,'"Good"','Select cargo condition','cargo',TRUE),
('cargo_description','textarea',FALSE,FALSE,FALSE,'{}','[]','Cargo Description','Contents, markings, handling notes, or visible identifiers.',TRUE,FALSE,TRUE,160,NULL,'Describe received cargo','cargo',TRUE,'Cargo Description','Contents, markings, handling notes, or visible identifiers.',TRUE,FALSE,TRUE,160,NULL,'Describe received cargo','cargo',TRUE),
('inspection_notes','textarea',TRUE,FALSE,FALSE,'{"field":"cargo_condition","operator":"not_equals","value":"Good","required":true}','[]','Inspection Notes','Required automatically when cargo condition is not Good.',TRUE,FALSE,TRUE,170,NULL,'Record inspection findings','receiving',TRUE,'Inspection Notes','Required automatically when cargo condition is not Good.',TRUE,FALSE,TRUE,170,NULL,'Record inspection findings','receiving',TRUE),
('received_by','system',TRUE,TRUE,TRUE,'{}','[]','Receiving User','Authenticated user receiving the cargo.',TRUE,TRUE,FALSE,180,NULL,NULL,'receiving',TRUE,'Receiving User','Authenticated user receiving the cargo.',TRUE,TRUE,FALSE,180,NULL,NULL,'receiving',TRUE),
('received_datetime','datetime',TRUE,TRUE,TRUE,'{}','[]','Received Date and Time','Timestamp when cargo is received.',TRUE,TRUE,FALSE,190,NULL,NULL,'receiving',TRUE,'Received Date and Time','Timestamp when cargo is received.',TRUE,TRUE,FALSE,190,NULL,NULL,'receiving',TRUE),
('delivery_note_number','text',FALSE,FALSE,FALSE,'{}','[]','Delivery Note Number','Delivery note or consignment reference.',TRUE,FALSE,TRUE,200,NULL,'DN-2026-...','receiving',TRUE,'Delivery Note Number','Delivery note or consignment reference.',TRUE,FALSE,TRUE,200,NULL,'DN-2026-...','receiving',TRUE),
('receiving_warehouse','system',TRUE,TRUE,TRUE,'{}','[]','Receiving Warehouse','Warehouse assigned to the authenticated user.',TRUE,TRUE,FALSE,210,NULL,NULL,'receiving',TRUE,'Receiving Warehouse','Warehouse assigned to the authenticated user.',TRUE,TRUE,FALSE,210,NULL,NULL,'receiving',TRUE),
('supporting_documents','file',FALSE,FALSE,FALSE,'{}','[]','Supporting Documents','PDF, DOCX, JPG, or PNG; maximum 10MB per file.',TRUE,FALSE,TRUE,220,NULL,'Choose supporting documents','documents',TRUE,'Supporting Documents','PDF, DOCX, JPG, or PNG; maximum 10MB per file.',TRUE,FALSE,TRUE,220,NULL,'Choose supporting documents','documents',TRUE),
('system_identifiers','system',TRUE,TRUE,TRUE,'{}','[]','System-generated Identifiers','Cargo reference, barcode, and reference number are generated after saving.',TRUE,TRUE,FALSE,230,NULL,NULL,'system',TRUE,'System-generated Identifiers','Cargo reference, barcode, and reference number are generated after saving.',TRUE,TRUE,FALSE,230,NULL,NULL,'system',TRUE),
('registration_workflow','system',TRUE,TRUE,TRUE,'{}','[]','Registration Workflow','New cargo enters Pending Review and remains Unplaced until approval.',TRUE,TRUE,FALSE,240,NULL,NULL,'system',TRUE,'Registration Workflow','New cargo enters Pending Review and remains Unplaced until approval.',TRUE,TRUE,FALSE,240,NULL,NULL,'system',TRUE)
ON CONFLICT (field_key) DO NOTHING;

INSERT INTO permissions (permission_key, description, module, system_protected)
VALUES
  ('system.cargo_registration_form.view', 'View cargo registration form configuration.', 'system', TRUE),
  ('system.cargo_registration_form.manage', 'Update and reset cargo registration form configuration.', 'system', TRUE)
ON CONFLICT (permission_key) DO UPDATE
SET description = EXCLUDED.description,
    module = EXCLUDED.module,
    system_protected = EXCLUDED.system_protected;

