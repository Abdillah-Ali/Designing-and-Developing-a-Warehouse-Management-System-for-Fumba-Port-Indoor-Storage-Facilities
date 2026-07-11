export const SCAN_COOLDOWN_MS = 1600;

export const getSessionStepKey = (session) => (
  session?.status === "active"
    ? `${session.id}:${Number(session.current_step_index || 0)}`
    : ""
);

export const shouldSuppressDuplicate = (barcode, lastSubmission, now = Date.now()) => (
  lastSubmission.value === barcode
  && now - lastSubmission.at < SCAN_COOLDOWN_MS
);

export const readCurrentStepError = (session) => {
  const attempt = session?.context?.last_scan_attempt;
  const isCurrentStepAttempt = (
    session?.status === "active"
    && attempt
    && attempt.accepted === false
    && Number(attempt.step_index) === Number(session.current_step_index)
  );

  return isCurrentStepAttempt ? session.last_error || "" : "";
};
