<script lang="ts">
import { onMount, onDestroy } from 'svelte';
import { MapController } from './manager';
import { loadMapSettings } from '$lib/config/mapSettings';
import { mapControllerStore, mapError, mapSettingsStore } from '$lib/stores';
import 'mapbox-gl/dist/mapbox-gl.css';

let container: HTMLDivElement;
let controller: MapController | null = null;
let unsubscribe: (() => void) | null = null;
let currentToken = '';
let currentStyle = '';

onMount(() => {
	const settings = loadMapSettings();
	controller = new MapController(container);
	tryInit(settings);
	unsubscribe = mapSettingsStore.subscribe((value) => {
		tryInit(value);
	});
	mapControllerStore.set(controller);
});

onDestroy(() => {
	unsubscribe?.();
	controller?.destroy();
	controller = null;
	mapControllerStore.set(null);
});

function tryInit(settings: { token: string; styleUrl: string }) {
	if (!controller) return;
	const hasCreds = Boolean(settings.token && settings.styleUrl);
	if (!hasCreds) {
		mapError.set('🔑 Please add your Mapbox Access Token and Style URL in Settings to load the map.');
		return;
	}
	if (settings.token === currentToken && settings.styleUrl === currentStyle) {
		return;
	}
	currentToken = settings.token;
	currentStyle = settings.styleUrl;
	mapError.set(null);
	controller.init(settings);
}
</script>

<div bind:this={container} class="w-full h-full"></div>
