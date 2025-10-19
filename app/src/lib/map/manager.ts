import mapboxgl, { type LngLatLike } from 'mapbox-gl';
import { get } from 'svelte/store';
import {
	DEFAULT_CENTER,
	DEFAULT_MAPBOX_STYLE,
	DEFAULT_ZOOM,
	FALLBACK_RASTER_STYLE,
	DEPTH_COST_COLORS
} from './constants';
import { STATION_BUILD_COST } from '$lib/map/cost';
import {
	linesStore,
	stationsStore,
	trainsStore,
	demandStore,
	usingFallbackStyle,
	mapLoaded,
	mapError,
	layerVisibilityStore,
	mode,
	leftPanelMode,
	selectedLineId,
	selectedDemand,
	stationQueuesStore,
	drawingPointsStore,
	journeyOrigin,
	journeyDestination,
	journeyRoute
} from '$lib/stores';
import type { FeatureCollection, JourneyRoute } from '$lib/types';
import type { MapSettings } from '$lib/config/mapSettings';

type MapboxMap = mapboxgl.Map;


export class MapController {
	private map: MapboxMap | null = null;
	private drawingLinePoints: number[][] = [];
	private hoveredStationId: string | number | null = null;
	private nextStationId = 1;
	private unsubscribers: (() => void)[] = [];

	constructor(private container: HTMLElement) {}

	init(settings: MapSettings) {
		mapboxgl.accessToken = settings.token;
		mapError.set(null);
		const style = settings.styleUrl || DEFAULT_MAPBOX_STYLE;
		this.instantiateMap(style, Boolean(settings.token && settings.styleUrl));
	}

	destroy() {
		if (this.map) {
			this.map.remove();
			this.map = null;
		}
		this.unsubscribers.forEach((fn) => fn());
		this.unsubscribers = [];
		mapLoaded.set(false);
	}

	private instantiateMap(style: string | mapboxgl.Style, hasCredentials: boolean) {
		this.destroy();
		try {
			this.map = new mapboxgl.Map({
				container: this.container,
				style,
				center: DEFAULT_CENTER,
				zoom: DEFAULT_ZOOM,
				pitch: hasCredentials ? 45 : 0,
				attributionControl: false,
				antialias: true
			});
			this.registerHandlers();
			usingFallbackStyle.set(false);
		} catch (error) {
			console.error('Failed to instantiate map', error);
			mapError.set('Failed to initialise Mapbox map. Falling back to OSM tiles.');
			this.instantiateFallback();
		}
	}

	private instantiateFallback() {
		this.destroy();
		this.map = new mapboxgl.Map({
			container: this.container,
			style: FALLBACK_RASTER_STYLE as mapboxgl.Style,
			center: DEFAULT_CENTER,
			zoom: DEFAULT_ZOOM,
			attributionControl: false
		});
		usingFallbackStyle.set(true);
		this.registerHandlers();
	}

	private registerHandlers() {
		if (!this.map) return;
		this.map.on('load', () => {
			this.setupSources();
			this.setupLayers();
			this.subscribeToStores();
			mapLoaded.set(true);
		});

		this.map.on('error', (event) => {
			if (!get(usingFallbackStyle)) {
				console.warn('Map error', event);
				mapError.set(event.error?.message ?? 'Unknown map error');
				this.instantiateFallback();
			}
		});

		this.map.on('mousemove', (event) => this.onMouseMove(event));
		this.map.on('click', (event) => this.onMapClick(event));
	}

	private setupSources() {
		if (!this.map) return;
		const empty: FeatureCollection<any> = { type: 'FeatureCollection', features: [] };
		const existingStations = get(stationsStore);
		this.nextStationId =
			Math.max(0, ...existingStations.features.map((f) => (typeof f.id === 'number' ? f.id : Number(f.id) || 0))) + 1;
		this.map.addSource('lines', { type: 'geojson', data: get(linesStore), generateId: true });
		this.map.addSource('stations', { type: 'geojson', data: get(stationsStore), generateId: true });
		this.map.addSource('drawing-line', { type: 'geojson', data: empty });
		this.map.addSource('trains', { type: 'geojson', data: get(trainsStore) });
		this.map.addSource('demand', { type: 'geojson', data: get(demandStore) });
		this.map.addSource('station-ridership-labels', { type: 'geojson', data: empty });
		this.map.addSource('journey-route', { type: 'geojson', data: empty });
		this.map.addSource('journey-points', { type: 'geojson', data: empty });
	}

	private setupLayers() {
		if (!this.map) return;
		this.map.addLayer({
			id: 'demand-bubbles',
			type: 'circle',
			source: 'demand',
			layout: { visibility: 'none' },
			paint: {
				'circle-radius': ['interpolate', ['linear'], ['get', 'demand'], 50, 10, 200, 30],
				'circle-color': ['interpolate', ['linear'], ['get', 'demand'], 50, '#663399', 200, '#F39C12'],
				'circle-opacity': 0.7
			}
		});

		this.map.addLayer({
			id: 'lines-glow',
			type: 'line',
			source: 'lines',
			layout: { 'line-join': 'round', 'line-cap': 'round' },
			paint: {
				'line-color': ['get', 'color'],
				'line-width': ['case', ['boolean', ['feature-state', 'selected'], false], 10, 7],
				'line-opacity': ['case', ['boolean', ['feature-state', 'selected'], false], 0.6, 0.4]
			}
		});

		this.map.addLayer({
			id: 'lines-main',
			type: 'line',
			source: 'lines',
			layout: { 'line-join': 'round', 'line-cap': 'round' },
			paint: {
				'line-color': ['get', 'color'],
				'line-width': ['case', ['boolean', ['feature-state', 'selected'], false], 5, 3]
			}
		});

		this.map.addLayer({
			id: 'lines-depth',
			type: 'line',
			source: 'lines',
			layout: { 'line-join': 'round', 'line-cap': 'round', visibility: 'none' },
			paint: {
				'line-width': 4,
				'line-color': [
					'step',
					['get', 'cost'],
					DEPTH_COST_COLORS[0],
					50_000_000,
					DEPTH_COST_COLORS[1],
					100_000_000,
					DEPTH_COST_COLORS[2],
					250_000_000,
					DEPTH_COST_COLORS[3],
					500_000_000,
					DEPTH_COST_COLORS[4],
					1_000_000_000,
					DEPTH_COST_COLORS[5],
					2_000_000_000,
					DEPTH_COST_COLORS[6]
				]
			}
		});

		this.map.addLayer({
			id: 'stations-halo',
			type: 'circle',
			source: 'stations',
			paint: {
				'circle-radius': 9,
				'circle-color': '#FFFFFF',
				'circle-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 0.8, 0],
				'circle-stroke-color': '#FFFFFF',
				'circle-stroke-width': 2,
				'circle-stroke-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 1, 0]
			}
		});

		this.map.addLayer({
			id: 'stations-points',
			type: 'circle',
			source: 'stations',
			paint: { 'circle-radius': 5, 'circle-color': '#0A0A0A', 'circle-stroke-width': 2, 'circle-stroke-color': '#FFFFFF' }
		});

		this.map.addLayer({
			id: 'station-queues',
			type: 'circle',
			source: 'stations',
			paint: {
				'circle-radius': [
					'interpolate',
					['linear'],
					['coalesce', ['feature-state', 'queueSize'], 0],
					0,
					0,
					1,
					3,
					50,
					10,
					200,
					18
				],
				'circle-color': '#F39C12',
				'circle-opacity': ['case', ['>', ['coalesce', ['feature-state', 'queueSize'], 0], 0], 0.6, 0],
				'circle-blur': 0.5
			}
		});

		this.map.addLayer({
			id: 'drawing-line-overlay',
			type: 'line',
			source: 'drawing-line',
			layout: { 'line-join': 'round', 'line-cap': 'round' },
			paint: { 'line-color': '#007AFF', 'line-width': 3, 'line-dasharray': [2, 2] }
		});

		this.map.addLayer({
			id: 'trains-layer',
			type: 'circle',
			source: 'trains',
			paint: {
				'circle-radius': 6,
				'circle-color': ['step', ['get', 'loadFactor'], '#4CAF50', 0.25, '#FFD60A', 0.75, '#FF5252'],
				'circle-stroke-color': '#FFFFFF',
				'circle-stroke-width': 2
			}
		});

		this.map.addLayer({
			id: 'journey-route',
			type: 'line',
			source: 'journey-route',
			layout: { 'line-join': 'round', 'line-cap': 'round' },
			paint: { 'line-color': '#FFFFFF', 'line-width': 6, 'line-dasharray': [0.5, 1.5] }
		});

		this.map.addLayer({
			id: 'journey-points',
			type: 'symbol',
			source: 'journey-points',
			layout: {
				'icon-image': ['match', ['get', 'type'], 'origin', 'marker-15', 'destination', 'marker-15', ''],
				'text-field': ['match', ['get', 'type'], 'origin', 'Origin', 'destination', 'Destination', ''],
				'text-font': ['Open Sans Bold'],
				'text-size': 14,
				'text-offset': [0, -1.8],
				'icon-allow-overlap': true,
				'text-allow-overlap': true
			},
			paint: {
				'text-color': '#fff',
				'text-halo-color': '#000',
				'text-halo-width': 1,
				'icon-color': ['match', ['get', 'type'], 'origin', '#34C759', 'destination', '#FF3B30', '#000']
			}
		});
	}

	private subscribeToStores() {
		this.unsubscribers.forEach((fn) => fn());
		this.unsubscribers = [
			linesStore.subscribe((collection) => this.updateSource('lines', collection)),
			stationsStore.subscribe((collection) => this.updateSource('stations', collection)),
			trainsStore.subscribe((collection) => this.updateSource('trains', collection)),
			demandStore.subscribe((collection) => this.updateSource('demand', collection)),
			layerVisibilityStore.subscribe((layers) => this.syncLayerVisibility(layers)),
			selectedLineId.subscribe((lineId) => this.highlightLine(lineId)),
			stationQueuesStore.subscribe((queues) => this.syncStationQueues(queues)),
			journeyRoute.subscribe((route) => this.renderJourneyRoute(route)),
			journeyOrigin.subscribe(() => this.updateJourneyPoints()),
			journeyDestination.subscribe(() => this.updateJourneyPoints())
		];
	}

	private updateSource(sourceId: string, data: FeatureCollection<any>) {
		if (!this.map) return;
		const source = this.map.getSource(sourceId) as mapboxgl.GeoJSONSource | undefined;
		if (source) {
			source.setData(data);
		}
	}

	private syncStationQueues(queues: Record<string, number>) {
		if (!this.map) return;
		Object.entries(queues).forEach(([id, value]) => {
			this.map!.setFeatureState({ source: 'stations', id }, { queueSize: value });
		});
	}

	private syncLayerVisibility(layers: { [key: string]: boolean }) {
		if (!this.map) return;
		this.setLayerVisibility('lines-main', layers.tracks && !layers.depth);
		this.setLayerVisibility('lines-glow', layers.tracks && !layers.depth);
		this.setLayerVisibility('lines-depth', layers.depth);
		this.setLayerVisibility('stations-halo', layers.stations);
		this.setLayerVisibility('stations-points', layers.stations);
		this.setLayerVisibility('station-queues', layers.stations);
		this.setLayerVisibility('trains-layer', layers.trains);
		this.setLayerVisibility('demand-bubbles', layers.demand);
	}

	private setLayerVisibility(layerId: string, visible: boolean) {
		if (!this.map || !this.map.getLayer(layerId)) return;
		this.map.setLayoutProperty(layerId, 'visibility', visible ? 'visible' : 'none');
	}

	private highlightLine(lineId: string | number | null) {
		if (!this.map) return;
		const previousId = (this.map as any).__selectedLineId as string | number | undefined;
		if (previousId) {
			this.map.setFeatureState({ source: 'lines', id: previousId }, { selected: false });
		}
		if (lineId != null) {
			this.map.setFeatureState({ source: 'lines', id: lineId }, { selected: true });
			(this.map as any).__selectedLineId = lineId;
		}
	}

	private onMouseMove(event: mapboxgl.MapMouseEvent & mapboxgl.EventData) {
		if (!this.map) return;
		const currentMode = get(mode);
		if (currentMode !== 'draw-track') {
			this.map.getCanvas().style.cursor = '';
			return;
		}
		const queryBox: [LngLatLike, LngLatLike] = [
			[event.point.x - 15, event.point.y - 15],
			[event.point.x + 15, event.point.y + 15]
		];
		const nearbyStations = this.map.queryRenderedFeatures(queryBox, { layers: ['stations-points'] });
		let snappedPoint: number[] = [event.lngLat.lng, event.lngLat.lat];

		if (this.hoveredStationId) {
			this.map.setFeatureState({ source: 'stations', id: this.hoveredStationId }, { hover: false });
			this.hoveredStationId = null;
		}
		if (nearbyStations.length > 0) {
			const closest = nearbyStations[0];
			snappedPoint = (closest.geometry as any).coordinates.slice();
			this.hoveredStationId = closest.id as string | number;
			this.map.setFeatureState({ source: 'stations', id: this.hoveredStationId }, { hover: true });
			this.map.getCanvas().style.cursor = 'pointer';
		} else {
			this.map.getCanvas().style.cursor = 'crosshair';
		}

		if (this.drawingLinePoints.length > 0) {
			const currentPoints = [...this.drawingLinePoints, snappedPoint];
			this.updateSource('drawing-line', {
				type: 'FeatureCollection',
				features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: currentPoints }, properties: {} }]
			});
		}
	}

	private onMapClick(event: mapboxgl.MapMouseEvent & mapboxgl.EventData) {
		if (!this.map) return;
		const currentMode = get(mode);
		const leftMode = get(leftPanelMode);
		const clickedPoint: number[] = [event.lngLat.lng, event.lngLat.lat];

		if (currentMode === 'set-origin') {
			journeyOrigin.set(clickedPoint);
			mode.set('none');
			this.updateJourneyPoints();
			this.requestJourneyPlan();
			return;
		}

		if (currentMode === 'set-destination') {
			journeyDestination.set(clickedPoint);
			mode.set('none');
			this.updateJourneyPoints();
			this.requestJourneyPlan();
			return;
		}

		if (currentMode === 'draw-track') {
			const finalPoint = this.snapToStation(event) ?? clickedPoint;
			this.drawingLinePoints.push(finalPoint);
			this.updateSource('drawing-line', {
				type: 'FeatureCollection',
				features: [
					{
						type: 'Feature',
						geometry: { type: 'LineString', coordinates: this.drawingLinePoints },
						properties: {}
					}
				]
			});
			drawingPointsStore.set([...this.drawingLinePoints]);
		} else if (currentMode === 'place-station') {
			this.addStation(clickedPoint);
		} else if (currentMode === 'delete') {
			this.deleteFeature(event);
		} else if (leftMode === 'route-details') {
			const features = this.map.queryRenderedFeatures(event.point, { layers: ['lines-main'] });
			if (features.length > 0) {
				selectedLineId.set(features[0].id as string | number);
			}
		} else if (leftMode === 'demand-details') {
			const features = this.map.queryRenderedFeatures(event.point, { layers: ['demand-bubbles'] });
			if (features.length > 0) {
				selectedDemand.set((features[0].geometry as any).coordinates);
			}
		}
	}

	private snapToStation(event: mapboxgl.MapMouseEvent & mapboxgl.EventData) {
		if (!this.map) return null;
		const queryBox: [LngLatLike, LngLatLike] = [
			[event.point.x - 15, event.point.y - 15],
			[event.point.x + 15, event.point.y + 15]
		];
		const nearbyStations = this.map.queryRenderedFeatures(queryBox, { layers: ['stations-points'] });
		if (nearbyStations.length > 0) {
			return (nearbyStations[0].geometry as any).coordinates.slice();
		}
		return null;
	}

	private addStation(coords: number[]) {
		const collection = get(stationsStore);
		const station = {
			type: 'Feature',
			geometry: { type: 'Point', coordinates: coords },
			properties: { id: this.nextStationId, name: `Station ${this.nextStationId}`, cost: STATION_BUILD_COST },
			id: this.nextStationId
		};
		this.nextStationId += 1;
		stationsStore.set({
			...collection,
			features: [...collection.features, station]
		});
		(window as any).__simWorker?.postMessage({
			type: 'BUILD_INFRASTRUCTURE',
			payload: { cost: STATION_BUILD_COST }
		});
	}

	private deleteFeature(event: mapboxgl.MapMouseEvent & mapboxgl.EventData) {
		const features = this.map?.queryRenderedFeatures(event.point, { layers: ['lines-main', 'stations-points'] });
		if (!features || features.length === 0) return;
		const feature = features[0];
		if (feature.source === 'lines') {
			const collection = get(linesStore);
			linesStore.set({
				...collection,
				features: collection.features.filter((f) => f.id !== feature.id)
			});
		} else if (feature.source === 'stations') {
			const collection = get(stationsStore);
			stationsStore.set({
				...collection,
				features: collection.features.filter((f) => f.id !== feature.id)
			});
		}
	}

	public undoLastPoint = () => {
		if (this.drawingLinePoints.length === 0) return;
		this.drawingLinePoints.pop();
		this.updateSource('drawing-line', {
			type: 'FeatureCollection',
			features: this.drawingLinePoints.length
				? [
					{
						type: 'Feature',
						geometry: { type: 'LineString', coordinates: this.drawingLinePoints },
						properties: {}
					}
				  ]
				: []
		});
		drawingPointsStore.set([...this.drawingLinePoints]);
	};

	public cancelDrawing = () => {
		this.resetDrawingState();
	};

	private resetDrawingState() {
		this.drawingLinePoints = [];
		this.updateSource('drawing-line', { type: 'FeatureCollection', features: [] });
		drawingPointsStore.set([]);
	}

	private updateJourneyPoints() {
		const origin = get(journeyOrigin);
		const destination = get(journeyDestination);
		const features = [] as any[];
		if (origin) {
			features.push({
				type: 'Feature',
				geometry: { type: 'Point', coordinates: origin },
				properties: { type: 'origin' }
			});
		}
		if (destination) {
			features.push({
				type: 'Feature',
				geometry: { type: 'Point', coordinates: destination },
				properties: { type: 'destination' }
			});
		}
		this.updateSource('journey-points', { type: 'FeatureCollection', features });
	}

	private requestJourneyPlan() {
		const origin = get(journeyOrigin);
		const destination = get(journeyDestination);
		if (!origin || !destination) return;
		(window as any).__simWorker?.postMessage({
			type: 'PLAN_JOURNEY',
			payload: { origin, destination }
		});
	}

private renderJourneyRoute(route: JourneyRoute | null) {
		if (!route) {
			this.updateSource('journey-route', { type: 'FeatureCollection', features: [] });
			return;
		}
		const coords = route.legs.flatMap((leg) => leg.coords);
		this.updateSource('journey-route', {
			type: 'FeatureCollection',
			features: coords.length
				? [{ type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: {} }]
				: []
		});
	}

	private turfDistance(from: number[], to: number[]) {
		const R = 6371;
		const dLat = ((to[1] - from[1]) * Math.PI) / 180;
		const dLon = ((to[0] - from[0]) * Math.PI) / 180;
		const a =
			Math.sin(dLat / 2) ** 2 +
			Math.cos((from[1] * Math.PI) / 180) *
				Math.cos((to[1] * Math.PI) / 180) *
				Math.sin(dLon / 2) ** 2;
		const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
		return R * c * 1000;
	}
}
