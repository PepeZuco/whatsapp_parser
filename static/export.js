'use strict';

/* Export the filtered messages as CSV or XLSX, entirely in the browser.
 * Columns match the Streamlit version's Excel file: time, sender, message,
 * type, weekday. SheetJS is only fetched the first time someone picks .xlsx.
 *
 * rows/toCsv are pure and tested (tests/test_export.js). */

const ChatExport = (function () {

  const XLSX_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';

  function stamp(ts) { return new Date(ts * 1000).toISOString().slice(0, 19).replace('T', ' '); }

  function rows(msgs, { names, typeLabel, weekdayLabel, headers }) {
    return [headers].concat(msgs.map(m => [stamp(m.t), names[m.p], m.x, typeLabel(m.k), weekdayLabel(m.wd)]));
  }

  function csvCell(v) {
    let s = String(v);
    // Neutralize CSV/formula injection: a cell starting with =, +, -, @ or a
    // tab is interpreted as a formula by Excel/LibreOffice/Sheets. A leading
    // apostrophe forces it to be read as text and is invisible once opened.
    if (/^[=+\-@\t]/.test(s)) s = "'" + s;
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  /* RFC 4180, CRLF, with a BOM so Excel opens it as UTF-8. */
  function toCsv(table) {
    return '\ufeff' + table.map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
  }

  function save(blob, filename) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  let xlsxLoading = null;
  function loadXlsx() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    if (!xlsxLoading) {
      xlsxLoading = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = XLSX_SRC;
        s.onload = () => resolve(window.XLSX);
        s.onerror = () => { xlsxLoading = null; reject(new Error('xlsx')); };
        document.head.appendChild(s);
      });
    }
    return xlsxLoading;
  }

  async function download(kind, msgs, opts) {
    const table = rows(msgs, opts);
    if (kind === 'csv') {
      save(new Blob([toCsv(table)], { type: 'text/csv;charset=utf-8' }), 'chat_analysis.csv');
      return;
    }
    try {
      const X = await loadXlsx();
      const wb = X.utils.book_new();
      X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(table), 'Chat');
      X.writeFile(wb, 'chat_analysis.xlsx');
    } catch (e) {
      // CDN unreachable: CSV still works offline, so fall back to it.
      save(new Blob([toCsv(table)], { type: 'text/csv;charset=utf-8' }), 'chat_analysis.csv');
    }
  }

  return { rows, toCsv, download };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = ChatExport;
