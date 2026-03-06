// PLEASE REPLACE THIS WITH YOUR DEPLOYED GOOGLE APPS SCRIPT WEB APP URL
const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwCFY9S47tGGG450vY81ZjbyF2C6ZM8GPAKsVxftBWrbaZpONFuZ0FZDaLQyVfX2BIOsg/exec';

let masterItems = [];
let staffList = [];
let outCart = []; // Cart array for Stock Out
let retCart = []; // Cart array for Returns
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
    document.getElementById(`view - ${viewId} `).classList.add('active');

    // Refresh data if going to dashboard
    if (viewId === 'dashboard') {
        fetchTransactions();
        fetchItems();
        // Background sync staff updates without loaders disrupting UI
        fetch(`${SCRIPT_URL}?action = getStaff`)
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
        const response = await fetch(`${SCRIPT_URL}?action = getStaff`);
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
    const options = `< option value = "" disabled selected > Senarai Nama</option > ` +
        staffList.map(s => `< option value = "${s.Staff_Name}" > ${s.Staff_Name}</option > `).join('');

    if (document.getElementById('login-user')) document.getElementById('login-user').innerHTML = options;
}

async function fetchItems() {
    try {
        const response = await fetch(`${SCRIPT_URL}?action = getItems`);
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
        const response = await fetch(`${SCRIPT_URL}?action = getTransactions`);
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
    < td > ${item.Item_ID}</td >
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
    < tr >
            <td style="font-size: 0.75rem; white-space: nowrap;">${formatTimestamp(t.Timestamp)}</td>
            <td><span class="badge ${badgeClass}" style="white-space: nowrap;">${typeDisplay}</span></td>
            <td><strong>${t.Item_ID}</strong><br><small style="color:var(--text-secondary)">${t.Item_Name}</small></td>
            <td><strong>${t.Quantity}</strong></td>
            <td style="font-size: 0.75rem; word-break: break-word;">${t.Project || '-'}</td>
            <td style="font-size: 0.75rem;">${t.Entered_By}</td>
        </tr >
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
    < tr >
            <td style="font-size: 0.75rem; white-space: nowrap;">${formatTimestamp(t.Timestamp)}</td>
            <td><span class="badge ${badgeClass}" style="white-space: nowrap;">${typeDisplay}</span></td>
            <td><strong>${t.Item_ID}</strong><br><small style="color:var(--text-secondary)">${t.Item_Name}</small></td>
            <td><strong>${t.Quantity}</strong></td>
            <td style="font-size: 0.75rem; word-break: break-word;">${t.Project || t.Remarks || '-'}</td>
        </tr >
    `}).join('');
}

function formatTimestamp(isoString) {
    if (!isoString) return '-';

    // Check if it's the new standard backend format (DD/MM/YY HH:MM AM/PM)
    const parts = String(isoString).trim().split(' ');
    if (parts.length === 3 && parts[0].includes('/')) {
        return `< div style = "line-height:1.2;" > ${parts[0]} <br><span style="color:var(--text-secondary);font-size:0.85em;">${parts[1]} ${parts[2]}</span></div>`;
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

        return `< div style = "line-height:1.2;" > ${day} /${month}/${year} <br><span style="color:var(--text-secondary);font-size:0.85em;">${pad(hours)}:${mins} ${ampm}</span></div>`;
    }
    return isoString;
}

// Custom Searchable Dropdown Logic
function showDropdown(prefix) {
    document.getElementById(`${prefix} -dropdown`).classList.add('active');
    filterDropdown(prefix, document.getElementById(`${prefix} -search`).value);
}

function selectItem(prefix, id, name, stock, unit, totalQty, hasSerial = "", availSerials = "", borSerials = "") {
    document.getElementById(`${prefix} -search`).value = `${id} - ${name} `;
    document.getElementById(`${prefix} -item - id`).value = id;
    document.getElementById(`${prefix} -item - name`).value = name;

    const stockEl = document.getElementById(`${prefix} -current - stock`);
    stockEl.innerHTML = `Stok Terkini: <strong style="color:var(--primary-color)">${stock} ${unit}</strong>`;

    const serialGroup = document.getElementById(`${prefix} -serial - group`);
    const serialSelect = document.getElementById(`${prefix} -serial`);
    const qtyInput = document.getElementById(`${prefix} -qty`);

    // Serial Number Population Logic
    if (hasSerial === "YA") {
        if (serialGroup) serialGroup.style.display = "block";
        qtyInput.value = 1;
        qtyInput.readOnly = true; // Lock quantity to 1 for serial items

        let serialsToMap = prefix === 'out' ? availSerials : borSerials;
        let serialArr = serialsToMap.split(',').map(s => s.trim()).filter(s => s !== "");

        if (serialArr.length === 0) {
            serialSelect.innerHTML = `<option value="" disabled selected>Tiada Siri Tersedia. (Habis/Penuh)</option>`;
        } else {
            serialSelect.innerHTML = `<option value="" disabled selected>Pilih Serial...</option>` +
                serialArr.map(s => `<option value="${s.replace(/"/g, '&quot;')}">${s}</option>`).join('');
        }
    } else {
        if (serialGroup) serialGroup.style.display = "none";
        if (serialSelect) serialSelect.innerHTML = `<option value="" disabled selected>Pilih Serial...</option>`;
        qtyInput.value = "";
        qtyInput.readOnly = false;
    }

    // Set max quantity for stock out
    if (prefix === 'out') {
        qtyInput.max = stock;
        qtyInput.placeholder = hasSerial === "YA" ? "1 Unit (Berkunci)" : `Max: ${stock}`;
    } else if (prefix === 'ret') {
        const maxReturn = parseInt(totalQty || stock) - parseInt(stock);
        qtyInput.max = maxReturn;
        qtyInput.placeholder = hasSerial === "YA" ? "1 Unit (Berkunci)" : `Max: ${maxReturn}`;
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
    let html = matched.slice(0, displayLimit).map(item => {
        const safeName = (item.Item_Name || "").replace(/'/g, "\\'");
        const hasSerial = (item.Punya_Serial || "").trim().toUpperCase() === "YA" ? "YA" : "TIDAK";
        const availSerials = (item.Serial_Tersedia || "").replace(/'/g, "\\'").replace(/"/g, '&quot;');
        const borSerials = (item.Serial_Dipinjam || "").replace(/'/g, "\\'").replace(/"/g, '&quot;');

        return `<div class="combo-item" onclick="selectItem('${prefix}', '${item.Item_ID}', '${safeName}', '${item.Current_Stock || 0}', '${item.Unit}', '${item.Total_Quantity || 0}', '${hasSerial}', '${availSerials}', '${borSerials}')">
            <strong>${item.Item_ID}</strong> - ${item.Item_Name} <br>
            <small style="color:var(--text-secondary)">Stok: ${item.Current_Stock || 0} ${item.Unit}</small>
        </div>`;
    }).join('');

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

// --- BATCH CART LOGIC ---
function addToCart(event, type) {
    event.preventDefault();
    let prefix = type === 'AMBIL' ? 'out' : 'ret';

    const itemId = document.getElementById(`${prefix}-item-id`).value;
    const itemName = document.getElementById(`${prefix}-item-name`).value;
    const qty = parseInt(document.getElementById(`${prefix}-qty`).value);
    const project = prefix === 'out' ? document.getElementById('out-project').value : '-';

    if (!itemId) return showToast('Sila carian dan pilih item terlebih dahulu!', 'warning');

    const maxStock = parseInt(document.getElementById(`${prefix}-qty`).max || 0);
    if (prefix === 'out' && qty > maxStock) return showToast('Kuantiti ambil melebihi stok sedia ada!', 'error');
    if (prefix === 'ret' && qty > maxStock) return showToast(`Maksimum pemulangan adalah ${maxStock} unit.`, 'error');

    const serialGroup = document.getElementById(`${prefix}-serial-group`);
    const serialSelect = document.getElementById(`${prefix}-serial`);
    let selectedSerial = "";

    if (serialGroup && serialGroup.style.display === "block") {
        selectedSerial = serialSelect.value;
        if (!selectedSerial) return showToast('Sila pilih Nombor Siri barangan ini!', 'warning');
    }

    const cartItem = {
        Item_ID: itemId,
        Item_Name: itemName,
        Quantity: qty,
        Type: type,
        Project: project,
        Selected_Serial: selectedSerial,
        Remarks: ""
    };

    if (type === 'AMBIL') {
        if (outCart.find(c => c.Item_ID === itemId && (!selectedSerial || c.Selected_Serial === selectedSerial))) {
            return showToast('Item/Serial ini sudah ada di dalam bakul!', 'warning');
        }
        outCart.push(cartItem);
        renderCart('AMBIL');
        document.getElementById('out-search').value = "";
        document.getElementById('out-item-id').value = "";
        document.getElementById('out-qty').value = "";
        document.getElementById('out-project').value = "";
        if (serialGroup) serialGroup.style.display = "none";
        document.getElementById('out-current-stock').innerHTML = "";
    } else {
        if (retCart.find(c => c.Item_ID === itemId && (!selectedSerial || c.Selected_Serial === selectedSerial))) {
            return showToast('Item/Serial ini sudah ada di dalam bakul!', 'warning');
        }
        retCart.push(cartItem);
        renderCart('PULANG');
        document.getElementById('ret-search').value = "";
        document.getElementById('ret-item-id').value = "";
        document.getElementById('ret-qty').value = "";
        if (serialGroup) serialGroup.style.display = "none";
        document.getElementById('ret-current-stock').innerHTML = "";
    }
}

function renderCart(type) {
    let prefix = type === 'AMBIL' ? 'out' : 'ret';
    const container = document.getElementById(`${prefix}-cart-container`);
    const tbody = document.getElementById(`${prefix}-cart-tbody`);
    const cart = type === 'AMBIL' ? outCart : retCart;

    if (cart.length === 0) {
        if (container) container.style.display = "none";
        return;
    }

    if (container) container.style.display = "block";
    tbody.innerHTML = cart.map((c, index) => {
        return `<tr>
            <td style="font-size:0.85rem"><strong>${c.Item_ID}</strong><br><small style="color:var(--text-secondary)">${c.Item_Name}</small></td>
            <td style="font-size:0.85rem">${c.Selected_Serial || '-'}</td>
            <td><strong>${c.Quantity}</strong></td>
            <td><button type="button" class="btn-cancel" style="padding: 4px 8px; font-size:0.75rem; margin:0; width:100%; border-radius:4px" onclick="removeFromCart('${type}', ${index})">Padam</button></td>
        </tr>`;
    }).join('');
}

function removeFromCart(type, index) {
    if (type === 'AMBIL') {
        outCart.splice(index, 1);
        renderCart('AMBIL');
    } else {
        retCart.splice(index, 1);
        renderCart('PULANG');
    }
}

async function submitCart(type) {
    let cart = type === 'AMBIL' ? outCart : retCart;
    if (cart.length === 0) return showToast('Bakul anda kosong!', 'error');

    const staffName = document.getElementById('login-user').value || currentUser;
    const staffPin = document.getElementById('login-pin').value || currentUserPin;

    if (!staffName) return showToast('Sila log masuk dahulu!', 'error');

    document.getElementById('global-loader').style.display = 'flex';

    try {
        const response = await fetch(SCRIPT_URL, {
            method: 'POST',
            body: JSON.stringify({
                action: 'submitBatchTransactions',
                payload: {
                    Entered_By: staffName,
                    Staff_PIN: staffPin,
                    transactions: cart
                }
            })
        });

        const data = await response.json();

        if (data.status === 'success') {
            showToast(data.message, 'success');
            if (type === 'AMBIL') {
                outCart = [];
                renderCart('AMBIL');
                document.getElementById('out-project').value = ""; // Also clear project on success
            } else {
                retCart = [];
                renderCart('PULANG');
            }
            await fetchItems();
            await fetchTransactions();
            setTimeout(() => switchTab('dashboard'), 1500);
        } else {
            showErrorModal(data.message || 'Ralat menyimpan transaksi kelompok.');
        }
    } catch (error) {
        showErrorModal('Ralat sambungan rangkaian: ' + error.message);
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

        const hasSerial = document.getElementById('add-has-serial');
        if (hasSerial && hasSerial.checked) {
            payload.Punya_Serial = true;
            payload.Serial_Tersedia = document.getElementById('add-serials').value;
        }

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

// ----------------------------------------
// --- Sorting Logic For Transactions ---
// ----------------------------------------

function parseSortDate(dateStr) {
    if (!dateStr) return 0;
    // Format is either ISO or new standard: DD/MM/YY HH:MM AM/PM
    const str = String(dateStr).trim();
    if (str.includes('T')) {
        return new Date(str).getTime() || 0;
    }
    const parts = str.split(' ');
    if (parts.length === 3 && parts[0].includes('/')) {
        const dateParts = parts[0].split('/');
        const timeParts = parts[1].split(':');

        // Ensure century digits
        let year = dateParts[2];
        if (year.length === 2) {
            year = '20' + year;
        }

        let hours = parseInt(timeParts[0], 10);
        let mins = parseInt(timeParts[1], 10);
        const ampm = String(parts[2]).toUpperCase();

        if (ampm === 'PM' && hours < 12) hours += 12;
        if (ampm === 'AM' && hours === 12) hours = 0;

        // new Date(year, monthIndex, day, hours, minutes)
        return new Date(parseInt(year), parseInt(dateParts[1]) - 1, parseInt(dateParts[0]), hours, mins).getTime();
    }
    return new Date(str).getTime() || 0;
}

function doSortTransactions(arr, sortType) {
    const sorted = [...arr];
    sorted.sort((a, b) => {
        if (sortType === 'Masa_Baru') return parseSortDate(b.Timestamp) - parseSortDate(a.Timestamp);
        if (sortType === 'Masa_Lama') return parseSortDate(a.Timestamp) - parseSortDate(b.Timestamp);
        if (sortType === 'Jenis') return String(a.Type).localeCompare(String(b.Type));
        if (sortType === 'Barang') return String(a.Item_Name).localeCompare(String(b.Item_Name));
        if (sortType === 'Kuantiti') return parseInt(b.Quantity || 0) - parseInt(a.Quantity || 0); // High to low
        if (sortType === 'Projek') return String(a.Project || '-').localeCompare(String(b.Project || '-'));
        if (sortType === 'Oleh') return String(a.Entered_By || '').localeCompare(String(b.Entered_By || ''));
        return 0;
    });
    return sorted;
}

function sortRecentTransactions() {
    const el = document.getElementById('sort-recent');
    const sortVal = el ? el.value : 'Masa_Baru';
    const recent = allTransactions.slice(0, 20);
    const sorted = doSortTransactions(recent, sortVal);
    renderRecentTransactions(sorted);
}

function sortProfileTransactions() {
    const el = document.getElementById('sort-profile');
    const sortVal = el ? el.value : 'Masa_Baru';
    const personalTrans = allTransactions.filter(t => t.Entered_By === currentUser);
    const sorted = doSortTransactions(personalTrans, sortVal);
    renderProfileHistory(sorted);
}
