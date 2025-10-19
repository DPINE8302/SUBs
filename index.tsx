declare const maplibregl: any;

// --- CONSTANTS ---
const SNAP_THRESHOLD = 15; // pixels
const ROUTE_COLORS = ['#007AFF', '#FF3B30', '#34C759', '#FFD60A', '#AF52DE', '#FF9500'];
const DEPTH_COST_COLORS = ['#D3C0FF', '#B388FF', '#9575CD', '#7E57C2', '#673AB7', '#512DA8', '#311B92'];


// --- TYPE DEFINITIONS ---
type Mode = 'none' | 'draw-track' | 'place-station' | 'delete';
type TrackCount = 'single' | 'parallel' | 'quad';
type BuildMethod = 'cut-and-cover' | 'tbm';

type Feature<T> = { type: 'Feature'; geometry: T; properties: any; id?: number | string };
type LineString = { type: 'LineString'; coordinates: number[][] };
type Point = { type: 'Point'; coordinates: number[] };
type FeatureCollection<T> = { type: 'FeatureCollection'; features: Feature<T>[] };

// --- STATE ---
let map: any;
let simulationWorker: Worker;
let mode: Mode = 'none';
let nextLineId = 1;
let nextStationId = 1;
let isPlaying = false;

// Construction State
let trackCount: TrackCount = 'single';
let elevation = 0; // meters
let buildMethod: BuildMethod = 'cut-and-cover';

const lines: FeatureCollection<LineString> = { type: 'FeatureCollection', features: [] };
const stations: FeatureCollection<Point> = { type: 'FeatureCollection', features: [] };
const trains: FeatureCollection<Point> = { type: 'FeatureCollection', features: [] };
let drawingLinePoints: number[][] = [];
let hoveredStationId: string | null = null;


// --- DOM ELEMENTS ---
const uiContainer = document.getElementById('ui-container');
let buildTrackBtn: HTMLButtonElement, buildStationBtn: HTMLButtonElement, deleteBtn: HTMLButtonElement;
let undoPointBtn: HTMLButtonElement;
let drawingControls: HTMLDivElement;
let tracksToggle: HTMLInputElement, stationsToggle: HTMLInputElement, trainsToggle: HTMLInputElement, depthToggle: HTMLInputElement;
let costDisplay: HTMLSpanElement;
let playBtn: HTMLButtonElement, pauseBtn: HTMLButtonElement;
let apiConfigModal: HTMLDivElement;
let trainsCountDisplay: HTMLSpanElement;

// --- MAP HELPERS ---
function updateDataSource(sourceId: string, data: any) {
    if (!map || !map.getSource(sourceId)) return;
    map.getSource(sourceId).setData(data);
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
    costDisplay.textContent = `Est. Cost: $${(cost / 1_000_000).toFixed(1)}M`;
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
function setMode(newMode: Mode) {
    if (!map) return;
    
    if (hoveredStationId) {
        map.setFeatureState({ source: 'stations', id: hoveredStationId }, { hover: false });
        hoveredStationId = null;
    }

    mode = newMode;
    const cursorMap = {
        'draw-track': 'crosshair',
        'place-station': 'crosshair',
        'delete': 'pointer',
        'none': ''
    };
    map.getCanvas().style.cursor = cursorMap[mode] || '';
    
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

    map.setLayoutProperty('trains-layer', 'visibility', trainsToggle.checked ? 'visible' : 'none');
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

// --- MAP EVENT HANDLERS ---
function onMapMouseMove(e: any) {
    if (mode !== 'draw-track') {
        if (mode === 'delete') {
            const features = map.queryRenderedFeatures(e.point, { layers: ['lines-main', 'stations-points'] });
            map.getCanvas().style.cursor = features.length > 0 ? 'pointer' : '';
        }
        return;
    }

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
        const newStation: Feature<Point> = {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: clickedPoint },
            properties: { id: nextStationId },
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

function showErrorBanner(message: string) {
    const rightPanel = document.querySelector('.right-panel');
    if (!rightPanel) return;

    const existingBanner = document.getElementById('error-banner');
    if (existingBanner) existingBanner.remove();

    const banner = document.createElement('div');
    banner.id = 'error-banner';
    banner.className = 'error-banner';
    banner.innerHTML = `<span>⚠️ ${message}</span><button id="close-error-banner">&times;</button>`;
    
    if (rightPanel.children.length > 1) {
        rightPanel.insertBefore(banner, rightPanel.children[1]);
    } else {
        rightPanel.appendChild(banner);
    }
    
    document.getElementById('close-error-banner').onclick = () => {
        banner.remove();
    };
    
    setTimeout(() => {
        banner.remove();
    }, 8000);
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


function renderUI() {
    // Left Panel
    const leftPanel = document.createElement('div');
    leftPanel.className = 'panel left-panel';
    leftPanel.innerHTML = `<h3>🏗️ Construction</h3>`;
    uiContainer.appendChild(leftPanel);

    const constructionTools = document.createElement('div');
    constructionTools.className = 'tool-grid';
    leftPanel.appendChild(constructionTools);

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
    constructionOptions.style.flexDirection = 'column';
    constructionOptions.style.gap = '12px';
    leftPanel.appendChild(constructionOptions);
    
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
    updateCostDisplay();
    costContainer.appendChild(costDisplay);
    constructionOptions.appendChild(costContainer);
    
    const trackCountLabel = document.createElement('label');
    trackCountLabel.textContent = 'Number of Tracks';
    constructionOptions.appendChild(trackCountLabel);
    const trackCountContainer = document.createElement('div');
    trackCountContainer.className = 'segmented-control';
    ['single', 'parallel', 'quad'].forEach(val => {
        const input = document.createElement('input');
        input.type = 'radio';
        input.id = `track-${val}`;
        input.name = 'trackCount';
        input.value = val;
        if (val === trackCount) input.checked = true;
        input.onchange = () => { trackCount = val as TrackCount; updateCostDisplay(); };
        const label = document.createElement('label');
        label.htmlFor = `track-${val}`;
        label.textContent = val.charAt(0).toUpperCase() + val.slice(1);
        trackCountContainer.appendChild(input);
        trackCountContainer.appendChild(label);
    });
    constructionOptions.appendChild(trackCountContainer);

    const elevationLabel = document.createElement('label');
    elevationLabel.innerHTML = `Elevation: <span id="elevation-value">0m</span>`;
    constructionOptions.appendChild(elevationLabel);
    const elevationSlider = document.createElement('input');
    elevationSlider.type = 'range';
    elevationSlider.min = '-40';
    elevationSlider.max = '0';
    elevationSlider.value = String(elevation);
    elevationSlider.oninput = (e) => {
        elevation = parseInt((e.target as HTMLInputElement).value);
        document.getElementById('elevation-value').textContent = `${elevation}m`;
        updateCostDisplay();
    };
    constructionOptions.appendChild(elevationSlider);

    const buildMethodLabel = document.createElement('label');
    buildMethodLabel.textContent = 'Method';
    constructionOptions.appendChild(buildMethodLabel);
    const buildMethodContainer = document.createElement('div');
    buildMethodContainer.className = 'segmented-control';
    ['cut-and-cover', 'tbm'].forEach(val => {
        const input = document.createElement('input');
        input.type = 'radio';
        input.id = `method-${val}`;
        input.name = 'buildMethod';
        input.value = val;
        if (val === buildMethod) input.checked = true;
        input.onchange = () => { buildMethod = val as BuildMethod; updateCostDisplay(); };
        const label = document.createElement('label');
        label.htmlFor = `method-${val}`;
        label.textContent = val === 'cut-and-cover' ? 'Cut & Cover' : 'TBM';
        buildMethodContainer.appendChild(input);
        buildMethodContainer.appendChild(label);
    });
    constructionOptions.appendChild(buildMethodContainer);

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
    
    function createToggle(id: string, label: string, checked: boolean, handler: () => void): [HTMLInputElement, HTMLDivElement] {
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
        return [input, container];
    }
    [tracksToggle] = createToggle('tracks', 'Tracks', true, handleLayerToggle);
    [stationsToggle] = createToggle('stations', 'Stations', true, handleLayerToggle);
    [trainsToggle] = createToggle('trains', 'Trains', true, handleLayerToggle);
    [depthToggle] = createToggle('depth', 'Depth Overlay', false, handleLayerToggle);

    // HUD
    const hud = document.createElement('div');
    hud.className = 'hud';
    hud.innerHTML = `
        <span>💵 Budget: $2,000.0M</span>
        <span>🚄 Active Trains: <span id="trains-count">0</span></span>
        <span>⏱️ Day 1, 08:00</span>
        <div class="play-controls">
            <button id="play-btn">▶️</button>
            <button id="pause-btn" style="display: none;">⏸️</button>
        </div>
    `;
    uiContainer.appendChild(hud);
    playBtn = document.getElementById('play-btn') as HTMLButtonElement;
    pauseBtn = document.getElementById('pause-btn') as HTMLButtonElement;
    trainsCountDisplay = document.getElementById('trains-count') as HTMLSpanElement;
    playBtn.onclick = () => setPlaying(true);
    pauseBtn.onclick = () => setPlaying(false);

    createApiConfigPanel();
    updateApiBanner();
}

function setupMapLayers() {
    if (!map) return;
    // --- SOURCES ---
    map.addSource('lines', { type: 'geojson', data: lines, generateId: true });
    map.addSource('stations', { type: 'geojson', data: stations, generateId: true });
    map.addSource('drawing-line', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'LineString', coordinates: [] } } });
    map.addSource('trains', { type: 'geojson', data: trains });

    // --- LAYERS ---
    map.addLayer({
        id: 'lines-glow', type: 'line', source: 'lines',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': ['get', 'color'], 'line-width': 7, 'line-opacity': 0.4 },
    });
    map.addLayer({
        id: 'lines-main', type: 'line', source: 'lines',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': ['get', 'color'], 'line-width': 3 },
    });
    map.addLayer({
        id: 'lines-depth', type: 'line', source: 'lines',
        layout: { 'line-join': 'round', 'line-cap': 'round', visibility: 'none' },
        paint: {
            'line-width': 4,
            'line-color': [
                'step',
                ['get', 'cost'],
                DEPTH_COST_COLORS[0], 50_000_000,
                DEPTH_COST_COLORS[1], 100_000_000,
                DEPTH_COST_COLORS[2], 250_000_000,
                DEPTH_COST_COLORS[3], 500_000_000,
                DEPTH_COST_COLORS[4], 1_000_000_000,
                DEPTH_COST_COLORS[5], 2_000_000_000,
                DEPTH_COST_COLORS[6]
            ],
        },
    });

    map.addLayer({
        id: 'stations-halo', type: 'circle', source: 'stations',
        paint: {
            'circle-radius': 9,
            'circle-color': '#FFFFFF',
            'circle-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 0.8, 0],
            'circle-stroke-color': '#FFFFFF',
            'circle-stroke-width': 2,
            'circle-stroke-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 1, 0],
        },
    });
    map.addLayer({
        id: 'stations-points', type: 'circle', source: 'stations',
        paint: {
            'circle-radius': 5,
            'circle-color': '#0A0A0A',
            'circle-stroke-width': 2,
            'circle-stroke-color': '#FFFFFF',
        },
    });
    
    map.addLayer({
        id: 'drawing-layer-main', type: 'line', source: 'drawing-line',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#007AFF', 'line-width': 3, 'line-dasharray': [2, 2] },
    });
    
    map.addLayer({
        id: 'trains-layer',
        type: 'circle',
        source: 'trains',
        paint: {
            'circle-radius': 6,
            'circle-color': [
                'step',
                ['get', 'loadFactor'],
                '#4CAF50', // green (<25%)
                0.25, '#FFD60A', // yellow (25-75%)
                0.75, '#FF5252'  // red (>75%)
            ],
            'circle-stroke-color': '#FFFFFF',
            'circle-stroke-width': 2,
        },
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
    }
}

async function initMap() {
    let workerUrl: string | undefined;
    try {
        const workerSource = await fetch('https://unpkg.com/maplibre-gl@4.1.3/dist/maplibre-gl-worker.js').then(r => r.text());
        const workerBlob = new Blob([workerSource], { type: 'application/javascript' });
        workerUrl = URL.createObjectURL(workerBlob);
    } catch (error) {
        console.warn('MapLibre worker failed to load. Map performance may be degraded.', error);
    }

    const styleUrl = localStorage.getItem('mapStyleUrl');
    const accessToken = localStorage.getItem('mapAccessToken');

    const fallbackStyle = {
      "version": 8,
      "sources": {
        "osm": {
          "type": "raster",
          "tiles": [ "https://a.tile.openstreetmap.org/{z}/{x}/{y}.png" ],
          "tileSize": 256,
          "attribution": "&copy; OpenStreetMap"
        }
      },
      "layers": [
        { "id": "background", "type": "background", "paint": { "background-color": "#f2f2f2" } },
        { "id": "osm", "type": "raster", "source": "osm" }
      ]
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
        container: 'map',
        style: mapStyle,
        center: [100.5018, 13.7563], // Bangkok
        zoom: 11,
        pitch: styleUrl ? 45 : 0,
        antialias: true,
        transformRequest: transformRequestFunc,
    };
    
    if (workerUrl) {
        mapOptions.workerUrl = workerUrl;
    }

    map = new maplibregl.Map(mapOptions);

    map.on('load', () => {
        setupMapLayers();
        if (workerUrl) {
            URL.revokeObjectURL(workerUrl);
        }
    });
    
    map.on('error', (e: any) => {
      console.error('Map error:', e.error?.message || e);
      const currentStyleUrl = localStorage.getItem('mapStyleUrl');
      if (currentStyleUrl && e.error && e.error.message.toLowerCase().includes('failed')) {
          localStorage.removeItem('mapStyleUrl');
          localStorage.removeItem('mapAccessToken');
          reloadMap('Failed to load custom style. Reverting to fallback map.');
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
            const trainData = payload.trains;
            updateDataSource('trains', trainData);
            trainsCountDisplay.textContent = String(trainData.features.length);
        }
    };
}

async function main() {
    renderUI();
    initSimulationWorker();
    await initMap();
}

main();