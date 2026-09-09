"use client";
import { useEffect, useState } from "react";
import { Minus, Plus, Maximize2 } from "lucide-react";
import {
  coverageViewport,
  mercator,
  zoomCoverageViewport,
  type DeliveryCoverage,
} from "@/lib/domain/delivery-coverage";
export function DeliveryMap({ initial }: { initial: DeliveryCoverage }) {
  const [coverage, setCoverage] = useState(initial);
  const [unavailable, setUnavailable] = useState(false);
  const [tileError, setTileError] = useState(false);
  const [zoom, setZoom] = useState({ key: "", offset: 0 });
  useEffect(() => {
    const controller = new AbortController();
    let busy = false;
    async function refresh() {
      if (busy || document.hidden) return;
      busy = true;
      try {
        const response = await fetch("/api/delivery-coverage", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("unavailable");
        const next: DeliveryCoverage = await response.json();
        setCoverage(next);
        setUnavailable(false);
      } catch {
        if (!controller.signal.aborted) setUnavailable(true);
      } finally {
        busy = false;
      }
    }
    void refresh();
    const interval = setInterval(() => void refresh(), 60000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      controller.abort();
      clearInterval(interval);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);
  const fit = coverageViewport(coverage.points);
  const coverageKey = JSON.stringify(coverage.points);
  const zoomOffset = zoom.key === coverageKey ? zoom.offset : 0;
  const viewport = fit ? zoomCoverageViewport(fit, zoomOffset) : null;
  function changeZoom(offset: number) {
    setTileError(false);
    setZoom({ key: coverageKey, offset });
  }
  const tiles: { x: number; y: number; url: string }[] = [];
  if (viewport) {
    const { left, top, zoom, width, height } = viewport,
      n = 2 ** zoom;
    for (let x = Math.floor(left / 256); x <= Math.floor((left + width) / 256); x++) {
      for (let y = Math.floor(top / 256); y <= Math.floor((top + height) / 256); y++) {
        if (y >= 0 && y < n)
          tiles.push({
            x: x * 256 - left,
            y: y * 256 - top,
            url: `https://tile.openstreetmap.org/${zoom}/${((x % n) + n) % n}/${y}.png`,
          });
      }
    }
  }
  return (
    <div className="sf-coverage">
      <div className="sf-map-label">
        <strong>
          {coverage.postalCodes.length} ZIP{" "}
          {coverage.postalCodes.length === 1 ? "code" : "codes"} on our routes
        </strong>
        <span>Local delivery area</span>
      </div>
      {viewport && (
        <div className="sf-map-controls" role="group" aria-label="Delivery map controls">
          <button
            type="button"
            aria-label="Zoom in"
            disabled={viewport.zoom >= 16}
            onClick={() => changeZoom(zoomOffset + 1)}
          >
            <Plus size={18} />
          </button>
          <button
            type="button"
            aria-label="Zoom out"
            disabled={viewport.zoom <= 0}
            onClick={() => changeZoom(zoomOffset - 1)}
          >
            <Minus size={18} />
          </button>
          <button type="button" onClick={() => changeZoom(0)}>
            <Maximize2 size={16} /> Fit all ZIP codes
          </button>
        </div>
      )}
      {viewport ? (
        <svg
          viewBox="0 0 720 300"
          role="img"
          aria-label={`Map showing ${coverage.points.length} delivery ZIP centers`}
          className="sf-map"
        >
          <rect width="720" height="300" fill="#dceff2" />
          {tiles.map((tile) => (
            <image
              key={tile.url + tile.x}
              href={tile.url}
              x={tile.x}
              y={tile.y}
              width="256"
              height="256"
              onError={() => setTileError(true)}
            />
          ))}
          {coverage.points.map((point) => {
            const p = mercator(point.latitude, point.longitude, viewport.zoom);
            return (
              <g
                key={point.postalCode}
                transform={`translate(${p.x - viewport.left} ${p.y - viewport.top})`}
              >
                <title>
                  {point.postalCode} · {point.placeName}
                </title>
                <circle r="16" fill="#087f8c" opacity=".16" />
                <circle r="6" fill="#007988" stroke="white" strokeWidth="2" />
                {coverage.points.length <= 15 && (
                  <text
                    y="-14"
                    textAnchor="middle"
                    fontSize="11"
                    fontWeight="700"
                    fill="#082f49"
                    stroke="white"
                    strokeWidth="3"
                    paintOrder="stroke"
                  >
                    {point.postalCode}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      ) : (
        <div className="sf-map-empty">
          {coverage.postalCodes.length
            ? "The route ZIP list is ready. Map locations are loading."
            : "New delivery areas are coming. Check back for local routes."}
        </div>
      )}
      <div className="sf-map-caption">
        ZIP centers show approximate locations, not delivery boundaries. Confirm your
        address before ordering.
        <span>
          <a
            href="https://www.openstreetmap.org/copyright"
            target="_blank"
            rel="noreferrer"
          >
            © OpenStreetMap contributors
          </a>{" "}
          ·{" "}
          <a href="https://api.zippopotam.us/" target="_blank" rel="noreferrer">
            ZIP data: Zippopotam.us / GeoNames
          </a>
        </span>
      </div>
      {tileError && (
        <p className="sf-map-status">
          Map background is unavailable. Use the ZIP list and delivery checker below.
        </p>
      )}
      {unavailable && (
        <p role="status" className="sf-map-status">
          Delivery area could not be refreshed. Check your ZIP to confirm current
          availability.
        </p>
      )}
      {coverage.postalCodes.length > 0 && (
        <details className="sf-zip-list">
          <summary>View delivery ZIP codes</summary>
          <ul>
            {coverage.postalCodes.map((zip) => (
              <li key={zip}>{zip}</li>
            ))}
          </ul>
          {coverage.points.length < coverage.postalCodes.length && (
            <p>Some ZIP locations are not yet shown on the map.</p>
          )}
        </details>
      )}
    </div>
  );
}
