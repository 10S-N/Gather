import { useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import 'leaflet/dist/leaflet.css';
import { NEIGHBORHOOD_COORDS } from '../data/neighborhoods';
import { formatWhen } from '../utils/events';

const AUSTIN_CENTER = [30.282, -97.735];

// Builds popup content with DOM nodes instead of an HTML string so event
// titles can never inject markup.
function buildPopup(group, onSelect) {
  const root = document.createElement('div');
  root.className = 'map-popup';

  const title = document.createElement('h4');
  title.textContent = `${group.neighborhood} · ${group.events.length} event${
    group.events.length === 1 ? '' : 's'
  }`;
  root.appendChild(title);

  const list = document.createElement('ul');
  for (const event of group.events.slice(0, 6)) {
    const item = document.createElement('li');
    const link = document.createElement('a');
    link.href = `/event/${event.id}`;
    link.textContent = `${event.title} — ${formatWhen(event)}`;
    link.addEventListener('click', (e) => {
      e.preventDefault();
      onSelect(event);
    });
    item.appendChild(link);
    list.appendChild(item);
  }
  root.appendChild(list);

  if (group.events.length > 6) {
    const more = document.createElement('p');
    more.className = 'map-popup__more';
    more.textContent = `+ ${group.events.length - 6} more in this neighborhood`;
    root.appendChild(more);
  }

  return root;
}

function MapView({ events }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const layerRef = useRef(null);
  const navigate = useNavigate();

  const { groups, unmapped } = useMemo(() => {
    const byNeighborhood = new Map();
    let withoutCoords = 0;

    for (const event of events) {
      const coords = NEIGHBORHOOD_COORDS[event.neighborhood];
      if (!coords) {
        withoutCoords += 1;
        continue;
      }
      if (!byNeighborhood.has(event.neighborhood)) {
        byNeighborhood.set(event.neighborhood, {
          neighborhood: event.neighborhood,
          coords,
          events: [],
        });
      }
      byNeighborhood.get(event.neighborhood).events.push(event);
    }

    return { groups: [...byNeighborhood.values()], unmapped: withoutCoords };
  }, [events]);

  // Tear the Leaflet instance down on unmount (declared first so it runs
  // before the marker effect's cleanup).
  useEffect(
    () => () => {
      mapRef.current?.remove();
      mapRef.current = null;
      layerRef.current = null;
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    let sizeTimer = null;

    (async () => {
      // Leaflet touches `window` at import time, so it is pulled in lazily to
      // keep it out of the initial bundle.
      const L = (await import('leaflet')).default;
      if (cancelled || !containerRef.current) return;

      let map = mapRef.current;
      if (!map) {
        map = L.map(containerRef.current, { scrollWheelZoom: false });
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19,
          attribution: '&copy; OpenStreetMap contributors',
        }).addTo(map);
        map.setView(AUSTIN_CENTER, 12);
        mapRef.current = map;
      }

      if (layerRef.current) {
        map.removeLayer(layerRef.current);
        layerRef.current = null;
      }

      const layer = L.layerGroup();
      const points = [];

      for (const group of groups) {
        const icon = L.divIcon({
          className: 'map-pin-wrap',
          html: `<span class="map-pin">${group.events.length}</span>`,
          iconSize: [34, 34],
          iconAnchor: [17, 17],
          popupAnchor: [0, -18],
        });

        L.marker([group.coords.lat, group.coords.lng], {
          icon,
          title: `${group.neighborhood}: ${group.events.length} event(s)`,
          keyboard: true,
        })
          .addTo(layer)
          .bindPopup(buildPopup(group, (event) => navigate(`/event/${event.id}`, { state: { event } })));

        points.push([group.coords.lat, group.coords.lng]);
      }

      layer.addTo(map);
      layerRef.current = layer;

      if (points.length > 0) {
        map.fitBounds(L.latLngBounds(points), { padding: [48, 48], maxZoom: 14 });
      } else {
        map.setView(AUSTIN_CENTER, 12);
      }

      // The map can mount inside a freshly-unhidden panel; nudge it so tiles
      // line up with the real width.
      sizeTimer = setTimeout(() => map.invalidateSize(), 80);
    })();

    return () => {
      cancelled = true;
      if (sizeTimer) clearTimeout(sizeTimer);
    };
  }, [groups, navigate]);

  return (
    <div>
      <div className="map-shell" ref={containerRef} role="region" aria-label="Map of events by neighborhood" />
      <p className="map-note">
        Pins are neighborhood centers, not exact addresses. Zoom in and tap a pin to see what&rsquo;s
        happening nearby.
        {unmapped > 0 && ` ${unmapped} event${unmapped === 1 ? '' : 's'} couldn't be placed on the map.`}
      </p>
    </div>
  );
}

export default MapView;
