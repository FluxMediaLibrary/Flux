import { requestStageLabel, type RequestDTO, type RequestStage } from '@flux/shared';

/**
 * How a request's lifecycle is coloured across the browse grid, hero, title
 * page and home rows. Wording comes from the shared contract so TV clients
 * say the same thing.
 */
export { requestStageLabel };

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
