const db = require("../config/db");
const {
  cancelInvoice,
  confirmPayment,
  createOrRegenerateDraftInvoice,
  createTariffVersion,
  getFinanceDashboard,
  getInvoiceDetails,
  issueInvoice,
  listCargoCharges,
  listInvoices,
  listPayments,
  listTariffs,
  recordPayment,
  setTariffVersionActiveState,
  updateTariffVersion
} = require("../services/financeService");

const withTransaction = async (handler) => {
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    const result = await handler(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

const getDashboard = async (req, res, next) => {
  try {
    const data = await getFinanceDashboard({ filters: req.query });
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

const getCargoCharges = async (req, res, next) => {
  try {
    const result = await listCargoCharges({ filters: req.query });
    res.json({
      success: true,
      count: result.rows.length,
      total: result.total,
      page: result.page,
      limit: result.limit,
      data: result.rows
    });
  } catch (error) {
    next(error);
  }
};

const getTariffs = async (req, res, next) => {
  try {
    const data = await listTariffs({ filters: req.query });
    res.json({ success: true, count: data.length, data });
  } catch (error) {
    next(error);
  }
};

const createTariff = async (req, res, next) => {
  try {
    const data = await withTransaction((client) => createTariffVersion({
      payload: req.body,
      auth: req.auth,
      executor: client
    }));
    res.status(201).json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

const updateTariff = async (req, res, next) => {
  try {
    const data = await withTransaction((client) => updateTariffVersion({
      tariffVersionReference: req.params.reference,
      payload: req.body,
      auth: req.auth,
      executor: client
    }));
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

const activateTariff = async (req, res, next) => {
  try {
    const data = await withTransaction((client) => setTariffVersionActiveState({
      tariffVersionReference: req.params.reference,
      active: true,
      confirm: req.body.confirm === true,
      auth: req.auth,
      executor: client
    }));
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

const deactivateTariff = async (req, res, next) => {
  try {
    const data = await withTransaction((client) => setTariffVersionActiveState({
      tariffVersionReference: req.params.reference,
      active: false,
      confirm: true,
      auth: req.auth,
      executor: client
    }));
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

const generateDraftInvoice = async (req, res, next) => {
  try {
    const data = await withTransaction((client) => createOrRegenerateDraftInvoice({
      payload: req.body,
      auth: req.auth,
      executor: client
    }));
    res.status(201).json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

const getInvoices = async (req, res, next) => {
  try {
    const result = await listInvoices({ filters: req.query });
    res.json({
      success: true,
      count: result.rows.length,
      total: result.total,
      page: result.page,
      limit: result.limit,
      data: result.rows
    });
  } catch (error) {
    next(error);
  }
};

const getInvoice = async (req, res, next) => {
  try {
    const invoice = await getInvoiceDetails({ invoiceNumber: req.params.invoiceNumber });
    res.json({ success: true, data: invoice });
  } catch (error) {
    next(error);
  }
};

const issueInvoiceByNumber = async (req, res, next) => {
  try {
    const data = await withTransaction((client) => issueInvoice({
      invoiceNumber: req.params.invoiceNumber,
      auth: req.auth,
      executor: client
    }));
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

const cancelInvoiceByNumber = async (req, res, next) => {
  try {
    const data = await withTransaction((client) => cancelInvoice({
      invoiceNumber: req.params.invoiceNumber,
      reason: req.body.reason,
      auth: req.auth,
      executor: client
    }));
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

const getPayments = async (req, res, next) => {
  try {
    const data = await listPayments({ filters: req.query });
    res.json({ success: true, count: data.length, data });
  } catch (error) {
    next(error);
  }
};

const recordInvoicePayment = async (req, res, next) => {
  try {
    const data = await withTransaction((client) => recordPayment({
      payload: req.body,
      auth: req.auth,
      executor: client
    }));
    res.status(201).json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

const confirmInvoicePayment = async (req,res,next) => {
  try {
    const data=await withTransaction((client)=>confirmPayment({paymentReference:req.params.reference,auth:req.auth,executor:client}));
    res.json({success:true,data});
  } catch(error) { next(error); }
};

const getReports = async (req, res, next) => {
  try {
    const dashboard = await getFinanceDashboard({ filters: req.query });
    res.json({
      success: true,
      data: {
        revenue_by_date: dashboard.revenue_by_date,
        charges_by_cargo_type: dashboard.charges_by_cargo_type,
        totals: dashboard.metrics
      }
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  activateTariff,
  cancelInvoiceByNumber,
  createTariff,
  deactivateTariff,
  generateDraftInvoice,
  getCargoCharges,
  getDashboard,
  getInvoice,
  getInvoices,
  getPayments,
  getReports,
  getTariffs,
  issueInvoiceByNumber,
  recordInvoicePayment,
  confirmInvoicePayment,
  updateTariff
};
