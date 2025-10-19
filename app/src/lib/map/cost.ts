import type { BuildMethod, TrackCount } from '$lib/types';

export const STATION_BUILD_COST = 25_000_000;
export const BASE_TRACK_COST_PER_METER = 5000;

function turfDistance(from: number[], to: number[]) {
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

export function calculateLineCost(
	points: number[][],
	buildMethod: BuildMethod,
	trackCount: TrackCount,
	elevation: number
) {
	if (!points || points.length < 2) return 0;
	let totalDistance = 0;
	for (let i = 0; i < points.length - 1; i += 1) {
		totalDistance += turfDistance(points[i], points[i + 1]);
	}
	const depthMultiplier = 1 + (Math.abs(elevation) / 40) * 2;
	const methodMultiplier = buildMethod === 'tbm' ? 1.8 : buildMethod === 'viaduct' ? 1.4 : 1.0;
	const trackMultiplier = trackCount === 'single' ? 1.0 : trackCount === 'parallel' ? 1.9 : 3.5;
	return totalDistance * BASE_TRACK_COST_PER_METER * depthMultiplier * methodMultiplier * trackMultiplier;
}
