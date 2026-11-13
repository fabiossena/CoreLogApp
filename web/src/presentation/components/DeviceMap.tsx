/**
 * Device map — a thin wrapper around `react-leaflet`.
 *
 * Renders device markers and an optional trail polyline on an OpenStreetMap
 * tile layer. The component itself is pure (all data comes from the
 * viewmodel), and tests never render it, so no test needs tiles or network.
 */

import { CircleMarker, MapContainer, Polyline, TileLayer, Tooltip } from 'react-leaflet';
import type { LatLngExpression } from 'leaflet';
import 'leaflet/dist/leaflet.css';

/** A single point to display on the map. */
export interface MapPoint {
  vehicle_id: string;
  /** Label shown in the marker tooltip (usually the display name). */
  label: string;
  latitude: number;
  longitude: number;
  /** Device status, used to colour the marker. */
  status?: string;
}

/** Props of {@link DeviceMap}. */
export interface DeviceMapProps {
  /** Device positions currently known. */
  points: MapPoint[];
  /** Optional ordered trail to draw as a polyline (e.g. last 24h). */
  trail?: MapPoint[];
  /** Optional CSS class for the map container. */
  className?: string;
}

/** Fallback centre (Porto) used before any position is known. */
const DEFAULT_CENTER: LatLngExpression = [41.1579, -8.6291];

function markerColor(status?: string): string {
  switch (status) {
    case 'Online':
      return '#16a34a';
    case 'PossiblyOffline':
      return '#f59e0b';
    case 'Offline':
      return '#6b7280';
    default:
      return '#2563eb';
  }
}

/**
 * Live fleet map.
 *
 * @param points - Device positions to mark.
 * @param trail - Optional polyline (ordered positions) to draw.
 * @param className - Optional CSS class for the container.
 * @returns The rendered Leaflet map.
 */
export function DeviceMap({ points, trail = [], className }: DeviceMapProps) {
  const center: LatLngExpression =
    points.length > 0 ? [points[0].latitude, points[0].longitude] : DEFAULT_CENTER;
  const trailPositions: LatLngExpression[] = trail.map(
    (point) => [point.latitude, point.longitude] as [number, number],
  );

  return (
    <MapContainer center={center} zoom={12} className={className ?? 'device-map'}>
      <TileLayer
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
      />
      {trailPositions.length > 1 ? (
        <Polyline positions={trailPositions} pathOptions={{ color: '#2563eb', weight: 3 }} />
      ) : null}
      {points.map((point) => (
        <CircleMarker
          key={point.vehicle_id}
          center={[point.latitude, point.longitude]}
          radius={9}
          pathOptions={{ color: markerColor(point.status), fillColor: markerColor(point.status), fillOpacity: 0.85 }}
        >
          <Tooltip>
            {point.label} — {point.status ?? 'Unknown'}
          </Tooltip>
        </CircleMarker>
      ))}
    </MapContainer>
  );
}
