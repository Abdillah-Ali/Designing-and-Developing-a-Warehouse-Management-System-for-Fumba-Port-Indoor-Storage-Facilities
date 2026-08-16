const path = require("node:path");
const { buildError } = require("./apiError");

const MAX_DISPLAY_FILENAME = 180;
const signatures = {
  "application/pdf": (buffer) => buffer.subarray(0, 5).equals(Buffer.from("%PDF-")),
  "image/jpeg": (buffer) => buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff,
  "image/png": (buffer) => buffer.subarray(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a])),
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": (buffer) => (
    buffer.length >= 4
    && buffer[0] === 0x50 && buffer[1] === 0x4b
    && buffer.includes(Buffer.from("[Content_Types].xml"))
    && buffer.includes(Buffer.from("word/document.xml"))
  )
};

const normalizeDisplayFilename = (value) => {
  const normalized = String(value || "").normalize("NFKC").replace(/[\u0000-\u001f\u007f]/g, "").trim();
  const base = path.basename(normalized.replaceAll("\\", "/"));
  if (!base || base === "." || base === ".." || base.length > MAX_DISPLAY_FILENAME) {
    throw buildError(`File name must be between 1 and ${MAX_DISPLAY_FILENAME} characters.`, 400, undefined, "UPLOAD_FILENAME_INVALID");
  }
  return base;
};

const decodeStrictBase64 = (value) => {
  const raw = String(value || "").replace(/^data:[^;]+;base64,/, "").replace(/\s+/g, "");
  if (!raw || raw.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/.test(raw)) {
    throw buildError("Document content is not valid base64.", 400, undefined, "UPLOAD_BASE64_INVALID");
  }
  const buffer = Buffer.from(raw, "base64");
  if (!buffer.length || buffer.toString("base64").replace(/=+$/, "") !== raw.replace(/=+$/, "")) {
    throw buildError("Document content is not valid base64.", 400, undefined, "UPLOAD_BASE64_INVALID");
  }
  return buffer;
};

const assertFileSignature = (fileType, buffer) => {
  const validator = signatures[fileType];
  if (!validator || !validator(buffer)) {
    throw buildError("Document bytes do not match the selected file type.", 400, undefined, "UPLOAD_SIGNATURE_MISMATCH");
  }
};

module.exports = { MAX_DISPLAY_FILENAME, assertFileSignature, decodeStrictBase64, normalizeDisplayFilename };
