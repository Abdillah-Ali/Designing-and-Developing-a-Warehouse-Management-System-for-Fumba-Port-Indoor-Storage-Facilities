# Backend Data Exposure & Control Guide

## Overview

This document outlines which backend data is exposed to the frontend through API endpoints and how to control or modify what fields are returned.

---

## 1. WAREHOUSE HIERARCHY ENTITIES

### 1.1 Warehouses

**API Endpoint:** `GET /api/warehouses` (or via `/api/zones`)

**Data Exposed to Frontend:**

```
id, warehouse_name, warehouse_code, warehouse_letter, description
total_capacity, max_volume
occupancy_warning_threshold, full_threshold
status (active/inactive)
created_at, updated_at
assigned_user_count, zone_count, bin_total
available_bins, occupied_bins, full_bins, blocked_bins, maintenance_bins, damaged_bins
current_weight_capacity, current_volume_capacity
weight_occupancy_percent
```

**Where it's defined:** [backend/controllers/warehouseController.js](backend/controllers/warehouseController.js) - `formatWarehouse()` function

**To hide/modify fields:**

1. Edit `formatWarehouse()` in warehouseController.js
2. Return only the fields you want (e.g., remove `occupancy_warning_threshold`)

---

### 1.2 Zones

**API Endpoint:** `GET /api/zones` (or `/api/zones/:id`)

**Data Exposed to Frontend:**

```
id, zone_id, warehouse_id, zone_letter, warehouse_name, warehouse_code
code, zone_code, name, zone_name, description
zone_type, allowed_cargo_type, cargo_type_allowed
handling_condition, is_hazard_zone
max_weight, max_volume
rack_count, level_count, bins_per_level
status, active
created_at, updated_at
rack_total, level_total, bin_total
available_bins, occupied_bins, blocked_bins, reserved_bins
max_weight_capacity, max_volume_capacity
current_weight_capacity, current_volume_capacity
weight_occupancy_percent, volume_occupancy_percent
```

**Where it's defined:** [backend/controllers/zoneController.js](backend/controllers/zoneController.js) - `zoneSelect()` function (SQL query)

**To hide/modify fields:**

1. Edit the SQL `zoneSelect()` function in zoneController.js (lines 12-53)
2. Remove unwanted SELECT columns before the FROM clause
3. Example: Remove `is_hazard_zone` from the SELECT list to hide it from the frontend

---

### 1.3 Racks

**API Endpoint:** `GET /api/racks` (or `/api/racks/by-zone/:zoneId`, `/api/racks/:id`)

**Data Exposed to Frontend:**

```
id, rack_id, zone_id, rack_letter, code, rack_code
name, rack_name, max_weight, max_volume
status, active
created_at, updated_at
zone_code, zone_name, warehouse_id, warehouse_name, warehouse_code
level_total, bin_total
available_bins, occupied_bins, blocked_bins, reserved_bins
current_weight_capacity, current_volume_capacity
weight_occupancy_percent, volume_occupancy_percent
```

**Where it's defined:** [backend/controllers/rackController.js](backend/controllers/rackController.js) - `rackSelect()` function

**To hide/modify fields:**

1. Edit the SQL `rackSelect()` function in rackController.js (lines 7-31)
2. Comment out or remove unwanted SELECT columns

---

### 1.4 Levels

**API Endpoint:** `GET /api/levels` (or `/api/levels/by-rack/:rackId`, `/api/levels/:id`)

**Data Exposed to Frontend:**

```
id, level_id, rack_id, code, level_code, name, level_name
level_number, max_weight, max_volume
status, active
created_at, updated_at
rack_code, zone_id, zone_code, zone_name
warehouse_id, warehouse_name, warehouse_code
bin_total, available_bins, occupied_bins, blocked_bins, reserved_bins
current_weight_capacity, current_volume_capacity
weight_occupancy_percent, volume_occupancy_percent
```

**Where it's defined:** [backend/controllers/levelController.js](backend/controllers/levelController.js) - `levelSelect()` function

**To hide/modify fields:**

1. Edit the SQL `levelSelect()` function in levelController.js (lines 7-33)
2. Remove SELECT columns as needed

---

### 1.5 Bins

**API Endpoint:** `GET /api/bins` (or `/api/bins/by-level/:levelId`, `/api/bins/:id`)

**Data Exposed to Frontend:**

```
id, bin_id, level_id, bin_identifier, name, bin_name
bin_type, length, width, height
volume_capacity, weight_capacity
current_occupancy, creation_status, operational_status
cargo_restrictions, code, bin_code, barcode, bin_barcode
max_weight, capacity_weight, max_volume, capacity_volume
current_weight, current_volume
status, active, allowed_cargo_type, reserved_for_cargo_type
created_at, updated_at
level_code, level_number, rack_id, rack_code
zone_id, zone_code, zone_name, warehouse_id, warehouse_name, warehouse_code
location_display, location_path, display_location
weight_occupancy_percent, volume_occupancy_percent
```

**Where it's defined:** [backend/controllers/binController.js](backend/controllers/binController.js) - `binSelect` constant

**To hide/modify fields:**

1. Edit the `binSelect` constant in binController.js (lines 11-51)
2. Remove unwanted SELECT expressions

---

## 2. CONFIGURATION & RULES

### 2.1 Capacity Configuration

**API Endpoint:** `GET /api/capacity-configurations`

**Data Exposed:**

```
entity_type (Warehouse/Zone/Rack/Level/Bin)
entity_id, parent_id, entity_name
max_weight, max_volume
occupancy_warning_threshold, full_threshold
status, allow_child_capacity_override
current_weight, current_volume
weight_usage_percent, volume_usage_percent
configuration_id
```

**Where it's defined:** [backend/controllers/capacityConfigurationController.js](backend/controllers/capacityConfigurationController.js) - `getCapacityConfigurations()` SQL query

---

### 2.2 Bin Rules

**API Endpoint:** `GET /api/bin-rules`

**Data Exposed:**

```
rule_key, rule_name, description
is_active, parameters (JSON)
created_at, updated_at
```

**Where it's defined:** [backend/controllers/binRuleController.js](backend/controllers/binRuleController.js)

---

## 3. CARGO DATA

### 3.1 Cargo List

**API Endpoint:** `GET /api/cargo` (or `/api/cargo/my/submissions`)

**Data Exposed:**

```
id, cargo_id, barcode, qr_code
cargo_type, declared_value, declared_weight, declared_volume
origin_destination, destination_port
status, registration_status, placement_status, dispatch_authorization_status
customs_status, hazard_class
current_bin_id, warehouse_id
current_weight, current_volume
created_by, created_at, updated_at
[and many more fields from the cargo table]
```

**Where it's defined:** [backend/controllers/cargoController.js](backend/controllers/cargoController.js)

---

## 4. USER & PROFILE DATA

### 4.1 User Profile

**API Endpoint:** `GET /api/profile`

**Data Exposed:**

```
id, username, full_name, email
phone, role_name
warehouse_id, created_at, last_activity_at
```

**Where it's defined:** [backend/controllers/adminController.js](backend/controllers/adminController.js) - `getProfile()` function

---

## 5. HOW TO CONTROL DATA EXPOSURE

### Method 1: Modify SQL SELECT Clauses

**For:** Warehouse hierarchy (zones, racks, levels, bins)

**Steps:**

1. Open the controller file (e.g., `zoneController.js`)
2. Find the `xxxSelect()` function or SELECT query
3. Remove/add columns from the SELECT statement
4. Restart the backend

**Example:**

```javascript
// BEFORE: Exposes is_hazard_zone
const zoneSelect = (activeOnly) => `
  SELECT z.id, z.is_hazard_zone, ...
```

```javascript
// AFTER: Hides is_hazard_zone
const zoneSelect = (activeOnly) => `
  SELECT z.id, ... [omit is_hazard_zone]
```

---

### Method 2: Filter in Response Handler

**For:** Cargo, users, other non-SQL entities

**Steps:**

1. Find the controller function that sends the response (e.g., `getCargo()`)
2. Map the result to only include desired fields before `res.json()`
3. Example in cargoController.js:

```javascript
// BEFORE: Returns all cargo fields
res.json({ success: true, data: result.rows });

// AFTER: Filter to specific fields
const filteredCargo = result.rows.map((c) => ({
  id: c.id,
  cargo_id: c.cargo_id,
  barcode: c.barcode,
  cargo_type: c.cargo_type,
  status: c.status,
  // omit sensitive fields like declared_value, hazard_class
}));
res.json({ success: true, data: filteredCargo });
```

---

### Method 3: Create a Projection Function

**Best Practice:** For DRY code

**Example:**

```javascript
// In warehouseConfigurationService.js
const projectZoneForPublic = (zone) => ({
  id: zone.id,
  name: zone.name,
  code: zone.code,
  allowed_cargo_type: zone.allowed_cargo_type,
  bin_total: zone.bin_total,
  // omit: is_hazard_zone, occupancy_warning_threshold
});

// In zoneController.js
const result = await db.query(zoneSelectQuery);
res.json({
  success: true,
  data: result.rows.map(projectZoneForPublic),
});
```

---

## 6. SENSITIVE DATA CURRENTLY EXPOSED

### Fields to Consider Hiding:

- `occupancy_warning_threshold`, `full_threshold` (operational config)
- `is_hazard_zone` (security classification)
- `hazard_class` (cargo threat info)
- `declared_value` (financial data)
- `created_by`, `updated_by` (audit trail)
- Full `location_path` for bins (navigation info)
- User `email`, `phone` (PII)
- Warehouse `total_capacity` details (inventory visibility)

---

## 7. VERIFICATION CHECKLIST

After making changes to data exposure:

- [ ] Verify the frontend still displays correctly
- [ ] Check error handling if a field is missing
- [ ] Test each role (Admin, Supervisor, Staff) to ensure they only see appropriate data
- [ ] Run backend tests: `npm test`
- [ ] Check audit logs to confirm sensitive operations still log correctly
- [ ] Validate that form submissions don't require the hidden fields

---

## 8. FRONTEND API CALLS

The frontend makes these queries (via `api.js` service functions):

| Function            | Endpoint     | Uses Fields                                       |
| ------------------- | ------------ | ------------------------------------------------- |
| `getZones()`        | GET /zones   | name, code, allowed_cargo_type, bin_total         |
| `getRacks(zoneId)`  | GET /racks   | code, name, level_total, available_bins           |
| `getLevels(rackId)` | GET /levels  | level_number, code, bin_total                     |
| `getBins(levelId)`  | GET /bins    | barcode, code, status, max_weight, current_weight |
| `getCargo()`        | GET /cargo   | cargo_id, status, warehouse_id, current_bin_id    |
| `getProfile()`      | GET /profile | full_name, role_name, email                       |

**To modify:** Edit the corresponding GET endpoint controller to filter the response.

---

## 9. QUICK REFERENCE: WHERE TO MAKE CHANGES

| What to Hide              | Where to Edit                                                        |
| ------------------------- | -------------------------------------------------------------------- |
| Zone sensitivity info     | `zoneController.js` - `zoneSelect()`                                 |
| Bin thresholds            | `binController.js` - `binSelect`                                     |
| User details              | `adminController.js` - `getProfile()`                                |
| Cargo financial data      | `cargoController.js` - `getCargo()`                                  |
| Capacity config limits    | `capacityConfigurationController.js` - `getCapacityConfigurations()` |
| Audit fields (created_by) | The respective entity controller                                     |
