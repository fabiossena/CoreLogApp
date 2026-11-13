(() => {
  'use strict';

  const dashboard = document.getElementById('dashboard');
  if (!dashboard) {
    return;
  }

  const STATUS_COLORS = {
    Online: '#34C77B',
    PossiblyOffline: '#F2B544',
    Offline: '#E05D5D',
  };
  const STATUS_LABELS = {
    Online: 'Online',
    PossiblyOffline: 'Sem sinal',
    Offline: 'Offline',
  };
  const STATUS_CLASSES = {
    Online: 'online',
    PossiblyOffline: 'possibly',
    Offline: 'offline',
  };

  const initialJson = document.getElementById('initial-devices');
  const initialDevices = initialJson ? JSON.parse(initialJson.textContent || '[]') : [];
  const devices = new Map(initialDevices.map((device) => [device.vehicle_id, device]));

  let map = null;
  const markers = new Map();

  function markerColor(status) {
    return STATUS_COLORS[status] || STATUS_COLORS.Offline;
  }

  function formatAge(timestampUtc) {
    if (!timestampUtc) {
      return 'sem posição';
    }
    const timestamp = Date.parse(timestampUtc);
    if (Number.isNaN(timestamp)) {
      return 'data inválida';
    }
    const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
    if (seconds < 5) return 'agora';
    if (seconds < 60) return `há ${seconds}s`;
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `há ${minutes}min`;
    return `há ${Math.round(minutes / 60)}h`;
  }

  function findRow(vehicleId) {
    return Array.from(document.querySelectorAll('#devices-table tbody tr[data-vehicle-id]'))
      .find((row) => row.dataset.vehicleId === vehicleId) || null;
  }

  function updateRow(device) {
    const row = findRow(device.vehicle_id);
    if (!row) {
      return false;
    }
    const status = device.status || 'Offline';
    const badge = row.querySelector('.js-status');
    if (badge) {
      badge.className = `badge status-${STATUS_CLASSES[status] || 'offline'} js-status`;
      badge.textContent = STATUS_LABELS[status] || status;
    }
    const position = device.last_position;
    const positionCell = row.querySelector('.js-position');
    const speedCell = row.querySelector('.js-speed');
    const updatedCell = row.querySelector('.js-updated');

    if (position) {
      if (positionCell) positionCell.textContent = `${position.latitude.toFixed(5)}, ${position.longitude.toFixed(5)}`;
      if (speedCell) speedCell.textContent = position.speed_kmh != null ? `${Math.round(position.speed_kmh)} km/h` : '—';
      row.dataset.lat = position.latitude;
      row.dataset.lng = position.longitude;
      row.dataset.speed = position.speed_kmh ?? '';
      row.dataset.updated = position.timestamp_utc || '';
      if (updatedCell) updatedCell.textContent = formatAge(position.timestamp_utc);
    }

    row.dataset.status = status;
    return true;
  }

  function ensureMarker(device) {
    if (!map || !device.last_position) {
      return;
    }
    const { latitude, longitude } = device.last_position;
    const color = markerColor(device.status);
    let marker = markers.get(device.vehicle_id);
    if (!marker) {
      marker = L.circleMarker([latitude, longitude], {
        radius: 8,
        color,
        fillColor: color,
        fillOpacity: 0.85,
        weight: 2,
      }).addTo(map);
      markers.set(device.vehicle_id, marker);
    } else {
      marker.setLatLng([latitude, longitude]);
      marker.setStyle({ color, fillColor: color });
    }
    marker.bindPopup(
      `<strong>${escapeHtml(device.display_name || device.vehicle_id)}</strong><br>` +
      `${device.vehicle_id}<br>` +
      `${STATUS_LABELS[device.status] || device.status}`,
    );
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function initMap() {
    const container = document.getElementById('map');
    if (!container || typeof L === 'undefined') {
      return;
    }

    const withPosition = initialDevices.filter((device) => device.last_position);
    const center = withPosition.length > 0
      ? [withPosition[0].last_position.latitude, withPosition[0].last_position.longitude]
      : [41.15, -8.61];

    map = L.map(container, { zoomControl: true }).setView(center, 11);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(map);

    initialDevices.forEach(ensureMarker);

    if (withPosition.length > 0) {
      const bounds = withPosition.map((device) => [
        device.last_position.latitude,
        device.last_position.longitude,
      ]);
      map.fitBounds(bounds, { padding: [30, 30], maxZoom: 13 });
    }
  }

  function setHubStatus(text, kind) {
    const element = document.getElementById('hub-status');
    if (!element) {
      return;
    }
    element.textContent = text;
    element.className = `hub-status ${kind}`;
  }

  function showPanic(payload) {
    const banner = document.getElementById('panic-banner');
    const list = document.getElementById('panic-list');
    const count = document.getElementById('panic-count');
    if (!banner || !list) {
      return;
    }
    banner.classList.remove('hidden');
    if (count) {
      count.textContent = String((Number(count.textContent) || 0) + 1);
    }

    const item = document.createElement('article');
    item.className = 'panic-item panic-item-new';

    const details = document.createElement('div');
    const vehicle = document.createElement('strong');
    vehicle.textContent = payload.vehicle_id || 'veículo';
    const when = document.createElement('span');
    when.className = 'muted';
    when.textContent = ` ${new Date(payload.timestamp_utc || Date.now()).toLocaleTimeString('pt-BR')}`;
    details.append(vehicle, when);

    if (payload.last_known_position) {
      const position = document.createElement('span');
      position.className = 'muted';
      position.textContent =
        ` · ${Number(payload.last_known_position.latitude).toFixed(5)}, ` +
        `${Number(payload.last_known_position.longitude).toFixed(5)}`;
      details.append(position);
    }

    const link = document.createElement('a');
    link.className = 'link';
    link.href = '/panics';
    link.textContent = 'ver todos';

    item.append(details, link);
    list.prepend(item);
  }

  function applyPosition(payload) {
    const existing = devices.get(payload.vehicle_id) || {
      vehicle_id: payload.vehicle_id,
      display_name: payload.vehicle_id,
      status: 'Online',
    };
    existing.status = existing.status === 'Offline' ? 'Online' : existing.status;
    existing.last_position = {
      latitude: payload.latitude,
      longitude: payload.longitude,
      timestamp_utc: payload.timestamp_utc,
      speed_kmh: payload.speed_kmh,
    };
    existing.source = payload.source || existing.source;
    devices.set(payload.vehicle_id, existing);

    if (!updateRow(existing)) {
      window.location.reload();
      return;
    }
    ensureMarker(existing);
  }

  function applyStatus(payload) {
    const existing = devices.get(payload.vehicle_id);
    if (existing) {
      existing.status = payload.status;
    }
    if (!updateRow({ vehicle_id: payload.vehicle_id, status: payload.status, last_position: existing?.last_position })) {
      return;
    }
    if (existing) {
      ensureMarker(existing);
    }
  }

  async function connectHub() {
    const hubUrl = dashboard.dataset.hubUrl;
    if (!hubUrl || typeof signalR === 'undefined') {
      setHubStatus('SignalR indisponível', 'offline');
      return;
    }

    const connection = new signalR.HubConnectionBuilder()
      .withUrl(hubUrl)
      .withAutomaticReconnect([0, 2000, 5000, 10000, 30000])
      .configureLogging(signalR.LogLevel.Warning)
      .build();

    connection.on('PositionReceived', applyPosition);
    connection.on('DeviceStatusChanged', applyStatus);
    connection.on('PanicReceived', showPanic);

    connection.onreconnecting(() => setHubStatus('reconectando…', 'connecting'));
    connection.onreconnected(async () => {
      setHubStatus('conectado', 'online');
      try {
        await connection.invoke('JoinAll');
      } catch (error) {
        console.warn('JoinAll failed after reconnect', error);
      }
    });
    connection.onclose(() => setHubStatus('desconectado', 'offline'));

    try {
      setHubStatus('conectando…', 'connecting');
      await connection.start();
      await connection.invoke('JoinAll');
      setHubStatus('conectado', 'online');
    } catch (error) {
      console.warn('SignalR connection failed', error);
      setHubStatus('sem conexão em tempo real', 'offline');
    }
  }

  function refreshAges() {
    devices.forEach((device) => {
      const row = findRow(device.vehicle_id);
      if (row && device.last_position?.timestamp_utc) {
        const cell = row.querySelector('.js-updated');
        if (cell) {
          cell.textContent = formatAge(device.last_position.timestamp_utc);
        }
      }
    });
  }

  initMap();
  connectHub();
  window.setInterval(refreshAges, 15000);
})();
