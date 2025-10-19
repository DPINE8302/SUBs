
declare const maplibregl: any;

// --- CONSTANTS ---
const SNAP_THRESHOLD = 15; // pixels
const ROUTE_COLORS = ['#007AFF', '#FF3B30', '#34C759', '#FFD60A', '#AF52DE', '#FF9500'];
const DEPTH_COST_COLORS = ['#D3C0FF', '#B388FF', '#9575CD', '#7E57C2', '#673AB7', '#512DA8', '#311B92'];
const STATION_BUILD_COST = 25_000_000;
const WALK_SPEED_MPS = 1.4; // Average walking speed


// --- TYPE DEFINITIONS ---
type Mode = 'none' | 'draw-track' | 'place-station' | 'delete' | 'set-origin' | 'set-destination';
type LeftPanelMode = 'construction' | 'journey-planner' | 'route-details' | 'demand-details';
type TrackCount = 'single' | 'parallel' | 'quad';
type BuildMethod = 'cut-and-cover' | 'tbm';
type JourneyLeg = { lineId: string | number; fromStationId: string | number; toStationId: string | number; rideTime: number };
type JourneyRoute = { legs: JourneyLeg[]; totalTime: number; waitTime: number; rideTime: number; };

type Feature<T> = { type: 'Feature'; geometry: T; properties: any; id?: number | string };
type LineString = { type: 'LineString'; coordinates: number[][] };
type Point = { type: 'Point'; coordinates: number[] };
type FeatureCollection<T> = { type: 'FeatureCollection'; features: Feature<T>[] };

// --- STATE ---
let map: any;
let simulationWorker: Worker;
let mode: Mode = 'none';
let leftPanelMode: LeftPanelMode = 'construction';
let nextLineId = 1;
let nextStationId = 1;
let isPlaying = false;

// Construction State
let trackCount: TrackCount = 'single';
let elevation = 0; // meters
let buildMethod: BuildMethod = 'cut-and-cover';

// Data State
const lines: FeatureCollection<LineString> = { type: 'FeatureCollection', features: [] };
const stations: FeatureCollection<Point> = { type: 'FeatureCollection', features: [] };
const trains: FeatureCollection<Point> = { type: 'FeatureCollection', features: [] };
let stationRidership: { [key: string]: number } = {};
let lineRidership: { [key: string]: number } = {};

// UI Interaction State
let drawingLinePoints: number[][] = [];
let hoveredStationId: string | null = null;
let lastStationQueues: { [key: string]: number } = {};
let selectedLineId: number | string | null = null;
let selectedDemandPointCoords: number[] | null = null;

// Journey Planner State
let journeyOrigin: Point | null = null;
let journeyDestination: Point | null = null;
let journeyResult: { walkToStationTime: number; walkFromStationTime: number, route: JourneyRoute } | null = null;

// --- DOM ELEMENTS ---
const uiContainer = document.getElementById('ui-container');
let leftPanelContainer: HTMLDivElement;
let buildTrackBtn: HTMLButtonElement, buildStationBtn: HTMLButtonElement, deleteBtn: HTMLButtonElement;
let undoPointBtn: HTMLButtonElement;
let drawingControls: HTMLDivElement;
let tracksToggle: HTMLInputElement, stationsToggle: HTMLInputElement, trainsToggle: HTMLInputElement, depthToggle: HTMLInputElement, demandToggle: HTMLInputElement;
let costDisplay: HTMLSpanElement;
let playBtn: HTMLButtonElement, pauseBtn: HTMLButtonElement;
let apiConfigModal: HTMLDivElement;
let trainsCountDisplay: HTMLSpanElement;
let timeDisplay: HTMLSpanElement;
let ridershipDisplay: HTMLSpanElement;
let budgetDisplay: HTMLSpanElement, cashflowDisplay: HTMLSpanElement, waitTimeDisplay: HTMLSpanElement;
let constructionPanel: HTMLDivElement, journeyPlannerPanel: HTMLDivElement, routeDetailsPanel: HTMLDivElement, demandDetailsPanel: HTMLDivElement;
let constructionBtn: HTMLButtonElement, plannerBtn: HTMLButtonElement, analyticsBtn: HTMLButtonElement;


// --- HELPERS ---
function formatCurrency(value: number) {
    if (Math.abs(value) >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`;
    if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
    if (Math.abs(value) >= 1_000) return `$${(value / 1_000).toFixed(0)}k`;
    return `$${Math.round(value)}`;
}

function formatCashflow(value: number) {
    const sign = value >= 0 ? '+' : '-';
    return `${sign}${formatCurrency(Math.abs(value))}/hr`;
}

function formatNumber(value: number) {
    return new Intl.NumberFormat('en-US').format(value);
}

function formatTime(seconds: number): string {
    if (seconds < 60) return `${Math.round(seconds)}s`;
    const minutes = Math.floor(seconds / 60);
    return `${minutes}m`;
}

function turfDistance(from: number[], to: number[]): number {
    const R = 6371; // Radius of the Earth in km
    const dLat = (to[1] - from[1]) * Math.PI / 180;
    const dLon = (to[0] - from[0]) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(from[1] * Math.PI / 180) * Math.cos(to[1] * Math.PI / 180) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c * 1000; // distance in meters
}

function updateDataSource(sourceId: string, data: any) {
    if (!map || !map.getSource(sourceId)) return;
    map.getSource(sourceId).setData(data);
}


// --- LOGIC ---
function calculateCost() {
    if(drawingLinePoints.length < 2) return 0;

    let totalDistance = 0;
    for (let i = 0; i < drawingLinePoints.length - 1; i++) {
        totalDistance += turfDistance(drawingLinePoints[i], drawingLinePoints[i + 1]);
    }

    const depthMultiplier = 1 + (Math.abs(elevation) / 40) * 2; // Heavier penalty for depth
    const methodMultiplier = buildMethod === 'tbm' ? 1.8 : 1.0;
    const trackCountMultiplier = trackCount === 'single' ? 1.0 : (trackCount === 'parallel' ? 1.9 : 3.5);
    const baseCostPerMeter = 5000; // Base cost in dollars per meter

    const totalCost = totalDistance * baseCostPerMeter * depthMultiplier * methodMultiplier * trackCountMultiplier;
    return totalCost;
}

function updateCostDisplay() {
    const cost = calculateCost();
    costDisplay.textContent = `Est. Cost: ${formatCurrency(cost)}`;
}

function updateSimulationNetwork() {
    simulationWorker.postMessage({
        type: 'UPDATE_NETWORK',
        payload: {
            lines: lines.features,
            stations: stations.features,
        }
    });
}

function updateDrawingUIState() {
    if (undoPointBtn) {
        undoPointBtn.disabled = drawingLinePoints.length < 1;
    }
}

// --- UI EVENT HANDLERS ---

function setLeftPanelMode(newMode: LeftPanelMode) {
    leftPanelMode = newMode;
    constructionPanel.style.display = leftPanelMode === 'construction' ? 'block' : 'none';
    journeyPlannerPanel.style.display = leftPanelMode === 'journey-planner' ? 'block' : 'none';
    routeDetailsPanel.style.display = leftPanelMode === 'route-details' ? 'block' : 'none';
    demandDetailsPanel.style.display = leftPanelMode === 'demand-details' ? 'block' : 'none';

    constructionBtn.classList.toggle('active', leftPanelMode === 'construction');
    plannerBtn.classList.toggle('active', leftPanelMode === 'journey-planner');
    analyticsBtn.classList.toggle('active', leftPanelMode === 'route-details' || leftPanelMode === 'demand-details');

    // Reset interaction mode
    setMode('none');
    
    // Reset selections when changing panel mode
    if (newMode !== 'route-details') {
       setSelectedLine(null);
    }
    if (newMode !== 'journey-planner') {
        clearJourney();
    }
}

function setMode(newMode: Mode) {
    if (!map) return;
    
    if (hoveredStationId) {
        map.setFeatureState({ source: 'stations', id: hoveredStationId }, { hover: false });
        hoveredStationId = null;
    }

    mode = newMode;
    const cursorMap: { [key in Mode]?: string } = {
        'draw-track': 'crosshair',
        'place-station': 'crosshair',
        'delete': 'pointer',
        'set-origin': 'crosshair',
        'set-destination': 'crosshair',
    };
    map.getCanvas().style.cursor = cursorMap[mode] || '';
    
    // Construction Tools
    buildTrackBtn.classList.toggle('active', mode === 'draw-track');
    buildStationBtn.classList.toggle('active', mode === 'place-station');
    deleteBtn.classList.toggle('active', mode === 'delete');
    document.getElementById('construction-options').style.display = mode === 'draw-track' ? 'flex' : 'none';
    
    if(mode !== 'draw-track') {
        drawingLinePoints = [];
        updateDataSource('drawing-line', { type: 'Feature', geometry: { type: 'LineString', coordinates: [] } });
    }
    updateDrawingUIState();
}

function handleFinishLineClick() {
    if (drawingLinePoints.length < 2) return;
    const cost = calculateCost();
    simulationWorker.postMessage({ type: 'BUILD_INFRASTRUCTURE', payload: { cost } });

    const newLine: Feature<LineString> = {
        type: 'Feature',
        geometry: {
            type: 'LineString',
            coordinates: drawingLinePoints,
        },
        properties: {
            id: nextLineId,
            color: ROUTE_COLORS[(nextLineId - 1) % ROUTE_COLORS.length],
            cost,
            elevation,
            buildMethod,
            trackCount,
        },
        id: nextLineId,
    };
    lines.features.push(newLine);
    updateDataSource('lines', lines);
    nextLineId++;
    
    updateSimulationNetwork();
    setMode('none');
}

function handleUndoPointClick() {
    if (drawingLinePoints.length > 0) {
        drawingLinePoints.pop();
        updateDataSource('drawing-line', {
            type: 'Feature',
            geometry: { type: 'LineString', coordinates: drawingLinePoints }
        });
        updateCostDisplay();
        updateDrawingUIState();
    }
}

function handleCancelDrawClick() {
    setMode('none');
}

function handleLayerToggle() {
    if (!map) return;
    const showDepth = depthToggle.checked;

    map.setLayoutProperty('lines-main', 'visibility', tracksToggle.checked && !showDepth ? 'visible' : 'none');
    map.setLayoutProperty('lines-glow', 'visibility', tracksToggle.checked && !showDepth ? 'visible' : 'none');
    map.setLayoutProperty('lines-depth', 'visibility', tracksToggle.checked && showDepth ? 'visible' : 'none');
    
    map.setLayoutProperty('stations-points', 'visibility', stationsToggle.checked ? 'visible' : 'none');
    map.setLayoutProperty('stations-halo', 'visibility', stationsToggle.checked ? 'visible' : 'none');
    map.setLayoutProperty('station-queues', 'visibility', stationsToggle.checked ? 'visible' : 'none');
    map.setLayoutProperty('station-ridership-labels', 'visibility', (leftPanelMode === 'route-details' && selectedLineId) ? 'visible' : 'none');

    map.setLayoutProperty('trains-layer', 'visibility', trainsToggle.checked ? 'visible' : 'none');
    map.setLayoutProperty('demand-bubbles', 'visibility', demandToggle.checked ? 'visible' : 'none');
}

function setPlaying(play: boolean) {
    isPlaying = play;
    playBtn.style.display = isPlaying ? 'none' : 'block';
    pauseBtn.style.display = isPlaying ? 'block' : 'none';
    
    if (isPlaying) {
        simulationWorker.postMessage({ type: 'START' });
    } else {
        simulationWorker.postMessage({ type: 'PAUSE' });
    }
}

// --- ANALYTICS & JOURNEY PLANNER ---

function setSelectedLine(lineId: number | string | null) {
    if (selectedLineId) {
        map.setFeatureState({ source: 'lines', id: selectedLineId }, { selected: false });
    }
    selectedLineId = lineId;
    if (selectedLineId) {
        map.setFeatureState({ source: 'lines', id: selectedLineId }, { selected: true });
        renderRouteDetailsPanel();
        map.setLayoutProperty('station-ridership-labels', 'visibility', 'visible');
    } else {
        map.setLayoutProperty('station-ridership-labels', 'visibility', 'none');
    }
}

function clearJourney() {
    journeyOrigin = null;
    journeyDestination = null;
    journeyResult = null;
    updateDataSource('journey-points', { type: 'FeatureCollection', features: [] });
    updateDataSource('journey-route', { type: 'FeatureCollection', features: [] });
    renderJourneyPlannerPanel();
}

function planJourney() {
    if (!journeyOrigin || !journeyDestination) return;

    simulationWorker.postMessage({
        type: 'PLAN_JOURNEY',
        payload: {
            origin: journeyOrigin.coordinates,
            destination: journeyDestination.coordinates,
        }
    });
}

// --- MAP EVENT HANDLERS ---
function onMapMouseMove(e: any) {
    if (mode === 'delete' || (leftPanelMode === 'route-details' && mode === 'none')) {
        const features = map.queryRenderedFeatures(e.point, { layers: ['lines-main', 'stations-points'] });
        map.getCanvas().style.cursor = features.length > 0 ? 'pointer' : '';
        return;
    }
    if (mode !== 'draw-track') return;

    const canvas = map.getCanvas();
    const queryBox: [[number, number], [number, number]] = [
        [e.point.x - SNAP_THRESHOLD, e.point.y - SNAP_THRESHOLD],
        [e.point.x + SNAP_THRESHOLD, e.point.y + SNAP_THRESHOLD]
    ];
    
    const nearbyStations = map.queryRenderedFeatures(queryBox, { layers: ['stations-points'] });
    let snappedPoint = [e.lngLat.lng, e.lngLat.lat];
    
    if (hoveredStationId) {
        map.setFeatureState({ source: 'stations', id: hoveredStationId }, { hover: false });
        hoveredStationId = null;
    }

    if (nearbyStations.length > 0) {
        const closestStation = nearbyStations[0];
        snappedPoint = closestStation.geometry.coordinates.slice();
        hoveredStationId = closestStation.id;
        map.setFeatureState({ source: 'stations', id: hoveredStationId }, { hover: true });
        canvas.style.cursor = 'pointer';
    } else {
        canvas.style.cursor = 'crosshair';
    }

    if (drawingLinePoints.length > 0) {
        const currentPoints = [...drawingLinePoints, snappedPoint];
        updateDataSource('drawing-line', {
            type: 'Feature',
            geometry: { type: 'LineString', coordinates: currentPoints }
        });
        updateCostDisplay();
    }
}


function onMapClick(e: any) {
    const clickedPoint = [e.lngLat.lng, e.lngLat.lat];

    if (mode === 'set-origin') {
        journeyOrigin = { type: 'Point', coordinates: clickedPoint };
        mode = 'none';
        planJourney();
        renderJourneyPlannerPanel();
        return;
    }
    if (mode === 'set-destination') {
        journeyDestination = { type: 'Point', coordinates: clickedPoint };
        mode = 'none';
        planJourney();
        renderJourneyPlannerPanel();
        return;
    }

    if (leftPanelMode === 'route-details' || leftPanelMode === 'demand-details') {
        const lineFeatures = map.queryRenderedFeatures(e.point, { layers: ['lines-main'] });
        if (lineFeatures.length > 0) {
            setLeftPanelMode('route-details');
            setSelectedLine(lineFeatures[0].id);
            return;
        }

        if (demandToggle.checked) {
            const demandFeatures = map.queryRenderedFeatures(e.point, { layers: ['demand-bubbles'] });
            if (demandFeatures.length > 0) {
                setLeftPanelMode('demand-details');
                selectedDemandPointCoords = demandFeatures[0].geometry.coordinates;
                simulationWorker.postMessage({ type: 'GET_DEMAND_DETAILS', payload: { coords: selectedDemandPointCoords } });
                return;
            }
        }
        
    }

    if (mode === 'draw-track') {
        const queryBox: [[number, number], [number, number]] = [
            [e.point.x - SNAP_THRESHOLD, e.point.y - SNAP_THRESHOLD],
            [e.point.x + SNAP_THRESHOLD, e.point.y + SNAP_THRESHOLD]
        ];
        const nearbyStations = map.queryRenderedFeatures(queryBox, { layers: ['stations-points'] });
        const finalPoint = nearbyStations.length > 0 ? nearbyStations[0].geometry.coordinates.slice() : clickedPoint;

        drawingLinePoints.push(finalPoint);
        updateDataSource('drawing-line', {
            type: 'Feature',
            geometry: { type: 'LineString', coordinates: drawingLinePoints }
        });
        updateCostDisplay();
        updateDrawingUIState();
    } else if (mode === 'place-station') {
        simulationWorker.postMessage({ type: 'BUILD_INFRASTRUCTURE', payload: { cost: STATION_BUILD_COST } });

        const newStation: Feature<Point> = {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: clickedPoint },
            properties: { id: nextStationId, name: `Station ${nextStationId}`, cost: STATION_BUILD_COST },
            id: nextStationId,
        };
        stations.features.push(newStation);
        updateDataSource('stations', stations);
        nextStationId++;
        updateSimulationNetwork();
    } else if (mode === 'delete') {
        const features = map.queryRenderedFeatures(e.point, { layers: ['lines-main', 'stations-points'] });
        if (features.length === 0) return;
        
        const featureToDelete = features[0];
        const sourceName = featureToDelete.source;
        const featureId = featureToDelete.properties.id;

        if (sourceName === 'lines') {
            lines.features = lines.features.filter(f => f.properties.id !== featureId);
            updateDataSource('lines', lines);
        } else if (sourceName === 'stations') {
            stations.features = stations.features.filter(f => f.properties.id !== featureId);
            updateDataSource('stations', stations);
        }
        updateSimulationNetwork();
    }
}

// --- INITIALIZATION ---

async function handleSaveApiConfig() {
    const styleUrlInput = document.getElementById('style-url-input') as HTMLInputElement;
    const accessTokenInput = document.getElementById('access-token-input') as HTMLInputElement;

    localStorage.setItem('mapStyleUrl', styleUrlInput.value.trim());
    localStorage.setItem('mapAccessToken', accessTokenInput.value.trim());

    hideApiConfigPanel();
    await reloadMap();
}

function showApiConfigPanel() {
    const styleUrlInput = document.getElementById('style-url-input') as HTMLInputElement;
    const accessTokenInput = document.getElementById('access-token-input') as HTMLInputElement;

    styleUrlInput.value = localStorage.getItem('mapStyleUrl') || '';
    accessTokenInput.value = localStorage.getItem('mapAccessToken') || '';
    apiConfigModal.style.display = 'flex';
}

function hideApiConfigPanel() {
    apiConfigModal.style.display = 'none';
}

function createApiConfigPanel() {
    apiConfigModal = document.createElement('div');
    apiConfigModal.className = 'modal-backdrop';
    apiConfigModal.style.display = 'none';
    
    apiConfigModal.innerHTML = `
        <div class="panel modal-content">
            <h3>🔑 Map API Configuration</h3>
            <label for="style-url-input">Map Style URL</label>
            <input type="text" id="style-url-input" placeholder="e.g., mapbox://styles/mapbox/dark-v11">
            <label for="access-token-input">Access Token (optional)</label>
            <input type="text" id="access-token-input" placeholder="e.g., pk.eyJ1...">
            <div class="modal-actions">
                <button id="cancel-api-config">Cancel</button>
                <button id="save-api-config" class="primary">Save & Reload</button>
            </div>
        </div>
    `;

    uiContainer.appendChild(apiConfigModal);

    document.getElementById('save-api-config').onclick = handleSaveApiConfig;
    document.getElementById('cancel-api-config').onclick = hideApiConfigPanel;
    apiConfigModal.onclick = (e) => {
        if (e.target === apiConfigModal) {
            hideApiConfigPanel();
        }
    };
}

function showBanner(message: string, id: string, className: string, timeout: number = 8000) {
    const rightPanel = document.querySelector('.right-panel');
    if (!rightPanel) return;

    const existingBanner = document.getElementById(id);
    if (existingBanner) existingBanner.remove();

    const banner = document.createElement('div');
    banner.id = id;
    banner.className = className;
    banner.innerHTML = `<span>${message}</span><button>&times;</button>`;
    
    rightPanel.insertBefore(banner, rightPanel.children[1]);
    
    const closeBtn = banner.querySelector('button');
    const removeBanner = () => banner.remove();
    closeBtn.onclick = removeBanner;
    
    if (timeout > 0) {
      setTimeout(removeBanner, timeout);
    }
}

function showErrorBanner(message: string) {
    showBanner(`⚠️ ${message}`, 'error-banner', 'error-banner');
}

function handleIncidentEvent(payload: { id: number; active: boolean; message: string; }) {
    const { id, active, message } = payload;
    const bannerId = `incident-banner-${id}`;
    
    if (!active) {
        const banner = document.getElementById(bannerId);
        if (banner) banner.remove();
        return;
    }
    
    if (document.getElementById(bannerId)) return;

    showBanner(` BAHN-STÖRUNG: ${message}`, bannerId, 'incident-banner', 0);
}


function updateApiBanner() {
    const rightPanel = document.querySelector('.right-panel');
    if (!rightPanel) return;

    const existingBanner = document.getElementById('api-banner');
    if (existingBanner) existingBanner.remove();

    if (!localStorage.getItem('mapStyleUrl')) {
        const banner = document.createElement('div');
        banner.id = 'api-banner';
        banner.className = 'api-banner';
        banner.innerHTML = `Using fallback map. Add your <a href="#" id="banner-link">API key</a> for high-detail tiles.`;
        rightPanel.appendChild(banner);
        document.getElementById('banner-link').onclick = (e) => {
            e.preventDefault();
            showApiConfigPanel();
        };
    }
}

// --- UI RENDERING ---
function renderRouteDetailsPanel() {
    if (!selectedLineId) return;
    const line = lines.features.find(f => f.id === selectedLineId);
    if (!line) return;

    const stationsOnLine = stations.features.filter(s => {
        const sCoords = JSON.stringify(s.geometry.coordinates);
        return line.geometry.coordinates.some(lCoord => JSON.stringify(lCoord) === sCoords);
    });

    const totalRiders = stationsOnLine.reduce((sum, s) => sum + (stationRidership[s.id as string] || 0), 0);

    let stationsHtml = stationsOnLine.map(s => `
        <div class="list-item">
            <span>🚉 ${s.properties.name}</span>
            <span>${formatNumber(stationRidership[s.id as string] || 0)}</span>
        </div>
    `).join('');

    routeDetailsPanel.innerHTML = `
        <h3>Route Details</h3>
        <div class="list-container">${stationsHtml}</div>
        <div class="list-item total">
            <span>Total</span>
            <span>${formatNumber(totalRiders)}</span>
        </div>
    `;

    updateDataSource('station-ridership-labels', {
        type: 'FeatureCollection',
        features: stationsOnLine.map(s => ({
            type: 'Feature',
            geometry: s.geometry,
            properties: {
                ridership: formatNumber(stationRidership[s.id as string] || 0),
            }
        }))
    });
}

function renderDemandDetailsPanel(details: any) {
    const { demandPoint, nearbyStations, hourlyDistribution } = details;
    const totalWorkers = 4215 + 18721 + 1842; // Hardcoded from screenshot for visual consistency
    
    const nearbyStationsHtml = nearbyStations.map((s: any) => `
        <div class="list-item">
            <span>🚉 ${s.name}</span>
            <span>${(s.distance/1000).toFixed(2)}km · ${formatTime(s.distance / WALK_SPEED_MPS)} walk</span>
        </div>
    `).join('');

    const createChartHtml = (data: number[], title: string) => {
        const maxVal = Math.max(...data);
        const bars = data.map((val, i) => {
            const hour = String(i * 2).padStart(2, '0');
            return `<div class="bar-wrapper" title="${hour}:00"><div class="bar" style="height: ${ (val / maxVal) * 100}%"></div></div>`;
        }).join('');
        return `
            <h4>${title}</h4>
            <div class="bar-chart">${bars}</div>
            <div class="chart-labels"><span>12am</span><span>6am</span><span>12pm</span><span>6pm</span></div>
        `;
    };

    demandDetailsPanel.innerHTML = `
        <h3>Demand Point Details</h3>
        <h4>Worker Mode Share</h4>
        <div class="mode-share-bar">
            <div class="segment transit" style="width: ${17.0}%" title="Transit: 17.0%"></div>
            <div class="segment driving" style="width: ${75.6}%" title="Driving: 75.6%"></div>
            <div class="segment walking" style="width: ${7.4}%" title="Walking: 7.4%"></div>
        </div>
        <div class="legend">
            <div><span class="color-box transit"></span>Transit <span class="value">4,215</span></div>
            <div><span class="color-box driving"></span>Driving <span class="value">18,721</span></div>
            <div><span class="color-box walking"></span>Walking <span class="value">1,842</span></div>
        </div>
        ${createChartHtml(hourlyDistribution, 'Arrival Times')}
        ${createChartHtml(hourlyDistribution, 'Departure Times')}
        <h4>Nearby Stations</h4>
        <div class="list-container">${nearbyStationsHtml}</div>
    `;
}

function renderJourneyPlannerPanel() {
    const originText = journeyOrigin ? `Set from map` : 'Set on map';
    const destText = journeyDestination ? `Set from map` : 'Set on map';
    let resultHtml = '<div class="placeholder">Set origin and destination to plan a journey.</div>';

    if (journeyResult) {
        const { walkToStationTime, walkFromStationTime, route } = journeyResult;
        const totalTime = walkToStationTime + route.totalTime + walkFromStationTime;
        
        resultHtml = `
            <h4>Options</h4>
            <div class="journey-result">
                <span>Total: ${formatTime(totalTime)}</span>
                <div class="journey-breakdown">
                    <span>🚶 ${formatTime(walkToStationTime + walkFromStationTime)}</span>
                    <span>&nbsp;·&nbsp;</span>
                    <span>⏳ ${formatTime(route.waitTime)}</span>
                    <span>&nbsp;·&nbsp;</span>
                    <span>🚇 ${formatTime(route.rideTime)}</span>
                </div>
            </div>
        `;
    }

    journeyPlannerPanel.innerHTML = `
        <h3>🧭 Journey Planner</h3>
        <div class="journey-leg">
            <span class="leg-icon origin"></span>
            <button id="set-origin-btn">${originText}</button>
        </div>
        <div class="journey-leg">
            <span class="leg-icon dest"></span>
            <button id="set-dest-btn">${destText}</button>
        </div>
        <button id="clear-journey-btn">Clear</button>
        <div id="journey-results-container">${resultHtml}</div>
    `;

    document.getElementById('set-origin-btn').onclick = () => setMode('set-origin');
    document.getElementById('set-dest-btn').onclick = () => setMode('set-destination');
    document.getElementById('clear-journey-btn').onclick = clearJourney;

    const features = [];
    if(journeyOrigin) features.push({ type: 'Feature', geometry: journeyOrigin, properties: { type: 'origin' } });
    if(journeyDestination) features.push({ type: 'Feature', geometry: journeyDestination, properties: { type: 'destination' } });
    updateDataSource('journey-points', { type: 'FeatureCollection', features });
}


function renderUI() {
    // Left Panel Container
    leftPanelContainer = document.createElement('div');
    leftPanelContainer.className = 'panel left-panel';
    uiContainer.appendChild(leftPanelContainer);
    
    // Construction Panel
    constructionPanel = document.createElement('div');
    constructionPanel.id = 'construction-panel';
    leftPanelContainer.appendChild(constructionPanel);
    
    constructionPanel.innerHTML = `<h3>🏗️ Construction</h3>`;
    const constructionTools = document.createElement('div');
    constructionTools.className = 'tool-grid';
    constructionPanel.appendChild(constructionTools);

    buildTrackBtn = document.createElement('button');
    buildTrackBtn.innerHTML = 'Build Tracks';
    buildTrackBtn.onclick = () => setMode(mode === 'draw-track' ? 'none' : 'draw-track');
    constructionTools.appendChild(buildTrackBtn);

    buildStationBtn = document.createElement('button');
    buildStationBtn.innerHTML = '🚉 Build Station';
    buildStationBtn.onclick = () => setMode(mode === 'place-station' ? 'none' : 'place-station');
    constructionTools.appendChild(buildStationBtn);
    
    deleteBtn = document.createElement('button');
    deleteBtn.innerHTML = '🗑️ Delete';
    deleteBtn.onclick = () => setMode(mode === 'delete' ? 'none' : 'delete');
    constructionTools.appendChild(deleteBtn);

    const constructionOptions = document.createElement('div');
    constructionOptions.id = 'construction-options';
    constructionOptions.style.display = 'none';
    constructionPanel.appendChild(constructionOptions);
    
    drawingControls = document.createElement('div');
    drawingControls.className = 'drawing-controls';
    
    const finishBtn = document.createElement('button');
    finishBtn.innerHTML = '✅ Finish';
    finishBtn.onclick = handleFinishLineClick;

    undoPointBtn = document.createElement('button');
    undoPointBtn.innerHTML = '↩️ Undo';
    undoPointBtn.onclick = handleUndoPointClick;
    
    const cancelBtn = document.createElement('button');
    cancelBtn.innerHTML = '❌ Cancel';
    cancelBtn.onclick = handleCancelDrawClick;
    
    drawingControls.appendChild(undoPointBtn);
    drawingControls.appendChild(cancelBtn);
    drawingControls.appendChild(finishBtn);
    constructionOptions.appendChild(drawingControls);

    const costContainer = document.createElement('div');
    costContainer.className = 'info-display';
    costDisplay = document.createElement('span');
    costContainer.appendChild(costDisplay);
    constructionOptions.appendChild(costContainer);
    
    constructionOptions.insertAdjacentHTML('beforeend', `
        <label>Number of Tracks</label>
        <div id="track-count-control" class="segmented-control"></div>
        <label>Elevation: <span id="elevation-value">0m</span></label>
        <input type="range" id="elevation-slider" min="-40" max="0" value="0">
        <label>Method</label>
        <div id="build-method-control" class="segmented-control"></div>
    `);
    
    updateCostDisplay();

    const trackCountContainer = document.getElementById('track-count-control');
    ['single', 'parallel', 'quad'].forEach(val => {
        const input = document.createElement('input');
        input.type = 'radio'; input.id = `track-${val}`; input.name = 'trackCount'; input.value = val;
        if (val === trackCount) input.checked = true;
        input.onchange = () => { trackCount = val as TrackCount; updateCostDisplay(); };
        const label = document.createElement('label');
        label.htmlFor = `track-${val}`; label.textContent = val.charAt(0).toUpperCase() + val.slice(1);
        trackCountContainer.appendChild(input);
        trackCountContainer.appendChild(label);
    });

    (document.getElementById('elevation-slider') as HTMLInputElement).oninput = (e) => {
        elevation = parseInt((e.target as HTMLInputElement).value);
        document.getElementById('elevation-value').textContent = `${elevation}m`;
        updateCostDisplay();
    };

    const buildMethodContainer = document.getElementById('build-method-control');
    ['cut-and-cover', 'tbm'].forEach(val => {
        const input = document.createElement('input');
        input.type = 'radio'; input.id = `method-${val}`; input.name = 'buildMethod'; input.value = val;
        if (val === buildMethod) input.checked = true;
        input.onchange = () => { buildMethod = val as BuildMethod; updateCostDisplay(); };
        const label = document.createElement('label');
        label.htmlFor = `method-${val}`; label.textContent = val === 'cut-and-cover' ? 'Cut & Cover' : 'TBM';
        buildMethodContainer.appendChild(input);
        buildMethodContainer.appendChild(label);
    });

    // Other Left Panels
    journeyPlannerPanel = document.createElement('div');
    routeDetailsPanel = document.createElement('div');
    demandDetailsPanel = document.createElement('div');
    leftPanelContainer.appendChild(journeyPlannerPanel);
    leftPanelContainer.appendChild(routeDetailsPanel);
    leftPanelContainer.appendChild(demandDetailsPanel);


    // Right Panel
    const rightPanel = document.createElement('div');
    rightPanel.className = 'panel right-panel';
    const rightPanelHeader = document.createElement('h3');
    rightPanelHeader.innerHTML = `🗺️ Layers`;
    const settingsBtn = document.createElement('button');
    settingsBtn.className = 'settings-btn';
    settingsBtn.innerHTML = '⚙️';
    settingsBtn.onclick = showApiConfigPanel;
    rightPanelHeader.appendChild(settingsBtn);
    rightPanel.appendChild(rightPanelHeader);
    uiContainer.appendChild(rightPanel);
    
    function createToggle(label: string, checked: boolean, handler: () => void): HTMLInputElement {
        const container = document.createElement('div');
        container.className = 'layer-toggle';
        container.innerHTML = `<span>${label}</span>`;
        const switchLabel = document.createElement('label');
        switchLabel.className = 'switch';
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = checked;
        input.onchange = handler;
        switchLabel.appendChild(input);
        switchLabel.innerHTML += `<span class="slider"></span>`;
        container.appendChild(switchLabel);
        rightPanel.appendChild(container);
        return input;
    }
    tracksToggle = createToggle('Tracks', true, handleLayerToggle);
    stationsToggle = createToggle('Stations', true, handleLayerToggle);
    trainsToggle = createToggle('Trains', true, handleLayerToggle);
    depthToggle = createToggle('Depth Overlay', false, handleLayerToggle);
    demandToggle = createToggle('Demand', false, handleLayerToggle);

    // Bottom Left Toolbar
    const bottomLeftToolbar = document.createElement('div');
    bottomLeftToolbar.className = 'panel bottom-left-toolbar';
    uiContainer.appendChild(bottomLeftToolbar);
    
    constructionBtn = document.createElement('button');
    constructionBtn.innerHTML = '🏗️';
    constructionBtn.onclick = () => setLeftPanelMode('construction');
    bottomLeftToolbar.appendChild(constructionBtn);
    
    plannerBtn = document.createElement('button');
    plannerBtn.innerHTML = '🧭';
    plannerBtn.onclick = () => setLeftPanelMode('journey-planner');
    bottomLeftToolbar.appendChild(plannerBtn);

    analyticsBtn = document.createElement('button');
    analyticsBtn.innerHTML = '📊';
    analyticsBtn.onclick = () => setLeftPanelMode('route-details'); // Default to route details
    bottomLeftToolbar.appendChild(analyticsBtn);
    

    // HUD
    const hud = document.createElement('div');
    hud.className = 'hud';
    hud.innerHTML = `
        <span id="budget-display">💰 $5.00B</span>
        <span id="cashflow-display">📈 +$0/hr</span>
        <span id="ridership-display">👥 0</span>
        <span id="wait-time-display">⏳ 0s</span>
        <span>🚄 <span id="trains-count">0</span></span>
        <span id="time-display">⏱️ Day 1, 00:00</span>
        <div class="play-controls">
            <button id="play-btn">▶️</button>
            <button id="pause-btn" style="display: none;">⏸️</button>
        </div>
    `;
    uiContainer.appendChild(hud);
    playBtn = document.getElementById('play-btn') as HTMLButtonElement;
    pauseBtn = document.getElementById('pause-btn') as HTMLButtonElement;
    trainsCountDisplay = document.getElementById('trains-count') as HTMLSpanElement;
    timeDisplay = document.getElementById('time-display') as HTMLSpanElement;
    ridershipDisplay = document.getElementById('ridership-display') as HTMLSpanElement;
    budgetDisplay = document.getElementById('budget-display') as HTMLSpanElement;
    cashflowDisplay = document.getElementById('cashflow-display') as HTMLSpanElement;
    waitTimeDisplay = document.getElementById('wait-time-display') as HTMLSpanElement;

    playBtn.onclick = () => setPlaying(true);
    pauseBtn.onclick = () => setPlaying(false);

    createApiConfigPanel();
    updateApiBanner();
    setLeftPanelMode('construction'); // Set initial panel
    renderJourneyPlannerPanel(); // Initial render
}

function setupMapLayers() {
    if (!map) return;
    
    const emptyFc: FeatureCollection<any> = { type: 'FeatureCollection', features: [] };
    
    // --- SOURCES ---
    map.addSource('lines', { type: 'geojson', data: lines, generateId: true });
    map.addSource('stations', { type: 'geojson', data: stations, generateId: true });
    map.addSource('drawing-line', { type: 'geojson', data: emptyFc });
    map.addSource('trains', { type: 'geojson', data: trains });
    map.addSource('demand-grid', { type: 'geojson', data: emptyFc });
    map.addSource('journey-points', { type: 'geojson', data: emptyFc });
    map.addSource('journey-route', { type: 'geojson', data: emptyFc });
    map.addSource('station-ridership-labels', { type: 'geojson', data: emptyFc });

    simulationWorker.postMessage({ type: 'GET_DEMAND_GRID' });

    // --- LAYERS ---
    map.addLayer({
        id: 'demand-bubbles', type: 'circle', source: 'demand-grid',
        layout: { visibility: 'none' },
        paint: {
            'circle-radius': [ 'interpolate', ['linear'], ['get', 'demand'], 50, 10, 200, 30 ],
            'circle-color': [ 'interpolate', ['linear'], ['get', 'demand'], 50, '#663399', 200, '#F39C12' ],
            'circle-opacity': 0.7,
        },
    });

    map.addLayer({
        id: 'lines-glow', type: 'line', source: 'lines',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 
            'line-color': ['get', 'color'], 
            'line-width': ['case', ['boolean', ['feature-state', 'selected'], false], 10, 7],
            'line-opacity': ['case', ['boolean', ['feature-state', 'selected'], false], 0.6, 0.4]
        },
    });
    map.addLayer({
        id: 'lines-main', type: 'line', source: 'lines',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 
            'line-color': ['get', 'color'], 
            'line-width': ['case', ['boolean', ['feature-state', 'selected'], false], 5, 3]
        },
    });
    map.addLayer({
        id: 'lines-depth', type: 'line', source: 'lines',
        layout: { 'line-join': 'round', 'line-cap': 'round', visibility: 'none' },
        paint: {
            'line-width': 4,
            'line-color': [ 'step', ['get', 'cost'], DEPTH_COST_COLORS[0], 50_000_000, DEPTH_COST_COLORS[1], 100_000_000, DEPTH_COST_COLORS[2], 250_000_000, DEPTH_COST_COLORS[3], 500_000_000, DEPTH_COST_COLORS[4], 1_000_000_000, DEPTH_COST_COLORS[5], 2_000_000_000, DEPTH_COST_COLORS[6] ],
        },
    });
    map.addLayer({
        id: 'station-queues', type: 'circle', source: 'stations',
        paint: {
            'circle-radius': [ 'interpolate', ['linear'], ['coalesce', ['feature-state', 'queueSize'], 0], 0, 0, 1, 3, 50, 10, 200, 18 ],
            'circle-color': '#F39C12',
            'circle-opacity': ['case', ['>', ['coalesce', ['feature-state', 'queueSize'], 0], 0], 0.6, 0 ],
            'circle-blur': 0.5,
        }
    });
    map.addLayer({
        id: 'stations-halo', type: 'circle', source: 'stations',
        paint: {
            'circle-radius': 9, 'circle-color': '#FFFFFF',
            'circle-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 0.8, 0],
            'circle-stroke-color': '#FFFFFF', 'circle-stroke-width': 2,
            'circle-stroke-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 1, 0],
        },
    });
    map.addLayer({
        id: 'stations-points', type: 'circle', source: 'stations',
        paint: { 'circle-radius': 5, 'circle-color': '#0A0A0A', 'circle-stroke-width': 2, 'circle-stroke-color': '#FFFFFF' }
    });
     map.addLayer({
        id: 'station-ridership-labels', type: 'symbol', source: 'station-ridership-labels',
        layout: {
            'visibility': 'none', 'text-field': ['get', 'ridership'], 'text-font': ['Open Sans Bold'],
            'text-size': 12, 'text-offset': [0, 1.5], 'text-allow-overlap': true,
        },
        paint: { 'text-color': '#000', 'text-halo-color': '#fff', 'text-halo-width': 1.5 }
    });
    map.addLayer({
        id: 'drawing-layer-main', type: 'line', source: 'drawing-line',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#007AFF', 'line-width': 3, 'line-dasharray': [2, 2] },
    });
    map.addLayer({
        id: 'trains-layer', type: 'circle', source: 'trains',
        paint: {
            'circle-radius': 6,
            'circle-color': ['step', ['get', 'loadFactor'], '#4CAF50', 0.25, '#FFD60A', 0.75, '#FF5252'],
            'circle-stroke-color': '#FFFFFF', 'circle-stroke-width': 2,
        },
    });
    map.addLayer({
        id: 'journey-route', type: 'line', source: 'journey-route',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#FFFFFF', 'line-width': 6, 'line-dasharray': [0.5, 1.5] }
    });
    map.addLayer({
        id: 'journey-points', type: 'symbol', source: 'journey-points',
        layout: {
            'icon-image': ['match', ['get', 'type'], 'origin', 'marker-15', 'destination', 'marker-15', ''], // Placeholder, needs icons
            'text-field': ['match', ['get', 'type'], 'origin', 'Origin', 'destination', 'Destination', ''],
            'text-font': ['Open Sans Bold'], 'text-size': 14, 'text-offset': [0, -1.8],
            'icon-allow-overlap': true, 'text-allow-overlap': true,
        },
        paint: {
            'text-color': '#fff', 'text-halo-color': '#000', 'text-halo-width': 1,
            'icon-color': ['match', ['get', 'type'], 'origin', '#34C759', 'destination', '#FF3B30', '#000'],
        }
    });
}

async function reloadMap(errorMessage?: string) {
    if (map) {
        map.remove();
        map = undefined;
    }
    await initMap();
    updateApiBanner();
    if (errorMessage) {
        showErrorBanner(errorMessage);
        showApiConfigPanel();
    }
}

async function initMap() {
    let workerUrl: string | undefined;
    try {
        const workerSource = await fetch('https://unpkg.com/maplibre-gl@4.1.3/dist/maplibre-gl-worker.js').then(r => r.text());
        const workerBlob = new Blob([workerSource], { type: 'application/javascript' });
        workerUrl = URL.createObjectURL(workerBlob);
    } catch (error) {
        console.warn('MapLibre worker failed to load.', error);
    }

    const styleUrl = localStorage.getItem('mapStyleUrl');
    const accessToken = localStorage.getItem('mapAccessToken');

    const fallbackStyle = {
      "version": 8, "sources": { "osm": { "type": "raster", "tiles": [ "https://a.tile.openstreetmap.org/{z}/{x}/{y}.png" ], "tileSize": 256, "attribution": "&copy; OpenStreetMap" } },
      "layers": [ { "id": "background", "type": "background", "paint": { "background-color": "#1C3B45" } }, { "id": "osm", "type": "raster", "source": "osm", "paint": { "raster-opacity": 0.3 } } ]
    };
    
    let mapStyle: any = styleUrl || fallbackStyle;
    let transformRequestFunc: any = undefined;

    if (styleUrl && accessToken) {
        transformRequestFunc = (url: string, resourceType: string) => {
            if (resourceType === 'Style' || resourceType === 'Source' || resourceType === 'Sprite' || resourceType === 'Glyphs' || resourceType === 'Tile') {
                const separator = url.includes('?') ? '&' : '?';
                return { url: `${url}${separator}access_token=${accessToken}` };
            }
             return { url };
        };
    }

    const mapOptions: any = {
        container: 'map', style: mapStyle, center: [100.5018, 13.7563], zoom: 11,
        pitch: styleUrl ? 45 : 0, antialias: true, transformRequest: transformRequestFunc,
    };
    
    if (workerUrl) mapOptions.workerUrl = workerUrl;

    map = new maplibregl.Map(mapOptions);

    map.on('load', () => {
        setupMapLayers();
        if (workerUrl) URL.revokeObjectURL(workerUrl);
    });
    
    map.on('error', async (e: any) => {
      console.error('Map error:', e.error?.message || e);
      if (localStorage.getItem('mapStyleUrl') && e.error && e.error.message.toLowerCase().includes('failed')) {
          localStorage.removeItem('mapStyleUrl');
          localStorage.removeItem('mapAccessToken');
          await reloadMap('Failed to load custom style. Reverting to fallback map. Please check your URL and token.');
      } else if (e.error?.message) {
          showErrorBanner(`Map error: ${e.error.message}`);
      }
    });

    map.on('click', onMapClick);
    map.on('mousemove', onMapMouseMove);
}

function initSimulationWorker() {
    simulationWorker = new Worker(new URL('./simulation.worker.ts', import.meta.url), { type: 'module' });

    simulationWorker.onmessage = (e) => {
        const { type, payload } = e.data;
        if (type === 'TICK') {
            const { trains: trainData, simTime, stationQueues, totalRidership, budget, cashflowPerHour, avgWaitTime, dailyStationRidership, dailyLineRidership } = payload;
            
            updateDataSource('trains', trainData);
            trainsCountDisplay.textContent = String(trainData.features.length);

            const day = Math.floor(simTime / 86400) + 1;
            const hour = Math.floor((simTime % 86400) / 3600);
            const minute = Math.floor((simTime % 3600) / 60);
            timeDisplay.textContent = `⏱️ Day ${day}, ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
            
            ridershipDisplay.textContent = `👥 ${formatNumber(totalRidership)}`;
            budgetDisplay.textContent = `💰 ${formatCurrency(budget)}`;
            cashflowDisplay.textContent = `📈 ${formatCashflow(cashflowPerHour)}`;
            waitTimeDisplay.textContent = `⏳ ${Math.round(avgWaitTime)}s`;

            stationRidership = dailyStationRidership;
            lineRidership = dailyLineRidership;
            if (leftPanelMode === 'route-details') renderRouteDetailsPanel();
            
            const allStationIds = new Set([...Object.keys(lastStationQueues), ...Object.keys(stationQueues)]);
            allStationIds.forEach(id => {
                const newSize = stationQueues[id] || 0;
                if ((lastStationQueues[id] || 0) !== newSize) {
                    map.setFeatureState({ source: 'stations', id }, { queueSize: newSize });
                }
            });
            lastStationQueues = stationQueues;
        } else if (type === 'INCIDENT_EVENT') {
            handleIncidentEvent(payload);
        } else if (type === 'DEMAND_GRID_DATA') {
            updateDataSource('demand-grid', payload);
        } else if (type === 'JOURNEY_PLAN_RESULT') {
            journeyResult = payload;
            renderJourneyPlannerPanel();
            if (payload.route) {
                const routeLine = {
                    type: 'Feature',
                    geometry: {
                        type: 'LineString',
                        coordinates: payload.route.legs.flatMap((leg: any) => leg.coords)
                    }
                };
                updateDataSource('journey-route', { type: 'FeatureCollection', features: [routeLine] });
            }
        } else if (type === 'DEMAND_DETAILS_RESULT') {
            renderDemandDetailsPanel(payload);
        }
    };
}

async function main() {
    renderUI();
    initSimulationWorker();
    await initMap();
}

main();
