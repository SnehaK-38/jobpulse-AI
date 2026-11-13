import { useEffect, useRef, useState } from "react";
import {
  ArrowUp, Bot, BriefcaseBusiness, Check, ChevronRight, CircleHelp, Compass,
  GraduationCap, LoaderCircle, MessageCircle, Plus, RefreshCw, Sparkles,
  Target, Trash2, UserRound, X, Clock3
} from "lucide-react";
import Navbar from "../../components/Navbar/Navbar";
import {
  createCareerAssistantConversation, deleteCareerAssistantConversation,
  getCareerAssistantConversation, getCareerAssistantConversations,
  sendCareerAssistantMessage
} from "../../services/careerAssistantService";
import "./CareerAssistant.css";

const STARTERS = [
  { icon: Target, title: "Career direction", subtitle: "Find your next move", prompt: "Based on my resume, skills, target role and interests, what career direction should I focus on next?" },
  { icon: BriefcaseBusiness, title: "Job guidance", subtitle: "Understand your saved jobs", prompt: "Review my saved jobs and tell me which ones look most aligned with my current skills and what gaps I should address." },
  { icon: GraduationCap, title: "Learning support", subtitle: "Use your learning progress", prompt: "Look at my Missing Skills Roadmap and learning progress. What should I focus on this week?" },
  { icon: MessageCircle, title: "Interview practice", subtitle: "Prepare with feedback", prompt: "Start a mock interview for my target role. Ask me one question at a time and evaluate my answers." }
];

function InlineText({ text }) {
  const pattern = /(\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|\[[^\]]+\]\(https?:\/\/[^\s)]+\))/g;
  return text.split(pattern).filter(Boolean).map((part, index) => {
    const link = part.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/);
    if (link) return <a key={index} href={link[2]} target="_blank" rel="noopener noreferrer">{link[1]}</a>;
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("__") && part.endsWith("__")) return <u key={index}>{part.slice(2, -2)}</u>;
    if (part.startsWith("*") && part.endsWith("*")) return <em key={index}>{part.slice(1, -1)}</em>;
    return part;
  });
}

function RichMessage({ content }) {
  const lines = String(content || "").split("\n");
  const blocks = [];
  let list = [];
  let listType = "";
  const flush = () => {
    if (list.length) {
      const Tag = listType === "ol" ? "ol" : "ul";
      blocks.push(<Tag key={`list-${blocks.length}`}>{list.map((item, i) => <li key={i}><InlineText text={item} /></li>)}</Tag>);
      list = []; listType = "";
    }
  };
  lines.forEach((line, index) => {
    const trimmed = line.trim();
    const numbered = trimmed.match(/^\d+[.)]\s+(.+)/);
    const bullet = trimmed.match(/^[-•]\s+(.+)/);
    if (numbered || bullet) {
      const type = numbered ? "ol" : "ul";
      if (listType && listType !== type) flush();
      listType = type; list.push((numbered || bullet)[1]); return;
    }
    flush();
    if (!trimmed) { blocks.push(<div className="rich-spacer" key={index} />); return; }
    const heading = trimmed.match(/^(#{1,3})\s+(.+)/);
    if (heading) {
      const Tag = heading[1].length === 1 ? "h3" : "h4";
      blocks.push(<Tag key={index}><InlineText text={heading[2]} /></Tag>);
    } else {
      blocks.push(<p key={index}><InlineText text={trimmed} /></p>);
    }
  });
  flush();
  return <div className="rich-message">{blocks}</div>;
}

function CareerAssistant() {
  const [history, setHistory] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [contextUsed, setContextUsed] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const bottomRef = useRef(null);
  const inputRef = useRef(null);

  const refreshHistory = async () => {
    const result = await getCareerAssistantConversations();
    setHistory(result.conversations || []);
  };

  const openConversation = async (id) => {
    try {
      setLoading(true); setError("");
      const result = await getCareerAssistantConversation(id);
      setActiveId(id); setMessages(result.messages || []); setSuggestions([]); setContextUsed(null); setInput("");
    } catch (err) {
      setError(err?.response?.data?.message || "Unable to open this conversation.");
    } finally { setLoading(false); }
  };

  const startConversation = async (prompt = "") => {
    if (messages.length) { setConfirm({ type: "new", prompt }); return; }
    await createNewConversation(prompt);
  };

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const result = await getCareerAssistantConversations();
        const items = result.conversations || [];
        setHistory(items);
        if (items.length) await openConversation(items[0].id);
        else {
          const created = await createCareerAssistantConversation();
          setActiveId(created.conversation.id);
        }
      } catch (err) { setError(err?.response?.data?.message || "Unable to load your assistant."); }
      finally { setLoading(false); }
    })();
  }, []);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [messages, sending]);

  const requestSwitch = (id) => {
    if (id === activeId) return;
    if (sending) return;
    if (messages.length) setConfirm({ type: "switch", id });
    else openConversation(id);
  };

  const confirmSwitch = async () => {
    const pending = confirm;
    setConfirm(null);
    if (pending?.type === "new") { setConfirm(null); await createNewConversation(pending.prompt || ""); }
    else if (pending?.id) await openConversation(pending.id);
  };

  const createNewConversation = async (prompt = "") => {
    try {
      const result = await createCareerAssistantConversation();
      await refreshHistory(); setActiveId(result.conversation.id); setMessages([]); setSuggestions([]); setContextUsed(null); setInput(prompt);
      setTimeout(() => inputRef.current?.focus(), 50);
    } catch (err) { setError(err?.response?.data?.message || "Unable to start a new conversation."); }
  };

  const send = async (value = input) => {
    const content = value.trim();
    if (!content || sending || !activeId) return;
    setError(""); setInput(""); setSuggestions([]); setSending(true);
    setMessages((current) => [...current, { role: "user", content, optimistic: true }]);
    try {
      const result = await sendCareerAssistantMessage(activeId, content);
      setMessages((current) => [...current.filter((item) => !item.optimistic), { role: "user", content }, result.message]);
      setSuggestions(result.suggestedQuestions || []); setContextUsed(result.contextUsed || null);
      await refreshHistory();
    } catch (err) {
      setMessages((current) => current.filter((item) => !item.optimistic));
      setInput(content);
      setError(err?.response?.data?.message || "Gemini is temporarily unavailable. Please try again.");
    } finally { setSending(false); inputRef.current?.focus(); }
  };

  const removeConversation = async () => {
    const id = confirm?.id;
    setConfirm(null);
    if (!id) return;
    try {
      await deleteCareerAssistantConversation(id);
      const next = history.filter((item) => item.id !== id);
      setHistory(next);
      if (activeId === id) {
        if (next.length) await openConversation(next[0].id);
        else { setActiveId(null); setMessages([]); await startConversation(); }
      }
    } catch (err) { setError(err?.response?.data?.message || "Unable to delete conversation."); }
  };

  const activeTitle = history.find((item) => item.id === activeId)?.title || "New conversation";

  return (
    <>
      <Navbar dashboardMode />
      <main className="career-assistant-page">
        <div className="assistant-shell">
          <aside className="assistant-sidebar">
            <div className="assistant-brand"><span className="assistant-brand-icon"><Sparkles size={19} /></span><div><strong>Career Assistant</strong><small>YOUR PERSONAL CAREER GUIDE</small></div></div>
            <button className="assistant-new-chat" onClick={() => startConversation()}><Plus size={17} /> New conversation</button>
            <div className="assistant-side-label">WHAT I CAN HELP WITH</div>
            {STARTERS.map(({ icon: Icon, title, subtitle, prompt }) => (
              <button className="assistant-capability" key={title} onClick={() => startConversation(prompt)}>
                <Icon size={19} /><span><b>{title}</b><small>{subtitle}</small></span><ChevronRight className="capability-arrow" size={15} />
              </button>
            ))}
            <div className="assistant-history-heading"><span>RECENT CHATS</span><Clock3 size={14} /></div>
            <div className="assistant-history-list">
              {history.map((item) => (
                <div className={`assistant-history-item ${activeId === item.id ? "active" : ""}`} key={item.id}>
                  <button onClick={() => requestSwitch(item.id)} title={item.title}><span>{item.title}</span><small>{item.preview}</small></button>
                  <button className="history-delete" title="Delete conversation" onClick={() => setConfirm({ type: "delete", id: item.id })}><Trash2 size={14} /></button>
                </div>
              ))}
              {!history.length && <p className="history-empty">Your conversations will appear here.</p>}
            </div>
            <div className="assistant-privacy"><Check size={15} /><span>Your guidance is personalised using your own JobPulse profile and learning data.</span></div>
          </aside>

          <section className="assistant-chat">
            <header className="assistant-chat-header">
              <div className="assistant-online"><span className="assistant-avatar"><Bot size={21} /></span><div><h1>{activeTitle}</h1><p><span /> Gemini-powered guidance grounded in your JobPulse data</p></div></div>
              <button className="assistant-refresh" onClick={() => activeId && openConversation(activeId)} title="Reload conversation"><RefreshCw size={16} /></button>
            </header>

            <div className="assistant-messages">
              {loading ? <div className="assistant-loading"><LoaderCircle size={22} /> Loading your conversation...</div> : messages.length === 0 ? (
                <div className="assistant-welcome">
                  <span className="assistant-welcome-icon"><Sparkles size={27} /></span>
                  <h2>Your next career move starts here.</h2>
                  <p>Ask anything about your career, saved jobs, learning roadmap or interview preparation. I'll use your JobPulse account data to make my guidance relevant.</p>
                  <div className="assistant-starters">
                    {STARTERS.map(({ icon: Icon, title, prompt }) => <button key={title} onClick={() => setInput(prompt)}><span><Icon size={18} /></span><b>{title}</b><ChevronRight size={16} /></button>)}
                  </div>
                </div>
              ) : messages.map((message, index) => (
                <article className={message.role === "user" ? "assistant-message user-message" : "assistant-message bot-message"} key={message.id || index}>
                  <span className="message-avatar">{message.role === "user" ? <UserRound size={17} /> : <Bot size={18} />}</span>
                  <div className="message-body"><span className="message-author">{message.role === "user" ? "You" : "JobPulse Assistant"}</span><div className="message-content"><RichMessage content={message.content} /></div></div>
                </article>
              ))}
              {sending && <div className="assistant-message bot-message"><span className="message-avatar"><Bot size={18} /></span><div className="assistant-typing"><i /><i /><i /> <span>Thinking with your JobPulse context...</span></div></div>}
              <div ref={bottomRef} />
            </div>
            {suggestions.length > 0 && <div className="assistant-suggestions">{suggestions.map((item) => <button key={item} onClick={() => send(item)}>{item}<ArrowUp size={13} /></button>)}</div>}
            {contextUsed && <div className="assistant-context-note"><CircleHelp size={14} /> Context used: {contextUsed.resume ? "resume" : "profile"} · {contextUsed.savedJobs} saved jobs · {contextUsed.missingSkillsRoadmap} roadmap skills · {contextUsed.weeklyPlan} learning weeks</div>}
            {error && <div className="assistant-error" role="alert">{error}</div>}
            <form className="assistant-composer" onSubmit={(event) => { event.preventDefault(); send(); }}>
              <textarea ref={inputRef} value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); send(); } }} placeholder="Ask anything about your career..." rows={1} maxLength={2000} disabled={sending || loading} />
              <div className="assistant-composer-footer"><span>Enter to send · Shift + Enter for a new line</span><button type="submit" disabled={!input.trim() || sending || loading || !activeId}>{sending ? <LoaderCircle size={18} /> : <ArrowUp size={19} />}</button></div>
            </form>
            <p className="assistant-disclaimer">Your relevant profile and learning context are sent to Gemini for personalised replies. AI guidance can make mistakes; verify important decisions and job details.</p>
          </section>
        </div>
      </main>
      {confirm && <div className="assistant-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setConfirm(null); }}>
        <section className="assistant-confirm-modal" role="dialog" aria-modal="true" aria-labelledby="assistant-confirm-title">
          <button className="assistant-modal-close" onClick={() => setConfirm(null)} aria-label="Close"><X size={18} /></button>
          <span className="assistant-modal-icon">{confirm.type === "delete" ? <Trash2 size={21} /> : <MessageCircle size={21} />}</span>
          <h2 id="assistant-confirm-title">{confirm.type === "delete" ? "Delete this conversation?" : confirm.type === "new" ? "Start a new conversation?" : "Switch conversation?"}</h2>
          <p>{confirm.type === "delete" ? "This chat and its messages will be permanently deleted. Other conversations will remain saved." : "Your current conversation is already saved. You can return to it anytime from Recent Chats. Do you want to continue?"}</p>
          <div className="assistant-modal-actions"><button className="modal-secondary" onClick={() => setConfirm(null)}>Cancel</button><button className="modal-primary" onClick={confirm.type === "delete" ? removeConversation : confirmSwitch}>{confirm.type === "delete" ? "Delete chat" : "Switch chat"}</button></div>
        </section>
      </div>}
    </>
  );
}

export default CareerAssistant;
