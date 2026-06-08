export const MASS_ACTION_WORKER_ONLY_ERROR = "mass_action_requires_worker";

export function massActionWorkerOnlyMessage(action: string) {
  return `${action} deve ser enfileirada e processada pelo worker do Droplet. Ajuste o provider/fluxo para fila antes de disparar.`;
}

export function massActionWorkerOnlyPayload(action: string) {
  return {
    error: MASS_ACTION_WORKER_ONLY_ERROR,
    message: massActionWorkerOnlyMessage(action),
  };
}
