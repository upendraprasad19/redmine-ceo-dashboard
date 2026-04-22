// Approved project IDs - only these will be synced and shown in dashboard
// Matches AppScript approvedProjects

export const APPROVED_PROJECT_IDS = new Set([
  2,   // iPLUS RW
  3,   // Tristar - Misc Support
  5,   // iCAST
  7,   // Maya Virtual Assistant
  14,  // iDART
  15,  // iCLAIMS
  16,  // iPACS
  17,  // iTAKE and iTAKE 2.0
  18,  // iSTAT
  19,  // iForms and VM
  20,  // Tristar Connect
  21,  // Stand Alone Forms
  23,  // Commonlogin
  29,  // iSAM
  34,  // iPPO
  43,  // Ebix
  44,  // iPACS 2.0
  47,  // iCAST 2.0
  49,  // Maya Docs
  50,  // Maya Charts
  51,  // Tristar Ai Bot
  55,  // Claim Info Bot
  56,  // Producer App
  57,  // Support Bot
  60,  // Maya Voice
  61,  // iSAM 2.0
  62,  // iWIDGET
  63,  // Widget Based iPACS
  65,  // iTAKE 3.0
  67,  // Liability (iPLUS 2.0)
  68,  // Maya Agents
  69,  // Maya Insights
  70,  // Maya Predictions
  71,  // Maya Audits / Assistance
  72,  // iPPO 2
  73,  // iCLAIMS 2.0
  74,  // ThinkingCode AI
  75,  // Rule Engine for Liability (iPLUS2.0)
  76,  // Reports 3.0
]);

export function isApprovedProject(projectId) {
  return APPROVED_PROJECT_IDS.has(Number(projectId));
}