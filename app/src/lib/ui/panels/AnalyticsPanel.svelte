<script lang="ts">
	import {
		selectedLineId,
		linesStore,
		stationsStore,
		stationRidershipStore,
		lineRidershipStore,
		ridershipHistoryStore,
		incidentsStore
	} from '$lib/stores';
	import type { Feature } from '$lib/types';

	const chartWidth = 280;
	const chartHeight = 120;

	const formatNumber = (value: number) => new Intl.NumberFormat('en-US').format(Math.round(value));

	const haversine = (a: number[], b: number[]) => {
		const R = 6371;
		const dLat = ((b[1] - a[1]) * Math.PI) / 180;
		const dLon = ((b[0] - a[0]) * Math.PI) / 180;
		const lat1 = (a[1] * Math.PI) / 180;
		const lat2 = (b[1] * Math.PI) / 180;
		const hav = Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
		return 2 * R * Math.asin(Math.sqrt(hav));
	};

	$: lineCollection = $linesStore;
	$: stationCollection = $stationsStore;
	$: selectedLine = lineCollection.features.find((feature) => feature.id === $selectedLineId) as
		| Feature<{ type: 'LineString'; coordinates: number[][] }>
		| undefined;
$: stationRidership = $stationRidershipStore;
$: lineRidership = $lineRidershipStore;
$: ridershipHistory = $ridershipHistoryStore;
$: incidents = $incidentsStore;

	$: selectedStations = selectedLine
		? stationCollection.features.filter((station) =>
				selectedLine.geometry.coordinates.some((coord) => haversine(coord, station.geometry.coordinates) < 0.2)
			)
		: [];

	$: lineChartPath = (() => {
		if (!ridershipHistory.length) return '';
		const maxValue = Math.max(...ridershipHistory.map((point) => point.ridership), 1);
		const minValue = Math.min(...ridershipHistory.map((point) => point.ridership), 0);
		const domain = Math.max(maxValue - minValue, 1);
		return ridershipHistory
			.map((point, index) => {
				const x = (index / Math.max(ridershipHistory.length - 1, 1)) * chartWidth;
				const y = chartHeight - ((point.ridership - minValue) / domain) * chartHeight;
				return `${index === 0 ? 'M' : 'L'}${x},${y}`;
			})
			.join(' ');
	})();

	$: topLines = Object.entries(lineRidership)
		.sort((a, b) => b[1] - a[1])
		.slice(0, 5);

	$: latestTick = ridershipHistory.at(-1) ?? null;
</script>

<section class="glass-panel space-y-4 p-5 shadow-hud min-h-[260px]">
	<h3 class="panel-heading text-lg">📊 Network Analytics</h3>

	<div class="space-y-4 text-sm text-mist">
		{#if selectedLine}
			<div class="space-y-2">
				<div class="flex items-center justify-between rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-xs">
					<span>Daily Boardings</span>
					<span class="font-mono text-gilded">{formatNumber(lineRidership[String(selectedLine.id) ?? ''] ?? 0)}</span>
				</div>
				<div class="flex items-center justify-between rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-xs">
					<span>Line ID</span>
					<span class="font-mono text-gilded">{selectedLine.id}</span>
				</div>
				<div class="rounded-xl border border-white/10 bg-black/20 px-3 py-2">
					<h4 class="font-semibold text-white text-sm mb-2">Stations on Line</h4>
					<ul class="space-y-1 text-xs">
						{#each selectedStations as station}
							<li class="flex items-center justify-between rounded-lg bg-black/30 px-3 py-1.5">
								<span>{station.properties?.name ?? station.id}</span>
								<span class="font-mono text-white">
									{formatNumber(stationRidership[String(station.properties?.id ?? station.id) ?? ''] ?? 0)}
								</span>
							</li>
						{/each}
						{#if !selectedStations.length}
							<li class="rounded-lg bg-black/20 px-3 py-2 text-mist">No stop data linked yet.</li>
						{/if}
					</ul>
				</div>
			</div>
		{/if}

		<div>
			<h4 class="font-semibold text-white text-sm mb-2">Ridership History</h4>
			{#if lineChartPath}
				<svg width={chartWidth} height={chartHeight} class="w-full">
					<path d={lineChartPath} fill="none" stroke="#FFD60A" stroke-width="2" />
				</svg>
				{#if latestTick}
					<p class="text-xs text-mist mt-1">Total boardings: <span class="font-mono text-white">{formatNumber(latestTick.ridership)}</span></p>
				{/if}
			{:else}
				<p class="text-xs text-mist">Press play to start collecting ridership analytics.</p>
			{/if}
		</div>

		<div>
			<h4 class="font-semibold text-white text-sm mb-2">Top Lines (Daily)</h4>
			<ul class="space-y-1 text-xs">
				{#each topLines as [lineId, riders]}
					<li class="flex items-center justify-between rounded-lg bg-black/30 px-3 py-1.5">
						<span>Line {lineId}</span>
						<span class="font-mono text-white">{formatNumber(riders)}</span>
					</li>
				{/each}
				{#if !topLines.length}
					<li class="rounded-lg bg-black/20 px-3 py-2 text-mist">Ridership data will appear once trains are running.</li>
				{/if}
			</ul>
		</div>

		<div>
			<h4 class="font-semibold text-white text-sm mb-2">Incidents</h4>
			{#if incidents.active.length}
				<ul class="space-y-1 text-xs">
					{#each incidents.active as incident}
						<li class="flex items-center justify-between rounded-lg bg-black/40 px-3 py-1.5 text-amber-200">
							<span>{incident.message}</span>
							<span class="font-mono">
								{formatNumber(Math.max(0, Math.round((incident.expiresAt - (latestTick?.time ?? 0)) / 60)))} min
							</span>
						</li>
					{/each}
				</ul>
			{:else}
				<p class="text-xs text-mist">No active disruptions.</p>
			{/if}
		</div>
	</div>
</section>
