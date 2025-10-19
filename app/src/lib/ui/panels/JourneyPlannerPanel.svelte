<script lang="ts">
	import { journeyOrigin, journeyDestination, journeyRoute, mode } from '$lib/stores';

	function setOrigin() {
		mode.set('set-origin');
	}

	function setDestination() {
		mode.set('set-destination');
	}

	function clearJourney() {
		journeyOrigin.set(null);
		journeyDestination.set(null);
		journeyRoute.set(null);
	}

	function formatDuration(seconds: number) {
		if (seconds < 60) return `${Math.round(seconds)}s`;
		const minutes = Math.floor(seconds / 60);
		return `${minutes}m`;
	}
</script>

<section class="glass-panel space-y-4 p-5 shadow-hud">
	<h3 class="panel-heading text-lg">🧭 Journey Planner</h3>
	<div class="space-y-3 text-sm">
		<button class="emoji-btn w-full px-3 py-2" on:click={setOrigin}>
			{#if $journeyOrigin}
				Origin set ✅
			{:else}
				Set Origin on Map
			{/if}
		</button>
		<button class="emoji-btn w-full px-3 py-2" on:click={setDestination}>
			{#if $journeyDestination}
				Destination set ✅
			{:else}
				Set Destination on Map
			{/if}
		</button>
		<button class="emoji-btn w-full px-3 py-2" on:click={clearJourney}>Clear</button>
	</div>

	{#if $journeyRoute}
		<div class="rounded-xl border border-white/10 bg-black/30 p-3 text-sm text-mist">
			<div class="flex items-center justify-between">
				<span>Total Time</span>
				<span class="font-mono text-gilded">{formatDuration($journeyRoute.totalTime)}</span>
			</div>
			<div class="mt-2 space-y-1 text-xs">
				<div class="flex items-center justify-between">
					<span>🚶 Walk</span>
					<span class="font-mono text-white">{formatDuration($journeyRoute.waitTime)}</span>
				</div>
				<div class="flex items-center justify-between">
					<span>🚇 Ride</span>
					<span class="font-mono text-white">{formatDuration($journeyRoute.rideTime)}</span>
				</div>
			</div>
		</div>
	{:else}
		<p class="text-sm text-mist">Select origin and destination on the map to see the fastest route.</p>
	{/if}
</section>
