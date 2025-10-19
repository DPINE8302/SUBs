import {
	MAPBOX_STYLE_KEY,
	MAPBOX_TILE_LAYER_KEY,
	MAPBOX_TOKEN_KEY,
	DEFAULT_MAPBOX_STYLE
} from '$lib/map/constants';
import { mapSettingsStore } from '$lib/stores';

export type MapSettings = {
	token: string;
	styleUrl: string;
	tileLayer?: string;
};

const defaults: MapSettings = {
	token: '',
	styleUrl: DEFAULT_MAPBOX_STYLE,
	tileLayer: ''
};

export function loadMapSettings(): MapSettings {
	if (typeof localStorage === 'undefined') {
		return defaults;
	}

	const token = localStorage.getItem(MAPBOX_TOKEN_KEY) ?? '';
	const styleUrl = localStorage.getItem(MAPBOX_STYLE_KEY) ?? DEFAULT_MAPBOX_STYLE;
	const tileLayer = localStorage.getItem(MAPBOX_TILE_LAYER_KEY) ?? '';
	const settings = { token, styleUrl, tileLayer };
	mapSettingsStore.set(settings);
	return settings;
}

export function persistMapSettings(settings: MapSettings) {
	if (typeof localStorage === 'undefined') return;
	localStorage.setItem(MAPBOX_TOKEN_KEY, settings.token ?? '');
	localStorage.setItem(MAPBOX_STYLE_KEY, settings.styleUrl ?? DEFAULT_MAPBOX_STYLE);
	if (settings.tileLayer) {
		localStorage.setItem(MAPBOX_TILE_LAYER_KEY, settings.tileLayer);
	} else {
		localStorage.removeItem(MAPBOX_TILE_LAYER_KEY);
	}
	mapSettingsStore.set(settings);
}

export function clearMapSettings() {
	if (typeof localStorage === 'undefined') return;
	localStorage.removeItem(MAPBOX_TOKEN_KEY);
	localStorage.removeItem(MAPBOX_STYLE_KEY);
	localStorage.removeItem(MAPBOX_TILE_LAYER_KEY);
	const settings = { ...defaults };
	mapSettingsStore.set(settings);
}
