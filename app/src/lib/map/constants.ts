export const MAPBOX_TOKEN_KEY = 'mapboxToken';
export const MAPBOX_STYLE_KEY = 'mapboxStyle';
export const MAPBOX_TILE_LAYER_KEY = 'mapboxTileLayer';

export const DEFAULT_CENTER: [number, number] = [100.5018, 13.7563];
export const DEFAULT_ZOOM = 11;

export const DEFAULT_MAPBOX_STYLE = 'mapbox://styles/wiqnnc/cmgxe4xj0003d01sbf49kf7mo';

export const ROUTE_COLORS = ['#007AFF', '#FF3B30', '#34C759', '#FFD60A', '#AF52DE', '#FF9500'];
export const DEPTH_COST_COLORS = ['#D3C0FF', '#B388FF', '#9575CD', '#7E57C2', '#673AB7', '#512DA8', '#311B92'];

export const FALLBACK_RASTER_STYLE = {
	version: 8,
	sources: {
		osm: {
			type: 'raster',
			tiles: ['https://a.tile.openstreetmap.org/{z}/{x}/{y}.png'],
			tileSize: 256,
			attribution: '&copy; OpenStreetMap contributors'
		}
	},
	layers: [
		{ id: 'background', type: 'background', paint: { 'background-color': '#0B0B0B' } },
		{ id: 'osm', type: 'raster', source: 'osm', paint: { 'raster-opacity': 0.35 } }
	]
} as const;
