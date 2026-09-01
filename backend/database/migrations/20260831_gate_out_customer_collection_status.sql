-- Keep historical Gate-Out cargo consistent with the authoritative dispatched state.
UPDATE cargo
SET placement_status = 'Dispatched',
    current_bin_id = NULL,
    location = 'Collected by Customer (Gate Out)',
    released_at = COALESCE(released_at, charge_end_at, updated_at),
    updated_at = CURRENT_TIMESTAMP
WHERE is_deleted = FALSE
  AND (
    gate_out_status IN ('Released', 'Emergency Released')
    OR released_at IS NOT NULL
  )
  AND (
    placement_status IS DISTINCT FROM 'Dispatched'
    OR current_bin_id IS NOT NULL
    OR location IS DISTINCT FROM 'Collected by Customer (Gate Out)'
  );
