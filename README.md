# Cargo Status Model

Cargo now has two authoritative operational status fields:

- `registration_status`: `Pending Review`, `Approved`, `Correction Required`, or `Rejected`.
- `placement_status`: `Unplaced`, `Placed`, `Relocated`, or `Dispatched`.

Physical placement is allowed only when `registration_status = Approved`.
Pending Review, Correction Required, and Rejected cargo can appear in monitoring
or queue views for visibility, but placement validation and confirmation must
reject them.

The older `status` and `workflow_status` columns remain synchronized database aliases of
`registration_status` for backward compatibility. New application logic must not write or
interpret them independently.

Archived cargo uses `is_deleted`, `archived_at`, `archived_by`, and `archive_reason`.
Operational lists hide archived records. System Administrators can request
`GET /api/cargo?include_archived=true` for audit review.
