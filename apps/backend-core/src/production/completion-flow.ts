/**
 * Decides what a POST /production/orders/:id/complete call should do, given
 * the order's current status and (when quality-control is installed)
 * whether a PASS sample from the final product already exists.
 *
 * Split out from the controller because it's the one piece of the
 * production/QC handoff with real branching worth pinning down with tests
 * independent of Prisma — see scaleRequirement/detectSeasonalSpikes for the
 * same pattern elsewhere in this module.
 */
export type CompletionOutcome =
  | { action: 'FINALIZE' }
  | { action: 'AWAIT_QC' }
  | { action: 'STILL_AWAITING_QC' }
  | { action: 'INVALID_STATUS' };

export function decideCompletion(
  status: 'DRAFT' | 'RAW_MATERIAL_APPROVED' | 'IN_PROGRESS' | 'QC_PENDING' | 'COMPLETED' | 'REJECTED' | 'CANCELLED',
  qcInstalled: boolean,
  hasPassedFinalSample: boolean,
): CompletionOutcome {
  if (status === 'IN_PROGRESS') {
    if (qcInstalled && !hasPassedFinalSample) return { action: 'AWAIT_QC' };
    return { action: 'FINALIZE' };
  }
  if (status === 'QC_PENDING') {
    return hasPassedFinalSample ? { action: 'FINALIZE' } : { action: 'STILL_AWAITING_QC' };
  }
  return { action: 'INVALID_STATUS' };
}
