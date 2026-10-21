using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Linq;
using Dark.Population;

internal static class Program
{
    static int passed,failed;
    static void Run(string name,Action body) { try { body(); passed++; Console.WriteLine("PASS "+name); } catch(Exception ex) { failed++; Console.WriteLine("FAIL "+name+": "+ex); } }
    static void Check(bool value,string why="assertion") { if(!value) throw new Exception(why); }
    static void Eq<T>(T a,T b) { if(!Equals(a,b)) throw new Exception($"expected {b}, observed {a}"); }
    static void Throws<T>(Action action) where T:Exception { try { action(); } catch(T) { return; } throw new Exception("expected "+typeof(T).Name); }
    static PopulationShard[] Small() => new[]{new PopulationShard("AAA","A","R1",101),new PopulationShard("BBB","B","R2",203),new PopulationShard("CCC","C","R2",509)};
    static string Repo() { string path=Directory.GetCurrentDirectory(); while(!File.Exists(Path.Combine(path,"HOMELESS_DARK_STANDALONE_CONSTITUTION.md"))) path=Directory.GetParent(path)?.FullName??throw new Exception("repo not found"); return path; }
    static PopulationShard[] Source() => File.ReadAllLines(Path.Combine(Repo(),"data/geography/global/population-shards.tsv")).Skip(1).Where(l=>l.Length>0).Select(l=>{var f=l.Split('\t');return new PopulationShard(f[0],f[1],f[2],ulong.Parse(f[3],CultureInfo.InvariantCulture));}).ToArray();
    static void Conserve(PopulationLedger ledger)
    {
        Eq(ledger.Shards.Aggregate(0UL,(n,s)=>checked(n+ledger.Counts(s.Code).Residents)),ledger.Total);
        Eq(ledger.Shards.Aggregate(0UL,(n,s)=>checked(n+ledger.Counts(s.Code).Present)),ledger.Total);
        Eq(ledger.RegionTotals().Values.Aggregate(0UL,(a,b)=>checked(a+b)),ledger.Total);
        foreach(var shard in ledger.Shards) { var c=ledger.Counts(shard.Code); Eq(c.Residents-c.AbsentResidents+c.Visitors,c.Present); }
    }
    static int Main()
    {
        Run("Actual World Bank 2024 estimates, explicitly unassigned residual and allocation",()=>{
            var source=Source(); var p=new PopulationLedger(source);
            Eq(source.Length,218); Eq(p.Total,8140897523UL); Eq(source.Single(s=>s.Code=="USA").Count,340003797UL);
            Eq(source.Single(s=>s.Code=="IND").Count,1450935791UL); Eq(source.Single(s=>s.Code=="TUV").Count,9646UL);
            Eq(source.Single(s=>s.Code=="WLD_UNASSIGNED").Count,23412899UL);
            Eq(p.StoredIndividuals,0);Eq(p.ActiveIndividuals,0);Eq(p.VirtualIndividuals,p.Total); Conserve(p);
        });
        Run("Hierarchy exact conservation and deterministic 64 cohort quotient/remainders",()=>{
            var p=new PopulationLedger(Source());
            foreach(var s in p.Shards) { ulong sum=0,min=ulong.MaxValue,max=0;for(int i=0;i<64;i++){var n=p.CohortMembers(s.Code,i);sum+=n;min=Math.Min(min,n);max=Math.Max(max,n);}Eq(sum,s.Count);Check(max-min<=1); }
            Eq(new PopulationLedger(Small()).CohortMembers("AAA",0),2UL);Eq(new PopulationLedger(Small()).CohortMembers("AAA",63),1UL);
            Eq(p.AllocationHash,new PopulationLedger(Source().Reverse()).AllocationHash);
        });
        Run("Stable identity range boundaries, canonicalization and policy seed",()=>{
            var p=new PopulationLedger(Small());Eq(p.Identity("AAA",0),"wb2024/AAA/0");Eq(p.Identity("AAA",100),"wb2024/AAA/100");
            var first=p.Resolve("wb2024/AAA/0");Eq(first.PolicySeed,new PopulationLedger(Small()).Resolve(first.Id).PolicySeed);
            Throws<ArgumentOutOfRangeException>(()=>p.Identity("AAA",101));Throws<ArgumentException>(()=>p.Resolve("wb2024/AAA/00"));
            Throws<ArgumentException>(()=>p.Resolve("wrong/AAA/0"));Throws<ArgumentException>(()=>p.Resolve("wb2024/AAA/-1"));
            Eq(p.StoredIndividuals,0);
        });
        Run("Promotion, demotion and re-promotion retain facts, commitments, seed and identity",()=>{
            var p=new PopulationLedger(Small(),maxActive:1,maxStored:2);string id=p.Identity("AAA",7);
            var a=p.Promote(id,PopulationFidelity.Focused); p.Remember(id,"met:player:tick17");p.CommitTo(id,"ride:station:tick200");
            p.Demote(id);Eq(p.ActiveIndividuals,0);Eq(p.StoredIndividuals,1);var b=p.Promote(id);
            Eq(a.PolicySeed,b.PolicySeed);Eq(b.Facts.Single(),"met:player:tick17");Eq(b.Commitments.Single(),"ride:station:tick200");
            Eq(p.VirtualIndividuals,812UL);Check(p.CompleteCommitment(id,"ride:station:tick200"));Check(!p.CompleteCommitment(id,"ride:station:tick200"));
        });
        Run("Active/stored budgets refuse without partial mutation or erasing continuity",()=>{
            var p=new PopulationLedger(Small(),maxActive:1,maxStored:1);p.Promote(p.Identity("AAA",0));var before=p.Save();
            Throws<InvalidOperationException>(()=>p.Promote(p.Identity("AAA",1)));Eq(p.Save(),before);
            p.Demote(p.Identity("AAA",0));before=p.Save();Throws<InvalidOperationException>(()=>p.Remember(p.Identity("AAA",1),"fact"));Eq(p.Save(),before);
            p.Demote(p.Identity("BBB",0));Eq(p.StoredIndividuals,1);
        });
        Run("Visitor travel conserves present and resident counts with no double counting",()=>{
            var p=new PopulationLedger(Small());string id=p.Identity("AAA",5);p.Move(id,"BBB","trip1",0);
            Eq(p.Counts("AAA").Residents,101UL);Eq(p.Counts("AAA").Present,100UL);Eq(p.Counts("AAA").AbsentResidents,1UL);
            Eq(p.Counts("BBB").Residents,203UL);Eq(p.Counts("BBB").Present,204UL);Eq(p.Counts("BBB").Visitors,1UL);Conserve(p);
            p.Move(id,"CCC","trip2",1);Eq(p.Counts("BBB").Visitors,0UL);Eq(p.Counts("CCC").Visitors,1UL);Conserve(p);
        });
        Run("Migration changes residence while preserving original stable identity",()=>{
            var p=new PopulationLedger(Small());string id=p.Identity("AAA",5);p.Move(id,"BBB","migrate",0,true);
            Eq(p.Counts("AAA").Residents,100UL);Eq(p.Counts("BBB").Residents,204UL);Eq(p.Resolve(id).Residence,"BBB");Eq(p.Resolve(id).Id,id);
            Eq(p.Counts("BBB").Visitors,0UL);Conserve(p);
        });
        Run("Duplicate movement returns original witness; conflicts/stale updates do not mutate",()=>{
            var p=new PopulationLedger(Small());string id=p.Identity("AAA",0);var first=p.Move(id,"BBB","request",0);
            Eq(p.Move(id,"BBB","request",0),first);Eq(p.Revision,1UL);string before=p.Save();
            Throws<InvalidOperationException>(()=>p.Move(id,"CCC","request",0));Throws<InvalidOperationException>(()=>p.Move(id,"CCC","another",0));Eq(p.Save(),before);
            Throws<ArgumentException>(()=>p.Move(id,"MISSING","other",1));Eq(p.Save(),before);
        });
        Run("Snapshot resumes memories, movement, pending commitments and request idempotency",()=>{
            var p=new PopulationLedger(Small());string id=p.Identity("BBB",100);p.Promote(id,PopulationFidelity.Focused);p.Remember(id,"knows café ☕");p.CommitTo(id,"return-home");
            p.Move(id,"CCC","visit",0);p.Move(id,"AAA","settle",1,true);p.Demote(id);
            string save=p.Save();var q=PopulationLedger.Restore(Small(),save);Eq(q.Save(),save);Eq(q.Resolve(id).Facts.Single(),"knows café ☕");Eq(q.Resolve(id).Commitments.Single(),"return-home");
            q.Move(id,"AAA","settle",0,true);Eq(q.Revision,2UL);Conserve(q);
        });
        Run("Corrupt/truncated/source-mismatched snapshots are refused",()=>{
            var p=new PopulationLedger(Small());p.Remember(p.Identity("AAA",1),"persistent fact");string save=p.Save();
            Throws<ArgumentException>(()=>PopulationLedger.Restore(Small(),save.Substring(0,save.Length-2)));
            Throws<ArgumentException>(()=>PopulationLedger.Restore(Small(),save.Replace("S\twb2024/AAA/1","S\twb2024/AAA/2")));
            Throws<ArgumentException>(()=>PopulationLedger.Restore(new[]{new PopulationShard("AAA","A","R1",100)},save));
            Eq(PopulationLedger.Restore(Small(),save).Save(),save);
        });
        Run("Memory and movement history are bounded with explicit refusal",()=>{
            var p=new PopulationLedger(Small(),maxMovements:1);string id=p.Identity("AAA",0);
            for(int i=0;i<64;i++)p.Remember(id,"fact"+i);string before=p.Save();Throws<InvalidOperationException>(()=>p.Remember(id,"overflow"));Eq(p.Save(),before);
            p.Remember(id,"fact0");Eq(p.Resolve(id).Facts.Count,64);Throws<ArgumentException>(()=>p.Remember(id,new string('x',513)));
            p.Move(id,"BBB","once",0);before=p.Save();Throws<InvalidOperationException>(()=>p.Move(id,"CCC","twice",1));Eq(p.Save(),before);
        });
        Run("1500 deterministic migrations/trips agree with all-individual reference seed 25026",()=>{
            var p=new PopulationLedger(Small(),maxActive:32,maxStored:813);var source=Small();
            var ids=source.SelectMany(s=>Enumerable.Range(0,(int)s.Count).Select(i=>p.Identity(s.Code,(ulong)i))).ToArray();
            var home=ids.ToDictionary(id=>id,id=>p.Resolve(id).Origin);var loc=new Dictionary<string,string>(home);var rng=new Random(25026);
            for(int i=0;i<1500;i++) { string id=ids[rng.Next(ids.Length)],dest=source[rng.Next(source.Length)].Code;bool migration=rng.Next(3)==0;
                p.Move(id,dest,"event"+i,p.Revision,migration);loc[id]=dest;if(migration)home[id]=dest;
                if(i%25==0) {foreach(var s in source){Eq(p.Counts(s.Code).Residents,(ulong)home.Values.Count(v=>v==s.Code));Eq(p.Counts(s.Code).Present,(ulong)loc.Values.Count(v=>v==s.Code));}Conserve(p);}
            }
            Eq(PopulationLedger.Restore(Small(),p.Save(),maxActive:32,maxStored:813).Save(),p.Save());
        });
        Run("Range allocation 217 economies plus residual resolves 100000 unique identities without realization",()=>{
            var p=new PopulationLedger(Source());var ids=new HashSet<string>();var watch=Stopwatch.StartNew();
            for(ulong i=0;i<100000;i++){string id=p.Identity("IND",i);Check(ids.Add(id));Check(p.Resolve(id).PolicySeed.Length==64);}
            Eq(p.StoredIndividuals,0);Eq(p.ActiveIndividuals,0);Eq(p.VirtualIndividuals,8140897523UL);watch.Stop();Console.WriteLine("MEASURE 100000 lazy lookups elapsed_ms="+watch.ElapsedMilliseconds+"; host ARM64 .NET8, not native crowd performance");
        });
        Run("Invalid shards, overflow and unsupported capacities are rejected",()=>{
            Throws<ArgumentException>(()=>new PopulationLedger(Array.Empty<PopulationShard>()));Throws<ArgumentException>(()=>new PopulationLedger(new[]{Small()[0],Small()[0]}));
            Throws<OverflowException>(()=>new PopulationLedger(new[]{new PopulationShard("A","A","R",ulong.MaxValue),new PopulationShard("B","B","R",1)}));
            Throws<ArgumentException>(()=>new PopulationLedger(Small(),maxActive:2,maxStored:1));Throws<ArgumentException>(()=>new PopulationShard("bad/id","N","R",1));
        });
        Console.WriteLine($"Population allocation: {passed} passed; {failed} failed");return failed==0?0:1;
    }
}
