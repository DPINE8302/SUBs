<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import { layerVisibilityStore, mapError, usingFallbackStyle } from '$lib/stores';

	const dispatch = createEventDispatcher<{ settings: void; about: void }>();

	const toggles = [
		{ key: 'tracks', label: 'Tracks' },
		{ key: 'stations', label: 'Stations' },
		{ key: 'trains', label: 'Trains' },
		{ key: 'depth', label: 'Cost/Depth View' },
		{ key: 'demand', label: 'Demand' }
	] as const;

	function toggleLayer(key: (typeof toggles)[number]['key']) {
		layerVisibilityStore.update((current) => ({ ...current, [key]: !current[key] }));
	}
</script>

<div class="glass-panel w-72 space-y-4 p-5 shadow-hud">
	<header class="flex items-center justify-between">
		<h3 class="panel-heading text-lg">🗺️ Layers</h3>
		<div class="flex items-center gap-2">
			<button class="emoji-btn px-3 py-1 text-base" on:click={() => dispatch('about')}>ℹ️</button>
			<button class="emoji-btn px-3 py-1 text-base" on:click={() => dispatch('settings')}>⚙️</button>
		</div>
	</header>

	<div class="space-y-3 text-sm">
		{#each toggles as toggle}
			<label class="flex items-center justify-between rounded-xl border border-white/10 bg-black/30 px-3 py-2">
				<span>{toggle.label}</span>
				<input
					type="checkbox"
					class="size-4 accent-gilded"
					checked={$layerVisibilityStore[toggle.key]}
					on:change={() => toggleLayer(toggle.key)}
				/>
			</label>
		{/each}
	</div>

	{#if $mapError}
		<div class="rounded-xl border border-amber-400/60 bg-amber-500/20 px-3 py-2 text-xs text-amber-100">
			{$mapError}
		</div>
	{:else if $usingFallbackStyle}
		<div class="rounded-xl border border-sky-400/60 bg-sky-500/15 px-3 py-2 text-xs text-sky-100">
			🛰️ Using fallback OpenStreetMap tiles
		</div>
	{/if}
</div>
