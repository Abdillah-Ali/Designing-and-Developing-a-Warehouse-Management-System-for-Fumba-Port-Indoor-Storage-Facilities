const PLACEMENT_WORKFLOW = "cargo_placement";

const workflows = Object.freeze({
  [PLACEMENT_WORKFLOW]: Object.freeze({
    workflow_key: PLACEMENT_WORKFLOW,
    display_name: "Cargo Placement",
    steps: Object.freeze([
      Object.freeze({ key: "cargo", scan_type: "cargo", instruction: "Scan Cargo Barcode" }),
      Object.freeze({ key: "bin", scan_type: "bin", instruction: "Scan Bin Barcode" })
    ]),
    operations: Object.freeze(["placement", "relocation"])
  })
});

const getScannerWorkflow = (workflowKey) => workflows[workflowKey] || null;
const listScannerWorkflows = () => Object.values(workflows);

module.exports = { PLACEMENT_WORKFLOW, getScannerWorkflow, listScannerWorkflows };
