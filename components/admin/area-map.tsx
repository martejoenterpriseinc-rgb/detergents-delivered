"use client";
import { useMemo, useState } from "react";
import { Minus, Plus, LocateFixed, MapPin } from "lucide-react";
import { validPoint } from "@/lib/domain/operations";
export type MapPinRow = {
  id: string;
  name: string;
  lat: number | null;
  lng: number | null;
  number?: number;
  color?: string;
};
const project = (lat: number, lng: number, z: number) => ({
  x: ((lng + 180) / 360) * 256 * 2 ** z,
  y: ((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * 256 * 2 ** z,
});
export function AreaMap({
  pins,
  label = "Customer locations",
  numbered = false,
}: {
  pins: MapPinRow[];
  label?: string;
  numbered?: boolean;
}) {
  const [zoomOffset, setZoom] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const good = pins.filter((p) => validPoint(p.lat, p.lng));
  const frame = useMemo(() => {
    const lat = good.length ? good.reduce((n, p) => n + p.lat!, 0) / good.length : 42.165;
    const lng = good.length ? good.reduce((n, p) => n + p.lng!, 0) / good.length : -88.3;
    let zoom = 12;
    for (; zoom > 3; zoom--) {
      const p = good.map((p) => project(p.lat!, p.lng!, zoom));
      if (
        !p.length ||
        (Math.max(...p.map((v) => v.x)) - Math.min(...p.map((v) => v.x)) < 650 &&
          Math.max(...p.map((v) => v.y)) - Math.min(...p.map((v) => v.y)) < 245)
      )
        break;
    }
    zoom = Math.max(3, Math.min(17, zoom + zoomOffset));
    const c = project(lat, lng, zoom);
    return { zoom, left: c.x - 480, top: c.y - 190 };
  }, [good, zoomOffset]);
  const tiles = [];
  for (
    let x = Math.floor(frame.left / 256);
    x <= Math.floor((frame.left + 960) / 256);
    x++
  )
    for (
      let y = Math.floor(frame.top / 256);
      y <= Math.floor((frame.top + 380) / 256);
      y++
    )
      tiles.push({ x, y });
  return (
    <div className="ops-map" aria-label={label}>
      <div className="ops-map-caption">
        <MapPin size={15} />
        {label}
        <span>{good.length} mapped</span>
      </div>
      <svg
        viewBox="0 0 960 380"
        role="img"
        aria-label={`${label}: ${good.length} pins`}
        preserveAspectRatio="xMidYMid meet"
      >
        <rect width="960" height="380" fill="#e5efec" />
        {tiles.map((t) => (
          <image
            key={`${frame.zoom}/${t.x}/${t.y}`}
            href={`https://tile.openstreetmap.org/${frame.zoom}/${t.x}/${t.y}.png`}
            x={t.x * 256 - frame.left}
            y={t.y * 256 - frame.top}
            width="256"
            height="256"
            onError={() => setFailed(true)}
          />
        ))}
        <rect
          width="960"
          height="380"
          fill="#eaf5f2"
          opacity="0.14"
          pointerEvents="none"
        />
        {good.map((p, i) => {
          const xy = project(p.lat!, p.lng!, frame.zoom);
          const x = xy.x - frame.left,
            y = xy.y - frame.top;
          return (
            <g
              key={p.id}
              transform={`translate(${x},${y})`}
              role="button"
              tabIndex={0}
              aria-label={`${numbered ? `Stop ${p.number ?? i + 1}: ` : ""}${p.name}`}
              onClick={() => setSelected(p.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") setSelected(p.id);
              }}
              className="ops-map-pin"
            >
              <title>{p.name}</title>
              <circle r={selected === p.id ? 25 : 22} fill="white" opacity="0.5" />
              <path d="M0 26L-9 9H9Z" fill={p.color ?? "#087b74"} />
              <circle r="17" fill={p.color ?? "#087b74"} stroke="white" strokeWidth="3" />
              <text
                textAnchor="middle"
                dy="5"
                fill="white"
                fontSize="13"
                fontWeight="800"
              >
                {numbered ? (p.number ?? i + 1) : "•"}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="ops-map-tools">
        <button aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(5, z + 1))}>
          <Plus size={17} />
        </button>
        <button aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(-7, z - 1))}>
          <Minus size={17} />
        </button>
        <button aria-label="Fit all locations" onClick={() => setZoom(0)}>
          <LocateFixed size={17} />
        </button>
      </div>
      {selected && (
        <div className="ops-map-selection">
          {pins.find((p) => p.id === selected)?.name}
          <button aria-label="Close location" onClick={() => setSelected(null)}>
            ×
          </button>
        </div>
      )}
      {(!good.length || failed) && (
        <div className="ops-map-notice">
          {!good.length
            ? "No saved coordinates to map yet."
            : "Basemap unavailable. Saved pins and the list remain available."}
        </div>
      )}
      <div className="ops-map-attribution">
        <a
          href="https://www.openstreetmap.org/copyright"
          target="_blank"
          rel="noreferrer"
        >
          © OpenStreetMap contributors
        </a>
      </div>
    </div>
  );
}
