import type { RequestDTO, RequestStage } from '@flux/shared';

/**
 * One place for how a request's lifecycle is worded and coloured across the
 * browse grid, hero, title page and home rows.
 */
export function requestStageLabel(request: Pick<RequestDTO, 'stage' | 'progress'>): string {
  switch (request.stage) {
    case 'REQUESTED': return 'Requested';
    case 'APPROVED': return 'Approved';
    case 'DOWNLOADING': return request.progress != null ? `Downloading ${Math.round(request.progress * 100)}%` : 'Downloading';
    case 'PROCESSING': return 'Processing';
    case 'AVAILABLE': return 'In Library';
    case 'FAILED': return 'Failed';
    case 'REJECTED': return 'Rejected';
  }
}

export function requestStagePillClass(stage: RequestStage): string {
  switch (stage) {
    case 'AVAILABLE':
    case 'APPROVED':
      return 'pill ok';
    case 'REJECTED':
    case 'FAILED':
      return 'pill err';
    case 'DOWNLOADING':
    case 'PROCESSING':
      return 'pill active';
    default:
      return 'pill';
  }
}

/** Stages a member may still withdraw from. */
export function requestCancellable(request: Pick<RequestDTO, 'stage'>): boolean {
  return request.stage === 'REQUESTED' || request.stage === 'APPROVED';
}
