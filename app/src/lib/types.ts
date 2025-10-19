export type Mode = 'none' | 'draw-track' | 'place-station' | 'delete' | 'set-origin' | 'set-destination';
export type LeftPanelMode = 'construction' | 'journey-planner' | 'route-details' | 'demand-details';
export type TrackCount = 'single' | 'parallel' | 'quad';
export type BuildMethod = 'cut-and-cover' | 'tbm' | 'viaduct';

export type Feature<T> = { type: 'Feature'; geometry: T; properties: Record<string, unknown>; id?: number | string };
export type FeatureCollection<T> = { type: 'FeatureCollection'; features: Feature<T>[] };

export type StationFeature = Feature<{ type: 'Point'; coordinates: number[] }>;
export type LineFeature = Feature<{ type: 'LineString'; coordinates: number[][] }>;

export type JourneyLeg = {
	lineId: string | number;
	fromStationId: string | number;
	toStationId: string | number;
	rideTime: number;
	coords: number[][];
};

export type JourneyRoute = {
	legs: JourneyLeg[];
	totalTime: number;
	waitTime: number;
	rideTime: number;
};

export interface DemandBubble {
	type: 'Feature';
	geometry: { type: 'Point'; coordinates: number[] };
	properties: { demand: number };
}

export type DemandDetail = {
	coords: number[];
	nearbyStations: {
		id: number | string;
		name: string;
		distance: number;
		walkTime: number;
	}[];
	hourlyDistribution: number[];
};

export type IncidentRecord = {
	id: number;
	type: 'speed_cap' | 'extra_dwell';
	message: string;
	targetId: number | string;
	active: boolean;
	expiresAt: number;
	value: number;
};

export type HistoryPoint = {
	time: number;
	ridership: number;
	budget: number;
	cashflow: number;
};
