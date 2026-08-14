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
  },
  update_customs_state: {
    description: "Updates trusted Customs state and appends Customs evidence.",
    supported_workflows: ["customs"],
    apply: async ({ executor, cargo, actor, input, policy, toState }) => {
      const existing=await executor.query(`SELECT id FROM customs_records WHERE cargo_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1 FOR UPDATE`,[cargo.id]);
      const values=[toState.storage_value,toState.state_key,String(input.notes||'').trim()||null,String(input.documents_requested||'').trim()||null,actor?.userId||actor?.user_id||null];
      const record=existing.rowCount ? await executor.query(`UPDATE customs_records SET status=$1::varchar,status_key=$2::varchar,inspection_started_at=CASE WHEN $2::varchar='inspection_in_progress'::varchar THEN COALESCE(inspection_started_at,CURRENT_TIMESTAMP) ELSE inspection_started_at END,inspection_completed_at=CASE WHEN $2::varchar IN ('cleared'::varchar,'rejected'::varchar) THEN CURRENT_TIMESTAMP ELSE inspection_completed_at END,inspection_notes=COALESCE($3::text,inspection_notes),documents_requested=COALESCE($4::text,documents_requested),officer_id=$5,updated_at=CURRENT_TIMESTAMP WHERE id=$6 RETURNING *`,[...values,existing.rows[0].id]) : await executor.query(`INSERT INTO customs_records(public_reference,cargo_id,status,status_key,inspection_started_at,inspection_completed_at,inspection_notes,documents_requested,officer_id) VALUES('CUS-'||UPPER(SUBSTRING(REPLACE(gen_random_uuid()::text,'-',''),1,16)),$6,$1::varchar,$2::varchar,CASE WHEN $2::varchar='inspection_in_progress'::varchar THEN CURRENT_TIMESTAMP END,CASE WHEN $2::varchar IN ('cleared'::varchar,'rejected'::varchar) THEN CURRENT_TIMESTAMP END,$3::text,$4::text,$5) RETURNING *`,[...values,cargo.id]);
      await executor.query(`INSERT INTO customs_status_history(public_reference,cargo_id,customs_record_id,previous_status,new_status,notes,changed_by,metadata,transition_key,from_state_key,to_state_key,policy_revision)
        VALUES('CSH-'||UPPER(SUBSTRING(REPLACE(gen_random_uuid()::text,'-',''),1,16)),$1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11)`,[cargo.id,record.rows[0].id,cargo.customs_status,toState.storage_value,String(input.notes||'').trim()||null,actor?.userId||actor?.user_id||null,JSON.stringify({documents_requested:String(input.documents_requested||'').trim()||null}),policy.transition_key,policy.from_state_key,policy.to_state_key,policy.revision]);
      return executor.query(`UPDATE cargo SET customs_status=$1,customs_status_key=$2,updated_at=CURRENT_TIMESTAMP WHERE id=$3 RETURNING *`,[toState.storage_value,toState.state_key,cargo.id]);
    }
  }
});

module.exports = { workflowEffectRegistry: definitions };
