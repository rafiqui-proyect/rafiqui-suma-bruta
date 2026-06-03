/* ==========================================
   LOGIC ENGINE: MUESTREO SIGATOKA NEGRA
   Progressive Web App Logic
   Persistence: Offline-First / Supabase Sync
   ========================================== */

// Supabase Init
const SUPABASE_URL = "https://pknnmsslbfjmnsxteylf.supabase.co";
const SUPABASE_KEY = "sb_publishable_d4L3CpfSvcMdDUeYGAEChg_7kJgWlxV";
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// Coefficient matrix: Estadio + Densidad
const COEFFICIENTS = {
    '0': 0.0,
    '1-': 1.0,
    '1+': 2.0,
    '2-': 3.0,
    '2+': 4.0,
    '3-': 5.0,
    '3+': 6.0,
    '4-': 10.0,
    '4+': 15.0,
    '5-': 20.0,
    '5+': 30.0
};

// State Variables
let plantData = [];
let activeCell = null; // { plantIndex, col }
let isOnline = false;
let historyData = [];
let trendChartInstance = null;
let currentDetailIndex = null; // For modal view/delete

// Config Defaults
const TOTAL_PLANTS = 10;
const cols = ['h2', 'h3', 'h4', 'candela'];

// Initialization
document.addEventListener("DOMContentLoaded", () => {
    // Set Client ID from localStorage or default
    const client_id = localStorage.getItem('rafiqui_client_id') || "DEMO-123";
    document.getElementById("input-station-id").value = client_id;

    // Load History from localStorage
    loadHistory();

    // Check Network Connection
    updateNetworkStatus();
    window.addEventListener('online', updateNetworkStatus);
    window.addEventListener('offline', updateNetworkStatus);

    // Initialize Blank Grid
    initBlankGrid();

    // Load Charts tab if selected
    renderTrendChart();
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

// Generate the 10 rows in the data entry table
function initBlankGrid() {
    const container = document.getElementById("plant-rows-container");
    container.innerHTML = "";
    plantData = [];

    for (let i = 0; i < TOTAL_PLANTS; i++) {
        plantData.push({
            num: i + 1,
            h2: "",
            h3: "",
            h4: "",
            candela: "",
            sb: 0.0
        });

        const row = document.createElement("div");
        row.className = "table-row-grid";
        row.id = `plant-row-${i}`;
        row.innerHTML = `
            <div class="plant-num">${i + 1}</div>
            <div class="input-cell" id="cell-${i}-h2" onclick="openLeafKeypad(${i}, 'h2')">-</div>
            <div class="input-cell" id="cell-${i}-h3" onclick="openLeafKeypad(${i}, 'h3')">-</div>
            <div class="input-cell" id="cell-${i}-h4" onclick="openLeafKeypad(${i}, 'h4')">-</div>
            <div class="input-cell candela" id="cell-${i}-candela" onclick="openCandelaKeypad(${i}, 'candela')">-</div>
            <div class="sb-cell" id="sb-${i}">0.0</div>
        `;
        container.appendChild(row);
    }
    
    calculateTotals();
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
    } else if (viewName === 'historial') {
        renderHistoryList();
    }
}

// Keypad Actions: Leaf Symptoms (II, III, IV)
function openLeafKeypad(plantIndex, col) {
    // Clear active selections
    clearActiveHighlight();
    
    activeCell = { plantIndex, col };
    
    // Highlight Row and Cell
    document.getElementById(`plant-row-${plantIndex}`).classList.add("active-row");
    document.getElementById(`cell-${plantIndex}-${col}`).classList.add("active-cell");

    // Update bottom sheet title
    const leafName = col === 'h2' ? 'Hoja II' : col === 'h3' ? 'Hoja III' : 'Hoja IV';
    document.getElementById("leaf-keypad-title").innerText = `Planta ${plantIndex + 1} - ${leafName}`;
    
    // Open sheet
    document.getElementById("leaf-keypad-sheet").classList.add("open");
    document.getElementById("candela-keypad-sheet").classList.remove("open");
}

// Keypad Actions: Candela (Brun Scale)
function openCandelaKeypad(plantIndex, col) {
    clearActiveHighlight();
    
    activeCell = { plantIndex, col };
    
    document.getElementById(`plant-row-${plantIndex}`).classList.add("active-row");
    document.getElementById(`cell-${plantIndex}-${col}`).classList.add("active-cell");

    document.getElementById("candela-keypad-title").innerText = `Planta ${plantIndex + 1} - Estado Cigarro`;
    
    document.getElementById("candela-keypad-sheet").classList.add("open");
    document.getElementById("leaf-keypad-sheet").classList.remove("open");
}

function closeKeypad() {
    clearActiveHighlight();
    document.getElementById("leaf-keypad-sheet").classList.remove("open");
    document.getElementById("candela-keypad-sheet").classList.remove("open");
    activeCell = null;
}

function clearActiveHighlight() {
    document.querySelectorAll(".table-row-grid").forEach(row => row.classList.remove("active-row"));
    document.querySelectorAll(".input-cell").forEach(cell => cell.classList.remove("active-cell"));
}

// Handle symptom input
function inputSymptom(val) {
    if (!activeCell) return;
    
    const { plantIndex, col } = activeCell;
    plantData[plantIndex][col] = val;

    // Update Cell Text and Class
    const cellEl = document.getElementById(`cell-${plantIndex}-${col}`);
    cellEl.innerText = val;
    cellEl.classList.add("has-val");

    // Calculate Suma Bruta for Row
    calculateRowSB(plantIndex);

    // Auto Advance logic
    autoAdvance();
}

// Handle candela input
function inputCandela(val) {
    if (!activeCell) return;
    
    const { plantIndex, col } = activeCell;
    plantData[plantIndex][col] = val;

    const cellEl = document.getElementById(`cell-${plantIndex}-${col}`);
    cellEl.innerText = val;
    cellEl.classList.add("has-val");

    // Update total calculation (this doesn't affect SB but is saved)
    calculateTotals();

    autoAdvance();
}

// Automatic advance to the next field
function autoAdvance() {
    if (!activeCell) return;
    const { plantIndex, col } = activeCell;
    const currentColIndex = cols.indexOf(col);

    if (currentColIndex < cols.length - 1) {
        // Advance to next column on same plant
        const nextColName = cols[currentColIndex + 1];
        if (nextColName === 'candela') {
            openCandelaKeypad(plantIndex, nextColName);
        } else {
            openLeafKeypad(plantIndex, nextColName);
        }
    } else {
        // Last column of row, advance to next plant row
        if (plantIndex < TOTAL_PLANTS - 1) {
            openLeafKeypad(plantIndex + 1, cols[0]);
        } else {
            // End of grid
            closeKeypad();
        }
    }
}

// Calculate Suma Bruta of a single row
function calculateRowSB(plantIndex) {
    const row = plantData[plantIndex];
    let sum = 0.0;
    
    // Add leaf II, III, IV if they have values
    ['h2', 'h3', 'h4'].forEach(col => {
        const val = row[col];
        if (val && COEFFICIENTS[val] !== undefined) {
            sum += COEFFICIENTS[val];
        }
    });

    row.sb = sum;

    // Update Row SB UI
    const sbCell = document.getElementById(`sb-${plantIndex}`);
    sbCell.innerText = sum.toFixed(1);

    // Apply color thresholds to row cell
    sbCell.className = "sb-cell";
    if (sum >= 5.0 && sum <= 8.0) {
        sbCell.classList.add("mid");
    } else if (sum > 8.0) {
        sbCell.classList.add("high");
    }

    calculateTotals();
}

// Calculate average Suma Bruta and Candela average of the entire batch
function calculateTotals() {
    let totalSB = 0.0;
    let validSBPlants = 0;
    let totalCandela = 0.0;
    let validCandelaPlants = 0;

    plantData.forEach(row => {
        // Suma Bruta calculation
        const hasH2 = row.h2 !== "";
        const hasH3 = row.h3 !== "";
        const hasH4 = row.h4 !== "";
        if (hasH2 || hasH3 || hasH4) {
            totalSB += row.sb;
            validSBPlants++;
        }

        // Candela average calculation
        if (row.candela !== "") {
            totalCandela += parseFloat(row.candela);
            validCandelaPlants++;
        }
    });

    const avgSB = validSBPlants > 0 ? (totalSB / validSBPlants) : 0.0;
    const avgCandela = validCandelaPlants > 0 ? (totalCandela / validCandelaPlants) : 0.0;

    // Update main GUI KPIs
    const avgSBEl = document.getElementById("avg-sb-value");
    avgSBEl.innerText = avgSB.toFixed(1);

    document.getElementById("leaves-average-text").innerText = `Hojas Candela Prom: ${avgCandela.toFixed(2)}`;

    // Update color theme of summary card based on SB thresholds
    const summaryCard = document.getElementById("sb-summary-card");
    const statusBadge = document.getElementById("sb-status-badge");
    
    summaryCard.className = "summary-kpi";
    if (avgSB < 5.0) {
        summaryCard.classList.add("low");
        statusBadge.innerText = "Baja Presión";
        statusBadge.style.color = "var(--green)";
        statusBadge.style.background = "rgba(0, 255, 170, 0.15)";
    } else if (avgSB >= 5.0 && avgSB <= 8.0) {
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
}

// Save current grid to local storage
function saveCurrentMuestreo() {
    // Validate that at least some data is filled
    let hasData = false;
    for (let row of plantData) {
        if (row.h2 !== "" || row.h3 !== "" || row.h4 !== "" || row.candela !== "") {
            hasData = true;
            break;
        }
    }

    if (!hasData) {
        alert("Por favor introduce datos de al menos una planta antes de guardar.");
        return;
    }

    // Verify if all plants are complete. Warn if incomplete.
    let incomplete = false;
    for (let row of plantData) {
        if (row.h2 === "" || row.h3 === "" || row.h4 === "" || row.candela === "") {
            incomplete = true;
            break;
        }
    }

    if (incomplete) {
        if (!confirm("Hay plantas con datos incompletos. ¿Deseas guardar de todos modos?")) {
            return;
        }
    }

    // Calculate totals one final time
    calculateTotals();
    
    let totalSB = 0.0;
    let validSBPlants = 0;
    let totalCandela = 0.0;
    let validCandelaPlants = 0;

    plantData.forEach(row => {
        if (row.h2 !== "" || row.h3 !== "" || row.h4 !== "") {
            totalSB += row.sb;
            validSBPlants++;
        }
        if (row.candela !== "") {
            totalCandela += parseFloat(row.candela);
            validCandelaPlants++;
        }
    });

    const avgSB = validSBPlants > 0 ? (totalSB / validSBPlants) : 0.0;
    const avgCandela = validCandelaPlants > 0 ? (totalCandela / validCandelaPlants) : 0.0;

    // Construct Muestreo Object
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
        hojas_promedio: parseFloat(avgCandela.toFixed(2)),
        suma_bruta_promedio: parseFloat(avgSB.toFixed(2)),
        detalles_json: {
            plants: plantData
        },
        created_at: new Date().toISOString(),
        synced: false
    };

    // Save to history list
    historyData.unshift(newMuestreo);
    saveHistoryToLocalStorage();

    alert("Muestreo guardado localmente con éxito.");

    // Reset UI Grid
    initBlankGrid();

    // Switch view to History to show item
    switchView('historial', document.querySelectorAll(".tab-btn")[1]);
    
    // Auto-sync if online
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
        if (item.suma_bruta_promedio >= 5.0 && item.suma_bruta_promedio <= 8.0) {
            statusClass = "mid";
        } else if (item.suma_bruta_promedio > 8.0) {
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

// Details Modal view of a completed sampling
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
    if (item.suma_bruta_promedio < 5.0) {
        kpiCard.classList.add("low");
        statusEl.innerText = "Baja Presión";
        statusEl.style.color = "var(--green)";
    } else if (item.suma_bruta_promedio >= 5.0 && item.suma_bruta_promedio <= 8.0) {
        kpiCard.classList.add("mid");
        statusEl.innerText = "Alerta Media";
        statusEl.style.color = "var(--yellow)";
    } else {
        kpiCard.classList.add("high");
        statusEl.innerText = "Alerta Crítica";
        statusEl.style.color = "var(--red)";
    }

    // Populate Details Table
    const tableContainer = document.getElementById("modal-details-table");
    tableContainer.innerHTML = `
        <div class="table-header-grid" style="padding: 0;">
            <div>Pl.</div>
            <div>H. II</div>
            <div>H. III</div>
            <div>H. IV</div>
            <div>Cand.</div>
            <div>SB</div>
        </div>
    `;

    const plants = item.detalles_json.plants;
    plants.forEach(p => {
        const row = document.createElement("div");
        row.className = "table-row-grid";
        row.style.padding = "6px";
        row.style.background = "none";
        
        let rowStatusClass = "";
        if (p.sb >= 5.0 && p.sb <= 8.0) {
            rowStatusClass = "mid";
        } else if (p.sb > 8.0) {
            rowStatusClass = "high";
        }

        row.innerHTML = `
            <div class="plant-num">${p.num}</div>
            <div>${p.h2 || '-'}</div>
            <div>${p.h3 || '-'}</div>
            <div>${p.h4 || '-'}</div>
            <div>${p.candela || '-'}</div>
            <div class="sb-cell ${rowStatusClass}">${p.sb.toFixed(1)}</div>
        `;
        tableContainer.appendChild(row);
    });

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
    const ctx = document.getElementById("trend-chart").getContext("2d");
    
    // Sort data chronologically for graphing (historyData is newest first, so we reverse it)
    const sortedData = [...historyData].reverse();

    // Filter data by lote to show clean trends (optional, but let's graph everything in order with lote labels)
    const labels = sortedData.map(item => {
        const d = new Date(item.created_at);
        return `${d.getDate()}/${d.getMonth()+1} (${item.lote})`;
    });
    
    const values = sortedData.map(item => item.suma_bruta_promedio);

    if (trendChartInstance) {
        trendChartInstance.destroy();
    }

    // Default empty chart helper
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
                    y: { min: 0, max: 15 }
                }
            }
        });
        return;
    }

    trendChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Suma Bruta Promedio',
                    data: values,
                    borderColor: '#00f2ff',
                    backgroundColor: 'rgba(0, 242, 255, 0.05)',
                    borderWidth: 3,
                    fill: true,
                    tension: 0.3,
                    pointBackgroundColor: '#00f2ff',
                    pointBorderColor: '#fff',
                    pointRadius: 5
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                }
            },
            scales: {
                y: {
                    min: 0,
                    max: Math.max(12, Math.max(...values) + 2),
                    grid: {
                        color: 'rgba(255, 255, 255, 0.05)'
                    },
                    ticks: {
                        color: '#80809b'
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
            const dataToInsert = {
                station_id: item.station_id,
                finca: item.finca,
                lote: item.lote,
                evaluador: item.evaluador,
                hojas_promedio: item.hojas_promedio,
                suma_bruta_promedio: item.suma_bruta_promedio,
                detalles_json: item.detalles_json,
                created_at: item.created_at
            };

            // Insert into Supabase table 'rafiqui_suma_bruta'
            const { error } = await supabaseClient.from("rafiqui_suma_bruta").insert(dataToInsert);
            
            if (!error) {
                item.synced = true;
                successCount++;
            } else {
                console.error("Supabase insert error:", error);
            }
        } catch (e) {
            console.error("Sync catch error:", e);
        }
    }

    // Save updated sync statuses locally
    saveHistoryToLocalStorage();
    updateNetworkStatus();
    badge.style.opacity = "1.0";

    // Refresh history view if active
    if (document.getElementById("view-historial").classList.contains("active")) {
        renderHistoryList();
    }

    if (successCount > 0 && showUserAlerts) {
        alert(`¡Sincronización completa! Se subieron ${successCount} registros a la nube.`);
    }
}
