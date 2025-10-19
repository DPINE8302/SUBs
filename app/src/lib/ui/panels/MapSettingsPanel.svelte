<script lang="ts">
	import { createEventDispatcher, onDestroy } from 'svelte';
	import { mapError, mapSettingsStore } from '$lib/stores';
	import { clearMapSettings, persistMapSettings } from '$lib/config/mapSettings';
	import { get } from 'svelte/store';
	import { fly } from 'svelte/transition';

const dispatch = createEventDispatcher<{ close: void }>();
const tilePlaceholder = 'https://tiles.example.com/{z}/{x}/{y}.pbf';

	let token = '';
	let styleUrl = '';
	let tileLayer = '';
	let errorMessage = '';

	const mapErrorSubscribe = mapError.subscribe((value) => {
		errorMessage = value ?? '';
	});

	const settingsUnsub = mapSettingsStore.subscribe((value) => {
		token = value.token;
		styleUrl = value.styleUrl;
		tileLayer = value.tileLayer ?? '';
	});

	$: errorMessage = mapErrorMessage();

	function mapErrorMessage() {
		return errorMessage || '';
	}

	function handleSave() {
		if (!token.trim() || !styleUrl.trim()) {
			errorMessage = 'Please provide both a Mapbox access token and style URL.';
			return;
		}
		persistMapSettings({
			token: token.trim(),
			styleUrl: styleUrl.trim(),
			tileLayer: tileLayer.trim()
		});
		dispatch('close');
	}

	function handleClear() {
		clearMapSettings();
		const defaults = get(mapSettingsStore);
		token = defaults.token;
		styleUrl = defaults.styleUrl;
		tileLayer = defaults.tileLayer ?? '';
	}

	$: errorMessage = mapErrorMessage();

	onDestroy(() => {
		mapErrorSubscribe();
		settingsUnsub();
	});
</script>

<div class="panel glass-panel max-w-sm space-y-4 p-6 shadow-hud" transition:fly={{ y: 16, duration: 150 }}>
	<div class="flex items-center justify-between gap-4">
		<h3 class="panel-heading text-lg">🧭 Map Settings</h3>
		<button class="emoji-btn px-3 py-1 text-base" on:click={() => dispatch('close')}>✖️</button>
	</div>
	<div class="space-y-3 text-sm">
		<label class="block space-y-1" for="mapbox-token-input">
			<span class="font-medium text-gray-200">Mapbox Access Token</span>
			<input
				id="mapbox-token-input"
				type="text"
				class="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-mist focus:border-gilded focus:ring-gilded"
				bind:value={token}
				placeholder="Example: pk.eyJ1Ijoid2lxbm5jIi..."
				autocomplete="off"
				spellcheck="false"
			/>
		</label>
		<label class="block space-y-1" for="mapbox-style-input">
			<span class="font-medium text-gray-200">Style URL</span>
			<input
				id="mapbox-style-input"
				type="text"
				class="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-mist focus:border-gilded focus:ring-gilded"
				bind:value={styleUrl}
				placeholder="mapbox://styles/username/style-id"
				autocomplete="off"
				spellcheck="false"
			/>
		</label>
		<label class="block space-y-1" for="mapbox-tile-input">
			<span class="font-medium text-gray-200">Tile Layer (optional)</span>
		<input
			id="mapbox-tile-input"
			type="text"
			class="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-mist focus:border-gilded focus:ring-gilded"
			bind:value={tileLayer}
			placeholder={tilePlaceholder}
			autocomplete="off"
			spellcheck="false"
		/>
		</label>
	</div>
	{#if errorMessage}
		<div class="rounded-xl border border-red-400/60 bg-red-500/20 px-3 py-2 text-xs text-red-100">{errorMessage}</div>
	{/if}
	<div class="flex items-center gap-3">
		<button class="emoji-btn flex-1 px-4 py-2 font-semibold text-white" on:click={handleSave}>Save & Reload</button>
		<button class="emoji-btn flex-1 px-4 py-2 text-mist" on:click={handleClear}>Clear</button>
	</div>
	<p class="text-xs text-mist">Credentials stay on this device. Nothing is sent to a server.</p>
</div>
