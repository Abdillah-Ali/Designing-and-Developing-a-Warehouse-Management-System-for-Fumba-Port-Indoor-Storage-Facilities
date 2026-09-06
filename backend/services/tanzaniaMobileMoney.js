const { buildError } = require("../utils/apiError");

// TCRA allocated access codes. Mobile-number portability means the provider
// remains authoritative after this strong pre-submission structural check.
const NETWORKS = Object.freeze({
  vodacom: Object.freeze({ label: "Vodacom M-Pesa", prefixes: Object.freeze(["74", "75", "76", "79"]) }),
  airtel: Object.freeze({ label: "Airtel Money", prefixes: Object.freeze(["68", "69", "78"]) }),
  tigo: Object.freeze({ label: "Mixx by Yas", prefixes: Object.freeze(["65", "67", "71", "77"]) }),
  halotel: Object.freeze({ label: "Halotel", prefixes: Object.freeze(["61", "62"]) })
});
const ALIASES = Object.freeze({ mpesa:"vodacom", "m-pesa":"vodacom", mixx:"tigo", tigopesa:"tigo", "tigo pesa":"tigo", halopesa:"halotel", "halo pesa":"halotel" });
const normalizeNetwork = value => ALIASES[String(value || "").trim().toLowerCase()] || String(value || "").trim().toLowerCase();
const normalizeTanzanianNumber = value => {
  const raw = String(value || "").trim();
  if (!raw || /[A-Za-z]/.test(raw) || (raw.includes("+") && !raw.startsWith("+")) || (raw.match(/\+/g) || []).length > 1 || /[^0-9+\s().-]/.test(raw)) throw buildError("Enter a valid Tanzanian mobile number.",400,null,"INVALID_CUSTOMER_PHONE");
  let digits=raw.replace(/\D/g,"");
  if(digits.startsWith("0")) digits=`255${digits.slice(1)}`;
  if(!digits.startsWith("255")&&digits.length===9) digits=`255${digits}`;
  if(!/^255[67]\d{8}$/.test(digits)) throw buildError("Enter a valid Tanzanian mobile number in 06/07 or +255 format.",400,null,"INVALID_CUSTOMER_PHONE");
  return digits;
};
const validateTanzanianMobileMoney=({phone,network})=>{
  const normalizedNetwork=normalizeNetwork(network); const config=NETWORKS[normalizedNetwork];
  if(!config) throw buildError("Select a valid mobile-money network.",400,null,"INVALID_PAYMENT_NETWORK");
  const canonical=normalizeTanzanianNumber(phone); const prefix=canonical.slice(3,5);
  if(!config.prefixes.includes(prefix)) throw buildError(`This mobile number does not match the selected ${config.label} network.`,400,{network:normalizedNetwork,prefix},"MOBILE_NETWORK_MISMATCH");
  return {canonical,countryCode:"255",localNumber:canonical.slice(3),network:normalizedNetwork,label:config.label};
};
const publicNetworkConfiguration=()=>Object.entries(NETWORKS).map(([key,value])=>({key,label:value.label,prefixes:[...value.prefixes]}));
module.exports={NETWORKS,normalizeNetwork,normalizeTanzanianNumber,publicNetworkConfiguration,validateTanzanianMobileMoney};
