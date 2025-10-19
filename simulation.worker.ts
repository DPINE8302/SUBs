

// --- TYPE DEFINITIONS ---
type Point = { type: 'Point', coordinates: number[] };
type LineString = { type: 'LineString', coordinates: number[][] };
type Feature<T> = { type: 'Feature', geometry: T, properties: any, id?: number | string };
type FeatureCollection<T> = { type: 'FeatureCollection', features: Feature<T>[] };

interface SimStation {
    id: number | string;
    coords: number[];
    name: string;
    lines: Set<number|string>;
}

interface SimLine {
    id: number | string;
    coords: number[][];
    length: number;
    stationDistances: { id: number | string; distance: number }[];
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
    speed: number; // m/s
    direction: 1 | -1;
    state: 'moving' | 'dwelling';
    dwellTimeRemaining: number;
    currentStationIndex: number;
    passengers: Passenger[];
    capacity: number;
}

interface Route {
    legs: { lineId: string | number; fromStationId: string | number; toStationId: string | number }[];
}

interface JourneyLeg {
    lineId: string | number;
    fromStationId: string | number;
    toStationId: string | number;
    rideTime: number;
    coords: number[][];
}
interface JourneyRoute {
    legs: JourneyLeg[];
    totalTime: number;
    waitTime: number;
    rideTime: number;
}


interface Incident {
    id: number;
    type: 'speed_cap' | 'extra_dwell';
    message: string;
    targetId: number | string; // trainId or stationId
    expiresAt: number; // simTime when it ends
    value: number; // e.g. speed cap value or extra dwell seconds
}

// --- SIMULATION DATA ---
let DEMAND_GRID: FeatureCollection<Point> | null = null;
const HOURLY_MULTIPLIERS = [0.1, 0.1, 0.1, 0.1, 0.2, 0.5, 0.8, 1.2, 1.5, 1.2, 0.8, 0.7, 0.7, 0.6, 0.8, 1.0, 1.4, 1.6, 1.3, 0.9, 0.6, 0.4, 0.2, 0.1];
let TOTAL_DEMAND = 0;


// --- STATE ---
let simulationInterval: number | null = null;
let simTime = 0; // seconds
const trains: Train[] = [];
const simLines: { [id: number | string]: SimLine } = {};
const simStations: { [id: number | string]: SimStation } = {};
const stationQueues: { [stationId: string | number]: Passenger[] } = {};
const allPassengers: { [id: number]: Passenger } = {};

let nextTrainId = 1;
let nextPassengerId = 1;
let nextIncidentId = 1;
let totalRidership = 0;

// Economic State
let budget = 5_000_000_000;
let totalOpex = 0;
let totalRevenue = 0;
let cashflowPerHour = 0;

// KPI State
let totalPassengerWaitTime = 0;
let completedTrips = 0;
let dailyStationRidership: { [key: string]: number } = {};
let dailyLineRidership: { [key: string]: number } = {};
let lastDayRollover = 0;
let totalTrainKm = 0;
let lastIncidentKm = 0;

// Incidents
const activeIncidents: { [id: number]: Incident } = {};


// --- CONSTANTS ---
const SIM_TICK_MS = 100;
const TIME_MULTIPLIER = 120;
const TICK_SECONDS = (SIM_TICK_MS / 1000) * TIME_MULTIPLIER;

const TRAIN_ACCELERATION = 0.8; // m/s^2
const MAX_TRAIN_SPEED = 22.22; // m/s (80 km/h)
const BASE_DWELL_TIME = 20; // seconds
const TRAIN_CAPACITY = 200;
const TRAINS_PER_LINE = 4;
const FARE_PER_KM = 0.15; // $ per passenger-km
const OPEX_PER_TRAIN_KM = 5; // $
const OPEX_PER_STATION_HOUR = 50; // $
const INCIDENT_RATE_PER_10K_KM = 0.5;
const WALK_SPEED_MPS = 1.4;


// --- HELPERS ---
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

function getPointAlongLine(line: SimLine, distance: number): number[] | null {
    if (distance < 0) return line.coords[0];
    let distanceTraveled = 0;
    for (let i = 0; i < line.coords.length - 1; i++) {
        const start = line.coords[i];
        const end = line.coords[i+1];
        const segmentLength = turfDistance(start, end);
        if (distanceTraveled + segmentLength >= distance) {
            const remainingDist = distance - distanceTraveled;
            const ratio = remainingDist / segmentLength;
            return [
                start[0] + (end[0] - start[0]) * ratio,
                start[1] + (end[1] - start[1]) * ratio,
            ];
        }
        distanceTraveled += segmentLength;
    }
    return line.coords[line.coords.length - 1];
}


// --- ON MESSAGE HANDLER ---
self.onmessage = (e) => {
    const { type, payload } = e.data;
    switch (type) {
        case 'START':
            if (!simulationInterval) {
                simulationInterval = self.setInterval(simulationTick, SIM_TICK_MS);
            }
            break;
        case 'PAUSE':
            if (simulationInterval) {
                self.clearInterval(simulationInterval);
                simulationInterval = null;
            }
            break;
        case 'UPDATE_NETWORK':
            updateNetwork(payload.lines, payload.stations);
            break;
        case 'BUILD_INFRASTRUCTURE':
            budget -= payload.cost;
            break;
        case 'GET_DEMAND_GRID':
            if (!DEMAND_GRID) createDemandGrid();
            self.postMessage({ type: 'DEMAND_GRID_DATA', payload: DEMAND_GRID });
            break;
        case 'PLAN_JOURNEY':
            handlePlanJourney(payload.origin, payload.destination);
            break;
        case 'GET_DEMAND_DETAILS':
            handleGetDemandDetails(payload.coords);
            break;
    }
};

// --- NETWORK & INITIALIZATION ---
function updateNetwork(lineFeatures: Feature<LineString>[], stationFeatures: Feature<Point>[]) {
    // Reset
    Object.keys(simLines).forEach(id => delete simLines[id]);
    Object.keys(simStations).forEach(id => delete simStations[id]);
    Object.keys(stationQueues).forEach(id => delete stationQueues[id]);

    stationFeatures.forEach(f => {
        const id = f.properties.id;
        simStations[id] = { id, coords: f.geometry.coordinates, name: f.properties.name, lines: new Set() };
        stationQueues[id] = [];
    });

    lineFeatures.forEach(f => {
        const id = f.properties.id;
        let lineLength = 0;
        for(let i=0; i < f.geometry.coordinates.length - 1; i++) {
            lineLength += turfDistance(f.geometry.coordinates[i], f.geometry.coordinates[i+1]);
        }

        const stationDistances: { id: string | number, distance: number }[] = [];
        let traveled = 0;
        const lineCoords = f.geometry.coordinates;

        for (let i = 0; i < lineCoords.length; i++) {
            const currentCoord = lineCoords[i];
            if (i > 0) {
                traveled += turfDistance(lineCoords[i-1], currentCoord);
            }
            const matchingStation = Object.values(simStations).find(s => 
                s.coords[0] === currentCoord[0] && s.coords[1] === currentCoord[1]
            );
            if(matchingStation) {
                stationDistances.push({ id: matchingStation.id, distance: traveled });
                simStations[matchingStation.id].lines.add(id);
            }
        }

        simLines[id] = { id, coords: lineCoords, length: lineLength, stationDistances };
    });

    // Spawn/despawn trains
    trains.length = 0;
    Object.values(simLines).forEach(line => {
        if (line.stationDistances.length < 2) return;
        for (let i = 0; i < TRAINS_PER_LINE; i++) {
            trains.push({
                id: nextTrainId++, lineId: line.id,
                distanceAlongLine: (line.length / TRAINS_PER_LINE) * i,
                speed: 0, direction: 1, state: 'moving', dwellTimeRemaining: 0,
                currentStationIndex: -1, passengers: [], capacity: TRAIN_CAPACITY,
            });
        }
    });
}

function createDemandGrid() {
    // FIX: Explicitly type `grid` as `FeatureCollection<Point>` to prevent TypeScript from widening the `type` property to `string`.
    const grid: FeatureCollection<Point> = { type: 'FeatureCollection', features: [] };
    const bbox = [100.4, 13.7, 100.6, 13.8];
    const cells = 20;
    const cellWidth = (bbox[2] - bbox[0]) / cells;
    const cellHeight = (bbox[3] - bbox[1]) / cells;

    for (let i = 0; i < cells; i++) {
        for (let j = 0; j < cells; j++) {
            const lng = bbox[0] + i * cellWidth;
            const lat = bbox[1] + j * cellHeight;
            const demand = Math.round(Math.random() * Math.random() * 200);
            if (demand > 10) {
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
}

// --- CORE SIMULATION ---

function simulationTick() {
    simTime += TICK_SECONDS;

    // Daily/hourly updates
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

    // Prepare data for main thread
    const trainFeatures = trains.map(t => {
        const coords = getPointAlongLine(simLines[t.lineId], t.distanceAlongLine);
        const loadFactor = t.passengers.length / t.capacity;
        return {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: coords || [0,0] },
            properties: { id: t.id, loadFactor }
        };
    });

    const queueSizes: { [key: string]: number } = {};
    Object.keys(stationQueues).forEach(id => {
        queueSizes[id] = stationQueues[id].length;
    });

    self.postMessage({
        type: 'TICK',
        payload: {
            trains: { type: 'FeatureCollection', features: trainFeatures },
            simTime,
            stationQueues: queueSizes,
            totalRidership,
            budget,
            cashflowPerHour,
            avgWaitTime: completedTrips > 0 ? totalPassengerWaitTime / completedTrips : 0,
            dailyStationRidership,
            dailyLineRidership,
        }
    });
}

function updateTrains() {
    let distanceTraveledThisTick = 0;
    trains.forEach(t => {
        const line = simLines[t.lineId];
        if (!line || line.stationDistances.length < 2) return;
        
        // Handle dwell time
        if (t.state === 'dwelling') {
            t.dwellTimeRemaining -= TICK_SECONDS;
            if (t.dwellTimeRemaining <= 0) {
                t.state = 'moving';
                t.currentStationIndex = -1; // No longer at a station
            }
            return;
        }

        // Update train position
        const { nextStation, distToNextStation } = getNextStation(t, line);
        const brakingDistance = (t.speed * t.speed) / (2 * TRAIN_ACCELERATION);
        
        let targetSpeed = MAX_TRAIN_SPEED;
        // Apply speed cap incidents
        Object.values(activeIncidents).forEach(inc => {
            if (inc.type === 'speed_cap' && inc.targetId === t.id) {
                targetSpeed = Math.min(targetSpeed, inc.value);
            }
        });

        if (distToNextStation < brakingDistance) {
            t.speed = Math.max(0, t.speed - TRAIN_ACCELERATION * TICK_SECONDS);
        } else {
            t.speed = Math.min(targetSpeed, t.speed + TRAIN_ACCELERATION * TICK_SECONDS);
        }

        const distanceMoved = t.speed * TICK_SECONDS;
        distanceTraveledThisTick += distanceMoved;
        t.distanceAlongLine += distanceMoved * t.direction;
        
        // Check for arrival
        if (distToNextStation <= distanceMoved) {
            handleStationArrival(t, line, nextStation);
        }

        // Handle end of line
        if (t.distanceAlongLine >= line.length) {
            t.distanceAlongLine = line.length;
            t.direction = -1;
        } else if (t.distanceAlongLine <= 0) {
            t.distanceAlongLine = 0;
            t.direction = 1;
        }
    });
    totalTrainKm += distanceTraveledThisTick / 1000;
}

function handleStationArrival(train: Train, line: SimLine, stationDist: { id: string | number; distance: number; }) {
    train.speed = 0;
    train.state = 'dwelling';
    train.distanceAlongLine = stationDist.distance;

    const station = simStations[stationDist.id];
    if (!station) return;
    
    // Find index of station on the line for state tracking
    train.currentStationIndex = line.stationDistances.findIndex(sd => sd.id === station.id);

    // Passenger exchange
    // 1. Alighting
    const alightingPassengers: Passenger[] = [];
    train.passengers = train.passengers.filter(p => {
        if (!p.route) return false;
        const leg = p.route.legs[p.currentLegIndex];
        if(leg && leg.toStationId === station.id) {
            alightingPassengers.push(p);
            return false;
        }
        return true;
    });

    alightingPassengers.forEach(p => {
        p.currentLegIndex++;
        if (p.currentLegIndex >= p.route.legs.length) {
            // Journey complete
            totalPassengerWaitTime += simTime - p.spawnTime;
            completedTrips++;
            totalRidership++;
            delete allPassengers[p.id];

            // Update ridership stats
            const originId = p.originStationId;
            const destId = p.destinationStationId;
            dailyStationRidership[originId] = (dailyStationRidership[originId] || 0) + 1;
            dailyStationRidership[destId] = (dailyStationRidership[destId] || 0) + 1;
            p.route.legs.forEach(leg => {
                dailyLineRidership[leg.lineId] = (dailyLineRidership[leg.lineId] || 0) + 1;
            });

            // Calculate revenue
            const routeDist = p.route.legs.reduce((sum, leg) => {
                const legLine = simLines[leg.lineId];
                const fromDist = legLine.stationDistances.find(s => s.id === leg.fromStationId)?.distance || 0;
                const toDist = legLine.stationDistances.find(s => s.id === leg.toStationId)?.distance || 0;
                return sum + Math.abs(toDist - fromDist);
            }, 0);
            totalRevenue += (routeDist / 1000) * FARE_PER_KM;

        } else {
            // Transferring, add to new station queue
            stationQueues[station.id].push(p);
        }
    });
    
    // 2. Boarding
    let boardingPassengers = 0;
    const queue = stationQueues[station.id];
    if (queue) {
        stationQueues[station.id] = queue.filter(p => {
            if (train.passengers.length >= train.capacity) return true;
            if (!p.route) { // Passenger needs a route
                p.route = findRoute(p.originStationId, p.destinationStationId);
                if (!p.route) return true; // Cannot find route, stay in queue
            }
            const leg = p.route.legs[p.currentLegIndex];
            if (leg && leg.lineId === train.lineId && isTrainGoingTowards(train, leg.toStationId)) {
                train.passengers.push(p);
                boardingPassengers++;
                return false; // Remove from queue
            }
            return true;
        });
    }

    // Calculate dwell time
    let dwellTime = BASE_DWELL_TIME + (alightingPassengers.length + boardingPassengers) * 0.2;
     Object.values(activeIncidents).forEach(inc => {
        if (inc.type === 'extra_dwell' && inc.targetId === station.id) {
            dwellTime += inc.value;
        }
    });
    train.dwellTimeRemaining = dwellTime;
}


// --- PASSENGER & ROUTING ---
function spawnPassengers(hour: number) {
    if (!DEMAND_GRID || Object.keys(simStations).length === 0) return;

    const hourlyMultiplier = HOURLY_MULTIPLIERS[hour];
    const passengersToSpawn = Math.round((TOTAL_DEMAND / 86400) * TICK_SECONDS * hourlyMultiplier * 50); // Scaler for more traffic

    for (let i = 0; i < passengersToSpawn; i++) {
        const originPoint = DEMAND_GRID.features[Math.floor(Math.random() * DEMAND_GRID.features.length)];
        const destPoint = DEMAND_GRID.features[Math.floor(Math.random() * DEMAND_GRID.features.length)];
        if (originPoint === destPoint) continue;

        const originStation = findNearestStation(originPoint.geometry.coordinates);
        const destStation = findNearestStation(destPoint.geometry.coordinates);
        if (!originStation || !destStation || originStation.id === destStation.id) continue;

        const passenger: Passenger = {
            id: nextPassengerId++,
            originStationId: originStation.id,
            destinationStationId: destStation.id,
            route: null,
            currentLegIndex: 0,
            spawnTime: simTime,
        };
        allPassengers[passenger.id] = passenger;
        stationQueues[originStation.id].push(passenger);
    }
}

function findRoute(originId: string | number, destId: string | number): Route | null {
    const queue: { stationId: string | number, path: { lineId: string | number; fromStationId: string | number; toStationId: string | number }[] }[] = [{ stationId: originId, path: [] }];
    const visited = new Set([originId]);

    while (queue.length > 0) {
        const { stationId, path } = queue.shift()!;
        if (stationId === destId) return { legs: path };

        const station = simStations[stationId];
        if (!station) continue;

        for (const lineId of station.lines) {
            const line = simLines[lineId];
            if (!line) continue;
            
            const stationIdxOnLine = line.stationDistances.findIndex(s => s.id === stationId);

            // Travel in both directions on the line
            for (let dir = -1; dir <= 1; dir += 2) {
                for (let i = stationIdxOnLine + dir; i >= 0 && i < line.stationDistances.length; i += dir) {
                    const nextStationOnLine = line.stationDistances[i];
                    if (!visited.has(nextStationOnLine.id)) {
                        visited.add(nextStationOnLine.id);
                        const newPath = [...path, { lineId, fromStationId: stationId, toStationId: nextStationOnLine.id }];
                        queue.push({ stationId: nextStationOnLine.id, path: newPath });
                    }
                }
            }
        }
    }
    return null; // No route found
}


// --- ECONOMICS & INCIDENTS ---

function updateEconomics() {
    const opexThisTick = (totalTrainKm * OPEX_PER_TRAIN_KM) + (Object.keys(simStations).length * OPEX_PER_STATION_HOUR / 3600 * TICK_SECONDS);
    totalOpex += opexThisTick;
    budget -= opexThisTick;
    totalTrainKm = 0; // Reset for next tick calculation

    if (Math.floor(simTime / 3600) > Math.floor((simTime - TICK_SECONDS) / 3600)) {
        cashflowPerHour = totalRevenue - totalOpex;
        totalOpex = 0;
        totalRevenue = 0;
    }
}

function checkForIncidents() {
    const kmSinceLastIncident = totalTrainKm - lastIncidentKm;
    if (kmSinceLastIncident > 10000) {
        if (Math.random() < INCIDENT_RATE_PER_10K_KM) {
            generateIncident();
        }
        lastIncidentKm = totalTrainKm;
    }
    // Expire old incidents
    Object.keys(activeIncidents).forEach(id => {
        if (activeIncidents[id].expiresAt < simTime) {
            self.postMessage({ type: 'INCIDENT_EVENT', payload: { id, active: false } });
            delete activeIncidents[id];
        }
    });
}

function generateIncident() {
    if (trains.length === 0 && Object.keys(simStations).length === 0) return;
    
    const id = nextIncidentId++;
    const duration = 300 + Math.random() * 600; // 5-15 minutes
    
    let incident: Incident;
    if (Math.random() > 0.5 && trains.length > 0) { // Speed cap
        const targetTrain = trains[Math.floor(Math.random() * trains.length)];
        const speedCap = 8 + Math.random() * 5; // ~30-50 km/h
        incident = { id, type: 'speed_cap', targetId: targetTrain.id, value: speedCap,
            message: `Signal failure near Train ${targetTrain.id}, speed capped at ${Math.round(speedCap * 3.6)} km/h.`,
            expiresAt: simTime + duration,
        };
    } else if (Object.keys(simStations).length > 0) { // Extra dwell
        const stationIds = Object.keys(simStations);
        const targetStation = simStations[stationIds[Math.floor(Math.random() * stationIds.length)]];
        const extraDwell = 30 + Math.random() * 60;
         incident = { id, type: 'extra_dwell', targetId: targetStation.id, value: extraDwell,
            message: `Mechanical issue at ${targetStation.name}, causing ${Math.round(extraDwell)}s delays.`,
            expiresAt: simTime + duration,
        };
    } else { return; }

    activeIncidents[id] = incident;
    self.postMessage({ type: 'INCIDENT_EVENT', payload: { id, active: true, message: incident.message } });
}


// --- JOURNEY PLANNER & ANALYTICS ---

function handlePlanJourney(originCoords: number[], destCoords: number[]) {
    if (Object.keys(simStations).length < 2) return;
    const originStation = findNearestStation(originCoords);
    const destStation = findNearestStation(destCoords);
    if (!originStation || !destStation) return;

    const walkToStationTime = turfDistance(originCoords, originStation.coords) / WALK_SPEED_MPS;
    const walkFromStationTime = turfDistance(destCoords, destStation.coords) / WALK_SPEED_MPS;

    // A* pathfinding for journey planner
    const openSet = new Set([originStation.id]);
    const cameFrom = new Map();
    const gScore = new Map([[originStation.id, 0]]); // Cost from start
    const fScore = new Map([[originStation.id, turfDistance(originStation.coords, destStation.coords)]]); // Cost from start + heuristic

    while (openSet.size > 0) {
        let currentId = [...openSet].reduce((a, b) => (fScore.get(a) ?? Infinity) < (fScore.get(b) ?? Infinity) ? a : b);

        if (currentId === destStation.id) {
            const route = reconstructJourneyPath(cameFrom, currentId);
            self.postMessage({ type: 'JOURNEY_PLAN_RESULT', payload: { route, walkToStationTime, walkFromStationTime } });
            return;
        }

        openSet.delete(currentId);
        const station = simStations[currentId];
        
        station.lines.forEach(lineId => {
            const line = simLines[lineId];
            const stationIdx = line.stationDistances.findIndex(s => s.id === currentId);

            [-1, 1].forEach(dir => {
                if ((stationIdx + dir >= 0) && (stationIdx + dir < line.stationDistances.length)) {
                    const neighbor = line.stationDistances[stationIdx + dir];
                    const travelDist = Math.abs(neighbor.distance - line.stationDistances[stationIdx].distance);
                    const tentativeGScore = (gScore.get(currentId) ?? Infinity) + travelDist;

                    if (tentativeGScore < (gScore.get(neighbor.id) ?? Infinity)) {
                        cameFrom.set(neighbor.id, { from: currentId, line: lineId });
                        gScore.set(neighbor.id, tentativeGScore);
                        fScore.set(neighbor.id, tentativeGScore + turfDistance(simStations[neighbor.id].coords, destStation.coords));
                        if (!openSet.has(neighbor.id)) {
                            openSet.add(neighbor.id);
                        }
                    }
                }
            });
        });
    }
}

function handleGetDemandDetails(coords: number[]) {
    const stationIds = Object.keys(simStations);
    if (stationIds.length === 0) return;

    const nearbyStations = stationIds
        .map(id => ({ station: simStations[id], distance: turfDistance(coords, simStations[id].coords) }))
        .filter(s => s.distance < 2000)
        .sort((a,b) => a.distance - b.distance)
        .slice(0, 5)
        .map(s => ({ id: s.station.id, name: s.station.name, distance: s.distance }));
    
    // Fake distribution for now, real one would be based on model
    const hourlyDistribution = Array(12).fill(0).map(() => Math.random());

    self.postMessage({ type: 'DEMAND_DETAILS_RESULT', payload: { nearbyStations, hourlyDistribution } });
}


// --- UTILITY FUNCTIONS ---
function findNearestStation(coords: number[]): SimStation | null {
    let closestStation: SimStation | null = null;
    let minDistance = Infinity;
    Object.values(simStations).forEach(station => {
        const dist = turfDistance(coords, station.coords);
        if (dist < minDistance) {
            minDistance = dist;
            closestStation = station;
        }
    });
    return closestStation;
}

function getNextStation(train: Train, line: SimLine) {
    let nextStation = null;
    let distToNextStation = Infinity;

    if (train.direction === 1) {
        for (const station of line.stationDistances) {
            if (station.distance > train.distanceAlongLine) {
                const dist = station.distance - train.distanceAlongLine;
                if (dist < distToNextStation) {
                    distToNextStation = dist;
                    nextStation = station;
                }
            }
        }
    } else { // direction -1
        for (const station of line.stationDistances) {
            if (station.distance < train.distanceAlongLine) {
                const dist = train.distanceAlongLine - station.distance;
                if (dist < distToNextStation) {
                    distToNextStation = dist;
                    nextStation = station;
                }
            }
        }
    }
    return { nextStation, distToNextStation };
}

function isTrainGoingTowards(train: Train, targetStationId: string | number): boolean {
    const line = simLines[train.lineId];
    if (!line) return false;
    const targetStation = line.stationDistances.find(s => s.id === targetStationId);
    if (!targetStation) return false;

    if (train.direction === 1) {
        return targetStation.distance > train.distanceAlongLine;
    } else {
        return targetStation.distance < train.distanceAlongLine;
    }
}

function reconstructJourneyPath(cameFrom: Map<any, any>, currentId: any): JourneyRoute {
    const legs: JourneyLeg[] = [];
    let rideTime = 0;
    
    while(cameFrom.has(currentId)) {
        const { from, line: lineId } = cameFrom.get(currentId);
        const line = simLines[lineId];
        const fromStation = simStations[from];
        const toStation = simStations[currentId];
        
        const fromDist = line.stationDistances.find(s => s.id === from)?.distance || 0;
        const toDist = line.stationDistances.find(s => s.id === currentId)?.distance || 0;
        const legDist = Math.abs(toDist - fromDist);
        const legTime = legDist / MAX_TRAIN_SPEED;
        rideTime += legTime;

        // Extract coordinates for this leg
        const fromIndex = line.coords.findIndex(c => c[0] === fromStation.coords[0] && c[1] === fromStation.coords[1]);
        const toIndex = line.coords.findIndex(c => c[0] === toStation.coords[0] && c[1] === toStation.coords[1]);
        const legCoords = line.coords.slice(Math.min(fromIndex, toIndex), Math.max(fromIndex, toIndex) + 1);
        if(fromIndex > toIndex) legCoords.reverse();
        
        legs.unshift({ lineId, fromStationId: from, toStationId: currentId, rideTime: legTime, coords: legCoords });
        currentId = from;
    }

    const waitTime = legs.length * 90; // Avg 1.5 min wait per transfer
    return {
        legs,
        rideTime,
        waitTime,
        totalTime: rideTime + waitTime
    };
}
