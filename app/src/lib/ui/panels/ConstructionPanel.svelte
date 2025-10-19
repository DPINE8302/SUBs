<script lang="ts">
import { mapControllerStore, drawingPointsStore, linesStore, mode, selectedLineId } from '$lib/stores';
import { calculateLineCost } from '$lib/map/cost';
import { ROUTE_COLORS } from '$lib/map/constants';
import type { BuildMethod, TrackCount, Feature } from '$lib/types';
import { cubicOut } from 'svelte/easing';
import { fade, fly } from 'svelte/transition';
import { onDestroy } from 'svelte';
import { get } from 'svelte/store';

const buildModeButtons = [
	{ label: '🛤️ Build Tracks', value: 'draw-track' as const },
	{ label: '🚉 Build Station', value: 'place-station' as const },
	{ label: '🗑️ Delete', value: 'delete' as const }
];

const buildMethods: BuildMethod[] = ['cut-and-cover', 'tbm', 'viaduct'];

let trackCount: TrackCount = 'single';
let elevation = 0;
let buildMethod: BuildMethod = 'cut-and-cover';
let controller: import('$lib/map/manager').MapController | null = null;
let costEstimate = 0;

const unsubscribeController = mapControllerStore.subscribe((value) => {
	controller = value;
});

$: {
	const points = $drawingPointsStore;
	costEstimate = calculateLineCost(points, buildMethod, trackCount, elevation);
	if (points.length < 2) {
		costEstimate = 0;
	}
}

function toggleMode(nextMode: typeof buildModeButtons[number]['value']) {
	const current = $mode;
	mode.set(current === nextMode ? 'none' : nextMode);
}

function handleFinish() {
	if (!controller) return;
	const points = get(drawingPointsStore);
	if (!points || points.length < 2) return;
	const collection = get(linesStore);
	const nextId =
		Math.max(0, ...collection.features.map((feature) => (typeof feature.id === 'number' ? feature.id : Number(feature.id) || 0))) +
		1;
	const cost = calculateLineCost(points, buildMethod, trackCount, elevation);
	const newLine: Feature<{ type: 'LineString'; coordinates: number[][] }> = {
		type: 'Feature',
		geometry: { type: 'LineString', coordinates: points },
		properties: {
			id: nextId,
			color: ROUTE_COLORS[(nextId - 1) % ROUTE_COLORS.length],
			cost,
			elevation,
			buildMethod,
			trackCount
		},
		id: nextId
	};
	linesStore.set({
		...collection,
		features: [...collection.features, newLine]
	});
	selectedLineId.set(newLine.id ?? nextId);
	controller.cancelDrawing();
	(globalThis as any).__simWorker?.postMessage({
		type: 'BUILD_INFRASTRUCTURE',
		payload: { cost }
	});
	mode.set('none');
}

	function handleUndo() {
		controller?.undoLastPoint();
	}

function handleCancel() {
	controller?.cancelDrawing();
	mode.set('none');
}

function selectBuildMethod(next: BuildMethod) {
	buildMethod = next;
}

	onDestroy(() => {
		unsubscribeController();
	});

	function formatCurrency(value: number) {
		if (Math.abs(value) >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`;
		if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
		if (Math.abs(value) >= 1_000) return `$${(value / 1_000).toFixed(0)}k`;
		return `$${Math.round(value)}`;
	}
</script>

<div class="glass-panel space-y-5 p-6 shadow-hud" transition:fly={{ x: -12, duration: 160, easing: cubicOut }}>
	<h3 class="panel-heading text-xl">🏗️ Construction</h3>

	<div class="grid grid-cols-1 gap-3">
		{#each buildModeButtons as button}
			<button
				class="emoji-btn px-4 py-3 text-left text-sm"
				class:bg-old-money={$mode === button.value}
				class:text-white={$mode === button.value}
				on:click={() => toggleMode(button.value)}
			>
				{button.label}
			</button>
		{/each}
	</div>

	{#if $mode === 'draw-track'}
		<div class="space-y-4" transition:fade={{ duration: 120 }}>
			<div class="flex items-center justify-between text-xs text-mist">
				<span>Estimated Cost</span>
				<span class="font-mono text-gilded">≈ {formatCurrency(costEstimate)}</span>
			</div>
		<div class="space-y-2">
			<p class="text-xs uppercase tracking-wide text-mist">Track Count</p>
			<div class="grid grid-cols-3 gap-2 text-xs">
				<button
					class="emoji-btn px-2 py-2"
					class:bg-old-money={trackCount === 'single'}
					class:text-white={trackCount === 'single'}
					on:click={() => (trackCount = 'single')}
				>
					Single
				</button>
				<button
					class="emoji-btn px-2 py-2"
					class:bg-old-money={trackCount === 'parallel'}
					class:text-white={trackCount === 'parallel'}
					on:click={() => (trackCount = 'parallel')}
				>
					Parallel
				</button>
				<button
					class="emoji-btn px-2 py-2"
					class:bg-old-money={trackCount === 'quad'}
					class:text-white={trackCount === 'quad'}
					on:click={() => (trackCount = 'quad')}
				>
					Quad
				</button>
			</div>
			</div>
		<div class="space-y-2">
			<p class="text-xs uppercase tracking-wide text-mist">
				Elevation <span class="text-white">{elevation} m</span>
			</p>
				<input
					type="range"
					min="-40"
					max="0"
					step="1"
					bind:value={elevation}
					class="w-full accent-gilded"
				/>
			</div>
		<div class="space-y-2">
			<p class="text-xs uppercase tracking-wide text-mist">Method</p>
			<div class="grid grid-cols-3 gap-2 text-xs">
				{#each buildMethods as method}
					<button
						class="emoji-btn px-2 py-2 capitalize"
						class:bg-old-money={buildMethod === method}
						class:text-white={buildMethod === method}
						on:click={() => selectBuildMethod(method)}
					>
						{method.replace('-', ' ')}
					</button>
				{/each}
			</div>
		</div>
			<div class="grid grid-cols-3 gap-2 text-sm">
				<button class="emoji-btn px-3 py-2" on:click={handleUndo}>↩️ Undo</button>
				<button class="emoji-btn px-3 py-2" on:click={handleCancel}>❌ Cancel</button>
				<button class="emoji-btn px-3 py-2" on:click={handleFinish}>✅ Finish</button>
			</div>
		</div>
	{/if}
</div>

<svelte:window
	on:keydown={(event) => {
		if (event.key === 'Escape') {
			handleCancel();
		}
	}}
/>

<style>
/* active state handled via class bindings */
</style>
