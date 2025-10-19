import { get } from 'svelte/store';
import {
	linesStore,
	stationsStore,
	trainsStore,
	demandStore,
	budgetStore,
	cashflowStore,
	ridershipStore,
	waitTimeStore,
	stationQueuesStore,
	stationRidershipStore,
	lineRidershipStore,
	simClockStore,
	journeyRoute,
	selectedDemand,
	demandDetailsStore,
	incidentsStore,
	ridershipHistoryStore
} from '$lib/stores';
import type { HistoryPoint, IncidentRecord } from '$lib/types';

type SimulationBridge = {
  worker: Worker;
  destroy: () => void;
};

export function initSimulationBridge(): SimulationBridge {
	const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
	(globalThis as any).__simWorker = worker;

	const pushNetwork = () => {
		const lines = get(linesStore).features;
		const stations = get(stationsStore).features;
		worker.postMessage({
			type: 'UPDATE_NETWORK',
			payload: { lines, stations }
		});
	};

	const unsubscribers: Array<() => void> = [];

	unsubscribers.push(
		linesStore.subscribe(() => {
			pushNetwork();
		})
	);

	unsubscribers.push(
		stationsStore.subscribe(() => {
			pushNetwork();
		})
	);

	unsubscribers.push(
	selectedDemand.subscribe((coords) => {
		if (coords) {
			worker.postMessage({ type: 'GET_DEMAND_DETAILS', payload: { coords } });
		} else {
			demandDetailsStore.set(null);
		}
	})
	);

	unsubscribers.push(
		demandStore.subscribe((grid) => {
			if (grid.features.length) {
				worker.postMessage({ type: 'SET_DEMAND_GRID', payload: grid });
			}
		})
	);

	const history: HistoryPoint[] = [];
	const incidentHistory: IncidentRecord[] = [];
	const activeIncidentMap = new Map<number, IncidentRecord>();

	const publishIncidents = () => {
		incidentsStore.set({
			active: Array.from(activeIncidentMap.values()),
			history: incidentHistory.slice(-50)
		});
	};

	const handleTick = (payload: any) => {
		trainsStore.set(payload.trains);
		budgetStore.set(payload.budget);
		cashflowStore.set(payload.cashflowPerHour);
		ridershipStore.set(payload.totalRidership);
		waitTimeStore.set(payload.avgWaitTime);
		stationQueuesStore.set(payload.stationQueues);
		stationRidershipStore.set(payload.dailyStationRidership);
		lineRidershipStore.set(payload.dailyLineRidership);

		const day = Math.floor(payload.simTime / 86400) + 1;
		const hour = Math.floor((payload.simTime % 86400) / 3600);
		const minute = Math.floor((payload.simTime % 3600) / 60);
		simClockStore.set({ day, hour, minute });

		history.push({
			time: payload.simTime,
			ridership: payload.totalRidership,
			budget: payload.budget,
			cashflow: payload.cashflowPerHour
		});
		if (history.length > 512) history.shift();
		ridershipHistoryStore.set([...history]);
	};

	const handleIncident = (record: IncidentRecord) => {
		incidentHistory.push(record);
		if (record.active) {
			activeIncidentMap.set(record.id, record);
		} else {
			activeIncidentMap.delete(record.id);
		}
		publishIncidents();
	};

	worker.addEventListener('message', (event: MessageEvent<any>) => {
		const { type, payload } = event.data;
		switch (type) {
			case 'WORKER_READY':
			case 'NETWORK_READY':
				pushNetwork();
				worker.postMessage({ type: 'GET_DEMAND_GRID' });
				break;
			case 'TICK':
				handleTick(payload);
				break;
			case 'DEMAND_GRID_DATA':
				demandStore.set(payload);
				break;
			case 'JOURNEY_PLAN_RESULT':
				journeyRoute.set(payload.route);
				break;
			case 'DEMAND_DETAILS_RESULT':
				demandDetailsStore.set(payload);
				break;
			case 'INCIDENT_EVENT':
				handleIncident(payload);
				break;
			default:
				break;
		}
	});

	pushNetwork();
	worker.postMessage({ type: 'GET_DEMAND_GRID' });

	return {
		worker,
		destroy() {
			unsubscribers.forEach((fn) => fn());
			worker.terminate();
			if ((globalThis as any).__simWorker === worker) {
				delete (globalThis as any).__simWorker;
			}
		}
	};
}
