using System;
using System.Collections.Generic;
using System.Linq;
using System.Numerics;
using System.IO;
using System.Text.Json;
using Dark.Numerics;
using Dark.Grammar;
using Dark.World;

// Literal expectations, exact identities and conservation laws catch wrong branches,
// missing validation, rerolled lifts, overflow, stale transactions and incomplete undo.
internal static class Program
{
    private static int passed, failed;
    static int Main()
    {
        Run("WGS84 literal equator and poles", () => {
            NearVec(Geodesy.ToEcef(new Geodetic(0, 0, 0)), new Vector3d(6378137, 0, 0), 1e-8);
            NearVec(Geodesy.ToEcef(new Geodetic(90, 0, 0)), new Vector3d(0, 0, 6356752.314245179), 1e-8);
            NearVec(Geodesy.ToEcef(new Geodetic(-90, 0, 0)), new Vector3d(0, 0, -6356752.314245179), 1e-8);
            Near(Geodesy.FromEcef(new Vector3d(0, 0, 6356752.314245179)).LatitudeDegrees, 90, 1e-10);
        });
        Run("Antimeridian seam and ENU axis orientation", () => {
            NearVec(Geodesy.ToEcef(new Geodetic(0, 180, 0)), Geodesy.ToEcef(new Geodetic(0, -180, 0)), 2e-9);
            var f = new LocalEnuFrame(new Geodetic(0, 0, 0), 10000);
            NearVec(f.ToEcef(new Vector3d(1, 2, 3)), new Vector3d(6378140, 1, 2), 1e-9);
            NearVec(f.ToEnu(new Vector3d(6378140, 1, 2)), new Vector3d(1, 2, 3), 1e-9);
            Throws<ArgumentOutOfRangeException>(() => f.ToEcef(new Vector3d(10001, 0, 0)));
        });
        Run("Geodesy rejects nonfinite, invalid latitude and undefined center", () => {
            Throws<ArgumentOutOfRangeException>(() => new Geodetic(double.NaN, 0, 0));
            Throws<ArgumentOutOfRangeException>(() => new Geodetic(0, double.PositiveInfinity, 0));
            Throws<ArgumentOutOfRangeException>(() => new Geodetic(91, 0, 0));
            Throws<ArgumentOutOfRangeException>(() => new Geodetic(0, 0, double.NegativeInfinity));
            Throws<ArgumentOutOfRangeException>(() => Geodesy.FromEcef(new Vector3d(0, 0, 0)));
            Throws<ArgumentOutOfRangeException>(() => new Vector3d(double.NaN, 0, 0));
        });
        Run("1000 stratified WGS84 and local frame round trips seed 65163", () => {
            var rng = new Random(65163);
            for (int i=0;i<1000;i++) {
                var g = new Geodetic(-89.999 + 179.998*(i+.5)/1000, -180+360*rng.NextDouble(), -500+40000500*rng.NextDouble());
                var xyz=Geodesy.ToEcef(g); var back=Geodesy.FromEcef(xyz);
                Near(back.LatitudeDegrees,g.LatitudeDegrees,1e-9);
                Near(back.LongitudeDegrees,g.LongitudeDegrees,1e-9);
                Near(back.EllipsoidHeightMeters,g.EllipsoidHeightMeters,1e-5);
                var local=new LocalEnuFrame(g,10000); var v=new Vector3d(100*rng.NextDouble(),-100,25);
                NearVec(local.ToEnu(local.ToEcef(v)),v,2e-8);
            }
            foreach(var g in new[]{new Geodetic(0,180,-430),new Geodetic(89.999999,50,8849),new Geodetic(-90,-180,100)})
                NearVec(Geodesy.ToEcef(Geodesy.FromEcef(Geodesy.ToEcef(g))),Geodesy.ToEcef(g),1e-6);
        });
        Run("Supported negative-height polar boundary round trips",()=>{
            foreach(double lat in new[]{-90.0,-89.999,0,89.999,90}) {
                var g=new Geodetic(lat,73,-100000);var result=Geodesy.FromEcef(Geodesy.ToEcef(g));
                Near(result.EllipsoidHeightMeters,-100000,1e-7);Near(result.LatitudeDegrees,lat,1e-9);
            }
        });
        Run("Exact population shares and ordinal tie breaking", () => {
            var a=IntegerApportionment.Allocate(7,new[]{new PopulationWeight("c",1),new PopulationWeight("a",1),new PopulationWeight("b",1)});
            Equal(a["a"],3UL); Equal(a["b"],2UL); Equal(a["c"],2UL);
            var b=IntegerApportionment.Allocate(10,new[]{new PopulationWeight("a",1),new PopulationWeight("b",2),new PopulationWeight("c",3)});
            Equal(b["a"],2UL);Equal(b["b"],3UL);Equal(b["c"],5UL);
            Equal(IntegerApportionment.Allocate(ulong.MaxValue,new[]{new PopulationWeight("a",ulong.MaxValue),new PopulationWeight("b",ulong.MaxValue)})["a"],9223372036854775808UL);
        });
        Run("Allocation refuses duplicate, empty and zero denominator", () => {
            Throws<ArgumentException>(()=>IntegerApportionment.Allocate(1,Array.Empty<PopulationWeight>()));
            Throws<ArgumentException>(()=>IntegerApportionment.Allocate(1,new[]{new PopulationWeight("a",0)}));
            Throws<ArgumentException>(()=>IntegerApportionment.Allocate(1,new[]{new PopulationWeight("a",1),new PopulationWeight("a",2)}));
        });
        Run("Population conservation, permutation and quota property seed 25025", () => {
            var rng=new Random(25025);
            for(int t=0;t<500;t++) {
                var weights=Enumerable.Range(0,1+rng.Next(30)).Select(i=>new PopulationWeight("s"+i.ToString("D2"),(ulong)rng.Next(1,1000000))).ToArray();
                ulong n=(ulong)rng.Next(0,int.MaxValue);var a=IntegerApportionment.Allocate(n,weights);var b=IntegerApportionment.Allocate(n,weights.Reverse().ToArray());
                Equal(a.Values.Aggregate(BigInteger.Zero,(s,v)=>s+v),new BigInteger(n));
                BigInteger sum=weights.Aggregate(BigInteger.Zero,(s,w)=>s+w.Weight);
                foreach(var w in weights) {Equal(a[w.Id],b[w.Id]);BigInteger floor=new BigInteger(n)*w.Weight/sum; Check(a[w.Id]>=floor && a[w.Id]<=floor+1,"quota");}
            }
        });
        Run("Five cells keep zero, missing, forbidden and foreign distinct",()=>{
            Equal(NumberCell.Value(0).Kind,CellKind.Zero); Equal(NumberCell.Value(0).Number,0m);
            Equal(NumberCell.Value(3).Kind,CellKind.Value);
            foreach(var kind in new[]{CellKind.Missing,CellKind.Forbidden,CellKind.Foreign}) {
                var c=NumberCell.NonValue(kind,"evidence"); Equal(c.Kind,kind); Throws<InvalidOperationException>(()=>{var unused=c.Number;});
            }
            Throws<ArgumentException>(()=>NumberCell.NonValue(CellKind.Zero,"not a value"));
        });
        Run("Inverse keeps image failure, kernel failure and unique zero separate",()=>{
            Equal(IntegerConverse.Divide(1,0).Kind,InverseKind.ImageFailure);
            Equal(IntegerConverse.Divide(0,0).Kind,InverseKind.KernelFailure);
            Equal(IntegerConverse.Divide(7,2).Kind,InverseKind.ImageFailure);
            Equal(IntegerConverse.Divide(0,1).UniqueValue,BigInteger.Zero);
            Equal(IntegerConverse.Divide(6,3).UniqueValue,new BigInteger(2));
            Throws<InvalidOperationException>(()=>{var unused=IntegerConverse.Divide(0,0).UniqueValue;});
            Equal(IntegerConverse.DivideMod(2,2,6).Solutions.Count,2);
            Check(IntegerConverse.DivideMod(2,2,6).Solutions.SequenceEqual(new BigInteger[]{1,4}),"modular preimages");
            Equal(IntegerConverse.DivideMod(1,2,6).Kind,InverseKind.ImageFailure);
            Equal(IntegerConverse.DivideMod(1,3,7).UniqueValue,new BigInteger(5));
            Throws<ArgumentOutOfRangeException>(()=>IntegerConverse.DivideMod(1,1,4097));
        });
        Run("Tashkil preserves skeleton, context locality and complementary observations",()=>{
            var readings=new[]{new Reading("r2","shop",2,new Dictionary<string,string>{{"district","south"}},10),new Reading("r1","shop",2,new Dictionary<string,string>{{"district","north"}},10)};
            var resolver=new TashkilResolver("shop",2,readings);
            var unknown=resolver.Resolve(new Dictionary<string,string>());Equal(unknown.Status,LiftStatus.Ambiguous);Equal(unknown.Candidates.Count,2);Equal(unknown.Candidates[0].Id,"r1");
            var north=resolver.Resolve(new Dictionary<string,string>{{"district","north"}});Equal(north.Status,LiftStatus.Unique);Equal(north.Select("r1").SkeletonId,"shop");Equal(north.Select("r1").StructuralLevel,2);
            var extra=resolver.Resolve(new Dictionary<string,string>{{"district","north"},{"weather","rain"}});Equal(extra.Select("r1").Id,north.Select("r1").Id);
            Equal(resolver.Resolve(new Dictionary<string,string>{{"district","west"}}).Status,LiftStatus.Unreadable);
            Throws<InvalidOperationException>(()=>north.Select("r2"));
            Throws<ArgumentException>(()=>new TashkilResolver("other",2,readings));
        });
        Run("Plate reconnect changes reachability with revision and inverse witness",()=>{
            var w=Fixture(false);Check(w.Reachable("a","b"),"before connected");Check(!w.Reachable("a","c"),"before disconnected");
            var r=w.Rewrite(Request(0,OccupantPolicy.RefuseWhileOccupied));Check(r.Admitted,r.Reason);Check(r.State.Reachable("a","c"),"new connection");Check(!r.State.Reachable("a","b"),"old connection gone");
            Equal(r.State.Revision,1L);Check(r.Witness!.ReachabilityChanged,"reachability flag");Equal(r.Witness.PhysicalValidation,"NOT_RUN");
            var undo=r.State.Invert(r.Witness);Check(undo.Admitted,undo.Reason);Equal(undo.State.Revision,2L);Check(undo.State.Reachable("a","b"),"inverse restores graph");
            var duplicate=undo.State.Invert(r.Witness);Check(!duplicate.Admitted,"inverse replay refused");
        });
        Run("Occupied refusal, stale match, budget and invalid destination are atomic",()=>{
            var w=Fixture(true);var refused=w.Rewrite(Request(0,OccupantPolicy.RefuseWhileOccupied));Check(!refused.Admitted,"occupied");Check(ReferenceEquals(w,refused.State),"unchanged snapshot");
            var stale=w.Rewrite(Request(4,OccupantPolicy.RigidCarriage));Check(!stale.Admitted,"revision");Check(ReferenceEquals(w,stale.State),"unchanged stale");
            var bad=w.Rewrite(Request(0,OccupantPolicy.WitnessedRelocation,new Dictionary<string,string>{{"person","missing"}}));Check(!bad.Admitted,"destination");Check(ReferenceEquals(w,bad.State),"atomic destination refusal");
            var tiny=w.Rewrite(Request(0,OccupantPolicy.RigidCarriage,budget:1));Check(!tiny.Admitted,"bounded");Check(ReferenceEquals(w,tiny.State),"atomic budget");
            var wrong=new RewriteRequest(0,"p",new Edge("a","c"),new Edge("a","b"),90,OccupantPolicy.RigidCarriage,"test-authority",10,20,100);
            Check(!w.Rewrite(wrong).Admitted,"invalid match");
        });
        Run("Graph carriage retains local occupants with continuous mathematical path",()=>{
            var w=Fixture(true);var r=w.Rewrite(Request(0,OccupantPolicy.RigidCarriage));Check(r.Admitted,r.Reason);
            Equal(r.State.Occupants[0].NodeId,"b");Equal(r.Witness!.Transports.Count,1);
            var motion=r.Witness.Transports[0];Equal(motion.EntityId,"person");NearVec(motion.At(0),new Vector3d(1,0,0),1e-12);NearVec(motion.At(1),new Vector3d(0,0,1),1e-12);
            NearVec(motion.At(.5),new Vector3d(Math.Sqrt(.5),0,Math.Sqrt(.5)),1e-12);
            Equal(motion.AuthorityWitnessId,"test-authority"); Equal(motion.StartTick,10L); Equal(motion.EndTick,30L);
            var undo=r.State.Invert(r.Witness);Check(undo.Admitted,undo.Reason);Near(undo.State.Plates.Single(p=>p.Id=="p").AngleDegrees,0,0);
        });
        Run("Witnessed relocation records origin and destination; incomplete/straddler refused",()=>{
            var w=Fixture(true);var request=Request(0,OccupantPolicy.WitnessedRelocation,new Dictionary<string,string>{{"person","a"}});var r=w.Rewrite(request);Check(r.Admitted,r.Reason);
            Equal(r.State.Occupants[0].NodeId,"a");Equal(r.Witness!.Transports[0].OriginNode,"b");Equal(r.Witness.Transports[0].DestinationNode,"a");
            Equal(r.State.Invert(r.Witness).State.Occupants[0].NodeId,"b");
            Check(!w.Rewrite(Request(0,OccupantPolicy.WitnessedRelocation)).Admitted,"missing relocation");
            var straddle=Fixture(true,true);Check(!straddle.Rewrite(Request(0,OccupantPolicy.RigidCarriage)).Admitted,"straddler");
        });
        Run("Connectivity flag distinguishes reconnection from actual reachability change",()=>{
            var source=Fixture(false);
            var w=new PlateWorld(0,source.Plates,source.Nodes,new[]{new Edge("a","b"),new Edge("b","c")},Array.Empty<Occupant>());
            var r=w.Rewrite(Request(0,OccupantPolicy.RefuseWhileOccupied));Check(r.Admitted,r.Reason);
            Check(!r.Witness!.ReachabilityChanged,"internally connected plate preserves reachability");
            Check(r.Witness.EmbeddingChanged,"embedding rotation still changes");
            Check(r.State.Reachable("a","b") && r.State.Reachable("a","c"),"both stay reachable");
        });
        Run("Snapshot isolation, foreign inverse and explicit invalid policy refusal",()=>{
            var source=Fixture(true); var occupants=new[]{new Occupant("person","b")};
            var w=new PlateWorld(0,source.Plates,source.Nodes,source.Edges,occupants);
            occupants[0]=new Occupant("intruder","a"); Equal(w.Occupants[0].Id,"person");
            var r=w.Rewrite(Request(0,OccupantPolicy.RigidCarriage));Check(r.Admitted,r.Reason);
            var sameRevision=Fixture(true);Check(!sameRevision.Invert(r.Witness!).Admitted,"unrelated world cannot undo");
            Check(!w.Rewrite(Request(0,(OccupantPolicy)7)).Admitted,"unregistered policy");
            var nan=new RewriteRequest(0,"p",new Edge("a","b"),new Edge("a","c"),double.NaN,OccupantPolicy.RigidCarriage,"test",0,10,100);
            Check(!w.Rewrite(nan).Admitted,"nonfinite motion");
            Throws<ArgumentOutOfRangeException>(()=>r.Witness!.Transports[0].At(1.1));
        });
        Run("Straddlers on either boundary side and omitted attached objects refuse atomically",()=>{
            var source=Fixture(false);
            var straddler=new PlateWorld(0,source.Plates,source.Nodes,source.Edges,new[]{new Occupant("other-side","a",true)});
            var denied=straddler.Rewrite(Request(0,OccupantPolicy.RigidCarriage));Check(!denied.Admitted,"straddler on external plate");Check(ReferenceEquals(straddler,denied.State),"atomic straddler refusal");
            var attached=new PlateWorld(0,source.Plates,source.Nodes,source.Edges,new[]{new Occupant("person","b"),new Occupant("bag","b")});
            var incomplete=attached.Rewrite(Request(0,OccupantPolicy.WitnessedRelocation,new Dictionary<string,string>{{"person","a"}}));
            Check(!incomplete.Admitted,"omitted attached point entity");Check(ReferenceEquals(attached,incomplete.State),"atomic attachment refusal");
            var complete=attached.Rewrite(Request(0,OccupantPolicy.WitnessedRelocation,new Dictionary<string,string>{{"person","a"},{"bag","a"}}));
            Check(complete.Admitted,complete.Reason);Equal(complete.Witness!.Transports.Count,2);
        });
        Run("Plate coordinates reject nonlocal or overflow-prone centers",()=>{
            Throws<ArgumentOutOfRangeException>(()=>new Plate("oversized",new Vector3d(1e300,0,0),0));
        });
        Run("Port matches 650 pinned GiN modular converse outputs",()=>{
            using var doc=JsonDocument.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory,"Fixtures","converse.json")));
            foreach(var row in doc.RootElement.GetProperty("cases").EnumerateArray()) {
                var result=IntegerConverse.DivideMod(row.GetProperty("a").GetInt32(),row.GetProperty("b").GetInt32(),row.GetProperty("n").GetInt32());
                string kind=result.Kind==InverseKind.Unique?"unique":result.Kind==InverseKind.ImageFailure?"no-solution":"non-unique";
                Equal(kind,row.GetProperty("kind").GetString());
                Check(result.Solutions.SequenceEqual(row.GetProperty("solutions").EnumerateArray().Select(x=>new BigInteger(x.GetInt32()))),"reference preimage set");
            }
        });
        Run("200 sequential plate revisions preserve unaffected state and exact inverses",()=>{
            var rng=new Random(63065);var w=Fixture(true);
            for(int i=0;i<200;i++) {
                bool onB=w.Edges.Contains(new Edge("a","b"));
                var request=new RewriteRequest(w.Revision,"p",new Edge("a",onB?"b":"c"),new Edge("a",onB?"c":"b"),rng.Next(-180,181),OccupantPolicy.RigidCarriage,"property",i*100,20,100);
                var next=w.Rewrite(request);Check(next.Admitted,next.Reason);
                Equal(next.State.Occupants[0].Id,"person");Equal(next.State.Occupants[0].NodeId,"b");
                var inverse=next.State.Invert(next.Witness!);Check(inverse.Admitted,inverse.Reason);
                Check(inverse.State.Edges.SequenceEqual(w.Edges),"exact inverse adjacency");
                Near(inverse.State.Plates.Single(p=>p.Id=="p").AngleDegrees,w.Plates.Single(p=>p.Id=="p").AngleDegrees,0);
                NearVec(next.Witness!.Transports[0].At(.5),w.Rewrite(request).Witness!.Transports[0].At(.5),0);
                w=next.State;
            }
        });
        Console.WriteLine($"TOTAL {passed} PASS, {failed} FAIL");return failed==0?0:1;
    }
    static PlateWorld Fixture(bool occupied,bool straddles=false)=>new PlateWorld(0,new[]{new Plate("p",new Vector3d(0,0,0),0),new Plate("q",new Vector3d(0,0,0),0)},new[]{new PlateNode("a","q",new Vector3d(0,0,0)),new PlateNode("b","p",new Vector3d(1,0,0)),new PlateNode("c","p",new Vector3d(-1,0,0))},new[]{new Edge("a","b")},occupied?new[]{new Occupant("person","b",straddles)}:Array.Empty<Occupant>());
    static RewriteRequest Request(long revision,OccupantPolicy policy,IDictionary<string,string>? destinations=null,int budget=100)=>new RewriteRequest(revision,"p",new Edge("a","b"),new Edge("a","c"),90,policy,"test-authority",10,20,budget,destinations);
    static void Run(string name,Action a){try{a();Console.WriteLine("PASS "+name);passed++;}catch(Exception e){Console.WriteLine("FAIL "+name+": "+e);failed++;}}
    static void Check(bool value,string message){if(!value)throw new Exception(message);}
    static void Equal<T>(T actual,T expected){if(!EqualityComparer<T>.Default.Equals(actual,expected))throw new Exception($"expected {expected}, got {actual}");}
    static void Near(double actual,double expected,double tolerance){if(double.IsNaN(actual)||Math.Abs(actual-expected)>tolerance)throw new Exception($"expected {expected:R} ± {tolerance:R}, got {actual:R}");}
    static void NearVec(Vector3d a,Vector3d b,double t){Near(a.X,b.X,t);Near(a.Y,b.Y,t);Near(a.Z,b.Z,t);}
    static void Throws<T>(Action a) where T:Exception {try{a();}catch(T){return;}throw new Exception("expected "+typeof(T).Name);}
}
