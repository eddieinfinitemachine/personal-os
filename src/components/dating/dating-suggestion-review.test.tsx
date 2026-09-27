// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { DatingHome } from "./dating-home";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("./people-board", () => ({ PeopleBoard: () => null }));
vi.mock("./dictate-card", () => ({ DictateCard: () => null }));
vi.mock("./sync-help", () => ({ SyncHelp: () => null }));
vi.mock("./link-picker", () => ({ LinkPicker: ({onPick}: {onPick: (p: {id:string;name:string}) => void}) =>
  <button onClick={() => onPick({id:"chosen",name:"Margaux"})}>Choose matching person</button> }));

afterEach(() => vi.unstubAllGlobals());

it("reviews only the selected same-name note, shows years, and restores it if linking fails", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let respond!: (value: unknown) => void;
  const fetch = vi.fn(() => new Promise((resolve) => { respond = resolve; }));
  vi.stubGlobal("fetch",fetch);
  const container=document.createElement("div");
  document.body.append(container);
  const root=createRoot(container);
  const suggestions=[
    {id:"old",name:"Margo",summary:"Earlier relationship",title:"Therapy",url:null,occurredAt:"2025-03-22T12:00:00Z"},
    {id:"new",name:"Margo",summary:"Later relationship",title:"Therapy",url:null,occurredAt:"2026-01-15T12:00:00Z"},
  ];
  try {
    await act(async () => root.render(<DatingHome people={[{
      id:"chosen", name:"Margaux", lessons:null, stage:"ended", handles:[], instagram:null,
      metVia:null, metAt:null, endedAt:null, age:null, city:null, work:null, remember:[],
      greenFlags:[], redFlags:[], notes:null, insights:null, insightsAt:null, lastMessageAt:null,
      createdAt:"2026-01-01T00:00:00Z", dateCount:0, avgVibe:null, avatarUrl:null,
      firstEventAt:null, lastEventAt:null, lastDate:null,
    }]} suggestions={suggestions} />));
    expect(container.textContent).toContain("Review from Granola");
    expect(container.textContent).toContain("2025");
    expect(container.textContent).toContain("2026");
    const click = async (text: string) => act(async () => {
      const button=[...container.querySelectorAll("button")].find((b)=>b.textContent?.includes(text));
      expect(button).toBeDefined();
      button!.click();
    });
    await click("Add to…");
    await click("Choose matching person");
    expect(fetch).toHaveBeenCalledWith("/api/dating/suggestions/old/link",expect.objectContaining({body:JSON.stringify({personId:"chosen"})}));
    expect(container.textContent).not.toContain("Earlier relationship");
    expect(container.textContent).toContain("Later relationship");
    await act(async()=>respond({ok:false,json:async()=>({error:"Try again"})}));
    expect(container.textContent).toContain("Earlier relationship");
    expect(container.textContent).toContain("Later relationship");
  } finally {
    await act(async()=>root.unmount());
    container.remove();
  }
});
