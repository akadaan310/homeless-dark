using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using Dark.Core;
using Dark.History;
using Dark.Population;
using Dark.Protocols;

static class Program
{
    static int failures, passed;
    static readonly byte[] FounderKey = Enumerable.Repeat((byte)17, 32).ToArray();
    static readonly byte[] MemberKey = Enumerable.Repeat((byte)29, 32).ToArray();
    const string PolicyText = "constitution dark 1 { clause HD_073 subject sign when authenticated may set_sign requires scoped_write preserves same_revision budget 256 witness sign_change verifies sign_test ; }";
    static void Main()
    {
        Test("bounded compiler accepts registered atomic predicates and emits obligations", () => {
            var p = AdmissionPolicy.Compile(PolicyText);
            Equal(1, p.Obligations.Count); Equal("sign_test", p.Obligations[0]);
            Equal(p.Digest, AdmissionPolicy.Compile(PolicyText.Replace(" ", "\n")).Digest);
        });
        Test("compiler refuses unsupported predicates, duplicates, and oversized policies", () => {
            Throws<PolicyException>(() => AdmissionPolicy.Compile(PolicyText.Replace("authenticated", "eval")));
            Throws<PolicyException>(() => AdmissionPolicy.Compile(PolicyText.Replace("256", "9999999999999999999999")));
            Throws<PolicyException>(() => AdmissionPolicy.Compile(PolicyText.Replace(" }", PolicyText.Substring(PolicyText.IndexOf("clause")))));
            Throws<PolicyException>(() => AdmissionPolicy.Compile(new string('x', 70000)));
        });
        Test("founder name and PURL do not authenticate an actor", () => {
            var a = Authority();
            Equal<ActorSession?>(null, a.Authenticate("Obex Den",FounderKey,10));
            Equal<ActorSession?>(null, a.Authenticate("founder-001",MemberKey,10));
            var s = a.Authenticate("member-001",MemberKey,10)!;
            Equal("member", s.Role);
            Throws<ArgumentException>(() => a.RegisterMember("founder-001", MemberKey, "sign/cafe"));
            Equal("founder_dark", a.Authenticate("founder-001",FounderKey,10)!.Role);
        });
        Test("authority rejects expired revoked and foreign process sessions", () => {
            var a = Authority(out var clock); var s = a.Authenticate("member-001",MemberKey,10)!;
            clock.AdvanceTo(9); Assert(a.IsValid(s)); clock.AdvanceTo(10); Assert(!a.IsValid(s));
            Assert(!Authority().IsValid(s)); a.Revoke(s); Assert(!a.IsValid(s));
            Throws<ArgumentOutOfRangeException>(() => a.Authenticate("member-001",MemberKey,10));
        });
        Test("world writes check scope revision and UTF8 budget and leave refusals unchanged", () => {
            var a = Authority(out var clock); var w = new SignWorld(a, AdmissionPolicy.Compile(PolicyText));
            var s = a.Authenticate("member-001",MemberKey,100)!; clock.AdvanceTo(1);
            Equal("scope_denied", w.SetSign(s, "q1", 0, 1, "sign/elsewhere", "welcome").Code);
            Equal("budget_exceeded", w.SetSign(s, "q2", 0, 1, "sign/cafe", new string('é', 129)).Code);
            Equal(0L, w.Revision); Equal(0, w.Events.Count);
            Assert(w.SetSign(s, "q3", 0, 1, "sign/cafe", "Welcome").Admitted);
            clock.AdvanceTo(2);
            Equal("stale_revision", w.SetSign(s, "q4", 0, 2, "sign/cafe", "Changed").Code);
            Equal("Welcome", w.Signs["sign/cafe"]); Equal(1L, w.Revision);
        });
        Test("duplicate request is exactly once and altered duplicate is refused", () => {
            var a = Authority(out var clock); var w = new SignWorld(a, AdmissionPolicy.Compile(PolicyText));
            var s = a.Authenticate("member-001",MemberKey,100)!; clock.AdvanceTo(2);
            var first = w.SetSign(s, "same", 0, 2, "sign/cafe", "A");
            clock.AdvanceTo(3);
            Equal(first.EventHash, w.SetSign(s, "same", 0, 2, "sign/cafe", "A").EventHash);
            Equal("idempotency_conflict", w.SetSign(s, "same", 0, 2, "sign/cafe", "B").Code);
            Equal(1, w.Events.Count);
            clock.AdvanceTo(100); Equal("unauthenticated", w.SetSign(s, "same", 0, 2, "sign/cafe", "A").Code);
            a.Revoke(s); Equal("unauthenticated", w.SetSign(s, "same", 0, 2, "sign/cafe", "A").Code);
        });
        Test("canonical framing distinguishes delimiters and rejects unpaired Unicode", () => {
            Assert(Canonical.Hash("a|b", "c") != Canonical.Hash("a", "b|c"));
            Throws<ArgumentException>(() => Canonical.Hash("\ud800"));
            Equal(Canonical.Hash("hello"), Canonical.Hash("hello"));
        });
        Test("history validates replay and catches tamper truncation and order against trusted head", () => {
            var a = Authority(out var clock); var p = AdmissionPolicy.Compile(PolicyText); var w = new SignWorld(a,p);
            var s = a.Authenticate("member-001",MemberKey,100)!;
            clock.AdvanceTo(1); Assert(w.SetSign(s,"a",0,1,"sign/cafe","first").Admitted);
            clock.AdvanceTo(2); Assert(w.SetSign(s,"b",1,2,"sign/cafe","second").Admitted);
            var records = w.Events.Select(e=>e.Encode()).ToArray();
            var replay = EventJournal.Verify(records,w.Head,p.Digest);
            Equal("second", replay.Signs["sign/cafe"]);
            Throws<JournalException>(()=>EventJournal.Verify(records.Take(1),w.Head,p.Digest));
            Throws<JournalException>(()=>EventJournal.Verify(records.Reverse(),w.Head,p.Digest));
            var changed=(string[])records.Clone(); changed[0]=changed[0].Replace(Convert.ToBase64String(Encoding.UTF8.GetBytes("first")),Convert.ToBase64String(Encoding.UTF8.GetBytes("other")));
            Throws<JournalException>(()=>EventJournal.Verify(changed,w.Head,p.Digest));
        });
        Test("durable journal restores world and duplicate identity after reload", () => {
            string path=Path.Combine(Path.GetTempPath(),Guid.NewGuid()+".darklog");
            try {
                var a=Authority(out var clock); var p=AdmissionPolicy.Compile(PolicyText); var w=new SignWorld(a,p,new FileEventSink(path));
                var s=a.Authenticate("member-001",MemberKey,100)!; clock.AdvanceTo(1);
                w.SetSign(s,"saved",0,1,"sign/cafe","Remember"); string head=w.Head;
                var restored=SignWorld.Restore(a,p,File.ReadAllLines(path),head,new FileEventSink(path));
                Equal("Remember",restored.Signs["sign/cafe"]);
                clock.AdvanceTo(2);
                Assert(restored.SetSign(s,"saved",0,1,"sign/cafe","Remember").Admitted);
                Equal(1,File.ReadAllLines(path).Length);
            } finally {if(File.Exists(path))File.Delete(path);}
        });
        Test("durability failure cannot commit in memory",()=> {
            var a=Authority(out var clock); var w=new SignWorld(a,AdmissionPolicy.Compile(PolicyText),new FailingSink());
            var s=a.Authenticate("member-001",MemberKey,100)!; clock.AdvanceTo(1);
            Equal("storage_failed",w.SetSign(s,"a",0,1,"sign/cafe","A").Code);
            Equal(0L,w.Revision); Equal(0,w.Events.Count); Equal(0,w.Signs.Count);
        });
        Test("NPC refusal and knowledge require causal local observations",()=> {
            var npc=new Inhabitant("npc-1",new Personality(0.2,0.8),"work");
            Equal("continue_task",npc.DecideRide("player",1).Action);
            npc.Observe(new Observation("greet-1","player","greeting",2,"cafe"),"cafe");
            Equal(1,npc.Memories.Count);
            npc.Observe(new Observation("greet-1","player","greeting",2,"cafe"),"cafe");
            Equal(1,npc.Memories.Count);
            Assert(!npc.Observe(new Observation("remote-1","other","greeting",3,"airport"),"cafe"));
            Equal("decline_ride",npc.DecideRide("player",3).Action);
            var friendly=new Inhabitant("npc-2",new Personality(0.9,0.1),"leisure");
            friendly.Observe(new Observation("greet-2","player","greeting",2,"cafe"),"cafe");
            Equal("offer_ride",friendly.DecideRide("player",3).Action);
            var restored=Inhabitant.Restore(npc.Snapshot()); Equal("decline_ride",restored.DecideRide("player",4).Action);
        });
        Test("PURL resource parsing is canonical pure discovery with no implied authority",()=> {
            var u=ResourceAddress.Parse("purl://dark/entity/earth/npc-1?version=2");
            Equal("npc-1",u.EntityId); Equal(2L,u.Version); Equal("purl://dark/entity/earth/npc-1?version=2",u.ToString());
            Throws<FormatException>(()=>ResourceAddress.Parse("purl://dark/entity/earth/../npc?version=1"));
            Throws<FormatException>(()=>ResourceAddress.Parse("purl://dark/entity/earth/%2F?version=1"));
            Throws<FormatException>(()=>ResourceAddress.Parse("purl://dark/entity/earth/npc?version=1&write=true"));
        });
        Test("R1 session issued at tick 100 refuses a proposed pre-issue effect",()=> {
            var a=Authority(out var clock,100);var session=a.Authenticate("member-001",MemberKey,110)!;
            Equal(100L,session.IssuedAt);
            var w=new SignWorld(a,AdmissionPolicy.Compile(PolicyText));
            Assert(!w.SetSign(session,"preissue",0,0,"sign/cafe","early").Admitted);
            Equal(0L,w.Revision);
        });
        Test("R1 expiry cannot be bypassed with a backdated request",()=> {
            var a=Authority(out var clock,100);var session=a.Authenticate("member-001",MemberKey,110)!;
            Equal(100L,session.IssuedAt);
            var w=new SignWorld(a,AdmissionPolicy.Compile(PolicyText));
            Assert(w.SetSign(session,"before-expiry",0,100,"sign/cafe","first").Admitted);
            clock.AdvanceTo(110); Assert(!a.IsValid(session));
            Throws<ArgumentOutOfRangeException>(()=>clock.AdvanceTo(101));
            Assert(!w.SetSign(session,"backdated-expired",1,101,"sign/cafe","late").Admitted);
            Equal(1L,w.Revision);Equal("first",w.Signs["sign/cafe"]);
        });
        Test("R1 idle world rejects a session after authoritative expiry",()=> {
            var a=Authority(out var clock,100);var session=a.Authenticate("member-001",MemberKey,110)!;
            Equal(100L,session.IssuedAt);
            var w=new SignWorld(a,AdmissionPolicy.Compile(PolicyText));
            clock.AdvanceTo(110); Assert(!a.IsValid(session));
            Throws<ArgumentOutOfRangeException>(()=>clock.AdvanceTo(101));
            Assert(!w.SetSign(session,"idle-expired",0,100,"sign/cafe","late").Admitted);
            Equal(0L,w.Revision);
        });
        Test("R1 a future proposed event tick cannot advance authentication time",()=> {
            var a=Authority();var session=a.Authenticate("member-001",MemberKey,100)!;
            var w=new SignWorld(a,AdmissionPolicy.Compile(PolicyText));
            Assert(!w.SetSign(session,"future",0,99,"sign/cafe","future").Admitted);
            Equal(0L,w.Revision);
        });
        Test("R1 clock rejects rewind and sessions record actual issue time",()=> {
            Throws<ArgumentOutOfRangeException>(()=>new SimulationClock(-1));
            var a=Authority(out var clock,100);var s=a.Authenticate("member-001",MemberKey,110)!;
            Equal(100L,s.IssuedAt);clock.AdvanceTo(109);clock.AdvanceTo(109);Assert(a.IsValid(s));
            Throws<ArgumentOutOfRangeException>(()=>clock.AdvanceTo(99));Equal(109L,clock.Tick);
            clock.AdvanceTo(110);Assert(!a.IsValid(s));
            Throws<ArgumentOutOfRangeException>(()=>a.Authenticate("member-001",MemberKey,110));
        });
        Test("R1 retry uses current authentication and can resume with a renewed session",()=> {
            var a=Authority(out var clock,100);var oldSession=a.Authenticate("member-001",MemberKey,110)!;
            var w=new SignWorld(a,AdmissionPolicy.Compile(PolicyText));
            var first=w.SetSign(oldSession,"original",0,100,"sign/cafe","first");Assert(first.Admitted);
            clock.AdvanceTo(110);Equal("unauthenticated",w.SetSign(oldSession,"original",0,100,"sign/cafe","first").Code);
            var renewed=a.Authenticate("member-001",MemberKey,200)!;Equal(110L,renewed.IssuedAt);
            var retry=w.SetSign(renewed,"original",0,100,"sign/cafe","first");Assert(retry.Admitted);Equal(first.EventHash,retry.EventHash);Equal(1L,w.Revision);
            Equal("noncurrent_tick",w.SetSign(renewed,"new-backdated",1,100,"sign/cafe","second").Code);
            Assert(w.SetSign(renewed,"new-current",1,110,"sign/cafe","second").Admitted);Equal(2L,w.Revision);
        });
        Test("R2 invalid UTF8 sink bytes become JournalException without mutation",()=> {
            string path=Path.Combine(Path.GetTempPath(),Guid.NewGuid()+".darklog");var original=new byte[]{0xff,0x0a};
            try {
                File.WriteAllBytes(path,original);var p=AdmissionPolicy.Compile(PolicyText);
                var item=new JournalEvent(1,1,"corrupt",0,"member-001","sign/cafe","value",p.Digest,"HD_073",JournalEvent.Genesis);
                Throws<JournalException>(()=>new FileEventSink(path).Append(item));
                Assert(original.SequenceEqual(File.ReadAllBytes(path)));
            } finally {if(File.Exists(path))File.Delete(path);}
        });
        Test("R2 malformed journal is typed storage refusal with existing memory and bytes intact",()=> {
            string path=Path.Combine(Path.GetTempPath(),Guid.NewGuid()+".darklog");
            try {
                var a=Authority(out var clock);var p=AdmissionPolicy.Compile(PolicyText);var w=new SignWorld(a,p,new FileEventSink(path));
                var session=a.Authenticate("member-001",MemberKey,100)!; clock.AdvanceTo(1);
                Assert(w.SetSign(session,"first",0,1,"sign/cafe","first").Admitted);string oldHead=w.Head;
                byte[] corrupt=File.ReadAllBytes(path).Concat(new byte[]{0xff,0x0a}).ToArray();File.WriteAllBytes(path,corrupt);
                clock.AdvanceTo(2);
                Equal("storage_failed",w.SetSign(session,"corrupt",1,2,"sign/cafe","second").Code);
                Equal(1L,w.Revision);Equal(1,w.Events.Count);Equal("first",w.Signs["sign/cafe"]);Equal(oldHead,w.Head);
                Assert(corrupt.SequenceEqual(File.ReadAllBytes(path)));
            } finally {if(File.Exists(path))File.Delete(path);}
        });
        Console.WriteLine($"CORE: {passed} passed, {failures} failed"); Environment.ExitCode=failures==0?0:1;
    }
    sealed class FailingSink:IEventSink { public void Append(JournalEvent e)=>throw new IOException("disk full"); }
    static LocalAuthority Authority()=>Authority(out _);
    static LocalAuthority Authority(out SimulationClock clock,long initialTick=0){clock=new SimulationClock(initialTick);var a=new LocalAuthority(clock,"founder-001",FounderKey);a.RegisterMember("member-001",MemberKey,"sign/cafe");return a;}
    static void Test(string name,Action f){try{f();passed++;Console.WriteLine("PASS "+name);}catch(Exception e){failures++;Console.WriteLine("FAIL "+name+": "+e);}}
    static void Assert(bool value){if(!value)throw new Exception("Assertion failed");}
    static void Equal<T>(T expected,T actual){if(!EqualityComparer<T>.Default.Equals(expected,actual))throw new Exception($"Expected {expected}, actual {actual}");}
    static void Throws<T>(Action f) where T:Exception{try{f();}catch(T){return;}throw new Exception("Expected "+typeof(T).Name);}
}
