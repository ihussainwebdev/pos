/**
 * Best Publishers – Bill Creation & PDF Generation
 * Exact replica of desktop app bill logic
 */

'use strict';

let isWalkIn           = false;
let items              = [];
let selectedCustomer   = '';
let customerPhone      = '';
let customerAddress    = '';
let customerPercentage = 0;
let lastDiscountPercent= 0;
let editMode           = false;
let editBillId         = null;
let editBillNo         = null;
let activeDropdownIdx  = -1;
let lastDropdownVals   = {};

// ── Reset ─────────────────────────────────────────────────
function resetBillForm() {
    items = []; isWalkIn = false;
    selectedCustomer = ''; customerPhone = ''; customerAddress = '';
    customerPercentage = 0; lastDiscountPercent = 0;
    editMode = false; editBillId = null; editBillNo = null;
    lastDropdownVals = {};
    const tbody = document.querySelector('#billGrid tbody');
    if (tbody) tbody.innerHTML = '';
}

// ── Init ──────────────────────────────────────────────────
function initBillPage() {
    resetBillForm();

    const editData = sessionStorage.getItem('editBillData');
    if (editData) {
        sessionStorage.removeItem('editBillData');
        setTimeout(() => loadEditBillData(JSON.parse(editData)), 200);
    }

    // Close dropdowns on outside click
    document.addEventListener('click', e => {
        if (!e.target.closest('.form-group')) {
            document.querySelectorAll('.dropdown-list').forEach(l => { l.innerHTML = ''; l.style.display = 'none'; });
        }
    });

    // Keyboard nav
    ['customerSearch','salesmanSearch','bookSearch'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('keydown', e => handleDropdownKey(e, id, id.replace('Search','List')));
    });

    // Enter key on qty → focus discount
    const qty  = document.getElementById('quantity');
    const disc = document.getElementById('discount');
    if (qty)  qty.addEventListener('keydown',  e => { if (e.key==='Enter') { e.preventDefault(); disc && disc.focus(); } });
    if (disc) disc.addEventListener('keydown', e => { if (e.key==='Enter') { e.preventDefault(); addToGrid(); document.getElementById('bookSearch')?.focus(); } });

    // Auto-focus
    setTimeout(() => { if (!isWalkIn) document.getElementById('customerSearch')?.focus(); }, 200);
}

// ── Walk-In Toggle ────────────────────────────────────────
function toggleWalkIn() {
    isWalkIn = !isWalkIn;
    const btn    = document.getElementById('walkInBtn');
    const normal = document.getElementById('normalCustomer');
    const details= document.getElementById('customerDetails');
    const walkin = document.getElementById('walkInFields');

    if (isWalkIn) {
        normal.style.display  = 'none';
        details.style.display = 'none';
        walkin.style.display  = 'block';
        btn.innerHTML = '<i class="fas fa-user"></i> Regular Customer';
        btn.style.background = '#ef4444';
        document.getElementById('walkName')?.focus();
    } else {
        normal.style.display  = 'block';
        walkin.style.display  = 'none';
        btn.innerHTML = '<i class="fas fa-walking"></i> Walk-In Customer';
        btn.style.background = '';
        document.getElementById('customerSearch')?.focus();
    }
}
window.toggleWalkIn = toggleWalkIn;

// ── Load Edit Data ────────────────────────────────────────
function loadEditBillData(data) {
    editMode = true; editBillId = data.billId; editBillNo = data.bill.bill_no;
    const bill = data.bill;

    const title = document.querySelector('.page-title');
    if (title) title.textContent = `Edit Bill #${editBillNo}`;
    const saveBtn = document.querySelector('.btn-lg');
    if (saveBtn) saveBtn.innerHTML = '<i class="fas fa-save"></i> Update & Print Bill';

    if (bill.is_walk_in == 1) {
        toggleWalkIn();
        setTimeout(() => {
            document.getElementById('walkName').value    = bill.customer_name    || '';
            document.getElementById('walkPhone').value   = bill.customer_phone   || '';
            document.getElementById('walkAddress').value = bill.customer_address || '';
        }, 100);
    } else {
        const sel = document.getElementById('customer_id');
        const inp = document.getElementById('customerSearch');
        if (sel && bill.customer_id) {
            sel.value = bill.customer_id;
            const opt = sel.options[sel.selectedIndex];
            if (opt && opt.dataset) {
                inp.value = opt.dataset.name || bill.customer_name;
                selectedCustomer   = inp.value;
                customerPhone      = opt.dataset.phone   || '';
                customerAddress    = opt.dataset.address || '';
                customerPercentage = parseFloat(opt.dataset.percentage) || 0;
                document.getElementById('custPhone').value   = customerPhone;
                document.getElementById('custAddress').value = customerAddress;
                document.getElementById('customerDetails').style.display = 'block';
            }
        }
    }

    const smSel = document.getElementById('salesman_id');
    const smInp = document.getElementById('salesmanSearch');
    if (smSel && bill.salesman_id) {
        smSel.value = bill.salesman_id;
        const opt = smSel.options[smSel.selectedIndex];
        if (opt) smInp.value = opt.textContent;
    }

    items = data.items.map(item => ({
        bookId:          item.book_id,
        bookText:        item.book_title,
        price:           parseFloat(item.price),
        qty:             parseInt(item.quantity),
        gross:           parseFloat(item.price) * parseInt(item.quantity),
        discountPercent: parseFloat(item.discount_percent || 0),
        discountAmount:  parseFloat(item.price) * parseInt(item.quantity) * (parseFloat(item.discount_percent||0)/100),
        total:           parseFloat(item.total)
    }));
    renderGrid();
}

// ── Dropdown Filter ───────────────────────────────────────
function filterDropdown(inputId, listId) {
    if (inputId === 'customerSearch' && isWalkIn) return;
    const input = document.getElementById(inputId);
    if (!input) return;
    const filter = input.value.toLowerCase().trim();
    if (lastDropdownVals[inputId] === input.value) return;
    lastDropdownVals[inputId] = input.value;

    const selectId = inputId === 'customerSearch' ? 'customer_id' :
                     inputId === 'salesmanSearch'  ? 'salesman_id' : 'book_id';
    const select = document.getElementById(selectId);
    const list   = document.getElementById(listId);
    if (!select || !list) return;

    list.innerHTML = ''; list.style.display = 'none';
    if (!filter) return;

    let count = 0;
    for (let i = 1; i < select.options.length; i++) {
        const opt = select.options[i];
        if (!opt.textContent.toLowerCase().includes(filter)) continue;
        count++;
        const div = document.createElement('div');
        div.className = 'dropdown-item';
        div.textContent = opt.textContent;
        div.addEventListener('click', () => {
            select.value = opt.value;
            if (inputId === 'customerSearch') {
                input.value = opt.dataset.name;
                lastDropdownVals[inputId] = opt.dataset.name;
                selectedCustomer   = opt.dataset.name;
                customerPhone      = opt.dataset.phone   || '';
                customerAddress    = opt.dataset.address || '';
                customerPercentage = parseFloat(opt.dataset.percentage) || 0;
                document.getElementById('custPhone').value   = customerPhone;
                document.getElementById('custAddress').value = customerAddress;
                document.getElementById('customerDetails').style.display = 'block';
                document.getElementById('discount').value = customerPercentage;
                lastDiscountPercent = customerPercentage;
                document.getElementById('salesmanSearch')?.focus();
            } else if (inputId === 'bookSearch') {
                input.value = opt.textContent.split(' (Stock:')[0];
                lastDropdownVals[inputId] = input.value;
                document.getElementById('quantity')?.focus();
            } else {
                input.value = opt.textContent;
                lastDropdownVals[inputId] = opt.textContent;
                if (inputId === 'salesmanSearch') document.getElementById('bookSearch')?.focus();
            }
            list.innerHTML = ''; list.style.display = 'none';
            activeDropdownIdx = -1;
        });
        list.appendChild(div);
    }
    if (count > 0) { list.style.display = 'block'; activeDropdownIdx = -1; }
}
window.filterDropdown = filterDropdown;

// ── Keyboard Navigation ───────────────────────────────────
function handleDropdownKey(e, inputId, listId) {
    const list  = document.getElementById(listId);
    if (!list || list.style.display === 'none') return;
    const divs  = list.querySelectorAll('.dropdown-item');
    if (!divs.length) return;

    if (e.key === 'ArrowDown') {
        e.preventDefault();
        activeDropdownIdx = (activeDropdownIdx + 1) % divs.length;
    } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        activeDropdownIdx = (activeDropdownIdx - 1 + divs.length) % divs.length;
    } else if (e.key === 'Enter' && activeDropdownIdx >= 0) {
        e.preventDefault();
        divs[activeDropdownIdx].click();
        return;
    } else return;

    divs.forEach((d, i) => {
        d.classList.toggle('active', i === activeDropdownIdx);
        if (i === activeDropdownIdx) d.scrollIntoView({ block: 'nearest' });
    });
}

// ── Add to Grid ───────────────────────────────────────────
function addToGrid() {
    const bookSel = document.getElementById('book_id');
    const opt     = bookSel.options[bookSel.selectedIndex];
    if (!opt || !opt.value) { showAlert('Please select a book!', 'warning'); return; }

    const stock = parseInt(opt.dataset.stock);
    const qty   = parseInt(document.getElementById('quantity').value) || 1;

    if (qty > stock) {
        document.getElementById('noStockMsg').textContent =
            `'${opt.textContent.split(' (Stock:')[0]}' has only ${stock} in stock.`;
        document.getElementById('noStockModal').style.display = 'flex';
        return;
    }

    const discPct = parseFloat(document.getElementById('discount').value) || 0;
    const price   = parseFloat(opt.dataset.price);
    const gross   = price * qty;
    const discAmt = gross * (discPct / 100);
    const total   = gross - discAmt;
    lastDiscountPercent = discPct;

    const existing = items.find(i => i.bookId == opt.value);
    if (existing) {
        const newQty = existing.qty + qty;
        if (newQty > stock) {
            document.getElementById('noStockMsg').textContent =
                `'${opt.textContent.split(' (Stock:')[0]}' has only ${stock} in stock.`;
            document.getElementById('noStockModal').style.display = 'flex';
            return;
        }
        existing.qty           = newQty;
        existing.gross         = price * newQty;
        existing.discountAmount= existing.gross * (discPct / 100);
        existing.total         = existing.gross - existing.discountAmount;
        existing.discountPercent = discPct;
    } else {
        items.push({
            bookId: opt.value,
            bookText: opt.textContent.split(' (Stock:')[0],
            price, qty, gross, discountPercent: discPct, discountAmount: discAmt, total
        });
    }

    bookSel.value = '';
    document.getElementById('bookSearch').value = '';
    document.getElementById('quantity').value   = 1;
    document.getElementById('discount').value   = lastDiscountPercent;
    renderGrid();
    document.getElementById('bookSearch')?.focus();
}
window.addToGrid = addToGrid;

// ── Render Grid ───────────────────────────────────────────
function renderGrid() {
    const tbody = document.querySelector('#billGrid tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    let tQty=0, tGross=0, tDisc=0, tTotal=0, tOrig=0;
    items.forEach((item, i) => {
        tQty   += item.qty;
        tGross += item.gross;
        tDisc  += item.discountAmount;
        tTotal += item.total;
        tOrig  += item.price * item.qty;

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td style="text-align:center;">${i+1}</td>
            <td style="text-align:left;word-break:break-word;">${item.bookText}</td>
            <td style="text-align:center;">Rs. ${item.price.toFixed(0)}</td>
            <td style="text-align:center;">
                <input type="number" value="${item.qty}" min="1"
                    style="width:55px;text-align:center;font-size:13px;padding:2px;"
                    onchange="updateItem(${i},this.value,null)">
            </td>
            <td style="text-align:center;">Rs. ${item.gross.toFixed(0)}</td>
            <td style="text-align:center;">
                <input type="number" value="${item.discountPercent}" min="0" max="100" step="0.01"
                    style="width:55px;text-align:center;font-size:13px;padding:2px;"
                    onchange="updateItem(${i},null,this.value)">%
            </td>
            <td style="text-align:center;">Rs. ${item.total.toFixed(0)}</td>
            <td style="text-align:center;">
                <button class="btn btn-danger" onclick="removeItem(${i})"
                    style="padding:3px 8px;font-size:11px;">X</button>
            </td>`;
        tbody.appendChild(tr);
    });

    // Totals row
    const tr = document.createElement('tr');
    tr.style.fontWeight = 'bold';
    tr.innerHTML = `
        <td colspan="2" style="text-align:center;"></td>
        <td style="text-align:center;">Rs. ${tOrig.toFixed(0)}</td>
        <td style="text-align:center;">${tQty}</td>
        <td style="text-align:center;">Rs. ${tGross.toFixed(0)}</td>
        <td style="text-align:center;">Rs. ${tDisc.toFixed(0)}</td>
        <td style="text-align:center;">Rs. ${tTotal.toFixed(0)}</td>
        <td></td>`;
    tbody.appendChild(tr);
}

function updateItem(i, newQty, newDisc) {
    const item  = items[i];
    const opt   = document.querySelector(`#book_id option[value="${item.bookId}"]`);
    const stock = opt ? parseInt(opt.dataset.stock) : 9999;

    if (newQty !== null) {
        const q = parseInt(newQty) || 1;
        if (q > stock) { showAlert(`Only ${stock} in stock!`, 'warning'); renderGrid(); return; }
        item.qty = q;
    }
    if (newDisc !== null) item.discountPercent = parseFloat(newDisc) || 0;

    item.gross          = item.price * item.qty;
    item.discountAmount = item.gross * (item.discountPercent / 100);
    item.total          = item.gross - item.discountAmount;
    renderGrid();
}

function removeItem(i) { items.splice(i, 1); renderGrid(); }

window.updateItem = updateItem;
window.removeItem = removeItem;

// ── Save Bill ─────────────────────────────────────────────
async function saveBill(event) {
    let customerId = document.getElementById('customer_id').value;
    let custName = '', custPhone = '', custAddr = '';

    if (isWalkIn) {
        custName  = document.getElementById('walkName').value.trim();
        custPhone = document.getElementById('walkPhone').value.trim();
        custAddr  = document.getElementById('walkAddress').value.trim();
        if (!custName) { showAlert('Enter customer name!', 'warning'); return; }
    } else {
        if (!customerId) { showAlert('Select a customer!', 'warning'); return; }
        custName  = selectedCustomer;
        custPhone = customerPhone;
        custAddr  = customerAddress;
    }

    const salesmanId = document.getElementById('salesman_id').value;
    if (!salesmanId)    { showAlert('Select a salesman!', 'warning'); return; }
    if (!items.length)  { showAlert('Add at least one item!', 'warning'); return; }

    const payload = {
        customerId: isWalkIn ? 0 : parseInt(customerId),
        salesmanId: parseInt(salesmanId),
        items: items.map(i => ({
            bookId:          parseInt(i.bookId),
            bookTitle:       i.bookText,
            qty:             parseInt(i.qty),
            price:           parseFloat(i.price),
            discountPercent: parseFloat(i.discountPercent),
            total:           parseFloat(i.total)
        })),
        walkIn: isWalkIn ? { name: custName, phone: custPhone, address: custAddr } : null
    };

    const btn = event?.target;
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...'; }

    try {
        const url    = editMode ? `${API}/bills.php?id=${editBillId}` : `${API}/bills.php`;
        const method = editMode ? 'PUT' : 'POST';
        const res    = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        const result = await res.json();

        if (result.success) {
            const billItems = [...items];
            await generatePDF(result.bill_no, custName, result.salesman, billItems, result.total, custPhone, custAddr);

            const msg = editMode
                ? `Bill #${result.bill_no} updated!`
                : `Bill #${result.bill_no} saved! Stock updated for ${billItems.length} book(s).`;

            resetBillForm();
            showAlert(msg, 'success');
            setTimeout(() => loadPage('bill'), 300);
        } else {
            showAlert('Error: ' + (result.message || 'Unknown'), 'error');
        }
    } catch (err) {
        showAlert('Network error: ' + err.message, 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = editMode
                ? '<i class="fas fa-save"></i> Update & Print Bill'
                : '<i class="fas fa-save"></i> Save & Print Bill';
        }
    }
}
window.saveBill = saveBill;

// ── Number to Words ───────────────────────────────────────
function numberToWords(num) {
    if (num === 0) return 'Zero Only';
    const ones  = ['','One','Two','Three','Four','Five','Six','Seven','Eight','Nine','Ten',
                   'Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen','Seventeen','Eighteen','Nineteen'];
    const tens  = ['','','Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety'];
    const scales= ['','Thousand','Million','Billion'];
    let words = ''; let si = 0;
    while (num > 0) {
        let chunk = num % 1000;
        if (chunk) {
            let cw = '';
            if (chunk >= 100) { cw += ones[Math.floor(chunk/100)] + ' Hundred '; chunk %= 100; }
            if (chunk >= 20)  { cw += tens[Math.floor(chunk/10)] + ' '; chunk %= 10; }
            if (chunk > 0)    { cw += ones[chunk] + ' '; }
            words = cw + scales[si] + ' ' + words;
        }
        num = Math.floor(num / 1000); si++;
    }
    return words.trim() + ' Only';
}

// ── Generate PDF – Portrait A4, exact image layout ────────
async function generatePDF(billNo, customer, salesman, billItems, total, phone, address) {
    const { jsPDF } = window.jspdf;

    // Portrait A4: 210mm x 297mm
    const doc = new jsPDF('p', 'mm', 'a4');
    const pw  = 210;   // page width
    const ph  = 297;   // page height
    const ml  = 12;    // margin left
    const mr  = 12;    // margin right
    const cw  = pw - ml - mr;  // content width
    const now = new Date();

    // ── HEADER ────────────────────────────────────────────
    let y = 14;

    // Left: Customer info
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text(`Customer: ${customer}`, ml, y);
    y += 5;
    if (phone)   doc.text(`Phone: ${phone}`, ml, y);
    y += 5;
    if (address) {
        const shortAddr = address.length > 50 ? address.substring(0, 47) + '...' : address;
        doc.text(`Address: ${shortAddr}`, ml, y);
    }

    // Center: Company name - thoda upar
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(20);
    doc.text('BEST PUBLISHERS', pw / 2, 10, { align: 'center' });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text('Wholesale & Retail Books Supplier', pw / 2, 16, { align: 'center' });

    // Right: Bill info
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text(`Bill No: ${billNo}`, pw - mr, 14, { align: 'right' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    const dateStr = `${String(now.getDate()).padStart(2,'0')}/${String(now.getMonth()+1).padStart(2,'0')}/${now.getFullYear()}`;
    const timeStr = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
    doc.text(`Date: ${dateStr}`, pw - mr, 20, { align: 'right' });
    doc.text(`Salesman: ${salesman} | Time: ${timeStr}`, pw - mr, 26, { align: 'right' });

    // Separator line
    y = 30;
    doc.setLineWidth(0.5);
    doc.line(ml, y, pw - mr, y);
    y += 6;

    // ── TABLE ─────────────────────────────────────────────
    const headers = [['S.No', 'Book Title', 'Unit Price', 'Qty', 'Gross Amount', 'Discount', 'Net Amount']];

    let tQty=0, tGross=0, tDisc=0, tTotal=0, tOrig=0;
    billItems.forEach(i => {
        tQty   += i.qty;
        tGross += i.gross;
        tDisc  += i.discountAmount;
        tTotal += i.total;
        tOrig  += i.price * i.qty;
    });

    const body = billItems.map((item, idx) => [
        (idx + 1).toString(),
        item.bookText,
        `Rs. ${Math.round(item.price).toLocaleString()}`,
        item.qty.toString(),
        `Rs. ${Math.round(item.gross).toLocaleString()}`,
        `Rs. ${Math.round(item.discountAmount).toLocaleString()}`,
        `Rs. ${Math.round(item.total).toLocaleString()}`
    ]);

    // Totals row
    body.push([
        '',
        'TOTAL',
        `Rs. ${Math.round(tOrig).toLocaleString()}`,
        tQty.toString(),
        `Rs. ${Math.round(tGross).toLocaleString()}`,
        `Rs. ${Math.round(tDisc).toLocaleString()}`,
        `Rs. ${Math.round(tTotal).toLocaleString()}`
    ]);

    doc.autoTable({
        head: headers,
        body: body,
        startY: y,
        theme: 'grid',
        styles: {
            fontSize: 10,
            cellPadding: 3,
            textColor: [0, 0, 0],
            lineWidth: 0.3,
            lineColor: [0, 0, 0],
            halign: 'center',
            valign: 'middle',
            font: 'helvetica',
            fontStyle: 'normal'
        },
        headStyles: {
            fillColor: [220, 220, 220],
            textColor: [0, 0, 0],
            fontStyle: 'bold',
            fontSize: 10,
            halign: 'center',
            lineWidth: 0.4,
            lineColor: [0, 0, 0],
            cellPadding: 3
        },
        columnStyles: {
            0: { cellWidth: 12,  halign: 'center' },
            1: { cellWidth: 'auto', halign: 'left', fontStyle: 'bold', fontSize: 11 },
            2: { cellWidth: 24,  halign: 'center' },
            3: { cellWidth: 14,  halign: 'center' },
            4: { cellWidth: 26,  halign: 'center' },
            5: { cellWidth: 22,  halign: 'center' },
            6: { cellWidth: 26,  halign: 'center' }
        },
        margin: { left: ml, right: mr, bottom: 45 },
        didParseCell(data) {
            // Bold all cells
            data.cell.styles.fontStyle = 'bold';
            // Book title bigger
            if (data.column.index === 1 && data.section === 'body') {
                data.cell.styles.fontSize = 11;
            }
            // Total row styling
            if (data.section === 'body' && data.row.index === body.length - 1) {
                data.cell.styles.fillColor  = [200, 200, 200];
                data.cell.styles.fontStyle  = 'bold';
                data.cell.styles.fontSize   = 10;
                data.cell.styles.lineWidth  = 0.5;
            }
        },
        didDrawPage(data) {
            const pageNum   = doc.internal.getCurrentPageInfo().pageNumber;
            const pageCount = doc.internal.getNumberOfPages();

            // ── FOOTER on every page ──────────────────────
            const footerY = ph - 22;

            doc.setLineWidth(0.3);
            doc.line(ml, footerY - 2, pw - mr, footerY - 2);

            doc.setFont('helvetica', 'bold');
            doc.setFontSize(8);
            doc.text(
                'Address: Mezzanine Floor, Ayesha Manzil, Near Muqaddas Masjid, Urdu Bazar, Karachi.',
                pw / 2, footerY + 2, { align: 'center' }
            );
            doc.text(
                'PHONE: 0300-2219618 | 021-32745779',
                pw / 2, footerY + 7, { align: 'center' }
            );
            doc.setFont('helvetica', 'normal');
            doc.text(
                'Note: No Return, No Exchange Without Bill.',
                pw / 2, footerY + 12, { align: 'center' }
            );
            doc.setFontSize(7);
            doc.text(
                'Designed by Hussain | Contact: +923342622606',
                pw / 2, footerY + 17, { align: 'center' }
            );

            // Page number
            doc.setFontSize(8);
            doc.setFont('helvetica', 'bold');
            doc.text(`Page ${pageNum} of ${pageCount}`, pw - mr, footerY + 17, { align: 'right' });

            // Continued header on page 2+
            if (pageNum > 1) {
                doc.setFontSize(14);
                doc.setFont('helvetica', 'bold');
                doc.text('BEST PUBLISHERS', pw / 2, 12, { align: 'center' });
                doc.setFontSize(9);
                doc.setFont('helvetica', 'normal');
                doc.text(`Bill No: ${billNo} (Continued)`, pw - mr, 12, { align: 'right' });
            }
        }
    });

    // ── GRAND TOTAL + SIGNATURE ───────────────────────────
    const finalY = doc.lastAutoTable.finalY + 6;
    const words  = numberToWords(Math.round(tTotal));

    // Grand Total right-aligned
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text(
        `Grand Total: Rs. ${Math.round(tTotal).toLocaleString()}`,
        pw - mr, finalY, { align: 'right' }
    );
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text(`(${words})`, pw - mr, finalY + 6, { align: 'right' });

    // Authorized Signature left
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text('Authorized Signature: ___________________', ml, finalY + 6);

    // ── SAVE PDF + AUTO PRINT ─────────────────────────────
    const safeName  = customer.replace(/[^a-zA-Z0-9\s]/g, '').replace(/\s+/g, '_');
    const fileName  = `${safeName}_Bill_${billNo}.pdf`;

    // Get PDF as blob, open in new tab, then trigger print
    const pdfBlob = doc.output('blob');
    const blobUrl = URL.createObjectURL(pdfBlob);

    // Also trigger download
    doc.save(fileName);

    // Open in new tab and auto-print
    const printWin = window.open(blobUrl, '_blank');
    if (printWin) {
        printWin.addEventListener('load', () => {
            setTimeout(() => {
                printWin.focus();
                printWin.print();
            }, 500);
        });
    }
}
window.generatePDF = generatePDF;
