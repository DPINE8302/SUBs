import { writable, derived } from 'svelte/store';
import type {
	FeatureCollection,
	JourneyRoute,
	Mode,
	LeftPanelMode,
	DemandDetail,
	IncidentRecord,
	HistoryPoint
} from './types';

export const mapLoaded = writable(false);
export const mapError = writable<string | null>(null);
export const mode = writable<Mode>('none');
export const leftPanelMode = writable<LeftPanelMode>('construction');
export const usingFallbackStyle = writable(false);

export const linesStore = writable<FeatureCollection<LineStringGeometry>>({
	type: 'FeatureCollection',
	features: []
});
export const stationsStore = writable<FeatureCollection<PointGeometry>>({
	type: 'FeatureCollection',
	features: []
});
export const trainsStore = writable<FeatureCollection<PointGeometry>>({
	type: 'FeatureCollection',
	features: []
});
export const demandStore = writable<FeatureCollection<PointGeometry>>({
	type: 'FeatureCollection',
	features: []
});
export const drawingPointsStore = writable<number[][]>([]);

export const selectedLineId = writable<number | string | null>(null);
export const selectedDemand = writable<number[] | null>(null);
export const journeyRoute = writable<JourneyRoute | null>(null);
export const journeyOrigin = writable<number[] | null>(null);
export const journeyDestination = writable<number[] | null>(null);

export const budgetStore = writable(5_000_000_000);
export const cashflowStore = writable(0);
export const ridershipStore = writable(0);
export const waitTimeStore = writable(0);
export const trainsCountStore = derived(trainsStore, ($trainsStore) => $trainsStore.features.length);
export const simClockStore = writable({
	day: 1,
	hour: 0,
	minute: 0
});
export const stationRidershipStore = writable<Record<string, number>>({});
export const lineRidershipStore = writable<Record<string, number>>({});
export const stationQueuesStore = writable<Record<string, number>>({});
export const demandDetailsStore = writable<DemandDetail | null>(null);
export const incidentsStore = writable<{ active: IncidentRecord[]; history: IncidentRecord[] }>({ active: [], history: [] });
export const ridershipHistoryStore = writable<HistoryPoint[]>([]);

type PointGeometry = { type: 'Point'; coordinates: number[] };
type LineStringGeometry = { type: 'LineString'; coordinates: number[][] };

export const layerVisibilityStore = writable({
	tracks: true,
	stations: true,
	trains: true,
	depth: false,
	demand: false
});

export const mapSettingsStore = writable({
	token: '',
	styleUrl: '',
	tileLayer: ''
});
export const mapControllerStore = writable<import('$lib/map/manager').MapController | null>(null);

export const hasMapCredentials = derived(mapSettingsStore, ($settings) => Boolean($settings.token && $settings.styleUrl));
