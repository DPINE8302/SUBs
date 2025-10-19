<script lang="ts">
	import {
		budgetStore,
		cashflowStore,
		ridershipStore,
		waitTimeStore,
		trainsCountStore,
		simClockStore
	} from '$lib/stores';

	let isPlaying = false;

	function togglePlay(next: boolean) {
		isPlaying = next;
		(window as any).__simWorker?.postMessage({ type: next ? 'START' : 'PAUSE' });
	}

	function formatCurrency(value: number) {
		if (Math.abs(value) >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B`;
		if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
		if (Math.abs(value) >= 1_000) return `$${(value / 1_000).toFixed(0)}k`;
		return `$${Math.round(value)}`;
	}

	$: clock = $simClockStore;
</script>

<div class="glass-panel pointer-events-auto mx-auto flex w-fit items-center gap-6 px-6 py-3 text-sm shadow-hud">
	<div class="flex items-center gap-2 text-mist">
		<span>💰</span>
		<span class="font-mono text-gilded">{formatCurrency($budgetStore)}</span>
	</div>
	<div class="flex items-center gap-2 text-mist">
		<span>📈</span>
		<span class="font-mono text-gilded">{formatCurrency($cashflowStore)}/hr</span>
	</div>
	<div class="flex items-center gap-2 text-mist">
		<span>👥</span>
		<span class="font-mono text-gilded">{Intl.NumberFormat('en-US').format($ridershipStore)}</span>
	</div>
	<div class="flex items-center gap-2 text-mist">
		<span>⏳</span>
		<span class="font-mono text-gilded">{Math.round($waitTimeStore)}s avg wait</span>
	</div>
	<div class="flex items-center gap-2 text-mist">
		<span>🚄</span>
		<span class="font-mono text-gilded">{$trainsCountStore}</span>
	</div>
	<div class="flex items-center gap-2 text-mist">
		<span>⏱️</span>
		<span class="font-mono text-gilded">Day {clock.day}, {clock.hour.toString().padStart(2, '0')}:{clock.minute.toString().padStart(2, '0')}</span>
	</div>
	<div class="flex items-center gap-2">
		<button class="emoji-btn px-3 py-2" on:click={() => togglePlay(true)} disabled={isPlaying}>
			▶️
		</button>
		<button class="emoji-btn px-3 py-2" on:click={() => togglePlay(false)} disabled={!isPlaying}>
			⏸️
		</button>
	</div>
</div>
