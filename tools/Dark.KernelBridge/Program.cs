using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Threading;
using Dark.Numerics;
using Dark.World;
using Dark.Population;

internal static class Program
{
    const int Limit=1024*1024;
    const string FixtureHash="8abae87f2866dd3a43106c9c77f8f65613245c691d2111949b1b53339ec6bfef";
    const string PopulationHash="770cbf8e33263680074c1bc60a5af540ac2f55db991389bfeabebc762c528e11";
    const string SourceHash="55bd28406a5cf22063eba5d456e46f4cd7f1b590c9288bc4808ad9ff1a27e86a";
    static readonly JsonSerializerOptions Output=new JsonSerializerOptions{WriteIndented=false};
    static int Main()
    {
        using var deadline=new Timer(_=>Environment.Exit(124),null,TimeSpan.FromSeconds(10),Timeout.InfiniteTimeSpan);
        string operation="unknown";Dictionary<string,object?> response;
        try
        {
            byte[] data=ReadBounded(Console.OpenStandardInput());
            using var document=JsonDocument.Parse(data,new JsonDocumentOptions{MaxDepth=32});
            UniqueKeys(document.RootElement);
            var request=document.RootElement;
            Fields(request,new[]{"schema","operation","arguments"});
            if(S(request,"schema")!="dark.kernel-request/1")throw new ArgumentException("unsupported schema");
            operation=S(request,"operation");var args=request.GetProperty("arguments");
            if(args.ValueKind!=JsonValueKind.Object)throw new ArgumentException("arguments must be object");
            response=Dispatch(operation,args);
        }
        catch(Exception ex) when(ex is ArgumentException||ex is InvalidDataException||ex is JsonException||ex is InvalidOperationException||ex is OverflowException||ex is FormatException||ex is KeyNotFoundException||ex is IOException)
        { response=Envelope(operation,"REFUSED");response["reason"]="INPUT_OR_KERNEL_REFUSAL";response["detail"]=ex.Message.Length>512?ex.Message.Substring(0,512):ex.Message; }
        byte[] result=JsonSerializer.SerializeToUtf8Bytes(response,Output);
        if(result.Length+1>Limit)
        { var refusal=Envelope(operation,"REFUSED");refusal["reason"]="OUTPUT_BUDGET";result=JsonSerializer.SerializeToUtf8Bytes(refusal,Output); }
        using var stdout=Console.OpenStandardOutput();stdout.Write(result,0,result.Length);stdout.WriteByte(10);return 0;
    }
    static byte[] ReadBounded(Stream stream)
    {
        using var memory=new MemoryStream();byte[] buffer=new byte[16384];
        while(true){int n=stream.Read(buffer,0,Math.Min(buffer.Length,Limit+1-(int)memory.Length));if(n==0)break;memory.Write(buffer,0,n);if(memory.Length>Limit)throw new InvalidDataException("input budget 1 MiB");}
        return memory.ToArray();
    }
    static void UniqueKeys(JsonElement e)
    {
        if(e.ValueKind==JsonValueKind.Object){var seen=new HashSet<string>(StringComparer.Ordinal);foreach(var p in e.EnumerateObject()){if(!seen.Add(p.Name))throw new ArgumentException("duplicate JSON key");UniqueKeys(p.Value);}}
        else if(e.ValueKind==JsonValueKind.Array)foreach(var item in e.EnumerateArray())UniqueKeys(item);
    }
    static void Fields(JsonElement e,string[] required,string[]? optional=null)
    {
        if(e.ValueKind!=JsonValueKind.Object)throw new ArgumentException("expected object");var names=e.EnumerateObject().Select(p=>p.Name).ToHashSet(StringComparer.Ordinal);
        if(required.Any(k=>!names.Contains(k))||names.Except(required.Concat(optional??Array.Empty<string>()),StringComparer.Ordinal).Any())throw new ArgumentException("unexpected or missing fields");
    }
    static string S(JsonElement e,string key)=>e.GetProperty(key).GetString()??throw new ArgumentException("null string "+key);
    static JsonElement[] A(JsonElement e,string key,int max)
    { var a=e.GetProperty(key);if(a.ValueKind!=JsonValueKind.Array||a.GetArrayLength()>max)throw new ArgumentException("array budget "+key);return a.EnumerateArray().ToArray(); }
    static Dictionary<string,object?> Envelope(string op,string status)=>new Dictionary<string,object?>{{"schema","dark.kernel-result/1"},{"operation",op},{"status",status},{"authority_granted",false},{"physical_validation","NOT_RUN"}};
    static string Hash(byte[] bytes)=>Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
    static byte[] Pinned(string file,string sha)
    { using var input=File.OpenRead(Path.Combine(AppContext.BaseDirectory,"Fixtures",file));var bytes=ReadBounded(input);if(Hash(bytes)!=sha)throw new InvalidDataException("pinned fixture hash mismatch: "+file);return bytes; }
    static JsonElement Fixture(){using var d=JsonDocument.Parse(Pinned("tampa-two-plate-fixture.json",FixtureHash));return d.RootElement.Clone();}
    static Vector3d Vector(JsonElement e)
    { if(e.ValueKind!=JsonValueKind.Array||e.GetArrayLength()!=3)throw new ArgumentException("XYZ requires three finite coordinates");return new Vector3d(e[0].GetDouble(),e[1].GetDouble(),e[2].GetDouble()); }
    static double[] XYZ(Vector3d v)=>new[]{v.X,v.Y,v.Z};
    static Edge EdgeOf(JsonElement e){Fields(e,new[]{"a","b"});return new Edge(S(e,"a"),S(e,"b"));}
    static PlateWorld WorldOf(JsonElement e)
    {
        Fields(e,new[]{"revision","plates","nodes","edges","occupants"});
        return new PlateWorld(e.GetProperty("revision").GetInt64(),
            A(e,"plates",2).Select(p=>{Fields(p,new[]{"id","center_xyz_m","angle_degrees"});return new Plate(S(p,"id"),Vector(p.GetProperty("center_xyz_m")),p.GetProperty("angle_degrees").GetDouble());}).ToArray(),
            A(e,"nodes",256).Select(n=>{Fields(n,new[]{"id","plate_id","local_xyz_m"});return new PlateNode(S(n,"id"),S(n,"plate_id"),Vector(n.GetProperty("local_xyz_m")));}).ToArray(),
            A(e,"edges",512).Select(EdgeOf).ToArray(),
            A(e,"occupants",256).Select(o=>{Fields(o,new[]{"id","node_id","boundary_straddler"});return new Occupant(S(o,"id"),S(o,"node_id"),o.GetProperty("boundary_straddler").GetBoolean());}).ToArray());
    }
    static RewriteRequest RequestOf(JsonElement e)
    {
        Fields(e,new[]{"expected_revision","plate_id","remove","add","rotation_degrees","policy","authority_witness_id","start_tick","duration_ticks","operation_budget","destinations"});
        if(!Enum.TryParse<OccupantPolicy>(S(e,"policy"),false,out var policy)||!Enum.IsDefined(policy))throw new ArgumentException("unsupported occupant policy");
        var d=e.GetProperty("destinations");if(d.ValueKind!=JsonValueKind.Object||d.EnumerateObject().Count()>256)throw new ArgumentException("destinations budget");
        var destinations=d.EnumerateObject().ToDictionary(p=>p.Name,p=>p.Value.GetString()??throw new ArgumentException("null destination"),StringComparer.Ordinal);
        return new RewriteRequest(e.GetProperty("expected_revision").GetInt64(),S(e,"plate_id"),EdgeOf(e.GetProperty("remove")),EdgeOf(e.GetProperty("add")),
            e.GetProperty("rotation_degrees").GetDouble(),policy,S(e,"authority_witness_id"),e.GetProperty("start_tick").GetInt64(),e.GetProperty("duration_ticks").GetInt64(),e.GetProperty("operation_budget").GetInt32(),destinations);
    }
    static object WorldJson(PlateWorld w)=>new{revision=w.Revision,
        plates=w.Plates.Select(p=>new{id=p.Id,center_xyz_m=XYZ(p.Center),angle_degrees=p.AngleDegrees}).ToArray(),
        nodes=w.Nodes.Select(n=>new{id=n.Id,plate_id=n.PlateId,local_xyz_m=XYZ(n.LocalPosition)}).ToArray(),
        edges=w.Edges.Select(e=>new{a=e.A,b=e.B}).ToArray(),occupants=w.Occupants.Select(o=>new{id=o.Id,node_id=o.NodeId,boundary_straddler=o.BoundaryStraddler}).ToArray()};
    static Vector3d Placed(Plate plate,Vector3d local)
    { double radians=plate.AngleDegrees*Math.PI/180;return plate.Center+new Vector3d(local.X*Math.Cos(radians)-local.Z*Math.Sin(radians),local.Y,local.X*Math.Sin(radians)+local.Z*Math.Cos(radians)); }
    static object Projection(PlateWorld world)
    {
        var fixture=Fixture();var source=A(fixture.GetProperty("source_graph"),"nodes",256).ToDictionary(n=>S(n,"id"));
        var anchor=source["osm/node/1603574189"];var frame=new LocalEnuFrame(new Geodetic(anchor.GetProperty("latitude_deg").GetDouble(),anchor.GetProperty("longitude_deg").GetDouble(),0),10000);
        var points=new List<object>();bool sourceSet=world.Nodes.All(n=>source.ContainsKey(n.Id));
        foreach(var node in world.Nodes)
        {
            var plate=world.Plates.Single(p=>p.Id==node.PlateId);var xyz=Placed(plate,node.LocalPosition);object? projected=null;object? original=null;
            if(sourceSet&&xyz.Length<=10000)
            {
                var geo=Geodesy.FromEcef(frame.ToEcef(new Vector3d(xyz.X,xyz.Z,xyz.Y)));
                projected=new{latitude_deg=geo.LatitudeDegrees,longitude_deg=geo.LongitudeDegrees,ellipsoid_height_m=geo.EllipsoidHeightMeters,synthetic_layer=true};
                var record=source[node.Id];original=new{latitude_deg=record.GetProperty("latitude_deg").GetDouble(),longitude_deg=record.GetProperty("longitude_deg").GetDouble(),ellipsoid_height_m=(double?)null};
            }
            points.Add(new{id=node.Id,world_xyz_m=XYZ(xyz),source_coordinate=original,synthetic_coordinate=projected});
        }
        return new{fixture_sha256=FixtureHash,source_sha256=SourceHash,source_coordinates_changed=false,
            coordinate_convention="x=east,y=up,z=north; bounded WGS84 ENU anchored at osm/node/1603574189",
            source_height_validity="UNKNOWN; projection assumes source ellipsoid h=0 and is not terrain",source_node_set_recognized=sourceSet,nodes=points};
    }
    static object Witness(RewriteWitness w,PlateWorld before,RewriteRequest request)
    {
        var moving=before.Plates.Single(p=>p.Id==request.PlateId);
        return new{rule=w.Rule,clause=w.Clause,operation=w.Operation,reachability_changed=w.ReachabilityChanged,embedding_changed=w.EmbeddingChanged,work_bound=w.WorkBound,physical_validation=w.PhysicalValidation,
            transports=w.Transports.Select(t=>new{entity_id=t.EntityId,origin_node=t.OriginNode,destination_node=t.DestinationNode,authority_witness_id=t.AuthorityWitnessId,policy=t.Policy.ToString(),start_tick=t.StartTick,end_tick=t.EndTick,
                curve=new{kind=t.Policy==OccupantPolicy.RigidCarriage?"rigid_rotation_y":"linear_relocation",center_xyz_m=XYZ(moving.Center),start_angle_degrees=moving.AngleDegrees,
                    rotation_degrees=request.RotationDegrees,local_xyz_m=XYZ(before.Nodes.Single(n=>n.Id==t.OriginNode).LocalPosition),start_xyz_m=XYZ(t.At(0)),end_xyz_m=XYZ(t.At(1))},
                samples=new[]{0.0,.25,.5,.75,1.0}.Select(time=>new{t=time,xyz_m=XYZ(t.At(time))}).ToArray()}).ToArray()};
    }
    static PopulationShard[] PopulationSource()
    {
        var text=new UTF8Encoding(false,true).GetString(Pinned("population-shards.tsv",PopulationHash));
        return text.Split('\n').Skip(1).Where(l=>l.Length>0).Select(line=>{var f=line.Split('\t');if(f.Length!=4)throw new InvalidDataException("population TSV");return new PopulationShard(f[0],f[1],f[2],ulong.Parse(f[3],CultureInfo.InvariantCulture));}).ToArray();
    }
    static object Person(PopulationPerson p)=>new{id=p.Id,origin=p.Origin,ordinal=p.Ordinal,residence=p.Residence,present=p.Present,fidelity=p.Fidelity.ToString(),policy_seed=p.PolicySeed,facts=p.Facts,commitments=p.Commitments,last_event_revision=p.LastEventRevision};
    static Dictionary<string,object?> Population(string op,JsonElement args)
    {
        bool inspect=op=="population_inspect";
        string[] required=inspect?new[]{"person_ids","snapshot"}:op=="population_move"?new[]{"person_id","destination","request_id","expected_revision","migration"}:new[]{"person_id"};
        Fields(args,required,inspect?Array.Empty<string>():op=="population_move"?new[]{"snapshot"}:new[]{"snapshot","promote","demote","fact","commitment"});
        var source=PopulationSource();PopulationLedger ledger=args.TryGetProperty("snapshot",out var snapshot)&&snapshot.ValueKind!=JsonValueKind.Null
            ?PopulationLedger.Restore(source,snapshot.GetString()??throw new ArgumentException("snapshot string"),maxActive:256,maxStored:1024,maxMovements:2048)
            :new PopulationLedger(source,maxActive:256,maxStored:1024,maxMovements:2048);
        var response=Envelope(op,"OK");PopulationMovement? move=null;PopulationPerson? person=null;
        if(inspect)
        {
            var ids=A(args,"person_ids",1024).Select(e=>e.GetString()??throw new ArgumentException("person identity string")).ToArray();
            if(ids.Distinct(StringComparer.Ordinal).Count()!=ids.Length)throw new ArgumentException("duplicate inspection identity");
            response["persons"]=ids.Select(id=>Person(ledger.Resolve(id))).ToArray();
        }
        else
        {
        string id=S(args,"person_id");
        if(op=="population_move") move=ledger.Move(id,S(args,"destination"),S(args,"request_id"),args.GetProperty("expected_revision").GetUInt64(),args.GetProperty("migration").GetBoolean());
        else
        {
            ledger.Resolve(id);
            if(args.TryGetProperty("promote",out var promote)&&promote.GetBoolean())ledger.Promote(id);
            if(args.TryGetProperty("fact",out var fact))ledger.Remember(id,fact.GetString()??throw new ArgumentException("fact string"));
            if(args.TryGetProperty("commitment",out var commitment))ledger.CommitTo(id,commitment.GetString()??throw new ArgumentException("commitment string"));
            if(args.TryGetProperty("demote",out var demote)&&demote.GetBoolean())ledger.Demote(id);
        }
        person=ledger.Resolve(id);response["person"]=Person(person);
        }
        response["revision"]=ledger.Revision;response["snapshot"]=ledger.Save();response["allocation_hash"]=ledger.AllocationHash;
        response["source_epoch"]="World Bank WDI SP.POP.TOTL 2024";response["population_source_sha256"]=PopulationHash;
        response["metrics"]=new{demographic_estimate=ledger.Total,virtual_members=ledger.VirtualIndividuals,stored_individuals=ledger.StoredIndividuals,
            stored_individual_histories=ledger.StoredIndividuals,active_actors=ledger.ActiveIndividuals,focused_actors=ledger.FocusedIndividuals,visible_characters=0,voiced_characters=0};
        if(person!=null)response["counts"]=new[]{person.Residence,person.Present}.Distinct().ToDictionary(code=>code,code=>{var c=ledger.Counts(code);return new{residents=c.Residents,present=c.Present,visitors=c.Visitors,absent_residents=c.AbsentResidents};});
        if(move!=null)response["movement"]=new{request_id=move.RequestId,person_id=move.PersonId,destination=move.Destination,migration=move.Migration,revision=move.Revision};
        response["spatial_fidelity"]="source economy totals plus explicitly unassigned world residual; no raster density inferred";return response;
    }
    static Dictionary<string,object?> Dispatch(string op,JsonElement args)
    {
        if(op=="describe")
        {
            Fields(args,Array.Empty<string>());Fixture();PopulationSource();var response=Envelope(op,"OK");response["kernels"]=new[]{"Dark.World.PlateWorld","Dark.Population.PopulationLedger"};
            response["fixture_sha256"]=FixtureHash;response["population_source_sha256"]=PopulationHash;response["operations"]=new[]{"describe","plate_fixture","plate_validate","plate_apply","population_resolve","population_move","population_inspect"};
            response["limits"]=new{input_bytes=Limit,output_bytes=Limit,seconds=10,plates=2,nodes=256,edges=512,occupants=256};return response;
        }
        if(op=="plate_fixture") {Fields(args,Array.Empty<string>());var response=Envelope(op,"OK");response["fixture"]=Fixture();return response;}
        if(op=="plate_validate"||op=="plate_apply")
        {
            Fields(args,new[]{"world","request"});var before=WorldOf(args.GetProperty("world"));var request=RequestOf(args.GetProperty("request"));var result=before.Rewrite(request);
            var response=Envelope(op,result.Admitted?(op=="plate_validate"?"VALID":"ADMITTED"):"REFUSED");response["reason"]=result.Reason;response["revision"]=result.State.Revision;
            response["next_state"]=result.Admitted?WorldJson(result.State):args.GetProperty("world").Clone();response["witness"]=result.Witness==null?null:Witness(result.Witness,before,request);
            response["source_projection"]=Projection(result.State);response["activation_requires_revalidation"]=true;response["durable_commit_performed"]=false;return response;
        }
        if(op=="population_resolve"||op=="population_move"||op=="population_inspect")return Population(op,args);
        var refused=Envelope(op,"REFUSED");refused["reason"]="UNKNOWN_OPERATION";return refused;
    }
}
