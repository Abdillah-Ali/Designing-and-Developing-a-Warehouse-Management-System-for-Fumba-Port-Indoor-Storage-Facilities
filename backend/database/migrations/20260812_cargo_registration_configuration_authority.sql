ALTER TABLE cargo_registration_fields
  ADD COLUMN IF NOT EXISTS field_classification VARCHAR(30),
  ADD COLUMN IF NOT EXISTS catalog_key VARCHAR(80);

UPDATE cargo_registration_fields SET field_classification = CASE
  WHEN field_key IN ('received_by','received_datetime','receiving_warehouse','system_identifiers','registration_workflow') THEN 'system_managed'
  WHEN field_key IN ('container_number','vehicle_number','hazard_class','inspection_notes') THEN 'conditional_required'
  WHEN field_key IN ('company_name','contact_person','email','packaging_type','cargo_description','delivery_note_number') THEN 'configurable_required'
  WHEN field_key = 'supporting_documents' THEN 'optional'
  ELSE 'system_required'
END WHERE field_classification IS NULL;

ALTER TABLE cargo_registration_fields ALTER COLUMN field_classification SET NOT NULL;
ALTER TABLE cargo_registration_fields DROP CONSTRAINT IF EXISTS cargo_registration_fields_classification_check;
ALTER TABLE cargo_registration_fields ADD CONSTRAINT cargo_registration_fields_classification_check
  CHECK (field_classification IN ('system_required','configurable_required','conditional_required','optional','system_managed'));

CREATE TABLE IF NOT EXISTS cargo_option_catalogs (
  catalog_key VARCHAR(80) PRIMARY KEY,
  display_label VARCHAR(120) NOT NULL,
  description TEXT,
  is_system_protected BOOLEAN NOT NULL DEFAULT TRUE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS cargo_option_values (
  id BIGSERIAL PRIMARY KEY,
  public_reference VARCHAR(80) NOT NULL DEFAULT ('COV-' || UPPER(ENCODE(GEN_RANDOM_BYTES(10),'hex'))),
  catalog_key VARCHAR(80) NOT NULL REFERENCES cargo_option_catalogs(catalog_key) ON DELETE RESTRICT,
  option_key VARCHAR(100) NOT NULL,
  storage_value VARCHAR(180) NOT NULL,
  display_label VARCHAR(180) NOT NULL,
  description TEXT,
  sort_order INTEGER NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  is_system_protected BOOLEAN NOT NULL DEFAULT FALSE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE(public_reference), UNIQUE(catalog_key,option_key), UNIQUE(catalog_key,storage_value),
  CHECK (sort_order > 0), CHECK (jsonb_typeof(metadata)='object')
);

CREATE TABLE IF NOT EXISTS cargo_registration_conditions (
  id BIGSERIAL PRIMARY KEY,
  public_reference VARCHAR(80) NOT NULL DEFAULT ('CRC-' || UPPER(ENCODE(GEN_RANDOM_BYTES(10),'hex'))),
  condition_key VARCHAR(100) NOT NULL,
  controlling_field_key VARCHAR(100) NOT NULL REFERENCES cargo_registration_fields(field_key) ON DELETE RESTRICT,
  operator VARCHAR(30) NOT NULL,
  expected_value JSONB NOT NULL,
  target_field_key VARCHAR(100) NOT NULL REFERENCES cargo_registration_fields(field_key) ON DELETE RESTRICT,
  requirement VARCHAR(30) NOT NULL DEFAULT 'required',
  sort_order INTEGER NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE(public_reference), UNIQUE(condition_key),
  CHECK (operator IN ('equals','not_equals','in')),
  CHECK (requirement='required'), CHECK (sort_order > 0)
);

CREATE INDEX IF NOT EXISTS idx_cargo_option_values_active_order ON cargo_option_values(catalog_key,is_active,sort_order);
CREATE INDEX IF NOT EXISTS idx_cargo_registration_conditions_active_order ON cargo_registration_conditions(is_active,sort_order);

INSERT INTO cargo_option_catalogs(catalog_key,display_label,description) VALUES
('cargo_source','Cargo Sources','Operational cargo-arrival sources.'),
('cargo_type','Cargo Types','Cargo classifications used by storage and downstream compatibility rules.'),
('packaging_type','Packaging Types','Cargo packaging methods.'),
('cargo_condition','Cargo Conditions','Observed receiving condition.'),
('hazard_class','Hazard Classes','Hazard classifications for hazardous cargo.')
ON CONFLICT (catalog_key) DO NOTHING;

INSERT INTO cargo_option_values(catalog_key,option_key,storage_value,display_label,sort_order,is_system_protected) VALUES
('cargo_source','container','Container','Container',10,TRUE),('cargo_source','truck','Truck','Truck',20,TRUE),('cargo_source','ship_transfer','Ship Transfer','Ship Transfer',30,TRUE),('cargo_source','manual_delivery','Manual Delivery','Manual Delivery',40,TRUE),('cargo_source','customs_hold_release','Customs Hold Release','Customs Hold Release',50,TRUE),('cargo_source','other','Other','Other',60,FALSE),
('cargo_type','general_goods','General Goods','General Goods',10,TRUE),('cargo_type','electronics','Electronics','Electronics',20,FALSE),('cargo_type','machinery','Machinery','Machinery',30,FALSE),('cargo_type','food_products','Food Products','Food Products',40,FALSE),('cargo_type','construction_materials','Construction Materials','Construction Materials',50,FALSE),('cargo_type','fragile_goods','Fragile Goods','Fragile Goods',60,TRUE),('cargo_type','hazardous_cargo','Hazardous Cargo','Hazardous Cargo',70,TRUE),('cargo_type','mixed_cargo','Mixed Cargo','Mixed Cargo',80,FALSE),
('packaging_type','boxes','Boxes','Boxes',10,FALSE),('packaging_type','cartons','Cartons','Cartons',20,FALSE),('packaging_type','pallets','Pallets','Pallets',30,FALSE),('packaging_type','crates','Crates','Crates',40,FALSE),('packaging_type','bags','Bags','Bags',50,FALSE),('packaging_type','drums','Drums','Drums',60,FALSE),('packaging_type','loose_cargo','Loose Cargo','Loose Cargo',70,FALSE),('packaging_type','containerized','Containerized','Containerized',80,FALSE),('packaging_type','other','Other','Other',90,FALSE),
('cargo_condition','good','Good','Good',10,TRUE),('cargo_condition','damaged','Damaged','Damaged',20,TRUE),('cargo_condition','wet','Wet','Wet',30,TRUE),('cargo_condition','leaking','Leaking','Leaking',40,TRUE),('cargo_condition','broken_packaging','Broken Packaging','Broken Packaging',50,TRUE),('cargo_condition','requires_inspection','Requires Inspection','Requires Inspection',60,TRUE),
('hazard_class','flammable','Flammable','Flammable',10,TRUE),('hazard_class','corrosive','Corrosive','Corrosive',20,TRUE),('hazard_class','explosive','Explosive','Explosive',30,TRUE),('hazard_class','toxic','Toxic','Toxic',40,TRUE),('hazard_class','oxidizing','Oxidizing','Oxidizing',50,TRUE),('hazard_class','compressed_gas','Compressed Gas','Compressed Gas',60,TRUE),('hazard_class','radioactive','Radioactive','Radioactive',70,TRUE),('hazard_class','other_hazardous','Other Hazardous','Other Hazardous',80,FALSE)
ON CONFLICT (catalog_key,option_key) DO NOTHING;

UPDATE cargo_registration_fields SET catalog_key=CASE field_key
 WHEN 'source_of_cargo' THEN 'cargo_source' WHEN 'cargo_type' THEN 'cargo_type'
 WHEN 'packaging_type' THEN 'packaging_type' WHEN 'cargo_condition' THEN 'cargo_condition'
 WHEN 'hazard_class' THEN 'hazard_class' END
WHERE field_key IN ('source_of_cargo','cargo_type','packaging_type','cargo_condition','hazard_class');

INSERT INTO cargo_registration_conditions(condition_key,controlling_field_key,operator,expected_value,target_field_key,sort_order) VALUES
('container_requires_number','source_of_cargo','equals','"container"'::jsonb,'container_number',10),
('vehicle_source_requires_vehicle','source_of_cargo','in','["truck","manual_delivery"]'::jsonb,'vehicle_number',20),
('hazardous_requires_class','cargo_type','equals','"hazardous_cargo"'::jsonb,'hazard_class',30),
('non_good_requires_notes','cargo_condition','not_equals','"good"'::jsonb,'inspection_notes',40)
ON CONFLICT (condition_key) DO NOTHING;

UPDATE cargo_registration_fields SET option_values='[]'::jsonb,conditional_rule='{}'::jsonb
WHERE catalog_key IS NOT NULL OR field_classification='conditional_required';
