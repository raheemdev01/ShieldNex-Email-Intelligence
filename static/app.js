const input = document.getElementById('emails');
const checkBtn = document.getElementById('check-btn');
const clearBtn = document.getElementById('clear-btn');
const inputCount = document.getElementById('input-count');
const limitWarning = document.getElementById('limit-warning');
const resultsSection = document.getElementById('results-section');
const resultsBody = document.getElementById('results-body');
const toast = document.getElementById('toast');
const loadingState = document.getElementById('loading-state');
const resultSearch = document.getElementById('result-search');
const resultFilter = document.getElementById('result-filter');
const visibleCount = document.getElementById('visible-count');
const noResults = document.getElementById('no-results');
const MAX_BATCH = 100;
const MAX_TOTAL = 5000;
const PAGE_SIZE = 100;
let currentPage = 1;
let latestResults = [];
let toastTimer;

function splitAddresses(value) {
  return value.split(/[\n,;]+/).map(v => v.trim()).filter(Boolean);
}
function updateInputCount() {
  const count = splitAddresses(input.value).length;
  inputCount.textContent = `${count.toLocaleString()} entered · ${MAX_TOTAL.toLocaleString()} maximum per run`;
  inputCount.classList.toggle('count-over', count > MAX_BATCH);
  limitWarning.textContent = count > MAX_TOTAL ? `Maximum ${MAX_TOTAL.toLocaleString()} addresses per run. Remove ${(count - MAX_TOTAL).toLocaleString()} address(es) to continue.` : `${count.toLocaleString()} address(es) ready. The app will process them in batches of ${MAX_BATCH}.`;
  limitWarning.classList.toggle('hidden', count === 0 || count > MAX_TOTAL);
  checkBtn.disabled = count === 0 || count > MAX_TOTAL;
}
function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove('show'), 3000);
}
function safeCsvCell(value) {
  let text = String(value ?? '');
  // Guard against spreadsheet formula injection while retaining the visible value.
  if (/^[\s\u0000-\u001f]*[=+@\-]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}
function downloadCsv() {
  if (!latestResults.length) return showToast('Run a check before exporting results.');
  const rows = [['Email address', 'Result', 'Details', 'Evidence type'], ...latestResults.map(r => [r.email, r.status, r.detail, r.basis])];
  const csv = '\ufeff' + rows.map(row => row.map(safeCsvCell).join(',')).join('\r\n');
  const blob = new Blob([csv], {type: 'text/csv;charset=utf-8;'});
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = 'shieldnex-email-check-results.csv';
  document.body.appendChild(link); link.click(); link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast(`Exported ${latestResults.length} results to CSV.`);
}
function renderResults() {
  const query = resultSearch.value.trim().toLowerCase();
  const filter = resultFilter.value;
  const filtered = latestResults.filter(r => {
    const matchesFilter = filter === 'all' || r.kind === filter;
    const matchesQuery = !query || `${r.email} ${r.status} ${r.detail}`.toLowerCase().includes(query);
    return matchesFilter && matchesQuery;
  });
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  currentPage = Math.min(Math.max(1, currentPage), pageCount);
  const start = (currentPage - 1) * PAGE_SIZE;
  const pageRows = filtered.slice(start, start + PAGE_SIZE);
  resultsBody.replaceChildren();
  const fragment = document.createDocumentFragment();
  for (const result of pageRows) {
    const row = document.createElement('tr');
    const emailCell = document.createElement('td'); emailCell.className = 'email-cell'; emailCell.textContent = result.email;
    const statusCell = document.createElement('td');
    const badge = document.createElement('span'); badge.className = `status ${result.kind}`; badge.textContent = result.status;
    statusCell.appendChild(badge);
    const detailCell = document.createElement('td'); detailCell.className = 'detail-cell'; detailCell.textContent = result.detail;
    row.append(emailCell, statusCell, detailCell); fragment.appendChild(row);
  }
  resultsBody.appendChild(fragment);
  visibleCount.textContent = filtered.length
    ? `Showing ${start + 1}–${Math.min(start + PAGE_SIZE, filtered.length)} of ${filtered.length} matching · ${latestResults.length} total`
    : `Showing 0 of ${latestResults.length}`;
  const pagination = document.getElementById('pagination');
  if (pagination) {
    pagination.replaceChildren();
    if (pageCount > 1) {
      const makeButton = (label, page, disabled = false) => {
        const button = document.createElement('button');
        button.type = 'button'; button.className = 'page-btn';
        button.textContent = label; button.disabled = disabled;
        button.addEventListener('click', () => { currentPage = page; renderResults(); });
        return button;
      };
      pagination.append(makeButton('← Previous', currentPage - 1, currentPage === 1));
      const info = document.createElement('span'); info.textContent = `Page ${currentPage} of ${pageCount}`;
      pagination.append(info, makeButton('Next →', currentPage + 1, currentPage === pageCount));
    }
  }
  noResults.classList.toggle('hidden', filtered.length !== 0);
  resultsBody.closest('table').classList.toggle('hidden', filtered.length === 0);
}
async function copyText(text, successMessage) {
  try {
    await navigator.clipboard.writeText(text);
    showToast(successMessage);
  } catch {
    showToast('Clipboard access is unavailable in this browser.');
  }
}

input.addEventListener('input', updateInputCount);
clearBtn.addEventListener('click', () => {
  input.value = '';
  updateInputCount();
  resultsSection.classList.add('hidden');
  latestResults = [];
  input.focus();
  showToast('Input cleared.');
});

document.getElementById('file-input').addEventListener('change', async event => {
  const file = event.target.files?.[0];
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) {
    showToast('Choose a text or CSV file smaller than 5 MB.');
    event.target.value = '';
    return;
  }
  try {
    const contents = await file.text();
    if (file.name.toLowerCase().endsWith('.csv')) {
      const rows = contents.split(/\r?\n/).filter(line => line.trim());
      const first = rows[0] || '';
      const hasHeader = /email|address/i.test(first.split(',')[0].replace(/^\"|\"$/g, ''));
      const dataRows = hasHeader ? rows.slice(1) : rows;
      input.value = dataRows.map(line => {
        // Email-list CSVs are expected to place the address in the first column.
        const match = line.match(/^\s*\"((?:[^\"]|\"\")*)\"\s*,|^\s*([^,;]+)/);
        return (match ? (match[1] !== undefined ? match[1].replace(/\"\"/g, '\"') : match[2]) : line).trim();
      }).filter(Boolean).join('\n');
    } else {
      input.value = contents;
    }
    updateInputCount();
    showToast(`Imported ${file.name}. Review the count before checking.`);
  } catch {
    showToast('Could not read that file. Try a .txt or .csv file.');
  }
  event.target.value = '';
});

checkBtn.addEventListener('click', async () => {
  const addresses = splitAddresses(input.value);
  const count = addresses.length;
  if (!count) { showToast('Paste at least one email address first.'); input.focus(); return; }
  if (count > MAX_TOTAL) { showToast(`Please use ${MAX_TOTAL.toLocaleString()} addresses or fewer per run.`); return; }

  checkBtn.disabled = true;
  clearBtn.disabled = true;
  checkBtn.querySelector('span:last-child').textContent = 'Checking…';
  loadingState.classList.remove('hidden');
  checkBtn.setAttribute('aria-busy', 'true');
  latestResults = [];
  currentPage = 1;
  resultsSection.classList.remove('hidden');
  resultSearch.value = '';
  resultFilter.value = 'all';
  const started = performance.now();
  let domainLookups = 0;
  let duplicateCount = 0;
  const seenInputAddresses = new Set();
  for (const address of addresses) {
    const key = address.trim().toLowerCase();
    if (seenInputAddresses.has(key)) duplicateCount++;
    else seenInputAddresses.add(key);
  }
  try {
    const totalBatches = Math.ceil(count / MAX_BATCH);
    for (let offset = 0; offset < count; offset += MAX_BATCH) {
      const batch = addresses.slice(offset, offset + MAX_BATCH);
      const batchNo = Math.floor(offset / MAX_BATCH) + 1;
      loadingState.querySelector('strong').textContent = `Checking batch ${batchNo} of ${totalBatches}…`;
      loadingState.querySelector('small').textContent = `${Math.min(offset + batch.length, count).toLocaleString()} of ${count.toLocaleString()} addresses processed. Please keep this tab open.`;
      const response = await fetch('/api/check', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({emails: batch.join('\n')})
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `Batch ${batchNo} failed.`);
      latestResults.push(...data.results);
      domainLookups = new Set(latestResults.map(r => {
        const at = r.email.lastIndexOf('@');
        return at >= 0 ? r.email.slice(at + 1).toLowerCase() : '';
      }).filter(Boolean)).size;
      const partial = latestResults.reduce((acc, r) => { acc[r.kind]++; return acc; }, {delivered: 0, bounce: 0, unknown: 0});
      document.getElementById('total-count').textContent = latestResults.length.toLocaleString();
      document.getElementById('delivered-count').textContent = partial.delivered.toLocaleString();
      document.getElementById('bounce-count').textContent = partial.bounce.toLocaleString();
      document.getElementById('unknown-count').textContent = partial.unknown.toLocaleString();
      document.getElementById('run-meta').textContent = `Batch ${batchNo}/${totalBatches} · ${Math.round(performance.now() - started).toLocaleString()} ms elapsed · ${domainLookups} domain lookups · ${duplicateCount} duplicate(s)`;
      renderResults();
    }
    document.getElementById('run-meta').textContent = `${Math.round(performance.now() - started).toLocaleString()} ms · ${count.toLocaleString()} addresses · ${domainLookups} domain lookups across batches · ${duplicateCount} duplicate(s)`;
    resultsSection.scrollIntoView({behavior: 'smooth', block: 'start'});
    showToast(`Completed ${count.toLocaleString()} addresses in ${totalBatches} batch(es).`);
  } catch (error) {
    showToast(`${error.message || 'Something went wrong.'} Partial results are retained; export them if needed.`);
  } finally {
    checkBtn.disabled = false;
    clearBtn.disabled = false;
    checkBtn.querySelector('span:last-child').textContent = 'Check addresses';
    checkBtn.removeAttribute('aria-busy');
    loadingState.classList.add('hidden');
    updateInputCount();
  }
});

document.getElementById('download-btn').addEventListener('click', downloadCsv);
resultSearch.addEventListener('input', () => { currentPage = 1; renderResults(); });
resultFilter.addEventListener('change', () => { currentPage = 1; renderResults(); });
document.getElementById('copy-summary-btn').addEventListener('click', () => {
  if (!latestResults.length) return showToast('No results to copy.');
  const counts = latestResults.reduce((acc, r) => { acc[r.kind]++; return acc; }, {delivered: 0, bounce: 0, unknown: 0});
  copyText(`ShieldNex Email Checker summary\nTotal: ${latestResults.length}\nDelivered (domain signal): ${counts.delivered}\nLikely to Bounce: ${counts.bounce}\nUnknown: ${counts.unknown}\nNote: mailbox existence and actual delivery are not confirmed.`, 'Summary copied.');
});
document.getElementById('copy-unknown-btn').addEventListener('click', () => {
  const addresses = latestResults.filter(r => r.kind === 'unknown').map(r => r.email);
  if (!addresses.length) return showToast('There are no Unknown addresses in this batch.');
  copyText(addresses.join('\n'), `Copied ${addresses.length} Unknown address(es).`);
});
updateInputCount();
