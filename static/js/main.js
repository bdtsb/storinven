// PLEASE REPLACE THIS WITH YOUR DEPLOYED GOOGLE APPS SCRIPT WEB APP URL
const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwCFY9S47tGGG450vY81ZjbyF2C6ZM8GPAKsVxftBWrbaZpONFuZ0FZDaLQyVfX2BIOsg/exec';

let masterItems = [];
let staffList = [];
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
        showToast('Ralat memuatkan barang dari pangkalan data', 'error');
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
        showToast('Ralat memuatkan rekod transaksi terkini', 'error');
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
            <td style="font-size: 0.85rem;">${formatTimestamp(t.Timestamp)}</td>
            <td><span class="badge ${badgeClass}">${typeDisplay}</span></td>
            <td><strong>${t.Item_ID}</strong><br><small style="color:var(--text-secondary)">${t.Item_Name}</small></td>
            <td><strong>${t.Quantity}</strong></td>
            <td>${t.Project || '-'}</td>
            <td>${t.Entered_By}</td>
        </tr>
    `}).join('');
}

function formatTimestamp(isoString) {
    if (!isoString) return '-';
    if (String(isoString).includes('T')) {
        const d = new Date(isoString);
        if (!isNaN(d.getTime())) {
            const pad = n => String(n).padStart(2, '0');
            return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${String(d.getFullYear()).slice(-2)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
        }
    }
    return isoString;
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
    } else if (type === 'STOCK_OUT') {
        payload.Project = document.getElementById('out-project').value;
        const qty = parseInt(payload.Quantity);
        const maxStock = parseInt(document.getElementById('out-qty').max || 0);
        if (qty > maxStock) return showToast('Kuantiti stok out melebihi stok yang ada!', 'error');
    } else if (type === 'RETURN') {
        payload.Project = document.getElementById('ret-project').value;
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

    const matched = masterItems.filter(item =>
        String(item.Item_ID).toLowerCase().includes(q) ||
        String(item.Item_Name).toLowerCase().includes(q)
    );

    if (matched.length === 0) {
        tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;">Tiada rekod dijumpai.</td></tr>';
        return;
    }

    tbody.innerHTML = matched.map(item => `
        <tr>
            <td><strong>${item.Item_ID}</strong></td>
            <td>${item.Item_Name}</td>
            <td><strong>${item.Current_Stock || 0}</strong> <small style="color:var(--text-secondary)">${item.Unit}</small></td>
        </tr>
    `).join('');
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
