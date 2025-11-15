const { useState, useEffect, useMemo, useCallback, useRef } = React;

const PAGE_METADATA = [
  { id: "overview", label: "Overview", scope: "overview" },
  { id: "quality", label: "Quality", scope: "quality" },
  { id: "maintenance", label: "Maintenance", scope: "maintenance" },
  { id: "logistics", label: "Logistics", scope: "logistics" },
  { id: "safety", label: "Safety", scope: "safety" },
  { id: "handover", label: "Shift Handover", scope: "handover" },
];

function useDashboard(userId) {
  const [state, setState] = useState({
    loading: true,
    error: null,
    data: null,
  });

  useEffect(() => {
    let cancelled = false;
    async function fetchDashboard() {
      setState((prev) => ({ ...prev, loading: true, error: null }));
      try {
        const response = await fetch(`/api/dashboard?user=${encodeURIComponent(userId)}`);
        if (!response.ok) {
          throw new Error(`Request failed: ${response.status}`);
        }
        const payload = await response.json();
        if (!cancelled) {
          setState({ loading: false, error: null, data: payload });
        }
      } catch (error) {
        if (!cancelled) {
          setState({ loading: false, error: error.message || String(error), data: null });
        }
      }
    }
    if (userId) {
      fetchDashboard();
    }
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(`/api/dashboard?user=${encodeURIComponent(userId)}`);
      if (!response.ok) {
        throw new Error(`Request failed: ${response.status}`);
      }
      const payload = await response.json();
      setState({ loading: false, error: null, data: payload });
    } catch (error) {
      setState((prev) => ({ ...prev, error: error.message || String(error) }));
    }
  }, [userId]);

  return { ...state, refresh };
}

function useEventStream(userId, onEvent) {
  useEffect(() => {
    if (!userId) return undefined;
    const source = new EventSource(`/events?audience=global&user=${encodeURIComponent(userId)}`);
    source.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        onEvent?.(payload);
      } catch (error) {
        console.error("Failed to parse SSE payload", error);
      }
    };
    source.onerror = (error) => {
      console.warn("Event stream error", error);
    };
    return () => {
      source.close();
    };
  }, [userId, onEvent]);
}

function formatPercent(value) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "—";
  }
  return `${value.toFixed(1)}%`;
}

function formatNumber(value) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "—";
  }
  return new Intl.NumberFormat().format(value);
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  let payload = null;
  try {
    payload = await response.json();
  } catch (error) {
    payload = null;
  }
  if (!response.ok || (payload && payload.error)) {
    const message = payload?.error || `Request failed: ${response.status}`;
    throw new Error(message);
  }
  return payload || { ok: true };
}

function buildLinePlanForm(line) {
  return {
    status: line?.status || "Running",
    crew_lead: line?.crew_lead || "",
    line_goal_units:
      line?.line_goal_units !== undefined && line?.line_goal_units !== null
        ? String(line.line_goal_units)
        : "",
    oee: line?.oee !== undefined && line?.oee !== null ? String(line.oee) : "",
    active_sku: line?.active_sku || "",
    status_detail: line?.status_detail || "",
  };
}

function buildSkuForm(line) {
  const primarySku = line?.skus?.[0];
  return {
    sku: primarySku?.sku || line?.active_sku || "",
    shift_output:
      primarySku?.shift_output !== undefined && primarySku?.shift_output !== null
        ? String(primarySku.shift_output)
        : "",
    quality_yield:
      primarySku?.quality_yield !== undefined && primarySku?.quality_yield !== null
        ? String(primarySku.quality_yield)
        : "",
    queued_orders:
      primarySku?.queued_orders !== undefined && primarySku?.queued_orders !== null
        ? String(primarySku.queued_orders)
        : "",
  };
}

function buildInventoryForm(items) {
  const first = items?.[0];
  return {
    inventory_id: first?.id || "",
    on_hand:
      first?.on_hand !== undefined && first?.on_hand !== null ? String(first.on_hand) : "",
    daily_usage:
      first?.daily_usage !== undefined && first?.daily_usage !== null
        ? String(first.daily_usage)
        : "",
    target_days:
      first?.target_days !== undefined && first?.target_days !== null
        ? String(first.target_days)
        : "",
  };
}

function formatDateTime(value) {
  if (!value) return "—";
  try {
    const date = new Date(value);
    return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  } catch (error) {
    return value;
  }
}

function formatRelative(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const diffMs = Date.now() - date.getTime();
  const diffMinutes = Math.round(diffMs / 60000);
  if (diffMinutes <= 1) return "moments ago";
  if (diffMinutes < 60) return `${diffMinutes} min ago`;
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} hr ago`;
  const diffDays = Math.round(diffHours / 24);
  return `${diffDays}d ago`;
}

function StatusBadge({ status }) {
  const normalized = (status || "").toLowerCase();
  const palette = {
    running: "bg-emerald-500/20 text-emerald-200 border-emerald-500/50",
    changeover: "bg-amber-500/20 text-amber-100 border-amber-500/40",
    stopped: "bg-rose-500/20 text-rose-100 border-rose-500/40",
  };
  const classes = palette[normalized] || "bg-slate-500/20 text-slate-200 border-slate-500/40";
  return (
    <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${classes}`}>
      {status || "Unknown"}
    </span>
  );
}

function LineCard({ line, selected = false, onSelect }) {
  const cardClasses = selected
    ? "border-emerald-400/70 bg-emerald-500/10 text-emerald-100 shadow-emerald-500/20"
    : "border-slate-800 bg-slate-900/60 text-slate-200 hover:border-slate-700 hover:bg-slate-900/70";
  return (
    <button
      type="button"
      onClick={onSelect ? () => onSelect(line.id) : undefined}
      className={`w-full text-left rounded-2xl border p-5 shadow-lg shadow-slate-950/40 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/80 ${cardClasses}`}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-400">{line.id}</p>
          <h3 className="mt-1 text-lg font-semibold text-white">{line.name}</h3>
          {line.status_detail ? (
            <p className="mt-2 text-sm text-slate-300">{line.status_detail}</p>
          ) : null}
        </div>
        <StatusBadge status={line.status} />
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm text-slate-300">
        <div>
          <dt className="text-slate-400">Crew lead</dt>
          <dd className="text-white">{line.crew_lead}</dd>
        </div>
        <div className="text-right">
          <dt className="text-slate-400">OEE</dt>
          <dd className="text-white">{formatPercent(line.oee)}</dd>
        </div>
        <div>
          <dt className="text-slate-400">Active SKU</dt>
          <dd className="text-white">{line.active_sku}</dd>
        </div>
        <div className="text-right">
          <dt className="text-slate-400">Shift goal</dt>
          <dd className="text-white">{formatNumber(line.line_goal_units)}</dd>
        </div>
      </dl>
      <div className="mt-5">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400">SKU performance</h4>
        <div className="mt-2 grid gap-3 md:grid-cols-2">
          {Array.isArray(line.skus) && line.skus.length > 0 ? (
            line.skus.map((sku) => (
              <div key={sku.sku} className="rounded-xl border border-slate-800/60 bg-slate-950/40 p-3 text-sm">
                <p className="font-semibold text-white">{sku.sku}</p>
                <p className="text-slate-400 text-xs">{sku.description}</p>
                <dl className="mt-2 grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <dt className="text-slate-400">Output</dt>
                    <dd className="text-white">{formatNumber(sku.shift_output)}</dd>
                  </div>
                  <div className="text-right">
                    <dt className="text-slate-400">Yield</dt>
                    <dd className="text-white">{formatPercent(sku.quality_yield)}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-400">Queued</dt>
                    <dd className="text-white">{formatNumber(sku.queued_orders)}</dd>
                  </div>
                </dl>
              </div>
            ))
          ) : (
            <p className="text-xs text-slate-500">No SKU data available</p>
          )}
        </div>
      </div>
      <p className="mt-4 text-xs text-slate-500">Last updated {formatRelative(line.last_updated)}</p>
    </button>
  );
}

function Section({ title, description, children, actions }) {
  return (
    <section className="rounded-3xl border border-slate-800/80 bg-slate-900/60 p-6 shadow-2xl shadow-slate-950/50">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-white">{title}</h2>
          {description ? <p className="mt-1 text-sm text-slate-400">{description}</p> : null}
        </div>
        {actions || null}
      </div>
      <div className="mt-6 space-y-6">{children}</div>
    </section>
  );
}

function EmptyState({ message }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-900/30 p-6 text-center text-sm text-slate-400">
      {message}
    </div>
  );
}

function ItemList({ items, renderItem, emptyMessage }) {
  if (!Array.isArray(items) || items.length === 0) {
    return <EmptyState message={emptyMessage} />;
  }
  return <div className="space-y-4">{items.map(renderItem)}</div>;
}

function RecentDefects({ defects }) {
  return (
    <ItemList
      items={defects?.items || []}
      emptyMessage="No recent defects for this viewer."
      renderItem={(defect) => (
        <article
          key={defect.id}
          className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4 text-sm text-slate-200"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
            <span className="font-semibold text-emerald-200">{defect.line_id}</span>
            <span>{formatDateTime(defect.detected_at)}</span>
          </div>
          <p className="mt-2 text-base font-semibold text-white">{defect.description}</p>
          <p className="mt-1 text-sm text-slate-300">SKU {defect.sku}</p>
          <p className="mt-2 text-xs uppercase tracking-wide text-amber-300">Severity: {defect.severity}</p>
          <p className="mt-2 text-sm text-slate-300">Containment: {defect.containment}</p>
        </article>
      )}
    />
  );
}

function DowntimeEvents({ events }) {
  return (
    <ItemList
      items={events?.items || []}
      emptyMessage="No downtime logged for this viewer."
      renderItem={(event) => (
        <article key={event.id} className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4 text-sm text-slate-200">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
            <span className="font-semibold text-emerald-200">{event.line_id}</span>
            <span>{formatRelative(event.started_at)}</span>
          </div>
          <p className="mt-2 text-base font-semibold text-white">{event.reason}</p>
          <p className="mt-1 text-sm text-slate-300">Reported by {event.reported_by}</p>
          <p className="mt-2 text-xs text-slate-400">Status: {event.status}</p>
          {event.expected_resolution ? (
            <p className="mt-1 text-xs text-slate-400">
              Expected resolution {formatRelative(event.expected_resolution)}
            </p>
          ) : null}
        </article>
      )}
    />
  );
}

function MaintenanceBacklog({ items }) {
  return (
    <ItemList
      items={items?.items || []}
      emptyMessage="No maintenance backlog items for this viewer."
      renderItem={(item) => (
        <article key={item.id} className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4 text-sm text-slate-200">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
            <span className="font-semibold text-emerald-200">{item.area}</span>
            <span>{item.priority}</span>
          </div>
          <p className="mt-2 text-base font-semibold text-white">{item.title}</p>
          <p className="mt-1 text-sm text-slate-300">{item.summary}</p>
          <p className="mt-2 text-xs text-slate-400">Owner: {item.owner}</p>
          {item.due ? (
            <p className="mt-1 text-xs text-slate-400">Due {formatRelative(item.due)}</p>
          ) : null}
          <p className="mt-1 text-xs text-emerald-200">Status: {item.status}</p>
        </article>
      )}
    />
  );
}

function QualitySummary({ summary }) {
  if (!summary) {
    return <EmptyState message="Quality summary not available for this viewer." />;
  }
  const metrics = [
    { label: "First pass yield", value: formatPercent(summary.first_pass_yield) },
    { label: "Containment actions", value: formatNumber(summary.containment_actions) },
    { label: "Audits due", value: formatNumber(summary.audits_due) },
  ];
  return (
    <div>
      <div className="grid gap-4 sm:grid-cols-3">
        {metrics.map((metric) => (
          <div
            key={metric.label}
            className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4 text-sm text-slate-300"
          >
            <p className="text-xs uppercase tracking-wide text-slate-400">{metric.label}</p>
            <p className="mt-2 text-2xl font-semibold text-white">{metric.value}</p>
          </div>
        ))}
      </div>
      <div className="mt-6">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Top defects</h3>
        <ul className="mt-3 space-y-2 text-sm text-slate-300">
          {(summary.top_defects || []).map((defect, index) => {
            const key =
              defect.id ||
              `${defect.sku || "defect"}-${defect.issue || defect.description || "item"}-${index}`;
            return (
              <li key={key} className="rounded-xl border border-slate-800/60 bg-slate-950/40 p-3">
                <p className="font-semibold text-white">{defect.description}</p>
                <p className="text-xs text-slate-400">{defect.count} occurrences · {defect.line_id}</p>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

function LogisticsBoard({ supplyRuns, inventory, shipments }) {
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="lg:col-span-1 space-y-4">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Inbound materials</h3>
        <ItemList
          items={supplyRuns?.items || []}
          emptyMessage="No inbound material runs scheduled."
          renderItem={(run) => (
            <article key={run.id} className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4 text-sm text-slate-200">
              <p className="text-base font-semibold text-white">{run.material}</p>
              <p className="text-xs text-slate-400">
                Dock {run.dock} · ETA {formatRelative(run.eta)} · {formatNumber(run.quantity)} {run.uom}
              </p>
              <p className="mt-2 text-sm text-slate-300">{run.carrier}</p>
              <p className="mt-2 text-xs text-emerald-200">Status: {run.status}</p>
              {run.notes ? <p className="mt-2 text-xs text-slate-400">{run.notes}</p> : null}
            </article>
          )}
        />
      </div>
      <div className="lg:col-span-1 space-y-4">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Inventory position</h3>
        <ItemList
          items={inventory?.items || []}
          emptyMessage="No inventory tracked for this viewer."
          renderItem={(item) => (
            <article key={item.id} className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4 text-sm text-slate-200">
              <p className="text-base font-semibold text-white">{item.material}</p>
              <dl className="mt-2 grid grid-cols-2 gap-2 text-xs text-slate-300">
                <div>
                  <dt className="text-slate-400">On hand</dt>
                  <dd className="text-white">{formatNumber(item.on_hand)} {item.uom}</dd>
                </div>
                <div>
                  <dt className="text-slate-400">Daily usage</dt>
                  <dd className="text-white">{formatNumber(item.daily_usage)} {item.uom}</dd>
                </div>
                <div>
                  <dt className="text-slate-400">Target</dt>
                  <dd className="text-white">{formatNumber(item.target_days)} days</dd>
                </div>
                <div>
                  <dt className="text-slate-400">Coverage</dt>
                  <dd className="text-white">{formatNumber(item.days_cover)} days</dd>
                </div>
              </dl>
              <p className="mt-2 text-xs text-emerald-200">{item.status}</p>
            </article>
          )}
        />
      </div>
      <div className="lg:col-span-1 space-y-4">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Outbound shipments</h3>
        <ItemList
          items={shipments?.items || []}
          emptyMessage="No outbound shipments scheduled."
          renderItem={(shipment) => (
            <article key={shipment.id} className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4 text-sm text-slate-200">
              <p className="text-base font-semibold text-white">{shipment.destination}</p>
              <p className="text-xs text-slate-400">
                Dock {shipment.dock} · Departs {formatRelative(shipment.departing_at)} · Trailer {shipment.trailer}
              </p>
              <p className="mt-2 text-sm text-slate-300">{shipment.contents}</p>
              <p className="mt-2 text-xs text-emerald-200">Status: {shipment.status}</p>
            </article>
          )}
        />
      </div>
    </div>
  );
}

function SafetyBoard({ incidents, walks, training }) {
  const trainingKeys = ["ppe", "forklift", "lockout_tagout"]; 
  return (
    <div className="space-y-6">
      {training ? (
        <div className="grid gap-4 sm:grid-cols-4">
          <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4 text-sm text-slate-300">
            <p className="text-xs uppercase tracking-wide text-slate-400">Audits due</p>
            <p className="mt-2 text-2xl font-semibold text-white">{formatNumber(training.audits_due)}</p>
          </div>
          {trainingKeys.map((key) => (
            <div key={key} className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4 text-sm text-slate-300">
              <p className="text-xs uppercase tracking-wide text-slate-400">{key.replace(/_/g, " ")}</p>
              <p className="mt-2 text-2xl font-semibold text-white">{formatPercent(training[key])}</p>
            </div>
          ))}
          <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4 text-sm text-slate-300 sm:col-span-4">
            <p className="text-xs uppercase tracking-wide text-slate-400">Last updated</p>
            <p className="mt-2 text-lg font-semibold text-white">{formatRelative(training.last_updated)}</p>
          </div>
        </div>
      ) : null}
      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Safety incidents</h3>
          <ItemList
            items={incidents?.items || []}
            emptyMessage="No safety incidents recorded."
            renderItem={(incident) => (
              <article key={incident.id} className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4 text-sm text-slate-200">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
                  <span className="font-semibold text-emerald-200">{incident.area}</span>
                  <span>{formatDateTime(incident.logged_at)}</span>
                </div>
                <p className="mt-2 text-base font-semibold text-white">{incident.description}</p>
                <p className="mt-1 text-sm text-slate-300">Severity: {incident.severity}</p>
                <p className="mt-1 text-xs text-emerald-200">Status: {incident.status}</p>
                {incident.corrective_action ? (
                  <p className="mt-2 text-xs text-slate-400">Action: {incident.corrective_action}</p>
                ) : null}
              </article>
            )}
          />
        </div>
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Safety walks</h3>
          <ItemList
            items={walks?.items || []}
            emptyMessage="No safety walks logged."
            renderItem={(walk) => (
              <article key={walk.id} className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4 text-sm text-slate-200">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
                  <span className="font-semibold text-emerald-200">{walk.observer}</span>
                  <span>{formatDateTime(walk.logged_at)}</span>
                </div>
                <p className="mt-2 text-base font-semibold text-white">{walk.area}</p>
                <p className="mt-1 text-sm text-slate-300">{walk.notes}</p>
                {walk.follow_up ? (
                  <p className="mt-2 text-xs text-slate-400">Follow-up: {walk.follow_up}</p>
                ) : null}
              </article>
            )}
          />
        </div>
      </div>
    </div>
  );
}

function ShiftNotes({ notes }) {
  return (
    <ItemList
      items={notes?.items || []}
      emptyMessage="No shift notes logged yet."
      renderItem={(note) => (
        <article key={note.id} className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4 text-sm text-slate-200">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
            <span className="font-semibold text-emerald-200">{note.author}</span>
            <span>{formatDateTime(note.logged_at)}</span>
          </div>
          <p className="mt-2 text-base font-semibold text-white">{note.focus}</p>
          <p className="mt-1 text-sm text-slate-300 whitespace-pre-line">{note.note}</p>
        </article>
      )}
    />
  );
}

function PageContent({ page, data, refresh, selectedLineId, onSelectLine, onNotify }) {
  switch (page) {
    case "overview":
      return (
        <OverviewPage
          data={data}
          selectedLineId={selectedLineId}
          onSelectLine={onSelectLine}
          refresh={refresh}
          onNotify={onNotify}
        />
      );
    case "quality":
      return (
        <QualityPage
          data={data}
          refresh={refresh}
          onNotify={onNotify}
          defaultLineId={selectedLineId}
        />
      );
    case "maintenance":
      return <MaintenancePage data={data} refresh={refresh} onNotify={onNotify} />;
    case "logistics":
      return (
        <LogisticsPage
          data={data}
          refresh={refresh}
          onNotify={onNotify}
          defaultLineId={selectedLineId}
        />
      );
    case "safety":
      return (
        <SafetyPage
          data={data}
          refresh={refresh}
          onNotify={onNotify}
          defaultLineId={selectedLineId}
        />
      );
    case "handover":
      return <HandoverPage data={data} refresh={refresh} onNotify={onNotify} />;
    default:
      return <EmptyState message="Choose a section to begin." />;
  }
}

function OverviewPage({ data, selectedLineId, onSelectLine, refresh, onNotify }) {
  const lines = data.lines || [];
  const viewer = data.viewer || {};
  const selectedLine =
    lines.find((entry) => entry.id === selectedLineId) || (lines.length > 0 ? lines[0] : null);

  useEffect(() => {
    if (!selectedLine && lines.length > 0 && onSelectLine) {
      onSelectLine(lines[0].id);
    }
  }, [selectedLine, lines, onSelectLine]);

  const [planEditing, setPlanEditing] = useState(false);
  const [planSaving, setPlanSaving] = useState(false);
  const [planForm, setPlanForm] = useState(() => buildLinePlanForm(selectedLine));
  const [skuForm, setSkuForm] = useState(() => buildSkuForm(selectedLine));
  const [skuSaving, setSkuSaving] = useState(false);
  const [stoppageForm, setStoppageForm] = useState({
    reason: "Unplanned stoppage",
    expected_minutes: "30",
    reported_by: viewer.name || "Operator",
  });
  const [actionLoading, setActionLoading] = useState(false);
  const [defectForm, setDefectForm] = useState({
    sku: selectedLine?.active_sku || selectedLine?.skus?.[0]?.sku || "",
    severity: "minor",
    description: "",
  });
  const inventoryItems = data.inventory_positions?.items || [];
  const [inventoryForm, setInventoryForm] = useState(() => buildInventoryForm(inventoryItems));
  const [inventoryLoading, setInventoryLoading] = useState(false);

  useEffect(() => {
    if (!selectedLine) {
      return;
    }
    setPlanForm(buildLinePlanForm(selectedLine));
    setSkuForm((prev) => {
      if (prev.sku && selectedLine.skus?.some((sku) => sku.sku === prev.sku)) {
        const match = selectedLine.skus.find((sku) => sku.sku === prev.sku);
        return {
          sku: prev.sku,
          shift_output:
            match?.shift_output !== undefined && match?.shift_output !== null
              ? String(match.shift_output)
              : prev.shift_output,
          quality_yield:
            match?.quality_yield !== undefined && match?.quality_yield !== null
              ? String(match.quality_yield)
              : prev.quality_yield,
          queued_orders:
            match?.queued_orders !== undefined && match?.queued_orders !== null
              ? String(match.queued_orders)
              : prev.queued_orders,
        };
      }
      return buildSkuForm(selectedLine);
    });
    setDefectForm((prev) => ({
      sku: selectedLine.active_sku || prev.sku || selectedLine.skus?.[0]?.sku || "",
      severity: prev.severity || "minor",
      description: "",
    }));
    setPlanEditing(false);
  }, [selectedLine?.id]);

  useEffect(() => {
    setInventoryForm((prev) => {
      if (!inventoryItems || inventoryItems.length === 0) {
        return { inventory_id: "", on_hand: "", daily_usage: "", target_days: "" };
      }
      if (prev.inventory_id && inventoryItems.some((item) => item.id === prev.inventory_id)) {
        return prev;
      }
      return buildInventoryForm(inventoryItems);
    });
  }, [inventoryItems]);

  const handlePlanSave = async (event) => {
    event.preventDefault();
    if (!selectedLine) return;
    setPlanSaving(true);
    try {
      await postJson("/api/update-line-plan", {
        line_id: selectedLine.id,
        status: planForm.status,
        crew_lead: planForm.crew_lead,
        line_goal_units:
          planForm.line_goal_units === "" ? undefined : Number(planForm.line_goal_units),
        oee: planForm.oee === "" ? undefined : Number(planForm.oee),
        active_sku: planForm.active_sku,
        status_detail: planForm.status_detail,
      });
      onNotify?.("Line plan updated");
      setPlanEditing(false);
      refresh();
    } catch (error) {
      onNotify?.(error.message);
    } finally {
      setPlanSaving(false);
    }
  };

  const handleSkuSave = async (event) => {
    event.preventDefault();
    if (!selectedLine || !skuForm.sku) {
      onNotify?.("Choose a SKU to update");
      return;
    }
    setSkuSaving(true);
    try {
      await postJson("/api/update-line-sku", {
        line_id: selectedLine.id,
        sku: skuForm.sku,
        shift_output: skuForm.shift_output === "" ? undefined : Number(skuForm.shift_output),
        quality_yield:
          skuForm.quality_yield === "" ? undefined : Number(skuForm.quality_yield),
        queued_orders:
          skuForm.queued_orders === "" ? undefined : Number(skuForm.queued_orders),
      });
      onNotify?.("SKU targets updated");
      refresh();
    } catch (error) {
      onNotify?.(error.message);
    } finally {
      setSkuSaving(false);
    }
  };

  const handleLogStoppage = async (event) => {
    event.preventDefault();
    if (!selectedLine) return;
    setActionLoading(true);
    try {
      await postJson("/api/log-stoppage", {
        line_id: selectedLine.id,
        reason: stoppageForm.reason || "Unplanned stoppage",
        expected_minutes: Number(stoppageForm.expected_minutes) || 15,
        reported_by: stoppageForm.reported_by || viewer.name || "Operator",
      });
      onNotify?.("Downtime logged");
      setStoppageForm((prev) => ({ ...prev, reason: "", expected_minutes: "30" }));
      refresh();
    } catch (error) {
      onNotify?.(error.message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleResolveLine = async () => {
    if (!selectedLine) return;
    setActionLoading(true);
    try {
      await postJson("/api/resolve-line", {
        line_id: selectedLine.id,
        note: planForm.status_detail || stoppageForm.reason || "Running to plan",
      });
      onNotify?.("Line marked running");
      refresh();
    } catch (error) {
      onNotify?.(error.message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleRecordDefect = async (event) => {
    event.preventDefault();
    if (!selectedLine) return;
    if (!defectForm.description || !defectForm.description.trim()) {
      onNotify?.("Describe the defect before logging it");
      return;
    }
    try {
      await postJson("/api/record-defect", {
        line_id: selectedLine.id,
        sku:
          defectForm.sku ||
          selectedLine.active_sku ||
          selectedLine.skus?.[0]?.sku ||
          "SKU",
        description: defectForm.description,
        severity: defectForm.severity || "minor",
      });
      onNotify?.("Defect recorded");
      setDefectForm((prev) => ({ ...prev, description: "" }));
      refresh();
    } catch (error) {
      onNotify?.(error.message);
    }
  };

  const handleInventoryUpdate = async (event) => {
    event.preventDefault();
    if (!inventoryForm.inventory_id) {
      onNotify?.("Select an inventory position to adjust");
      return;
    }
    setInventoryLoading(true);
    try {
      await postJson("/api/adjust-inventory", {
        inventory_id: inventoryForm.inventory_id,
        on_hand: inventoryForm.on_hand === "" ? undefined : Number(inventoryForm.on_hand),
        daily_usage:
          inventoryForm.daily_usage === "" ? undefined : Number(inventoryForm.daily_usage),
        target_days:
          inventoryForm.target_days === "" ? undefined : Number(inventoryForm.target_days),
      });
      onNotify?.("Inventory coverage updated");
      refresh();
    } catch (error) {
      onNotify?.(error.message);
    } finally {
      setInventoryLoading(false);
    }
  };

  const currentInventory = inventoryItems.find((item) => item.id === inventoryForm.inventory_id);

  return (
    <div className="space-y-6">
      <Section
        title="Production lines"
        description="Track OEE, shift goals, and crew leads. Select a line to adjust the plan."
      >
        <div className="grid gap-4 md:grid-cols-2">
          {lines.map((line) => (
            <LineCard
              key={line.id}
              line={line}
              selected={selectedLine ? line.id === selectedLine.id : false}
              onSelect={onSelectLine}
            />
          ))}
        </div>
        {selectedLine ? (
          <div className="space-y-6">
            <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-400">{selectedLine.id}</p>
                  <h3 className="mt-1 text-lg font-semibold text-white">{selectedLine.name}</h3>
                  <p className="mt-2 text-sm text-slate-300">
                    {selectedLine.status_detail || "Running to plan"}
                  </p>
                </div>
                <StatusBadge status={selectedLine.status} />
              </div>
              <dl className="mt-4 grid gap-4 sm:grid-cols-4 text-sm text-slate-300">
                <div>
                  <dt className="text-slate-400">Crew lead</dt>
                  <dd className="text-white">{selectedLine.crew_lead}</dd>
                </div>
                <div>
                  <dt className="text-slate-400">Shift goal</dt>
                  <dd className="text-white">{formatNumber(selectedLine.line_goal_units)} units</dd>
                </div>
                <div>
                  <dt className="text-slate-400">OEE</dt>
                  <dd className="text-white">{formatPercent(selectedLine.oee)}</dd>
                </div>
                <div>
                  <dt className="text-slate-400">Active SKU</dt>
                  <dd className="text-white">{selectedLine.active_sku}</dd>
                </div>
              </dl>
              <div className="mt-4">
                <h4 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
                  SKU plan
                </h4>
                {selectedLine.skus && selectedLine.skus.length > 0 ? (
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    {selectedLine.skus.map((sku) => (
                      <div
                        key={sku.sku}
                        className="rounded-xl border border-slate-800 bg-slate-950/50 p-4 text-sm text-slate-200"
                      >
                        <p className="font-semibold text-white">{sku.sku}</p>
                        <p className="text-xs text-slate-400">{sku.description}</p>
                        <dl className="mt-2 space-y-1 text-xs">
                          <div className="flex justify-between">
                            <dt className="text-slate-400">Output</dt>
                            <dd className="text-white">{formatNumber(sku.shift_output)}</dd>
                          </div>
                          <div className="flex justify-between">
                            <dt className="text-slate-400">Yield</dt>
                            <dd className="text-white">{formatPercent(sku.quality_yield)}</dd>
                          </div>
                          <div className="flex justify-between">
                            <dt className="text-slate-400">Queued</dt>
                            <dd className="text-white">{formatNumber(sku.queued_orders)}</dd>
                          </div>
                        </dl>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-3 text-xs text-slate-500">No SKU plan loaded for this line.</p>
                )}
              </div>
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
              <div className="space-y-4">
                <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-semibold text-white">Line plan controls</h3>
                      <p className="text-xs text-slate-500">
                        Tune shift targets, crew assignments, and status copy.
                      </p>
                    </div>
                    <div className="flex gap-2">
                      {planEditing ? (
                        <button
                          type="button"
                          onClick={() => {
                            setPlanEditing(false);
                            setPlanForm(buildLinePlanForm(selectedLine));
                          }}
                          className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:bg-slate-800/70"
                        >
                          Cancel
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setPlanEditing(true)}
                          className="rounded-lg border border-emerald-400/40 px-3 py-1.5 text-xs font-semibold text-emerald-200 hover:bg-emerald-500/10"
                        >
                          Edit plan
                        </button>
                      )}
                    </div>
                  </div>
                  {planEditing ? (
                    <form className="space-y-3 text-sm" onSubmit={handlePlanSave}>
                      <div className="grid gap-3 md:grid-cols-2">
                        <label className="block">
                          <span className="text-xs font-medium text-slate-400">Status</span>
                          <select
                            value={planForm.status}
                            onChange={(event) =>
                              setPlanForm((prev) => ({ ...prev, status: event.target.value }))
                            }
                            className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-2 text-sm text-white focus:border-emerald-400 focus:ring-emerald-400"
                          >
                            <option value="Running">Running</option>
                            <option value="Changeover">Changeover</option>
                            <option value="Stopped">Stopped</option>
                          </select>
                        </label>
                        <label className="block">
                          <span className="text-xs font-medium text-slate-400">Crew lead</span>
                          <input
                            type="text"
                            value={planForm.crew_lead}
                            onChange={(event) =>
                              setPlanForm((prev) => ({ ...prev, crew_lead: event.target.value }))
                            }
                            className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-2 text-sm text-white focus:border-emerald-400 focus:ring-emerald-400"
                          />
                        </label>
                      </div>
                      <div className="grid gap-3 md:grid-cols-3">
                        <label className="block">
                          <span className="text-xs font-medium text-slate-400">Shift goal (units)</span>
                          <input
                            type="number"
                            min="0"
                            value={planForm.line_goal_units}
                            onChange={(event) =>
                              setPlanForm((prev) => ({ ...prev, line_goal_units: event.target.value }))
                            }
                            className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-2 text-sm text-white focus:border-emerald-400 focus:ring-emerald-400"
                          />
                        </label>
                        <label className="block">
                          <span className="text-xs font-medium text-slate-400">OEE (%)</span>
                          <input
                            type="number"
                            min="0"
                            max="100"
                            step="0.1"
                            value={planForm.oee}
                            onChange={(event) =>
                              setPlanForm((prev) => ({ ...prev, oee: event.target.value }))
                            }
                            className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-2 text-sm text-white focus:border-emerald-400 focus:ring-emerald-400"
                          />
                        </label>
                        <label className="block">
                          <span className="text-xs font-medium text-slate-400">Active SKU</span>
                          <input
                            type="text"
                            value={planForm.active_sku}
                            onChange={(event) =>
                              setPlanForm((prev) => ({ ...prev, active_sku: event.target.value }))
                            }
                            className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-2 text-sm text-white focus:border-emerald-400 focus:ring-emerald-400"
                          />
                        </label>
                      </div>
                      <label className="block">
                        <span className="text-xs font-medium text-slate-400">Status detail</span>
                        <textarea
                          rows="2"
                          value={planForm.status_detail}
                          onChange={(event) =>
                            setPlanForm((prev) => ({ ...prev, status_detail: event.target.value }))
                          }
                          className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-2 text-sm text-white focus:border-emerald-400 focus:ring-emerald-400"
                          placeholder="E.g. Running with QA audit shadowing station 4"
                        />
                      </label>
                      <button
                        type="submit"
                        disabled={planSaving}
                        className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-emerald-950 shadow shadow-emerald-500/30 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-emerald-500/50"
                      >
                        {planSaving ? (
                          <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3.5-3.5L12 1v4a7 7 0 00-7 7H4z"></path>
                          </svg>
                        ) : null}
                        <span>Save updates</span>
                      </button>
                    </form>
                  ) : (
                    <p className="text-xs text-slate-500">
                      <span className="font-medium text-slate-200">{selectedLine.status}</span> · Goal
                      <span className="font-medium text-slate-200"> {formatNumber(selectedLine.line_goal_units)}</span> units · Crew lead
                      <span className="font-medium text-slate-200"> {selectedLine.crew_lead}</span>
                    </p>
                  )}
                </div>

                <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-5 space-y-3 text-sm">
                  <div>
                    <h3 className="text-sm font-semibold text-white">Adjust SKU targets</h3>
                    <p className="text-xs text-slate-500">
                      Cycle count updates adjust throughput goals without leaving the control room.
                    </p>
                  </div>
                  {selectedLine.skus && selectedLine.skus.length > 0 ? (
                    <form className="space-y-3" onSubmit={handleSkuSave}>
                      <label className="block">
                        <span className="text-xs font-medium text-slate-400">SKU</span>
                        <select
                          value={skuForm.sku}
                          onChange={(event) => {
                            const nextSku = event.target.value;
                            const match = selectedLine.skus.find((sku) => sku.sku === nextSku);
                            setSkuForm({
                              sku: nextSku,
                              shift_output:
                                match?.shift_output !== undefined && match?.shift_output !== null
                                  ? String(match.shift_output)
                                  : "",
                              quality_yield:
                                match?.quality_yield !== undefined && match?.quality_yield !== null
                                  ? String(match.quality_yield)
                                  : "",
                              queued_orders:
                                match?.queued_orders !== undefined && match?.queued_orders !== null
                                  ? String(match.queued_orders)
                                  : "",
                            });
                          }}
                          className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-2 text-sm text-white focus:border-slate-500 focus:ring-slate-500"
                        >
                          {selectedLine.skus.map((sku) => (
                            <option key={sku.sku} value={sku.sku}>
                              {sku.sku} — {sku.description}
                            </option>
                          ))}
                        </select>
                      </label>
                      <div className="grid gap-3 md:grid-cols-3">
                        <label className="block">
                          <span className="text-xs font-medium text-slate-400">Shift output</span>
                          <input
                            type="number"
                            min="0"
                            value={skuForm.shift_output}
                            onChange={(event) =>
                              setSkuForm((prev) => ({ ...prev, shift_output: event.target.value }))
                            }
                            className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-2 text-sm text-white focus:border-slate-500 focus:ring-slate-500"
                          />
                        </label>
                        <label className="block">
                          <span className="text-xs font-medium text-slate-400">Yield (%)</span>
                          <input
                            type="number"
                            min="0"
                            max="100"
                            step="0.1"
                            value={skuForm.quality_yield}
                            onChange={(event) =>
                              setSkuForm((prev) => ({ ...prev, quality_yield: event.target.value }))
                            }
                            className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-2 text-sm text-white focus:border-slate-500 focus:ring-slate-500"
                          />
                        </label>
                        <label className="block">
                          <span className="text-xs font-medium text-slate-400">Queued orders</span>
                          <input
                            type="number"
                            min="0"
                            value={skuForm.queued_orders}
                            onChange={(event) =>
                              setSkuForm((prev) => ({ ...prev, queued_orders: event.target.value }))
                            }
                            className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-2 text-sm text-white focus:border-slate-500 focus:ring-slate-500"
                          />
                        </label>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="submit"
                          disabled={skuSaving}
                          className="inline-flex items-center gap-2 rounded-xl border border-slate-600 bg-transparent px-4 py-2 text-sm font-semibold text-slate-200 transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {skuSaving ? (
                            <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3.5-3.5L12 1v4a7 7 0 00-7 7H4z"></path>
                            </svg>
                          ) : null}
                          <span>Apply adjustments</span>
                        </button>
                      </div>
                    </form>
                  ) : (
                    <p className="text-xs text-slate-500">No SKU plan loaded for this line yet.</p>
                  )}
                </div>

                <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-5 space-y-3 text-sm">
                  <div>
                    <h3 className="text-sm font-semibold text-white">Log downtime</h3>
                    <p className="text-xs text-slate-500">
                      Alerts maintenance, quality, and the affected crew in real time.
                    </p>
                  </div>
                  <form className="space-y-3" onSubmit={handleLogStoppage}>
                    <label className="block">
                      <span className="text-xs font-medium text-slate-400">Reason</span>
                      <input
                        type="text"
                        value={stoppageForm.reason}
                        onChange={(event) =>
                          setStoppageForm((prev) => ({ ...prev, reason: event.target.value }))
                        }
                        className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-2 text-sm text-white focus:border-emerald-400 focus:ring-emerald-400"
                        placeholder="E.g. Quality hold, missing components"
                      />
                    </label>
                    <div className="grid grid-cols-2 gap-3">
                      <label className="block">
                        <span className="text-xs font-medium text-slate-400">Expected minutes</span>
                        <input
                          type="number"
                          min="1"
                          value={stoppageForm.expected_minutes}
                          onChange={(event) =>
                            setStoppageForm((prev) => ({ ...prev, expected_minutes: event.target.value }))
                          }
                          className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-2 text-sm text-white focus:border-emerald-400 focus:ring-emerald-400"
                        />
                      </label>
                      <label className="block">
                        <span className="text-xs font-medium text-slate-400">Reporter</span>
                        <input
                          type="text"
                          value={stoppageForm.reported_by}
                          onChange={(event) =>
                            setStoppageForm((prev) => ({ ...prev, reported_by: event.target.value }))
                          }
                          className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-2 text-sm text-white focus:border-emerald-400 focus:ring-emerald-400"
                        />
                      </label>
                    </div>
                    <div className="flex flex-wrap gap-3">
                      <button
                        type="submit"
                        disabled={actionLoading}
                        className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-emerald-950 shadow shadow-emerald-500/30 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-emerald-500/50"
                      >
                        {actionLoading ? (
                          <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3.5-3.5L12 1v4a7 7 0 00-7 7H4z"></path>
                          </svg>
                        ) : null}
                        <span>Log stoppage</span>
                      </button>
                      <button
                        type="button"
                        onClick={handleResolveLine}
                        disabled={actionLoading}
                        className="inline-flex items-center gap-2 rounded-xl border border-emerald-400/50 bg-transparent px-4 py-2 text-sm font-semibold text-emerald-200 transition hover:bg-emerald-400/10 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Resume line
                      </button>
                    </div>
                  </form>
                </div>

                <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-5 space-y-3 text-sm">
                  <div>
                    <h3 className="text-sm font-semibold text-white">Record quality issue</h3>
                    <p className="text-xs text-slate-500">
                      Escalate a new defect and keep the operator log current.
                    </p>
                  </div>
                  <form className="space-y-3" onSubmit={handleRecordDefect}>
                    <label className="block">
                      <span className="text-xs font-medium text-slate-400">SKU</span>
                      <input
                        type="text"
                        value={defectForm.sku}
                        onChange={(event) =>
                          setDefectForm((prev) => ({ ...prev, sku: event.target.value }))
                        }
                        className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-2 text-sm text-white focus:border-sky-400 focus:ring-sky-400"
                      />
                    </label>
                    <label className="block">
                      <span className="text-xs font-medium text-slate-400">Severity</span>
                      <select
                        value={defectForm.severity}
                        onChange={(event) =>
                          setDefectForm((prev) => ({ ...prev, severity: event.target.value }))
                        }
                        className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-2 text-sm text-white focus:border-sky-400 focus:ring-sky-400"
                      >
                        <option value="minor">Minor</option>
                        <option value="major">Major</option>
                        <option value="critical">Critical</option>
                      </select>
                    </label>
                    <label className="block">
                      <span className="text-xs font-medium text-slate-400">Description</span>
                      <textarea
                        rows="3"
                        value={defectForm.description}
                        onChange={(event) =>
                          setDefectForm((prev) => ({ ...prev, description: event.target.value }))
                        }
                        className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-2 text-sm text-white focus:border-sky-400 focus:ring-sky-400"
                        placeholder="E.g. Dimensional out-of-tolerance on pump body"
                      />
                    </label>
                    <button
                      type="submit"
                      className="inline-flex items-center gap-2 rounded-xl border border-sky-400/60 bg-sky-500/10 px-4 py-2 text-sm font-semibold text-sky-200 transition hover:bg-sky-500/20"
                    >
                      Log defect
                    </button>
                  </form>
                </div>
              </div>

              <div className="space-y-4">
                <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-5 space-y-3 text-sm">
                  <div>
                    <h3 className="text-sm font-semibold text-white">Adjust coverage</h3>
                    <p className="text-xs text-slate-500">
                      Cycle counts update on-hand and usage assumptions for planners.
                    </p>
                  </div>
                  {inventoryItems.length === 0 ? (
                    <p className="text-xs text-slate-500">Log deliveries to start tracking coverage.</p>
                  ) : (
                    <form className="space-y-3" onSubmit={handleInventoryUpdate}>
                      <label className="block">
                        <span className="text-xs font-medium text-slate-400">Material</span>
                        <select
                          value={inventoryForm.inventory_id}
                          onChange={(event) =>
                            setInventoryForm((prev) => ({ ...prev, inventory_id: event.target.value }))
                          }
                          className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-2 text-sm text-white focus:border-slate-500 focus:ring-slate-500"
                        >
                          {inventoryItems.map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.material}
                            </option>
                          ))}
                        </select>
                      </label>
                      <div className="grid gap-3 md:grid-cols-3">
                        <label className="block">
                          <span className="text-xs font-medium text-slate-400">On hand</span>
                          <input
                            type="number"
                            min="0"
                            value={inventoryForm.on_hand}
                            onChange={(event) =>
                              setInventoryForm((prev) => ({ ...prev, on_hand: event.target.value }))
                            }
                            className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-2 text-sm text-white focus:border-slate-500 focus:ring-slate-500"
                          />
                        </label>
                        <label className="block">
                          <span className="text-xs font-medium text-slate-400">Daily usage</span>
                          <input
                            type="number"
                            min="0"
                            step="0.1"
                            value={inventoryForm.daily_usage}
                            onChange={(event) =>
                              setInventoryForm((prev) => ({ ...prev, daily_usage: event.target.value }))
                            }
                            className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-2 text-sm text-white focus:border-slate-500 focus:ring-slate-500"
                          />
                        </label>
                        <label className="block">
                          <span className="text-xs font-medium text-slate-400">Target days</span>
                          <input
                            type="number"
                            min="0"
                            step="0.1"
                            value={inventoryForm.target_days}
                            onChange={(event) =>
                              setInventoryForm((prev) => ({ ...prev, target_days: event.target.value }))
                            }
                            className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-2 text-sm text-white focus:border-slate-500 focus:ring-slate-500"
                          />
                        </label>
                      </div>
                      {currentInventory ? (
                        <p className="text-xs text-slate-500">
                          Last updated {formatRelative(currentInventory.last_updated)} · {currentInventory.status}
                        </p>
                      ) : null}
                      <button
                        type="submit"
                        disabled={inventoryLoading}
                        className="inline-flex items-center gap-2 rounded-xl border border-slate-600 bg-transparent px-4 py-2 text-sm font-semibold text-slate-200 transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {inventoryLoading ? (
                          <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3.5-3.5L12 1v4a7 7 0 00-7 7H4z"></path>
                          </svg>
                        ) : null}
                        <span>Apply inventory update</span>
                      </button>
                    </form>
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <EmptyState message="Select a line to view controls." />
        )}
      </Section>

      <Section title="Factory activity" description="Latest quality and maintenance signals for this viewer.">
        <div className="grid gap-6 lg:grid-cols-2">
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
              Recent defects
            </h3>
            <RecentDefects defects={data.recent_defects} />
          </div>
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
              Downtime timeline
            </h3>
            <DowntimeEvents events={data.downtime_events} />
          </div>
        </div>
      </Section>
    </div>
  );
}

function QualityPage({ data, refresh, onNotify, defaultLineId }) {
  const lines = data.lines || [];
  const viewer = data.viewer || {};
  const qualitySummary = data.quality_summary;
  const qualityAudits = data.quality_audits?.items || [];
  const [auditForm, setAuditForm] = useState({
    line_id: defaultLineId || "",
    sku: "",
    performed_by: viewer.name || "QA lead",
    status: "Open",
    summary: "",
  });
  const [auditLoading, setAuditLoading] = useState(false);

  useEffect(() => {
    setAuditForm((prev) => {
      if (prev.line_id && lines.some((line) => line.id === prev.line_id)) {
        return prev;
      }
      const fallback =
        (defaultLineId && lines.some((line) => line.id === defaultLineId))
          ? defaultLineId
          : lines[0]?.id || "";
      if (!fallback || fallback === prev.line_id) {
        return prev;
      }
      const match = lines.find((line) => line.id === fallback);
      return {
        ...prev,
        line_id: fallback,
        sku: match?.active_sku || prev.sku,
      };
    });
  }, [lines, defaultLineId]);

  const handleAuditSubmit = async (event) => {
    event.preventDefault();
    if (!auditForm.summary || !auditForm.summary.trim()) {
      onNotify?.("Provide a brief summary for the audit");
      return;
    }
    if (!auditForm.sku) {
      onNotify?.("Specify the SKU that was audited");
      return;
    }
    setAuditLoading(true);
    try {
      await postJson("/api/record-audit", {
        line_id: auditForm.line_id || null,
        sku: auditForm.sku,
        performed_by: auditForm.performed_by || viewer.name || "QA team",
        status: auditForm.status,
        summary: auditForm.summary,
      });
      onNotify?.("Quality audit logged");
      setAuditForm((prev) => ({ ...prev, summary: "" }));
      refresh();
    } catch (error) {
      onNotify?.(error.message);
    } finally {
      setAuditLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <Section
        title="Quality health"
        description="Monitor first-pass yield, defects, and audit activity."
        actions={
          qualitySummary?.last_updated ? (
            <span className="text-xs text-slate-400">
              Updated {formatRelative(qualitySummary.last_updated)}
            </span>
          ) : null
        }
      >
        <QualitySummary summary={qualitySummary} />
      </Section>

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <Section
          title="Log quality audit"
          description="Document layered process audits and alert floor teams."
        >
          <form className="space-y-4 text-sm" onSubmit={handleAuditSubmit}>
            <label className="block">
              <span className="text-xs font-medium text-slate-400">Line</span>
              <select
                value={auditForm.line_id}
                onChange={(event) => {
                  const lineId = event.target.value;
                  const match = lines.find((line) => line.id === lineId);
                  setAuditForm((prev) => ({
                    ...prev,
                    line_id: lineId,
                    sku: match?.active_sku || prev.sku,
                  }));
                }}
                className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-2 text-sm text-white focus:border-sky-400 focus:ring-sky-400"
              >
                <option value="">Across lines</option>
                {lines.map((line) => (
                  <option key={line.id} value={line.id}>
                    {line.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="text-xs font-medium text-slate-400">SKU</span>
                <input
                  type="text"
                  value={auditForm.sku}
                  onChange={(event) =>
                    setAuditForm((prev) => ({ ...prev, sku: event.target.value }))
                  }
                  className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-2 text-sm text-white focus:border-sky-400 focus:ring-sky-400"
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-slate-400">Performed by</span>
                <input
                  type="text"
                  value={auditForm.performed_by}
                  onChange={(event) =>
                    setAuditForm((prev) => ({ ...prev, performed_by: event.target.value }))
                  }
                  className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-2 text-sm text-white focus:border-sky-400 focus:ring-sky-400"
                />
              </label>
            </div>
            <label className="block">
              <span className="text-xs font-medium text-slate-400">Status</span>
              <select
                value={auditForm.status}
                onChange={(event) =>
                  setAuditForm((prev) => ({ ...prev, status: event.target.value }))
                }
                className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-2 text-sm text-white focus:border-sky-400 focus:ring-sky-400"
              >
                <option value="Open">Open</option>
                <option value="Monitoring">Monitoring</option>
                <option value="Closed">Closed</option>
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-400">Summary</span>
              <textarea
                rows="3"
                value={auditForm.summary}
                onChange={(event) =>
                  setAuditForm((prev) => ({ ...prev, summary: event.target.value }))
                }
                className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-2 text-sm text-white focus:border-sky-400 focus:ring-sky-400"
                placeholder="E.g. Pulled 5 pcs for layered process audit"
              />
            </label>
            <button
              type="submit"
              disabled={auditLoading}
              className="inline-flex items-center gap-2 rounded-xl border border-sky-400/60 bg-sky-500/10 px-4 py-2 text-sm font-semibold text-sky-200 transition hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {auditLoading ? (
                <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3.5-3.5L12 1v4a7 7 0 00-7 7H4z"></path>
                </svg>
              ) : null}
              <span>Record audit</span>
            </button>
          </form>
        </Section>

        <Section title="Audit trail" description="Latest layered process audits across the plant.">
          <ItemList
            items={qualityAudits}
            emptyMessage="No audits logged yet."
            renderItem={(audit) => (
              <article
                key={audit.id}
                className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4 text-sm text-slate-200"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
                  <span className="font-semibold text-emerald-200">{audit.sku}</span>
                  <span>{formatDateTime(audit.logged_at)}</span>
                </div>
                <p className="mt-1 text-xs uppercase tracking-wide text-slate-400">
                  {audit.performed_by}
                </p>
                <p className="mt-2 text-sm text-slate-300">{audit.summary}</p>
                <p className="mt-2 text-xs text-slate-500">
                  Status <span className="text-sky-200">{audit.status}</span>
                  {audit.line_id ? (
                    <span> · Line {audit.line_id}</span>
                  ) : null}
                </p>
              </article>
            )}
          />
        </Section>
      </div>

      <Section title="Recent defects" description="Newest escalations from the lines">
        <RecentDefects defects={data.recent_defects} />
      </Section>
    </div>
  );
}


function MaintenancePage({ data, refresh, onNotify }) {
  const lines = data.lines || [];
  const downtimeEvents = data.downtime_events?.items || [];
  const backlog = data.maintenance_backlog?.items || [];
  const lineLookup = useMemo(() => {
    const map = new Map();
    lines.forEach((line) => {
      map.set(line.id, line.name);
    });
    return map;
  }, [lines]);
  const [selectedDowntimeId, setSelectedDowntimeId] = useState(downtimeEvents[0]?.id || "");
  const [dispatchForm, setDispatchForm] = useState({
    technician: "",
    eta_minutes: "15",
    note: "",
  });
  const [dispatchLoading, setDispatchLoading] = useState(false);

  useEffect(() => {
    setSelectedDowntimeId((prev) => {
      if (prev && downtimeEvents.some((event) => event.id === prev)) {
        return prev;
      }
      return downtimeEvents[0]?.id || "";
    });
  }, [downtimeEvents]);

  const selectedEvent = downtimeEvents.find((event) => event.id === selectedDowntimeId) || null;

  const handleDispatch = async (event) => {
    event.preventDefault();
    if (!selectedEvent) {
      onNotify?.("Select a downtime event to dispatch");
      return;
    }
    setDispatchLoading(true);
    try {
      await postJson("/api/dispatch-maintenance", {
        event_id: selectedEvent.id,
        technician: dispatchForm.technician || "Maintenance",
        eta_minutes: Number(dispatchForm.eta_minutes) || 15,
        note: dispatchForm.note,
      });
      onNotify?.("Technician dispatched");
      setDispatchForm({ technician: "", eta_minutes: "15", note: "" });
      refresh();
    } catch (error) {
      onNotify?.(error.message);
    } finally {
      setDispatchLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <Section
        title="Downtime dispatch board"
        description="Maintenance leads assign technicians as stoppages come in."
        actions={
          downtimeEvents.length > 0 ? (
            <span className="text-xs text-slate-400">{downtimeEvents.length} open events</span>
          ) : null
        }
      >
        <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
          <div className="space-y-4">
            {downtimeEvents.length === 0 ? (
              <EmptyState message="No downtime logged." />
            ) : (
              downtimeEvents.map((event) => (
                <button
                  key={event.id}
                  type="button"
                  onClick={() => setSelectedDowntimeId(event.id)}
                  className={`w-full text-left rounded-2xl border px-4 py-3 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70 ${
                    event.id === selectedDowntimeId
                      ? "border-emerald-400/70 bg-emerald-500/10 text-emerald-100"
                      : "border-slate-800 bg-slate-950/60 text-slate-200 hover:border-slate-700 hover:bg-slate-900/70"
                  }`}
                >
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-sm font-semibold">
                        {lineLookup.get(event.line_id) || event.line_id}
                      </p>
                      <p className="text-xs text-slate-400">{formatRelative(event.started_at)}</p>
                    </div>
                    <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                      {event.status}
                    </span>
                  </div>
                  <p className="mt-2 text-sm">{event.reason}</p>
                  <p className="mt-2 text-xs text-slate-400">
                    Reporter <span className="text-slate-200">{event.reported_by}</span>
                  </p>
                  {event.assigned_to ? (
                    <p className="mt-2 text-xs text-emerald-300">Assigned to {event.assigned_to}</p>
                  ) : null}
                </button>
              ))
            )}
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-5 text-sm">
            {!selectedEvent ? (
              <p className="text-slate-500">Choose a downtime event to dispatch.</p>
            ) : (
              <form className="space-y-4" onSubmit={handleDispatch}>
                <div>
                  <h3 className="text-sm font-semibold text-white">
                    {lineLookup.get(selectedEvent.line_id) || selectedEvent.line_id}
                  </h3>
                  <p className="mt-1 text-xs text-slate-400">{selectedEvent.reason}</p>
                </div>
                <div className="grid gap-2 text-xs text-slate-400">
                  <p>
                    Started
                    <span className="font-medium text-slate-200"> {formatDateTime(selectedEvent.started_at)}</span>
                  </p>
                  {selectedEvent.expected_resolution ? (
                    <p>
                      ETA
                      <span className="font-medium text-slate-200">
                        {" "}
                        {formatDateTime(selectedEvent.expected_resolution)}
                      </span>
                    </p>
                  ) : null}
                </div>
                <label className="block">
                  <span className="text-xs font-medium text-slate-400">Technician</span>
                  <input
                    type="text"
                    value={dispatchForm.technician}
                    onChange={(event) =>
                      setDispatchForm((prev) => ({ ...prev, technician: event.target.value }))
                    }
                    className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-2 text-sm text-white focus:border-emerald-400 focus:ring-emerald-400"
                  />
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <label className="block">
                    <span className="text-xs font-medium text-slate-400">ETA (minutes)</span>
                    <input
                      type="number"
                      min="1"
                      value={dispatchForm.eta_minutes}
                      onChange={(event) =>
                        setDispatchForm((prev) => ({ ...prev, eta_minutes: event.target.value }))
                      }
                      className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-2 text-sm text-white focus:border-emerald-400 focus:ring-emerald-400"
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs font-medium text-slate-400">Notes</span>
                    <input
                      type="text"
                      value={dispatchForm.note}
                      onChange={(event) =>
                        setDispatchForm((prev) => ({ ...prev, note: event.target.value }))
                      }
                      className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-2 text-sm text-white focus:border-emerald-400 focus:ring-emerald-400"
                    />
                  </label>
                </div>
                <button
                  type="submit"
                  disabled={dispatchLoading}
                  className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-emerald-950 shadow shadow-emerald-500/30 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-emerald-500/50"
                >
                  {dispatchLoading ? (
                    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3.5-3.5L12 1v4a7 7 0 00-7 7H4z"></path>
                    </svg>
                  ) : null}
                  <span>Dispatch maintenance</span>
                </button>
              </form>
            )}
          </div>
        </div>
      </Section>

      <Section
        title="Preventive backlog"
        description="Upcoming work orders awaiting assignment or completion."
        actions={
          backlog.length > 0 ? (
            <span className="text-xs text-slate-400">{backlog.length} tasks</span>
          ) : null
        }
      >
        <MaintenanceBacklog items={data.maintenance_backlog} />
      </Section>
    </div>
  );
}


function LogisticsPage({ data, refresh, onNotify, defaultLineId }) {
  const lines = data.lines || [];
  const inventoryCatalog = data.inventory_catalog || [];
  const shipments = data.outbound_shipments?.items || [];
  const [deliveryForm, setDeliveryForm] = useState({
    line_id: defaultLineId || "",
    material: inventoryCatalog[0] || "",
    quantity: "1",
    uom: "units",
    dock: "Dock 1",
    carrier: "",
    eta_minutes: "30",
    notes: "",
  });
  const [deliveryLoading, setDeliveryLoading] = useState(false);
  const [shipmentForm, setShipmentForm] = useState({
    line_id: defaultLineId || "",
    destination: "",
    dock: "Dock 2",
    trailer: "",
    contents: "",
    departure_minutes: "45",
  });
  const [shipmentLoading, setShipmentLoading] = useState(false);
  const [shipmentStatusForm, setShipmentStatusForm] = useState({
    shipment_id: shipments[0]?.id || "",
    status: shipments[0]?.status || "Staged",
    departure_minutes: "30",
  });
  const [shipmentStatusLoading, setShipmentStatusLoading] = useState(false);

  useEffect(() => {
    setDeliveryForm((prev) => {
      const validLine = prev.line_id && lines.some((line) => line.id === prev.line_id);
      const nextLine = validLine
        ? prev.line_id
        : (defaultLineId && lines.some((line) => line.id === defaultLineId))
        ? defaultLineId
        : lines[0]?.id || "";
      const catalogMaterial = prev.material || inventoryCatalog[0] || "";
      return {
        ...prev,
        line_id: nextLine,
        material: catalogMaterial,
      };
    });
  }, [lines, inventoryCatalog, defaultLineId]);

  useEffect(() => {
    setShipmentForm((prev) => {
      const validLine = prev.line_id && lines.some((line) => line.id === prev.line_id);
      const nextLine = validLine
        ? prev.line_id
        : (defaultLineId && lines.some((line) => line.id === defaultLineId))
        ? defaultLineId
        : lines[0]?.id || "";
      return {
        ...prev,
        line_id: nextLine,
      };
    });
  }, [lines, defaultLineId]);

  useEffect(() => {
    setShipmentStatusForm((prev) => {
      if (prev.shipment_id && shipments.some((item) => item.id === prev.shipment_id)) {
        return prev;
      }
      const first = shipments[0];
      if (!first) {
        return { shipment_id: "", status: "Staged", departure_minutes: "30" };
      }
      return {
        shipment_id: first.id,
        status: first.status || "Staged",
        departure_minutes: "30",
      };
    });
  }, [shipments]);

  const handleLogDelivery = async (event) => {
    event.preventDefault();
    if (!deliveryForm.material) {
      onNotify?.("Specify a material for the delivery");
      return;
    }
    setDeliveryLoading(true);
    try {
      await postJson("/api/log-delivery", {
        line_id: deliveryForm.line_id || null,
        dock: deliveryForm.dock,
        carrier: deliveryForm.carrier,
        material: deliveryForm.material,
        quantity: Number(deliveryForm.quantity) || 1,
        uom: deliveryForm.uom || "units",
        eta_minutes: Number(deliveryForm.eta_minutes) || 15,
        notes: deliveryForm.notes,
      });
      onNotify?.("Inbound delivery logged");
      setDeliveryForm((prev) => ({ ...prev, quantity: "1", notes: "" }));
      refresh();
    } catch (error) {
      onNotify?.(error.message);
    } finally {
      setDeliveryLoading(false);
    }
  };

  const handleStageShipment = async (event) => {
    event.preventDefault();
    if (!shipmentForm.destination) {
      onNotify?.("Provide a destination for the shipment");
      return;
    }
    setShipmentLoading(true);
    try {
      await postJson("/api/log-shipment", {
        line_id: shipmentForm.line_id || null,
        destination: shipmentForm.destination,
        dock: shipmentForm.dock,
        trailer: shipmentForm.trailer,
        contents: shipmentForm.contents || "Finished goods",
        departure_minutes: Number(shipmentForm.departure_minutes) || 30,
      });
      onNotify?.("Outbound load staged");
      setShipmentForm((prev) => ({ ...prev, destination: "", trailer: "", contents: "" }));
      refresh();
    } catch (error) {
      onNotify?.(error.message);
    } finally {
      setShipmentLoading(false);
    }
  };

  const handleUpdateShipment = async (event) => {
    event.preventDefault();
    if (!shipmentStatusForm.shipment_id) {
      onNotify?.("Select a shipment to update");
      return;
    }
    setShipmentStatusLoading(true);
    try {
      await postJson("/api/update-shipment", {
        shipment_id: shipmentStatusForm.shipment_id,
        status: shipmentStatusForm.status,
        departure_minutes:
          shipmentStatusForm.departure_minutes === ""
            ? null
            : Number(shipmentStatusForm.departure_minutes),
      });
      onNotify?.("Shipment status updated");
      refresh();
    } catch (error) {
      onNotify?.(error.message);
    } finally {
      setShipmentStatusLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <Section
        title="Logistics board"
        description="Stay on top of inbound materials and outbound loads."
      >
        <LogisticsBoard
          supplyRuns={data.supply_runs}
          inventory={data.inventory_positions}
          shipments={data.outbound_shipments}
        />
      </Section>

      <Section
        title="Logistics actions"
        description="Log deliveries, stage outbound loads, and keep shipments current."
      >
        <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
          <form className="rounded-2xl border border-slate-800 bg-slate-950/40 p-5 space-y-3 text-sm" onSubmit={handleLogDelivery}>
            <div>
              <h3 className="text-sm font-semibold text-white">Log inbound delivery</h3>
              <p className="text-xs text-slate-500">
                Posts to the wallboard and updates inventory coverage.
              </p>
            </div>
            <label className="block">
              <span className="text-xs font-medium text-slate-400">Line</span>
              <select
                value={deliveryForm.line_id}
                onChange={(event) =>
                  setDeliveryForm((prev) => ({ ...prev, line_id: event.target.value }))
                }
                className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-2 text-sm text-white focus:border-emerald-400 focus:ring-emerald-400"
              >
                <option value="">General receiving</option>
                {lines.map((line) => (
                  <option key={line.id} value={line.id}>
                    {line.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-400">Material</span>
              <input
                type="text"
                value={deliveryForm.material}
                onChange={(event) =>
                  setDeliveryForm((prev) => ({ ...prev, material: event.target.value }))
                }
                list="material-options"
                className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-2 text-sm text-white focus:border-emerald-400 focus:ring-emerald-400"
              />
              <datalist id="material-options">
                {inventoryCatalog.map((material) => (
                  <option key={material} value={material}></option>
                ))}
              </datalist>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-xs font-medium text-slate-400">Quantity</span>
                <input
                  type="number"
                  min="1"
                  value={deliveryForm.quantity}
                  onChange={(event) =>
                    setDeliveryForm((prev) => ({ ...prev, quantity: event.target.value }))
                  }
                  className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-2 text-sm text-white focus:border-emerald-400 focus:ring-emerald-400"
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-slate-400">UOM</span>
                <input
                  type="text"
                  value={deliveryForm.uom}
                  onChange={(event) =>
                    setDeliveryForm((prev) => ({ ...prev, uom: event.target.value }))
                  }
                  className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-2 text-sm text-white focus:border-emerald-400 focus:ring-emerald-400"
                />
              </label>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-xs font-medium text-slate-400">Dock</span>
                <input
                  type="text"
                  value={deliveryForm.dock}
                  onChange={(event) =>
                    setDeliveryForm((prev) => ({ ...prev, dock: event.target.value }))
                  }
                  className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-2 text-sm text-white focus:border-emerald-400 focus:ring-emerald-400"
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-slate-400">Carrier</span>
                <input
                  type="text"
                  value={deliveryForm.carrier}
                  onChange={(event) =>
                    setDeliveryForm((prev) => ({ ...prev, carrier: event.target.value }))
                  }
                  className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-2 text-sm text-white focus:border-emerald-400 focus:ring-emerald-400"
                />
              </label>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-xs font-medium text-slate-400">ETA (minutes)</span>
                <input
                  type="number"
                  min="0"
                  value={deliveryForm.eta_minutes}
                  onChange={(event) =>
                    setDeliveryForm((prev) => ({ ...prev, eta_minutes: event.target.value }))
                  }
                  className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-2 text-sm text-white focus:border-emerald-400 focus:ring-emerald-400"
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-slate-400">Notes</span>
                <input
                  type="text"
                  value={deliveryForm.notes}
                  onChange={(event) =>
                    setDeliveryForm((prev) => ({ ...prev, notes: event.target.value }))
                  }
                  className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-2 text-sm text-white focus:border-emerald-400 focus:ring-emerald-400"
                />
              </label>
            </div>
            <button
              type="submit"
              disabled={deliveryLoading}
              className="inline-flex items-center gap-2 rounded-xl border border-emerald-400/50 bg-transparent px-4 py-2 text-sm font-semibold text-emerald-200 transition hover:bg-emerald-400/10 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {deliveryLoading ? (
                <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3.5-3.5L12 1v4a7 7 0 00-7 7H4z"></path>
                </svg>
              ) : null}
              <span>Log delivery</span>
            </button>
          </form>

          <div className="space-y-4">
            <form className="rounded-2xl border border-slate-800 bg-slate-950/40 p-5 space-y-3 text-sm" onSubmit={handleStageShipment}>
              <div>
                <h3 className="text-sm font-semibold text-white">Stage outbound load</h3>
                <p className="text-xs text-slate-500">
                  Keeps the dock, customer service, and drivers aligned.
                </p>
              </div>
              <label className="block">
                <span className="text-xs font-medium text-slate-400">Line</span>
                <select
                  value={shipmentForm.line_id}
                  onChange={(event) =>
                    setShipmentForm((prev) => ({ ...prev, line_id: event.target.value }))
                  }
                  className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-2 text-sm text-white focus:border-emerald-400 focus:ring-emerald-400"
                >
                  <option value="">Shared order</option>
                  {lines.map((line) => (
                    <option key={line.id} value={line.id}>
                      {line.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-xs font-medium text-slate-400">Destination</span>
                <input
                  type="text"
                  value={shipmentForm.destination}
                  onChange={(event) =>
                    setShipmentForm((prev) => ({ ...prev, destination: event.target.value }))
                  }
                  className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-2 text-sm text-white focus:border-emerald-400 focus:ring-emerald-400"
                />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-xs font-medium text-slate-400">Dock</span>
                  <input
                    type="text"
                    value={shipmentForm.dock}
                    onChange={(event) =>
                      setShipmentForm((prev) => ({ ...prev, dock: event.target.value }))
                    }
                    className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-2 text-sm text-white focus:border-emerald-400 focus:ring-emerald-400"
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-slate-400">Trailer</span>
                  <input
                    type="text"
                    value={shipmentForm.trailer}
                    onChange={(event) =>
                      setShipmentForm((prev) => ({ ...prev, trailer: event.target.value }))
                    }
                    className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-2 text-sm text-white focus:border-emerald-400 focus:ring-emerald-400"
                  />
                </label>
              </div>
              <label className="block">
                <span className="text-xs font-medium text-slate-400">Contents</span>
                <input
                  type="text"
                  value={shipmentForm.contents}
                  onChange={(event) =>
                    setShipmentForm((prev) => ({ ...prev, contents: event.target.value }))
                  }
                  className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-2 text-sm text-white focus:border-emerald-400 focus:ring-emerald-400"
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-slate-400">Departs in (minutes)</span>
                <input
                  type="number"
                  min="0"
                  value={shipmentForm.departure_minutes}
                  onChange={(event) =>
                    setShipmentForm((prev) => ({ ...prev, departure_minutes: event.target.value }))
                  }
                  className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-2 text-sm text-white focus:border-emerald-400 focus:ring-emerald-400"
                />
              </label>
              <button
                type="submit"
                disabled={shipmentLoading}
                className="inline-flex items-center gap-2 rounded-xl border border-emerald-400/50 bg-transparent px-4 py-2 text-sm font-semibold text-emerald-200 transition hover:bg-emerald-400/10 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {shipmentLoading ? (
                  <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3.5-3.5L12 1v4a7 7 0 00-7 7H4z"></path>
                  </svg>
                ) : null}
                <span>Stage shipment</span>
              </button>
            </form>

            <form className="rounded-2xl border border-slate-800 bg-slate-950/40 p-5 space-y-3 text-sm" onSubmit={handleUpdateShipment}>
              <div>
                <h3 className="text-sm font-semibold text-white">Update shipment status</h3>
                <p className="text-xs text-slate-500">
                  Keep the dock and customer service aligned with departures.
                </p>
              </div>
              {shipments.length === 0 ? (
                <p className="text-xs text-slate-500">No shipments staged.</p>
              ) : (
                <>
                  <label className="block">
                    <span className="text-xs font-medium text-slate-400">Shipment</span>
                    <select
                      value={shipmentStatusForm.shipment_id}
                      onChange={(event) =>
                        setShipmentStatusForm((prev) => ({
                          ...prev,
                          shipment_id: event.target.value,
                        }))
                      }
                      className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-2 text-sm text-white focus:border-slate-500 focus:ring-slate-500"
                    >
                      {shipments.map((shipment) => (
                        <option key={shipment.id} value={shipment.id}>
                          {shipment.reference || shipment.destination} · {shipment.destination}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="block">
                      <span className="text-xs font-medium text-slate-400">Status</span>
                      <select
                        value={shipmentStatusForm.status}
                        onChange={(event) =>
                          setShipmentStatusForm((prev) => ({ ...prev, status: event.target.value }))
                        }
                        className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-2 text-sm text-white focus:border-slate-500 focus:ring-slate-500"
                      >
                        <option value="Staged">Staged</option>
                        <option value="Loading">Loading</option>
                        <option value="Departed">Departed</option>
                        <option value="Delivered">Delivered</option>
                      </select>
                    </label>
                    <label className="block">
                      <span className="text-xs font-medium text-slate-400">Departs in (minutes)</span>
                      <input
                        type="number"
                        min="0"
                        value={shipmentStatusForm.departure_minutes}
                        onChange={(event) =>
                          setShipmentStatusForm((prev) => ({
                            ...prev,
                            departure_minutes: event.target.value,
                          }))
                        }
                        className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-2 text-sm text-white focus:border-slate-500 focus:ring-slate-500"
                      />
                    </label>
                  </div>
                  <button
                    type="submit"
                    disabled={shipmentStatusLoading}
                    className="inline-flex items-center gap-2 rounded-xl border border-slate-600 bg-transparent px-4 py-2 text-sm font-semibold text-slate-200 transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {shipmentStatusLoading ? (
                      <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3.5-3.5L12 1v4a7 7 0 00-7 7H4z"></path>
                      </svg>
                    ) : null}
                    <span>Update shipment</span>
                  </button>
                </>
              )}
            </form>
          </div>
        </div>
      </Section>
    </div>
  );
}


function SafetyPage({ data, refresh, onNotify, defaultLineId }) {
  const lines = data.lines || [];
  const incidents = data.safety_incidents?.items || [];
  const [incidentForm, setIncidentForm] = useState({
    line_id: defaultLineId || "",
    area: "Plant floor",
    severity: "Near miss",
    description: "",
    corrective_action: "",
  });
  const [incidentLoading, setIncidentLoading] = useState(false);
  const [incidentUpdateForm, setIncidentUpdateForm] = useState({
    incident_id: incidents[0]?.id || "",
    status: incidents[0]?.status || "Open",
    corrective_action: incidents[0]?.corrective_action || "",
  });
  const [incidentUpdateLoading, setIncidentUpdateLoading] = useState(false);
  const [walkForm, setWalkForm] = useState({
    observer: "EHS",
    area: "Aisle 1",
    notes: "",
    follow_up: "",
  });
  const [walkLoading, setWalkLoading] = useState(false);

  useEffect(() => {
    setIncidentForm((prev) => {
      const validLine = prev.line_id && lines.some((line) => line.id === prev.line_id);
      const nextLine = validLine
        ? prev.line_id
        : (defaultLineId && lines.some((line) => line.id === defaultLineId))
        ? defaultLineId
        : lines[0]?.id || "";
      return {
        ...prev,
        line_id: nextLine,
      };
    });
  }, [lines, defaultLineId]);

  useEffect(() => {
    setIncidentUpdateForm((prev) => {
      if (prev.incident_id && incidents.some((item) => item.id === prev.incident_id)) {
        return prev;
      }
      const first = incidents[0];
      if (!first) {
        return { incident_id: "", status: "Open", corrective_action: "" };
      }
      return {
        incident_id: first.id,
        status: first.status || "Open",
        corrective_action: first.corrective_action || "",
      };
    });
  }, [incidents]);

  const handleLogIncident = async (event) => {
    event.preventDefault();
    if (!incidentForm.description || !incidentForm.description.trim()) {
      onNotify?.("Describe the safety incident before logging it");
      return;
    }
    setIncidentLoading(true);
    try {
      await postJson("/api/log-safety-incident", {
        line_id: incidentForm.line_id || null,
        area: incidentForm.area,
        severity: incidentForm.severity,
        description: incidentForm.description,
        corrective_action: incidentForm.corrective_action,
      });
      onNotify?.("Safety incident logged");
      setIncidentForm((prev) => ({ ...prev, description: "", corrective_action: "" }));
      refresh();
    } catch (error) {
      onNotify?.(error.message);
    } finally {
      setIncidentLoading(false);
    }
  };

  const handleUpdateIncident = async (event) => {
    event.preventDefault();
    if (!incidentUpdateForm.incident_id) {
      onNotify?.("Select an incident to update");
      return;
    }
    setIncidentUpdateLoading(true);
    try {
      await postJson("/api/update-safety-incident", {
        incident_id: incidentUpdateForm.incident_id,
        status: incidentUpdateForm.status,
        corrective_action: incidentUpdateForm.corrective_action,
      });
      onNotify?.("Incident status updated");
      refresh();
    } catch (error) {
      onNotify?.(error.message);
    } finally {
      setIncidentUpdateLoading(false);
    }
  };

  const handleLogWalk = async (event) => {
    event.preventDefault();
    if (!walkForm.notes || !walkForm.notes.trim()) {
      onNotify?.("Add a brief note for the safety walk");
      return;
    }
    setWalkLoading(true);
    try {
      await postJson("/api/log-safety-walk", {
        observer: walkForm.observer,
        area: walkForm.area,
        notes: walkForm.notes,
        follow_up: walkForm.follow_up,
      });
      onNotify?.("Safety walk recorded");
      setWalkForm((prev) => ({ ...prev, notes: "", follow_up: "" }));
      refresh();
    } catch (error) {
      onNotify?.(error.message);
    } finally {
      setWalkLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <Section
        title="Safety dashboard"
        description="Incident log, safety walks, and training coverage"
      >
        <SafetyBoard
          incidents={data.safety_incidents}
          walks={data.safety_walks}
          training={data.training_compliance}
        />
      </Section>

      <Section
        title="Safety actions"
        description="Log incidents, close the loop, and capture safety walks."
      >
        <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
          <div className="space-y-4">
            <form className="rounded-2xl border border-slate-800 bg-slate-950/40 p-5 space-y-3 text-sm" onSubmit={handleLogIncident}>
              <div>
                <h3 className="text-sm font-semibold text-white">Log safety incident</h3>
                <p className="text-xs text-slate-500">
                  Alerts supervisors and updates compliance expectations.
                </p>
              </div>
              <label className="block">
                <span className="text-xs font-medium text-slate-400">Line</span>
                <select
                  value={incidentForm.line_id}
                  onChange={(event) =>
                    setIncidentForm((prev) => ({ ...prev, line_id: event.target.value }))
                  }
                  className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-2 text-sm text-white focus:border-rose-400 focus:ring-rose-400"
                >
                  <option value="">Plant wide</option>
                  {lines.map((line) => (
                    <option key={line.id} value={line.id}>
                      {line.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-xs font-medium text-slate-400">Area</span>
                <input
                  type="text"
                  value={incidentForm.area}
                  onChange={(event) =>
                    setIncidentForm((prev) => ({ ...prev, area: event.target.value }))
                  }
                  className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-2 text-sm text-white focus:border-rose-400 focus:ring-rose-400"
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-slate-400">Severity</span>
                <select
                  value={incidentForm.severity}
                  onChange={(event) =>
                    setIncidentForm((prev) => ({ ...prev, severity: event.target.value }))
                  }
                  className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-2 text-sm text-white focus:border-rose-400 focus:ring-rose-400"
                >
                  <option>Near miss</option>
                  <option>First aid</option>
                  <option>Recordable</option>
                </select>
              </label>
              <label className="block">
                <span className="text-xs font-medium text-slate-400">Description</span>
                <textarea
                  rows="3"
                  value={incidentForm.description}
                  onChange={(event) =>
                    setIncidentForm((prev) => ({ ...prev, description: event.target.value }))
                  }
                  className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-2 text-sm text-white focus:border-rose-400 focus:ring-rose-400"
                  placeholder="What happened and where"
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-slate-400">Corrective action</span>
                <input
                  type="text"
                  value={incidentForm.corrective_action}
                  onChange={(event) =>
                    setIncidentForm((prev) => ({ ...prev, corrective_action: event.target.value }))
                  }
                  className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-2 text-sm text-white focus:border-rose-400 focus:ring-rose-400"
                />
              </label>
              <button
                type="submit"
                disabled={incidentLoading}
                className="inline-flex items-center gap-2 rounded-xl border border-rose-400/60 bg-rose-500/10 px-4 py-2 text-sm font-semibold text-rose-200 transition hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {incidentLoading ? (
                  <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3.5-3.5L12 1v4a7 7 0 00-7 7H4z"></path>
                  </svg>
                ) : null}
                <span>Log incident</span>
              </button>
            </form>

            <form className="rounded-2xl border border-slate-800 bg-slate-950/40 p-5 space-y-3 text-sm" onSubmit={handleUpdateIncident}>
              <div>
                <h3 className="text-sm font-semibold text-white">Update incident status</h3>
                <p className="text-xs text-slate-500">
                  Close the loop on investigations and broadcast corrective actions.
                </p>
              </div>
              {incidents.length === 0 ? (
                <p className="text-xs text-slate-500">No incidents logged this shift.</p>
              ) : (
                <>
                  <label className="block">
                    <span className="text-xs font-medium text-slate-400">Incident</span>
                    <select
                      value={incidentUpdateForm.incident_id}
                      onChange={(event) =>
                        setIncidentUpdateForm((prev) => ({ ...prev, incident_id: event.target.value }))
                      }
                      className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-2 text-sm text-white focus:border-slate-500 focus:ring-slate-500"
                    >
                      {incidents.map((incident) => (
                        <option key={incident.id} value={incident.id}>
                          {incident.area} · {formatRelative(incident.logged_at)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="text-xs font-medium text-slate-400">Status</span>
                    <select
                      value={incidentUpdateForm.status}
                      onChange={(event) =>
                        setIncidentUpdateForm((prev) => ({ ...prev, status: event.target.value }))
                      }
                      className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-2 text-sm text-white focus:border-slate-500 focus:ring-slate-500"
                    >
                      <option>Open</option>
                      <option>Monitoring</option>
                      <option>Closed</option>
                    </select>
                  </label>
                  <label className="block">
                    <span className="text-xs font-medium text-slate-400">Corrective action</span>
                    <input
                      type="text"
                      value={incidentUpdateForm.corrective_action}
                      onChange={(event) =>
                        setIncidentUpdateForm((prev) => ({ ...prev, corrective_action: event.target.value }))
                      }
                      className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-2 text-sm text-white focus:border-slate-500 focus:ring-slate-500"
                    />
                  </label>
                  <button
                    type="submit"
                    disabled={incidentUpdateLoading}
                    className="inline-flex items-center gap-2 rounded-xl border border-slate-600 bg-transparent px-4 py-2 text-sm font-semibold text-slate-200 transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {incidentUpdateLoading ? (
                      <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3.5-3.5L12 1v4a7 7 0 00-7 7H4z"></path>
                      </svg>
                    ) : null}
                    <span>Update incident</span>
                  </button>
                </>
              )}
            </form>
          </div>

          <form className="rounded-2xl border border-slate-800 bg-slate-950/40 p-5 space-y-3 text-sm" onSubmit={handleLogWalk}>
            <div>
              <h3 className="text-sm font-semibold text-white">Log safety walk</h3>
              <p className="text-xs text-slate-500">
                Completes observations and refreshes training coverage.
              </p>
            </div>
            <label className="block">
              <span className="text-xs font-medium text-slate-400">Observer</span>
              <input
                type="text"
                value={walkForm.observer}
                onChange={(event) =>
                  setWalkForm((prev) => ({ ...prev, observer: event.target.value }))
                }
                className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-2 text-sm text-white focus:border-emerald-400 focus:ring-emerald-400"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-400">Area</span>
              <input
                type="text"
                value={walkForm.area}
                onChange={(event) =>
                  setWalkForm((prev) => ({ ...prev, area: event.target.value }))
                }
                className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-2 text-sm text-white focus:border-emerald-400 focus:ring-emerald-400"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-400">Notes</span>
              <textarea
                rows="3"
                value={walkForm.notes}
                onChange={(event) =>
                  setWalkForm((prev) => ({ ...prev, notes: event.target.value }))
                }
                className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-2 text-sm text-white focus:border-emerald-400 focus:ring-emerald-400"
                placeholder="Observations and follow-ups"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-400">Follow-up</span>
              <input
                type="text"
                value={walkForm.follow_up}
                onChange={(event) =>
                  setWalkForm((prev) => ({ ...prev, follow_up: event.target.value }))
                }
                className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-2 text-sm text-white focus:border-emerald-400 focus:ring-emerald-400"
              />
            </label>
            <button
              type="submit"
              disabled={walkLoading}
              className="inline-flex items-center gap-2 rounded-xl border border-emerald-400/60 bg-emerald-500/10 px-4 py-2 text-sm font-semibold text-emerald-200 transition hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {walkLoading ? (
                <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3.5-3.5L12 1v4a7 7 0 00-7 7H4z"></path>
                </svg>
              ) : null}
              <span>Log safety walk</span>
            </button>
          </form>
        </div>
      </Section>
    </div>
  );
}


function HandoverPage({ data, refresh, onNotify }) {
  const viewer = data.viewer || {};
  const [noteForm, setNoteForm] = useState({
    author: viewer.name || "Supervisor",
    focus: "Shift update",
    note: "",
  });
  const [noteLoading, setNoteLoading] = useState(false);

  const handleShiftNote = async (event) => {
    event.preventDefault();
    if (!noteForm.note || !noteForm.note.trim()) {
      onNotify?.("Capture a quick note before saving");
      return;
    }
    setNoteLoading(true);
    try {
      await postJson("/api/shift-note", {
        author: noteForm.author,
        focus: noteForm.focus,
        note: noteForm.note,
      });
      onNotify?.("Shift note recorded");
      setNoteForm((prev) => ({ ...prev, note: "" }));
      refresh();
    } catch (error) {
      onNotify?.(error.message);
    } finally {
      setNoteLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <Section
        title="Log shift note"
        description="Capture context for the next supervisor before hand-off."
      >
        <form className="rounded-2xl border border-slate-800 bg-slate-950/40 p-5 space-y-3 text-sm" onSubmit={handleShiftNote}>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="block">
              <span className="text-xs font-medium text-slate-400">Author</span>
              <input
                type="text"
                value={noteForm.author}
                onChange={(event) =>
                  setNoteForm((prev) => ({ ...prev, author: event.target.value }))
                }
                className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-2 text-sm text-white focus:border-emerald-400 focus:ring-emerald-400"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-400">Focus</span>
              <input
                type="text"
                value={noteForm.focus}
                onChange={(event) =>
                  setNoteForm((prev) => ({ ...prev, focus: event.target.value }))
                }
                className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-2 text-sm text-white focus:border-emerald-400 focus:ring-emerald-400"
              />
            </label>
          </div>
          <label className="block">
            <span className="text-xs font-medium text-slate-400">Note</span>
            <textarea
              rows="4"
              value={noteForm.note}
              onChange={(event) =>
                setNoteForm((prev) => ({ ...prev, note: event.target.value }))
              }
              className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-2 text-sm text-white focus:border-emerald-400 focus:ring-emerald-400"
              placeholder="Key updates, hand-offs, and outstanding work"
            />
          </label>
          <button
            type="submit"
            disabled={noteLoading}
            className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-emerald-950 shadow shadow-emerald-500/30 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-emerald-500/50"
          >
            {noteLoading ? (
              <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3.5-3.5L12 1v4a7 7 0 00-7 7H4z"></path>
              </svg>
            ) : null}
            <span>Save note</span>
          </button>
        </form>
      </Section>

      <Section title="Shift log" description="Supervisor hand-off log">
        <ShiftNotes notes={data.shift_notes} />
      </Section>
    </div>
  );
}

function App() {
  const directory = window.monitorUsers || { users: [] };
  const defaultUser = directory.users?.find((entry) => entry.id === directory.default) || directory.users?.[0];
  const [selectedUserId, setSelectedUserId] = useState(defaultUser?.id || "");
  const [page, setPage] = useState(defaultUser?.default_page || "overview");
  const [toast, setToast] = useState(null);
  const [selectedLineId, setSelectedLineId] = useState(null);
  const toastTimerRef = useRef(null);

  const currentUser = useMemo(() => {
    return directory.users?.find((user) => user.id === selectedUserId) || defaultUser;
  }, [directory, selectedUserId, defaultUser]);

  const { loading, error, data, refresh } = useDashboard(selectedUserId);

  const showToast = useCallback((message) => {
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
    }
    setToast(message);
    if (message) {
      toastTimerRef.current = setTimeout(() => {
        setToast(null);
        toastTimerRef.current = null;
      }, 4000);
    }
  }, []);

  const handleEvent = useCallback(
    (payload) => {
      if (payload?.message) {
        showToast(payload.message);
      }
      refresh();
    },
    [refresh, showToast],
  );

  useEventStream(selectedUserId, handleEvent);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  const availablePages = useMemo(() => {
    if (!currentUser) return [];
    const scopes = new Set(currentUser.scopes || []);
    return PAGE_METADATA.filter((page) => scopes.has(page.scope));
  }, [currentUser]);

  useEffect(() => {
    if (currentUser && !availablePages.some((entry) => entry.id === page)) {
      setPage(currentUser.default_page || availablePages[0]?.id || "overview");
    }
  }, [currentUser, availablePages, page]);

  useEffect(() => {
    setSelectedLineId(null);
  }, [selectedUserId]);

  useEffect(() => {
    if (!data?.lines || data.lines.length === 0) {
      return;
    }
    if (selectedLineId && data.lines.some((line) => line.id === selectedLineId)) {
      return;
    }
    const viewerLines = data.viewer?.line_access || [];
    const fallback = viewerLines.find((lineId) => data.lines.some((line) => line.id === lineId)) || data.lines[0]?.id;
    if (fallback) {
      setSelectedLineId(fallback);
    }
  }, [data, selectedLineId]);

  const notify = useCallback(
    (message) => {
      if (message) {
        showToast(message);
      }
    },
    [showToast],
  );

  if (!currentUser) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-12 text-center text-slate-300">
        <p>No users are available.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-slate-900/70 border-b border-slate-800/80 backdrop-blur">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <p className="text-sm uppercase tracking-[0.35em] text-slate-400">Riverbend Manufacturing</p>
          <h1 className="mt-2 text-3xl sm:text-4xl font-semibold text-white">Quality &amp; Downtime Control Room</h1>
          <p className="mt-3 max-w-3xl text-slate-300 text-base">
            A React-driven single-page view for supervisors, maintenance, and logistics teams.
          </p>
        </div>
      </header>

      <main className="flex-1 py-10">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 space-y-8">
          {error ? (
            <div className="rounded-xl border border-red-400/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
              <strong className="font-semibold">Error:</strong> {error}
            </div>
          ) : null}

          {toast ? (
            <div className="rounded-xl border border-emerald-500/50 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
              {toast}
            </div>
          ) : null}

          <section className="rounded-3xl border border-slate-800/80 bg-slate-900/60 p-6 shadow-2xl shadow-slate-950/50">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div className="space-y-2">
                <div className="text-sm text-slate-300">
                  <span className="font-semibold text-white">{currentUser.name}</span>
                  <span className="text-slate-500"> · </span>
                  <span>{currentUser.role}</span>
                </div>
                <p className="text-xs text-slate-400">{currentUser.description}</p>
                <div className="flex flex-wrap gap-2">
                  {(currentUser.scopes || []).map((scope) => (
                    <span
                      key={scope}
                      className="inline-flex items-center rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-200"
                    >
                      {scope}
                    </span>
                  ))}
                </div>
                <p className="text-[11px] uppercase tracking-wide text-slate-500">
                  {currentUser.line_access_display || "Line access unknown"}
                </p>
              </div>
              <div className="w-full max-w-xs">
                <label className="block text-xs font-medium text-slate-400">Control room persona</label>
                <select
                  value={selectedUserId}
                  onChange={(event) => setSelectedUserId(event.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-2 text-sm text-white focus:border-emerald-400 focus:ring-emerald-400"
                >
                  {(directory.users || []).map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.name} — {user.role}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </section>

          <nav className="flex flex-wrap items-center gap-2" aria-label="Control room sections">
            {availablePages.map((entry) => (
              <button
                key={entry.id}
                type="button"
                className={`rounded-full border px-4 py-2 text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/80 ${
                  page === entry.id
                    ? "border-emerald-400/70 bg-emerald-500/10 text-emerald-200"
                    : "border-slate-700 text-slate-200 hover:border-slate-500"
                }`}
                onClick={() => setPage(entry.id)}
              >
                {entry.label}
              </button>
            ))}
          </nav>

          {loading || !data ? (
            <div className="py-12 text-center text-slate-400">Loading dashboard…</div>
          ) : (
            <PageContent
              page={page}
              data={data}
              refresh={refresh}
              selectedLineId={selectedLineId}
              onSelectLine={setSelectedLineId}
              onNotify={notify}
            />
          )}
        </div>
      </main>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
