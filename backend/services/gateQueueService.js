const { buildError } = require('../utils/apiError');

const PRESENCE_STATUSES = new Set([
  'WAITING_FOR_CUSTOMER', 'PRESENT_READY', 'TEMPORARILY_UNAVAILABLE'
]);

const instant = value => value ? new Date(value).getTime() : Number.POSITIVE_INFINITY;
const compareFpfg = (left, right) =>
  instant(left.latest_fully_paid_at) - instant(right.latest_fully_paid_at)
  || instant(left.registration_time) - instant(right.registration_time)
  || String(left.cargo_reference).localeCompare(String(right.cargo_reference));

const paginate = (rows, page, pageSize) => {
  const size = [10, 20, 50, 100].includes(Number(pageSize)) ? Number(pageSize) : 10;
  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / size));
  const current = Math.min(Math.max(Number(page) || 1, 1), pages);
  return { rows: rows.slice((current - 1) * size, current * size), page: current, page_size: size, total, total_pages: pages };
};

const queueState = ({ operationallyEligible, financiallyCleared, firstPresent, managementReleaseApproved = false, customerUnavailable = false }) => {
  if (!financiallyCleared) return 'Payment/Penalty Required';
  if (!operationallyEligible) return 'Release Condition Blocked';
  if (managementReleaseApproved) return 'Management Release Ready';
  if (customerUnavailable) return 'Customer Unavailable — Skipped';
  return firstPresent ? 'Ready Now' : 'Blocked by Earlier Present Cargo';
};

const validatePresenceChange = ({ oldStatus, newStatus, reason }) => {
  if (!PRESENCE_STATUSES.has(newStatus)) throw buildError('Unsupported customer presence status.', 400);
  if (oldStatus === 'PRESENT_READY' && newStatus !== 'PRESENT_READY' && !String(reason || '').trim()) {
    throw buildError('A reason is required when changing a present customer to unavailable.', 400, null, 'PRESENCE_REASON_REQUIRED');
  }
};

module.exports = { PRESENCE_STATUSES, compareFpfg, paginate, queueState, validatePresenceChange };
