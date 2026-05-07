// PLEASE REPLACE THIS WITH YOUR DEPLOYED GOOGLE APPS SCRIPT WEB APP URL
const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwHuWP1biziUyX7hhPgv-4n6D41-WZ9p55SHsFuy6JJ1ycxGe_ZNm0GQSFpaDWEhJiUnw/exec';

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

// Utility for Thumbnail HTML
function getThumbHtml(imageUrl, size = 40) {
    if (!imageUrl) return `<div style="width:${size}px; height:${size}px; border-radius:6px; background:#f0f0f0; display:flex; align-items:center; justify-content:center; font-size:1rem;">📦</div>`;
    
    let thumbSrc = imageUrl;
    if (imageUrl.includes('drive.google.com/file/d/')) {
        const m = imageUrl.match(/\/d\/([^/]+)\//);
        if (m && m[1]) thumbSrc = `https://drive.google.com/thumbnail?id=${m[1]}&sz=w${size*2}`;
    } else if (imageUrl.includes('uc?export=view&id=')) {
        const m = imageUrl.match(/id=(.*)/);
        if (m && m[1]) thumbSrc = `https://drive.google.com/thumbnail?id=${m[1]}&sz=w${size*2}`;
    }
    
    return `<img src="${thumbSrc}" style="width:${size}px; height:${size}px; object-fit:cover; border-radius:6px; background:#f0f0f0;" onerror="this.outerHTML='<div style=&quot;width:${size}px;height:${size}px;border-radius:6px;background:#f0f0f0;display:flex;align-items:center;justify-content:center;font-size:1rem;&quot;>📦</div>'">`;
}

// Clear Search Utility
function clearSearch(prefix) {
    const searchInput = document.getElementById(`${prefix}-search`);
    if (searchInput) {
        searchInput.value = '';
        searchInput.focus();
        
        // Trigger the relevant filter function
        if (prefix === 'add') {
            filterUnifiedDropdown('');
            showUnifiedDropdown();
        } else {
            filterDropdown(prefix, '');
            showDropdown(prefix);
        }
    }
}

// Mobile Touch Highlight Helper
document.addEventListener('touchstart', function(e) {
    const row = e.target.closest('tbody tr, .combo-item');
    if (row) {
        row.classList.add('active-touch');
    }
}, {passive: true});

document.addEventListener('touchend', function(e) {
    const row = e.target.closest('tbody tr, .combo-item');
    if (row) {
        // Delay removal slightly so the user sees the flash of color
        setTimeout(() => row.classList.remove('active-touch'), 150);
    }
}, {passive: true});

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
    if (document.getElementById('header-refresh-btn')) document.getElementById('header-refresh-btn').style.display = 'none';

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
            if (document.getElementById('header-refresh-btn')) document.getElementById('header-refresh-btn').style.display = 'inline-block';

            if (isAdmin) {
                if (document.getElementById('btn-tab-admin')) document.getElementById('btn-tab-admin').style.display = 'inline-block';
                if (document.getElementById('profile-admin-actions')) document.getElementById('profile-admin-actions').style.display = 'flex';
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
    const options = `<option value="" disabled selected>Senarai Nama</option>` +
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
            
            // Refresh Admin Master List
            if (typeof filterAdminList === 'function') filterAdminList('');
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
            populateYearDropdown();
        }
    } catch (error) {
        console.error(error);
        showToast('Ralat Transaksi: ' + error.message, 'error');
    }
}

function updateDashboard() {
    try {
        // Build Low Stock Table
        const lowStockTbody = document.querySelector('#low-stock-table tbody');
        if (!lowStockTbody) return;
        lowStockTbody.innerHTML = '';
        let lowStockCount = 0;
        let totalManagedItems = 0;

        masterItems.forEach(item => {
            if (item && item.Status !== 'Discontinued') {
                totalManagedItems++;
                if (parseInt(item.Current_Stock || 0, 10) <= parseInt(item.Min_Stock || 0, 10)) {
                    lowStockCount++;
                    const tr = document.createElement('tr');
                    const thumb = getThumbHtml(item.Image_URL, 40);
                    tr.innerHTML = `
                        <td style="text-align:center; padding: 0.4rem;">${thumb}</td>
                        <td>${item.Item_ID || '-'}</td>
                        <td>${item.Item_Name || '-'}</td>
                        <td style="color: #ff8c00; font-weight: bold;">${item.Current_Stock || 0}</td>
                        <td style="color: #ff8c00; font-weight: bold;">${item.Min_Stock || 0}</td>
                    `;
                    lowStockTbody.appendChild(tr);
                }
            }
        });

        const statTotal = document.getElementById('stat-total-items');
        if (statTotal) statTotal.innerText = totalManagedItems;

        const statLow = document.getElementById('stat-low-stock');
        if (statLow) statLow.textContent = lowStockCount;

        if (lowStockCount === 0) {
            lowStockTbody.innerHTML = '<tr><td colspan="4" style="text-align:center;">Semua stok dalam keadaan baik!</td></tr>';
        }
    } catch (err) {
        console.error("Dashboard Render Error:", err);
    }
}

function renderRecentTransactions(transactions) {
    try {
        const tbody = document.querySelector('#recent-trans-table tbody');
        if (!tbody) return;

        if (!transactions || transactions.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;">Tiada rekod transaksi.</td></tr>';
            return;
        }

        tbody.innerHTML = transactions.map(t => {
            if (!t) return '';
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

            // Find image from masterItems
            const master = masterItems.find(m => String(m.Item_ID).toUpperCase() === String(t.Item_ID).toUpperCase());
            const thumb = getThumbHtml(master ? master.Image_URL : '', 40);

            return `
            <tr>
                <td style="text-align:center; padding: 0.4rem;">${thumb}</td>
                <td style="font-size: 0.75rem; white-space: nowrap;">${formatTimestamp(t.Timestamp)}</td>
                <td><span class="badge ${badgeClass}" style="white-space: nowrap;">${typeDisplay}</span></td>
                <td><strong>${t.Item_ID || '-'}</strong><br><small style="color:var(--text-secondary)">${t.Item_Name || '-'}</small></td>
                <td><strong>${t.Quantity || 0}</strong></td>
                <td style="font-size: 0.75rem; word-break: break-word;">${t.Project || '-'}</td>
                <td style="font-size: 0.75rem;">${t.Entered_By || '-'}</td>
            </tr>
        `}).join('');
    } catch (err) {
        console.error("Recent Trans Render Error:", err);
        const tbody = document.querySelector('#recent-trans-table tbody');
        if (tbody) tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:red;">Ralat memuatkan data. Sila *refresh*.</td></tr>`;
    }
}

function renderProfileHistory(sortedTransactions) {
    try {
        const tbody = document.querySelector('#profile-trans-table tbody');
        if (!tbody) return; // Fail-safe

        // Update Profile Stat display safely
        const nameDisplay = document.getElementById('profile-name-display');
        if (nameDisplay) nameDisplay.innerText = currentUser || "Pengguna Tidak Dikenali";

        // Filter personal transactions if not provided
        const personalTrans = sortedTransactions || (allTransactions ? allTransactions.filter(t => t && t.Entered_By === currentUser) : []);

        const statsDisplay = document.getElementById('profile-stats-display');
        if (statsDisplay && allTransactions) {
            statsDisplay.innerText = `Anda merekodkan ${allTransactions.filter(t => t && t.Entered_By === currentUser).length} unit transaksi setakat ini.`;
        }

        if (!personalTrans || personalTrans.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">Tiada rekod transaksi peribadi.</td></tr>';
            return;
        }

        // Render logic:
        tbody.innerHTML = personalTrans.map(t => {
            if (!t) return '';
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
                <td><strong>${t.Item_ID || '-'}</strong><br><small style="color:var(--text-secondary)">${t.Item_Name || '-'}</small></td>
                <td><strong>${t.Quantity || 0}</strong></td>
                <td style="font-size: 0.75rem; word-break: break-word;">${t.Project || t.Remarks || '-'}</td>
            </tr>
        `}).join('');
    } catch (err) {
        console.error("Profile Trans Render Error:", err);
        const tbody = document.querySelector('#profile-trans-table tbody');
        if (tbody) tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:red;">Ralat memuatkan profil. Sila *refresh*.</td></tr>`;
    }
}

function formatTimestamp(isoString) {
    if (!isoString) return '-';

    try {
        const str = String(isoString).trim().replace(/^'/, '');
        const parts = str.split(' ');

        // Check if it's the new standard backend format (DD/MM/YY HH:MM AM/PM)
        if (parts.length === 3 && parts[0] && parts[0].includes('/')) {
            return `<div style="line-height:1.2;">${parts[0]}<br><span style="color:var(--text-secondary);font-size:0.85em;">${parts[1]} ${parts[2]}</span></div>`;
        }

        // Fallback for older formats in the database or ISO strings
        const d = new Date(str);
        if (!isNaN(d.getTime())) {
            const pad = n => String(n).padStart(2, '0');
            const day = pad(d.getDate());
            const month = pad(d.getMonth() + 1);
            const year = String(d.getFullYear());
            let hours = d.getHours();
            const mins = pad(d.getMinutes());
            const ampm = hours >= 12 ? 'PM' : 'AM';
            hours = hours % 12;
            hours = hours ? hours : 12; // the hour '0' should be '12'

            return `<div style="line-height:1.2;">${day}/${month}/${year}<br><span style="color:var(--text-secondary);font-size:0.85em;">${pad(hours)}:${mins} ${ampm}</span></div>`;
        }

        return str; // If it's a completely unknown format, just print it raw
    } catch (err) {
        console.error("Error formatting timestamp:", isoString, err);
        return '-'; // Fallback so rendering doesn't crash
    }
}

// Custom Searchable Dropdown Logic
function showDropdown(prefix) {
    document.getElementById(`${prefix}-dropdown`).classList.add('active');
    filterDropdown(prefix, document.getElementById(`${prefix}-search`).value);
}

function selectItem(prefix, id, name, stock, unit, totalQty, hasSerial = "", availSerials = "", borSerials = "", imageUrl = "", perluPulang = "YA") {
    document.getElementById(`${prefix}-search`).value = `${id} - ${name}`;
    document.getElementById(`${prefix}-item-id`).value = id;
    document.getElementById(`${prefix}-item-name`).value = name;

    const stockEl = document.getElementById(`${prefix}-current-stock`);
    stockEl.innerHTML = `Stok Terkini: <strong style="color:var(--primary-color)">${stock} ${unit}</strong>`;

    const serialGroup = document.getElementById(`${prefix}-serial-group`);
    const serialSelect = document.getElementById(`${prefix}-serial`);
    const qtyInput = document.getElementById(`${prefix}-qty`);

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

    // Show/hide due date group based on Perlu_Pulang setting
    if (prefix === 'out') {
        const dueDateGroup = document.getElementById('out-due-date-group');
        const dueDateInput = document.getElementById('out-due-date');
        if (dueDateGroup && dueDateInput) {
            if (String(perluPulang).trim().toUpperCase() === 'YA') {
                dueDateGroup.style.display = 'block';
                dueDateInput.required = true;
            } else {
                dueDateGroup.style.display = 'none';
                dueDateInput.required = false;
                dueDateInput.value = '';
            }
        }
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

    const imgEl = document.getElementById(`${prefix}-item-image`);
    if (imgEl) {
        if (imageUrl && imageUrl.trim() !== "") {
            let finalUrl = imageUrl;
            // Convert standard Drive link or old uc link to reliable Thumbnail API link
            if (finalUrl.includes("drive.google.com/file/d/")) {
                const match = finalUrl.match(/\/d\/([^/]+)\//);

                if (match && match[1]) {
                    finalUrl = `https://drive.google.com/thumbnail?id=${match[1]}&sz=w800`;
                }
            } else if (finalUrl.includes("uc?export=view&id=")) {
                const match = finalUrl.match(/id=(.*)/);
                if (match && match[1]) {
                    finalUrl = `https://drive.google.com/thumbnail?id=${match[1]}&sz=w800`;
                }
            }
            imgEl.src = finalUrl;
            imgEl.style.display = "block";
        } else {
            imgEl.style.display = "none";
            imgEl.src = "";
        }
    }

    document.getElementById(`${prefix}-dropdown`).classList.remove('active');
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

        // Build thumbnail
        const imageUrl = (item.Image_URL || "").replace(/'/g, "\\'");
        const thumbUrl = imageUrl ? (() => {
            let u = imageUrl;
            if (u.includes('drive.google.com/file/d/')) {
                const m = u.match(/\/d\/([^/]+)\//);
                if (m && m[1]) u = `https://drive.google.com/thumbnail?id=${m[1]}&sz=w60`;
            } else if (u.includes('uc?export=view&id=')) {
                const m = u.match(/id=(.*)/);
                if (m && m[1]) u = `https://drive.google.com/thumbnail?id=${m[1]}&sz=w60`;
            }
            return u;
        })() : '';

        return `
        <div class="combo-item" onclick="selectUnifiedItem('${item.Item_ID}', '${item.Item_Name.replace(/'/g, "\\'")}', '${item.Current_Stock || 0}', '${item.Unit}', '${item.Category}', '${item.Min_Stock}')" style="display:flex; align-items:center; gap:0.6rem;">
            ${thumbUrl ? `<img src="${thumbUrl}" style="width:40px; height:40px; object-fit:cover; border-radius:4px; flex-shrink:0; background:#f0f0f0;" onerror="this.style.display='none'">` : `<div style="width:40px; height:40px; border-radius:4px; background:#f0f0f0; flex-shrink:0; display:flex; align-items:center; justify-content:center; font-size:1.2rem;">📦</div>`}
            <div>
                <strong>${item.Item_ID}</strong> - <span style="${nameStyle}">${item.Item_Name}</span>${badge} <br>
                <small style="color:var(--text-secondary)">Stok: ${item.Current_Stock || 0} ${item.Unit}</small>
            </div>
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
            const displayTitle = toTitleCase(query.trim());
            html += `<div class="combo-item" style="color: var(--success-color); font-weight:bold; cursor:pointer; background:white;" onclick="selectSupplier('${displayTitle.replace(/'/g, "\\'")}')">✨ Tekan di sini untuk tetapkan '${displayTitle}' sebagai pembekal baharu.</div>`;
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
        Due_Date: prefix === 'out' ? document.getElementById('out-due-date').value : '',
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
            if (data.pdf_url) {
                window.open(data.pdf_url, '_blank');
            }
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
            if (document.getElementById('header-refresh-btn')) document.getElementById('header-refresh-btn').style.display = 'inline-block';

            // Show admin tab if authorized
            if (isAdmin) {
                if (document.getElementById('btn-tab-admin')) document.getElementById('btn-tab-admin').style.display = 'inline-block';
                if (document.getElementById('profile-admin-actions')) document.getElementById('profile-admin-actions').style.display = 'flex';
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



let pendingToggleId = null;
let pendingToggleStatusTarget = null;

function toggleItemStatus(id, newStatus) {
    pendingToggleId = id;
    pendingToggleStatusTarget = newStatus;

    document.getElementById('confirm-action-msg').innerText = `Adakah anda pasti ingin menukar status item ${id} kepada ${newStatus}?`;
    document.getElementById('confirm-action-modal').style.display = 'flex';

    const confirmBtn = document.getElementById('btn-confirm-action');
    const newBtn = confirmBtn.cloneNode(true);
    confirmBtn.parentNode.replaceChild(newBtn, confirmBtn);

    newBtn.addEventListener('click', executeToggleItemStatus);
}

function closeConfirmModal() {
    document.getElementById('confirm-action-modal').style.display = 'none';
    pendingToggleId = null;
    pendingToggleStatusTarget = null;
}

async function executeToggleItemStatus() {
    if (!pendingToggleId || !pendingToggleStatusTarget) return;

    const id = pendingToggleId;
    const newStatus = pendingToggleStatusTarget;
    closeConfirmModal();

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

// --- Camera & Image Compression Logic ---
function clearImage() {
    document.getElementById('add-image').value = '';
    document.getElementById('add-image-base64').value = '';
    document.getElementById('image-preview-container').style.display = 'none';
    document.getElementById('image-preview').src = '';
}

function handleImageSelection(event) {
    const file = event.target.files[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
        showToast('Sila pilih fail gambar sahaja.', 'error');
        clearImage();
        return;
    }

    const reader = new FileReader();
    reader.onload = function(e) {
        const img = new Image();
        img.onload = function() {
            // Compress Image
            const MAX_WIDTH = 800;
            const MAX_HEIGHT = 800;
            let width = img.width;
            let height = img.height;

            if (width > height) {
                if (width > MAX_WIDTH) {
                    height *= MAX_WIDTH / width;
                    width = MAX_WIDTH;
                }
            } else {
                if (height > MAX_HEIGHT) {
                    width *= MAX_HEIGHT / height;
                    height = MAX_HEIGHT;
                }
            }

            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);

            // Export as medium quality JPEG
            const dataUrl = canvas.toDataURL('image/jpeg', 0.6);
            
            // Set Hidden Field and Preview
            document.getElementById('add-image-base64').value = dataUrl;
            document.getElementById('image-preview').src = dataUrl;
            document.getElementById('image-preview-container').style.display = 'block';
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

// Helper function to convert text to Title Case (Capitalize First Letters)
function toTitleCase(str) {
    if (!str) return "";
    return str.toLowerCase().split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
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
        Item_Name: toTitleCase(document.getElementById('add-name').value.trim()),
        Quantity: document.getElementById('add-qty').value,
        Remarks: toTitleCase(document.getElementById('add-remarks').value.trim()),
        Supplier: toTitleCase(document.getElementById('add-remarks').value.trim()),
        Image_Data: document.getElementById('add-image-base64').value,
        Entered_By: currentUser,
        Staff_PIN: currentUserPin
    };

    // Map Serial Numbers (Applies to both New and Existing Items)
    const hasSerial = document.getElementById('add-has-serial');
    if (hasSerial && hasSerial.checked) {
        payload.Punya_Serial = true;
        payload.Serial_Tersedia = document.getElementById('add-serials').value;
    }

    if (isNewItem) {
        payload.Category = document.getElementById('add-category').value;
        payload.Unit = document.getElementById('add-unit').value;
        payload.Min_Stock = document.getElementById('add-min').value;
        // Get Perlu_Pulang from radio buttons
        const perluPulangEl = document.querySelector('input[name="add-perlu-pulang"]:checked');
        payload.Perlu_Pulang = perluPulangEl ? perluPulangEl.value : 'TIDAK';

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
            clearImage();

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

    try {
        const str = String(dateStr).trim();
        if (str.includes('T')) {
            return new Date(str).getTime() || 0;
        }

        const parts = str.split(' ');
        if (parts.length === 3 && parts[0] && parts[0].includes('/') && parts[1] && parts[1].includes(':')) {
            const dateParts = parts[0].split('/');
            const timeParts = parts[1].split(':');

            // Ensure century digits
            let year = dateParts[2];
            if (year && year.length === 2) {
                year = '20' + year;
            } else if (!year) {
                year = new Date().getFullYear().toString();
            }

            let hours = parseInt(timeParts[0], 10) || 0;
            let mins = parseInt(timeParts[1], 10) || 0;
            const ampm = String(parts[2]).toUpperCase();

            if (ampm === 'PM' && hours < 12) hours += 12;
            if (ampm === 'AM' && hours === 12) hours = 0;

            // new Date(year, monthIndex, day, hours, minutes)
            return new Date(parseInt(year), (parseInt(dateParts[1]) || 1) - 1, parseInt(dateParts[0]) || 1, hours, mins).getTime() || 0;
        }

        return new Date(str).getTime() || 0;
    } catch (err) {
        console.error("Error parsing date for sort:", dateStr, err);
        return 0; // Fallback to 0 so sort logic doesn't crash UI
    }
}

function doSortTransactions(arr, sortType) {
    const sorted = [...arr];
    sorted.sort((a, b) => {
        if (sortType === 'Masa_Baru') return parseSortDate(b.Timestamp) - parseSortDate(a.Timestamp);
        if (sortType === 'Masa_Lama') return parseSortDate(a.Timestamp) - parseSortDate(b.Timestamp);
        if (sortType === 'Jenis') return String(a.Type || '').localeCompare(String(b.Type || ''));
        if (sortType === 'Barang') return String(a.Item_Name || '').localeCompare(String(b.Item_Name || ''));
        if (sortType === 'Kuantiti') return parseInt(b.Quantity || 0, 10) - parseInt(a.Quantity || 0, 10);
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

function populateYearDropdown() {
    const yearSelect = document.getElementById('filter-year');
    const approvalYearSelect = document.getElementById('filter-approval-year');
    if (!yearSelect && !approvalYearSelect) return;
    
    const currentYear = new Date().getFullYear();
    const years = new Set([currentYear]);
    
    // Extract years from allTransactions
    if (allTransactions && allTransactions.length > 0) {
        allTransactions.forEach(t => {
            if (t.Timestamp) {
                const match = t.Timestamp.match(/\d{4}/);
                if (match) years.add(parseInt(match[0]));
            }
        });
    }
    // Also extract from pendingRequests for approval history
    if (pendingRequests && pendingRequests.length > 0) {
        pendingRequests.forEach(r => {
            if (r.Timestamp) {
                const match = r.Timestamp.match(/\d{4}/);
                if (match) years.add(parseInt(match[0]));
            }
        });
    }
    
    const sortedYears = Array.from(years).sort((a, b) => b - a);
    const options = sortedYears.map(y => `<option value="${y}">${y}</option>`).join('');
    
    if (yearSelect) yearSelect.innerHTML = options;
    if (approvalYearSelect) approvalYearSelect.innerHTML = options;
}

function filterAllTransactions() {
    const month = document.getElementById('filter-month').value;
    const year = document.getElementById('filter-year').value;
    const tbody = document.querySelector('#all-trans-table tbody');
    if (!tbody) return;

    if (!allTransactions || allTransactions.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;">Tiada rekod transaksi.</td></tr>';
        return;
    }

    const filtered = allTransactions.filter(t => {
        if (!t.Timestamp) return false;
        // Timestamp is DD/MM/YYYY HH:mm:ss or similar.
        // Easiest is to check if it contains the month and year
        // We know standard is DD/MM/YYYY so we can look for "/MM/YYYY" or just split it.
        const ts = String(t.Timestamp);
        // Let's use regex or split to extract parts assuming DD/MM/YYYY
        // For robustness, check if ts includes the MM/YYYY string. 
        // e.g. "05/06/2026"
        const targetPattern = `/${month}/${year}`;
        return ts.includes(targetPattern);
    });

    if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;">Tiada rekod transaksi dijumpai untuk bulan dan tahun yang dipilih.</td></tr>';
        return;
    }

    tbody.innerHTML = filtered.map(t => {
        let badgeClass = 'badge-tambah';
        let typeDisplay = 'TAMBAH';
        if (t.Type === 'AMBIL' || t.Type === 'STOCK_OUT') { badgeClass = 'badge-ambil'; typeDisplay = 'AMBIL'; }
        if (t.Type === 'PULANG' || t.Type === 'RETURN') { badgeClass = 'badge-pulang'; typeDisplay = 'PULANG'; }
        if (t.Type === 'DAFTAR') { badgeClass = 'badge-daftar'; typeDisplay = 'DAFTAR'; }
        if (t.Type === 'TAMBAH' || t.Type === 'STOCK_IN') { badgeClass = 'badge-tambah'; typeDisplay = 'TAMBAH'; }

        // Find image from masterItems
        const master = masterItems.find(m => String(m.Item_ID).toUpperCase() === String(t.Item_ID).toUpperCase());
        const thumb = getThumbHtml(master ? master.Image_URL : '', 40);

        return `
        <tr>
            <td style="text-align:center; padding: 0.4rem;">${thumb}</td>
            <td style="font-size: 0.75rem; white-space: nowrap;">${formatTimestamp(t.Timestamp)}</td>
            <td><span class="badge ${badgeClass}" style="white-space: nowrap;">${typeDisplay}</span></td>
            <td><strong>${t.Item_ID || '-'}</strong><br><small style="color:var(--text-secondary)">${t.Item_Name || '-'}</small></td>
            <td><strong>${t.Quantity || 0}</strong></td>
            <td style="font-size: 0.75rem; word-break: break-word;">${t.Project || '-'}</td>
            <td style="font-size: 0.75rem;">${t.Entered_By || '-'}</td>
        </tr>`;
    }).join('');
}

// ----------------------------------------
// --- Admin Master List Logic ---
// ----------------------------------------
function filterAdminList(query) {
    if (!masterItems) return;
    
    const q = (query || "").toLowerCase().trim();
    const tbody = document.querySelector('#admin-master-table tbody');
    if (!tbody) return;

    // Filter items based on query
    const filtered = masterItems.filter(item => {
        return String(item.Item_ID).toLowerCase().includes(q) || 
               String(item.Item_Name).toLowerCase().includes(q) ||
               String(item.Supplier || "").toLowerCase().includes(q);
    });

    if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;">Tiada rekod dijumpai.</td></tr>';
        return;
    }

    // Pre-calculate latest invoices from transactions for "View Invoice" button
    const latestInvoices = {};
    (allTransactions || []).forEach(t => {
        if ((t.Type === 'DAFTAR' || t.Type === 'TAMBAH') && t.Attachment_URL) {
            latestInvoices[t.Item_ID] = t.Attachment_URL;
        }
    });

    const html = filtered.map(item => {
        const totalMasuk = parseInt(item.Total_Quantity || 0, 10);
        const bakiSemasa = parseInt(item.Current_Stock || 0, 10);
        const totalKeluar = totalMasuk - bakiSemasa;
        
        let statusBadge = '';
        if (item.Status === 'Discontinued') {
            statusBadge = '<span class="badge badge-danger">Discontinued</span>';
        } else if (bakiSemasa <= parseInt(item.Min_Stock || 0, 10)) {
            statusBadge = '<span class="badge" style="background:#fdedec; color:#e74c3c;">Stok Rendah</span>';
        } else {
            statusBadge = '<span class="badge" style="background:#eafaf1; color:#27ae60;">Aktif</span>';
        }
        
        let actionButtons = `
            <button onclick="quickAddStock('${item.Item_ID}')" style="background:#2980b9; color:white; border:none; padding:6px 10px; border-radius:4px; cursor:pointer; font-size:0.75rem; width:100%; margin-bottom:5px;">📦 Tambah Stok</button>
        `;

        // Add View Invoice button if available
        const invUrl = latestInvoices[item.Item_ID];
        if (invUrl) {
            actionButtons += `<button onclick="window.open('${invUrl}', '_blank')" style="background:#8e44ad; color:white; border:none; padding:6px 10px; border-radius:4px; cursor:pointer; font-size:0.75rem; width:100%; margin-bottom:5px;">📄 View Invoice</button>`;
        }
        
        if (item.Status === 'Discontinued') {
            actionButtons += `<button onclick="confirmDiscontinue('${item.Item_ID}', '${item.Item_Name.replace(/'/g, "\\'")}', true)" style="background:#f39c12; color:white; border:none; padding:6px 10px; border-radius:4px; cursor:pointer; font-size:0.75rem; width:100%;">🔄 Aktifkan Semula</button>`;
        } else {
            actionButtons += `<button onclick="confirmDiscontinue('${item.Item_ID}', '${item.Item_Name.replace(/'/g, "\\'")}', false)" style="background:#c0392b; color:white; border:none; padding:6px 10px; border-radius:4px; cursor:pointer; font-size:0.75rem; width:100%;">🚫 Set Discontinued</button>`;
        }

        const thumbHtml = getThumbHtml(item.Image_URL, 44);

        return `
            <tr>
                <td style="text-align:center; padding:0.4rem;">${thumbHtml}</td>
                <td><strong>${item.Item_ID}</strong></td>
                <td>${item.Item_Name} <br><small style="color:var(--text-secondary)">Pembekal: ${item.Supplier || '-'}</small></td>
                <td style="color: var(--primary-color); font-weight: bold;">${totalMasuk}</td>
                <td style="color: var(--danger-color); font-weight: bold;">${totalKeluar}</td>
                <td style="color: var(--success-color); font-weight: bold;">${bakiSemasa}</td>
                <td>${statusBadge}</td>
                <td style="min-width: 120px;">${actionButtons}</td>
            </tr>
        `;
    }).join('');

    tbody.innerHTML = html;
}

function quickAddStock(id) {
    switchTab('add_item');
    document.getElementById('add-search').value = id;
    filterUnifiedDropdown(id);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setTimeout(() => {
        const qtyField = document.getElementById('add-qty');
        if (qtyField) qtyField.focus();
    }, 500);
}

async function confirmDiscontinue(id, name, isReactivate) {
    const actionWord = isReactivate ? "MENGAKTIFKAN SEMULA" : "MENAMATKAN (DISCONTINUE)";
    const newStatus = isReactivate ? "Active" : "Discontinued";
    
    if (confirm(`Adakah anda pasti untuk ${actionWord} barang ini?\n\n[${id}] - ${name}`)) {
        document.getElementById('global-loader').style.display = 'flex';
        try {
            const response = await fetch(SCRIPT_URL, {
                method: 'POST',
                body: JSON.stringify({
                    action: "toggleItemStatus",
                    payload: {
                        Item_ID: id,
                        New_Status: newStatus
                    }
                })
            });
            const data = await response.json();
            if (response.ok && data.status === 'success') {
                showToast(data.message);
                await fetchItems();
            } else {
                showErrorModal(data.message || 'Gagal mengubah status.');
            }
        } catch (e) {
            showErrorModal('Ralat sambungan pelayan.');
        } finally {
            document.getElementById('global-loader').style.display = 'none';
        }
    }
}


// ------------------------------------------------------------------
// --- NEW WORKFLOW OVERRIDES & FUNCTIONS (ADDED VIA SCRIPT) ---
// ------------------------------------------------------------------

let activeBorrows = [];
let pendingRequests = [];

// Override switchTab to handle new tabs
const originalSwitchTab = switchTab;
window.switchTab = function(viewId) {
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    if (window.event && window.event.target && window.event.target.classList.contains('tab-btn')) {
        window.event.target.classList.add('active');
    }
    document.querySelectorAll('.view-section').forEach(view => view.classList.remove('active'));
    
    const targetView = document.getElementById(`view-${viewId}`);
    if(targetView) targetView.classList.add('active');

    if (viewId === 'dashboard') {
        fetchTransactions();
        fetchItems();
        fetch(`${SCRIPT_URL}?action=getStaff`)
            .then(r => r.json())
            .then(d => { if (d.status === 'success') staffList = d.data; })
            .catch(() => { });
    }
    if (viewId === 'admin') renderAdminList();
    if (viewId === 'approval') fetchPendingRequests();
    if (viewId === 'return') fetchActiveBorrows();
    if (viewId === 'profile') renderProfileHistory();
};

// Override addToCart to include Due_Date
window.addToCart = function(event, type) {
    event.preventDefault();
    let prefix = type === 'AMBIL' ? 'out' : 'ret';

    const itemId = document.getElementById(`${prefix}-item-id`).value;
    const itemName = document.getElementById(`${prefix}-item-name`).value;
    const qty = parseInt(document.getElementById(`${prefix}-qty`).value);
    const project = prefix === 'out' ? document.getElementById('out-project').value : '-';
    const dueDate = prefix === 'out' && document.getElementById('out-due-date') ? document.getElementById('out-due-date').value : '';

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
        Due_Date: dueDate,
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
        if (document.getElementById('out-due-date')) document.getElementById('out-due-date').value = "";
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
};

// Override unifiedAdd to include Attachment
window.handleUnifiedAdd = async function(event) {
    event.preventDefault();

    const isNewItem = document.getElementById('add-item-id').value === '';
    const itemIdInput = isNewItem ? document.getElementById('add-search').value.trim().toUpperCase() : document.getElementById('add-item-id').value;

    if (!itemIdInput) {
        showToast('Sila isikan ID Barang (Item ID)', 'error');
        return;
    }

    const payload = {
        Item_ID: itemIdInput,
        Item_Name: toTitleCase(document.getElementById('add-name').value.trim()),
        Quantity: document.getElementById('add-qty').value,
        Remarks: toTitleCase(document.getElementById('add-remarks').value.trim()),
        Supplier: toTitleCase(document.getElementById('add-remarks').value.trim()),
        Image_Data: document.getElementById('add-image-base64') ? document.getElementById('add-image-base64').value : "",
        Attachment_Data: document.getElementById('add-attachment-base64') ? document.getElementById('add-attachment-base64').value : "",
        Entered_By: currentUser,
        Staff_PIN: currentUserPin
    };

    const hasSerial = document.getElementById('add-has-serial');
    if (hasSerial && hasSerial.checked) {
        payload.Punya_Serial = true;
        payload.Serial_Tersedia = document.getElementById('add-serials').value;
    }

    if (isNewItem) {
        payload.Category = document.getElementById('add-category').value;
        payload.Unit = document.getElementById('add-unit').value;
        payload.Min_Stock = document.getElementById('add-min').value;
        const ppEl = document.querySelector('input[name="add-perlu-pulang"]:checked');
        payload.Perlu_Pulang = ppEl ? ppEl.value : 'TIDAK';

        if (!payload.Category || !payload.Unit) {
            showToast('Sila pilih Kategori dan Unit untuk barang baru.', 'error');
            return;
        }
    } else {
        if (!payload.Attachment_Data) {
            // Optional but good to enforce DO for restock if requested
            // showToast('Sila muat naik Invois / D.O untuk restock.', 'error');
            // return;
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
            clearImage();
            if(typeof clearAttachment === 'function') clearAttachment();

            document.getElementById('add-name').readOnly = false;
            document.getElementById('add-name').style.backgroundColor = 'white';
            document.getElementById('new-item-fields').style.display = 'block';
            document.getElementById('new-item-threshold').style.display = 'block';
            document.getElementById('add-item-id').value = '';
            document.getElementById('add-status').innerHTML = '';

            await fetchItems();
            await fetchTransactions();

            setTimeout(() => { switchTab('dashboard'); }, 1500);
        } else {
            showErrorModal(data.message || 'Gagal menyimpan transaksi.');
        }
    } catch (e) {
        showErrorModal('Ralat sambungan pelayan.');
    } finally {
        document.getElementById('global-loader').style.display = 'none';
    }
};

// Override Login to show Approval Tab
const originalSubmitLogin = submitLogin;
window.submitLogin = async function() {
    await originalSubmitLogin();
    if (isAdmin) {
        if (document.getElementById('btn-tab-admin')) document.getElementById('btn-tab-admin').style.display = 'inline-block';
        if (document.getElementById('profile-admin-actions')) document.getElementById('profile-admin-actions').style.display = 'flex';
    }
};

// D.O Attachment Logic
window.clearAttachment = function() {
    document.getElementById('add-attachment').value = '';
    document.getElementById('add-attachment-base64').value = '';
    document.getElementById('attachment-preview-container').style.display = 'none';
    document.getElementById('attachment-preview').src = '';
};

window.handleAttachmentSelection = function(event) {
    const file = event.target.files[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
        showToast('Buat masa ini, sila muat naik format Gambar (JPG/PNG) sahaja untuk D.O.', 'error');
        clearAttachment();
        return;
    }

    const reader = new FileReader();
    reader.onload = function(e) {
        const img = new Image();
        img.onload = function() {
            const MAX_WIDTH = 1200;
            const MAX_HEIGHT = 1200;
            let width = img.width;
            let height = img.height;

            if (width > height) {
                if (width > MAX_WIDTH) { height *= MAX_WIDTH / width; width = MAX_WIDTH; }
            } else {
                if (height > MAX_HEIGHT) { width *= MAX_HEIGHT / height; height = MAX_HEIGHT; }
            }

            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);

            const dataUrl = canvas.toDataURL('image/jpeg', 0.6);
            document.getElementById('add-attachment-base64').value = dataUrl;
            document.getElementById('attachment-preview').src = dataUrl;
            document.getElementById('attachment-preview-container').style.display = 'block';
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
};

// --- APPROVAL LOGIC ---
async function fetchPendingRequests() {
    document.getElementById('global-loader').style.display = 'flex';
    try {
        const res = await fetch(`${SCRIPT_URL}?action=getPendingRequests`);
        const data = await res.json();
        if (data.status === 'success') {
            pendingRequests = data.data;
            renderApprovalList();
        }
    } catch(e) {
        showToast('Ralat memuatkan permohonan', 'error');
    } finally {
        document.getElementById('global-loader').style.display = 'none';
    }
}

function renderApprovalList() {
    const tbody = document.querySelector('#admin-approval-table tbody');
    if (!tbody) return;
    
    // Filter only Pending items for admin approval view
    const actualPending = (pendingRequests || []).filter(r => r.Status === 'Pending');

    if (actualPending.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;">Tiada permohonan menunggu kelulusan.</td></tr>';
    } else {
        tbody.innerHTML = actualPending.map(r => {
            let typeColor = r.Type === 'AMBIL' ? '#e74c3c' : '#27ae60';
            // Find image
            const master = masterItems.find(m => String(m.Item_ID).toUpperCase() === String(r.Item_ID).toUpperCase());
            const thumb = getThumbHtml(master ? master.Image_URL : '', 40);

            return `
                <tr>
                    <td style="text-align:center; padding: 0.4rem;">${thumb}</td>
                    <td style="font-size:0.75rem;">${r.Timestamp}</td>
                    <td><strong>${r.Entered_By}</strong></td>
                    <td><span class="badge" style="background:${typeColor}">${r.Type}</span></td>
                    <td>${r.Item_ID}<br><small>${r.Item_Name}</small></td>
                    <td>${r.Quantity} <br><small>${r.Selected_Serial || ''}</small></td>
                    <td>
                        <button class="btn-submit" style="background:#27ae60; padding:5px 10px; font-size:0.75rem; margin-bottom:5px; width:100%;" onclick="processRequest('${r.Req_ID}', 'approve')">Lulus</button>
                        <button class="btn-cancel" style="padding:5px 10px; font-size:0.75rem; width:100%; margin:0;" onclick="processRequest('${r.Req_ID}', 'reject')">Tolak</button>
                    </td>
                </tr>
            `;
        }).join('');
    }

    // Helper to parse dd/MM/yyyy hh:mm a
    const parseAppDate = (str) => {
        if (!str) return 0;
        const parts = str.split(/[\/\s:]+/);
        if (parts.length < 5) return 0;
        let day = parseInt(parts[0], 10), month = parseInt(parts[1], 10) - 1, year = parseInt(parts[2], 10);
        let hour = parseInt(parts[3], 10), minute = parseInt(parts[4], 10);
        let ampm = parts[5] ? parts[5].toUpperCase() : 'AM';
        if (ampm === 'PM' && hour < 12) hour += 12;
        if (ampm === 'AM' && hour === 12) hour = 0;
        return new Date(year, month, day, hour, minute).getTime();
    };

    const history = (pendingRequests || []).filter(r => r.Status === 'Approved' || r.Status === 'Rejected');

    // Helper to generate row HTML for history
    const renderHistoryRow = (r) => {
        let statusColor = r.Status === 'Approved' ? '#27ae60' : '#c0392b';
        let statusText = r.Status === 'Approved' ? 'Lulus' : 'Ditolak';
        let pdfBtn = r.PDF_URL ? `<button class="btn-submit" style="padding: 2px 8px; font-size: 0.7rem; margin: 0; background: #e67e22;" onclick="window.open('${r.PDF_URL}', '_blank')">Cetak</button>` : '-';
        const master = masterItems.find(m => String(m.Item_ID).toUpperCase() === String(r.Item_ID).toUpperCase());
        const thumb = getThumbHtml(master ? master.Image_URL : '', 40);
        return `
            <tr>
                <td style="text-align:center; padding: 0.4rem;">${thumb}</td>
                <td style="font-size:0.75rem;">${r.Timestamp}</td>
                <td><strong>${r.Entered_By}</strong></td>
                <td><span class="badge" style="background:${r.Type === 'AMBIL' ? '#e74c3c' : '#27ae60'}">${r.Type}</span></td>
                <td>${r.Item_ID}<br><small>${r.Item_Name}</small></td>
                <td style="text-align:center;"><span style="background:${statusColor}; color:white; padding:3px 6px; border-radius:4px; font-size:0.7rem; white-space:nowrap;">${statusText}</span></td>
                <td style="text-align:center;">${pdfBtn}</td>
            </tr>
        `;
    };

    // 1. Render Recent 20 Section
    const recentTbody = document.querySelector('#admin-approval-recent-table tbody');
    if (recentTbody) {
        const sortedHistory = [...history].sort((a,b) => parseAppDate(b.Timestamp) - parseAppDate(a.Timestamp));
        const recent20 = sortedHistory.slice(0, 20);
        if (recent20.length === 0) {
            recentTbody.innerHTML = '<tr><td colspan="7" style="text-align:center;">Tiada rekod kelulusan terkini.</td></tr>';
        } else {
            recentTbody.innerHTML = recent20.map(renderHistoryRow).join('');
        }
    }

    // 2. Render Filtered History Section
    const historyTbody = document.querySelector('#admin-approval-history-table tbody');
    if (historyTbody) {
        const filterMonth = document.getElementById('filter-approval-month') ? document.getElementById('filter-approval-month').value : "";
        const filterYear = document.getElementById('filter-approval-year') ? document.getElementById('filter-approval-year').value : "";

        let filteredHistory = history.filter(r => {
            if (!r.Timestamp) return false;
            let matchMonth = true, matchYear = true;
            if (filterMonth) matchMonth = r.Timestamp.includes(`/${filterMonth}/`);
            if (filterYear) matchYear = r.Timestamp.includes(`/${filterYear}`);
            return matchMonth && matchYear;
        });

        filteredHistory.sort((a,b) => parseAppDate(b.Timestamp) - parseAppDate(a.Timestamp));

        if (filteredHistory.length === 0) {
            historyTbody.innerHTML = '<tr><td colspan="7" style="text-align:center;">Pilih bulan dan tahun untuk tapisan.</td></tr>';
        } else {
            historyTbody.innerHTML = filteredHistory.map(renderHistoryRow).join('');
        }
    }
}


// --- ACTIVE BORROWS LOGIC (For Return Binding) ---
async function fetchActiveBorrows() {
    try {
        const res = await fetch(`${SCRIPT_URL}?action=getActiveBorrows&staffName=${encodeURIComponent(currentUser)}`);
        const data = await res.json();
        if (data.status === 'success') {
            activeBorrows = data.data;
        }
    } catch(e) {}
}

// Override selectItem & filterDropdown for RETURN so it uses activeBorrows instead of masterItems
window.filterDropdown = function(prefix, query) {
    const q = query.toLowerCase();
    const dropdown = document.getElementById(`${prefix}-dropdown`);

    let matched = [];
    if (prefix === 'ret') {
        // Only show items user has borrowed
        const uniqueBorrowsMap = {};
        activeBorrows.forEach(b => {
            if(!uniqueBorrowsMap[b.Item_ID]) {
                uniqueBorrowsMap[b.Item_ID] = {
                    Item_ID: b.Item_ID,
                    Item_Name: b.Item_Name,
                    Current_Stock: b.Qty_Borrowed,
                    Unit: 'Unit',
                    Total_Quantity: b.Qty_Borrowed, // Max return = Qty Borrowed
                    Punya_Serial: b.Selected_Serial ? "YA" : "TIDAK",
                    Serial_Tersedia: "", // Not returning to pool, we are listing what they borrowed
                    Serial_Dipinjam: b.Selected_Serial || "",
                    Image_URL: ""
                };
            } else {
                uniqueBorrowsMap[b.Item_ID].Current_Stock += b.Qty_Borrowed;
                uniqueBorrowsMap[b.Item_ID].Total_Quantity += b.Qty_Borrowed;
                if(b.Selected_Serial) {
                    uniqueBorrowsMap[b.Item_ID].Serial_Dipinjam += (uniqueBorrowsMap[b.Item_ID].Serial_Dipinjam ? ", " : "") + b.Selected_Serial;
                }
            }
        });
        matched = Object.values(uniqueBorrowsMap).filter(item => {
            return String(item.Item_ID).toLowerCase().includes(q) || String(item.Item_Name).toLowerCase().includes(q);
        });
        
        if (matched.length === 0) {
            dropdown.innerHTML = '<div class="combo-item" style="color: var(--text-secondary)">Tiada rekod peminjaman aktif untuk anda.</div>';
            return;
        }
    } else {
        // Original Master Items Logic for Out
        matched = masterItems.filter(item => {
            if (item.Status === 'Discontinued') return false;
            return String(item.Item_ID).toLowerCase().includes(q) || String(item.Item_Name).toLowerCase().includes(q);
        });
        
        if (matched.length === 0) {
            dropdown.innerHTML = '<div class="combo-item" style="color: var(--text-secondary)">Tiada item dijumpai</div>';
            return;
        }
    }

    const displayLimit = 50;
    let html = matched.slice(0, displayLimit).map(item => {
        const safeName = (item.Item_Name || "").replace(/'/g, "\\'");
        const hasSerial = (item.Punya_Serial || "").trim().toUpperCase() === "YA" ? "YA" : "TIDAK";
        const availSerials = (item.Serial_Tersedia || "").replace(/'/g, "\\'").replace(/"/g, '&quot;');
        const borSerials = (item.Serial_Dipinjam || "").replace(/'/g, "\\'").replace(/"/g, '&quot;');
        const imageUrl = (item.Image_URL || "").replace(/'/g, "\\'").replace(/"/g, '&quot;');
        const perluPulang = (item.Perlu_Pulang || "TIDAK").trim().toUpperCase();
        
        const thumbUrl = imageUrl ? (() => {
            let u = imageUrl;
            if (u.includes('drive.google.com/file/d/')) {
                const m = u.match(/\/d\/([^/]+)\//);
                if (m && m[1]) u = `https://drive.google.com/thumbnail?id=${m[1]}&sz=w60`;
            }
            return u;
        })() : '';

        let stockLabel = prefix === 'ret' ? "Hutang Pinjaman" : "Stok";

        return `<div class="combo-item" onclick="selectItem('${prefix}', '${item.Item_ID}', '${safeName}', '${item.Current_Stock || 0}', '${item.Unit}', '${item.Total_Quantity || 0}', '${hasSerial}', '${availSerials}', '${borSerials}', '${imageUrl}', '${perluPulang}')" style="display:flex; align-items:center; gap:0.6rem;">
            ${thumbUrl ? `<img src="${thumbUrl}" style="width:40px; height:40px; object-fit:cover; border-radius:4px; flex-shrink:0; background:#f0f0f0;" onerror="this.style.display='none'">` : `<div style="width:40px; height:40px; border-radius:4px; background:#f0f0f0; flex-shrink:0; display:flex; align-items:center; justify-content:center; font-size:1.2rem;">📦</div>`}
            <div>
                <strong>${item.Item_ID}</strong> - ${item.Item_Name} <br>
                <small style="color:var(--text-secondary)">${stockLabel}: ${item.Current_Stock || 0} ${item.Unit}</small>
            </div>
        </div>`;
    }).join('');

    if (matched.length > displayLimit) html += `<div class="combo-item" style="text-align:center;">... lagi.</div>`;
    dropdown.innerHTML = html;
};



// ------------------------------------------------------------------
// --- SIGNATURE PAD & PDF LOGIC (ADDED VIA SCRIPT) ---
// ------------------------------------------------------------------

let isDrawing = false;
let canvasCtx = null;
let currentSignatureAction = null; // { type: 'submitCart'|'processRequest', payload: any }
let currentSignaturePrefix = '';

function initSignaturePad() {
    const canvas = document.getElementById('signature-pad');
    if (!canvas) return;
    canvasCtx = canvas.getContext('2d');
    
    // Clear canvas white background
    canvasCtx.fillStyle = '#ffffff';
    canvasCtx.fillRect(0, 0, canvas.width, canvas.height);
    canvasCtx.strokeStyle = '#000000';
    canvasCtx.lineWidth = 3;
    canvasCtx.lineCap = 'round';

    const startPosition = (e) => {
        isDrawing = true;
        draw(e);
    };

    const endPosition = () => {
        isDrawing = false;
        canvasCtx.beginPath();
    };

    const draw = (e) => {
        if (!isDrawing) return;
        e.preventDefault();
        
        let clientX = e.clientX || (e.touches && e.touches[0].clientX);
        let clientY = e.clientY || (e.touches && e.touches[0].clientY);
        
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        
        const x = (clientX - rect.left) * scaleX;
        const y = (clientY - rect.top) * scaleY;

        canvasCtx.lineTo(x, y);
        canvasCtx.stroke();
        canvasCtx.beginPath();
        canvasCtx.moveTo(x, y);
    };

    canvas.addEventListener('mousedown', startPosition);
    canvas.addEventListener('mouseup', endPosition);
    canvas.addEventListener('mousemove', draw);
    
    canvas.addEventListener('touchstart', startPosition, { passive: false });
    canvas.addEventListener('touchend', endPosition);
    canvas.addEventListener('touchmove', draw, { passive: false });
}

window.clearSignature = function() {
    if(!canvasCtx) return;
    const canvas = document.getElementById('signature-pad');
    canvasCtx.fillStyle = '#ffffff';
    canvasCtx.fillRect(0, 0, canvas.width, canvas.height);
};

window.closeSignatureModal = function() {
    document.getElementById('signature-modal').style.display = 'none';
    currentSignatureAction = null;
};

// Hook the save button
document.addEventListener('DOMContentLoaded', () => {
    initSignaturePad();
    const btnSaveSig = document.getElementById('btn-save-signature');
    if(btnSaveSig) {
        btnSaveSig.addEventListener('click', async () => {
            const canvas = document.getElementById('signature-pad');
            const dataUrl = canvas.toDataURL('image/jpeg', 0.5); // compress signature
            
            // Check if blank (rough check if it's mostly white)
            // But we'll trust user for now
            
            const action = currentSignatureAction;
            closeSignatureModal();
            
            if (action.type === 'submitCart') {
                await doActualSubmitCart(action.payload, dataUrl);
            } else if (action.type === 'processRequest') {
                await doActualProcessRequest(action.payload, dataUrl);
            }
        });
    }
});


// Override submitCart to prompt for signature first
window.submitCart = function(type) {
    let cart = type === 'AMBIL' ? outCart : retCart;
    if (cart.length === 0) return showToast('Bakul anda kosong!', 'error');

    const staffName = document.getElementById('login-user').value || currentUser;
    if (!staffName) return showToast('Sila log masuk dahulu!', 'error');

    currentSignatureAction = { type: 'submitCart', payload: type };
    
    document.getElementById('signature-title').innerText = "Tandatangan Pemohon";
    document.getElementById('signature-desc').innerText = "Sila tandatangan pengesahan untuk permohonan ini.";
    clearSignature();
    document.getElementById('signature-modal').style.display = 'flex';
};

// Actual Submission
async function doActualSubmitCart(type, sigBase64) {
    let cart = type === 'AMBIL' ? outCart : retCart;
    const staffName = document.getElementById('login-user').value || currentUser;
    const staffPin = document.getElementById('login-pin').value || currentUserPin;

    document.getElementById('global-loader').style.display = 'flex';
    try {
        const response = await fetch(SCRIPT_URL, {
            method: 'POST',
            body: JSON.stringify({
                action: 'submitBatchTransactions',
                payload: {
                    Entered_By: staffName,
                    Staff_PIN: staffPin,
                    transactions: cart,
                    Requester_Signature: sigBase64
                }
            })
        });

        const data = await response.json();
        if (data.status === 'success') {
            showToast(data.message, 'success');
            if (type === 'AMBIL') {
                outCart = [];
                renderCart('AMBIL');
                document.getElementById('out-project').value = "";
            } else {
                retCart = [];
                renderCart('PULANG');
            }
            await fetchItems();
            await fetchTransactions();
            setTimeout(() => switchTab('dashboard'), 1500);
        } else {
            showErrorModal(data.message || 'Ralat menyimpan permohonan.');
        }
    } catch (error) {
        showErrorModal('Ralat sambungan rangkaian: ' + error.message);
    } finally {
        document.getElementById('global-loader').style.display = 'none';
    }
}

// Override processRequest to prompt for signature on APPROVE
window.processRequest = async function(reqId, actionStr) {
    if (actionStr === 'reject') {
        if (!confirm('Adakah anda pasti mahu MENOLAK permohonan ini?')) return;
        await doActualProcessRequest({ reqId, actionStr }, null);
        return;
    }
    
    // If approve, request signature
    currentSignatureAction = { type: 'processRequest', payload: { reqId, actionStr } };
    document.getElementById('signature-title').innerText = "Tandatangan Pelulus (Admin)";
    document.getElementById('signature-desc').innerText = "Sila sahkan kelulusan permohonan ini.";
    clearSignature();
    document.getElementById('signature-modal').style.display = 'flex';
};

async function doActualProcessRequest(payloadObj, sigBase64) {
    const { reqId, actionStr } = payloadObj;
    
    document.getElementById('global-loader').style.display = 'flex';
    try {
        const res = await fetch(SCRIPT_URL, {
            method: 'POST',
            body: JSON.stringify({
                action: actionStr === 'approve' ? 'approveRequest' : 'rejectRequest',
                payload: { 
                    Req_ID: reqId, 
                    Admin_Name: currentUser, 
                    Admin_PIN: currentUserPin,
                    Approver_Signature: sigBase64 
                }
            })
        });
        const data = await res.json();
        if (data.status === 'success') {
            showToast(data.message, 'success');
            if (data.pdf_url) {
                window.open(data.pdf_url, '_blank');
            }
            await fetchPendingRequests();
            await fetchItems();
            await fetchTransactions(); // Update profile history
        } else {
            showErrorModal(data.message);
        }
    } catch(e) {
        showErrorModal('Ralat pelayan.');
    } finally {
        document.getElementById('global-loader').style.display = 'none';
    }
}

// Override Profile Render to show PDF Download Button
window.renderProfileHistory = async function() {
    document.getElementById('global-loader').style.display = 'flex';
    try {
        const res = await fetch(`${SCRIPT_URL}?action=getPendingRequests`);
        const data = await res.json();
        if (data.status === 'success') {
            pendingRequests = data.data;
        }
    } catch(e) {}
    document.getElementById('global-loader').style.display = 'none';

    const tbody = document.querySelector('#profile-trans-table tbody');
    if (!tbody) return;

    const nameDisplay = document.getElementById('profile-name-display');
    if (nameDisplay) nameDisplay.innerText = currentUser || "Pengguna Tidak Dikenali";

    // 1. Get user's pending requests
    const personalReqs = (pendingRequests || []).filter(r => r && r.Entered_By && r.Entered_By.trim() === currentUser.trim());
    
    // 2. Get user's direct transactions (legacy AMBIL/PULANG, or DAFTAR/TAMBAH)
    const personalTrans = (allTransactions || []).filter(t => t && t.Entered_By && t.Entered_By.trim() === currentUser.trim());

    // 3. Merge them without duplicates
    let merged = [...personalReqs];
    personalTrans.forEach(t => {
        const exists = personalReqs.find(p => p.Timestamp === t.Timestamp && p.Item_ID === t.Item_ID);
        if (!exists) {
            // It's a direct transaction
            let mockStatus = 'Lulus (Rekod Lama)';
            if (t.Type === 'DAFTAR' || t.Type === 'TAMBAH') mockStatus = 'Selesai';
            t.Status = mockStatus;
            merged.push(t);
        }
    });

    const statsDisplay = document.getElementById('profile-stats-display');
    if (statsDisplay) {
        statsDisplay.innerText = `Anda mempunyai ${merged.length} rekod transaksi setakat ini.`;
    }

    if (!merged || merged.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;">Tiada rekod permohonan peribadi.</td></tr>';
        return;
    }

    // Sort by timestamp: newest first
    merged.sort((a, b) => {
        const parseTs = (ts) => {
            if (!ts) return 0;
            const s = String(ts).replace(/^'/, '');
            // Try DD/MM/YY or DD/MM/YYYY format
            const m = s.match(/(\d{2})\/(\d{2})\/(\d{2,4})\s*(\d{1,2}):(\d{2})\s*(AM|PM)/i);
            if (m) {
                let yr = parseInt(m[3]); if (yr < 100) yr += 2000;
                let hr = parseInt(m[4]); const isPM = m[6].toUpperCase() === 'PM';
                if (isPM && hr < 12) hr += 12; if (!isPM && hr === 12) hr = 0;
                return new Date(yr, parseInt(m[2])-1, parseInt(m[1]), hr, parseInt(m[5])).getTime();
            }
            const d = new Date(s);
            return isNaN(d.getTime()) ? 0 : d.getTime();
        };
        return parseTs(b.Timestamp) - parseTs(a.Timestamp);
    });

    tbody.innerHTML = merged.map(t => {
        if (!t) return '';
        let badgeClass = 'badge-tambah';
        if (t.Type === 'AMBIL') badgeClass = 'badge-ambil';
        if (t.Type === 'PULANG') badgeClass = 'badge-pulang';
        if (t.Type === 'DAFTAR') badgeClass = 'badge-daftar';
        
        let statusColor = '#f39c12'; // Pending
        let statusText = 'Dalam Proses';
        
        if (t.Status === 'Approved') { statusColor = '#27ae60'; statusText = 'Lulus'; }
        else if (t.Status === 'Rejected') { statusColor = '#c0392b'; statusText = 'Ditolak'; }
        else if (t.Status && t.Status !== 'Pending') { statusColor = '#2980b9'; statusText = t.Status; }
        
        let statusBadge = `<span style="background:${statusColor}; color:white; padding:3px 6px; border-radius:4px; font-size:0.7rem; white-space:nowrap;">${statusText}</span>`;
        
        let pdfBtn = t.PDF_URL ? `<button class="btn-submit" style="padding: 2px 8px; font-size: 0.7rem; margin: 0; background: #e67e22;" onclick="window.open('${t.PDF_URL}', '_blank')">Cetak</button>` : '-';

        // Find image from masterItems
        const master = masterItems.find(m => String(m.Item_ID).toUpperCase() === String(t.Item_ID).toUpperCase());
        const thumb = getThumbHtml(master ? master.Image_URL : '', 40);

        return `
        <tr>
            <td style="text-align:center; padding: 0.4rem;">${thumb}</td>
            <td style="font-size: 0.75rem; white-space: nowrap;">${formatTimestamp(t.Timestamp)}</td>
            <td><span class="badge ${badgeClass}" style="white-space: nowrap;">${t.Type}</span></td>
            <td><strong>${t.Item_ID || '-'}</strong><br><small style="color:var(--text-secondary)">${t.Item_Name || '-'}</small></td>
            <td><strong>${t.Quantity || 0}</strong></td>
            <td style="font-size: 0.75rem; word-break: break-word;">${t.Project || t.Remarks || '-'}</td>
            <td style="text-align: center;">${statusBadge}</td>
            <td style="text-align: center;">${pdfBtn}</td>
        </tr>
    `}).join('');
};
// Execute init on load if it's already DOMContentLoaded
if (document.readyState === "complete" || document.readyState === "interactive") {
    setTimeout(initSignaturePad, 100);
}
