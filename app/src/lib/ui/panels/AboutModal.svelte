<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import { fly } from 'svelte/transition';

	const dispatch = createEventDispatcher<{ close: void }>();
</script>

<div class="glass-panel max-w-md space-y-4 p-6 shadow-hud" transition:fly={{ y: 20, duration: 150 }}>
	<div class="flex items-center justify-between gap-4">
		<h3 class="panel-heading text-lg">ℹ️ About Subway Builder</h3>
		<button class="emoji-btn px-3 py-1 text-base" on:click={() => dispatch('close')}>✖️</button>
	</div>
	<p class="text-sm text-mist">
		Subway Builder is a hyper-realistic metro planning sandbox. Design alignments, tune operations, and watch synthetic commuters respond in real time.
	</p>
	<div class="space-y-3 text-sm text-mist">
		<div>
			<h4 class="font-semibold text-white">Stack</h4>
			<ul class="list-disc space-y-1 pl-5">
				<li>SvelteKit + Tailwind + Motion</li>
				<li>Mapbox GL JS v3 renderer</li>
				<li>Web Worker simulation core</li>
			</ul>
		</div>
		<div>
			<h4 class="font-semibold text-white">Design Rules</h4>
			<ul class="list-disc space-y-1 pl-5">
				<li>Flat UI (Piano Black / Old Money Green / Gold)</li>
				<li>8 px grid, SF Pro type</li>
				<li>UI motion ≤ 200 ms ease-in-out</li>
			</ul>
		</div>
	</div>
</div>
