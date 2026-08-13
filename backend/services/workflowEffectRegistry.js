const definitions = Object.freeze({
  update_registration_state: {
    description: "Updates the authoritative cargo registration status using a trusted state mapping.",
    supported_workflows: ["cargo_registration"],
    apply: async ({ executor, cargo, toState, input }) => executor.query(
      `UPDATE cargo SET registration_status=$1, updated_at=CURRENT_TIMESTAMP WHERE id=$2 RETURNING *`,
      [toState.storage_value, cargo.id]
    )
  },
  update_placement_state: {
    description: "Updates placement state and trusted placement fields after Phase 4 validation.",
    supported_workflows: ["cargo_placement"],
    apply: async ({ executor, cargo, toState, input }) => executor.query(
      `UPDATE cargo
       SET placement_status=$1, location=COALESCE($2,location), current_bin_id=COALESCE($3,current_bin_id),
           relocation_required=FALSE, relocation_reason=NULL, relocation_flagged_at=NULL, updated_at=CURRENT_TIMESTAMP
       WHERE id=$4 RETURNING *`,
      [toState.storage_value, input.location || null, input.bin_id || null, cargo.id]
    )
  }
});

module.exports = { workflowEffectRegistry: definitions };
