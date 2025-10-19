import {
	linesStore,
	stationsStore,
	demandStore,
	selectedLineId
} from '$lib/stores';
import type { FeatureCollection } from '$lib/types';

export async function loadDemoScenario(): Promise<void> {
	try {
		const [networkRes, demandRes] = await Promise.all([
			fetch('/data/demo/network.json'),
			fetch('/data/demo/demand_grid.json')
		]);

		if (!networkRes.ok) throw new Error('Failed to load network.json');
		if (!demandRes.ok) throw new Error('Failed to load demand grid');

		const networkJson = await networkRes.json();
		const demandJson = (await demandRes.json()) as FeatureCollection<{ type: 'Point'; coordinates: number[] }>;

		const lines = networkJson.lines as FeatureCollection<{ type: 'LineString'; coordinates: number[][] }>;
		const stations = networkJson.stations as FeatureCollection<{ type: 'Point'; coordinates: number[] }>;

		linesStore.set(lines);
		stationsStore.set(stations);
		demandStore.set(demandJson);

		if (lines.features.length > 0) {
			selectedLineId.set(lines.features[0].id ?? (lines.features[0].properties?.id as number | string | undefined) ?? null);
		}
	} catch (error) {
		console.error('Demo scenario load failed:', error);
	}
}
