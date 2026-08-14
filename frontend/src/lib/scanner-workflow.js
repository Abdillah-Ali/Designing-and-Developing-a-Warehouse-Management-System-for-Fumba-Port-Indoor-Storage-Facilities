export const getSessionStepKey = (session) => (
  session?.status === "active"
    ? `${session.id}:${Number(session.current_step_index || 0)}`
    : ""
);

export const isTerminalScannerSession = (session) => (
  ["completed", "cancelled", "expired"].includes(session?.status)
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
