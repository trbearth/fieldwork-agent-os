"use client";

import { useEffect, useRef, useState } from "react";
import commandCenter from "../data/command-center.json";
import fashionReport from "../data/latest.json";
import socialReport from "../data/social-latest.json";
import workspace from "../config/workspace.json";

type PrimaryView = "overview" | "agents" | "reports" | "sources";
type View = PrimaryView | "report";
type VoiceState = "idle" | "connecting" | "live" | "error";
type VoiceMode = "chat" | "brief";
type ReportKind = "fashion" | "social" | "batch";

const navItems: { id: PrimaryView; label: string; icon: string }[] = [
  { id: "overview", label: "Overview", icon: "01" },
  { id: "agents", label: "Agents", icon: "02" },
  { id: "reports", label: "Reports", icon: "03" },
  { id: "sources", label: "Sources", icon: "04" },
];

export default function Home() {
  const [view, setView] = useState<View>("overview");
  const [selectedAgent, setSelectedAgent] = useState(commandCenter.agents[0].id);
  const [running, setRunning] = useState(false);
  const [lastUpdated, setLastUpdated] = useState("Updated 2 min ago");
  const [palette, setPalette] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState("");
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [voiceMessage, setVoiceMessage] = useState("Ask about today’s reports");
  const [voiceConfigured, setVoiceConfigured] = useState(false);
  const [runMessage, setRunMessage] = useState("");
  const [selectedReport, setSelectedReport] = useState<ReportKind>("fashion");
  const [fashionData, setFashionData] = useState(fashionReport);
  const [socialData, setSocialData] = useState(socialReport);
  const [showDecision, setShowDecision] = useState(true);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const mediaRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPalette((open) => !open);
      }
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        document.querySelector<HTMLButtonElement>("[data-run-all]")?.click();
      }
      if (event.key === "Escape") setPalette(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    fetch("/api/agents/run")
      .then((response) => response.ok ? response.json() : null)
      .then((state) => {
        if (state?.fashion) setFashionData(state.fashion);
        if (state?.social) setSocialData(state.social);
        if (state?.capabilities) setVoiceConfigured(Boolean(state.capabilities.voiceConfigured));
      })
      .catch(() => { /* The native agent bridge is optional during browser development. */ });
  }, []);

  const selected = commandCenter.agents.find((agent) => agent.id === selectedAgent) ?? commandCenter.agents[0];
  const isSampleBrief =
    (fashionData.run as { mode?: string }).mode !== "live" ||
    (socialData.run as { mode?: string }).mode !== "live";
  const socialIsCached = (socialData.run as { mode?: string }).mode === "cached";
  const reportRows = [
    {
      id: "fashion",
      agent: "SIGNAL MONITOR",
      date: new Date(fashionData.run.generatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
      title: `${fashionData.signals[0]?.name ?? "Signal"} / daily register`,
      findings: fashionData.signals.length,
      citations: fashionData.signals.reduce((total, signal) => total + signal.citations.length, 0),
    },
    {
      id: "social",
      agent: "PUBLIC PULSE",
      date: new Date(socialData.run.generatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
      title: `${socialData.signals[0]?.name ?? "Social"} / public conversation`,
      findings: socialData.signals.length,
      citations: socialData.signals.reduce((total, signal) => total + signal.citations.length, 0),
    },
    commandCenter.reports.find((report) => report.id.startsWith("batch"))!,
  ];
  const runtimeNetworks = new Map(socialData.networkStatus.map((network) => [network.id, network]));
  const publisherObservations = fashionData.run.sourceResults.reduce((total, result) => total + ("count" in result ? result.count : 0), 0);
  const sourceRows = commandCenter.sources.map((source) => {
    if (source.id === "publishers") {
      const failed = fashionData.run.sourceResults.filter((result) => result.status !== "ok").length;
      return { ...source, state: failed ? "degraded" : "ready", detail: failed ? `${failed} feed${failed === 1 ? "" : "s"} need attention` : "Runs without credentials" };
    }
    const runtime = runtimeNetworks.get(source.id);
    const state = source.state === "optional" && isSampleBrief ? "optional" : runtime?.status ?? source.state;
    return { ...source, state, detail: runtime?.reason ?? (source.state === "optional" ? "Extra coverage when connected" : "Protected by source policy") };
  });

  async function runAgents(agentId?: string) {
    if (running) return;
    setRunning(true);
    setRunMessage(agentId ? `Running ${selected.name}…` : "Running the live morning sweep…");
    setLastUpdated(agentId ? `Running ${selected.name}…` : "Running active agents…");
    try {
      const response = await fetch("/api/agents/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "live", agentId }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error ?? "The agent run could not finish.");
      if (result.state?.fashion) setFashionData(result.state.fashion);
      if (result.state?.social) setSocialData(result.state.social);
      if (result.state?.capabilities) setVoiceConfigured(Boolean(result.state.capabilities.voiceConfigured));
      setLastUpdated("Live run completed just now");
      setRunMessage(`${result.results?.length ?? 1} agent${result.results?.length === 1 ? "" : "s"} finished. Reports are current.`);
      window.setTimeout(() => setRunMessage(""), 4500);
    } catch (error) {
      setLastUpdated("Agent run needs attention");
      setRunMessage(error instanceof Error ? error.message : "The agent run could not finish.");
    } finally {
      setRunning(false);
    }
  }

  async function stopVoice() {
    peerRef.current?.close();
    mediaRef.current?.getTracks().forEach((track) => track.stop());
    peerRef.current = null;
    mediaRef.current = null;
    setVoiceState("idle");
    setVoiceMessage("Ask about today’s reports");
  }

  async function startVoice(mode: VoiceMode = "chat") {
    if (voiceState === "live") return stopVoice();
    if (!voiceConfigured) {
      setVoiceState("error");
      setVoiceMessage("Voice is optional. Add OPENAI_API_KEY to enable it.");
      return;
    }
    try {
      setVoiceState("connecting");
      setVoiceMessage("Connecting…");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRef.current = stream;
      const peer = new RTCPeerConnection();
      peerRef.current = peer;
      const audio = document.createElement("audio");
      audio.autoplay = true;
      peer.ontrack = (event) => { audio.srcObject = event.streams[0]; };
      stream.getTracks().forEach((track) => peer.addTrack(track, stream));
      const channel = peer.createDataChannel("oai-events");
      channel.onopen = () => {
        setVoiceState("live");
        if (mode === "brief") {
          setVoiceMessage("Preparing your 45-second brief");
          const topSignals = fashionData.signals.slice(0, 4)
            .map((signal) => `${signal.name}: ${signal.stage}, score ${signal.score}, confidence ${signal.confidence}%`)
            .join("; ");
          const socialSignals = socialData.signals.slice(0, 3)
            .map((signal) => `${signal.name}: score ${signal.score}, ${signal.evidence}`)
            .join("; ");
          channel.send(JSON.stringify({
            type: "response.create",
            response: {
              output_modalities: ["audio"],
              metadata: { response_purpose: "founder_brief" },
              instructions: [
                `Give the ${workspace.briefAudience} a direct 45-second spoken brief using only this saved Fieldwork data.`,
                `Editorial summary: ${fashionData.summary}`,
                `Primary signals: ${topSignals}.`,
                `Social signals: ${socialSignals}.`,
                `Recommended action: ${commandCenter.recommendedAction}`,
                "Lead with what changed, then what it means, then one decision for today.",
                "Mention uncertainty naturally. Do not sound like an AI assistant, use hype, or read every metric."
              ].join(" "),
            },
          }));
        } else {
          setVoiceMessage("Listening");
        }
      };
      channel.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          if (message.type === "input_audio_buffer.speech_started") setVoiceMessage("Listening");
          if (message.type === "response.created") setVoiceMessage("Responding");
          if (message.type === "response.done") setVoiceMessage("Listening");
          if (message.type === "error") setVoiceMessage(message.error?.message ?? "Voice error");
        } catch { /* Realtime sends JSON events; ignore anything else. */ }
      };
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      const response = await fetch("/api/voice/session", {
        method: "POST",
        headers: { "content-type": "application/sdp" },
        body: offer.sdp,
      });
      if (!response.ok) {
        const detail = await response.json().catch(() => ({}));
        throw new Error(detail.error ?? "Voice could not start");
      }
      await peer.setRemoteDescription({ type: "answer", sdp: await response.text() });
    } catch (error) {
      await stopVoice();
      setVoiceState("error");
      setVoiceMessage(error instanceof Error ? error.message : "Voice could not start");
    }
  }

  const commandActions = [
    { icon: "▶", label: "Run all active agents", keywords: "run refresh morning sweep", action: () => void runAgents() },
    { icon: "≡", label: "Open today’s brief", keywords: "report brief evidence", action: () => setView("reports") },
    { icon: "02", label: "Open agent directory", keywords: "agents workers status", action: () => setView("agents") },
    { icon: "04", label: "Review source access", keywords: "sources keys connections public", action: () => setView("sources") },
  ];
  const filteredCommands = commandActions.filter((command) =>
    `${command.label} ${command.keywords}`.toLowerCase().includes(paletteQuery.toLowerCase())
  );

  return (
    <main className="appShell">
      <aside className="sidebar">
        <div className="windowDrag" />
        <div className="productMark"><span>{workspace.mark}</span><strong>{workspace.name}</strong><small>{workspace.workspaceLabel}</small></div>
        <nav aria-label="Main navigation">
          <p>Workspace</p>
          {navItems.map((item) => (
            <button key={item.id} className={view === item.id || (view === "report" && item.id === "reports") ? "active" : ""} onClick={() => setView(item.id)}>
              <i>{item.icon}</i>{item.label}
              {item.id === "agents" && <small>{commandCenter.activeCount}</small>}
            </button>
          ))}
        </nav>
        <div className="savedViews">
          <p>Saved views</p>
          <button onClick={() => setView("reports")}><span className="viewDot green" />Today’s brief</button>
          <button onClick={() => setView("agents")}><span className="viewDot amber" />Needs attention</button>
        </div>
        <div className="sidebarBottom">
          <button onClick={() => setPalette(true)}><span>↗</span>Command bar <kbd>⌘ K</kbd></button>
          <div><span className="avatar">{workspace.ownerInitials}</span><p><strong>{workspace.ownerName}</strong><small>Local workspace</small></p><b>•••</b></div>
        </div>
      </aside>

      <section
        className="mainArea"
        onPointerMove={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect();
          event.currentTarget.style.setProperty("--pointer-x", `${event.clientX - bounds.left}px`);
          event.currentTarget.style.setProperty("--pointer-y", `${event.clientY - bounds.top}px`);
        }}
      >
        <div className={`runRail ${running ? "visible" : ""}`} aria-hidden="true"><i /></div>
        <header className="topbar">
          <div><span className="crumb">{workspace.name}</span><b>/</b><strong>{view === "report" ? "Signal report" : navItems.find((item) => item.id === view)?.label}</strong></div>
          <div className="topActions">
            <span className="updated"><i className={running ? "spinning" : ""} />{lastUpdated}</span>
            <button className={`voiceButton ${voiceState}`} onClick={() => startVoice("chat")} title={voiceConfigured ? "Start voice chat" : "Optional — add an OpenAI key to enable voice"}>
              <i /> {voiceState === "live" ? "End voice" : voiceState === "connecting" ? "Connecting" : "Voice"}
            </button>
            <button className="runButton" data-run-all onClick={() => runAgents()} disabled={running}>
              {running ? "Running…" : "Run agents"} <span>⌘↵</span>
            </button>
          </div>
        </header>

        {view === "overview" && (
          <div className="page">
            <section className="workspaceStrip" aria-label="Workspace readiness">
              <div><i /><span><strong>Core workspace ready</strong><small>No API keys required</small></span></div>
              <p>3 local agents · publisher feeds · public social pulse</p>
              <button onClick={() => setView("sources")}>Review sources <span>→</span></button>
            </section>
            <section className="briefBoard">
              <div className="briefCopy">
                <div className="briefMeta"><span>{isSampleBrief ? "Sample brief" : "Morning brief"}</span><time>{fashionData.run.displayDate}</time></div>
                <h1>{fashionData.signals[0]?.name ?? "Quiet performance"}<br /><em>is moving early.</em></h1>
                <p>{fashionData.summary}</p>
                <div className="briefActions">
                  <button onClick={() => { setSelectedReport("fashion"); setView("report"); }}>Read the evidence <span>↗</span></button>
                  <button onClick={() => startVoice("brief")}><i /> Hear the founder brief</button>
                </div>
              </div>
              <div className="briefIndex">
                <div className="indexScore">
                  <span>Signal index</span>
                  <strong>{commandCenter.systemScore}</strong>
                  <small>+8 since yesterday</small>
                </div>
                <div className="velocityChart">
                  <div><span>Current velocity</span><small>7-day</small></div>
                  {fashionData.signals.slice(0, 3).map((signal, index) => (
                    <div className="velocityRow" key={signal.id}>
                      <span>{String(index + 1).padStart(2, "0")} {signal.name}</span>
                      <i><b style={{ width: `${Math.max(signal.score, 20)}%` }} /></i>
                      <strong>{signal.score}</strong>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            <div className="signalTicker" aria-label="Live signal tape">
              <span>FIELD SIGNALS</span>
              <div><p>
                {[...fashionData.signals.slice(0, 5), ...fashionData.signals.slice(0, 5)].map((signal, index) => (
                  <b key={`${signal.id}-${index}`}>{signal.name}<i>{signal.score}</i></b>
                ))}
              </p></div>
            </div>

            <section className="summaryGrid" aria-label="Workspace summary">
              <Metric label="Agents ready" value={String(commandCenter.activeCount)} detail="local workers" trend="Healthy" />
              <Metric label="Signals found" value={String(fashionData.signals.length + socialData.signals.length)} detail="across 2 reports" trend="Live register" />
              <Metric label="Evidence checked" value={String(publisherObservations + socialData.run.postsCollected)} detail="public observations" trend={`${fashionData.run.sourcesRead + socialData.run.networksReady} feeds`} />
              <Metric label="Social mode" value={socialIsCached ? "Saved" : isSampleBrief ? "Demo" : "Live"} detail="public conversation" trend={socialIsCached ? "Using last good run" : "Ready"} warn={socialIsCached} />
            </section>

            <section className="contentGrid">
              <div className="primaryColumn">
                <Panel title="Active agents" action={<button onClick={() => setView("agents")}>View all</button>}>
                  <div className="agentTable">
                    {commandCenter.agents.map((agent) => (
                      <button key={agent.id} onClick={() => { setSelectedAgent(agent.id); setView("agents"); }}>
                        <span className={`agentBadge ${agent.kind}`}>{agent.name.charAt(0)}</span>
                        <span className="agentName"><strong>{agent.name}</strong><small>{agent.currentTask}</small></span>
                        <span className={`status ${agent.status}`}><i />{agent.status}</span>
                        <span className="runTime">{agent.lastRun}</span>
                        <span className="rowArrow">›</span>
                      </button>
                    ))}
                  </div>
                </Panel>

                <Panel title="Top signals" action={<button onClick={() => { setSelectedReport("fashion"); setView("report"); }}>Open report</button>}>
                  <div className="signalTable">
                    <div className="tableHead"><span>Signal</span><span>Stage</span><span>Confidence</span><span>Score</span></div>
                    {fashionData.signals.slice(0, 4).map((signal) => (
                      <button className="signalLine" key={signal.id} onClick={() => { setSelectedReport("fashion"); setView("report"); }}>
                        <span><strong>{signal.name}</strong><small>{signal.evidence}</small></span>
                        <span className={`stage ${signal.stage}`}>{signal.stage}</span>
                        <span><span className="confidence"><i style={{ width: `${signal.confidence}%` }} /></span>{signal.confidence}%</span>
                        <b>{signal.score}</b>
                      </button>
                    ))}
                  </div>
                </Panel>
              </div>

              <aside className="secondaryColumn">
                {showDecision && <Panel title="Founder decision · 01" className="decisionPanel">
                  <div className="recommendation">
                    <span>Ready to test</span>
                    <h3>Test “quiet performance” as a focused batch</h3>
                    <p>{commandCenter.recommendedAction}</p>
                    <div><button onClick={() => { setSelectedAgent("batch-scout"); setView("agents"); }}>Assign to Synthesis Scout</button><button onClick={() => setShowDecision(false)}>Dismiss</button></div>
                  </div>
                </Panel>}
                <Panel title="Recent activity" action={<button onClick={() => setView("reports")}>See reports</button>}>
                  <Activity />
                </Panel>
              </aside>
            </section>
          </div>
        )}

        {view === "agents" && (
          <div className="page">
            <PageHeading
              title="Agents"
              body="Independent workers with clear inputs, schedules, and report contracts."
              action={<span className="headingNote">4 registered · 2 active</span>}
            />
            <div className="agentsLayout">
              <section className="agentDirectory">
                <div className="directoryHead"><span>Agent</span><span>Status</span><span>Schedule</span><span>Last run</span></div>
                {commandCenter.agents.map((agent) => (
                  <button key={agent.id} className={selectedAgent === agent.id ? "selected" : ""} onClick={() => setSelectedAgent(agent.id)}>
                    <span><i className={`agentBadge ${agent.kind}`}>{agent.name.charAt(0)}</i><b>{agent.name}</b></span>
                    <span className={`status ${agent.status}`}><i />{agent.status}</span>
                    <span>{agent.schedule}</span><span>{agent.lastRun}</span>
                  </button>
                ))}
              </section>
              <aside className="detailCard">
                <div className="detailHeader"><span className={`agentBadge ${selected.kind}`}>{selected.name.charAt(0)}</span><span className="agentScope">Local agent</span></div>
                <h2>{selected.name}</h2><p>{selected.mission}</p>
                <div className="detailActions"><button className="runButton" onClick={() => runAgents(selected.id)} disabled={running || selected.status !== "active"}>{running ? "Running…" : selected.status === "active" ? "Run now" : "Not active"}</button><button className="secondaryButton" onClick={() => setRunMessage(`${selected.name} keeps its schedule, sources, and report path in the local agent registry.`)}>View contract</button></div>
                <dl>
                  <div><dt>Status</dt><dd><span className={`status ${selected.status}`}><i />{selected.status}</span></dd></div>
                  <div><dt>Schedule</dt><dd>{selected.schedule}</dd></div>
                  <div><dt>Sources</dt><dd>{selected.sources}</dd></div>
                  <div><dt>Reports kept</dt><dd>{selected.reports}</dd></div>
                </dl>
                <div className="latestRun"><span>Latest run</span><strong>{selected.currentTask}</strong><div><i style={{ width: `${selected.progress}%` }} /></div><small>{selected.progress}% complete</small></div>
              </aside>
            </div>
          </div>
        )}

        {view === "reports" && (
          <div className="page">
            <PageHeading title="Reports" body="Daily outputs with evidence attached. Inspect the reasoning before you make the call." action={<button className="secondaryButton" onClick={() => { setSelectedReport("fashion"); setView("report"); }}>Open latest</button>} />
            <section className="reportList">
              <div className="reportHead"><span>Report</span><span>Agent</span><span>Findings</span><span>Date</span><span /></div>
              {reportRows.map((report) => (
                <button key={report.id} onClick={() => {
                  setSelectedReport(report.id === "social" ? "social" : report.id.startsWith("batch") ? "batch" : "fashion");
                  setView("report");
                }}>
                  <span className="docIcon">≡</span><span className="reportTitle"><strong>{report.title}</strong><small>{report.citations} source citations</small></span>
                  <span>{report.agent}</span><span>{report.findings}</span><span>{report.date}</span><span>↗</span>
                </button>
              ))}
            </section>
          </div>
        )}

        {view === "report" && (
          <ReportDetail
            kind={selectedReport}
            fashion={fashionData}
            social={socialData}
            onBack={() => setView("reports")}
            onVoice={() => startVoice("brief")}
          />
        )}

        {view === "sources" && (
          <div className="page">
            <PageHeading title="Sources" body="Permissioned inputs only. Every connector shows how it accesses data." action={<span className="headingNote">Public or approved access only</span>} />
            <section className="sourcePrimer">
              <div><span>Works immediately</span><strong>Publisher feeds, Mastodon pulse, synthesis</strong><p>The example workflow runs without accounts, API keys, or paid services.</p></div>
              <div><span>Optional expansion</span><strong>Bluesky, YouTube, voice</strong><p>Connect these only when you want broader coverage or spoken summaries.</p></div>
            </section>
            <section className="sourceList">
              <div className="sourceHead"><span>Source</span><span>Connection</span><span>Access</span><span>Status</span></div>
              {sourceRows.map((source) => (
                <div key={source.name}><span><i>{source.name.slice(0, 2).toUpperCase()}</i><strong>{source.name}</strong></span><span>{source.method}</span><span className="sourceAccess"><b>{source.access}</b><small>{source.detail}</small></span><span className={`sourceStatus ${source.state}`}><i />{source.state}</span></div>
              ))}
            </section>
            <div className="policyNote"><strong>Collection policy</strong><p>Optional and gated sources never block a run. Fieldwork does not scrape logged-in pages, reuse cookies, or bypass platform controls.</p></div>
          </div>
        )}

        {voiceState !== "idle" && (
          <div className={`voiceToast ${voiceState}`}><i /><span><strong>Fieldwork Voice</strong>{voiceMessage}</span><button onClick={stopVoice}>×</button></div>
        )}
        {runMessage && !running && (
          <div className="operationToast"><i /><span>{runMessage}</span><button onClick={() => setRunMessage("")}>×</button></div>
        )}
      </section>

      {palette && (
        <div className="paletteBackdrop" onMouseDown={() => setPalette(false)}>
          <div className="commandPalette" onMouseDown={(event) => event.stopPropagation()}>
            <div><span>⌕</span><input autoFocus value={paletteQuery} onChange={(event) => setPaletteQuery(event.target.value)} onKeyDown={(event) => {
              if (event.key === "Enter" && filteredCommands[0]) {
                filteredCommands[0].action();
                setPalette(false);
                setPaletteQuery("");
              }
            }} placeholder="Search or run an action…" /></div>
            <p>{paletteQuery ? "Results" : "Suggested"}</p>
            {filteredCommands.map((command, index) => (
              <button key={command.label} onClick={() => { command.action(); setPalette(false); setPaletteQuery(""); }}>
                <span>{command.icon}</span>{command.label}{index === 0 && !paletteQuery && <kbd>↵</kbd>}
              </button>
            ))}
            {!filteredCommands.length && <div className="emptyCommands">No matching action</div>}
          </div>
        </div>
      )}
    </main>
  );
}

function ReportDetail({
  kind,
  fashion,
  social,
  onBack,
  onVoice,
}: {
  kind: ReportKind;
  fashion: typeof fashionReport;
  social: typeof socialReport;
  onBack: () => void;
  onVoice: () => void;
}) {
  if (kind === "batch") {
    const overlaps = fashion.signals.filter((signal) => social.signals.some((item) => item.id === signal.id)).slice(0, 3);
    const candidates = overlaps.length
      ? overlaps
      : [...fashion.signals, ...social.signals].filter((signal, index, all) => all.findIndex((item) => item.id === signal.id) === index).slice(0, 3);
    return <div className="page reportPage">
      <header className="reportToolbar"><button onClick={onBack}>← Reports</button><span>SYNTHESIS SCOUT / WORKING THESIS</span></header>
      <section className="reportHero batchReportHero">
        <div><span>Founder draft</span><h1>Civilian equipment</h1><p>A deliberately small test around ordinary city clothing with concealed performance and one personalized object.</p></div>
        <div className="reportStamp"><strong>{candidates.length}</strong><span>{overlaps.length ? "cross-source candidates" : "candidate threads"}</span></div>
      </section>
      <section className="batchCanvas">
        <div><span>THESIS / 01</span><h2>Make utility feel lived-in, not tactical.</h2><p>{commandCenter.recommendedAction}</p></div>
        <ol>{candidates.map((signal) => <li key={signal.id}><span>{signal.name}</span><b>{signal.score}</b><small>{fashion.signals.some((item) => item.id === signal.id) ? "publication score" : "conversation score"}</small></li>)}</ol>
      </section>
      <div className="methodNote"><strong>Human decision required</strong><p>Select one thesis, define the customer and price ceiling, then research actual products and availability.</p></div>
    </div>;
  }

  const isSocial = kind === "social";
  const title = isSocial ? "Social pulse" : "Daily signal";
  const date = isSocial ? new Date(social.run.generatedAt).toLocaleString() : fashion.run.displayDate;
  const signals = isSocial ? social.signals : fashion.signals;
  const summary = isSocial
    ? `${signals[0]?.name ?? "No signal"} leads the public conversation register. Treat conversation velocity as context, not demand.`
    : fashion.summary;
  const downloadHref = isSocial ? "/exports/social-latest.json" : "/exports/latest.json";

  return <div className="page reportPage">
    <header className="reportToolbar">
      <button onClick={onBack}>← Reports</button>
      <span>{isSocial ? "PUBLIC PULSE" : "SIGNAL MONITOR"} / {date}</span>
      <div><button onClick={onVoice}><i /> Hear brief</button><a href={downloadHref} download>Export JSON ↓</a></div>
    </header>
    <section className="reportHero">
      <div>
        <span>Fieldwork / {title}</span>
        <h1>{signals[0]?.name ?? "Signal review"}</h1>
        <p>{summary}</p>
      </div>
      <div className="reportStamp">
        <strong>{signals[0]?.score ?? 0}</strong>
        <span>lead signal score</span>
      </div>
    </section>
    <section className="reportRegister">
      <header><span>Signal</span><span>Stage</span><span>Confidence</span><span>Youth</span><span>Score</span></header>
      {signals.slice(0, 6).map((signal, index) => (
        <article key={signal.id}>
          <div className="reportSignalTitle"><small>{String(index + 1).padStart(2, "0")}</small><span><strong>{signal.name}</strong><p>{signal.evidence}</p></span></div>
          <span className={`stage ${signal.stage}`}>{signal.stage}</span>
          <span>{signal.confidence}%</span>
          <span>{signal.youthRelevance}%</span>
          <b>{signal.score}</b>
          <div className="reportSignalBody">
            <p>{"thesis" in signal ? signal.thesis : `Public conversation around ${signal.name.toLowerCase()} is moving across the configured networks.`}</p>
            <div className="citationGrid">
              {signal.citations.length ? signal.citations.map((citation, citationIndex) => (
                <a href={citation.url} target="_blank" rel="noreferrer" key={`${citation.url}-${citationIndex}`}>
                  <small>{String(citationIndex + 1).padStart(2, "0")} / {"source" in citation ? citation.source : citation.network}</small>
                  <strong>{citation.title}</strong>
                  <span>Open original ↗</span>
                </a>
              )) : <div className="emptyEvidence">No citation crossed the current evidence threshold.</div>}
            </div>
          </div>
        </article>
      ))}
    </section>
    <div className="methodNote">
      <strong>Read before acting</strong>
      <p>Scores are directional research aids—not proof of sales, demographics, or future demand. Check the original sources and use the pattern as a prompt for your own taste.</p>
    </div>
  </div>;
}

function PageHeading({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  return <header className="pageHeading"><div><h1>{title}</h1><p>{body}</p></div>{action}</header>;
}

function Metric({ label, value, detail, trend, warn }: { label: string; value: string; detail: string; trend: string; warn?: boolean }) {
  return <article className="metric"><span>{label}</span><div><strong>{value}</strong><small>{detail}</small></div><p className={warn ? "warn" : ""}>{trend}</p></article>;
}

function Panel({ title, action, children, className = "" }: { title: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return <section className={`panel ${className}`}><header><h2>{title}</h2>{action}</header>{children}</section>;
}

function Activity() {
  return <div className="activity">
    <div><span className="activityIcon">S</span><p><strong>Signal Monitor</strong> completed a run<small>2 minutes ago</small></p></div>
    <div><span className="activityIcon blue">P</span><p><strong>Public Pulse</strong> added 3 new signals<small>12 minutes ago</small></p></div>
    <div><span className="activityIcon gray">Y</span><p><strong>Synthesis Scout</strong> is waiting for review<small>Yesterday</small></p></div>
  </div>;
}
