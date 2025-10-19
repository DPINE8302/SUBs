/* eslint-disable @typescript-eslint/ban-ts-comment */
/// <reference lib="webworker" />

type Point = { type: 'Point'; coordinates: number[] };
type LineString = { type: 'LineString'; coordinates: number[][] };
type Feature<T> = { type: 'Feature'; geometry: T; properties: Record<string, any>; id?: number | string };
type FeatureCollection<T> = { type: 'FeatureCollection'; features: Feature<T>[] };

interface SimStation {
	id: number | string;
	coords: number[];
	name: string;
	lines: Set<number | string>;
}

interface SimLine {
	id: number | string;
	coords: number[][];
	length: number;
	stationDistances: { id: number | string; distance: number }[];
	headway: number;
}

interface Passenger {
	id: number;
	originStationId: number | string;
	destinationStationId: number | string;
	route: Route | null;
	currentLegIndex: number;
	spawnTime: number;
}

interface Train {
	id: number;
	lineId: number | string;
	distanceAlongLine: number;
	speed: number;
	direction: 1 | -1;
	state: 'moving' | 'dwelling';
	dwellTimeRemaining: number;
	currentStationIndex: number;
	passengers: Passenger[];
	capacity: number;
}

interface RouteLeg {
	lineId: number | string;
	fromStationId: number | string;
	toStationId: number | string;
	rideTime: number;
	coords: number[][];
}

interface Route {
	legs: RouteLeg[];
	totalTime: number;
	waitTime: number;
	rideTime: number;
}

interface Incident {
	id: number;
	type: 'speed_cap' | 'extra_dwell';
	message: string;
	targetId: number | string;
	expiresAt: number;
	value: number;
}

type WorkerInboundMessage =
	| { type: 'START' }
	| { type: 'PAUSE' }
	| { type: 'UPDATE_NETWORK'; payload: { lines: Feature<LineString>[]; stations: Feature<Point>[] } }
	| { type: 'BUILD_INFRASTRUCTURE'; payload: { cost: number } }
	| { type: 'PLAN_JOURNEY'; payload: { origin: number[]; destination: number[] } }
	| { type: 'GET_DEMAND_GRID' }
	| { type: 'SET_DEMAND_GRID'; payload: FeatureCollection<Point> }
	| { type: 'GET_DEMAND_DETAILS'; payload: { coords: number[] } };

const ctx: DedicatedWorkerGlobalScope = self as DedicatedWorkerGlobalScope;

const SIM_TICK_MS = 100;
const TIME_MULTIPLIER = 120;
const TICK_SECONDS = (SIM_TICK_MS / 1000) * TIME_MULTIPLIER;

const TRAIN_ACCELERATION = 0.8;
const MAX_TRAIN_SPEED = 22.22;
const BASE_DWELL_TIME = 20;
const TRAIN_CAPACITY = 200;
const TRAINS_PER_LINE = 4;
const FARE_PER_KM = 0.15;
const OPEX_PER_TRAIN_KM = 5;
const OPEX_PER_STATION_HOUR = 50;
const INCIDENT_RATE_PER_10K_KM = 0.5;
const WALK_SPEED_MPS = 1.4;

const STATION_BUILD_COST = 25_000_000;

const HOURLY_MULTIPLIERS = [
	0.1, 0.1, 0.1, 0.1, 0.2, 0.5, 0.8, 1.2, 1.5, 1.2, 0.8, 0.7, 0.7, 0.6, 0.8, 1.0, 1.4, 1.6, 1.3, 0.9, 0.6, 0.4, 0.2, 0.1
];

let linesOrigin: Feature<LineString>[] = [];
let stationsOrigin: Feature<Point>[] = [];

let simTime = 0;
let simulationInterval: number | null = null;
let running = false;

const trains: Train[] = [];
const simLines: Record<number | string, SimLine> = {};
const simStations: Record<number | string, SimStation> = {};
const stationQueues: Record<number | string, Passenger[]> = {};
const allPassengers: Record<number, Passenger> = {};

let nextTrainId = 1;
let nextPassengerId = 1;
let nextIncidentId = 1;
let totalRidership = 0;

let budget = 5_000_000_000;
let cashflowPerHour = 0;
let totalPassengerWaitTime = 0;
let completedTrips = 0;
let dailyStationRidership: Record<string, number> = {};
let dailyLineRidership: Record<string, number> = {};
let lastDayRollover = 0;
let totalTrainKm = 0;
let lastIncidentKm = 0;
let totalRevenue = 0;
let totalOpex = 0;

const activeIncidents: Record<number, Incident> = {};

let DEMAND_GRID: FeatureCollection<Point> | null = null;
let TOTAL_DEMAND = 0;

const postMessage = (type: string, payload?: any) => {
	ctx.postMessage({ type, payload });
};

const turfDistance = (from: number[], to: number[]) => {
	const R = 6371;
	const dLat = ((to[1] - from[1]) * Math.PI) / 180;
	const dLon = ((to[0] - from[0]) * Math.PI) / 180;
	const a =
		Math.sin(dLat / 2) ** 2 +
		Math.cos((from[1] * Math.PI) / 180) * Math.cos((to[1] * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
	const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
	return R * c * 1000;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const resetSimulation = () => {
	Object.keys(simLines).forEach((key) => delete simLines[key]);
	Object.keys(simStations).forEach((key) => delete simStations[key]);
	Object.keys(stationQueues).forEach((key) => delete stationQueues[key]);
	trains.length = 0;
	nextTrainId = 1;
	nextPassengerId = 1;
	totalRidership = 0;
	totalPassengerWaitTime = 0;
	completedTrips = 0;
	totalRevenue = 0;
	totalOpex = 0;
	cashflowPerHour = 0;
};

const addStationToSimulation = (feature: Feature<Point>) => {
	const id = feature.properties.id ?? feature.id ?? `${feature.geometry.coordinates.join(',')}`;
	const simStation: SimStation = {
		id,
		coords: feature.geometry.coordinates,
		name: feature.properties.name ?? `Station ${id}`,
		lines: new Set()
	};
	simStations[id] = simStation;
	stationQueues[id] = [];
};

const prepareLines = () => {
	linesOrigin.forEach((lineFeature) => {
		if (!lineFeature.geometry.coordinates || lineFeature.geometry.coordinates.length < 2) return;
		const id = lineFeature.properties.id ?? lineFeature.id ?? `line-${nextTrainId++}`;
		const coords = lineFeature.geometry.coordinates;
		let totalLength = 0;
		const stationDistances: { id: number | string; distance: number }[] = [];

		for (let i = 0; i < coords.length - 1; i += 1) {
			const start = coords[i];
			const end = coords[i + 1];
			totalLength += turfDistance(start, end);
		}

		const uniqueStationIds = new Set<number | string>();

		coords.forEach((coord, index) => {
			const station = Object.values(simStations).find((s) => {
				const dist = turfDistance(s.coords, coord);
				return dist < 50;
			});
			if (station) {
				const snapshotDistance = coords
					.slice(0, index)
					.reduce((acc, point, idx) => acc + turfDistance(point, coords[idx + 1]), 0);
				stationDistances.push({ id: station.id, distance: snapshotDistance });
				station.lines.add(id);
				uniqueStationIds.add(station.id);
			}
		});

		if (stationDistances.length < 2) return;

		stationDistances.sort((a, b) => a.distance - b.distance);

		const simLine: SimLine = {
			id,
			coords,
			length: totalLength,
			stationDistances,
			headway: Math.max(120, (stationDistances.length - 1) * 90)
		};
		simLines[id] = simLine;
	});
};

const spawnTrainsForLine = (line: SimLine) => {
	if (line.stationDistances.length < 2) return;
	const spacing = line.length / TRAINS_PER_LINE;
	for (let i = 0; i < TRAINS_PER_LINE; i += 1) {
		trains.push({
			id: nextTrainId++,
			lineId: line.id,
			distanceAlongLine: spacing * i,
			speed: 0,
			direction: 1,
			state: 'moving',
			dwellTimeRemaining: 0,
			currentStationIndex: -1,
			passengers: [],
			capacity: TRAIN_CAPACITY
		});
	}
};

const updateNetwork = (lines: Feature<LineString>[], stations: Feature<Point>[]) => {
	linesOrigin = lines;
	stationsOrigin = stations;
	resetSimulation();
	stationsOrigin.forEach(addStationToSimulation);
	prepareLines();
	Object.values(simLines).forEach(spawnTrainsForLine);
	postMessage('NETWORK_READY');
};

const startSimulation = () => {
	if (!simulationInterval) {
		simulationInterval = ctx.setInterval(simulationTick, SIM_TICK_MS);
		running = true;
	}
};

const pauseSimulation = () => {
	if (simulationInterval) {
		ctx.clearInterval(simulationInterval);
		simulationInterval = null;
	}
	running = false;
};

const getPointAlongLine = (line: SimLine, distance: number) => {
	if (distance <= 0) return line.coords[0];
	let distanceTraveled = 0;
	for (let i = 0; i < line.coords.length - 1; i += 1) {
		const start = line.coords[i];
		const end = line.coords[i + 1];
		const segmentLength = turfDistance(start, end);
		if (distanceTraveled + segmentLength >= distance) {
			const remaining = distance - distanceTraveled;
			const ratio = remaining / segmentLength;
			return [
				start[0] + (end[0] - start[0]) * ratio,
				start[1] + (end[1] - start[1]) * ratio
			];
		}
		distanceTraveled += segmentLength;
	}
	return line.coords[line.coords.length - 1];
};

const getNextStation = (train: Train, line: SimLine) => {
	let nextStation = null as { id: number | string; distance: number } | null;
	let distToNext = Infinity;

	if (train.direction === 1) {
		for (const station of line.stationDistances) {
			if (station.distance > train.distanceAlongLine) {
				const dist = station.distance - train.distanceAlongLine;
				if (dist < distToNext) {
					distToNext = dist;
					nextStation = station;
				}
			}
		}
	} else {
		for (let i = line.stationDistances.length - 1; i >= 0; i -= 1) {
			const station = line.stationDistances[i];
			if (station.distance < train.distanceAlongLine) {
				const dist = train.distanceAlongLine - station.distance;
				if (dist < distToNext) {
					distToNext = dist;
					nextStation = station;
				}
			}
		}
	}
	return { nextStation, distToNextStation: distToNext };
};

const findNearestStation = (coords: number[]) => {
	let closest: SimStation | null = null;
	let minDistance = Infinity;
	Object.values(simStations).forEach((station) => {
		const dist = turfDistance(coords, station.coords);
		if (dist < minDistance) {
			minDistance = dist;
			closest = station;
		}
	});
	return closest;
};

const isTrainHeadingToStation = (train: Train, targetStationId: number | string) => {
	const line = simLines[train.lineId];
	if (!line) return false;
	const target = line.stationDistances.find((s) => s.id === targetStationId);
	if (!target) return false;
	return train.direction === 1
		? target.distance > train.distanceAlongLine
		: target.distance < train.distanceAlongLine;
};

const findRoute = (originStationId: number | string, destStationId: number | string): Route | null => {
	const queue: { stationId: number | string; path: RouteLeg[]; wait: number }[] = [
		{ stationId: originStationId, path: [], wait: 0 }
	];
	const visited = new Set<number | string>([originStationId]);

	while (queue.length > 0) {
		const current = queue.shift()!;
		if (current.stationId === destStationId) {
			const totalRide = current.path.reduce((sum, leg) => sum + leg.rideTime, 0);
			const waitTime = current.path.length * 90;
			return {
				legs: current.path,
				totalTime: totalRide + waitTime,
				waitTime,
				rideTime: totalRide
			};
		}
		const station = simStations[current.stationId];
		if (!station) continue;

		station.lines.forEach((lineId) => {
			const line = simLines[lineId];
			if (!line) return;
			const stationIndex = line.stationDistances.findIndex((sd) => sd.id === station.id);
			if (stationIndex === -1) return;

			[-1, 1].forEach((dir) => {
				let i = stationIndex + dir;
				while (i >= 0 && i < line.stationDistances.length) {
					const neighbor = line.stationDistances[i];
					if (!visited.has(neighbor.id)) {
						const rideDist = Math.abs(neighbor.distance - line.stationDistances[stationIndex].distance);
						const leg: RouteLeg = {
							lineId,
							fromStationId: station.id,
							toStationId: neighbor.id,
							rideTime: (rideDist / 500) * 60,
							coords: extractLineSegment(line, station.id, neighbor.id)
						};
						queue.push({ stationId: neighbor.id, path: [...current.path, leg], wait: current.wait + 1 });
						visited.add(neighbor.id);
					}
					i += dir;
				}
			});
		});
	}
	return null;
};

const extractLineSegment = (line: SimLine, fromId: number | string, toId: number | string) => {
	const fromIdx = line.stationDistances.findIndex((sd) => sd.id === fromId);
	const toIdx = line.stationDistances.findIndex((sd) => sd.id === toId);
	if (fromIdx === -1 || toIdx === -1) return line.coords;
	const start = Math.min(fromIdx, toIdx);
	const end = Math.max(fromIdx, toIdx);
	return line.coords.slice(start, end + 1);
};

const spawnPassengers = (hour: number) => {
	if (!DEMAND_GRID || Object.keys(simStations).length === 0) return;
	const hourlyMultiplier = HOURLY_MULTIPLIERS[hour];
	const passengersToSpawn = Math.round((TOTAL_DEMAND / 86400) * TICK_SECONDS * hourlyMultiplier * 40);
	for (let i = 0; i < passengersToSpawn; i += 1) {
		const originPoint = DEMAND_GRID.features[Math.floor(Math.random() * DEMAND_GRID.features.length)];
		const destPoint = DEMAND_GRID.features[Math.floor(Math.random() * DEMAND_GRID.features.length)];
		if (!originPoint || !destPoint || originPoint === destPoint) continue;
		const originStation = findNearestStation(originPoint.geometry.coordinates);
		const destStation = findNearestStation(destPoint.geometry.coordinates);
		if (!originStation || !destStation || originStation.id === destStation.id) continue;
		const passenger: Passenger = {
			id: nextPassengerId++,
			originStationId: originStation.id,
			destinationStationId: destStation.id,
			route: null,
			currentLegIndex: 0,
			spawnTime: simTime
		};
		allPassengers[passenger.id] = passenger;
		stationQueues[originStation.id].push(passenger);
	}
};

const handleStationArrival = (train: Train, line: SimLine, stationDist: { id: number | string; distance: number }) => {
	train.speed = 0;
	train.state = 'dwelling';
	train.distanceAlongLine = stationDist.distance;
	const station = simStations[stationDist.id];
	if (!station) return;

	const stationIdx = line.stationDistances.findIndex((sd) => sd.id === station.id);
	train.currentStationIndex = stationIdx;

	const alighting: Passenger[] = [];
	train.passengers = train.passengers.filter((p) => {
		if (!p.route) return false;
		const leg = p.route.legs[p.currentLegIndex];
		if (leg && leg.toStationId === station.id) {
			alighting.push(p);
			return false;
		}
		return true;
	});

	alighting.forEach((passenger) => {
		passenger.currentLegIndex += 1;
		if (!passenger.route || passenger.currentLegIndex >= passenger.route.legs.length) {
			totalPassengerWaitTime += simTime - passenger.spawnTime;
			completedTrips += 1;
			totalRidership += 1;
			delete allPassengers[passenger.id];
			const originId = passenger.originStationId;
			const destId = passenger.destinationStationId;
			dailyStationRidership[String(originId)] = (dailyStationRidership[String(originId)] || 0) + 1;
			dailyStationRidership[String(destId)] = (dailyStationRidership[String(destId)] || 0) + 1;
			passenger.route?.legs.forEach((leg) => {
				dailyLineRidership[String(leg.lineId)] = (dailyLineRidership[String(leg.lineId)] || 0) + 1;
			});
			const routeDist =
				passenger.route?.legs.reduce((sum, leg) => {
					const legLine = simLines[leg.lineId];
					const from = legLine.stationDistances.find((s) => s.id === leg.fromStationId)?.distance ?? 0;
					const to = legLine.stationDistances.find((s) => s.id === leg.toStationId)?.distance ?? 0;
					return sum + Math.abs(to - from);
				}, 0) ?? 0;
			totalRevenue += (routeDist / 1000) * FARE_PER_KM;
		} else {
			stationQueues[station.id].push(passenger);
		}
	});

	let boarding = 0;
	const queue = stationQueues[station.id];
	if (queue) {
		stationQueues[station.id] = queue.filter((passenger) => {
			if (train.passengers.length >= train.capacity) return true;
			if (!passenger.route) {
				passenger.route = findRoute(passenger.originStationId, passenger.destinationStationId);
				passenger.currentLegIndex = 0;
			}
			const leg = passenger.route?.legs[passenger.currentLegIndex];
			if (leg && leg.lineId === train.lineId && isTrainHeadingToStation(train, leg.toStationId)) {
				train.passengers.push(passenger);
				boarding += 1;
				return false;
			}
			return true;
		});
	}

	let dwellTime = BASE_DWELL_TIME + (alighting.length + boarding) * 0.25;
	Object.values(activeIncidents).forEach((incident) => {
		if (incident.type === 'extra_dwell' && incident.targetId === station.id) {
			dwellTime += incident.value;
		}
	});
	train.dwellTimeRemaining = dwellTime;
};

const updateTrains = () => {
	let distanceTraveledThisTick = 0;
	trains.forEach((train) => {
		const line = simLines[train.lineId];
		if (!line || line.stationDistances.length < 2) return;

		if (train.state === 'dwelling') {
			train.dwellTimeRemaining -= TICK_SECONDS;
			if (train.dwellTimeRemaining <= 0) {
				train.state = 'moving';
				train.currentStationIndex = -1;
			}
			return;
		}

		const { nextStation, distToNextStation } = getNextStation(train, line);
		const brakingDistance = (train.speed * train.speed) / (2 * TRAIN_ACCELERATION);
		let targetSpeed = MAX_TRAIN_SPEED;

		Object.values(activeIncidents).forEach((incident) => {
			if (incident.type === 'speed_cap' && incident.targetId === train.id) {
				targetSpeed = Math.min(targetSpeed, incident.value);
			}
		});

		if (distToNextStation < brakingDistance) {
			train.speed = clamp(train.speed - TRAIN_ACCELERATION * TICK_SECONDS, 0, targetSpeed);
		} else {
			train.speed = clamp(train.speed + TRAIN_ACCELERATION * TICK_SECONDS, 0, targetSpeed);
		}

		const distanceMoved = train.speed * TICK_SECONDS;
		distanceTraveledThisTick += distanceMoved;
		train.distanceAlongLine += distanceMoved * train.direction;

		if (distToNextStation <= distanceMoved && nextStation) {
			handleStationArrival(train, line, nextStation);
		}

		if (train.distanceAlongLine >= line.length) {
			train.distanceAlongLine = line.length;
			train.direction = -1;
		} else if (train.distanceAlongLine <= 0) {
			train.distanceAlongLine = 0;
			train.direction = 1;
		}
	});
	totalTrainKm += distanceTraveledThisTick / 1000;
};

const updateEconomics = () => {
	const trainKmCost = totalTrainKm * OPEX_PER_TRAIN_KM;
	const stationHoursCost =
		Object.keys(simStations).length *
		(OPEX_PER_STATION_HOUR * (TICK_SECONDS / 3600));
	totalOpex += trainKmCost + stationHoursCost;
	const revenuePerHour = totalRevenue / Math.max(simTime / 3600, 1);
	const opexPerHour = totalOpex / Math.max(simTime / 3600, 1);
	cashflowPerHour = revenuePerHour - opexPerHour;
	budget += (cashflowPerHour / 3600) * TICK_SECONDS;
};

const checkForIncidents = () => {
	if (totalTrainKm - lastIncidentKm < 10000 / Math.max(INCIDENT_RATE_PER_10K_KM, 0.01)) return;
	lastIncidentKm = totalTrainKm;
	const incidentId = nextIncidentId++;
	if (Math.random() < 0.5) {
		const randomTrain = trains[Math.floor(Math.random() * trains.length)];
		if (!randomTrain) return;
		const incident: Incident = {
			id: incidentId,
			type: 'speed_cap',
			message: `Speed restriction on Train ${randomTrain.id}`,
			targetId: randomTrain.id,
			expiresAt: simTime + 1800,
			value: MAX_TRAIN_SPEED * 0.6
		};
		activeIncidents[incidentId] = incident;
		postMessage('INCIDENT_EVENT', { ...incident, active: true });
	} else {
		const stations = Object.values(simStations);
		const randomStation = stations[Math.floor(Math.random() * stations.length)];
		if (!randomStation) return;
		const incident: Incident = {
			id: incidentId,
			type: 'extra_dwell',
			message: `Delays at ${randomStation.name}`,
			targetId: randomStation.id,
			expiresAt: simTime + 1200,
			value: 15
		};
		activeIncidents[incidentId] = incident;
		postMessage('INCIDENT_EVENT', { ...incident, active: true });
	}
};

const cleanupIncidents = () => {
	Object.values(activeIncidents).forEach((incident) => {
		if (incident.expiresAt <= simTime) {
			postMessage('INCIDENT_EVENT', { ...incident, active: false });
			delete activeIncidents[incident.id];
		}
	});
};

const buildTrainFeatures = () => {
	return trains.map((train) => {
		const line = simLines[train.lineId];
		const coords = line ? getPointAlongLine(line, clamp(train.distanceAlongLine, 0, line.length)) : [0, 0];
		const loadFactor = train.capacity > 0 ? train.passengers.length / train.capacity : 0;
		return {
			type: 'Feature' as const,
			geometry: { type: 'Point' as const, coordinates: coords ?? [0, 0] },
			properties: { id: train.id, loadFactor }
		};
	});
};

const simulationTick = () => {
	simTime += TICK_SECONDS;
	const currentHour = Math.floor((simTime % 86400) / 3600);
	if (Math.floor(simTime / 86400) > Math.floor(lastDayRollover / 86400)) {
		dailyStationRidership = {};
		dailyLineRidership = {};
		lastDayRollover = simTime;
	}

	spawnPassengers(currentHour);
	updateTrains();
	updateEconomics();
	checkForIncidents();
	cleanupIncidents();

	const trainFeatures = buildTrainFeatures();
	const queueSizes: Record<string, number> = {};
	Object.keys(stationQueues).forEach((id) => {
		queueSizes[id] = stationQueues[id].length;
	});

	postMessage('TICK', {
		trains: { type: 'FeatureCollection', features: trainFeatures },
		simTime,
		stationQueues: queueSizes,
		totalRidership,
		budget,
		cashflowPerHour,
		avgWaitTime: completedTrips > 0 ? totalPassengerWaitTime / completedTrips : 0,
		dailyStationRidership,
		dailyLineRidership
	});
};

const createDemandGrid = () => {
	const grid: FeatureCollection<Point> = { type: 'FeatureCollection', features: [] };
	const bbox = [100.4, 13.7, 100.6, 13.8];
	const cells = 20;
	const width = (bbox[2] - bbox[0]) / cells;
	const height = (bbox[3] - bbox[1]) / cells;
	TOTAL_DEMAND = 0;
	for (let i = 0; i < cells; i += 1) {
		for (let j = 0; j < cells; j += 1) {
			const lng = bbox[0] + i * width;
			const lat = bbox[1] + j * height;
			const demand = Math.round(Math.random() * Math.random() * 200);
			if (demand > 8) {
				grid.features.push({
					type: 'Feature',
					geometry: { type: 'Point', coordinates: [lng, lat] },
					properties: { demand }
				});
				TOTAL_DEMAND += demand;
			}
		}
	}
	DEMAND_GRID = grid;
};

const setDemandGrid = (grid: FeatureCollection<Point>) => {
	DEMAND_GRID = grid;
	TOTAL_DEMAND = grid.features.reduce((sum, feature) => sum + (feature.properties?.demand ?? 0), 0);
};

const handlePlanJourney = (originCoords: number[], destCoords: number[]) => {
	const originStation = findNearestStation(originCoords);
	const destStation = findNearestStation(destCoords);
	if (!originStation || !destStation) return;
	const walkTo = turfDistance(originCoords, originStation.coords) / WALK_SPEED_MPS;
	const walkFrom = turfDistance(destCoords, destStation.coords) / WALK_SPEED_MPS;
	const route = findRoute(originStation.id, destStation.id);
	if (!route) {
		postMessage('JOURNEY_PLAN_RESULT', { route: null, walkToStationTime: walkTo, walkFromStationTime: walkFrom });
		return;
	}
	route.totalTime += walkTo + walkFrom;
	postMessage('JOURNEY_PLAN_RESULT', {
		route,
		walkToStationTime: walkTo,
		walkFromStationTime: walkFrom
	});
};

const handleDemandDetails = (coords: number[]) => {
	const nearbyStations = Object.values(simStations)
		.map((station) => ({ station, distance: turfDistance(coords, station.coords) }))
		.filter((entry) => entry.distance < 2000)
		.sort((a, b) => a.distance - b.distance)
		.slice(0, 5)
		.map(({ station, distance }) => ({
			id: station.id,
			name: station.name,
			distance,
			walkTime: distance / WALK_SPEED_MPS
		}));

	const hourlyDistribution = Array.from({ length: 12 }, () => Math.random());

	postMessage('DEMAND_DETAILS_RESULT', { coords, nearbyStations, hourlyDistribution });
};

const handleInfrastructureBuild = (cost: number) => {
	budget -= cost;
	if (budget < 0) budget = Math.max(budget, -5_000_000_000);
};

ctx.onmessage = (event: MessageEvent<WorkerInboundMessage>) => {
	const { type, payload } = event.data;
	switch (type) {
		case 'START':
			startSimulation();
			break;
		case 'PAUSE':
			pauseSimulation();
			break;
		case 'UPDATE_NETWORK':
			updateNetwork(payload.lines, payload.stations);
			break;
		case 'BUILD_INFRASTRUCTURE':
			handleInfrastructureBuild(payload.cost);
			break;
		case 'PLAN_JOURNEY':
			handlePlanJourney(payload.origin, payload.destination);
			break;
		case 'GET_DEMAND_GRID':
			if (!DEMAND_GRID) createDemandGrid();
			if (DEMAND_GRID) postMessage('DEMAND_GRID_DATA', DEMAND_GRID);
			break;
		case 'SET_DEMAND_GRID':
			setDemandGrid(payload);
			postMessage('DEMAND_GRID_DATA', payload);
			break;
		case 'GET_DEMAND_DETAILS':
			handleDemandDetails(payload.coords);
			break;
		default:
			// No-op
			break;
	}
};

postMessage('WORKER_READY');
