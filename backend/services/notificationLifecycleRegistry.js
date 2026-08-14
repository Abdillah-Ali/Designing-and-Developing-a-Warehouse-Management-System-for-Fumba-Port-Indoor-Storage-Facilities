const RESOLUTION_KEYS=new Set(["none","cargo_review_completed","correction_resubmitted","placement_override_decided","dispatch_decided","customs_left_pending","gate_released"]);
const ARCHIVE_KEYS=new Set(["informational_archiveable","actionable_until_resolved"]);
const canArchive=(notification)=>notification.archive_policy_key!=="actionable_until_resolved"||notification.status!=="pending";
module.exports={ARCHIVE_KEYS,RESOLUTION_KEYS,canArchive};
