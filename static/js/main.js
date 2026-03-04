// PLEASE REPLACE THIS WITH YOUR DEPLOYED GOOGLE APPS SCRIPT WEB APP URL
const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwCFY9S47tGGG450vY81ZjbyF2C6ZM8GPAKsVxftBWrbaZpONFuZ0FZDaLQyVfX2BIOsg/exec';

let masterItems = [];
let authorizedPin = ""; // Store pin for backend validation

document.addEventListener('DOMContentLoaded', () => {
    fetchItems();
    fetchTransactions();

    // Close dropdowns when clicking outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.combo-box')) {
            document.querySelectorAll('.combo-list').forEach(el => el.classList.remove('active'));
        }
    });
});

function switchTab(viewId) {
    // Reset any authorized PIN when navigating away
    if (viewId !== 'add_item') {
        authorizedPin = "";
    }

    // Update nav buttons
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    event.target.classList.add('active');

    // Update views
    document.querySelectorAll('.view-section').forEach(view => view.classList.remove('active'));
    document.getElementById(`view-${viewId}`).classList.add('active');

    // Refresh data if going to dashboard
    if (viewId === 'dashboard') {
        fetchTransactions();
        fetchItems();
    }
}

async function fetchItems() {
    try {
        const response = await fetch(`${SCRIPT_URL}?action=getItems`);
        const data = await response.json();
        if (data.status === 'success') {
            masterItems = data.data;
            document.getElementById('stat-total-items').textContent = masterItems.length;

            // Calculate low stock items
            const lowStockItems = masterItems.filter(item => {
                const current = parseInt(item.Current_Stock || 0);
                const min = parseInt(item.Min_Stock || 0);
                return current <= min; // Trigger warning when stock hits or falls below threshold
            });

            document.getElementById('stat-low-stock').textContent = lowStockItems.length;
            renderLowStockTable(lowStockItems);

            // Re-render dropdowns just in case
            ['out', 'ret'].forEach(prefix => filterDropdown(prefix, ''));
            // And unified dropdown
            if (document.getElementById('add-search')) filterUnifiedDropdown('');
        }
    } catch (error) {
        showToast('Error loading items from database', 'error');
    }
}

async function fetchTransactions() {
    try {
        const response = await fetch(`${SCRIPT_URL}?action=getTransactions`);
        const data = await response.json();
        if (data.status === 'success') {
            document.getElementById('stat-total-logs').textContent = data.data.length;
            // Get only the 20 most recent
            renderRecentTransactions(data.data.slice(0, 20));
        }
    } catch (error) {
        showToast('Error loading recent transactions', 'error');
    }
}

function renderLowStockTable(items) {
    const tbody = document.querySelector('#low-stock-table tbody');
    if (items.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;">Semua stok dalam keadaan baik!</td></tr>';
        return;
    }

    tbody.innerHTML = items.map(item => `
        <tr>
            <td><strong>${item.Item_ID}</strong></td>
            <td>${item.Item_Name}</td>
            <td style="color:var(--danger-color); font-weight:bold;">${item.Current_Stock || 0}</td>
            <td><span class="badge badge-low">${item.Min_Stock}</span></td>
        </tr>
    `).join('');
}

function renderRecentTransactions(transactions) {
    const tbody = document.querySelector('#recent-trans-table tbody');
    if (transactions.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;">Tiada rekod transaksi.</td></tr>';
        return;
    }

    tbody.innerHTML = transactions.map(t => {
        let badgeClass = 'badge-in';
        let typeDisplay = 'STOCK IN';
        if (t.Type === 'STOCK_OUT') { badgeClass = 'badge-out'; typeDisplay = 'STOCK OUT'; }
        if (t.Type === 'RETURN') { badgeClass = 'badge-return'; typeDisplay = 'RETURN'; }

        return `
        <tr>
            <td style="font-size: 0.85rem;">${t.Timestamp}</td>
            <td><span class="badge ${badgeClass}">${typeDisplay}</span></td>
            <td><strong>${t.Item_ID}</strong><br><small style="color:var(--text-secondary)">${t.Item_Name}</small></td>
            <td><strong>${t.Quantity}</strong></td>
            <td>${t.Project || '-'}</td>
            <td>${t.Entered_By}</td>
        </tr>
    `}).join('');
}

// Custom Searchable Dropdown Logic
function showDropdown(prefix) {
    document.getElementById(`${prefix}-dropdown`).classList.add('active');
    filterDropdown(prefix, document.getElementById(`${prefix}-search`).value);
}

function selectItem(prefix, id, name, stock, unit) {
    document.getElementById(`${prefix}-search`).value = `${id} - ${name}`;
    document.getElementById(`${prefix}-item-id`).value = id;
    document.getElementById(`${prefix}-item-name`).value = name;

    const stockEl = document.getElementById(`${prefix}-current-stock`);
    stockEl.innerHTML = `Stok Terkini: <strong style="color:var(--primary-color)">${stock} ${unit}</strong>`;

    // Set max quantity for stock out
    if (prefix === 'out') {
        const qtyInput = document.getElementById('out-qty');
        qtyInput.max = stock;
        qtyInput.placeholder = `Max: ${stock}`;
    }

    document.getElementById(`${prefix}-dropdown`).classList.remove('active');
}

function filterDropdown(prefix, query) {
    const q = query.toLowerCase();
    const dropdown = document.getElementById(`${prefix}-dropdown`);

    const matched = masterItems.filter(item =>
        String(item.Item_ID).toLowerCase().includes(q) ||
        String(item.Item_Name).toLowerCase().includes(q)
    );

    if (matched.length === 0) {
        dropdown.innerHTML = '<div class="combo-item" style="color: var(--text-secondary)">Tiada item dijumpai</div>';
        return;
    }

    // Limit to 50 results so 500+ items don't freeze the DOM
    const displayLimit = 50;
    let html = matched.slice(0, displayLimit).map(item => `
        <div class="combo-item" onclick="selectItem('${prefix}', '${item.Item_ID}', '${item.Item_Name.replace(/'/g, "\\'")}', '${item.Current_Stock || 0}', '${item.Unit}')">
            <strong>${item.Item_ID}</strong> - ${item.Item_Name} <br>
            <small style="color:var(--text-secondary)">Stok: ${item.Current_Stock || 0} ${item.Unit}</small>
        </div>
    `).join('');

    if (matched.length > displayLimit) {
        html += `<div class="combo-item" style="text-align:center; color: var(--text-secondary); cursor:default; background:white;">... dan ${matched.length - displayLimit} lagi. Sila taip untuk tapis.</div>`;
    }

    dropdown.innerHTML = html;
}

// --- Unified Add/Receive Item Dropdown Logic ---
function generateNextId() {
    if (!masterItems || masterItems.length === 0) return "ITM001";
    let maxNum = 0;
    masterItems.forEach(item => {
        const match = String(item.Item_ID).match(/\d+/);
        if (match) {
            const num = parseInt(match[0], 10);
            if (num > maxNum) maxNum = num;
        }
    });
    const nextNum = maxNum + 1;
    return "ITM" + nextNum.toString().padStart(3, '0');
}

function setSearchToNextId(nextId) {
    document.getElementById('add-search').value = nextId;
    document.getElementById('add-dropdown').classList.remove('active');
    filterUnifiedDropdown(nextId);
}

function showUnifiedDropdown() {
    document.getElementById(`add-dropdown`).classList.add('active');
    filterUnifiedDropdown(document.getElementById(`add-search`).value);
}

function selectUnifiedItem(id, name, stock, unit, category, minStock) {
    document.getElementById('add-search').value = id; // Just show ID in search bar
    document.getElementById('add-dropdown').classList.remove('active');

    // Auto-fill and lock existing item
    document.getElementById('add-item-id').value = id;
    document.getElementById('add-name').value = name;
    document.getElementById('add-name').readOnly = true;
    document.getElementById('add-name').style.backgroundColor = '#f0f0f0';

    // Hide new item specific fields
    document.getElementById('new-item-fields').style.display = 'none';
    document.getElementById('new-item-threshold').style.display = 'none';

    // Update status UI
    document.getElementById('add-status').innerHTML = `Item Sedia Ada (Stok Semasa: ${stock || 0} ${unit})`;
    document.getElementById('add-status').style.color = 'var(--text-secondary)';
}

function filterUnifiedDropdown(query) {
    const q = query.toLowerCase().trim();
    const dropdown = document.getElementById(`add-dropdown`);

    // If the exact ID is typed manually without clicking dropdown, auto-select it.
    // Otherwise, treat it as a new item typing.
    const exactMatch = masterItems.find(item => String(item.Item_ID).toLowerCase() === q);

    if (exactMatch) {
        // Setup existing item view
        document.getElementById('add-item-id').value = exactMatch.Item_ID;
        document.getElementById('add-name').value = exactMatch.Item_Name;
        document.getElementById('add-name').readOnly = true;
        document.getElementById('add-name').style.backgroundColor = '#f0f0f0';
        document.getElementById('new-item-fields').style.display = 'none';
        document.getElementById('new-item-threshold').style.display = 'none';
        document.getElementById('add-status').innerHTML = `Item Sedia Ada (Stok Semasa: ${exactMatch.Current_Stock || 0} ${exactMatch.Unit})`;
        document.getElementById('add-status').style.color = 'var(--text-secondary)';
    } else {
        // Reset to new item mode
        document.getElementById('add-item-id').value = '';
        document.getElementById('add-name').readOnly = false;
        document.getElementById('add-name').style.backgroundColor = 'white';
        document.getElementById('new-item-fields').style.display = 'block';
        document.getElementById('new-item-threshold').style.display = 'block';
        if (q.length > 0) {
            document.getElementById('add-status').innerHTML = `Item Baru (Sila lengkapkan butiran di bawah)`;
            document.getElementById('add-status').style.color = 'var(--success-color)';
        } else {
            document.getElementById('add-status').innerHTML = ``;
        }
    }

    const matched = masterItems.filter(item =>
        String(item.Item_ID).toLowerCase().includes(q) ||
        String(item.Item_Name).toLowerCase().includes(q)
    );

    let html = "";

    // Auto-ID generator button when starting to type
    if (q.length === 0) {
        const nextId = generateNextId();
        html += `<div class="combo-item" style="color: var(--primary-color); font-weight:bold; cursor:pointer; background-color: #f0f4fc; border-bottom: 2px solid var(--border-color);" onclick="setSearchToNextId('${nextId}')">
            ✨ [KLIK DI SINI] JANA ID AUTOMATIK JIKA BARANG BARU (Auto-ID: ${nextId})
        </div>`;
    }

    if (matched.length === 0) {
        if (q.length > 0) {
            html += `<div class="combo-item" style="color: var(--success-color); font-weight:bold;">✨ Mendaftar ID Baru: ${q.toUpperCase()}</div>`;
        }
        dropdown.innerHTML = html;
        return;
    }

    const displayLimit = 50;
    html += matched.slice(0, displayLimit).map(item => `
        <div class="combo-item" onclick="selectUnifiedItem('${item.Item_ID}', '${item.Item_Name.replace(/'/g, "\\'")}', '${item.Current_Stock || 0}', '${item.Unit}', '${item.Category}', '${item.Min_Stock}')">
            <strong>${item.Item_ID}</strong> - ${item.Item_Name} <br>
            <small style="color:var(--text-secondary)">Stok: ${item.Current_Stock || 0} ${item.Unit}</small>
        </div>
    `).join('');

    if (matched.length > displayLimit) {
        html += `<div class="combo-item" style="text-align:center; color: var(--text-secondary); cursor:default; background:white;">... dan ${matched.length - displayLimit} lagi.</div>`;
    }

    dropdown.innerHTML = html;
}

// Form Submission handler
async function handleTransaction(event, type) {
    event.preventDefault();

    let prefix = 'in';
    if (type === 'STOCK_OUT') prefix = 'out';
    if (type === 'RETURN') prefix = 'ret';

    const itemId = document.getElementById(`${prefix}-item-id`).value;
    if (!itemId) {
        showToast('Sila pilih item dari senarai terlebih dahulu!', 'error');
        return;
    }

    const payload = {
        Type: type,
        Item_ID: itemId,
        Item_Name: document.getElementById(`${prefix}-item-name`).value,
        Quantity: document.getElementById(`${prefix}-qty`).value,
        Entered_By: document.getElementById(`${prefix}-user`).value,
    };

    if (type === 'STOCK_IN') {
        payload.Remarks = document.getElementById('in-remarks').value;
    } else if (type === 'STOCK_OUT') {
        payload.Project = document.getElementById('out-project').value;
        // Check for negative stock safety visually, though backend verifies too
        const qty = parseInt(payload.Quantity);
        const maxStock = parseInt(document.getElementById('out-qty').max || 0);
        if (qty > maxStock) {
            showToast('Kuantiti stok out melebihi stok yang ada!', 'error');
            return;
        }
    } else if (type === 'RETURN') {
        payload.Project = document.getElementById('ret-project').value;
    }

    document.getElementById('global-loader').style.display = 'flex';

    try {
        const response = await fetch(SCRIPT_URL, {
            method: 'POST',
            body: JSON.stringify({ action: "addTransaction", payload: payload })
            // Note: Google Apps Script handles POST requests natively when Content-Type is text/plain.
            // Using application/json triggers an OPTIONS preflight which GAS doesn't handle well natively without setup.
        });

        const data = await response.json();
        if (response.ok && data.status === 'success') {
            showToast(`Transaksi berjaya disimpan! Baki terkini: ${data.new_stock}`);

            // Reset form
            event.target.reset();
            document.getElementById(`${prefix}-item-id`).value = '';
            document.getElementById(`${prefix}-item-name`).value = '';
            document.getElementById(`${prefix}-current-stock`).innerHTML = '';

            // Refresh underlying master list
            await fetchItems();

            // Auto switch back to dashboard after 1.5s
            setTimeout(() => {
                switchTab('dashboard');
            }, 1500);

        } else {
            showToast(data.message || 'Terdapat ralat semasa menyimpan.', 'error');
        }
    } catch (e) {
        showToast('Ralat sambungan pelayan.', 'error');
    } finally {
        document.getElementById('global-loader').style.display = 'none';
    }
}

// --- PIN Modal Logic ---
function promptPin() {
    document.getElementById('pin-modal').style.display = 'flex';
    document.getElementById('modal-pin-input').focus();
}

function closePinModal() {
    document.getElementById('pin-modal').style.display = 'none';
    document.getElementById('modal-pin-input').value = '';
}

function checkPin() {
    const inputPin = document.getElementById('modal-pin-input').value;

    // Front-end check matching back-end. 
    // We also send this to the back-end via API payload for complete validation.
    if (inputPin === "8899") {
        authorizedPin = inputPin;
        closePinModal();

        // Remove active from other tabs
        document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
        document.getElementById('btn-tab-add').classList.add('active');

        // Show correct view
        document.querySelectorAll('.view-section').forEach(view => view.classList.remove('active'));
        document.getElementById('view-add_item').classList.add('active');

    } else {
        showToast('PIN Keselamatan Salah!', 'error');
        document.getElementById('modal-pin-input').value = '';
        document.getElementById('modal-pin-input').focus();
    }
}

// Handler for Unified Item Registration / Stok In
async function handleUnifiedAdd(event) {
    event.preventDefault();

    const isNewItem = document.getElementById('add-item-id').value === '';
    const itemIdInput = isNewItem ? document.getElementById('add-search').value.trim().toUpperCase() : document.getElementById('add-item-id').value;

    if (!itemIdInput) {
        showToast('Sila isikan ID Barang (Item ID)', 'error');
        return;
    }

    const payload = {
        Item_ID: itemIdInput,
        Item_Name: document.getElementById('add-name').value.trim(),
        Quantity: document.getElementById('add-qty').value,
        Remarks: document.getElementById('add-remarks').value,
        Entered_By: document.getElementById('add-user').value,
        Admin_PIN: authorizedPin // Use the pin authorized from modal
    };

    if (isNewItem) {
        payload.Category = document.getElementById('add-category').value;
        payload.Unit = document.getElementById('add-unit').value;
        payload.Min_Stock = document.getElementById('add-min').value;

        if (!payload.Category || !payload.Unit) {
            showToast('Sila pilih Kategori dan Unit untuk item baru.', 'error');
            return;
        }
    }

    document.getElementById('global-loader').style.display = 'flex';

    try {
        const response = await fetch(SCRIPT_URL, {
            method: 'POST',
            body: JSON.stringify({ action: "unifiedAdd", payload: payload })
        });

        const data = await response.json();

        if (response.ok && data.status === 'success') {
            showToast(data.message);
            event.target.reset();

            // Re-enable fields that might have been disabled
            document.getElementById('add-name').readOnly = false;
            document.getElementById('add-name').style.backgroundColor = 'white';
            document.getElementById('new-item-fields').style.display = 'block';
            document.getElementById('new-item-threshold').style.display = 'block';
            document.getElementById('add-item-id').value = '';
            document.getElementById('add-status').innerHTML = '';

            authorizedPin = ""; // Reset security pin on success

            // Refresh items so it appears in dropdowns immediately
            await fetchItems();

            setTimeout(() => {
                switchTab('dashboard');
            }, 1500);
        } else {
            showToast(data.message || 'Gagal menyimpan transaksi.', 'error');
        }
    } catch (e) {
        showToast('Ralat sambungan pelayan.', 'error');
    } finally {
        document.getElementById('global-loader').style.display = 'none';
    }
}

// Toast UI utility
function showToast(msg, type = 'success') {
    const toast = document.getElementById('toast');
    toast.textContent = msg;
    toast.style.background = type === 'success' ? 'var(--success-color)' : 'var(--danger-color)';
    toast.classList.add('show');

    setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}
