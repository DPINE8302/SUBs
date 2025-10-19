<script lang="ts">
	import { demandStore, demandDetailsStore, selectedDemand } from '$lib/stores';

	$: activeDemand =
		$selectedDemand &&
		$demandStore.features.find(
			(feature) => JSON.stringify(feature.geometry.coordinates) === JSON.stringify($selectedDemand)
		);
	$: details = $demandDetailsStore;

const maxBarHeight = 60;
$: hourlyMax = details ? Math.max(...details.hourlyDistribution, 1) : 1;
</script>

<section class="glass-panel space-y-4 p-5 shadow-hud min-h-[220px]">
	<h3 class="panel-heading text-lg">🔥 Demand Details</h3>
	{#if activeDemand}
		<div class="space-y-2 text-sm text-mist">
			<div class="flex items-center justify-between rounded-xl border border-white/10 bg-black/30 px-3 py-2">
				<span>Estimated Trips</span>
				<span class="font-mono text-gilded">{activeDemand?.properties?.demand ?? 0}</span>
			</div>
			<p class="text-xs">
				Cell center [{activeDemand?.geometry.coordinates[0].toFixed(4)},
				{activeDemand?.geometry.coordinates[1].toFixed(4)}]
			</p>
		</div>
		{#if details}
			<div class="space-y-3 text-xs text-mist">
				<div>
					<h4 class="font-semibold text-white text-sm mb-2">Nearby Stations</h4>
					<ul class="space-y-1">
						{#each details.nearbyStations as station}
							<li class="flex items-center justify-between rounded-lg bg-black/30 px-3 py-2">
								<span>🚉 {station.name}</span>
								<span class="font-mono text-white">
									{(station.distance / 1000).toFixed(2)} km · {Math.round(station.walkTime)} s walk
								</span>
							</li>
						{/each}
						{#if details.nearbyStations.length === 0}
							<li class="rounded-lg bg-black/20 px-3 py-2 text-mist">No stations within 2 km.</li>
						{/if}
					</ul>
				</div>
				<div>
					<h4 class="font-semibold text-white text-sm mb-2">Hourly Activity</h4>
					<div class="flex items-end gap-1 h-24">
						{#each details.hourlyDistribution as value, index (index)}
							<div
								class="w-2 rounded-t bg-gilded/70"
					style={`height:${value === 0 ? 2 : Math.max(4, (value / hourlyMax) * maxBarHeight)}px`}
								title={`Hour ${(index * 2).toString().padStart(2, '0')}:00`}
							/>
						{/each}
					</div>
					<div class="flex justify-between text-[10px] uppercase tracking-wide text-mist mt-1">
						<span>00</span>
						<span>12</span>
						<span>24</span>
					</div>
				</div>
			</div>
		{:else}
			<p class="text-xs text-mist">Retrieving detailed metrics…</p>
		{/if}
	{:else}
		<p class="text-sm text-mist">
			Enable the demand overlay and click a hotspot to explore population & trip intensity.
		</p>
	{/if}
</section>
