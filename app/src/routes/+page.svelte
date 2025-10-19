<script lang="ts">
import MapView from '$lib/map/MapView.svelte';
import ConstructionPanel from '$lib/ui/panels/ConstructionPanel.svelte';
import LayersPanel from '$lib/ui/panels/LayersPanel.svelte';
import BottomHud from '$lib/ui/hud/BottomHud.svelte';
import MapSettingsPanel from '$lib/ui/panels/MapSettingsPanel.svelte';
import AboutModal from '$lib/ui/panels/AboutModal.svelte';
import JourneyPlannerPanel from '$lib/ui/panels/JourneyPlannerPanel.svelte';
import AnalyticsPanel from '$lib/ui/panels/AnalyticsPanel.svelte';
import DemandDetailsPanel from '$lib/ui/panels/DemandDetailsPanel.svelte';
import { leftPanelMode } from '$lib/stores';
import type { LeftPanelMode } from '$lib/types';
import { onMount } from 'svelte';
import { initSimulationBridge } from '$lib/sim/bridge';
import { loadDemoScenario } from '$lib/data/demoLoader';

let showSettings = false;
let showAbout = false;

onMount(() => {
	if (typeof window === 'undefined') return;
	const bridge = initSimulationBridge();
	loadDemoScenario();
	return () => {
		bridge.destroy();
	};
});

function setLeftMode(mode: LeftPanelMode) {
	leftPanelMode.set(mode);
}
</script>

<div class="relative h-screen w-screen overflow-hidden bg-piano text-white">
	<div class="absolute inset-0">
		<MapView />
	</div>

	<div class="pointer-events-none absolute inset-0 flex flex-col justify-between p-6">
		<div class="flex justify-between gap-6">
			<div class="pointer-events-auto flex flex-col gap-4">
				<ConstructionPanel />
				{#if $leftPanelMode === 'journey-planner'}
					<JourneyPlannerPanel />
				{:else if $leftPanelMode === 'route-details'}
					<AnalyticsPanel />
				{:else if $leftPanelMode === 'demand-details'}
					<DemandDetailsPanel />
				{/if}
				<div class="glass-panel flex items-center gap-3 p-3 shadow-hud">
					<button class="emoji-btn px-3 py-2" on:click={() => setLeftMode('construction')}>🏗️</button>
					<button class="emoji-btn px-3 py-2" on:click={() => setLeftMode('journey-planner')}>🧭</button>
					<button class="emoji-btn px-3 py-2" on:click={() => setLeftMode('route-details')}>📊</button>
					<button class="emoji-btn px-3 py-2" on:click={() => setLeftMode('demand-details')}>🔥</button>
				</div>
			</div>
			<div class="pointer-events-auto">
				<LayersPanel on:settings={() => (showSettings = true)} on:about={() => (showAbout = true)} />
			</div>
		</div>

		<div class="pointer-events-auto flex justify-center">
			<BottomHud />
		</div>
	</div>

	{#if showSettings}
		<div class="absolute inset-0 z-20 flex items-center justify-center bg-black/40 backdrop-blur-sm">
			<MapSettingsPanel on:close={() => (showSettings = false)} />
		</div>
	{/if}

	{#if showAbout}
		<div class="absolute inset-0 z-30 flex items-center justify-center bg-black/40 backdrop-blur-sm">
			<AboutModal on:close={() => (showAbout = false)} />
		</div>
	{/if}
</div>
