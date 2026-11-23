"use client";
import { useCallback, useEffect, useState } from "react";
import { adm } from "@/lib/adminApi";

const blank = { id: 0, section: "", subtype: "general", difficulty: "medium", text: "", passage: "", options: ["", "", "", ""], correct: 0, active: true, has_image: false };

export default function QuestionsTab() {
  const [list, setList] = useState<any>({ total: 0, items: [] });
  const [stats, setStats] = useState<any[]>([]);
  const [section, setSection] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [edit, setEdit] = useState<any>(null);
  const [msg, setMsg] = useState("");

  const sections: string[] = Array.from(new Set(stats.map((x) => x.section)));
  const label = (s: string) => stats.find((x) => x.section === s)?.label || s;

  const load = useCallback(async () => {
    const p = new URLSearchParams({ page: String(page), limit: "50" });
    if (section) p.set("section", section);
    if (q) p.set("q", q);
    setList(await adm("/questions?" + p));
    setStats(await adm("/questions/stats"));
  }, [section, q, page]);
  useEffect(() => { load().catch((e) => setMsg(e.message)); }, [load]);

  async function upload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return;
    const fd = new FormData(); fd.append("file", file);
    try {
      const r = await adm("/questions/import", { method: "POST", body: fd });
      setMsg(`Imported ${r.added} questions.${r.errors.length ? " Issues: " + r.errors.slice(0, 5).join("; ") : ""}`);
      load();
    } catch (e: any) { setMsg(e.message); }
    e.target.value = "";
  }
  async function save() {
    try {
      const body = { ...edit, passage: edit.passage || null };
      if (edit.id) await adm(`/questions/${edit.id}`, { method: "PUT", body }); else await adm("/questions", { method: "POST", body });
      setEdit(null); load();
    } catch (e: any) { setMsg(e.message); }
  }
  async function remove(id: number) { if (confirm("Deactivate this question? Papers already issued keep it.")) { await adm(`/questions/${id}`, { method: "DELETE" }); load(); } }
  async function uploadImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return;
    if (file.size > 250000) { setMsg("Image is over 250 KB. Compress or resize it first."); return; }
    const fd = new FormData(); fd.append("file", file);
    try { await adm(`/questions/${edit.id}/image`, { method: "POST", body: fd }); setEdit({ ...edit, has_image: true }); setMsg("Diagram attached."); load(); }
    catch (e: any) { setMsg(e.message); }
    e.target.value = "";
  }
  async function removeImage() {
    try { await adm(`/questions/${edit.id}/image`, { method: "DELETE" }); setEdit({ ...edit, has_image: false }); load(); } catch (e: any) { setMsg(e.message); }
  }

  const secTotal = (s: string) => stats.filter((x) => x.section === s).reduce((a, b) => a + b.count, 0);
  return (
    <div>
      <p className="mb-3 text-sm opacity-80">Sections come from the "section" column of your import. They appear to candidates in the order they first appear in the file.</p>
      <div className="grid md:grid-cols-3 lg:grid-cols-5 gap-4 mb-5">
        {sections.map((s, i) => (
          <div key={s} className="glass p-4">
            <div className="text-sm opacity-60">Section {i + 1}</div>
            <div className="text-navy leading-snug">{label(s)}</div>
            <div className="text-3xl tabular-nums">{secTotal(s)}<span className="text-base opacity-60"> active</span></div>
            <div className="text-xs opacity-70">{stats.filter((x) => x.section === s).length} sub-types</div>
          </div>
        ))}
        {!sections.length && <div className="glass p-4 md:col-span-3">No active questions yet. Import your file below.</div>}
      </div>
      <div className="flex flex-wrap gap-3 mb-4 items-center">
        <select className="field !w-auto max-w-xs" value={section} onChange={(e) => { setSection(e.target.value); setPage(1); }}>
          <option value="">All sections</option>{sections.map((s) => <option key={s} value={s}>{label(s)}</option>)}
        </select>
        <input className="field !w-64" placeholder="Search question text" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        <label className="btn-ghost cursor-pointer !py-2">Import CSV or Excel<input type="file" accept=".csv,.xlsx" hidden onChange={upload} /></label>
        <a className="underline text-navy" href="/questions_template.csv" download>Download template</a>
        <button className="btn-primary !py-2 ml-auto" onClick={() => setEdit({ ...blank })}>Add question</button>
      </div>
      {msg && <p role="status" className="mb-3">{msg}</p>}
      <div className="glass overflow-x-auto">
        <table className="w-full text-[0.95rem]"><thead><tr className="text-left border-b border-rule"><th className="p-3">Question</th><th>Section</th><th>Sub-type</th><th>Level</th><th>Answer</th><th /></tr></thead><tbody>
          {list.items.map((r: any) => (
            <tr key={r.id} className={`border-b border-rule/60 ${r.active ? "" : "opacity-40"}`}>
              <td className="p-3 max-w-md truncate" title={r.text}>{r.text}</td><td className="max-w-[12rem] truncate" title={r.section}>{label(r.section)}</td><td>{r.subtype}</td><td>{r.difficulty}</td><td>{"ABCD"[r.correct]}</td>
              <td className="whitespace-nowrap pr-3"><button className="underline text-navy mr-3" onClick={() => setEdit({ ...r, passage: r.passage || "" })}>Edit</button>{r.active && <button className="underline text-crimson" onClick={() => remove(r.id)}>Deactivate</button>}</td>
            </tr>))}
          {!list.items.length && <tr><td colSpan={6} className="p-8 text-center opacity-70">No questions yet. Import the template CSV to start the bank.</td></tr>}
        </tbody></table>
      </div>
      <div className="flex justify-between mt-4 text-sm"><span>{list.total} questions</span>
        <span className="flex gap-2"><button className="btn-ghost !py-1" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button><button className="btn-ghost !py-1" disabled={page * 50 >= list.total} onClick={() => setPage(page + 1)}>Next</button></span></div>

      {edit && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-[#1c2430]/40 p-6" onClick={() => setEdit(null)}>
          <div className="glass w-full max-w-2xl p-7 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Edit question">
            <h2 className="text-2xl text-navy mb-4">{edit.id ? "Edit question" : "Add question"}</h2>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <input className="field" list="sections" placeholder="Section name" value={edit.section} onChange={(e) => setEdit({ ...edit, section: e.target.value })} />
              <datalist id="sections">{sections.map((s) => <option key={s} value={s} />)}</datalist>
              <input className="field" placeholder="Sub-type (e.g. series)" value={edit.subtype} onChange={(e) => setEdit({ ...edit, subtype: e.target.value })} />
              <select className="field" aria-label="Difficulty" value={edit.difficulty || "medium"} onChange={(e) => setEdit({ ...edit, difficulty: e.target.value })}><option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option></select>
            </div>
            <textarea className="field mb-3" rows={2} placeholder="Passage (optional, for comprehension)" value={edit.passage} onChange={(e) => setEdit({ ...edit, passage: e.target.value })} />
            <textarea className="field mb-3" rows={3} placeholder="Question" value={edit.text} onChange={(e) => setEdit({ ...edit, text: e.target.value })} />
            {edit.options.map((o: string, i: number) => (
              <div key={i} className="flex items-center gap-3 mb-2">
                <input type="radio" name="correct" aria-label={`Option ${"ABCD"[i]} is correct`} checked={edit.correct === i} onChange={() => setEdit({ ...edit, correct: i })} className="accent-[#1B365D]" />
                <input className="field" placeholder={`Option ${"ABCD"[i]}`} value={o} onChange={(e) => { const op = [...edit.options]; op[i] = e.target.value; setEdit({ ...edit, options: op }); }} />
              </div>))}
            <p className="text-sm opacity-70 mb-3">Select the radio button beside the correct option.</p>
            <div className="mb-4 rounded-lg border border-dashed border-rule p-3">
              <div className="text-navy mb-1">Diagram or picture (optional)</div>
              {edit.id ? (
                <div className="flex flex-wrap items-center gap-3 text-sm">
                  {edit.has_image && <span className="text-navy">Diagram attached</span>}
                  <label className="btn-ghost cursor-pointer !py-1">{edit.has_image ? "Replace" : "Upload image"}<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={uploadImage} /></label>
                  {edit.has_image && <button className="underline text-crimson" onClick={removeImage}>Remove</button>}
                  <span className="opacity-70">PNG, JPEG, WebP or GIF, under 250 KB (aim for 150 KB).</span>
                </div>
              ) : <p className="text-sm opacity-70">Save the question first, then edit it to attach a diagram.</p>}
            </div>
            <div className="flex justify-end gap-3"><button className="btn-ghost" onClick={() => setEdit(null)}>Cancel</button><button className="btn-primary" onClick={save}>Save question</button></div>
          </div>
        </div>)}
    </div>
  );
}
