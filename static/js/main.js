// PLEASE REPLACE THIS WITH YOUR DEPLOYED GOOGLE APPS SCRIPT WEB APP URL
const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwCFY9S47tGGG450vY81ZjbyF2C6ZM8GPAKsVxftBWrbaZpONFuZ0FZDaLQyVfX2BIOsg/exec';

let masterItems = [];
let staffList = [];
let allTransactions = []; // Store full history for profile filtering
let pendingTransactionPayload = null; // Mostly used for SetPIN now

// Global Auth State
let currentUser = "";
let currentUserPin = "";
let isAdmin = false;

function logout() {
    currentUser = "";
    currentUserPin = "";
    isAdmin = false;

    // Hide App, Show Login
    document.querySelector('.container').style.display = 'none';
    document.getElementById('global-login-modal').style.display = 'flex';

    // Reset login inputs
    document.getElementById('login-pin').value = '';
    document.getElementById('login-user').value = '';
    document.getElementById('login-pin-group').style.display = 'none';
    document.getElementById('btn-login').style.display = 'none';
    document.getElementById('btn-create-pin').style.display = 'none';

    // Hide admin tab & reset header name
    document.getElementById('btn-tab-admin').style.display = 'none';
    if (document.getElementById('header-user-name')) document.getElementById('header-user-name').innerText = '';
    if (document.getElementById('header-dash')) document.getElementById('header-dash').style.display = 'none';
    if (document.getElementById('header-logout-btn')) document.getElementById('header-logout-btn').style.display = 'none';

    // Clear localStorage values
    localStorage.removeItem('bdt_login_user');
    localStorage.removeItem('bdt_login_pin');
    localStorage.removeItem('bdt_login_admin');
    localStorage.removeItem('bdt_login_time');

    // Reset transaction forms
    document.querySelectorAll('form').forEach(f => f.reset());

    // Switch to dashboard view for the next user
    switchTab('dashboard');
    showToast('Berjaya Log Keluar', 'success');

    // Give time to read toast before page refresh or redirect. Just showing it is enough.
}

let sessionTimer;

document.addEventListener('DOMContentLoaded', () => {
    // Check local storage for active session
    const savedUser = localStorage.getItem('bdt_login_user');
    const savedPin = localStorage.getItem('bdt_login_pin');
    const savedAdmin = localStorage.getItem('bdt_login_admin') === 'true';
    const savedTime = localStorage.getItem('bdt_login_time');

    if (savedUser && savedPin && savedTime) {
        const elapsedHrs = (Date.now() - parseInt(savedTime)) / (1000 * 60 * 60);
        if (elapsedHrs < 1) {
            // Restore Session
            currentUser = savedUser;
            currentUserPin = savedPin;
            isAdmin = savedAdmin;

            if (document.getElementById('out-user')) document.getElementById('out-user').value = currentUser;
            if (document.getElementById('ret-user')) document.getElementById('ret-user').value = currentUser;
            if (document.getElementById('add-user')) document.getElementById('add-user').value = currentUser;

            if (document.getElementById('header-user-name')) document.getElementById('header-user-name').innerText = currentUser;
            if (document.getElementById('header-dash')) document.getElementById('header-dash').style.display = 'inline-block';
            if (document.getElementById('header-logout-btn')) document.getElementById('header-logout-btn').style.display = 'inline-block';

            if (isAdmin) {
                document.getElementById('btn-tab-admin').style.display = 'inline-block';
            }

            document.getElementById('global-login-modal').style.display = 'none';
            document.querySelector('.container').style.display = 'block';

            fetchTransactions();
            fetchItems();

            // Auto logout after remaining time
            const remainingTime = (1 * 60 * 60 * 1000) - (Date.now() - parseInt(savedTime));
            sessionTimer = setTimeout(() => {
                showToast('Sesi tamat. Sila log masuk semula.', 'error');
                logout();
            }, remainingTime);

            fetchStaff(); // Refresh staff quietly
            return;
        } else {
            // Session expired
            localStorage.clear();
        }
    }

    // No active session -> show login
    document.querySelector('.container').style.display = 'none'; // Hide main UI initially
    document.getElementById('global-login-modal').style.display = 'flex'; // Show Login Modal

    fetchStaff(); // Only fetch staff list initially

    // Close dropdowns when clicking outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.combo-box')) {
            document.querySelectorAll('.combo-list').forEach(el => el.classList.remove('active'));
        }
    });
});

function switchTab(viewId) {
    // Update nav buttons
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));

    // Safety check - if event exists (triggered by click) use it, otherwise target the relevant button manually
    if (window.event && window.event.target.classList.contains('tab-btn')) {
        window.event.target.classList.add('active');
    }

    // Update views
    document.querySelectorAll('.view-section').forEach(view => view.classList.remove('active'));
    document.getElementById(`view-${viewId}`).classList.add('active');

    // Refresh data if going to dashboard
    if (viewId === 'dashboard') {
        fetchTransactions();
        fetchItems();
        // Background sync staff updates without loaders disrupting UI
        fetch(`${SCRIPT_URL}?action=getStaff`)
            .then(r => r.json())
            .then(d => { if (d.status === 'success') staffList = d.data; })
            .catch(() => { });
    }

    if (viewId === 'admin') {
        renderAdminList();
    }
}

async function fetchStaff() {
    try {
        const response = await fetch(`${SCRIPT_URL}?action=getStaff`);
        const data = await response.json();
        if (data.status === 'success') {
            staffList = data.data;
            populateStaffDropdowns();
        }
    } catch (error) {
        console.error("Ralat memuatkan nama ahli", error);
    }
}

function populateStaffDropdowns() {
    const options = `<option value="" disabled selected>Senarai Ahli</option>` +
        staffList.map(s => `<option value="${s.Staff_Name}">${s.Staff_Name}</option>`).join('');

    if (document.getElementById('login-user')) document.getElementById('login-user').innerHTML = options;
}

async function fetchItems() {
    try {
        const response = await fetch(`${SCRIPT_URL}?action=getItems`);
        const data = await response.json();
        if (data.status === 'success') {
            masterItems = data.data;

            // Render active totals and low stock dashboard alerts
            updateDashboard();

            // Re-render dropdowns just in case
            ['out', 'ret'].forEach(prefix => filterDropdown(prefix, ''));
            // And unified dropdown
            if (document.getElementById('add-search')) filterUnifiedDropdown('');
        }
    } catch (error) {
        console.error(error);
        showToast('Ralat DB: ' + error.message, 'error');
    }
}

async function fetchTransactions() {
    try {
        const response = await fetch(`${SCRIPT_URL}?action=getTransactions`);
        const data = await response.json();
        if (data.status === 'success') {
            document.getElementById('stat-total-logs').textContent = data.data.length;
            allTransactions = data.data; // Cache all for profile view
            sortRecentTransactions();
            sortProfileTransactions();
        }
    } catch (error) {
        console.error(error);
        showToast('Ralat Transaksi: ' + error.message, 'error');
    }
}

function updateDashboard() {
    // Build Low Stock Table
    const lowStockTbody = document.querySelector('#low-stock-table tbody');
    lowStockTbody.innerHTML = '';
    let lowStockCount = 0;

    let totalManagedItems = 0;

    masterItems.forEach(item => {
        if (item.Status !== 'Discontinued') {
            totalManagedItems++;

            if (parseInt(item.Current_Stock || 0) <= parseInt(item.Min_Stock || 0)) {
                lowStockCount++;
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>${item.Item_ID}</td>
                    <td>${item.Item_Name}</td>
                    <td style="color: #ff8c00; font-weight: bold;">${item.Current_Stock || 0}</td>
                    <td style="color: #ff8c00; font-weight: bold;">${item.Min_Stock || 0}</td>
                `;
                lowStockTbody.appendChild(tr);
            }
        }
    });

    document.getElementById('stat-total-items').innerText = totalManagedItems;
    document.getElementById('stat-low-stock').textContent = lowStockCount;

    if (lowStockCount === 0) {
        lowStockTbody.innerHTML = '<tr><td colspan="4" style="text-align:center;">Semua stok dalam keadaan baik!</td></tr>';
    }
}

function renderRecentTransactions(transactions) {
    const tbody = document.querySelector('#recent-trans-table tbody');
    if (transactions.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;">Tiada rekod transaksi.</td></tr>';
        return;
    }

    tbody.innerHTML = transactions.map(t => {
        let badgeClass = 'badge-tambah';
        let typeDisplay = 'TAMBAH';
        if (t.Type === 'AMBIL') { badgeClass = 'badge-ambil'; typeDisplay = 'AMBIL'; }
        if (t.Type === 'PULANG') { badgeClass = 'badge-pulang'; typeDisplay = 'PULANG'; }
        if (t.Type === 'DAFTAR') { badgeClass = 'badge-daftar'; typeDisplay = 'DAFTAR'; }
        if (t.Type === 'TAMBAH') { badgeClass = 'badge-tambah'; typeDisplay = 'TAMBAH'; }
        // Fallbacks for old sheet data
        if (t.Type === 'STOCK_OUT') { badgeClass = 'badge-ambil'; typeDisplay = 'AMBIL'; }
        if (t.Type === 'RETURN') { badgeClass = 'badge-pulang'; typeDisplay = 'PULANG'; }
        if (t.Type === 'STOCK_IN') { badgeClass = 'badge-tambah'; typeDisplay = 'TAMBAH'; }

        return `
        <tr>
            <td style="font-size: 0.75rem; white-space: nowrap;">${formatTimestamp(t.Timestamp)}</td>
            <td><span class="badge ${badgeClass}" style="white-space: nowrap;">${typeDisplay}</span></td>
            <td><strong>${t.Item_ID}</strong><br><small style="color:var(--text-secondary)">${t.Item_Name}</small></td>
            <td><strong>${t.Quantity}</strong></td>
            <td style="font-size: 0.75rem; word-break: break-word;">${t.Project || '-'}</td>
            <td style="font-size: 0.75rem;">${t.Entered_By}</td>
        </tr>
    `}).join('');
}

function renderProfileHistory(sortedTransactions) {
    const tbody = document.querySelector('#profile-trans-table tbody');
    if (!tbody) return; // Fail-safe

    // Update Profile Stat display
    document.getElementById('profile-name-display').innerText = currentUser || "Pengguna Tidak Dikenali";

    // Filter personal transactions if not provided
    const personalTrans = sortedTransactions || allTransactions.filter(t => t.Entered_By === currentUser);

    document.getElementById('profile-stats-display').innerText = `Anda merekodkan ${allTransactions.filter(t => t.Entered_By === currentUser).length} unit transaksi setakat ini.`;

    if (personalTrans.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">Tiada rekod transaksi peribadi.</td></tr>';
        return;
    }

    // Render logic:
    tbody.innerHTML = personalTrans.map(t => {
        let badgeClass = 'badge-tambah';
        let typeDisplay = 'TAMBAH';
        if (t.Type === 'AMBIL') { badgeClass = 'badge-ambil'; typeDisplay = 'AMBIL'; }
        if (t.Type === 'PULANG') { badgeClass = 'badge-pulang'; typeDisplay = 'PULANG'; }
        if (t.Type === 'DAFTAR') { badgeClass = 'badge-daftar'; typeDisplay = 'DAFTAR'; }
        if (t.Type === 'TAMBAH') { badgeClass = 'badge-tambah'; typeDisplay = 'TAMBAH'; }
        // Fallbacks for old sheet data
        if (t.Type === 'STOCK_OUT') { badgeClass = 'badge-ambil'; typeDisplay = 'AMBIL'; }
        if (t.Type === 'RETURN') { badgeClass = 'badge-pulang'; typeDisplay = 'PULANG'; }
        if (t.Type === 'STOCK_IN') { badgeClass = 'badge-tambah'; typeDisplay = 'TAMBAH'; }

        return `
        <tr>
            <td style="font-size: 0.75rem; white-space: nowrap;">${formatTimestamp(t.Timestamp)}</td>
            <td><span class="badge ${badgeClass}" style="white-space: nowrap;">${typeDisplay}</span></td>
            <td><strong>${t.Item_ID}</strong><br><small style="color:var(--text-secondary)">${t.Item_Name}</small></td>
            <td><strong>${t.Quantity}</strong></td>
            <td style="font-size: 0.75rem; word-break: break-word;">${t.Project || t.Remarks || '-'}</td>
        </tr>
    `}).join('');
}

function formatTimestamp(isoString) {
    if (!isoString) return '-';

    // Check if it's the new standard backend format (DD/MM/YY HH:MM AM/PM)
    const parts = String(isoString).trim().split(' ');
    if (parts.length === 3 && parts[0].includes('/')) {
        return `<div style="line-height:1.2;">${parts[0]}<br><span style="color:var(--text-secondary);font-size:0.85em;">${parts[1]} ${parts[2]}</span></div>`;
    }

    // Fallback for older formats in the database
    const d = new Date(isoString);
    if (!isNaN(d.getTime())) {
        const pad = n => String(n).padStart(2, '0');
        const day = pad(d.getDate());
        const month = pad(d.getMonth() + 1);
        const year = String(d.getFullYear()).slice(-2);
        let hours = d.getHours();
        const mins = pad(d.getMinutes());
        const ampm = hours >= 12 ? 'PM' : 'AM';
        hours = hours % 12;
        hours = hours ? hours : 12; // the hour '0' should be '12'

        return `<div style="line-height:1.2;">${day}/${month}/${year}<br><span style="color:var(--text-secondary);font-size:0.85em;">${pad(hours)}:${mins} ${ampm}</span></div>`;
    }
    return isoString;
}

// Custom Searchable Dropdown Logic
function showDropdown(prefix) {
    document.getElementById(`${prefix}-dropdown`).classList.add('active');
    filterDropdown(prefix, document.getElementById(`${prefix}-search`).value);
}

function selectItem(prefix, id, name, stock, unit, totalQty) {
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
    } else if (prefix === 'ret') {
        const maxReturn = parseInt(totalQty || stock) - parseInt(stock);
        const qtyInput = document.getElementById('ret-qty');
        qtyInput.max = maxReturn;
        qtyInput.placeholder = `Max: ${maxReturn}`;
        stockEl.innerHTML += `<br><small style="color:var(--warning-color)">Maksimum pemulangan: ${maxReturn} ${unit}</small>`;
    }

    document.getElementById(`${prefix}-dropdown`).classList.remove('active');
}

function filterDropdown(prefix, query) {
    const q = query.toLowerCase();
    const dropdown = document.getElementById(`${prefix}-dropdown`);

    // Filter items based on query AND ensuring they are not Discontinued
    const matched = masterItems.filter(item => {
        if (item.Status === 'Discontinued') return false;
        return String(item.Item_ID).toLowerCase().includes(q) ||
            String(item.Item_Name).toLowerCase().includes(q);
    });

    if (matched.length === 0) {
        dropdown.innerHTML = '<div class="combo-item" style="color: var(--text-secondary)">Tiada item dijumpai</div>';
        return;
    }

    // Limit to 50 results so 500+ items don't freeze the DOM
    const displayLimit = 50;
    let html = matched.slice(0, displayLimit).map(item => `
        <div class="combo-item" onclick="selectItem('${prefix}', '${item.Item_ID}', '${item.Item_Name.replace(/'/g, "\\'")}', '${item.Current_Stock || 0}', '${item.Unit}', '${item.Total_Quantity || 0}')">
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

        const isDiscontinued = exactMatch.Status === 'Discontinued';
        const statusText = isDiscontinued ?
            `<strong style="color:var(--danger-color)">Barang Discontinued (Akan diaktifkan semula secara automatik)</strong>` :
            `Item Sedia Ada (Stok Semasa: ${exactMatch.Current_Stock || 0} ${exactMatch.Unit})`;

        document.getElementById('add-status').innerHTML = statusText;
        document.getElementById('add-status').style.color = isDiscontinued ? '' : 'var(--text-secondary)';
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

    // Filter items based on query (including Discontinued)
    const filtered = masterItems.filter(item => {
        return String(item.Item_ID).toLowerCase().includes(q) || String(item.Item_Name).toLowerCase().includes(q);
    });

    let html = "";

    // Auto-ID generator button when starting to type
    if (q.length === 0) {
        const nextId = generateNextId();
        html += `<div class="combo-item" style="color: var(--primary-color); font-weight:bold; cursor:pointer; background-color: #f0f4fc; border-bottom: 2px solid var(--border-color);" onclick="setSearchToNextId('${nextId}')">
            ✨ [KLIK DI SINI] JANA ID AUTOMATIK JIKA BARANG BARU (Auto-ID: ${nextId})
        </div>`;
    }

    if (filtered.length === 0) {
        if (q.length > 0) {
            html += `<div class="combo-item" style="color: var(--success-color); font-weight:bold;">✨ Mendaftar ID Baru: ${q.toUpperCase()}</div>`;
        }
        dropdown.innerHTML = html;
        return;
    }

    const displayLimit = 50;
    html += filtered.slice(0, displayLimit).map(item => {
        const isDiscontinued = item.Status === 'Discontinued';
        const nameStyle = isDiscontinued ? 'text-decoration: line-through; color: #999;' : '';
        const badge = isDiscontinued ? `<span class="stock-badge badge-danger" style="font-size: 0.6rem; padding: 0.1rem 0.3rem; vertical-align: middle; margin-left: 5px;">Discontinued</span>` : '';

        return `
        <div class="combo-item" onclick="selectUnifiedItem('${item.Item_ID}', '${item.Item_Name.replace(/'/g, "\\'")}', '${item.Current_Stock || 0}', '${item.Unit}', '${item.Category}', '${item.Min_Stock}')">
            <strong>${item.Item_ID}</strong> - <span style="${nameStyle}">${item.Item_Name}</span>${badge} <br>
            <small style="color:var(--text-secondary)">Stok: ${item.Current_Stock || 0} ${item.Unit}</small>
        </div>
        `;
    }).join('');

    if (filtered.length > displayLimit) {
        html += `<div class="combo-item" style="text-align:center; color: var(--text-secondary); cursor:default; background:white;">... dan ${filtered.length - displayLimit} lagi.</div>`;
    }

    dropdown.innerHTML = html;
}

// --- SUPPLIER DROPDOWN ---
function showSupplierDropdown() {
    document.querySelectorAll('.combo-list').forEach(el => el.classList.remove('active'));
    document.getElementById('supplier-dropdown').classList.add('active');
    filterSupplierDropdown(document.getElementById('add-remarks').value);
}

function filterSupplierDropdown(query) {
    const q = query.toLowerCase().trim();
    const dropdown = document.getElementById('supplier-dropdown');

    const uniqueSuppliers = [...new Set(masterItems
        .map(item => (item.Supplier || "").trim())
        .filter(sup => sup !== "" && sup !== "-")
    )].sort();

    const filtered = uniqueSuppliers.filter(sup => sup.toLowerCase().includes(q));

    let html = "";
    if (filtered.length === 0) {
        if (q.length > 0) {
            html += `<div class="combo-item" style="color: var(--success-color); font-weight:bold; cursor:default; background:white;">✨ Sentuh 'Sahkan Simpan Stok' untuk simpan pembekal baru ini.</div>`;
        } else {
            html += `<div class="combo-item" style="color: var(--text-secondary); cursor:default; background:white;">Senarai pembekal kosong.</div>`;
        }
    } else {
        html += filtered.map(sup => `
            <div class="combo-item" onclick="selectSupplier('${sup.replace(/'/g, "\\'")}')">
                ${sup}
            </div>
        `).join('');
    }

    dropdown.innerHTML = html;
}

function selectSupplier(name) {
    document.getElementById('add-remarks').value = name;
    document.getElementById('supplier-dropdown').classList.remove('active');
}

// Form Submission handler
async function handleTransaction(event, type) {
    event.preventDefault();

    let prefix = 'in';
    if (type === 'AMBIL') prefix = 'out';
    if (type === 'PULANG') prefix = 'ret';

    const itemId = document.getElementById(`${prefix}-item-id`).value;
    if (!itemId) return showToast('Sila pilih item dari senarai terlebih dahulu!', 'error');

    const payload = {
        Type: type,
        Item_ID: itemId,
        Item_Name: document.getElementById(`${prefix}-item-name`).value,
        Quantity: document.getElementById(`${prefix}-qty`).value,
        Entered_By: currentUser,
        Staff_PIN: currentUserPin
    };

    if (type === 'STOCK_IN') {
        payload.Remarks = document.getElementById('in-remarks').value;
    } else if (type === 'AMBIL') {
        payload.Project = document.getElementById('out-project').value;
        const qty = parseInt(payload.Quantity);
        const maxStock = parseInt(document.getElementById('out-qty').max || 0);
        if (qty > maxStock) return showToast('Kuantiti stok out melebihi stok yang ada!', 'error');
    } else if (type === 'PULANG') {
        payload.Project = 'Dikembalikan'; // We keep the backend payload consistent
        const qty = parseInt(payload.Quantity);
        const maxReturn = parseInt(document.getElementById('ret-qty').max || 0);
        if (qty > maxReturn) {
            return showToast(`Anda hanya boleh memulangkan maksimum ${maxReturn} unit. Sila semak semula!`, 'error');
        }
    }

    document.getElementById('global-loader').style.display = 'flex';

    try {
        const response = await fetch(SCRIPT_URL, {
            method: 'POST',
            body: JSON.stringify({ action: "addTransaction", payload: payload })
        });

        const data = await response.json();
        if (response.ok && data.status === 'success') {
            showToast(`Transaksi berjaya disimpan! Baki terkini: ${data.new_stock}`);

            document.getElementById(`${prefix}-item-id`).value = '';
            document.getElementById(`${prefix}-item-name`).value = '';
            document.getElementById(`${prefix}-search`).value = '';
            document.getElementById(`${prefix}-qty`).value = '';
            if (document.getElementById(`${prefix}-project`)) document.getElementById(`${prefix}-project`).value = '';
            document.getElementById(`${prefix}-current-stock`).innerHTML = '';

            await fetchItems();
            await fetchTransactions();
            setTimeout(() => switchTab('dashboard'), 1500);

        } else {
            showErrorModal(data.message || 'Terdapat ralat semasa menyimpan.');
        }
    } catch (e) {
        showErrorModal('Ralat sambungan pelayan.');
    } finally {
        document.getElementById('global-loader').style.display = 'none';
    }
}

// Global Login Logic
function handleLoginUserSelect() {
    const selectedUser = document.getElementById('login-user').value;
    const staffObj = staffList.find(s => s.Staff_Name === selectedUser);

    if (staffObj && !staffObj.Has_PIN) {
        document.getElementById('login-pin-group').style.display = 'none';
        document.getElementById('btn-login').style.display = 'none';
        document.getElementById('btn-create-pin').style.display = 'block';
    } else {
        document.getElementById('btn-create-pin').style.display = 'none';
        document.getElementById('login-pin-group').style.display = 'block';
        document.getElementById('btn-login').style.display = 'block';
        document.getElementById('login-pin').value = '';
        document.getElementById('login-pin').focus();
    }
}

function openCreatePinModal() {
    const selectedUser = document.getElementById('login-user').value;
    pendingTransactionPayload = { Entered_By: selectedUser, is_login_auth: true };

    const staffSetPinModal = document.getElementById('staff-set-pin-modal');
    staffSetPinModal.style.zIndex = '2001'; // Ensure it renders above global login (z-index: 2000)
    staffSetPinModal.style.display = 'flex';

    document.getElementById('staff-new-pin').value = '';
    document.getElementById('staff-confirm-pin').value = '';
    setTimeout(() => document.getElementById('staff-new-pin').focus(), 100);
}

async function submitLogin() {
    const selectedUser = document.getElementById('login-user').value;
    const pin = document.getElementById('login-pin').value;

    if (!selectedUser) return showToast('Sila pilih nama pengguna.', 'error');
    if (pin.length !== 4) return showToast('PIN mestilah 4 angka.', 'error');

    document.getElementById('global-loader').style.display = 'flex';

    try {
        const res = await fetch(SCRIPT_URL, {
            method: 'POST',
            body: JSON.stringify({
                action: "verifyLogin",
                payload: { Staff_Name: selectedUser, PIN: pin }
            })
        });
        const data = await res.json();

        if (data.status === 'success') {
            currentUser = selectedUser;
            currentUserPin = pin;
            isAdmin = data.is_admin === true;

            // Populate globally linked user fields
            if (document.getElementById('out-user')) document.getElementById('out-user').value = currentUser;
            if (document.getElementById('ret-user')) document.getElementById('ret-user').value = currentUser;
            if (document.getElementById('add-user')) document.getElementById('add-user').value = currentUser;

            if (document.getElementById('header-user-name')) document.getElementById('header-user-name').innerText = currentUser;
            if (document.getElementById('header-dash')) document.getElementById('header-dash').style.display = 'inline-block';
            if (document.getElementById('header-logout-btn')) document.getElementById('header-logout-btn').style.display = 'inline-block';

            // Show admin tab if authorized
            if (isAdmin) {
                document.getElementById('btn-tab-admin').style.display = 'inline-block';
            }

            // Save to localStorage
            localStorage.setItem('bdt_login_user', currentUser);
            localStorage.setItem('bdt_login_pin', currentUserPin);
            localStorage.setItem('bdt_login_admin', isAdmin);
            localStorage.setItem('bdt_login_time', Date.now());

            // Set 1-hour auto logout timer
            if (sessionTimer) clearTimeout(sessionTimer);
            sessionTimer = setTimeout(() => {
                showToast('Sesi tamat. Sila log masuk semula.', 'error');
                logout();
            }, 60 * 60 * 1000);

            document.getElementById('global-login-modal').style.display = 'none';
            document.querySelector('.container').style.display = 'block';

            // Fetch initial data payload smoothly
            fetchTransactions();
            fetchItems();

            showToast(`Selamat datang, ${currentUser}!`, 'success');
        } else {
            showToast(data.message || 'PIN Keselamatan Salah.', 'error');
            document.getElementById('login-pin').value = '';
            document.getElementById('login-pin').focus();
        }
    } catch (e) {
        showToast('Ralat sambungan pelayan.', 'error');
    } finally {
        document.getElementById('global-loader').style.display = 'none';
    }
}

// Staff Modal Logic
function closeStaffModal(type) {
    if (type === 'set') document.getElementById('staff-set-pin-modal').style.display = 'none';

    if (pendingTransactionPayload && pendingTransactionPayload.is_login_auth) {
        document.getElementById('login-user').value = '';
        document.getElementById('login-pin-group').style.display = 'none';
        document.getElementById('btn-login').style.display = 'none';
        document.getElementById('btn-create-pin').style.display = 'none';
    }
    pendingTransactionPayload = null;
}

async function submitSetStaffPin() {
    const pin1 = document.getElementById('staff-new-pin').value;
    const pin2 = document.getElementById('staff-confirm-pin').value;

    if (pin1.length !== 4 || isNaN(pin1)) return showToast('PIN mestilah 4 angka.', 'error');
    if (pin1 !== pin2) return showToast('Ralat: PIN pengesahan tidak sepadan!', 'error');

    document.getElementById('global-loader').style.display = 'flex';
    try {
        const res = await fetch(SCRIPT_URL, {
            method: 'POST',
            body: JSON.stringify({
                action: "setStaffPin",
                payload: { Staff_Name: pendingTransactionPayload.Entered_By, PIN: pin1 }
            })
        });
        const data = await res.json();
        if (data.status === 'success') {
            const staffObj = staffList.find(s => s.Staff_Name === pendingTransactionPayload.Entered_By);
            if (staffObj) staffObj.Has_PIN = true; // Set local flag

            showToast('Selesai! PIN anda telah disimpan.', 'success');
            document.getElementById('staff-set-pin-modal').style.display = 'none';

            if (pendingTransactionPayload.is_login_auth) {
                document.getElementById('btn-create-pin').style.display = 'none';
                document.getElementById('login-pin').value = pin1;
                document.getElementById('login-pin-group').style.display = 'block';
                document.getElementById('btn-login').style.display = 'block';
                submitLogin();
            }
        } else {
            showToast(data.message, 'error');
            document.getElementById('global-loader').style.display = 'none';
        }
    } catch (e) {
        showToast('Ralat sambungan.', 'error');
        document.getElementById('global-loader').style.display = 'none';
    }
}

function renderAdminList() {
    filterAdminList('');
}

function filterAdminList(query) {
    const q = query.toLowerCase();
    const tbody = document.querySelector('#admin-master-table tbody');
    tbody.innerHTML = ''; // Clear existing rows

    const filtered = masterItems.filter(item => {
        const idMatch = String(item.Item_ID).toLowerCase().includes(q);
        const nameMatch = String(item.Item_Name).toLowerCase().includes(q);
        return idMatch || nameMatch;
    });

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; padding: 1.5rem;">Tiada rekod dijumpai.</td></tr>`;
        return;
    }

    filtered.forEach(item => {
        const tr = document.createElement('tr');
        const isDiscontinued = item.Status === 'Discontinued';
        const statusBadge = isDiscontinued ? `<span class="stock-badge badge-danger">Discontinued</span>` : `<span class="stock-badge badge-success">Aktif</span>`;
        const actionBtnText = isDiscontinued ? 'Aktifkan Semula' : 'Set Discontinued';
        const actionBtnClass = isDiscontinued ? 'btn-submit' : 'btn-cancel';
        const newStatusTarget = isDiscontinued ? 'Active' : 'Discontinued';

        tr.innerHTML = `
            <td style="${isDiscontinued ? 'text-decoration: line-through; color: #999;' : ''}">${item.Item_ID}</td>
            <td style="${isDiscontinued ? 'color: #999;' : ''}">${item.Item_Name} <br><small style="color:var(--text-secondary)">${statusBadge}</small></td>
            <td>${item.Current_Stock || 0}</td>
            <td>
                <button class="${actionBtnClass}" style="padding: 0.3rem 0.6rem; font-size: 0.75rem; border-radius: 5px; margin: 0; width: 100%;" onclick="toggleItemStatus('${item.Item_ID}', '${newStatusTarget}')">
                    ${actionBtnText}
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

async function toggleItemStatus(id, newStatus) {
    if (!confirm(`Adakah anda pasti ingin menukar status item ${id} kepada ${newStatus}?`)) {
        return;
    }

    document.getElementById('global-loader').style.display = 'flex';
    try {
        const response = await fetch(SCRIPT_URL, {
            method: 'POST',
            body: JSON.stringify({
                action: "toggleItemStatus",
                payload: { Item_ID: id, New_Status: newStatus }
            })
        });
        const data = await response.json();

        if (response.ok && data.status === 'success') {
            showToast(`Status item ${id} berjaya dikemaskini kepada ${newStatus}.`, 'success');
            await fetchItems(); // Refresh items to update the UI
            renderAdminList(); // Re-render admin list
        } else {
            showErrorModal(data.message || 'Gagal mengemaskini status item.');
        }
    } catch (e) {
        showErrorModal('Ralat sambungan pelayan.');
    } finally {
        document.getElementById('global-loader').style.display = 'none';
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
        Entered_By: currentUser,
        Staff_PIN: currentUserPin
    };

    if (isNewItem) {
        payload.Category = document.getElementById('add-category').value;
        payload.Unit = document.getElementById('add-unit').value;
        payload.Min_Stock = document.getElementById('add-min').value;

        if (!payload.Category || !payload.Unit) {
            showToast('Sila pilih Kategori dan Unit untuk barang baru.', 'error');
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

            // Refresh items so it appears in dropdowns immediately
            await fetchItems();
            await fetchTransactions();

            setTimeout(() => {
                switchTab('dashboard');
            }, 1500);
        } else {
            showErrorModal(data.message || 'Gagal menyimpan transaksi.');
        }
    } catch (e) {
        showErrorModal('Ralat sambungan pelayan.');
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

// Error Modal Utility
function showErrorModal(msg) {
    document.getElementById('error-alert-msg').textContent = msg;
    document.getElementById('error-alert-modal').style.display = 'flex';
}

function closeErrorModal() {
    document.getElementById('error-alert-modal').style.display = 'none';
}
