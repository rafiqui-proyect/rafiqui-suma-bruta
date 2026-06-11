/* ==========================================
   LOGIC ENGINE: MUESTREO SIGATOKA NEGRA V2
   Progressive Web App Logic
   Persistence: Offline-First / Supabase Sync
   ========================================== */

// Supabase Init
const SUPABASE_URL = "https://pknnmsslbfjmnsxteylf.supabase.co";
const SUPABASE_KEY = "sb_publishable_d4L3CpfSvcMdDUeYGAEChg_7kJgWlxV";
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// Coefficient matrix: EE -> COE mapping for Plantas Jóvenes (V2)
const COEFFICIENTS = {
    '0': 0.0,
    '-1': 40.0,
    '1': 60.0,
    '-2': 80.0,
    '2': 100.0,
    '-3': 120.0,
    '3': 140.0
};

// State Variables
let plantData = [];
let sanidadData = [];
let sanidadS7Data = [];
let sanidadS11Data = [];
let currentSanidadStage = 'rp'; // 'rp', 's7', or 's11'
const sanidadCols = ['ht', 'hvle', 'hvlq_low', 'hvlq_high', 'hvlc'];
let activeCell = null; // { plantIndex, col, isSanidad, stage }
let isOnline = false;
let historyData = [];
let trendChartInstance = null;
let sanidadChartInstance = null;
let sanidadS7ChartInstance = null;
let sanidadS11ChartInstance = null;
let currentDetailIndex = null; // For modal view/delete
let applicationsData = []; // Product applications logs

// Config Defaults
const TOTAL_PLANTS = 5;
const cols = ['ee', 'candela', 'ht', 'hvle'];

// Initialization
document.addEventListener("DOMContentLoaded", () => {
    // Set Client ID from localStorage or default
    const client_id = localStorage.getItem('rafiqui_client_id') || "DEMO-123";
    document.getElementById("input-station-id").value = client_id;

    // Load History from localStorage
    loadHistory();

    // Load Product Applications
    loadApplications();
    renderApplicationsList();
    
    // Set default date to today for application input
    const dateInput = document.getElementById("app-date");
    if (dateInput) {
        dateInput.value = new Date().toISOString().substring(0, 10);
    }

    // Check Network Connection
    updateNetworkStatus();
    window.addEventListener('online', updateNetworkStatus);
    window.addEventListener('offline', updateNetworkStatus);

    // Initialize Blank Grid
    initBlankGrid();
    initBlankSanidadGrid();

    // Load Charts tab if selected
    renderTrendChart();
    renderSanidadTrendChart();
    renderSanidadS7TrendChart();
    renderSanidadS11TrendChart();

    // Register Service Worker for PWA offline capability
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./sw.js')
            .then(reg => {
                console.log('Service Worker registered successfully:', reg.scope);
                
                reg.addEventListener('updatefound', () => {
                    const newWorker = reg.installing;
                    newWorker.addEventListener('statechange', () => {
                        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                            console.log('Nueva versión instalada. Activando...');
                        }
                    });
                });
            })
            .catch(err => console.error('Service Worker registration failed:', err));

        let refreshing = false;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            if (!refreshing) {
                refreshing = true;
                window.location.reload();
            }
        });
    }
});

// Network status indicators
function updateNetworkStatus() {
    isOnline = navigator.onLine;
    const badge = document.getElementById("sync-status");
    const text = document.getElementById("sync-status-text");
    
    if (isOnline) {
        badge.classList.remove("offline");
        badge.classList.add("online");
        text.innerText = "Sincronizar (Online)";
        
        // Auto sync if there are unsynced items
        autoSyncUnsynced();
    } else {
        badge.classList.remove("online");
        badge.classList.add("offline");
        text.innerText = "Sin Sincronizar (Offline)";
    }
}

// Generate the 5 rows in the data entry table for V2
function initBlankGrid() {
    const container = document.getElementById("plant-rows-container");
    container.innerHTML = "";
    plantData = [];

    for (let i = 0; i < TOTAL_PLANTS; i++) {
        plantData.push({
            num: i + 1,
            ee: "",
            coe: "",
            candela: "",
            coe_cand: "",
            ht: "",
            hvle: ""
        });

        const row = document.createElement("div");
        row.className = "table-row-grid";
        row.id = `plant-row-${i}`;
        row.innerHTML = `
            <div class="plant-num">${i + 1}</div>
            <div class="input-cell" id="cell-${i}-ee" onclick="openEEKeypad(${i})">-</div>
            <div class="input-cell" id="cell-${i}-coe" style="background: rgba(255,255,255,0.01); color: var(--text-dim); cursor: default;">-</div>
            <div class="input-cell candela" id="cell-${i}-candela" onclick="openCandelaKeypad(${i})">-</div>
            <div class="input-cell" id="cell-${i}-ht" onclick="openNumericKeypad(${i}, 'ht')">-</div>
            <div class="input-cell" id="cell-${i}-hvle" onclick="openNumericKeypad(${i}, 'hvle')">-</div>
        `;
        container.appendChild(row);
    }
    
    calculateTotals();
}

// Generate the 5 rows in the sanidad table for V2, S7 and S11
function initBlankSanidadGrid() {
    const container = document.getElementById("sanidad-rows-container");
    const containerS7 = document.getElementById("sanidad-s7-rows-container");
    const containerS11 = document.getElementById("sanidad-s11-rows-container");
    if (!container || !containerS7 || !containerS11) return;

    container.innerHTML = "";
    containerS7.innerHTML = "";
    containerS11.innerHTML = "";
    sanidadData = [];
    sanidadS7Data = [];
    sanidadS11Data = [];

    for (let i = 0; i < TOTAL_PLANTS; i++) {
        // RP Data
        sanidadData.push({
            num: i + 1,
            ht: "",
            hvle: "",
            hvlq_low: "",
            hvlq_high: "",
            hvlc: ""
        });

        const row = document.createElement("div");
        row.className = "table-row-grid";
        row.id = `sanidad-row-${i}`;
        row.style.gridTemplateColumns = "0.6fr repeat(5, 1fr)";
        row.style.padding = "6px 4px";
        row.innerHTML = `
            <div class="plant-num">${i + 1}</div>
            <div class="input-cell" id="sanidad-cell-${i}-ht" onclick="openSanidadNumericKeypad(${i}, 'ht')">-</div>
            <div class="input-cell" id="sanidad-cell-${i}-hvle" onclick="openSanidadNumericKeypad(${i}, 'hvle')">-</div>
            <div class="input-cell" id="sanidad-cell-${i}-hvlq_low" onclick="openSanidadNumericKeypad(${i}, 'hvlq_low')">-</div>
            <div class="input-cell" id="sanidad-cell-${i}-hvlq_high" onclick="openSanidadNumericKeypad(${i}, 'hvlq_high')">-</div>
            <div class="input-cell" id="sanidad-cell-${i}-hvlc" onclick="openSanidadNumericKeypad(${i}, 'hvlc')">-</div>
        `;
        container.appendChild(row);

        // S7 Data
        sanidadS7Data.push({
            num: i + 1,
            ht: "",
            hvle: "",
            hvlq_low: "",
            hvlq_high: "",
            hvlc: ""
        });

        const rowS7 = document.createElement("div");
        rowS7.className = "table-row-grid";
        rowS7.id = `sanidad-s7-row-${i}`;
        rowS7.style.gridTemplateColumns = "0.6fr repeat(5, 1fr)";
        rowS7.style.padding = "6px 4px";
        rowS7.innerHTML = `
            <div class="plant-num">${i + 1}</div>
            <div class="input-cell" id="sanidad-s7-cell-${i}-ht" onclick="openSanidadNumericKeypad(${i}, 'ht')">-</div>
            <div class="input-cell" id="sanidad-s7-cell-${i}-hvle" onclick="openSanidadNumericKeypad(${i}, 'hvle')">-</div>
            <div class="input-cell" id="sanidad-s7-cell-${i}-hvlq_low" onclick="openSanidadNumericKeypad(${i}, 'hvlq_low')">-</div>
            <div class="input-cell" id="sanidad-s7-cell-${i}-hvlq_high" onclick="openSanidadNumericKeypad(${i}, 'hvlq_high')">-</div>
            <div class="input-cell" id="sanidad-s7-cell-${i}-hvlc" onclick="openSanidadNumericKeypad(${i}, 'hvlc')">-</div>
        `;
        containerS7.appendChild(rowS7);

        // S11 Data
        sanidadS11Data.push({
            num: i + 1,
            ht: "",
            hvle: "",
            hvlq_low: "",
            hvlq_high: "",
            hvlc: ""
        });

        const rowS11 = document.createElement("div");
        rowS11.className = "table-row-grid";
        rowS11.id = `sanidad-s11-row-${i}`;
        rowS11.style.gridTemplateColumns = "0.6fr repeat(5, 1fr)";
        rowS11.style.padding = "6px 4px";
        rowS11.innerHTML = `
            <div class="plant-num">${i + 1}</div>
            <div class="input-cell" id="sanidad-s11-cell-${i}-ht" onclick="openSanidadNumericKeypad(${i}, 'ht')">-</div>
            <div class="input-cell" id="sanidad-s11-cell-${i}-hvle" onclick="openSanidadNumericKeypad(${i}, 'hvle')">-</div>
            <div class="input-cell" id="sanidad-s11-cell-${i}-hvlq_low" onclick="openSanidadNumericKeypad(${i}, 'hvlq_low')">-</div>
            <div class="input-cell" id="sanidad-s11-cell-${i}-hvlq_high" onclick="openSanidadNumericKeypad(${i}, 'hvlq_high')">-</div>
            <div class="input-cell" id="sanidad-s11-cell-${i}-hvlc" onclick="openSanidadNumericKeypad(${i}, 'hvlc')">-</div>
        `;
        containerS11.appendChild(rowS11);
    }
    
    // Default switch to RP stage
    switchSanidadStage('rp');
}

function switchSanidadStage(stage) {
    currentSanidadStage = stage;
    const btnRP = document.getElementById("btn-stage-rp");
    const btnS7 = document.getElementById("btn-stage-s7");
    const btnS11 = document.getElementById("btn-stage-s11");
    const containerRP = document.getElementById("sanidad-rp-container");
    const containerS7 = document.getElementById("sanidad-s7-container");
    const containerS11 = document.getElementById("sanidad-s11-container");
    const summaryTitle = document.getElementById("sanidad-summary-title");

    // Reset all buttons and containers
    btnRP.className = "btn-secondary";
    btnS7.className = "btn-secondary";
    btnS11.className = "btn-secondary";
    containerRP.style.display = "none";
    containerS7.style.display = "none";
    containerS11.style.display = "none";

    if (stage === 'rp') {
        btnRP.className = "btn-primary";
        containerRP.style.display = "block";
        summaryTitle.innerText = "Sanidad RP (Promedios)";
    } else if (stage === 's7') {
        btnS7.className = "btn-primary";
        containerS7.style.display = "block";
        summaryTitle.innerText = "Sanidad S7 (Promedios)";
    } else if (stage === 's11') {
        btnS11.className = "btn-primary";
        containerS11.style.display = "block";
        summaryTitle.innerText = "Sanidad S11 (Promedios)";
    }

    calculateSanidadTotals();
}

function calculateSanidadTotals() {
    let dataToUse = currentSanidadStage === 'rp' ? sanidadData : (currentSanidadStage === 's7' ? sanidadS7Data : sanidadS11Data);

    let totalHT = 0, countHT = 0;
    let totalHVLE = 0, countHVLE = 0;
    let totalHVLQ_low = 0, countHVLQ_low = 0;
    let totalHVLQ_high = 0, countHVLQ_high = 0;
    let totalHVLC = 0, countHVLC = 0;

    dataToUse.forEach(row => {
        if (row.ht !== "" && row.ht !== undefined && row.ht !== null) {
            totalHT += parseInt(row.ht);
            countHT++;
        }
        if (row.hvle !== "" && row.hvle !== undefined && row.hvle !== null) {
            totalHVLE += parseInt(row.hvle);
            countHVLE++;
        }
        if (row.hvlq_low !== "" && row.hvlq_low !== undefined && row.hvlq_low !== null) {
            totalHVLQ_low += parseInt(row.hvlq_low);
            countHVLQ_low++;
        }
        if (row.hvlq_high !== "" && row.hvlq_high !== undefined && row.hvlq_high !== null) {
            totalHVLQ_high += parseInt(row.hvlq_high);
            countHVLQ_high++;
        }
        if (row.hvlc !== "" && row.hvlc !== undefined && row.hvlc !== null) {
            totalHVLC += parseInt(row.hvlc);
            countHVLC++;
        }
    });

    const avgHT = countHT > 0 ? (totalHT / countHT) : 0.0;
    const avgHVLE = countHVLE > 0 ? (totalHVLE / countHVLE) : 0.0;
    const avgHVLQ_low = countHVLQ_low > 0 ? (totalHVLQ_low / countHVLQ_low) : 0.0;
    const avgHVLQ_high = countHVLQ_high > 0 ? (totalHVLQ_high / countHVLQ_high) : 0.0;
    const avgHVLC = countHVLC > 0 ? (totalHVLC / countHVLC) : 0.0;

    // Update UI elements
    const htEl = document.getElementById("avg-sanidad-ht");
    if (htEl) htEl.innerText = `HT: ${avgHT.toFixed(1)}`;

    const hvleEl = document.getElementById("avg-sanidad-hvle");
    if (hvleEl) hvleEl.innerText = `H+VLE: ${avgHVLE.toFixed(1)}`;

    const hvlqLowEl = document.getElementById("avg-sanidad-hvlq-low");
    if (hvlqLowEl) hvlqLowEl.innerText = `H+VLQ <5%: ${avgHVLQ_low.toFixed(1)}`;

    const hvlqHighEl = document.getElementById("avg-sanidad-hvlq-high");
    if (hvlqHighEl) hvlqHighEl.innerText = `H+VLQ >5%: ${avgHVLQ_high.toFixed(1)}`;

    const hvlcEl = document.getElementById("avg-sanidad-hvlc");
    if (hvlcEl) hvlcEl.innerText = `H+VLC: ${avgHVLC.toFixed(1)}`;
}

// Switch Views (Tabs)
function switchView(viewName, btnElement) {
    // Tabs Active State
    document.querySelectorAll(".tab-content").forEach(tab => tab.classList.remove("active"));
    document.querySelectorAll(".tab-btn").forEach(btn => btn.classList.remove("active"));
    
    document.getElementById(`view-${viewName}`).classList.add("active");
    btnElement.classList.add("active");

    if (viewName === 'graficos') {
        renderTrendChart();
        renderSanidadTrendChart();
        renderSanidadS7TrendChart();
        renderSanidadS11TrendChart();
        // Load calculations table reference
        updateReferenceTableOnTabChange();
    } else if (viewName === 'historial') {
        renderHistoryList();
    }
}

// Dynamically updates the reference table with the latest saved record or the active sheet data
function updateReferenceTableOnTabChange() {
    if (historyData && historyData.length > 0) {
        // Use the latest saved sampling (historyData[0])
        const item = historyData[0];
        const plants = item.detalles_json.plants;
        
        let totalCoeCand = 0.0;
        let countCoeCand = 0;
        let totalHT = 0;
        let countHT = 0;
        let totalHvle = 0;
        let countHvle = 0;

        plants.forEach(p => {
            if (p.coe_cand !== "" && p.coe_cand !== undefined && p.coe_cand !== null) {
                totalCoeCand += parseFloat(p.coe_cand);
                countCoeCand++;
            }
            if (p.ht !== "" && p.ht !== undefined && p.ht !== null) {
                totalHT += parseInt(p.ht);
                countHT++;
            }
            if (p.hvle !== "" && p.hvle !== undefined && p.hvle !== null) {
                totalHvle += parseInt(p.hvle);
                countHvle++;
            }
        });

        const avgCoeCand = countCoeCand > 0 ? (totalCoeCand / countCoeCand) : 0.0;
        const sumaBruta = avgCoeCand * 10;
        const avgHT = countHT > 0 ? (totalHT / countHT) : 0.0;
        const avgHvle = countHvle > 0 ? (totalHvle / countHvle) : 0.0;

        // Temporarily swap plantData to draw the history item rows
        const activePlantDataBackup = plantData;
        plantData = plants;
        renderCalcReferenceTable(totalCoeCand, totalHT, totalHvle, avgCoeCand, sumaBruta, avgHT, avgHvle);
        plantData = activePlantDataBackup;
    } else {
        // Fallback to active empty/active sheet calculation totals
        calculateTotals();
    }
}

// Dynamically updates the reference table using a specific history item index
function updateReferenceTableForIndex(index) {
    if (historyData && historyData[index]) {
        const item = historyData[index];
        const plants = item.detalles_json.plants;
        
        let totalCoeCand = 0.0;
        let countCoeCand = 0;
        let totalHT = 0;
        let countHT = 0;
        let totalHvle = 0;
        let countHvle = 0;

        plants.forEach(p => {
            if (p.coe_cand !== "" && p.coe_cand !== undefined && p.coe_cand !== null) {
                totalCoeCand += parseFloat(p.coe_cand);
                countCoeCand++;
            }
            if (p.ht !== "" && p.ht !== undefined && p.ht !== null) {
                totalHT += parseInt(p.ht);
                countHT++;
            }
            if (p.hvle !== "" && p.hvle !== undefined && p.hvle !== null) {
                totalHvle += parseInt(p.hvle);
                countHvle++;
            }
        });

        const avgCoeCand = countCoeCand > 0 ? (totalCoeCand / countCoeCand) : 0.0;
        const sumaBruta = avgCoeCand * 10;
        const avgHT = countHT > 0 ? (totalHT / countHT) : 0.0;
        const avgHvle = countHvle > 0 ? (totalHvle / countHvle) : 0.0;

        const activePlantDataBackup = plantData;
        plantData = plants;
        renderCalcReferenceTable(totalCoeCand, totalHT, totalHvle, avgCoeCand, sumaBruta, avgHT, avgHvle);
        plantData = activePlantDataBackup;
        
        // Also update the Title of the Reference Card to show the selected point's Lote and Date
        const refTitle = document.querySelector(".panel-title[style*='margin-bottom: 8px']");
        if (refTitle) {
            const dateObj = new Date(item.created_at);
            refTitle.innerText = `Tabla de Cálculos: ${item.lote} (${dateObj.getDate()}/${dateObj.getMonth()+1})`;
        }
    }
}

// Open EE Keypad Bottom Sheet
function openEEKeypad(plantIndex) {
    const prevPlantIndex = activeCell ? activeCell.plantIndex : null;
    clearActiveHighlight();
    activeCell = { plantIndex, col: 'ee' };
    
    document.getElementById(`plant-row-${plantIndex}`).classList.add("active-row");
    document.getElementById(`cell-${plantIndex}-ee`).classList.add("active-cell");

    document.getElementById("ee-keypad-title").innerText = `Planta ${plantIndex + 1} - Estadio de Infección (EE)`;
    
    closeAllSheets();
    document.getElementById("ee-keypad-sheet").classList.add("open");
    adjustViewPadding(plantIndex, "ee-keypad-sheet");
    scrollIntoViewWithDelay(plantIndex, prevPlantIndex);
}

// Open Candela Keypad Bottom Sheet
function openCandelaKeypad(plantIndex) {
    const prevPlantIndex = activeCell ? activeCell.plantIndex : null;
    clearActiveHighlight();
    activeCell = { plantIndex, col: 'candela' };
    
    document.getElementById(`plant-row-${plantIndex}`).classList.add("active-row");
    document.getElementById(`cell-${plantIndex}-candela`).classList.add("active-cell");

    document.getElementById("candela-keypad-title").innerText = `Planta ${plantIndex + 1} - Apertura Cigarro`;
    
    closeAllSheets();
    document.getElementById("candela-keypad-sheet").classList.add("open");
    adjustViewPadding(plantIndex, "candela-keypad-sheet");
    scrollIntoViewWithDelay(plantIndex, prevPlantIndex);
}

// Open Numeric Keypad Bottom Sheet (HT and H+VLE)
function openNumericKeypad(plantIndex, col) {
    const prevPlantIndex = activeCell ? activeCell.plantIndex : null;
    clearActiveHighlight();
    activeCell = { plantIndex, col, isSanidad: false };
    
    document.getElementById(`plant-row-${plantIndex}`).classList.add("active-row");
    document.getElementById(`cell-${plantIndex}-${col}`).classList.add("active-cell");

    const labelName = col === 'ht' ? 'Hojas Totales (HT)' : 'Vieja Libre Estrías (H+VLE)';
    document.getElementById("numeric-keypad-title").innerText = `Planta ${plantIndex + 1} - ${labelName}`;
    
    closeAllSheets();
    document.getElementById("numeric-keypad-sheet").classList.add("open");
    adjustViewPadding(plantIndex, "numeric-keypad-sheet");
    scrollIntoViewWithDelay(plantIndex, prevPlantIndex);
}

// Open Sanidad Numeric Keypad
function openSanidadNumericKeypad(plantIndex, col) {
    const prevPlantIndex = activeCell ? activeCell.plantIndex : null;
    clearActiveHighlight();
    activeCell = { plantIndex, col, isSanidad: true, stage: currentSanidadStage };
    
    const stagePrefix = currentSanidadStage === 's7' ? 'sanidad-s7' : (currentSanidadStage === 's11' ? 'sanidad-s11' : 'sanidad');
    const rowId = `${stagePrefix}-row-${plantIndex}`;
    const cellId = `${stagePrefix}-cell-${plantIndex}-${col}`;

    const rowEl = document.getElementById(rowId);
    const cellEl = document.getElementById(cellId);

    if (rowEl) rowEl.classList.add("active-row");
    if (cellEl) cellEl.classList.add("active-cell");

    let labelName = "";
    if (col === 'ht') labelName = 'Hojas Totales (HT)';
    else if (col === 'hvle') labelName = 'Libre Estrías (H+VLE)';
    else if (col === 'hvlq_low') labelName = 'Libre Quema <5%';
    else if (col === 'hvlq_high') labelName = 'Libre Quema >5%';
    else if (col === 'hvlc') labelName = 'Libre Cirugía (H+VLC)';

    document.getElementById("numeric-keypad-title").innerText = `Planta ${plantIndex + 1} - ${labelName}`;
    
    closeAllSheets();
    document.getElementById("numeric-keypad-sheet").classList.add("open");
    adjustViewPaddingForSanidad(plantIndex, "numeric-keypad-sheet");
    scrollIntoViewWithDelayForSanidad(plantIndex, prevPlantIndex);
}

function closeAllSheets() {
    document.getElementById("ee-keypad-sheet").classList.remove("open");
    document.getElementById("candela-keypad-sheet").classList.remove("open");
    document.getElementById("numeric-keypad-sheet").classList.remove("open");
}

function adjustViewPadding(plantIndex, sheetId) {
    const viewContainer = document.getElementById("view-toma-datos");
    const sheet = document.getElementById(sheetId);
    
    if (plantIndex >= 3) {
        sheet.classList.add("keyboard-top");
        if (viewContainer) {
            viewContainer.classList.remove("keyboard-bottom-active");
            viewContainer.classList.add("keyboard-top-active");
        }
    } else {
        sheet.classList.remove("keyboard-top");
        if (viewContainer) {
            viewContainer.classList.remove("keyboard-top-active");
            viewContainer.classList.add("keyboard-bottom-active");
        }
    }
}

function adjustViewPaddingForSanidad(plantIndex, sheetId) {
    const viewContainer = document.getElementById("view-sanidad");
    const sheet = document.getElementById(sheetId);
    
    if (plantIndex >= 3) {
        sheet.classList.add("keyboard-top");
        if (viewContainer) {
            viewContainer.classList.remove("keyboard-bottom-active");
            viewContainer.classList.add("keyboard-top-active");
        }
    } else {
        sheet.classList.remove("keyboard-top");
        if (viewContainer) {
            viewContainer.classList.remove("keyboard-top-active");
            viewContainer.classList.add("keyboard-bottom-active");
        }
    }
}

function scrollIntoViewWithDelay(plantIndex, prevPlantIndex) {
    if (prevPlantIndex !== plantIndex) {
        setTimeout(() => {
            const activeRow = document.getElementById(`plant-row-${plantIndex}`);
            if (activeRow) {
                activeRow.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
        }, 80);
    }
}

function scrollIntoViewWithDelayForSanidad(plantIndex, prevPlantIndex) {
    if (prevPlantIndex !== plantIndex) {
        setTimeout(() => {
            const stagePrefix = currentSanidadStage === 's7' ? 'sanidad-s7' : (currentSanidadStage === 's11' ? 'sanidad-s11' : 'sanidad');
            const rowId = `${stagePrefix}-row-${plantIndex}`;
            const activeRow = document.getElementById(rowId);
            if (activeRow) {
                activeRow.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
        }, 80);
    }
}

function closeKeypad() {
    clearActiveHighlight();
    closeAllSheets();
    activeCell = null;

    const viewContainer = document.getElementById("view-toma-datos");
    if (viewContainer) {
        viewContainer.classList.remove("keyboard-bottom-active");
        viewContainer.classList.remove("keyboard-top-active");
    }
    const viewContainerSanidad = document.getElementById("view-sanidad");
    if (viewContainerSanidad) {
        viewContainerSanidad.classList.remove("keyboard-bottom-active");
        viewContainerSanidad.classList.remove("keyboard-top-active");
    }
    
    document.getElementById("ee-keypad-sheet").classList.remove("keyboard-top");
    document.getElementById("candela-keypad-sheet").classList.remove("keyboard-top");
    document.getElementById("numeric-keypad-sheet").classList.remove("keyboard-top");
}

function clearActiveHighlight() {
    document.querySelectorAll(".table-row-grid").forEach(row => row.classList.remove("active-row"));
    document.querySelectorAll(".input-cell").forEach(cell => cell.classList.remove("active-cell"));
}

// Input values handlers
function inputEE(val) {
    if (!activeCell) return;
    const { plantIndex } = activeCell;
    
    plantData[plantIndex].ee = val;
    const coe = COEFFICIENTS[val] || 0.0;
    plantData[plantIndex].coe = coe;

    // Update UI cells
    const eeCell = document.getElementById(`cell-${plantIndex}-ee`);
    eeCell.innerText = val;
    eeCell.className = "input-cell has-val";

    const coeCell = document.getElementById(`cell-${plantIndex}-coe`);
    coeCell.innerText = coe;

    calculateRowSB(plantIndex);
    autoAdvance();
}

function inputCandela(val) {
    if (!activeCell) return;
    const { plantIndex } = activeCell;
    
    plantData[plantIndex].candela = val;

    // Update UI cell
    const candelaCell = document.getElementById(`cell-${plantIndex}-candela`);
    candelaCell.innerText = val;
    candelaCell.className = "input-cell candela has-val";

    calculateRowSB(plantIndex);
    autoAdvance();
}

function inputNumeric(val) {
    if (!activeCell) return;
    const { plantIndex, col, isSanidad, stage } = activeCell;
    
    if (isSanidad) {
        const dataToUse = stage === 's7' ? sanidadS7Data : (stage === 's11' ? sanidadS11Data : sanidadData);
        const stagePrefix = stage === 's7' ? 'sanidad-s7' : (stage === 's11' ? 'sanidad-s11' : 'sanidad');
        const cellId = `${stagePrefix}-cell-${plantIndex}-${col}`;
        
        dataToUse[plantIndex][col] = parseInt(val);
        const cell = document.getElementById(cellId);
        if (cell) {
            cell.innerText = val;
            cell.className = "input-cell has-val";
        }
        calculateSanidadTotals();
    } else {
        plantData[plantIndex][col] = parseInt(val);
        const cell = document.getElementById(`cell-${plantIndex}-${col}`);
        if (cell) {
            cell.innerText = val;
            cell.className = "input-cell has-val";
        }
        calculateTotals();
    }
    autoAdvance();
}

function inputNumericPrompt() {
    if (!activeCell) return;
    const { plantIndex, col, isSanidad, stage } = activeCell;
    let promptLabel = "";
    if (col === 'ht') promptLabel = 'Hojas Totales (HT)';
    else if (col === 'hvle') promptLabel = 'Libre Estrías (H+VLE)';
    else if (col === 'hvlq_low') promptLabel = 'Libre Quema <5%';
    else if (col === 'hvlq_high') promptLabel = 'Libre Quema >5%';
    else if (col === 'hvlc') promptLabel = 'Libre Cirugía (H+VLC)';
    
    const defaultVal = isSanidad ? 
        (((stage === 's7' ? sanidadS7Data : (stage === 's11' ? sanidadS11Data : sanidadData))[plantIndex][col]) || "10") : 
        (plantData[plantIndex][col] || "10");
    
    const res = prompt(`Introduce el valor para ${promptLabel}:`, defaultVal);
    if (res !== null && !isNaN(res) && res.trim() !== "") {
        inputNumeric(parseInt(res));
    }
}

// Auto-advance through columns: ee -> candela -> ht -> hvle -> next row
function autoAdvance() {
    if (!activeCell) return;
    const { plantIndex, col, isSanidad } = activeCell;
    
    if (isSanidad) {
        const currentColIndex = sanidadCols.indexOf(col);
        if (currentColIndex < sanidadCols.length - 1) {
            // Advance to next column on same plant row
            const nextCol = sanidadCols[currentColIndex + 1];
            openSanidadNumericKeypad(plantIndex, nextCol);
        } else {
            // Advance to next plant
            if (plantIndex < TOTAL_PLANTS - 1) {
                openSanidadNumericKeypad(plantIndex + 1, sanidadCols[0]);
            } else {
                closeKeypad();
            }
        }
    } else {
        const currentColIndex = cols.indexOf(col);
        if (currentColIndex < cols.length - 1) {
            // Advance to next column on same plant row
            const nextCol = cols[currentColIndex + 1];
            if (nextCol === 'candela') {
                openCandelaKeypad(plantIndex);
            } else {
                openNumericKeypad(plantIndex, nextCol);
            }
        } else {
            // Advance to next plant
            if (plantIndex < TOTAL_PLANTS - 1) {
                openEEKeypad(plantIndex + 1);
            } else {
                closeKeypad();
            }
        }
    }
}

// Calculate COE - Candela for row
function calculateRowSB(plantIndex) {
    const row = plantData[plantIndex];
    if (row.ee !== "" && row.candela !== "") {
        const coe = parseFloat(row.coe);
        const cand = parseFloat(row.candela);
        const coe_cand = coe - cand;
        row.coe_cand = coe_cand;
    }
    calculateTotals();
}

// Calculate batch totals: averages and Suma Bruta
function calculateTotals() {
    let totalCoeCand = 0.0;
    let countCoeCand = 0;
    
    let totalHT = 0;
    let countHT = 0;
    
    let totalHvle = 0;
    let countHvle = 0;

    plantData.forEach(row => {
        if (row.coe_cand !== "" && row.coe_cand !== undefined) {
            totalCoeCand += parseFloat(row.coe_cand);
            countCoeCand++;
        }
        if (row.ht !== "" && row.ht !== undefined && row.ht !== null) {
            totalHT += parseInt(row.ht);
            countHT++;
        }
        if (row.hvle !== "" && row.hvle !== undefined && row.hvle !== null) {
            totalHvle += parseInt(row.hvle);
            countHvle++;
        }
    });

    let totalCandela = 0.0;
    let countCandela = 0;
    plantData.forEach(row => {
        if (row.candela !== "" && row.candela !== undefined && row.candela !== null) {
            totalCandela += parseFloat(row.candela);
            countCandela++;
        }
    });
    const avgCandela = countCandela > 0 ? (totalCandela / countCandela) : 0.0;

    const avgCoeCand = countCoeCand > 0 ? (totalCoeCand / countCoeCand) : 0.0;
    const sumaBruta = avgCoeCand * 10;
    
    const avgHT = countHT > 0 ? (totalHT / countHT) : 0.0;
    const avgHvle = countHvle > 0 ? (totalHvle / countHvle) : 0.0;

    // Update screen headers / summary KPI card
    const avgSBEl = document.getElementById("avg-sb-value");
    avgSBEl.innerText = sumaBruta.toFixed(1);

    document.getElementById("leaves-average-text").innerText = `Hojas Prom: ${avgHT.toFixed(1)} | H+VLE Prom: ${avgHvle.toFixed(1)} | Candela Prom: ${avgCandela.toFixed(2)}`;

    const summaryCard = document.getElementById("sb-summary-card");
    const statusBadge = document.getElementById("sb-status-badge");
    
    summaryCard.className = "summary-kpi";
    if (sumaBruta < 500) {
        summaryCard.classList.add("low");
        statusBadge.innerText = "Baja Presión";
        statusBadge.style.color = "var(--green)";
        statusBadge.style.background = "rgba(0, 255, 170, 0.15)";
    } else if (sumaBruta >= 500 && sumaBruta <= 800) {
        summaryCard.classList.add("mid");
        statusBadge.innerText = "Alerta Media";
        statusBadge.style.color = "var(--yellow)";
        statusBadge.style.background = "rgba(255, 179, 0, 0.15)";
    } else {
        summaryCard.classList.add("high");
        statusBadge.innerText = "Alerta Crítica";
        statusBadge.style.color = "var(--red)";
        statusBadge.style.background = "rgba(255, 77, 77, 0.15)";
    }
    // Update dynamic reference table for calculations in Gráficos tab
    renderCalcReferenceTable(totalCoeCand, totalHT, totalHvle, avgCoeCand, sumaBruta, avgHT, avgHvle);
}

// Dynamically populates the reference calculation table below the graph
function renderCalcReferenceTable(totalCoeCand, totalHT, totalHvle, avgCoeCand, sumaBruta, avgHT, avgHvle) {
    const tableBody = document.getElementById("calc-reference-table-body");
    if (!tableBody) return;

    let rowsHTML = "";
    plantData.forEach(p => {
        rowsHTML += `
            <div style="display: grid; grid-template-columns: repeat(7, 1fr); padding: 2px 0; border-bottom: 1px solid rgba(255,255,255,0.02);">
                <div>${p.num}</div>
                <div>${p.ee !== "" ? p.ee : "-"}</div>
                <div>${p.coe !== "" ? p.coe : "-"}</div>
                <div>${p.candela !== "" ? p.candela : "-"}</div>
                <div>${p.coe_cand !== "" && p.coe_cand !== undefined ? p.coe_cand.toFixed(1) : "-"}</div>
                <div>${p.ht !== "" ? p.ht : "-"}</div>
                <div>${p.hvle !== "" ? p.hvle : "-"}</div>
            </div>
        `;
    });

    // Add totals/promedios footer
    rowsHTML += `
        <div style="display: grid; grid-template-columns: repeat(7, 1fr); font-weight: bold; border-top: 1.5px solid var(--border-glass); padding-top: 4px; margin-top: 2px;">
            <div style="grid-column: span 4; text-align: left; padding-left: 6px;">Total</div>
            <div>${totalCoeCand.toFixed(1)}</div>
            <div>${totalHT}</div>
            <div>${totalHvle}</div>
        </div>
        <div style="display: grid; grid-template-columns: repeat(7, 1fr); font-weight: bold;">
            <div style="grid-column: span 4; text-align: left; padding-left: 6px;">Promedio</div>
            <div>${avgCoeCand > 0 ? avgCoeCand.toFixed(2) : "0.00"}</div>
            <div>${avgHT.toFixed(1)}</div>
            <div>${avgHvle.toFixed(1)}</div>
        </div>
        <div style="display: grid; grid-template-columns: repeat(7, 1fr); font-weight: 800; color: var(--cyan); margin-top: 2px;">
            <div style="grid-column: span 4; text-align: left; padding-left: 6px;">Suma Bruta</div>
            <div style="grid-column: span 3; text-align: right; padding-right: 12px; font-size: 0.85rem;">${sumaBruta.toFixed(1)}</div>
        </div>
    `;

    tableBody.innerHTML = rowsHTML;
}

// Save current muestreo to local storage
function saveCurrentMuestreo() {
    let hasData = false;
    for (let row of plantData) {
        if (row.ee !== "" || row.candela !== "" || row.ht !== "" || row.hvle !== "") {
            hasData = true;
            break;
        }
    }
    for (let row of sanidadData) {
        if (row.ht !== "" || row.hvle !== "" || row.hvlq_low !== "" || row.hvlq_high !== "" || row.hvlc !== "") {
            hasData = true;
            break;
        }
    }
    for (let row of sanidadS7Data) {
        if (row.ht !== "" || row.hvle !== "" || row.hvlq_low !== "" || row.hvlq_high !== "" || row.hvlc !== "") {
            hasData = true;
            break;
        }
    }
    for (let row of sanidadS11Data) {
        if (row.ht !== "" || row.hvle !== "" || row.hvlq_low !== "" || row.hvlq_high !== "" || row.hvlc !== "") {
            hasData = true;
            break;
        }
    }

    if (!hasData) {
        alert("Por favor introduce datos de Suma Bruta o Sanidad antes de guardar.");
        return;
    }

    // Calculations for Suma Bruta
    let totalCoeCand = 0.0;
    let countCoeCand = 0;
    let totalHT = 0;
    let countHT = 0;
    let totalHvle = 0;
    let countHvle = 0;

    plantData.forEach(row => {
        if (row.coe_cand !== "" && row.coe_cand !== undefined && row.coe_cand !== null) {
            totalCoeCand += parseFloat(row.coe_cand);
            countCoeCand++;
        }
        if (row.ht !== "" && row.ht !== undefined && row.ht !== null) {
            totalHT += parseInt(row.ht);
            countHT++;
        }
        if (row.hvle !== "" && row.hvle !== undefined && row.hvle !== null) {
            totalHvle += parseInt(row.hvle);
            countHvle++;
        }
    });

    const avgCoeCand = countCoeCand > 0 ? (totalCoeCand / countCoeCand) : 0.0;
    const sumaBruta = avgCoeCand * 10;
    const avgHT = countHT > 0 ? (totalHT / countHT) : 0.0;
    const avgHvle = countHvle > 0 ? (totalHvle / countHvle) : 0.0;

    // Calculations for Sanidad RP
    let s_totalHT = 0, s_countHT = 0;
    let s_totalHVLE = 0, s_countHVLE = 0;
    let s_totalHVLQ_low = 0, s_countHVLQ_low = 0;
    let s_totalHVLQ_high = 0, s_countHVLQ_high = 0;
    let s_totalHVLC = 0, s_countHVLC = 0;

    sanidadData.forEach(row => {
        if (row.ht !== "" && row.ht !== undefined && row.ht !== null) { s_totalHT += parseInt(row.ht); s_countHT++; }
        if (row.hvle !== "" && row.hvle !== undefined && row.hvle !== null) { s_totalHVLE += parseInt(row.hvle); s_countHVLE++; }
        if (row.hvlq_low !== "" && row.hvlq_low !== undefined && row.hvlq_low !== null) { s_totalHVLQ_low += parseInt(row.hvlq_low); s_countHVLQ_low++; }
        if (row.hvlq_high !== "" && row.hvlq_high !== undefined && row.hvlq_high !== null) { s_totalHVLQ_high += parseInt(row.hvlq_high); s_countHVLQ_high++; }
        if (row.hvlc !== "" && row.hvlc !== undefined && row.hvlc !== null) { s_totalHVLC += parseInt(row.hvlc); s_countHVLC++; }
    });

    const s_avgHT = s_countHT > 0 ? (s_totalHT / s_countHT) : 0.0;
    const s_avgHVLE = s_countHVLE > 0 ? (s_totalHVLE / s_countHVLE) : 0.0;
    const s_avgHVLQ_low = s_countHVLQ_low > 0 ? (s_totalHVLQ_low / s_countHVLQ_low) : 0.0;
    const s_avgHVLQ_high = s_countHVLQ_high > 0 ? (s_totalHVLQ_high / s_countHVLQ_high) : 0.0;
    const s_avgHVLC = s_countHVLC > 0 ? (s_totalHVLC / s_countHVLC) : 0.0;

    // Calculations for Sanidad S7
    let s7_totalHT = 0, s7_countHT = 0;
    let s7_totalHVLE = 0, s7_countHVLE = 0;
    let s7_totalHVLQ_low = 0, s7_countHVLQ_low = 0;
    let s7_totalHVLQ_high = 0, s7_countHVLQ_high = 0;
    let s7_totalHVLC = 0, s7_countHVLC = 0;

    sanidadS7Data.forEach(row => {
        if (row.ht !== "" && row.ht !== undefined && row.ht !== null) { s7_totalHT += parseInt(row.ht); s7_countHT++; }
        if (row.hvle !== "" && row.hvle !== undefined && row.hvle !== null) { s7_totalHVLE += parseInt(row.hvle); s7_countHVLE++; }
        if (row.hvlq_low !== "" && row.hvlq_low !== undefined && row.hvlq_low !== null) { s7_totalHVLQ_low += parseInt(row.hvlq_low); s7_countHVLQ_low++; }
        if (row.hvlq_high !== "" && row.hvlq_high !== undefined && row.hvlq_high !== null) { s7_totalHVLQ_high += parseInt(row.hvlq_high); s7_countHVLQ_high++; }
        if (row.hvlc !== "" && row.hvlc !== undefined && row.hvlc !== null) { s7_totalHVLC += parseInt(row.hvlc); s7_countHVLC++; }
    });

    const s7_avgHT = s7_countHT > 0 ? (s7_totalHT / s7_countHT) : 0.0;
    const s7_avgHVLE = s7_countHVLE > 0 ? (s7_totalHVLE / s7_countHVLE) : 0.0;
    const s7_avgHVLQ_low = s7_countHVLQ_low > 0 ? (s7_totalHVLQ_low / s7_countHVLQ_low) : 0.0;
    const s7_avgHVLQ_high = s7_countHVLQ_high > 0 ? (s7_totalHVLQ_high / s7_countHVLQ_high) : 0.0;
    const s7_avgHVLC = s7_countHVLC > 0 ? (s7_totalHVLC / s7_countHVLC) : 0.0;

    // Calculations for Sanidad S11
    let s11_totalHT = 0, s11_countHT = 0;
    let s11_totalHVLE = 0, s11_countHVLE = 0;
    let s11_totalHVLQ_low = 0, s11_countHVLQ_low = 0;
    let s11_totalHVLQ_high = 0, s11_countHVLQ_high = 0;
    let s11_totalHVLC = 0, s11_countHVLC = 0;

    sanidadS11Data.forEach(row => {
        if (row.ht !== "" && row.ht !== undefined && row.ht !== null) { s11_totalHT += parseInt(row.ht); s11_countHT++; }
        if (row.hvle !== "" && row.hvle !== undefined && row.hvle !== null) { s11_totalHVLE += parseInt(row.hvle); s11_countHVLE++; }
        if (row.hvlq_low !== "" && row.hvlq_low !== undefined && row.hvlq_low !== null) { s11_totalHVLQ_low += parseInt(row.hvlq_low); s11_countHVLQ_low++; }
        if (row.hvlq_high !== "" && row.hvlq_high !== undefined && row.hvlq_high !== null) { s11_totalHVLQ_high += parseInt(row.hvlq_high); s11_countHVLQ_high++; }
        if (row.hvlc !== "" && row.hvlc !== undefined && row.hvlc !== null) { s11_totalHVLC += parseInt(row.hvlc); s11_countHVLC++; }
    });

    const s11_avgHT = s11_countHT > 0 ? (s11_totalHT / s11_countHT) : 0.0;
    const s11_avgHVLE = s11_countHVLE > 0 ? (s11_totalHVLE / s11_countHVLE) : 0.0;
    const s11_avgHVLQ_low = s11_countHVLQ_low > 0 ? (s11_totalHVLQ_low / s11_countHVLQ_low) : 0.0;
    const s11_avgHVLQ_high = s11_countHVLQ_high > 0 ? (s11_totalHVLQ_high / s11_countHVLQ_high) : 0.0;
    const s11_avgHVLC = s11_countHVLC > 0 ? (s11_totalHVLC / s11_countHVLC) : 0.0;

    const station_id = document.getElementById("input-station-id").value || "DEMO-123";
    const finca = document.getElementById("input-finca").value;
    const lote = document.getElementById("input-lote").value;
    const evaluador = document.getElementById("input-evaluador").value;

    const newMuestreo = {
        id: "sb_" + Date.now(),
        station_id,
        finca,
        lote,
        evaluador,
        hojas_promedio: parseFloat(avgHT.toFixed(1)),
        hvle_promedio: parseFloat(avgHvle.toFixed(1)),
        suma_bruta_promedio: parseFloat(sumaBruta.toFixed(1)),
        detalles_json: {
            plants: plantData
        },
        parida_ht_promedio: parseFloat(s_avgHT.toFixed(1)),
        parida_hvle_promedio: parseFloat(s_avgHVLE.toFixed(1)),
        parida_hvlq_bajo_promedio: parseFloat(s_avgHVLQ_low.toFixed(1)),
        parida_hvlq_alto_promedio: parseFloat(s_avgHVLQ_high.toFixed(1)),
        parida_hvlc_promedio: parseFloat(s_avgHVLC.toFixed(1)),
        parida_detalles_json: {
            plants: sanidadData
        },
        s7_ht_promedio: parseFloat(s7_avgHT.toFixed(1)),
        s7_hvle_promedio: parseFloat(s7_avgHVLE.toFixed(1)),
        s7_hvlq_bajo_promedio: parseFloat(s7_avgHVLQ_low.toFixed(1)),
        s7_hvlq_alto_promedio: parseFloat(s7_avgHVLQ_high.toFixed(1)),
        s7_hvlc_promedio: parseFloat(s7_avgHVLC.toFixed(1)),
        s7_detalles_json: {
            plants: sanidadS7Data
        },
        s11_ht_promedio: parseFloat(s11_avgHT.toFixed(1)),
        s11_hvle_promedio: parseFloat(s11_avgHVLE.toFixed(1)),
        s11_hvlq_bajo_promedio: parseFloat(s11_avgHVLQ_low.toFixed(1)),
        s11_hvlq_alto_promedio: parseFloat(s11_avgHVLQ_high.toFixed(1)),
        s11_hvlc_promedio: parseFloat(s11_avgHVLC.toFixed(1)),
        s11_detalles_json: {
            plants: sanidadS11Data
        },
        created_at: new Date().toISOString(),
        synced: false
    };

    historyData.unshift(newMuestreo);
    saveHistoryToLocalStorage();

    alert("Muestreo guardado localmente con éxito.");

    // Reset UI Grid
    initBlankGrid();
    initBlankSanidadGrid();

    // Switch view to History tab
    switchView('historial', document.querySelectorAll(".tab-btn")[2]);
    
    if (isOnline) {
        autoSyncUnsynced();
    }
}

// Local Storage Helpers
function loadHistory() {
    const raw = localStorage.getItem("rafiqui_suma_bruta_history");
    if (raw) {
        historyData = JSON.parse(raw);
    } else {
        historyData = [];
    }
}

function loadApplications() {
    const raw = localStorage.getItem("rafiqui_product_applications");
    if (raw) {
        applicationsData = JSON.parse(raw);
    } else {
        applicationsData = [];
    }
}

function saveApplications() {
    localStorage.setItem("rafiqui_product_applications", JSON.stringify(applicationsData));
}

function addProductApplication() {
    const dateInput = document.getElementById("app-date");
    const productInput = document.getElementById("app-product");
    
    if (!dateInput || !productInput || !dateInput.value || !productInput.value.trim()) {
        return;
    }
    
    const newApp = {
        id: "app_" + Date.now(),
        date: dateInput.value,
        product: productInput.value.trim()
    };
    
    applicationsData.push(newApp);
    applicationsData.sort((a, b) => new Date(b.date) - new Date(a.date));
    
    saveApplications();
    renderApplicationsList();
    
    productInput.value = "";
    renderTrendChart();
    renderSanidadTrendChart();
    renderSanidadS7TrendChart();
    renderSanidadS11TrendChart();
}

function deleteProductApplication(id) {
    if (confirm("¿Estás seguro de que deseas eliminar este registro de aplicación?")) {
        applicationsData = applicationsData.filter(app => app.id !== id);
        saveApplications();
        renderApplicationsList();
        renderTrendChart();
        renderSanidadTrendChart();
        renderSanidadS7TrendChart();
        renderSanidadS11TrendChart();
    }
}

function renderApplicationsList() {
    const container = document.getElementById("applications-list-container");
    if (!container) return;
    
    container.innerHTML = "";
    
    if (applicationsData.length === 0) {
        container.innerHTML = `<div style="text-align: center; color: var(--text-dim); font-size: 0.75rem; padding: 10px 0;">No hay aplicaciones registradas.</div>`;
        return;
    }
    
    applicationsData.forEach(app => {
        const dateParts = app.date.split("-");
        const formattedDate = dateParts.length === 3 ? `${dateParts[2]}/${dateParts[1]}/${dateParts[0]}` : app.date;
        
        const item = document.createElement("div");
        item.className = "application-item";
        item.innerHTML = `
            <div class="app-item-info">
                <span class="app-item-prod">${app.product}</span>
                <span class="app-item-date">${formattedDate}</span>
            </div>
            <button class="btn-delete-app" onclick="deleteProductApplication('${app.id}')" title="Eliminar">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                    <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
                </svg>
            </button>
        `;
        container.appendChild(item);
    });
}

function saveHistoryToLocalStorage() {
    localStorage.setItem("rafiqui_suma_bruta_history", JSON.stringify(historyData));
}

// Render the historical list view
function renderHistoryList() {
    const container = document.getElementById("history-container");
    container.innerHTML = "";

    if (historyData.length === 0) {
        container.innerHTML = `
            <div style="text-align: center; color: var(--text-dim); padding-top: 40px;">
                <p>No tienes muestreos guardados.</p>
                <p style="font-size: 0.8rem; margin-top: 10px;">Los muestreos que realices en el campo aparecerán aquí.</p>
            </div>
        `;
        return;
    }

    historyData.forEach((item, index) => {
        const dateStr = new Date(item.created_at).toLocaleString();
        
        let statusClass = "low";
        if (item.suma_bruta_promedio >= 500 && item.suma_bruta_promedio <= 800) {
            statusClass = "mid";
        } else if (item.suma_bruta_promedio > 800) {
            statusClass = "high";
        }

        const card = document.createElement("div");
        card.className = "history-card";
        card.onclick = () => openDetailsModal(index);
        card.innerHTML = `
            <div class="hist-info">
                <h4>${item.lote}</h4>
                <p>${item.finca} • ${item.evaluador}</p>
                <p style="font-size: 0.7rem; margin-top: 4px;">${dateStr}</p>
            </div>
            <div class="hist-right">
                <div class="hist-val ${statusClass}">${item.suma_bruta_promedio.toFixed(1)}</div>
                <div class="sync-dot ${item.synced ? 'synced' : ''}" title="${item.synced ? 'Sincronizado en Supabase' : 'Guardado solo en celular'}"></div>
            </div>
        `;
        container.appendChild(card);
    });
}

// Details Modal view of a completed sampling V2
function openDetailsModal(index) {
    currentDetailIndex = index;
    const item = historyData[index];

    document.getElementById("modal-lote-title").innerText = `${item.finca} - ${item.lote}`;
    document.getElementById("modal-date").innerText = `Fecha: ${new Date(item.created_at).toLocaleString()} | Evaluador: ${item.evaluador}`;
    
    const sbValEl = document.getElementById("modal-sb-val");
    sbValEl.innerText = item.suma_bruta_promedio.toFixed(1);

    const kpiCard = document.getElementById("modal-kpi-card");
    const statusEl = document.getElementById("modal-status");
    
    kpiCard.className = "summary-kpi";
    if (item.suma_bruta_promedio < 500) {
        kpiCard.classList.add("low");
        statusEl.innerText = "Baja Presión";
        statusEl.style.color = "var(--green)";
    } else if (item.suma_bruta_promedio >= 500 && item.suma_bruta_promedio <= 800) {
        kpiCard.classList.add("mid");
        statusEl.innerText = "Alerta Media";
        statusEl.style.color = "var(--yellow)";
    } else {
        kpiCard.classList.add("high");
        statusEl.innerText = "Alerta Crítica";
        statusEl.style.color = "var(--red)";
    }

    // Populate Details Table V2
    const tableContainer = document.getElementById("modal-details-table");
    tableContainer.innerHTML = `
        <div class="table-header-grid" style="padding: 0;">
            <div>Pl.</div>
            <div>EE</div>
            <div>COE</div>
            <div>Cand.</div>
            <div>COE-Cand.</div>
            <div>HT</div>
            <div>H+VLE</div>
        </div>
    `;

    const plants = item.detalles_json.plants;
    plants.forEach(p => {
        const row = document.createElement("div");
        row.className = "table-row-grid";
        row.style.padding = "6px";
        row.style.background = "none";

        row.innerHTML = `
            <div class="plant-num">${p.num}</div>
            <div class="input-cell" style="background:none; border:none; color:inherit; padding:2px 0;">${p.ee || '-'}</div>
            <div class="input-cell" style="background:none; border:none; color:inherit; padding:2px 0;">${p.coe || '-'}</div>
            <div class="input-cell candela" style="background:none; border:none; color:inherit; padding:2px 0;">${p.candela || '-'}</div>
            <div class="input-cell" style="background:none; border:none; color:inherit; padding:2px 0;">${p.coe_cand !== "" && p.coe_cand !== undefined ? p.coe_cand.toFixed(1) : '-'}</div>
            <div class="input-cell" style="background:none; border:none; color:inherit; padding:2px 0;">${p.ht || '-'}</div>
            <div class="input-cell" style="background:none; border:none; color:inherit; padding:2px 0;">${p.hvle || '-'}</div>
        `;
        tableContainer.appendChild(row);
    });

    // Populate Sanidad details if available
    const sanidadTableContainer = document.getElementById("modal-sanidad-table");
    const sanidadTitle = document.getElementById("modal-sanidad-title");

    if (item.parida_detalles_json && item.parida_detalles_json.plants) {
        sanidadTitle.style.display = "block";
        sanidadTableContainer.style.display = "flex";
        sanidadTableContainer.style.flexDirection = "column";
        
        sanidadTableContainer.innerHTML = `
            <div class="table-header-grid" style="grid-template-columns: 0.6fr repeat(5, 1fr); padding: 0; font-size: 0.68rem;">
                <div>Pl.</div>
                <div>HT</div>
                <div>H+VLE</div>
                <div>H+VLQ&lt;5%</div>
                <div>H+VLQ&gt;5%</div>
                <div>H+VLC</div>
            </div>
        `;

        const sPlants = item.parida_detalles_json.plants;
        sPlants.forEach(p => {
            const row = document.createElement("div");
            row.className = "table-row-grid";
            row.style.gridTemplateColumns = "0.6fr repeat(5, 1fr)";
            row.style.padding = "6px";
            row.style.background = "none";

            row.innerHTML = `
                <div class="plant-num">${p.num}</div>
                <div class="input-cell" style="background:none; border:none; color:inherit; padding:2px 0;">${p.ht !== "" && p.ht !== undefined ? p.ht : '-'}</div>
                <div class="input-cell" style="background:none; border:none; color:inherit; padding:2px 0;">${p.hvle !== "" && p.hvle !== undefined ? p.hvle : '-'}</div>
                <div class="input-cell" style="background:none; border:none; color:inherit; padding:2px 0;">${p.hvlq_low !== "" && p.hvlq_low !== undefined ? p.hvlq_low : '-'}</div>
                <div class="input-cell" style="background:none; border:none; color:inherit; padding:2px 0;">${p.hvlq_high !== "" && p.hvlq_high !== undefined ? p.hvlq_high : '-'}</div>
                <div class="input-cell" style="background:none; border:none; color:inherit; padding:2px 0;">${p.hvlc !== "" && p.hvlc !== undefined ? p.hvlc : '-'}</div>
            `;
            sanidadTableContainer.appendChild(row);
        });

        // Also add a summary average row for Sanidad in modal
        const summaryRow = document.createElement("div");
        summaryRow.style.display = "grid";
        summaryRow.style.gridTemplateColumns = "0.6fr repeat(5, 1fr)";
        summaryRow.style.fontWeight = "bold";
        summaryRow.style.fontSize = "0.72rem";
        summaryRow.style.borderTop = "1.5px solid var(--border-glass)";
        summaryRow.style.paddingTop = "6px";
        summaryRow.style.marginTop = "4px";
        summaryRow.style.textAlign = "center";
        summaryRow.innerHTML = `
            <div style="text-align: left; padding-left: 2px;">Prom.</div>
            <div>${item.parida_ht_promedio !== undefined ? item.parida_ht_promedio.toFixed(1) : '-'}</div>
            <div>${item.parida_hvle_promedio !== undefined ? item.parida_hvle_promedio.toFixed(1) : '-'}</div>
            <div>${item.parida_hvlq_bajo_promedio !== undefined ? item.parida_hvlq_bajo_promedio.toFixed(1) : '-'}</div>
            <div>${item.parida_hvlq_alto_promedio !== undefined ? item.parida_hvlq_alto_promedio.toFixed(1) : '-'}</div>
            <div>${item.parida_hvlc_promedio !== undefined ? item.parida_hvlc_promedio.toFixed(1) : '-'}</div>
        `;
        sanidadTableContainer.appendChild(summaryRow);

    } else {
        sanidadTitle.style.display = "none";
        sanidadTableContainer.style.display = "none";
    }

    // Populate Sanidad S7 details if available
    const sanidadS7TableContainer = document.getElementById("modal-sanidad-s7-table");
    const sanidadS7Title = document.getElementById("modal-sanidad-s7-title");

    if (item.s7_detalles_json && item.s7_detalles_json.plants) {
        sanidadS7Title.style.display = "block";
        sanidadS7TableContainer.style.display = "flex";
        sanidadS7TableContainer.style.flexDirection = "column";
        
        sanidadS7TableContainer.innerHTML = `
            <div class="table-header-grid" style="grid-template-columns: 0.6fr repeat(5, 1fr); padding: 0; font-size: 0.68rem;">
                <div>Pl.</div>
                <div>HT</div>
                <div>H+VLE</div>
                <div>H+VLQ&lt;5%</div>
                <div>H+VLQ&gt;5%</div>
                <div>H+VLC</div>
            </div>
        `;

        const s7Plants = item.s7_detalles_json.plants;
        s7Plants.forEach(p => {
            const row = document.createElement("div");
            row.className = "table-row-grid";
            row.style.gridTemplateColumns = "0.6fr repeat(5, 1fr)";
            row.style.padding = "6px";
            row.style.background = "none";

            row.innerHTML = `
                <div class="plant-num">${p.num}</div>
                <div class="input-cell" style="background:none; border:none; color:inherit; padding:2px 0;">${p.ht !== "" && p.ht !== undefined ? p.ht : '-'}</div>
                <div class="input-cell" style="background:none; border:none; color:inherit; padding:2px 0;">${p.hvle !== "" && p.hvle !== undefined ? p.hvle : '-'}</div>
                <div class="input-cell" style="background:none; border:none; color:inherit; padding:2px 0;">${p.hvlq_low !== "" && p.hvlq_low !== undefined ? p.hvlq_low : '-'}</div>
                <div class="input-cell" style="background:none; border:none; color:inherit; padding:2px 0;">${p.hvlq_high !== "" && p.hvlq_high !== undefined ? p.hvlq_high : '-'}</div>
                <div class="input-cell" style="background:none; border:none; color:inherit; padding:2px 0;">${p.hvlc !== "" && p.hvlc !== undefined ? p.hvlc : '-'}</div>
            `;
            sanidadS7TableContainer.appendChild(row);
        });

        // Also add a summary average row for Sanidad S7 in modal
        const summaryRowS7 = document.createElement("div");
        summaryRowS7.style.display = "grid";
        summaryRowS7.style.gridTemplateColumns = "0.6fr repeat(5, 1fr)";
        summaryRowS7.style.fontWeight = "bold";
        summaryRowS7.style.fontSize = "0.72rem";
        summaryRowS7.style.borderTop = "1.5px solid var(--border-glass)";
        summaryRowS7.style.paddingTop = "6px";
        summaryRowS7.style.marginTop = "4px";
        summaryRowS7.style.textAlign = "center";
        summaryRowS7.innerHTML = `
            <div style="text-align: left; padding-left: 2px;">Prom.</div>
            <div>${item.s7_ht_promedio !== undefined ? item.s7_ht_promedio.toFixed(1) : '-'}</div>
            <div>${item.s7_hvle_promedio !== undefined ? item.s7_hvle_promedio.toFixed(1) : '-'}</div>
            <div>${item.s7_hvlq_bajo_promedio !== undefined ? item.s7_hvlq_bajo_promedio.toFixed(1) : '-'}</div>
            <div>${item.s7_hvlq_alto_promedio !== undefined ? item.s7_hvlq_alto_promedio.toFixed(1) : '-'}</div>
            <div>${item.s7_hvlc_promedio !== undefined ? item.s7_hvlc_promedio.toFixed(1) : '-'}</div>
        `;
        sanidadS7TableContainer.appendChild(summaryRowS7);

    } else {
        sanidadS7Title.style.display = "none";
        sanidadS7TableContainer.style.display = "none";
    }

    // Populate Sanidad S11 details if available
    const sanidadS11TableContainer = document.getElementById("modal-sanidad-s11-table");
    const sanidadS11Title = document.getElementById("modal-sanidad-s11-title");

    if (item.s11_detalles_json && item.s11_detalles_json.plants) {
        sanidadS11Title.style.display = "block";
        sanidadS11TableContainer.style.display = "flex";
        sanidadS11TableContainer.style.flexDirection = "column";
        
        sanidadS11TableContainer.innerHTML = `
            <div class="table-header-grid" style="grid-template-columns: 0.6fr repeat(5, 1fr); padding: 0; font-size: 0.68rem;">
                <div>Pl.</div>
                <div>HT</div>
                <div>H+VLE</div>
                <div>H+VLQ&lt;5%</div>
                <div>H+VLQ&gt;5%</div>
                <div>H+VLC</div>
            </div>
        `;

        const s11Plants = item.s11_detalles_json.plants;
        s11Plants.forEach(p => {
            const row = document.createElement("div");
            row.className = "table-row-grid";
            row.style.gridTemplateColumns = "0.6fr repeat(5, 1fr)";
            row.style.padding = "6px";
            row.style.background = "none";

            row.innerHTML = `
                <div class="plant-num">${p.num}</div>
                <div class="input-cell" style="background:none; border:none; color:inherit; padding:2px 0;">${p.ht !== "" && p.ht !== undefined ? p.ht : '-'}</div>
                <div class="input-cell" style="background:none; border:none; color:inherit; padding:2px 0;">${p.hvle !== "" && p.hvle !== undefined ? p.hvle : '-'}</div>
                <div class="input-cell" style="background:none; border:none; color:inherit; padding:2px 0;">${p.hvlq_low !== "" && p.hvlq_low !== undefined ? p.hvlq_low : '-'}</div>
                <div class="input-cell" style="background:none; border:none; color:inherit; padding:2px 0;">${p.hvlq_high !== "" && p.hvlq_high !== undefined ? p.hvlq_high : '-'}</div>
                <div class="input-cell" style="background:none; border:none; color:inherit; padding:2px 0;">${p.hvlc !== "" && p.hvlc !== undefined ? p.hvlc : '-'}</div>
            `;
            sanidadS11TableContainer.appendChild(row);
        });

        const summaryRowS11 = document.createElement("div");
        summaryRowS11.style.display = "grid";
        summaryRowS11.style.gridTemplateColumns = "0.6fr repeat(5, 1fr)";
        summaryRowS11.style.fontWeight = "bold";
        summaryRowS11.style.fontSize = "0.72rem";
        summaryRowS11.style.borderTop = "1.5px solid var(--border-glass)";
        summaryRowS11.style.paddingTop = "6px";
        summaryRowS11.style.marginTop = "4px";
        summaryRowS11.style.textAlign = "center";
        summaryRowS11.innerHTML = `
            <div style="text-align: left; padding-left: 2px;">Prom.</div>
            <div>${item.s11_ht_promedio !== undefined ? item.s11_ht_promedio.toFixed(1) : '-'}</div>
            <div>${item.s11_hvle_promedio !== undefined ? item.s11_hvle_promedio.toFixed(1) : '-'}</div>
            <div>${item.s11_hvlq_bajo_promedio !== undefined ? item.s11_hvlq_bajo_promedio.toFixed(1) : '-'}</div>
            <div>${item.s11_hvlq_alto_promedio !== undefined ? item.s11_hvlq_alto_promedio.toFixed(1) : '-'}</div>
            <div>${item.s11_hvlc_promedio !== undefined ? item.s11_hvlc_promedio.toFixed(1) : '-'}</div>
        `;
        sanidadS11TableContainer.appendChild(summaryRowS11);

    } else {
        sanidadS11Title.style.display = "none";
        sanidadS11TableContainer.style.display = "none";
    }

    document.getElementById("details-modal").style.display = "flex";
}

function closeDetailsModal(event) {
    if (event === null || event.target.id === "details-modal" || event.target.className === "sheet-close") {
        document.getElementById("details-modal").style.display = "none";
        currentDetailIndex = null;
    }
}

// Delete entry from history
function deleteCurrentMuestreo() {
    if (currentDetailIndex === null) return;
    
    if (confirm("¿Estás seguro de que deseas eliminar permanentemente este registro de muestreo de tu dispositivo?")) {
        historyData.splice(currentDetailIndex, 1);
        saveHistoryToLocalStorage();
        document.getElementById("details-modal").style.display = "none";
        renderHistoryList();
    }
}

// Render trend chart of Suma Bruta
function renderTrendChart() {
    const trendCanvas = document.getElementById("trend-chart");
    if (!trendCanvas) return;
    const ctx = trendCanvas.getContext("2d");
    
    const sortedData = [...historyData].reverse();

    const labels = sortedData.map(item => {
        const d = new Date(item.created_at);
        // Calculate ISO Week Number
        const tempDate = new Date(d.valueOf());
        const dayNum = (d.getDay() + 6) % 7;
        tempDate.setDate(tempDate.getDate() - dayNum + 3);
        const firstThursday = tempDate.valueOf();
        tempDate.setMonth(0, 1);
        if (tempDate.getDay() !== 4) {
            tempDate.setMonth(0, 1 + ((4 - tempDate.getDay()) + 7) % 7);
        }
        const weekNum = 1 + Math.ceil((firstThursday - tempDate) / 604800000);
        return `Sem. ${weekNum} (${item.lote})`;
    });
    
    const values = sortedData.map(item => item.suma_bruta_promedio);
    const htValues = sortedData.map(item => item.hojas_promedio !== undefined ? item.hojas_promedio : 0.0);
    const hvleValues = sortedData.map(item => item.hvle_promedio !== undefined ? item.hvle_promedio : 0.0);
    const candelaValues = sortedData.map(item => {
        if (item.detalles_json && item.detalles_json.plants) {
            const plants = item.detalles_json.plants;
            let sum = 0;
            let count = 0;
            plants.forEach(p => {
                if (p.candela !== "" && p.candela !== undefined && p.candela !== null) {
                    sum += parseFloat(p.candela);
                    count++;
                }
            });
            return count > 0 ? parseFloat((sum / count).toFixed(2)) : 0.0;
        }
        return 0.0;
    });

    const matchedProducts = sortedData.map(item => {
        if (!item.created_at) return null;
        const itemDateStr = item.created_at.substring(0, 10);
        const matches = applicationsData.filter(app => app.date === itemDateStr);
        return matches.length > 0 ? matches.map(m => m.product).join(", ") : null;
    });

    if (trendChartInstance) {
        trendChartInstance.destroy();
    }

    if (sortedData.length === 0) {
        trendChartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels: ['Sin Datos'],
                datasets: [{
                    label: 'Suma Bruta',
                    data: [0],
                    borderColor: 'rgba(255,255,255,0.1)',
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: { min: 0, max: 1000 }
                }
            }
        });
        return;
    }

    const appLinesPlugin = {
        id: 'appLines',
        afterDatasetsDraw(chart) {
            const { ctx, scales: { x, y } } = chart;
            ctx.save();
            
            const dataset = chart.data.datasets[0];
            if (!dataset || !dataset.matchedProducts) return;
            
            const meta = chart.getDatasetMeta(0);
            chart.data.labels.forEach((label, index) => {
                const product = dataset.matchedProducts[index];
                if (product) {
                    const point = meta.data[index];
                    if (point) {
                        ctx.beginPath();
                        ctx.strokeStyle = '#ffb300';
                        ctx.lineWidth = 1.2;
                        ctx.setLineDash([4, 4]);
                        ctx.moveTo(point.x, y.top);
                        ctx.lineTo(point.x, y.bottom);
                        ctx.stroke();
                        
                        ctx.fillStyle = '#ffb300';
                        ctx.beginPath();
                        ctx.arc(point.x, y.top + 8, 4, 0, 2 * Math.PI);
                        ctx.fill();
                        
                        ctx.fillStyle = '#ffb300';
                        ctx.font = 'bold 9px sans-serif';
                        ctx.textAlign = 'left';
                        ctx.fillText(` 💊 ${product}`, point.x + 5, y.top + 11);
                    }
                }
            });
            ctx.restore();
        }
    };

    const validValues = values.filter(v => typeof v === 'number' && !isNaN(v));
    const maxSB = validValues.length > 0 ? Math.max(...validValues) : 0;

    trendChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Suma Bruta V2',
                    data: values,
                    borderColor: '#00f2ff',
                    backgroundColor: 'rgba(0, 242, 255, 0.05)',
                    borderWidth: 3,
                    fill: true,
                    tension: 0.3,
                    pointBackgroundColor: '#00f2ff',
                    pointBorderColor: '#fff',
                    pointRadius: 5,
                    matchedProducts: matchedProducts,
                    yAxisID: 'y'
                },
                {
                    label: 'Hojas Totales (HT)',
                    data: htValues,
                    borderColor: '#b080ff',
                    backgroundColor: 'rgba(176, 128, 255, 0.08)',
                    borderWidth: 3,
                    fill: true,
                    tension: 0.3,
                    pointBackgroundColor: '#b080ff',
                    pointBorderColor: '#fff',
                    pointRadius: 5,
                    yAxisID: 'y1'
                },
                {
                    label: 'Hoja Vieja Libre (H+VLE)',
                    data: hvleValues,
                    borderColor: '#ff80df',
                    backgroundColor: 'rgba(255, 128, 223, 0.15)',
                    borderWidth: 3,
                    fill: true,
                    tension: 0.3,
                    pointBackgroundColor: '#ff80df',
                    pointBorderColor: '#fff',
                    pointRadius: 5,
                    yAxisID: 'y1'
                },
                {
                    label: 'Desarrollo Candela Promedio',
                    data: candelaValues,
                    borderColor: '#00ffaa',
                    backgroundColor: 'rgba(0, 255, 170, 0.08)',
                    borderWidth: 3,
                    fill: false,
                    tension: 0.3,
                    pointBackgroundColor: '#00ffaa',
                    pointBorderColor: '#fff',
                    pointRadius: 5,
                    yAxisID: 'y2'
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false
            },
            plugins: {
                legend: {
                    display: true,
                    labels: {
                        color: '#80809b',
                        boxWidth: 12,
                        font: {
                            size: 10
                        }
                    }
                },
                tooltip: {
                    callbacks: {
                        title: function(context) {
                            // Recover original precise date for tooltip title
                            const dataIndex = context[0].dataIndex;
                            const item = sortedData[dataIndex];
                            if (item && item.created_at) {
                                const d = new Date(item.created_at);
                                const day = String(d.getDate()).padStart(2, '0');
                                const month = String(d.getMonth() + 1).padStart(2, '0');
                                const year = d.getFullYear();
                                const hours = String(d.getHours()).padStart(2, '0');
                                const minutes = String(d.getMinutes()).padStart(2, '0');
                                return `${day}/${month}/${year} ${hours}:${minutes} (${item.lote})`;
                            }
                            return context[0].label;
                        },
                        afterBody: function(context) {
                            const index = context[0].dataIndex;
                            const chart = context[0].chart;
                            const product = chart.data.datasets[0].matchedProducts ? chart.data.datasets[0].matchedProducts[index] : null;
                            if (product) {
                                return `\n💊 Aplicado: ${product}`;
                            }
                            return '';
                        }
                    }
                }
            },
            onHover: (event, chartElements) => {
                if (chartElements && chartElements.length > 0) {
                    const dataIndex = chartElements[0].index;
                    // sortedData is [...historyData].reverse(), so the index mapping from chart to historyData is:
                    const historyIndex = historyData.length - 1 - dataIndex;
                    if (historyData[historyIndex]) {
                        updateReferenceTableForIndex(historyIndex);
                    }
                }
            },
            scales: {
                y: {
                    type: 'linear',
                    display: true,
                    position: 'left',
                    min: 0,
                    max: Math.max(1200, maxSB + 200),
                    grid: {
                        color: 'rgba(255, 255, 255, 0.05)'
                    },
                    ticks: {
                        color: '#00f2ff',
                        stepSize: 100,
                        autoSkip: false
                    },
                    title: {
                        display: true,
                        text: 'Suma Bruta Lote',
                        color: '#00f2ff',
                        font: { size: 10, weight: 'bold' }
                    }
                },
                y1: {
                    type: 'linear',
                    display: true,
                    position: 'right',
                    min: 0.0,
                    max: 20.0,
                    grid: {
                        drawOnChartArea: false
                    },
                    ticks: {
                        color: '#b080ff'
                    },
                    title: {
                        display: true,
                        text: 'Hojas Promedio',
                        color: '#b080ff',
                        font: { size: 10, weight: 'bold' }
                    }
                },
                y2: {
                    type: 'linear',
                    display: true,
                    position: 'right',
                    min: 0.0,
                    max: 1.0,
                    grid: {
                        drawOnChartArea: false
                    },
                    ticks: {
                        color: '#00ffaa'
                    },
                    title: {
                        display: true,
                        text: 'Desarrollo Candela',
                        color: '#00ffaa',
                        font: { size: 10, weight: 'bold' }
                    }
                },
                x: {
                    grid: {
                        display: false
                    },
                    ticks: {
                        color: '#80809b',
                        font: {
                            size: 10
                        }
                    }
                }
            }
        },
        plugins: [appLinesPlugin]
    });
}

// Render trend chart of Sanidad RP
function renderSanidadTrendChart() {
    const trendCanvas = document.getElementById("sanidad-trend-chart");
    if (!trendCanvas) return;
    const ctx = trendCanvas.getContext("2d");
    
    const sortedData = [...historyData].reverse();

    const labels = sortedData.map(item => {
        const d = new Date(item.created_at);
        // Calculate ISO Week Number
        const tempDate = new Date(d.valueOf());
        const dayNum = (d.getDay() + 6) % 7;
        tempDate.setDate(tempDate.getDate() - dayNum + 3);
        const firstThursday = tempDate.valueOf();
        tempDate.setMonth(0, 1);
        if (tempDate.getDay() !== 4) {
            tempDate.setMonth(0, 1 + ((4 - tempDate.getDay()) + 7) % 7);
        }
        const weekNum = 1 + Math.ceil((firstThursday - tempDate) / 604800000);
        return `Sem. ${weekNum} (${item.lote})`;
    });

    const htValues = sortedData.map(item => item.parida_ht_promedio !== undefined ? item.parida_ht_promedio : 0.0);
    const hvleValues = sortedData.map(item => item.parida_hvle_promedio !== undefined ? item.parida_hvle_promedio : 0.0);
    const hvlqLowValues = sortedData.map(item => item.parida_hvlq_bajo_promedio !== undefined ? item.parida_hvlq_bajo_promedio : 0.0);
    const hvlqHighValues = sortedData.map(item => item.parida_hvlq_alto_promedio !== undefined ? item.parida_hvlq_alto_promedio : 0.0);
    const hvlcValues = sortedData.map(item => item.parida_hvlc_promedio !== undefined ? item.parida_hvlc_promedio : 0.0);

    if (sanidadChartInstance) {
        sanidadChartInstance.destroy();
    }

    if (sortedData.length === 0) {
        sanidadChartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels: ['Sin Datos'],
                datasets: [{
                    label: 'Sanidad RP',
                    data: [0],
                    borderColor: 'rgba(255,255,255,0.1)',
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: { min: 0, max: 20 }
                }
            }
        });
        return;
    }

    sanidadChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'HT RP',
                    data: htValues,
                    borderColor: '#00f2ff',
                    backgroundColor: 'rgba(0, 242, 255, 0.05)',
                    borderWidth: 2,
                    tension: 0.3,
                    pointRadius: 4,
                    fill: false
                },
                {
                    label: 'H+VLE RP',
                    data: hvleValues,
                    borderColor: '#b080ff',
                    backgroundColor: 'rgba(176, 128, 255, 0.05)',
                    borderWidth: 2,
                    tension: 0.3,
                    pointRadius: 4,
                    fill: false
                },
                {
                    label: 'H+VLQ <5% RP',
                    data: hvlqLowValues,
                    borderColor: '#ffb300',
                    backgroundColor: 'rgba(255, 179, 0, 0.05)',
                    borderWidth: 2,
                    tension: 0.3,
                    pointRadius: 4,
                    fill: false
                },
                {
                    label: 'H+VLQ >5% RP',
                    data: hvlqHighValues,
                    borderColor: '#ff4d4d',
                    backgroundColor: 'rgba(255, 77, 77, 0.05)',
                    borderWidth: 2,
                    tension: 0.3,
                    pointRadius: 4,
                    fill: false
                },
                {
                    label: 'H+VLC RP',
                    data: hvlcValues,
                    borderColor: '#00ffaa',
                    backgroundColor: 'rgba(0, 255, 170, 0.05)',
                    borderWidth: 2,
                    tension: 0.3,
                    pointRadius: 4,
                    fill: false
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false
            },
            plugins: {
                legend: {
                    display: true,
                    labels: {
                        color: '#80809b',
                        boxWidth: 8,
                        font: { size: 9 }
                    }
                }
            },
            scales: {
                y: {
                    type: 'linear',
                    display: true,
                    min: 0,
                    max: 20,
                    grid: {
                        color: 'rgba(255, 255, 255, 0.05)'
                    },
                    ticks: {
                        color: '#80809b'
                    },
                    title: {
                        display: true,
                        text: 'Promedio Hojas RP',
                        color: '#80809b',
                        font: { size: 10, weight: 'bold' }
                    }
                },
                x: {
                    grid: {
                        display: false
                    },
                    ticks: {
                        color: '#80809b',
                        font: { size: 10 }
                    }
                }
            }
        }
    });
}

// Render trend chart of Sanidad S7
function renderSanidadS7TrendChart() {
    const trendCanvas = document.getElementById("sanidad-s7-trend-chart");
    if (!trendCanvas) return;
    const ctx = trendCanvas.getContext("2d");
    
    const sortedData = [...historyData].reverse();

    const labels = sortedData.map(item => {
        const d = new Date(item.created_at);
        // Calculate ISO Week Number
        const tempDate = new Date(d.valueOf());
        const dayNum = (d.getDay() + 6) % 7;
        tempDate.setDate(tempDate.getDate() - dayNum + 3);
        const firstThursday = tempDate.valueOf();
        tempDate.setMonth(0, 1);
        if (tempDate.getDay() !== 4) {
            tempDate.setMonth(0, 1 + ((4 - tempDate.getDay()) + 7) % 7);
        }
        const weekNum = 1 + Math.ceil((firstThursday - tempDate) / 604800000);
        return `Sem. ${weekNum} (${item.lote})`;
    });

    const htValues = sortedData.map(item => item.s7_ht_promedio !== undefined ? item.s7_ht_promedio : 0.0);
    const hvleValues = sortedData.map(item => item.s7_hvle_promedio !== undefined ? item.s7_hvle_promedio : 0.0);
    const hvlqLowValues = sortedData.map(item => item.s7_hvlq_bajo_promedio !== undefined ? item.s7_hvlq_bajo_promedio : 0.0);
    const hvlqHighValues = sortedData.map(item => item.s7_hvlq_alto_promedio !== undefined ? item.s7_hvlq_alto_promedio : 0.0);
    const hvlcValues = sortedData.map(item => item.s7_hvlc_promedio !== undefined ? item.s7_hvlc_promedio : 0.0);

    if (sanidadS7ChartInstance) {
        sanidadS7ChartInstance.destroy();
    }

    if (sortedData.length === 0) {
        sanidadS7ChartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels: ['Sin Datos'],
                datasets: [{
                    label: 'Sanidad S7',
                    data: [0],
                    borderColor: 'rgba(255,255,255,0.1)',
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: { min: 0, max: 20 }
                }
            }
        });
        return;
    }

    sanidadS7ChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'HT S7',
                    data: htValues,
                    borderColor: '#00f2ff',
                    backgroundColor: 'rgba(0, 242, 255, 0.05)',
                    borderWidth: 2,
                    tension: 0.3,
                    pointRadius: 4,
                    fill: false
                },
                {
                    label: 'H+VLE S7',
                    data: hvleValues,
                    borderColor: '#b080ff',
                    backgroundColor: 'rgba(176, 128, 255, 0.05)',
                    borderWidth: 2,
                    tension: 0.3,
                    pointRadius: 4,
                    fill: false
                },
                {
                    label: 'H+VLQ <5% S7',
                    data: hvlqLowValues,
                    borderColor: '#ffb300',
                    backgroundColor: 'rgba(255, 179, 0, 0.05)',
                    borderWidth: 2,
                    tension: 0.3,
                    pointRadius: 4,
                    fill: false
                },
                {
                    label: 'H+VLQ >5% S7',
                    data: hvlqHighValues,
                    borderColor: '#ff4d4d',
                    backgroundColor: 'rgba(255, 77, 77, 0.05)',
                    borderWidth: 2,
                    tension: 0.3,
                    pointRadius: 4,
                    fill: false
                },
                {
                    label: 'H+VLC S7',
                    data: hvlcValues,
                    borderColor: '#00ffaa',
                    backgroundColor: 'rgba(0, 255, 170, 0.05)',
                    borderWidth: 2,
                    tension: 0.3,
                    pointRadius: 4,
                    fill: false
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false
            },
            plugins: {
                legend: {
                    display: true,
                    labels: {
                        color: '#80809b',
                        boxWidth: 8,
                        font: { size: 9 }
                    }
                }
            },
            scales: {
                y: {
                    type: 'linear',
                    display: true,
                    min: 0,
                    max: 20,
                    grid: {
                        color: 'rgba(255, 255, 255, 0.05)'
                    },
                    ticks: {
                        color: '#80809b'
                    },
                    title: {
                        display: true,
                        text: 'Promedio Hojas S7',
                        color: '#80809b',
                        font: { size: 10, weight: 'bold' }
                    }
                },
                x: {
                    grid: {
                        display: false
                    },
                    ticks: {
                        color: '#80809b',
                        font: { size: 10 }
                    }
                }
            }
        }
    });
}

// Render trend chart of Sanidad S11
function renderSanidadS11TrendChart() {
    const trendCanvas = document.getElementById("sanidad-s11-trend-chart");
    if (!trendCanvas) return;
    const ctx = trendCanvas.getContext("2d");
    
    const sortedData = [...historyData].reverse();

    const labels = sortedData.map(item => {
        const d = new Date(item.created_at);
        const tempDate = new Date(d.valueOf());
        const dayNum = (d.getDay() + 6) % 7;
        tempDate.setDate(tempDate.getDate() - dayNum + 3);
        const firstThursday = tempDate.valueOf();
        tempDate.setMonth(0, 1);
        if (tempDate.getDay() !== 4) {
            tempDate.setMonth(0, 1 + ((4 - tempDate.getDay()) + 7) % 7);
        }
        const weekNum = 1 + Math.ceil((firstThursday - tempDate) / 604800000);
        return `Sem. ${weekNum} (${item.lote})`;
    });

    const htValues = sortedData.map(item => item.s11_ht_promedio !== undefined ? item.s11_ht_promedio : 0.0);
    const hvleValues = sortedData.map(item => item.s11_hvle_promedio !== undefined ? item.s11_hvle_promedio : 0.0);
    const hvlqLowValues = sortedData.map(item => item.s11_hvlq_bajo_promedio !== undefined ? item.s11_hvlq_bajo_promedio : 0.0);
    const hvlqHighValues = sortedData.map(item => item.s11_hvlq_alto_promedio !== undefined ? item.s11_hvlq_alto_promedio : 0.0);
    const hvlcValues = sortedData.map(item => item.s11_hvlc_promedio !== undefined ? item.s11_hvlc_promedio : 0.0);

    if (sanidadS11ChartInstance) {
        sanidadS11ChartInstance.destroy();
    }

    if (sortedData.length === 0) {
        sanidadS11ChartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels: ['Sin Datos'],
                datasets: [{
                    label: 'Sanidad S11',
                    data: [0],
                    borderColor: 'rgba(255,255,255,0.1)',
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: { min: 0, max: 20 }
                }
            }
        });
        return;
    }

    sanidadS11ChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'HT S11',
                    data: htValues,
                    borderColor: '#00f2ff',
                    backgroundColor: 'rgba(0, 242, 255, 0.05)',
                    borderWidth: 2,
                    tension: 0.3,
                    pointRadius: 4,
                    fill: false
                },
                {
                    label: 'H+VLE S11',
                    data: hvleValues,
                    borderColor: '#b080ff',
                    backgroundColor: 'rgba(176, 128, 255, 0.05)',
                    borderWidth: 2,
                    tension: 0.3,
                    pointRadius: 4,
                    fill: false
                },
                {
                    label: 'H+VLQ <5% S11',
                    data: hvlqLowValues,
                    borderColor: '#ffb300',
                    backgroundColor: 'rgba(255, 179, 0, 0.05)',
                    borderWidth: 2,
                    tension: 0.3,
                    pointRadius: 4,
                    fill: false
                },
                {
                    label: 'H+VLQ >5% S11',
                    data: hvlqHighValues,
                    borderColor: '#ff4d4d',
                    backgroundColor: 'rgba(255, 77, 77, 0.05)',
                    borderWidth: 2,
                    tension: 0.3,
                    pointRadius: 4,
                    fill: false
                },
                {
                    label: 'H+VLC S11',
                    data: hvlcValues,
                    borderColor: '#00ffaa',
                    backgroundColor: 'rgba(0, 255, 170, 0.05)',
                    borderWidth: 2,
                    tension: 0.3,
                    pointRadius: 4,
                    fill: false
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false
            },
            plugins: {
                legend: {
                    display: true,
                    labels: {
                        color: '#80809b',
                        boxWidth: 8,
                        font: { size: 9 }
                    }
                }
            },
            scales: {
                y: {
                    type: 'linear',
                    display: true,
                    min: 0,
                    max: 20,
                    grid: {
                        color: 'rgba(255, 255, 255, 0.05)'
                    },
                    ticks: {
                        color: '#80809b'
                    },
                    title: {
                        display: true,
                        text: 'Promedio Hojas S11',
                        color: '#80809b',
                        font: { size: 10, weight: 'bold' }
                    }
                },
                x: {
                    grid: {
                        display: false
                    },
                    ticks: {
                        color: '#80809b',
                        font: { size: 10 }
                    }
                }
            }
        }
    });
}

// Manual Sync trigger
function triggerManualSync() {
    if (!isOnline) {
        alert("No tienes conexión a Internet en este momento. Revisa tu señal e inténtalo de nuevo.");
        return;
    }
    
    const unsyncedCount = historyData.filter(item => !item.synced).length;
    if (unsyncedCount === 0) {
        alert("Todos los muestreos ya están sincronizados con la nube de Supabase.");
        return;
    }

    autoSyncUnsynced(true);
}

// Synchronization loop with Supabase
// Tabla 1: rafiqui_suma_bruta → Solo datos de Suma Bruta
// Tabla 2: rafiqui_sanidad_foliar → Sanidad RP, S7, S11 (con columna etapa)
async function autoSyncUnsynced(showUserAlerts = false) {
    if (!isOnline) return;

    const unsyncedItems = historyData.filter(item => !item.synced);
    if (unsyncedItems.length === 0) return;

    const badge = document.getElementById("sync-status");
    const text = document.getElementById("sync-status-text");

    badge.style.opacity = "0.6";
    text.innerText = "Sincronizando...";

    let successCount = 0;
    
    for (let item of unsyncedItems) {
        try {
            let allOk = true;

            // ── INSERT 1: Suma Bruta (tabla propia, limpia) ──
            const sbData = {
                station_id: item.station_id,
                finca: item.finca,
                lote: item.lote,
                evaluador: item.evaluador,
                hojas_promedio: item.hojas_promedio,
                suma_bruta_promedio: item.suma_bruta_promedio,
                detalles_json: item.detalles_json,
                created_at: item.created_at
            };

            const { error: sbError } = await supabaseClient.from("rafiqui_suma_bruta").insert(sbData);
            if (sbError) {
                console.error("Supabase insert error (suma_bruta):", sbError);
                allOk = false;
            }

            // ── INSERT 2: Sanidad Recién Parida (etapa RP) ──
            if (allOk && item.parida_ht_promedio && item.parida_ht_promedio > 0) {
                const rpData = {
                    station_id: item.station_id,
                    finca: item.finca,
                    lote: item.lote,
                    evaluador: item.evaluador,
                    etapa: "RP",
                    ht_promedio: item.parida_ht_promedio,
                    hvle_promedio: item.parida_hvle_promedio,
                    hvlq_bajo_promedio: item.parida_hvlq_bajo_promedio,
                    hvlq_alto_promedio: item.parida_hvlq_alto_promedio,
                    hvlc_promedio: item.parida_hvlc_promedio,
                    detalles_json: item.parida_detalles_json || {},
                    created_at: item.created_at
                };
                const { error: rpError } = await supabaseClient.from("rafiqui_sanidad_foliar").insert(rpData);
                if (rpError) {
                    console.error("Supabase insert error (sanidad RP):", rpError);
                    allOk = false;
                }
            }

            // ── INSERT 3: Sanidad Semana 7 (etapa S7) ──
            if (allOk && item.s7_ht_promedio && item.s7_ht_promedio > 0) {
                const s7Data = {
                    station_id: item.station_id,
                    finca: item.finca,
                    lote: item.lote,
                    evaluador: item.evaluador,
                    etapa: "S7",
                    ht_promedio: item.s7_ht_promedio,
                    hvle_promedio: item.s7_hvle_promedio,
                    hvlq_bajo_promedio: item.s7_hvlq_bajo_promedio,
                    hvlq_alto_promedio: item.s7_hvlq_alto_promedio,
                    hvlc_promedio: item.s7_hvlc_promedio,
                    detalles_json: item.s7_detalles_json || {},
                    created_at: item.created_at
                };
                const { error: s7Error } = await supabaseClient.from("rafiqui_sanidad_foliar").insert(s7Data);
                if (s7Error) {
                    console.error("Supabase insert error (sanidad S7):", s7Error);
                    allOk = false;
                }
            }

            // ── INSERT 4: Sanidad Semana 11 (etapa S11) ──
            if (allOk && item.s11_ht_promedio && item.s11_ht_promedio > 0) {
                const s11Data = {
                    station_id: item.station_id,
                    finca: item.finca,
                    lote: item.lote,
                    evaluador: item.evaluador,
                    etapa: "S11",
                    ht_promedio: item.s11_ht_promedio,
                    hvle_promedio: item.s11_hvle_promedio,
                    hvlq_bajo_promedio: item.s11_hvlq_bajo_promedio,
                    hvlq_alto_promedio: item.s11_hvlq_alto_promedio,
                    hvlc_promedio: item.s11_hvlc_promedio,
                    detalles_json: item.s11_detalles_json || {},
                    created_at: item.created_at
                };
                const { error: s11Error } = await supabaseClient.from("rafiqui_sanidad_foliar").insert(s11Data);
                if (s11Error) {
                    console.error("Supabase insert error (sanidad S11):", s11Error);
                    allOk = false;
                }
            }

            // Solo marcar como sincronizado si todo salió bien
            if (allOk) {
                item.synced = true;
                successCount++;
            }
        } catch (e) {
            console.error("Sync catch error:", e);
        }
    }

    saveHistoryToLocalStorage();
    updateNetworkStatus();
    badge.style.opacity = "1.0";

    if (document.getElementById("view-historial").classList.contains("active")) {
        renderHistoryList();
    }

    if (successCount > 0 && showUserAlerts) {
        alert(`¡Sincronización completa! Se subieron ${successCount} registros a la nube.`);
    }
}

// ── EXPORT AND SHARE FUNCTIONS ──

// Downloads a chart as a PNG image
function downloadChartAsImage(canvasId, filename) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    
    try {
        const imageURI = canvas.toDataURL("image/png");
        const link = document.createElement("a");
        link.download = `${filename}_${Date.now()}.png`;
        link.href = imageURI;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    } catch (err) {
        console.error("Error al descargar la imagen del gráfico:", err);
        alert("No se pudo descargar la imagen en este navegador.");
    }
}

// Shares a chart as a PNG image via native share (WhatsApp, etc.)
async function shareChartAsImage(canvasId, filename) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    
    try {
        canvas.toBlob(async (blob) => {
            if (!blob) {
                downloadChartAsImage(canvasId, filename);
                return;
            }
            const file = new File([blob], `${filename}.png`, { type: "image/png" });
            
            if (navigator.canShare && navigator.canShare({ files: [file] })) {
                await navigator.share({
                    files: [file],
                    title: `Gráfico ${filename}`,
                    text: `Comparto la gráfica de campo de Rafiqui.`
                });
            } else {
                downloadChartAsImage(canvasId, filename);
                alert("La compartición directa no está disponible. El gráfico se ha descargado a tu dispositivo.");
            }
        }, "image/png");
    } catch (err) {
        console.error("Error al compartir imagen:", err);
        downloadChartAsImage(canvasId, filename);
    }
}

// Generates a professional PDF Report with metadata, KPIs, charts, and calculations table
async function generatePDFReport() {
    const finca = document.getElementById("input-finca").value || "Sin Finca";
    const lote = document.getElementById("input-lote").value || "Sin Lote";
    const evaluador = document.getElementById("input-evaluador").value || "Sin Evaluador";
    const reportDate = new Date().toLocaleDateString("es-ES", {
        year: 'numeric', month: 'long', day: 'numeric',
        hour: '2-digit', minute: '2-digit'
    });

    const avgSB = document.getElementById("avg-sb-value").innerText || "0.0";
    const leavesText = document.getElementById("leaves-average-text").innerText || "";
    
    let avgHT = "0.0";
    let avgHvle = "0.0";
    let avgCandela = "0.00";
    
    if (leavesText.includes("Hojas Prom:")) {
        const parts = leavesText.split("|");
        avgHT = parts[0].replace("Hojas Prom:", "").trim();
        avgHvle = parts[1].replace("H+VLE Prom:", "").trim();
        avgCandela = parts[2].replace("Candela Prom:", "").trim();
    }

    let trendImg = "", rpImg = "", s7Img = "", s11Img = "";
    try {
        const trendCanvas = document.getElementById("trend-chart");
        if (trendCanvas) trendImg = trendCanvas.toDataURL("image/png");
        
        const rpCanvas = document.getElementById("sanidad-trend-chart");
        if (rpCanvas) rpImg = rpCanvas.toDataURL("image/png");
        
        const s7Canvas = document.getElementById("sanidad-s7-trend-chart");
        if (s7Canvas) s7Img = s7Canvas.toDataURL("image/png");
        
        const s11Canvas = document.getElementById("sanidad-s11-trend-chart");
        if (s11Canvas) s11Img = s11Canvas.toDataURL("image/png");
    } catch (err) {
        console.error("Error al convertir gráficos a imágenes:", err);
    }

    const referenceTable = document.getElementById("calc-reference-table-body");
    let tableRowsHTML = "";
    if (referenceTable && referenceTable.children.length > 0) {
        const rows = referenceTable.children;
        for (let r of rows) {
            const cells = r.children;
            if (cells.length === 7) {
                tableRowsHTML += `
                    <tr style="border-bottom: 1px solid #dee2e6;">
                        <td style="padding: 8px; border: 1px solid #dee2e6; font-weight: bold; background: #fdfdfd;">${cells[0].innerText}</td>
                        <td style="padding: 8px; border: 1px solid #dee2e6;">${cells[1].innerText}</td>
                        <td style="padding: 8px; border: 1px solid #dee2e6;">${cells[2].innerText}</td>
                        <td style="padding: 8px; border: 1px solid #dee2e6;">${cells[3].innerText}</td>
                        <td style="padding: 8px; border: 1px solid #dee2e6;">${cells[4].innerText}</td>
                        <td style="padding: 8px; border: 1px solid #dee2e6;">${cells[5].innerText}</td>
                        <td style="padding: 8px; border: 1px solid #dee2e6;">${cells[6].innerText}</td>
                    </tr>
                `;
            }
        }
    } else {
        tableRowsHTML = `<tr><td colspan="7" style="padding: 12px; color: #888;">No hay muestreos recientes cargados en la tabla de cálculos.</td></tr>`;
    }

    // Create a 1x1 hidden wrapper that stays inside the DOM visible coordinates to prevent blank rendering in html2canvas
    const pdfWrapper = document.createElement("div");
    pdfWrapper.id = "pdf-wrapper-container";
    pdfWrapper.style.position = "fixed";
    pdfWrapper.style.left = "0";
    pdfWrapper.style.top = "0";
    pdfWrapper.style.width = "1px";
    pdfWrapper.style.height = "1px";
    pdfWrapper.style.overflow = "hidden";
    pdfWrapper.style.zIndex = "-9999";
    pdfWrapper.style.pointerEvents = "none";

    const reportContainer = document.createElement("div");
    reportContainer.id = "pdf-report-container";
    reportContainer.style.width = "750px";
    reportContainer.style.background = "#ffffff";
    reportContainer.style.color = "#212529";
    reportContainer.style.position = "relative";
    reportContainer.style.left = "0";
    reportContainer.style.top = "0";

    reportContainer.innerHTML = `
        <div style="padding: 30px; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; color: #212529; background: #ffffff; line-height: 1.5;">
            <div style="border-bottom: 3px solid #00f2ff; padding-bottom: 15px; margin-bottom: 25px; display: flex; justify-content: space-between; align-items: center;">
                <div>
                    <h1 style="margin: 0; font-size: 1.8rem; color: #0b0b1a; font-weight: 800; letter-spacing: -0.5px;">RAFIQUI <span style="color: #00bcd4;">PRO</span></h1>
                    <p style="margin: 3px 0 0 0; font-size: 0.82rem; color: #6c757d;">Sistema Inteligente de Monitoreo de Sigatoka Negra</p>
                </div>
                <div style="text-align: right;">
                    <span style="font-size: 0.85rem; font-weight: 700; background: #e0f7fa; color: #006064; padding: 6px 12px; border-radius: 6px; text-transform: uppercase; letter-spacing: 0.5px;">Reporte Ejecutivo</span>
                </div>
            </div>
            
            <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin-bottom: 25px; background: #f8f9fa; padding: 15px; border-radius: 10px; font-size: 0.92rem; border: 1px solid #e9ecef;">
                <div><strong>🚜 Finca:</strong> ${finca}</div>
                <div><strong>📍 Lote:</strong> ${lote}</div>
                <div><strong>👨‍🌾 Evaluador:</strong> ${evaluador}</div>
                <div><strong>📅 Generación:</strong> ${reportDate}</div>
            </div>
            
            <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 30px; text-align: center;">
                <div style="background: #e0f7fa; padding: 12px; border-radius: 8px; border: 1px solid #b2ebf2; box-shadow: 0 2px 4px rgba(0,96,100,0.04);">
                    <div style="font-size: 0.72rem; color: #006064; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;">Suma Bruta Prom</div>
                    <div style="font-size: 1.5rem; font-weight: 800; color: #006064; margin-top: 5px;">${avgSB}</div>
                </div>
                <div style="background: #f3e5f5; padding: 12px; border-radius: 8px; border: 1px solid #e1bee7; box-shadow: 0 2px 4px rgba(74,20,140,0.04);">
                    <div style="font-size: 0.72rem; color: #4a148c; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;">Hojas Prom</div>
                    <div style="font-size: 1.5rem; font-weight: 800; color: #4a148c; margin-top: 5px;">${avgHT}</div>
                </div>
                <div style="background: #fce4ec; padding: 12px; border-radius: 8px; border: 1px solid #f8bbd0; box-shadow: 0 2px 4px rgba(136,14,79,0.04);">
                    <div style="font-size: 0.72rem; color: #880e4f; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;">H+VLE Prom</div>
                    <div style="font-size: 1.5rem; font-weight: 800; color: #880e4f; margin-top: 5px;">${avgHvle}</div>
                </div>
                <div style="background: #e8f5e9; padding: 12px; border-radius: 8px; border: 1px solid #c8e6c9; box-shadow: 0 2px 4px rgba(27,94,32,0.04);">
                    <div style="font-size: 0.72rem; color: #1b5e20; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;">Candela Prom</div>
                    <div style="font-size: 1.5rem; font-weight: 800; color: #1b5e20; margin-top: 5px;">${avgCandela}</div>
                </div>
            </div>
            
            <h2 style="font-size: 1.15rem; border-bottom: 2px solid #e9ecef; padding-bottom: 6px; margin-bottom: 15px; color: #343a40; font-weight: 700;">Gráficas de Tendencia Histórica</h2>
            
            <div style="display: flex; flex-direction: column; gap: 25px;">
                ${trendImg ? `
                <div style="border: 1px solid #dee2e6; padding: 15px; border-radius: 8px; background: #fafafa;">
                    <div style="font-size: 0.85rem; font-weight: 700; color: #495057; margin-bottom: 10px;">📊 1. Evolución de la Suma Bruta y Hojas en el Lote</div>
                    <img src="${trendImg}" style="width: 100%; height: auto; max-height: 280px; display: block; margin: 0 auto; border-radius: 4px;" />
                </div>
                ` : ''}

                ${rpImg ? `
                <div style="border: 1px solid #dee2e6; padding: 15px; border-radius: 8px; background: #fafafa; page-break-before: always;">
                    <div style="font-size: 0.85rem; font-weight: 700; color: #495057; margin-bottom: 10px;">📊 2. Evolución de la Sanidad Foliar (Recién Parida)</div>
                    <img src="${rpImg}" style="width: 100%; height: auto; max-height: 240px; display: block; margin: 0 auto; border-radius: 4px;" />
                </div>
                ` : ''}

                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
                    ${s7Img ? `
                    <div style="border: 1px solid #dee2e6; padding: 10px; border-radius: 8px; background: #fafafa;">
                        <div style="font-size: 0.78rem; font-weight: 700; color: #495057; margin-bottom: 8px;">📊 3. Sanidad Semana 7</div>
                        <img src="${s7Img}" style="width: 100%; height: auto; max-height: 180px; display: block; margin: 0 auto; border-radius: 4px;" />
                    </div>
                    ` : ''}
                    
                    ${s11Img ? `
                    <div style="border: 1px solid #dee2e6; padding: 10px; border-radius: 8px; background: #fafafa;">
                        <div style="font-size: 0.78rem; font-weight: 700; color: #495057; margin-bottom: 8px;">📊 4. Sanidad Semana 11</div>
                        <img src="${s11Img}" style="width: 100%; height: auto; max-height: 180px; display: block; margin: 0 auto; border-radius: 4px;" />
                    </div>
                    ` : ''}
                </div>
            </div>

            <h2 style="font-size: 1.15rem; border-bottom: 2px solid #e9ecef; padding-bottom: 6px; margin-top: 30px; margin-bottom: 15px; color: #343a40; font-weight: 700; page-break-before: always;">Detalle de Cálculos por Planta (Lote Activo)</h2>
            
            <table style="width: 100%; border-collapse: collapse; font-size: 0.82rem; text-align: center; border: 1px solid #dee2e6;">
                <thead>
                    <tr style="background: #f1f3f5; font-weight: bold; border-bottom: 2px solid #dee2e6; color: #495057;">
                        <th style="padding: 10px; border: 1px solid #dee2e6;">Planta</th>
                        <th style="padding: 10px; border: 1px solid #dee2e6;">EE</th>
                        <th style="padding: 10px; border: 1px solid #dee2e6;">COE</th>
                        <th style="padding: 10px; border: 1px solid #dee2e6;">Candela</th>
                        <th style="padding: 10px; border: 1px solid #dee2e6;">COE-Candela</th>
                        <th style="padding: 10px; border: 1px solid #dee2e6;">HT</th>
                        <th style="padding: 10px; border: 1px solid #dee2e6;">H+VLE</th>
                    </tr>
                </thead>
                <tbody>
                    ${tableRowsHTML}
                </tbody>
            </table>
            
            <div style="margin-top: 40px; text-align: center; font-size: 0.75rem; color: #868e96; border-top: 1px solid #e9ecef; padding-top: 15px;">
                Este reporte técnico fue generado electrónicamente desde la aplicación móvil de <strong>Rafiqui Pro</strong>.
            </div>
        </div>
    `;

    pdfWrapper.appendChild(reportContainer);
    document.body.appendChild(pdfWrapper);

    const opt = {
        margin:       [10, 10, 10, 10],
        filename:     `Reporte_Suma_Bruta_${lote.replace(/\s+/g, '_')}_${Date.now()}.pdf`,
        image:        { type: 'jpeg', quality: 0.98 },
        html2canvas:  { scale: 2, useCORS: true, logging: false },
        jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' }
    };

    try {
        const pdfWorker = html2pdf().from(reportContainer).set(opt);
        
        if (navigator.canShare && typeof File !== 'undefined') {
            const pdfBlob = await pdfWorker.output('blob');
            const file = new File([pdfBlob], opt.filename, { type: 'application/pdf' });
            
            if (navigator.canShare({ files: [file] })) {
                await navigator.share({
                    files: [file],
                    title: `Reporte Muestreo Lote ${lote}`,
                    text: `Comparto el reporte ejecutivo de monitoreo de Suma Bruta de la finca ${finca}.`
                });
            } else {
                await pdfWorker.save();
            }
        } else {
            await pdfWorker.save();
        }
    } catch (error) {
        console.error("Error al generar o compartir el reporte PDF:", error);
        alert("Ocurrió un error al generar el reporte PDF. Se disparará la descarga clásica.");
        try {
            await html2pdf().from(reportContainer).set(opt).save();
        } catch (e) {
            console.error("Fallback save failed too:", e);
        }
    } finally {
        if (pdfWrapper.parentNode) {
            document.body.removeChild(pdfWrapper);
        }
    }
}
