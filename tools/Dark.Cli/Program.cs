using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text.Json;
using Dark.Core;
using Dark.History;
using Dark.Population;

static class Program
{
    const string PolicySource="constitution dark 1 { clause HD_073 subject sign when authenticated may set_sign requires scoped_write preserves same_revision budget 256 witness sign_change verifies sign_test ; }";
    static int Main(string[] args)
    {
        var timer=Stopwatch.StartNew();string requestId=Guid.NewGuid().ToString("N");
        var policy=AdmissionPolicy.Compile(PolicySource);string operation=args.Length>0?args[0]:"describe";
        try
        {
            object data;
            switch(operation)
            {
                case "describe":
                    if(args.Length>1)throw new ArgumentException("describe takes no arguments");
                    data=new {founder_authenticated=false,engine="Dark",schema="dark.local-sign-domain/1",operations=new[]{"describe","demo <empty-directory>","validate <policy-file>","replay <journal-file> <trusted-head>","replay-npc <snapshot> <expected-actor-id> <trusted-digest>"},limits=new {scope="local operator fixtures",network_service=false,native_gameplay=false,maximum_events=100000},obligations=policy.Obligations};break;
                case "validate":
                    if(args.Length!=2)throw new ArgumentException("validate requires a policy file");
                    var source=ReadBounded(args[1],65536);var compiled=AdmissionPolicy.Compile(source);
                    data=new {valid=true,digest=compiled.Digest,obligations=compiled.Obligations};break;
                case "demo":
                    if(args.Length!=2)throw new ArgumentException("demo requires a new/empty directory");
                    data=Demo(args[1],policy);break;
                case "replay":
                    if(args.Length!=3)throw new ArgumentException("replay requires journal path and independently trusted head");
                    var info=new FileInfo(args[1]);if(info.Length>64*1024*1024)throw new ArgumentException("Journal byte budget exceeded");
                    var replay=EventJournal.Verify(File.ReadLines(args[1]),args[2],policy.Digest);
                    data=new {events=replay.Events.Count,head=args[2],signs=replay.Signs};break;
                case "replay-npc":
                    if(args.Length!=4)throw new ArgumentException("replay-npc requires snapshot path, expected actor ID and independently trusted digest");
                    // The caller supplies expected identity. The temporary value is never substituted for a refused load.
                    var unloaded=new Inhabitant(args[2],new Personality(0,0),"unloaded");
                    var restored=new FileInhabitantStore(args[1],args[2]).Restore(unloaded,args[3]);
                    if(!restored.Succeeded)throw new IOException("NPC restore refused: "+restored.Code);
                    data=new {actor_id=restored.State.Id,task=restored.State.Task,personality=restored.State.Personality,
                        memory_count=restored.State.Memories.Count,observations=restored.State.Memories,
                        generation=restored.Generation,digest=restored.Digest};break;
                default:throw new ArgumentException("Unsupported operation");
            }
            Emit("ok",0,data);return 0;
        }
        catch(Exception e) when(e is ArgumentException||e is IOException||e is UnauthorizedAccessException||e is PolicyException||e is JournalException)
        {Emit("refused",2,new{reason=e.Message,type=e.GetType().Name});return 2;}
        void Emit(string status,int code,object data)=>Console.WriteLine(JsonSerializer.Serialize(new{schema="darkctl.result/1",request_id=requestId,operation,status,policy_digest=policy.Digest,duration_ms=timer.ElapsedMilliseconds,exit_status=code,data,warnings=new[]{"Local development domain only; founder account and native experience are not provisioned."}}));
    }
    static string ReadBounded(string path,long maximum)
    {if(new FileInfo(path).Length>maximum)throw new ArgumentException("Input byte budget exceeded");return File.ReadAllText(path,Canonical.Utf8);}
    static object Demo(string directory,AdmissionPolicy policy)
    {
        string full=Path.GetFullPath(directory);Directory.CreateDirectory(full);
        if(Directory.EnumerateFileSystemEntries(full).Any())throw new ArgumentException("Demo requires an empty directory; existing state preserved");
        string path=Path.Combine(full,"events.darklog");
        // Exclusive creation refuses accidental overwrite. The disposable credential grants no founder rights.
        using(var created=new FileStream(path,FileMode.CreateNew,FileAccess.Write,FileShare.None))created.Flush(true);
        var clock=new SimulationClock(0);var authority=new LocalAuthority(clock);byte[] credential=RandomNumberGenerator.GetBytes(32);
        authority.RegisterMember("local-author",credential,"sign/cafe");
        var session=authority.Authenticate("local-author",credential,100)!;Array.Clear(credential,0,credential.Length);
        var world=new SignWorld(authority,policy,new FileEventSink(path));
        clock.AdvanceTo(1);
        var first=world.SetSign(session,"demo-1",0,1,"sign/cafe","Welcome");
        clock.AdvanceTo(2);
        var second=world.SetSign(session,"demo-2",1,2,"sign/cafe","A place to return to");
        if(!first.Admitted||!second.Admitted)throw new IOException("Demo event persistence failed");
        var duplicate=world.SetSign(session,"demo-2",1,2,"sign/cafe","A place to return to");
        clock.AdvanceTo(3);
        var refused=world.SetSign(session,"demo-3",0,3,"sign/cafe","stale");
        var restored=SignWorld.Restore(authority,policy,File.ReadLines(path),world.Head);
        var npc=new Inhabitant("npc-cafe",new Personality(.3,.8),"work");
        npc.Observe(new Observation("hello-1",session.ActorId,"greeting",1,"cafe"),"cafe");
        string npcPath=Path.Combine(full,"npc.darknpc");
        var store=new FileInhabitantStore(npcPath,npc.Id);
        var savedNpc=store.Save(npc,FileInhabitantStore.Genesis);
        if(!savedNpc.Succeeded)throw new IOException("NPC persistence refused: "+savedNpc.Code);
        var restoredNpc=store.Restore(npc,savedNpc.Digest);
        if(!restoredNpc.Succeeded)throw new IOException("NPC restore refused: "+restoredNpc.Code);
        File.WriteAllText(Path.Combine(full,"head.txt"),world.Head+"\n");
        File.WriteAllText(Path.Combine(full,"npc-head.txt"),savedNpc.Digest+"\n");
        return new {revision=restored.Revision,head=restored.Head,replayed_sign=restored.Signs["sign/cafe"],duplicate_did_not_commit=duplicate.EventHash==second.EventHash&&world.Events.Count==2,stale_refusal=refused.Code,npc_decision=restoredNpc.State.DecideRide(session.ActorId,2).Action,
            npc_snapshot=npcPath,npc_digest=savedNpc.Digest,npc_observations_restored=restoredNpc.State.Memories.Count,
            founder_authenticated=false,journal=path};
    }
}
