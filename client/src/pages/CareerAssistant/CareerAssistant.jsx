import { useEffect, useRef, useState } from "react";
import {
  ArrowUp, Bot, BriefcaseBusiness, Check, ChevronRight, CircleHelp,
  Compass, GraduationCap, LoaderCircle, MessageCircle, Plus, RefreshCw,
  Sparkles, Target, Trash2, UserRound
} from "lucide-react";
import Navbar from "../../components/Navbar/Navbar";
import {
  clearCareerAssistantConversation, getCareerAssistantConversation,
  sendCareerAssistantMessage
} from "../../services/careerAssistantService";
import "./CareerAssistant.css";

const STARTERS = [
  { icon: Target, title: "Review my career direction", prompt: "Based on my resume, skills, target role and interests, what career direction should I focus on next?" },
  { icon: BriefcaseBusiness, title: "Help me with saved jobs", prompt: "Review my saved jobs and tell me which ones look most aligned with my current skills and what gaps I should address." },
  { icon: GraduationCap, title: "Plan my next learning steps", prompt: "Look at my Missing Skills Roadmap and learning progress. What should I focus on this week?" },
  { icon: MessageCircle, title: "Practice for an interview", prompt: "Start a mock interview for my target role. Ask me one question at a time and evaluate my answers." }
];

function CareerAssistant() {
  const [messages, setMessages] = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [contextUsed, setContextUsed] = useState(null);
  const bottomRef = useRef(null);
  const inputRef = useRef(null);

  const loadConversation = async () => {
    try {
      setLoading(true);
      const result = await getCareerAssistantConversation();
      setMessages(result.messages || []);
    } catch (err) {
      setError(err?.response?.data?.message || "Unable to load your assistant.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadConversation(); }, []);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [messages, sending]);

  const send = async (value = input) => {
    const content = value.trim();
    if (!content || sending) return;
    setError("");
    setInput("");
    setSuggestions([]);
    setSending(true);
    setMessages((current) => [...current, { role: "user", content, optimistic: true }]);
    try {
      const result = await sendCareerAssistantMessage(content);
      setMessages((current) => [
        ...current.filter((item) => !item.optimistic),
        { role: "user", content },
        result.message
      ]);
      setSuggestions(result.suggestedQuestions || []);
      setContextUsed(result.contextUsed || null);
    } catch (err) {
      setMessages((current) => current.filter((item) => !item.optimistic));
      setInput(content);
      setError(err?.response?.data?.message || "Gemini is temporarily unavailable. Please try again.");
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  const clearChat = async () => {
    if (!window.confirm("Clear your Career Assistant conversation?")) return;
    try {
      await clearCareerAssistantConversation();
      setMessages([]);
      setSuggestions([]);
      setContextUsed(null);
      setError("");
    } catch (err) {
      setError(err?.response?.data?.message || "Unable to clear the conversation.");
    }
  };

  const newChat = () => {
    if (messages.length) clearChat();
    else { setInput(""); setError(""); }
  };

  return (
    <>
      <Navbar dashboardMode />
      <main className="career-assistant-page">
        <div className="assistant-shell">
          <aside className="assistant-sidebar">
            <div className="assistant-brand"><span className="assistant-brand-icon"><Sparkles size={19} /></span><div><strong>Career Assistant</strong><small>YOUR PERSONAL CAREER GUIDE</small></div></div>
            <button className="assistant-new-chat" onClick={newChat}><Plus size={17} /> New conversation</button>
            <div className="assistant-side-label">WHAT I CAN HELP WITH</div>
            <div className="assistant-capability"><Compass size={17} /><span><b>Career direction</b><small>Find your next move</small></span></div>
            <div className="assistant-capability"><BriefcaseBusiness size={17} /><span><b>Job guidance</b><small>Understand your saved jobs</small></span></div>
            <div className="assistant-capability"><GraduationCap size={17} /><span><b>Learning support</b><small>Use your learning progress</small></span></div>
            <div className="assistant-capability"><MessageCircle size={17} /><span><b>Interview practice</b><small>Prepare with feedback</small></span></div>
            <div className="assistant-privacy"><Check size={15} /><span>Your answers are personalised using your own JobPulse profile and saved learning data.</span></div>
            <button className="assistant-clear" onClick={clearChat} disabled={!messages.length}><Trash2 size={15} /> Clear conversation</button>
          </aside>

          <section className="assistant-chat">
            <header className="assistant-chat-header">
              <div className="assistant-online"><span className="assistant-avatar"><Bot size={21} /></span><div><h1>AI Career Assistant</h1><p><span /> Gemini-powered guidance grounded in your JobPulse data</p></div></div>
              <button className="assistant-refresh" onClick={loadConversation} title="Reload conversation"><RefreshCw size={16} /></button>
            </header>

            <div className="assistant-messages">
              {loading ? <div className="assistant-loading"><LoaderCircle size={22} /> Loading your conversation...</div> : messages.length === 0 ? (
                <div className="assistant-welcome">
                  <span className="assistant-welcome-icon"><Sparkles size={27} /></span>
                  <h2>Your next career move starts here.</h2>
                  <p>Ask questions about your career, saved jobs, learning roadmap or interview preparation. I'll use the information already in your JobPulse account to make my guidance relevant.</p>
                  <div className="assistant-starters">
                    {STARTERS.map(({ icon: Icon, title, prompt }) => <button key={title} onClick={() => send(prompt)}><span><Icon size={18} /></span><b>{title}</b><ChevronRight size={16} /></button>)}
                  </div>
                </div>
              ) : messages.map((message, index) => (
                <article className={message.role === "user" ? "assistant-message user-message" : "assistant-message bot-message"} key={message.id || index}>
                  <span className="message-avatar">{message.role === "user" ? <UserRound size={17} /> : <Bot size={18} />}</span>
                  <div className="message-body"><span className="message-author">{message.role === "user" ? "You" : "JobPulse Assistant"}</span><div className="message-content">{message.content}</div></div>
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
              <div className="assistant-composer-footer"><span>Enter to send · Shift + Enter for a new line</span><button type="submit" disabled={!input.trim() || sending || loading}>{sending ? <LoaderCircle size={18} /> : <ArrowUp size={19} />}</button></div>
            </form>
            <p className="assistant-disclaimer">AI guidance can make mistakes. Review important career decisions and verify job details before applying.</p>
          </section>
        </div>
      </main>
    </>
  );
}

export default CareerAssistant;
