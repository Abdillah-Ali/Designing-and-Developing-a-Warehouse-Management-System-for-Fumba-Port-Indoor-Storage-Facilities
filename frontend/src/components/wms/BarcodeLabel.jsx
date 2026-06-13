import { forwardRef } from "react";

const CODE128_PATTERNS = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213",
  "221312", "231212", "112232", "122132", "122231", "113222", "123122", "123221", "223211", "221132",
  "221231", "213212", "223112", "312131", "311222", "321122", "321221", "312212", "322112", "322211",
  "212123", "212321", "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
  "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121", "313121", "211331",
  "231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111",
  "314111", "221411", "431111", "111224", "111422", "121124", "121421", "141122", "141221", "112214",
  "112412", "122114", "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
  "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112", "421211", "212141",
  "214121", "412121", "111143", "111341", "131141", "114113", "114311", "411113", "411311", "113141",
  "114131", "311141", "411131", "211412", "211214", "211232", "2331112"
];

function encodeCode128B(value) {
  const text = String(value || "");
  const codes = [104];
  let checksum = 104;

  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index) - 32;
    if (code < 0 || code > 95) {
      throw new Error("Barcode supports printable ASCII characters only.");
    }
    codes.push(code);
    checksum += code * (index + 1);
  }

  codes.push(checksum % 103, 106);
  return codes;
}

const BarcodeLabel = forwardRef(function BarcodeLabel({ cargo, compact = false }, ref) {
  const barcode = cargo?.barcode || cargo?.cargo_id || "";
  if (!barcode) return null;

  const codes = encodeCode128B(barcode);
  const moduleWidth = compact ? 1.4 : 1.8;
  const height = compact ? 52 : 72;
  let cursor = 12;
  const bars = [];

  codes.forEach((code, codeIndex) => {
    const pattern = CODE128_PATTERNS[code];
    for (let index = 0; index < pattern.length; index += 1) {
      const width = Number(pattern[index]) * moduleWidth;
      if (index % 2 === 0) {
        bars.push(
          <rect
            key={`${codeIndex}-${index}`}
            x={cursor}
            y="8"
            width={width}
            height={height}
            fill="#020617"
          />
        );
      }
      cursor += width;
    }
  });

  const width = cursor + 12;

  return (
    <section ref={ref} className="barcode-label rounded-md border border-slate-300 bg-white p-4 text-slate-950">
      <div className="text-center text-sm font-bold">Fumba Port Warehouse</div>
      <div className="mt-1 text-center text-[11px] uppercase tracking-wider">Cargo Storage Label</div>
      <svg
        className="mt-3 h-auto max-w-full"
        viewBox={`0 0 ${width} ${height + 30}`}
        role="img"
        aria-label={`Barcode ${barcode}`}
      >
        <rect x="0" y="0" width={width} height={height + 30} fill="white" />
        {bars}
        <text x={width / 2} y={height + 24} textAnchor="middle" fontFamily="monospace" fontSize="12" fontWeight="700">
          {barcode}
        </text>
      </svg>
      {!compact && (
        <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
          <span>Consignee</span><strong>{cargo.consignee_name || "Not recorded"}</strong>
          <span>Cargo Type</span><strong>{cargo.cargo_type || "Not recorded"}</strong>
          <span>Weight</span><strong>{cargo.weight ? `${Number(cargo.weight).toLocaleString()} kg` : "Not recorded"}</strong>
          <span>Date Registered</span><strong>{cargo.created_at ? new Date(cargo.created_at).toLocaleDateString("en-GB") : "Not recorded"}</strong>
        </div>
      )}
    </section>
  );
});

function printBarcodeLabel(labelElement) {
  if (!labelElement) return false;

  const popup = window.open("", "_blank", "width=760,height=680");
  if (!popup) return false;

  popup.document.write(`<!doctype html>
    <html>
      <head>
        <title>Fumba Port Cargo Barcode</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 24px; color: #0f172a; }
          .barcode-label { max-width: 680px; margin: 0 auto; border: 1px solid #cbd5e1; padding: 20px; }
          svg { width: 100%; height: auto; }
          @media print { body { padding: 0; } .barcode-label { border: 0; } }
        </style>
      </head>
      <body>${labelElement.outerHTML}</body>
    </html>`);
  popup.document.close();
  popup.focus();
  popup.print();
  return true;
}

export {
  BarcodeLabel,
  encodeCode128B,
  printBarcodeLabel
};
