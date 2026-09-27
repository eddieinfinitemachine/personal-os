import { describe, expect, it } from "vitest";
import { guardGranolaIdentities, relationshipWindow, type IdentityPerson } from "./dating-identity";
import { parseProposal } from "./dating";

const a: IdentityPerson = { id: "older", name: "Margot Langman", stage: "ended", metAt: "2025-01-10", endedAt: "2025-04-30", firstEventAt: "2025-01-20", lastEventAt: "2025-03-22" };
const b: IdentityPerson = { id: "later", name: "Margaux Forciene", stage: "ended", metAt: "2025-07-01", endedAt: "2026-02-28", firstEventAt: "2025-07-15", lastEventAt: "2026-02-15" };
const noteDay = "2026-01-15";
const raw = (id: string | null, matchDate: string | null = noteDay, name = "Margo") => ({ people: [{ personId: id, name, matchDate, note: "We talked about her." }] });
const guard = (id: string | null, people = [a,b], date: string | null = noteDay, text = "I saw Margo last night.") => guardGranolaIdentities(raw(id,date),people,text,noteDay) as ReturnType<typeof raw>;

describe("Granola identity guard", () => {
  it("rejects a wrong owned ID rather than filing onto the earlier Margot", () => {
    expect(guard("older").people[0].personId).toBeNull();
    expect(guard("later").people[0].personId).toBe("later");
  });
  it("keeps overlapping or unknown relationship windows unresolved", () => {
    expect(guard("later",[{...a,endedAt:"2026-03-01"},b]).people[0].personId).toBeNull();
    expect(guard("later",[{...a,metAt:null,endedAt:null},b]).people[0].personId).toBeNull();
    expect(guard("later",[a,{...b,metAt:null,firstEventAt:null,lastEventAt:null}]).people[0].personId).toBeNull();
  });
  it("uses an explicitly dated recollection rather than the meeting date", () => {
    const resolved=guard("older",[a,b],"2025-03-22","Remembering my date with Margo on 2025-03-22.");
    expect(resolved.people[0].personId).toBe("older");
    expect(guard("later",[a,b],null,"Thinking back about Margo.").people[0].personId).toBeNull();
    expect(guard("older",[a,b],"2025-03-22","Thinking back about Margo.").people[0].personId).toBeNull();
  });
  it("trusts a unique full name only when it appears in the original source", () => {
    expect(guard("older",[a,b],null,"I miss Margot Langman.").people[0].personId).toBe("older");
    const guessed=guardGranolaIdentities(raw("older",null,"Margot Langman"),[a,b],"I miss Margo.",noteDay) as ReturnType<typeof raw>;
    expect(guessed.people[0].personId).toBeNull();
    expect(guard("older",[a,{...b,name:a.name}],null,"I miss Margot Langman.").people[0].personId).toBeNull();
  });
  it("does not let temporal proximity override a different source-explicit full name", () => {
    expect(guard("later",[a,b],noteDay,"I talked about Margot Langman.").people[0].personId).toBeNull();
  });
  it("supports a clearly written historical date and rejects invented/invalid ones", () => {
    expect(guard("older",[a,b],"2025-03-22","Margo on March 22, 2025.").people[0].personId).toBe("older");
    expect(guard("later",[a,b],"2026-02-30","Margo on 2026-02-30.").people[0].personId).toBeNull();
  });
  it("rejects the meeting date when the source explicitly describes a different period", () => {
    expect(guard("later",[a,b],noteDay,"Remembering Margo on 2025-03-22.").people[0].personId).toBeNull();
    expect(guard("later",[a,b],noteDay,"Remembering Margo on March 22, 2025.").people[0].personId).toBeNull();
    expect(guard("later",[a,b],noteDay,"Thinking back to Margo last year.").people[0].personId).toBeNull();
  });
  it.each([
    "In March 2025 I was dating Margo.",
    "Margo and I dated in 2025.",
    "I dated Margo last summer.",
    "That winter with Margo was difficult.",
    "Margo was my girlfriend the previous spring.",
  ])("keeps imprecise historical periods unresolved: %s", (source) => {
    expect(guard("later",[a,b],noteDay,source).people[0].personId).toBeNull();
  });
  it("does not let competing full names or mixed dates authorize a guess", () => {
    expect(guard("older",[a,b],noteDay,"Margot Langman was my old girlfriend. Margaux Forciene is the later one. I saw Margo last night.").people[0].personId).toBeNull();
    expect(guard("older",[a,b],"2025-03-22","Margo on 2025-03-22 and Margo on 2026-01-15.").people[0].personId).toBeNull();
  });
  it("keeps explicit model abstention and ignores unrelated names", () => {
    expect(guard(null).people[0].personId).toBeNull();
    expect(guard("older",[a,{...b,name:"Beatrice"}],null).people[0].personId).toBe("older");
  });
  it("includes explicit start and end boundaries", () => {
    expect(guard("later",[a,b],"2025-07-01","Margo on 2025-07-01").people[0].personId).toBe("later");
    expect(guard("later",[a,b],"2026-02-28","Margo on 2026-02-28").people[0].personId).toBe("later");
  });
  it("does not treat an old last event as proof a relationship had ended", () => {
    expect(guard("later",[{...a,endedAt:null},b]).people[0].personId).toBeNull();
  });
});

describe("relationship context", () => {
  it("uses the earliest known start, explicit end, and labels observed bounds", () => {
    expect(relationshipWindow({...a,firstEventAt:"2024-12-31"})).toContain("2024-12-31");
    expect(relationshipWindow(a)).toContain("2025-04-30");
    expect(relationshipWindow({...a,endedAt:null})).toContain("last observed 2025-03-22");
    expect(relationshipWindow({id:"x",name:"X"})).toContain("unknown");
  });
});

it("preserves null/unknown IDs as suggestions before name fallback, but keeps forced context", () => {
  const people=[{...a,remember:[],greenFlags:[],redFlags:[]}];
  const proposal={people:[{personId:null,name:a.name,note:"Ambiguous."}]};
  expect(parseProposal(proposal,{people,noteDay,preserveUnmatched:true}).people[0].personId).toBeNull();
  expect(parseProposal(proposal,{people,noteDay,preserveUnmatched:true,personId:a.id}).people[0].personId).toBe(a.id);
});
