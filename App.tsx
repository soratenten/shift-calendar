import { useState, useCallback, useEffect } from "react";

const STORAGE_KEY = "shiftCalendarData_v1";

// ── Utils ──────────────────────────────────────────────
function timeToMin(t) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}
function fmtDur(m) {
  if (m <= 0) return "0h";
  const h = Math.floor(m / 60), min = m % 60;
  return min === 0 ? `${h}h` : `${h}h${String(min).padStart(2, "0")}m`;
}
function parseDuration(str) {
  const hm = str.match(/^(\d+)h(\d+)$/);
  if (hm) return parseInt(hm[1]) * 60 + parseInt(hm[2]);
  const ho = str.match(/^(\d+(?:\.\d+)?)h$/);
  if (ho) return Math.round(parseFloat(ho[1]) * 60);
  const n = parseFloat(str);
  if (!isNaN(n)) return Math.round(n * 60);
  return 0;
}
function dayMinutes(dayData) {
  if (!dayData || dayData.isOff || !dayData.shifts.length) return 0;
  return dayData.shifts.reduce((s, sh) => s + sh.minutes, 0);
}
function keyToDate(key) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d, 12);
}
function calcStreak(shiftData, targetKey, overrideIsWork) {
  const isWork = (key) => {
    if (key === targetKey) return overrideIsWork !== null ? overrideIsWork : !isOff(shiftData, key);
    return !isOff(shiftData, key);
  };
  const isOff2 = (key) => !isWork(key);
  if (!isWork(targetKey)) return 0;
  const target = keyToDate(targetKey);
  let streak = 1;
  for (let i = 1; i <= 31; i++) {
    const d = new Date(target); d.setDate(d.getDate() - i);
    const k = dateToKey(d);
    if (shiftData[k] === undefined) break;
    if (isOff2(k)) break;
    streak++;
  }
  for (let i = 1; i <= 31; i++) {
    const d = new Date(target); d.setDate(d.getDate() + i);
    const k = dateToKey(d);
    if (shiftData[k] === undefined) break;
    if (isOff2(k)) break;
    streak++;
  }
  return streak;
}
function isOff(shiftData, key) {
  const d = shiftData[key];
  return !d || d.isOff || d.shifts.length === 0;
}
function dateToKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
}
function keyToLabel(key) {
  if (!key) return "";
  const [y, m, d] = key.split("-").map(Number);
  const dow = ["日","月","火","水","木","金","土"][new Date(y, m-1, d).getDay()];
  return `${m}/${d}(${dow})`;
}

// ── ICS Export ─────────────────────────────────────────
function pad2(n) { return String(n).padStart(2, "0"); }
function toICSDate(key, time) {
  const [y, mo, d] = key.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  return `${y}${pad2(mo)}${pad2(d)}T${pad2(h)}${pad2(mi)}00`;
}
function escICS(s) { return s.replace(/\\/g,"\\\\").replace(/;/g,"\\;").replace(/,/g,"\\,").replace(/\n/g,"\\n"); }
function generateICS(shiftData, year, month) {
  const prefix = `${year}-${String(month).padStart(2,"0")}`;
  const entries = Object.entries(shiftData)
    .filter(([k]) => k.startsWith(prefix))
    .sort(([a],[b]) => a.localeCompare(b));

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//ShiftCalendar//JA",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:シフト",
    "X-WR-TIMEZONE:Asia/Tokyo",
  ];

  let uid = 1;
  for (const [key, day] of entries) {
    if (day.isOff || !day.shifts.length) continue;
    for (const sh of day.shifts) {
      const breakMin = sh.breaks.reduce((s,b)=>s+(timeToMin(b.end)-timeToMin(b.start)),0);
      const noteParts = [...sh.notes];
      if (breakMin > 0) noteParts.push(`休憩 ${fmtDur(breakMin)}`);
      const summary = noteParts.length > 0 ? noteParts[0] : "勤務";
      const desc = `${fmtDur(sh.minutes)}${breakMin>0?" (休憩"+fmtDur(breakMin)+")":""}${sh.notes.length>1?"\n"+sh.notes.slice(1).join("\n"):""}`;
      lines.push(
        "BEGIN:VEVENT",
        `UID:shift-${key}-${uid++}@shiftcal`,
        `DTSTART;TZID=Asia/Tokyo:${toICSDate(key, sh.start)}`,
        `DTEND;TZID=Asia/Tokyo:${toICSDate(key, sh.end)}`,
        `SUMMARY:${escICS(summary)}`,
        `DESCRIPTION:${escICS(desc)}`,
        "END:VEVENT",
      );
    }
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}
function downloadICS(shiftData, year, month) {
  const content = generateICS(shiftData, year, month);
  const filename = `shift_${year}${pad2(month)}.ics`;
  const dataUri = "data:text/calendar;charset=utf-8," + encodeURIComponent(content);
  const a = document.createElement("a");
  a.href = dataUri;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

// ── Parse ──────────────────────────────────────────────
function parseShift(text) {
  const lines = text.split("\n");
  const result = {};
  let cur = null;
  const dateRe = /^(\d{1,2})\/(\d{1,2})\s*\(([A-Za-z]+)\)/;
  const timeRe = /^(\s+)(\d{1,2}:\d{2})-(\d{1,2}:\d{2})\s*\(([^)]+)\)/;
  const breakRe = /^\s+\[休\d*\]\s+(\d{1,2}:\d{2})-(\d{1,2}:\d{2})/;
  const offRe = /^\s+----/;
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;
    const dm = line.match(dateRe);
    if (dm) {
      const month = parseInt(dm[1]), day = parseInt(dm[2]), dow = dm[3];
      const year = new Date().getFullYear();
      const key = `${year}-${String(month).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
      cur = key;
      result[key] = { month, day, dow, shifts: [], isOff: false };
      continue;
    }
    if (!cur) continue;
    if (offRe.test(line)) { result[cur].isOff = true; continue; }
    const bm = line.match(breakRe);
    if (bm) {
      const s = result[cur].shifts;
      if (s.length) s[s.length-1].breaks.push({ start: bm[1], end: bm[2] });
      continue;
    }
    const tm = line.match(timeRe);
    if (tm) {
      const minutes = parseDuration(tm[4].trim());
      result[cur].shifts.push({ start: tm[2], end: tm[3], minutes, breaks: [], notes: [] });
      continue;
    }
    if (/^\s+\S/.test(line)) {
      const s = result[cur].shifts;
      if (s.length) s[s.length-1].notes.push(line.trim());
    }
  }
  return result;
}

// ── Constants ──────────────────────────────────────────
const DOW_JP = { Mo:"月", Tu:"火", We:"水", Th:"木", Fr:"金", Sa:"土", Su:"日" };

// ── Calendar Components ────────────────────────────────
function TimelineBar({ shift }) {
  const startMin = timeToMin(shift.start);
  const span = timeToMin(shift.end) - startMin;
  return (
    <div style={{ height:6, background:"#E2E8F0", borderRadius:4, position:"relative", overflow:"hidden", margin:"4px 0" }}>
      <div style={{ position:"absolute", inset:0, background:"linear-gradient(90deg,#4A90D9,#6DB8F0)", borderRadius:4 }} />
      {shift.breaks.map((b, i) => {
        const left = ((timeToMin(b.start)-startMin)/span*100).toFixed(1);
        const width = ((timeToMin(b.end)-timeToMin(b.start))/span*100).toFixed(1);
        return <div key={i} style={{ position:"absolute", top:0, bottom:0, left:`${left}%`, width:`${width}%`, background:"rgba(255,255,255,0.75)" }} />;
      })}
    </div>
  );
}
function BreakBadge({ breaks }) {
  if (!breaks || !breaks.length) return null;
  const total = breaks.reduce((s,b)=>s+(timeToMin(b.end)-timeToMin(b.start)),0);
  const full = total >= 60;
  return (
    <span style={{ fontSize:11, fontWeight:700, padding:"1px 8px", borderRadius:20, marginLeft:6,
      background: full?"#FFF3CD":"#F4F6F9", color: full?"#92600A":"#7A8BA8",
      border: full?"1px solid #F0C040":"1px solid #E2E8F0" }}>
      休{fmtDur(total)}
    </span>
  );
}
function ShiftBlock({ shift }) {
  return (
    <div style={{ display:"flex", gap:10, padding:"6px 0", borderTop:"1px dashed #E2E8F0" }}>
      <div style={{ fontSize:13, fontWeight:700, color:"#1B2A4A", whiteSpace:"nowrap", minWidth:110 }}>
        {shift.start} – {shift.end}
      </div>
      <div style={{ flex:1 }}>
        <div style={{ display:"flex", alignItems:"center", flexWrap:"wrap", gap:2 }}>
          <span style={{ fontSize:11, color:"#4A90D9", fontWeight:700, background:"#EBF4FF", borderRadius:20, padding:"1px 8px" }}>
            {fmtDur(shift.minutes)}
          </span>
          <BreakBadge breaks={shift.breaks} />
        </div>
        <TimelineBar shift={shift} />
        {shift.breaks.map((b,i) => (
          <div key={i} style={{ fontSize:11, color:"#7A8BA8", display:"flex", alignItems:"center", gap:4, marginTop:2 }}>
            <div style={{ width:6,height:6,borderRadius:"50%",background:"#CBD5E0" }} />
            休憩 {b.start}–{b.end}
          </div>
        ))}
        {shift.notes.length > 0 && <div style={{ fontSize:12, color:"#7A8BA8", marginTop:3 }}>{shift.notes.join(" · ")}</div>}
      </div>
    </div>
  );
}
function DayCard({ data }) {
  const { day, dow, shifts, isOff } = data;
  const isSat = ["Sa","Sat"].includes(dow);
  const isSun = ["Su","Sun"].includes(dow);
  const dayOff = isOff || shifts.length === 0;
  const totalMin = shifts.reduce((s,sh)=>s+sh.minutes,0);
  const totalBreakMin = shifts.reduce((s,sh)=>s+sh.breaks.reduce((bs,b)=>bs+(timeToMin(b.end)-timeToMin(b.start)),0),0);
  const hasFullBreak = totalBreakMin >= 60;
  const accentColor = dayOff ? "#CBD5E0" : "#4A90D9";
  const headerBg = isSun?"#FFF0EE":isSat?"#EBF4FF":"#FAFBFC";
  const dayColor = isSun?"#E85D4A":isSat?"#4A90D9":"#1A1A2E";
  return (
    <div style={{ background:"white", borderRadius:12, boxShadow:"0 2px 12px rgba(27,42,74,0.08)", overflow:"hidden", borderLeft:`4px solid ${accentColor}` }}>
      <div style={{ display:"flex", alignItems:"center", padding:"10px 14px", background:headerBg, borderBottom:"1px solid #E2E8F0", gap:10 }}>
        <div>
          <div style={{ fontSize:22, fontWeight:700, lineHeight:1, color:dayColor }}>{day}</div>
          <div style={{ fontSize:11, fontWeight:500, color:"#7A8BA8" }}>{DOW_JP[dow]||dow}曜日</div>
        </div>
        <div style={{ marginLeft:"auto", display:"flex", alignItems:"center", gap:6 }}>
          {!dayOff && <span style={{ fontSize:13, fontWeight:700, color:"#1B2A4A", background:"#EBF4FF", padding:"3px 10px", borderRadius:20 }}>{fmtDur(totalMin)}</span>}
          {!dayOff && totalBreakMin > 0 && (
            <span style={{ fontSize:12, fontWeight:700, padding:"3px 10px", borderRadius:20,
              background:hasFullBreak?"#FFF3CD":"#F4F6F9", color:hasFullBreak?"#92600A":"#7A8BA8",
              border:hasFullBreak?"1px solid #F0C040":"1px solid #E2E8F0" }}>
              休{fmtDur(totalBreakMin)}
            </span>
          )}
          {dayOff && <span style={{ fontSize:13, fontWeight:700, color:"#7A8BA8", background:"#F4F6F9", padding:"3px 10px", borderRadius:20 }}>休日</span>}
        </div>
      </div>
      <div style={{ padding:"8px 14px" }}>
        {dayOff
          ? <div style={{ fontSize:13, color:"#7A8BA8", padding:"4px 0" }}>🌿 お休み</div>
          : shifts.map((sh,i) => <ShiftBlock key={i} shift={sh} />)
        }
      </div>
    </div>
  );
}

// ── Shift Change Page ──────────────────────────────────
function ShiftChangePage({ shiftData, calYear, calMonth, onBack }) {
  const myKeys = Object.keys(shiftData)
    .filter(k => k.startsWith(`${calYear}-${String(calMonth).padStart(2,"0")}`))
    .sort();

  const [myKey, setMyKey] = useState("");
  const [otherKey, setOtherKey] = useState("");
  const [otherIsOff, setOtherIsOff] = useState(false);
  const [otherStart, setOtherStart] = useState("");
  const [otherEnd, setOtherEnd] = useState("");

  const result = (() => {
    if (!myKey || !otherKey) return null;
    const myOrigMin = dayMinutes(shiftData[myKey]);
    const myOrigIsOff = isOff(shiftData, myKey);
    const otherMin = (() => {
      if (otherIsOff) return 0;
      if (!otherStart || !otherEnd) return null;
      const diff = timeToMin(otherEnd) - timeToMin(otherStart);
      return diff > 0 ? diff : null;
    })();
    if (otherMin === null) return null;
    const prefix = `${calYear}-${String(calMonth).padStart(2,"0")}`;
    const monthKeys = Object.keys(shiftData).filter(k => k.startsWith(prefix));
    const beforeTotal = monthKeys.reduce((s, k) => s + dayMinutes(shiftData[k]), 0);
    const afterTotal = beforeTotal - myOrigMin + otherMin;
    const streakBefore = calcStreak(shiftData, myKey, null);
    const streakAfter = calcStreak(shiftData, myKey, otherMin > 0);
    return {
      myKey, otherKey,
      myLabel: keyToLabel(myKey),
      otherLabel: keyToLabel(otherKey),
      myOrigIsOff,
      myOrigMin,
      myOrigShiftStr: myOrigIsOff ? "休日" : (() => {
        const d = shiftData[myKey];
        if (!d || !d.shifts.length) return "休日";
        return d.shifts.map(s=>`${s.start}–${s.end}`).join(" / ");
      })(),
      otherMin, otherIsOff,
      otherShiftStr: otherIsOff ? "休日" : `${otherStart}–${otherEnd}`,
      beforeTotal, afterTotal, streakBefore, streakAfter,
    };
  })();

  const inp = { border:"2px solid #E2E8F0", borderRadius:8, padding:"8px 12px", fontSize:13, outline:"none", background:"white", color:"#1A1A2E", fontFamily:"inherit", width:"100%" };
  const sectionStyle = { background:"white", borderRadius:12, padding:20, boxShadow:"0 2px 12px rgba(27,42,74,0.08)", marginBottom:16 };
  const labelStyle = { fontSize:12, fontWeight:700, color:"#7A8BA8", marginBottom:6, display:"block" };

  return (
    <div style={{ fontFamily:"system-ui,sans-serif", background:"#F4F6F9", minHeight:"100vh" }}>
      <div style={{ background:"#1B2A4A", color:"white", padding:"14px 20px", display:"flex", alignItems:"center", gap:12, boxShadow:"0 2px 16px rgba(0,0,0,0.2)", position:"sticky", top:0, zIndex:100 }}>
        <button onClick={onBack} style={{ background:"rgba(255,255,255,0.15)", border:"none", color:"white", width:32, height:32, borderRadius:"50%", cursor:"pointer", fontSize:18, display:"flex", alignItems:"center", justifyContent:"center" }}>←</button>
        <div style={{ fontSize:18, fontWeight:700 }}>シフトチェンジ申請</div>
      </div>

      <div style={{ padding:16, maxWidth:600, margin:"0 auto" }}>
        <div style={sectionStyle}>
          <div style={{ fontSize:14, fontWeight:700, color:"#1B2A4A", marginBottom:14, display:"flex", alignItems:"center", gap:8 }}>
            <span style={{ background:"#EBF4FF", color:"#4A90D9", borderRadius:20, padding:"2px 10px", fontSize:12 }}>自分</span>
            交換するシフト
          </div>
          <label style={labelStyle}>日付を選択</label>
          <select value={myKey} onChange={e=>setMyKey(e.target.value)} style={{ ...inp, cursor:"pointer" }}>
            <option value="">-- 日付を選んでください --</option>
            {myKeys.map(k => {
              const d = shiftData[k];
              const off = isOff(shiftData, k);
              const detail = off ? "休日" : d.shifts.map(s=>`${s.start}–${s.end}`).join(" / ");
              return <option key={k} value={k}>{keyToLabel(k)}　{detail}</option>;
            })}
          </select>
          {myKey && (
            <div style={{ marginTop:10, padding:"10px 14px", background:"#F4F6F9", borderRadius:8, fontSize:13 }}>
              <span style={{ color:"#7A8BA8" }}>現在のシフト：</span>
              <strong style={{ color:"#1B2A4A" }}>
                {isOff(shiftData, myKey) ? "休日" : shiftData[myKey].shifts.map(s=>`${s.start}–${s.end} (${fmtDur(s.minutes)})`).join(" / ")}
              </strong>
            </div>
          )}
        </div>

        <div style={sectionStyle}>
          <div style={{ fontSize:14, fontWeight:700, color:"#1B2A4A", marginBottom:14, display:"flex", alignItems:"center", gap:8 }}>
            <span style={{ background:"#FFF0EE", color:"#E85D4A", borderRadius:20, padding:"2px 10px", fontSize:12 }}>相手</span>
            交換してもらうシフト
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:12 }}>
            <div>
              <label style={labelStyle}>日付（例: 6/4）</label>
              <input type="text" placeholder="6/4" value={otherKey}
                onChange={e => {
                  const v = e.target.value.trim();
                  const m2 = v.match(/^(\d{1,2})\/(\d{1,2})$/);
                  if (m2) {
                    setOtherKey(`${calYear}-${String(parseInt(m2[1])).padStart(2,"0")}-${String(parseInt(m2[2])).padStart(2,"0")}`);
                  } else setOtherKey(v);
                }}
                style={inp} />
            </div>
            <div style={{ display:"flex", flexDirection:"column", justifyContent:"flex-end" }}>
              <label style={{ ...labelStyle, display:"flex", alignItems:"center", gap:8, cursor:"pointer" }}>
                <input type="checkbox" checked={otherIsOff} onChange={e=>setOtherIsOff(e.target.checked)} style={{ width:16, height:16 }} />
                休日と交換
              </label>
            </div>
          </div>
          {!otherIsOff && (
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
              <div><label style={labelStyle}>開始時間</label><input type="time" value={otherStart} onChange={e=>setOtherStart(e.target.value)} style={inp} /></div>
              <div><label style={labelStyle}>終了時間</label><input type="time" value={otherEnd} onChange={e=>setOtherEnd(e.target.value)} style={inp} /></div>
            </div>
          )}
        </div>

        {result ? (
          <div style={{ background:"white", borderRadius:12, boxShadow:"0 2px 12px rgba(27,42,74,0.08)", overflow:"hidden" }}>
            <div style={{ background:"#1B2A4A", color:"white", padding:"12px 20px", fontSize:14, fontWeight:700 }}>書類記入内容</div>
            <div style={{ padding:20, display:"flex", flexDirection:"column" }}>
              {[
                { label:"自分のシフト（交換するシフト）", before:`${result.myLabel}　${result.myOrigShiftStr}`, after:`${result.otherLabel}　${result.otherShiftStr}`, icon:"👤" },
                { label:"相手のシフト（受け取るシフト）", before:`${result.otherLabel}　${result.otherShiftStr}`, after:`${result.myLabel}　${result.myOrigShiftStr}`, icon:"👥" },
              ].map((row, i) => (
                <div key={i} style={{ padding:"14px 0", borderBottom:"1px solid #F0F4F8" }}>
                  <div style={{ fontSize:11, fontWeight:700, color:"#7A8BA8", marginBottom:8 }}>{row.icon} {row.label}</div>
                  <div style={{ display:"flex", alignItems:"center", gap:10, flexWrap:"wrap" }}>
                    <span style={{ fontSize:14, fontWeight:700, color:"#1B2A4A", background:"#F4F6F9", padding:"4px 12px", borderRadius:8 }}>{row.before}</span>
                    <span style={{ color:"#7A8BA8", fontSize:18 }}>→</span>
                    <span style={{ fontSize:14, fontWeight:700, color:"white", background:"#4A90D9", padding:"4px 12px", borderRadius:8 }}>{row.after}</span>
                  </div>
                </div>
              ))}
              <div style={{ padding:"14px 0", borderBottom:"1px solid #F0F4F8" }}>
                <div style={{ fontSize:11, fontWeight:700, color:"#7A8BA8", marginBottom:8 }}>連勤数（自分）</div>
                <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                  <span style={{ fontSize:15, fontWeight:700, color:"#1B2A4A", background:"#F4F6F9", padding:"4px 14px", borderRadius:8 }}>
                    {result.streakBefore === 0 ? "休日" : `${result.streakBefore}連勤`}
                  </span>
                  <span style={{ color:"#7A8BA8", fontSize:18 }}>→</span>
                  <span style={{ fontSize:15, fontWeight:700, padding:"4px 14px", borderRadius:8,
                    background: result.streakAfter >= 5?"#FFF0EE":result.streakAfter===0?"#F4F6F9":"#EBF4FF",
                    color: result.streakAfter >= 5?"#E85D4A":result.streakAfter===0?"#7A8BA8":"#1B2A4A" }}>
                    {result.streakAfter === 0 ? "休日" : `${result.streakAfter}連勤`}
                  </span>
                  {result.streakAfter >= 5 && <span style={{ fontSize:12, color:"#E85D4A" }}>⚠️ 注意</span>}
                </div>
              </div>
              <div style={{ padding:"14px 0" }}>
                <div style={{ fontSize:11, fontWeight:700, color:"#7A8BA8", marginBottom:8 }}>月合計勤務時間</div>
                <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                  <span style={{ fontSize:15, fontWeight:700, color:"#1B2A4A", background:"#F4F6F9", padding:"4px 14px", borderRadius:8 }}>{fmtDur(result.beforeTotal)}</span>
                  <span style={{ color:"#7A8BA8", fontSize:18 }}>→</span>
                  <span style={{ fontSize:15, fontWeight:700, color:"white", padding:"4px 14px", borderRadius:8,
                    background: result.afterTotal>result.beforeTotal?"#3DAA6B":result.afterTotal<result.beforeTotal?"#E85D4A":"#7A8BA8" }}>
                    {fmtDur(result.afterTotal)}
                  </span>
                  <span style={{ fontSize:13, color:"#7A8BA8" }}>({result.afterTotal>=result.beforeTotal?"+":""}{fmtDur(result.afterTotal-result.beforeTotal)})</span>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div style={{ textAlign:"center", padding:"32px 20px", color:"#7A8BA8", background:"white", borderRadius:12, boxShadow:"0 2px 12px rgba(27,42,74,0.08)" }}>
            <div style={{ fontSize:36, marginBottom:10 }}>↔</div>
            <p style={{ fontSize:13, lineHeight:1.7 }}>自分の日付と相手のシフト情報を<br/>入力すると書類記入内容が表示されます</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main App ───────────────────────────────────────────
export default function App() {
  const [page, setPage] = useState("calendar");
  const [input, setInput] = useState("");
  const [shiftData, setShiftData] = useState(() => {
    try { const s = localStorage.getItem(STORAGE_KEY); return s ? JSON.parse(s) : {}; } catch { return {}; }
  });
  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [toast, setToast] = useState("");

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(shiftData)); } catch {}
  }, [shiftData]);

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(""), 2400); };

  const handleImport = useCallback(() => {
    if (!input.trim()) { showToast("シフトを貼り付けてください"); return; }
    const parsed = parseShift(input);
    const count = Object.keys(parsed).length;
    if (count === 0) { showToast("シフトが読み取れませんでした"); return; }
    setShiftData(prev => ({ ...prev, ...parsed }));
    const firstKey = Object.keys(parsed).sort()[0];
    if (firstKey) { setYear(parseInt(firstKey.split("-")[0])); setMonth(parseInt(firstKey.split("-")[1])); }
    showToast(`${count}日分を読み込みました ✓`);
  }, [input]);

  const handleClear = () => {
    const prefix = `${year}-${String(month).padStart(2,"0")}`;
    setShiftData(prev => { const n={...prev}; Object.keys(n).forEach(k=>{if(k.startsWith(prefix))delete n[k];}); return n; });
    setInput("");
    showToast("クリアしました");
  };

  const handleExportICS = () => {
    const prefix = `${year}-${String(month).padStart(2,"0")}`;
    const hasData = Object.keys(shiftData).some(k => k.startsWith(prefix) && !isOff(shiftData, k));
    if (!hasData) { showToast("この月の勤務データがありません"); return; }
    downloadICS(shiftData, year, month);
    showToast("カレンダーファイルをダウンロードしました");
  };

  const prevMonth = () => { if(month===1){setMonth(12);setYear(y=>y-1);}else setMonth(m=>m-1); };
  const nextMonth = () => { if(month===12){setMonth(1);setYear(y=>y+1);}else setMonth(m=>m+1); };

  const prefix = `${year}-${String(month).padStart(2,"0")}`;
  const days = Object.entries(shiftData).filter(([k])=>k.startsWith(prefix)).sort(([a],[b])=>a.localeCompare(b));
  const workDays = days.filter(([,d])=>!d.isOff&&d.shifts.length>0);
  const totalMin = workDays.reduce((s,[,d])=>s+d.shifts.reduce((ss,sh)=>ss+sh.minutes,0),0);
  const totalBreakMin = workDays.reduce((s,[,d])=>s+d.shifts.reduce((ss,sh)=>ss+sh.breaks.reduce((bs,b)=>bs+(timeToMin(b.end)-timeToMin(b.start)),0),0),0);

  if (page === "swap") {
    return <ShiftChangePage shiftData={shiftData} calYear={year} calMonth={month} onBack={() => setPage("calendar")} />;
  }

  // icon svgs as inline
  const IconSwap = () => (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 6h11M9 3l3 3-3 3M15 10H4M6 7l-3 3 3 3"/>
    </svg>
  );
  const IconCalExport = () => (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1" y="3" width="14" height="12" rx="2"/>
      <path d="M5 1v4M11 1v4M1 7h14M8 10v4M6 12l2 2 2-2"/>
    </svg>
  );

  return (
    <div style={{ fontFamily:"system-ui,sans-serif", background:"#F4F6F9", minHeight:"100vh" }}>
      {/* Header */}
      <div style={{ background:"#1B2A4A", color:"white", padding:"14px 20px", display:"flex", alignItems:"center", justifyContent:"space-between", boxShadow:"0 2px 16px rgba(0,0,0,0.2)", position:"sticky", top:0, zIndex:100 }}>
        <div style={{ fontSize:18, fontWeight:700, letterSpacing:"0.04em" }}>シフトカレンダー</div>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <button onClick={prevMonth} style={{ background:"rgba(255,255,255,0.15)", border:"none", color:"white", width:30, height:30, borderRadius:"50%", cursor:"pointer", fontSize:16, display:"flex", alignItems:"center", justifyContent:"center" }}>‹</button>
          <span style={{ fontSize:14, fontWeight:500, minWidth:76, textAlign:"center" }}>{year}年{month}月</span>
          <button onClick={nextMonth} style={{ background:"rgba(255,255,255,0.15)", border:"none", color:"white", width:30, height:30, borderRadius:"50%", cursor:"pointer", fontSize:16, display:"flex", alignItems:"center", justifyContent:"center" }}>›</button>
        </div>
      </div>

      {/* Stats + actions bar */}
      <div style={{ background:"#2C3E62", color:"white", padding:"0 20px", display:"flex", alignItems:"stretch", minHeight:42, fontSize:13 }}>
        {/* stats */}
        <div style={{ display:"flex", alignItems:"center", gap:16, flex:1, paddingTop:10, paddingBottom:10, flexWrap:"wrap" }}>
          <span><strong>{workDays.length}</strong>日出勤</span>
          <span style={{ display:"flex", alignItems:"center", gap:5 }}>
            勤務 <strong style={{ fontSize:15, color:"#7EC8E3" }}>{fmtDur(totalMin)}</strong>
          </span>
          {totalBreakMin > 0 && (
            <span style={{ display:"flex", alignItems:"center", gap:5 }}>
              休憩 <strong style={{ fontSize:15, color:"#F0C040" }}>{fmtDur(totalBreakMin)}</strong>
            </span>
          )}
        </div>
        {/* action buttons — pill group */}
        <div style={{ display:"flex", alignItems:"center", gap:1, paddingLeft:16 }}>
          <button onClick={()=>setPage("swap")} style={{
            display:"flex", alignItems:"center", gap:6,
            background:"rgba(255,255,255,0.1)", border:"none", borderRight:"1px solid rgba(255,255,255,0.12)",
            color:"white", padding:"0 14px", height:"100%", cursor:"pointer", fontSize:12, fontWeight:600,
            borderRadius:"6px 0 0 6px", whiteSpace:"nowrap",
          }}>
            <IconSwap /> シフトチェンジ
          </button>
          <button onClick={handleExportICS} style={{
            display:"flex", alignItems:"center", gap:6,
            background:"rgba(255,255,255,0.1)", border:"none",
            color:"white", padding:"0 14px", height:"100%", cursor:"pointer", fontSize:12, fontWeight:600,
            borderRadius:"0 6px 6px 0", whiteSpace:"nowrap",
          }}>
            <IconCalExport /> カレンダー書き出し
          </button>
        </div>
      </div>

      {/* Main */}
      <div style={{ padding:16, maxWidth:640, margin:"0 auto" }}>
        <div style={{ background:"white", borderRadius:12, boxShadow:"0 2px 12px rgba(27,42,74,0.08)", padding:20, marginBottom:20 }}>
          <div style={{ fontSize:14, fontWeight:700, color:"#1B2A4A", marginBottom:10 }}>シフトを貼り付け</div>
          <textarea value={input} onChange={e=>setInput(e.target.value)}
            placeholder="シフト文字列をここに貼り付けてください…"
            style={{ width:"100%", height:110, border:"2px solid #E2E8F0", borderRadius:8, padding:12, fontFamily:"monospace", fontSize:12, resize:"vertical", outline:"none", background:"#FAFBFC", color:"#1A1A2E" }} />
          <div style={{ display:"flex", gap:10, marginTop:10 }}>
            <button onClick={handleImport} style={{ flex:1, background:"#1B2A4A", color:"white", border:"none", padding:"10px 0", borderRadius:8, fontSize:13, fontWeight:700, cursor:"pointer" }}>読み込む</button>
            <button onClick={handleClear} style={{ background:"transparent", color:"#7A8BA8", border:"2px solid #E2E8F0", padding:"10px 14px", borderRadius:8, fontSize:13, cursor:"pointer" }}>クリア</button>
          </div>
        </div>
        <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
          {days.length === 0
            ? <div style={{ textAlign:"center", padding:"48px 20px", color:"#7A8BA8" }}>
                <div style={{ fontSize:48, marginBottom:12 }}>📅</div>
                <p style={{ fontSize:14, lineHeight:1.7 }}>シフト文字列を貼り付けて<br/>「読み込む」を押してください。</p>
              </div>
            : days.map(([key, data]) => <DayCard key={key} data={data} />)
          }
        </div>
      </div>

      {toast && (
        <div style={{ position:"fixed", bottom:24, left:"50%", transform:"translateX(-50%)", background:"#1B2A4A", color:"white", padding:"10px 20px", borderRadius:24, fontSize:13, fontWeight:500, zIndex:200, boxShadow:"0 4px 16px rgba(0,0,0,0.2)" }}>
          {toast}
        </div>
      )}
    </div>
  );
}
