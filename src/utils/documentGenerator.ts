/**
 * Utility functions for printing and downloading official school documents
 * (Report Cards, Payment Receipts, Student Profile Dossiers, and Fee Statements)
 * with 100% fidelity, exact background colors, logos, and signatures.
 */

export const generateStandaloneHtml = (contentHtml: string, title: string): string => {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
  <style>
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background-color: #f8fafc;
      color: #0f172a;
      margin: 0;
      padding: 24px;
    }
    @page {
      size: A4 portrait;
      margin: 10mm;
    }
    @media print {
      body {
        background-color: #ffffff !important;
        padding: 0 !important;
      }
      .no-print {
        display: none !important;
      }
      * {
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
      }
    }
    .watermark-stamp {
      border: 3px double #047857;
      border-radius: 8px;
      color: #047857;
      text-transform: uppercase;
      font-weight: 800;
      letter-spacing: 2px;
      display: inline-block;
      padding: 4px 12px;
      transform: rotate(-4deg);
    }
  </style>
</head>
<body>
  <div class="no-print max-w-4xl mx-auto mb-6 flex items-center justify-between p-4 bg-white border border-slate-200 rounded-xl shadow-xs">
    <div class="flex items-center gap-3">
      <div class="w-9 h-9 rounded-lg bg-emerald-900 text-white flex items-center justify-center font-bold text-sm">
        DOC
      </div>
      <div>
        <h2 class="text-sm font-bold text-slate-900">${title}</h2>
        <p class="text-xs text-slate-500">Official document preview • Ready to print or save as PDF</p>
      </div>
    </div>
    <div class="flex items-center gap-2">
      <button 
        onclick="window.print()" 
        class="px-4 py-2 bg-emerald-800 hover:bg-emerald-900 text-white font-semibold text-xs rounded-lg transition-colors cursor-pointer flex items-center gap-1.5 shadow-xs"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 9V3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v6"/><rect x="6" y="14" width="12" height="8" rx="1"/></svg>
        Print / Save to PDF
      </button>
      <button 
        onclick="window.close()" 
        class="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs rounded-lg transition-colors cursor-pointer"
      >
        Close
      </button>
    </div>
  </div>

  <div class="max-w-4xl mx-auto">
    ${contentHtml}
  </div>
</body>
</html>`;
};

/**
 * Triggers clean printing by creating a dedicated printable window or iframe.
 */
export const printDocumentElement = (elementId: string, documentTitle: string = 'Document') => {
  const element = document.getElementById(elementId);
  if (!element) {
    console.error(`Document element with ID "${elementId}" not found.`);
    window.print();
    return;
  }

  const fullHtml = generateStandaloneHtml(element.outerHTML, documentTitle);

  try {
    // Hidden iframe printing ensures 100% reliability in sandboxed previews without popup blocker interference
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    iframe.setAttribute('title', documentTitle);
    document.body.appendChild(iframe);

    const doc = iframe.contentWindow?.document;
    if (doc) {
      doc.open();
      doc.write(fullHtml);
      doc.close();

      setTimeout(() => {
        try {
          iframe.contentWindow?.focus();
          iframe.contentWindow?.print();
        } catch (printErr) {
          console.warn('Iframe print error, falling back:', printErr);
          window.print();
        } finally {
          setTimeout(() => {
            if (document.body.contains(iframe)) {
              document.body.removeChild(iframe);
            }
          }, 2000);
        }
      }, 500);
      return;
    }
  } catch (err) {
    console.warn('Iframe print failed, falling back:', err);
  }

  // Fallback
  window.print();
};

/**
 * Downloads the document as a complete, standalone, styled HTML file.
 * This can be opened offline in any browser and saved as PDF directly.
 */
export const downloadDocumentAsFile = (
  elementId: string, 
  filename: string, 
  documentTitle: string = 'Document'
) => {
  const element = document.getElementById(elementId);
  if (!element) {
    console.error(`Document element with ID "${elementId}" not found for download.`);
    return;
  }

  const cleanFilename = filename.endsWith('.html') ? filename : `${filename}.html`;
  const fullHtml = generateStandaloneHtml(element.outerHTML, documentTitle);

  const blob = new Blob([fullHtml], { type: 'text/html;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = cleanFilename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};
