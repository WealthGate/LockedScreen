import { useEffect, useRef, useState } from "react";
import { Download, Mic, Play, Square, Trash2 } from "lucide-react";
import { Button } from "@lockedscreen/ui";
import type { Question } from "@lockedscreen/shared-types";

const readAudio = (blob: Blob): Promise<string> => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result));
  reader.onerror = () => reject(new Error("Could not read the audio."));
  reader.readAsDataURL(blob);
});
const speeds = [0.5, 0.75, 1, 1.25, 1.5, 2];
const types = new Set(["audio/mpeg", "audio/wav", "audio/x-wav", "audio/ogg", "audio/webm", "audio/mp4"]);
const safeClip = (src: string) => typeof src === "string" && src.length <= 7000000 && /^data:audio\/(mpeg|wav|x-wav|ogg|webm|mp4);base64,/.test(src);

export function LanguageEditor({ question, change, mic }: { question: Question; change: (q: Question) => void; mic: ReturnType<typeof useSpokenAnswers> }) {
  const [error, setError] = useState("");
  const clip = question.listening;
  const latest = useRef(question);
  latest.current = question;
  const draft = mic.answers.current[question.id];
  const capturing = mic.state !== "idle" && mic.questionId === question.id;
  const attach = (src: string) => {
    change({ ...latest.current, listening: { plays: 2, speed: 1, ...latest.current.listening, src } });
    mic.discard(question.id);
    setError("");
  };
  return <fieldset className="space-y-2"><legend className="font-semibold">Language audio</legend>
    <label className="block">Listening clip (up to 5 MB)
      <input className="block" type="file" disabled={capturing} accept=".mp3,.wav,.ogg,.webm,.m4a" onChange={async e => {
        const file = e.target.files?.[0]; e.target.value = ""; if (!file) return;
        try {
          const audio = /\.webm$/i.test(file.name) && (!file.type || file.type === "video/webm") ? file.slice(0,file.size,"audio/webm") : file;
          if (!types.has(audio.type) || !file.size || file.size > 5 * 1024 * 1024) throw new Error("Choose an MP3, WAV, Ogg, WebM or M4A audio file up to 5 MB.");
          const src = await readAudio(audio);
          attach(src);
        } catch (err) { setError(String(err)); }
      }} /></label>
    <div className="flex flex-wrap items-center gap-3">
      {capturing ? <Button data-recording-control variant="danger" onClick={() => void mic.finish()}><Square size={16}/>
        {mic.state === "asking" ? "Cancel microphone request" : "Stop recording"}</Button> :
        <Button variant="secondary" disabled={mic.state !== "idle"} onClick={() => void mic.start(question.id)}><Mic size={16}/>
          {draft ? "Record prompt again" : "Record prompt"}</Button>}
      <span role="status">{capturing && mic.state === "recording" ? "Recording prompt (5-minute maximum)" : "Up to 5 minutes"}</span>
      {mic.questionId === question.id && mic.error && <span role="alert">{mic.error}</span>}
    </div>
    {draft && !capturing && <div className="flex flex-wrap items-center gap-3">
      <audio controls preload="metadata" aria-label="Preview recorded prompt" className="max-w-full" src={draft}/>
      <Button onClick={() => attach(draft)}>Use recording</Button>
      <Button variant="secondary" onClick={() => mic.discard(question.id)}>Discard recording</Button>
    </div>}
    {clip && <div className="flex flex-wrap items-center gap-3">
      {safeClip(clip.src) && <audio controls src={clip.src} preload="none" aria-label="Preview listening clip" />}
      {safeClip(clip.src) && clip.src.startsWith("data:audio/webm;") && <a download="listening-prompt.webm" href={clip.src} aria-label="Download WebM clip" title="Download WebM clip" className="inline-flex p-2"><Download size={18}/></a>}
      <label>Plays per attempt <select value={clip.plays} onChange={e => change({ ...question, listening: { ...clip, plays: Number(e.target.value) } })}>{Array.from({length:10}, (_,i) => <option key={i} value={i+1}>{i+1}</option>)}</select></label>
      <label>Playback speed <select value={clip.speed} onChange={e => change({ ...question, listening: { ...clip, speed: Number(e.target.value) } })}>{speeds.map(n => <option key={n} value={n}>{n}x</option>)}</select></label>
      <Button variant="secondary" title="Remove clip" aria-label="Remove clip" onClick={() => change({ ...question, listening: undefined })}><Trash2 size={16}/></Button></div>}
    <label className="block"><input type="checkbox" checked={question.spokenAnswer === true} onChange={e => change({ ...question, spokenAnswer: e.target.checked })}/> Allow a recorded answer for teacher review</label>
    {error && <p role="alert">{error}</p>}
  </fieldset>;
}

export function ListeningPlayer({ clip, attemptKey }: { clip: NonNullable<Question["listening"]>; attemptKey: string }) {
  const key = "exam-plays:" + attemptKey;
  const readCount = () => {try { const n=Number(localStorage.getItem(key)); return Number.isInteger(n) && n >= 0 ? n : 10; } catch {return 10;}};
  const [used,setUsed] = useState(readCount);
  const player = useRef<HTMLAudioElement>(null);
  const active = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState("");
  const limit = Number.isInteger(clip.plays) && clip.plays >= 1 && clip.plays <= 10 ? clip.plays : 1;
  const end = () => {active.current = false; setPlaying(false);};
  useEffect(() => { const el = player.current; return () => { el?.pause(); }; }, []);
  return <div className="flex flex-wrap items-center gap-3"><audio ref={player} src={safeClip(clip.src) ? clip.src : undefined} preload="none" onEnded={end}/>
    <Button variant="secondary" disabled={playing || used >= limit} onClick={async () => {
      const el = player.current; if (!el || active.current || used >= limit) return;
      active.current = true; setPlaying(true); setError(""); el.currentTime = 0;
      el.playbackRate = speeds.includes(clip.speed) ? clip.speed : 1;
      const previous = readCount();
      if (previous >= limit) { end(); setUsed(previous); return; }
      try { localStorage.setItem(key,String(previous+1)); } catch {end(); setError("The play count could not be saved."); return;}
      setUsed(previous+1);
      try { await el.play(); } catch { if (readCount() === previous+1) {localStorage.setItem(key,String(previous)); setUsed(previous);} end(); setError("Audio could not play."); }
    }}><Play size={16}/> {playing ? "Playing" : "Play clip"}</Button>
    <span>{Math.max(0,limit-used)} plays left</span>{error && <span role="alert">{error}</span>}</div>;
}

export function useSpokenAnswers(mode: "student" | "teacher" = "student") {
  const teacher = mode === "teacher";
  const [questionId,setQuestionId] = useState<string>();
  const [revision,refresh] = useState(0);
  const answers = useRef<Record<string,string>>(Object.create(null));
  const running = useRef<{ stop: () => void; done: Promise<void> } | null>(null);
  const generation = useRef(0);
  const pending = useRef(false);
  const [state,setState] = useState<"idle"|"asking"|"recording">("idle");
  const [error,setError] = useState("");
  const finish = async () => {
    generation.current++; pending.current = false;
    const recording = running.current;
    if (recording) { recording.stop(); await recording.done; }
    setState("idle");
    return { ...answers.current };
  };
  useEffect(() => () => { generation.current++; running.current?.stop(); }, []);
  const start = async (id: string) => {
    if (pending.current || running.current) return;
    setQuestionId(id);
    if (Object.keys(answers.current).length >= 100 && !answers.current[id]) { setError("Recording limit reached."); return; }
    const ticket = ++generation.current;
    setError(""); pending.current = true; setState("asking");
    let stream: MediaStream | undefined;
    try {
      if (!MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) throw Error();
      if (teacher) await window.lockedscreenApi.preparePromptMic();
      if (generation.current !== ticket) return;
      stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      if (generation.current !== ticket) { stream.getTracks().forEach(t => t.stop()); return; }
      const recorder = new MediaRecorder(stream,{ mimeType:"audio/webm;codecs=opus", audioBitsPerSecond:24000 });
      const chunks: Blob[] = [];
      let resolve!: () => void;
      const done = new Promise<void>(r => {resolve=r;});
      const stop = () => { if (recorder.state !== "inactive") recorder.stop(); };
      recorder.ondataavailable = e => { if(e.data.size) chunks.push(e.data); };
      recorder.start();
      const timeout = window.setTimeout(stop,teacher ? 300000 : 60000);
      running.current = {stop,done}; setState("recording");
      recorder.onstop = async () => {
        clearTimeout(timeout); stream?.getTracks().forEach(t => t.stop());
        try {
          const blob = new Blob(chunks,{type:"audio/webm"});
          if (!blob.size || blob.size > (teacher ? 5 * 1024 * 1024 : 740000)) throw Error();
          const src = await readAudio(blob);
          if (Object.entries(answers.current).reduce((n,[k,v]) => n+(k === id ? 0 : v.length),src.length)>16000000) throw Error();
          answers.current[id] = src;
          refresh(n => n + 1);
        } catch { setError("This recording could not be saved. Try a shorter answer."); }
        finally { running.current=null; pending.current=false; setState("idle"); resolve(); }
      };
    } catch { stream?.getTracks().forEach(t=>t.stop()); if (ticket === generation.current) {pending.current=false; setState("idle"); setError(teacher ? "Microphone unavailable. Check Windows microphone access or upload an audio file." : "Microphone unavailable. Ask the invigilator to check Windows microphone access.");} }
  };
  const discard = (id: string) => { delete answers.current[id]; refresh(n => n+1); };
  return {answers,revision,state,error,start,finish,questionId,discard};
}

export function SpeakingControl({ id, mic }: { id: string; mic: ReturnType<typeof useSpokenAnswers> }) {
  return <div className="space-y-2"><p>Spoken answer for your teacher (up to 60 seconds). Saved on this PC and attached if you turn in to Classroom or Microsoft 365.</p>
    {mic.state === "idle" ? <Button variant="secondary" onClick={() => void mic.start(id)}><Mic size={16}/>{mic.answers.current[id] ? "Record again" : "Record answer"}</Button> :
    <Button variant="danger" onClick={() => void mic.finish()}><Square size={16}/>{mic.state === "asking" ? "Cancel microphone request" : "Stop recording"}</Button>}
    {mic.answers.current[id] && mic.state === "idle" && <audio className="max-w-full" controls src={mic.answers.current[id]} aria-label="Review spoken answer" />}
    {mic.error && <p role="alert">{mic.error}</p>}</div>;
}
