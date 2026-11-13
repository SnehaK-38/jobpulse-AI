import { useCallback, useEffect, useState } from "react";
import { Activity, AlertTriangle, CheckCircle2, CircleHelp, Clock3, LoaderCircle, RefreshCw, ShieldAlert, WifiOff } from "lucide-react";
import { getGeminiApiStatus } from "../../services/careerAssistantService";
import "./GeminiStatus.css";

const LABELS = {
  "AI Career Assistant": "AI Career Assistant",
  "Career Navigator": "Career Navigator",
  "Missing Skills Roadmap": "Missing Skills Roadmap"
};
const prettyTime = (value) => value ? new Date(value).toLocaleString() : "Not recorded";

function GeminiStatus({ compact = false }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      setLoading(true); setError("");
      setData(await getGeminiApiStatus());
    } catch (err) {
      setError(err?.response?.data?.message || "Could not retrieve Gemini status.");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { refresh(); const interval = window.setInterval(refresh, 15000); return () => window.clearInterval(interval); }, [refresh]);

  const state = data?.status || "not_tested";
  const stateText = {
    connected: "Connected",
    rate_limited: "Rate limit reached",
    unavailable: "Temporarily unavailable",
    authentication_error: "API key / project access issue",
    error: "Request failed",
    not_tested: "Not checked yet"
  }[state];
  const Icon = state === "connected" ? CheckCircle2 : state === "rate_limited" || state === "authentication_error" || state === "error" ? ShieldAlert : state === "unavailable" ? WifiOff : CircleHelp;
  const activeFailures = Object.entries(data?.failuresByFeature || {}).filter(([feature, failure]) => {
    const successAt = data?.successesByFeature?.[feature];
    return !successAt || new Date(failure.at) > new Date(successAt);
  });

  return <section className={`gemini-status-card ${compact ? "compact" : ""} state-${state}`}>
    <div className="gemini-status-top">
      <div className="gemini-status-title"><span className="gemini-status-icon"><Activity size={17} /></span><div><strong>Gemini API status</strong><small>Shared status across JobPulse AI features</small></div></div>
      <button className="gemini-status-refresh" onClick={refresh} disabled={loading} title="Refresh Gemini status">{loading ? <LoaderCircle className="gemini-spin" size={16} /> : <RefreshCw size={16} />}<span>Refresh</span></button>
    </div>
    <div className={`gemini-status-state ${state}`}><Icon size={17} /><strong>{stateText}</strong>{data?.lastSuccessAt && <small>Last successful API response: {prettyTime(data.lastSuccessAt)}</small>}</div>
    {data?.lastFailure && <div className="gemini-last-failure"><div className="gemini-failure-heading"><AlertTriangle size={15} /><strong>Most recent feature failure</strong></div><b>{LABELS[data.lastFailure.feature] || data.lastFailure.feature}</b><p>{data.lastFailure.message}</p><small>{data.lastFailure.status ? `HTTP ${data.lastFailure.status} · ` : ""}{prettyTime(data.lastFailure.at)}</small></div>}
    {activeFailures.length > 0 && <div className="gemini-feature-failures"><strong>Feature-specific issues</strong>{activeFailures.map(([feature, failure]) => <div key={feature}><span>{LABELS[feature] || feature}</span><small>{failure.status ? `HTTP ${failure.status} · ` : ""}{failure.message}</small></div>)}</div>}
    {error && <p className="gemini-status-error">{error}</p>}
    <p className="gemini-status-footnote"><Clock3 size={12} /> Updates every 15 seconds using recorded Gemini requests since the backend was last restarted. This status check does not consume a Gemini API request.</p>
  </section>;
}
export default GeminiStatus;
