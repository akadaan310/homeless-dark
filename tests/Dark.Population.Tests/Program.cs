using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using Dark.Population;

internal static class Program
{
    static int passed,failed;
    static int Main(string[] args)
    {
        if(args.Length>0)return Child(args);
        Test("snapshot persists exact identity, personality, task and ordered causal memory",directory=>{
            var npc=Fixture();var decision=npc.DecideRide("player",12);var store=new FileInhabitantStore(Path.Combine(directory,"npc.snapshot"),"npc-1");
            var save=store.Save(npc,FileInhabitantStore.Genesis);Check(save.Succeeded,save.Code);Equal(1L,save.Generation);Check(ReferenceEquals(npc,save.State),"save preserves live actor");
            var placeholder=new Inhabitant("npc-1",new Personality(.1,.9),"work");
            var loaded=new FileInhabitantStore(store.Path,"npc-1").Restore(placeholder,save.Digest);Check(loaded.Succeeded,loaded.Code);
            Check(!ReferenceEquals(placeholder,loaded.State),"restore returns validated replacement");Equal("npc-1",loaded.State.Id);Equal("leisure",loaded.State.Task);
            Equal(.9,loaded.State.Personality.Sociability);Equal(.1,loaded.State.Personality.Duty);
            Equal(2,loaded.State.Memories.Count);Equal("greet-1",loaded.State.Memories[0].EventId);Equal("player",loaded.State.Memories[0].ActorId);
            Equal("greeting",loaded.State.Memories[0].Act);Equal(10L,loaded.State.Memories[0].Tick);Equal("cafe",loaded.State.Memories[0].Cell);
            Equal("arrival-1",loaded.State.Memories[1].EventId);Equal("driver",loaded.State.Memories[1].ActorId);Equal(11L,loaded.State.Memories[1].Tick);
            Equal(decision.Action,loaded.State.DecideRide("player",12).Action);Equal(decision.Witness,loaded.State.DecideRide("player",12).Witness);
            Equal(0,placeholder.Memories.Count);Equal("work",placeholder.Task);
        });
        Test("reloaded actor rejects duplicate, remote and backdated observations before later save",directory=>{
            var path=Path.Combine(directory,"npc.snapshot");var store=new FileInhabitantStore(path,"npc-1");var first=store.Save(Fixture(),FileInhabitantStore.Genesis);Check(first.Succeeded,first.Code);
            var loaded=store.Restore(Fallback(),first.Digest);Check(loaded.Succeeded,loaded.Code);var npc=loaded.State;
            Check(!npc.Observe(new Observation("greet-1","player","greeting",10,"cafe"),"cafe"),"dedupe survives reload");
            Check(!npc.Observe(new Observation("remote","stranger","greeting",12,"airport"),"cafe"),"remote was never observed");
            Check(!npc.Observe(new Observation("old","player","greeting",9,"cafe"),"cafe"),"old memory order refused");Equal(2,npc.Memories.Count);
            Check(npc.Observe(new Observation("return-1","player","wave",20,"harbor"),"harbor"),"later admitted local observation");
            var next=store.Save(npc,first.Digest);Check(next.Succeeded,next.Code);Equal(2L,next.Generation);
            var again=new FileInhabitantStore(path,"npc-1").Restore(Fallback(),next.Digest);Check(again.Succeeded,again.Code);Equal(3,again.State.Memories.Count);
            Equal("harbor",again.State.Memories[2].Cell);Equal("return-1",again.State.Memories[2].EventId);
        });
        Test("separate writer and reader processes retain actual NPC decision and causal identity",directory=>{
            string path=Path.Combine(directory,"process.snapshot");string digest=RunChild("write",path).Trim();Check(digest.Length==64,"save receipt");
            Equal("restored npc-1 offer_ride 2 memories",RunChild("read",path,digest).Trim());
        });
        Test("caller identity is bound before save and restore, even with a valid alien checksum",directory=>{
            string path=Path.Combine(directory,"npc.snapshot");var store=new FileInhabitantStore(path,"npc-1");var first=store.Save(Fixture(),FileInhabitantStore.Genesis);Check(first.Succeeded,first.Code);byte[] original=File.ReadAllBytes(path);
            var other=Fixture("npc-2");var denied=store.Save(other,first.Digest);Equal("identity_mismatch",denied.Code);Check(ReferenceEquals(other,denied.State),"save refusal state");Bytes(original,File.ReadAllBytes(path));
            var wrongCurrent=store.Restore(other,first.Digest);Equal("identity_mismatch",wrongCurrent.Code);Check(ReferenceEquals(other,wrongCurrent.State),"restore caller mismatch");
            var wrongSlot=new FileInhabitantStore(path,"npc-2").Restore(other,first.Digest);Equal("identity_mismatch",wrongSlot.Code);Check(ReferenceEquals(other,wrongSlot.State),"valid checksum cannot substitute actor");Bytes(original,File.ReadAllBytes(path));
        });
        Test("stale save and untrusted replay cannot replace the latest checkpoint",directory=>{
            string path=Path.Combine(directory,"npc.snapshot");var a=new FileInhabitantStore(path,"npc-1");var b=new FileInhabitantStore(path,"npc-1");var npc=Fixture();
            var one=a.Save(npc,FileInhabitantStore.Genesis);Check(one.Succeeded,one.Code);npc.Observe(new Observation("later","player","wave",12,"cafe"),"cafe");
            var two=b.Save(npc,one.Digest);Check(two.Succeeded,two.Code);byte[] latest=File.ReadAllBytes(path);
            var stale=a.Save(npc,one.Digest);Equal("stale_snapshot",stale.Code);Bytes(latest,File.ReadAllBytes(path));
            var fallback=Fallback();var replay=a.Restore(fallback,one.Digest);Equal("digest_mismatch",replay.Code);Check(ReferenceEquals(fallback,replay.State),"wrong trusted receipt preserves memory");
            Equal("stale_snapshot",a.Save(npc,FileInhabitantStore.Genesis).Code);Bytes(latest,File.ReadAllBytes(path));
        });
        Test("truncation and corrupt bytes refuse without replacing memory or modifying damaged file",directory=>{
            string path=Path.Combine(directory,"npc.snapshot");var store=new FileInhabitantStore(path,"npc-1");var saved=store.Save(Fixture(),FileInhabitantStore.Genesis);Check(saved.Succeeded,saved.Code);byte[] valid=File.ReadAllBytes(path);
            foreach(int length in new[]{0,1,8,16,valid.Length/2,valid.Length-1}) {
                byte[] bad=valid.Take(length).ToArray();File.WriteAllBytes(path,bad);var current=Fixture();
                var load=store.Restore(current,saved.Digest);Check(!load.Succeeded,"truncation at "+length);Check(ReferenceEquals(current,load.State),"unchanged live state");Bytes(bad,File.ReadAllBytes(path));
                var save=store.Save(current,saved.Digest);Check(!save.Succeeded,"damaged prior file cannot be overwritten");Bytes(bad,File.ReadAllBytes(path));Equal(2,current.Memories.Count);
            }
            byte[] changed=(byte[])valid.Clone();changed[20]^=1;File.WriteAllBytes(path,changed);Check(!store.Restore(Fixture(),saved.Digest).Succeeded,"checksum mutation");Bytes(changed,File.ReadAllBytes(path));
        });
        Test("valid checksums cannot admit unsupported schema or invalid snapshot semantics",directory=>{
            string path=Path.Combine(directory,"npc.snapshot");var store=new FileInhabitantStore(path,"npc-1");
            var cases=new[]{
                Wire(version:2), Wire(id:"npc-2"), Wire(sociability:double.NaN),Wire(sociability:double.PositiveInfinity),Wire(duty:-.1),Wire(task:"bad task"),
                Wire(observations:new[]{new Observation("duplicate","player","greeting",10,"cafe"),new Observation("duplicate","driver","wave",11,"cafe")}),
                Wire(observations:new[]{new Observation("late","player","greeting",11,"cafe"),new Observation("early","player","wave",10,"cafe")})
            };
            foreach(byte[] data in cases) {
                File.WriteAllBytes(path,data);var current=Fixture();var refused=store.Restore(current,Receipt(data));Check(!refused.Succeeded,"invalid semantic payload");Check(ReferenceEquals(current,refused.State),"same actor on refusal");Bytes(data,File.ReadAllBytes(path));
                Check(!store.Save(current,Receipt(data)).Succeeded,"invalid old snapshot preserved");Bytes(data,File.ReadAllBytes(path));
            }
        });
        Test("oversized files and excessive memory counts are bounded before restore",directory=>{
            string path=Path.Combine(directory,"npc.snapshot");var store=new FileInhabitantStore(path,"npc-1");var current=Fixture();
            File.WriteAllBytes(path,new byte[256*1024+1]);var denied=store.Restore(current,new string('a',64));Equal("snapshot_too_large",denied.Code);Check(ReferenceEquals(current,denied.State),"size refusal");Equal(256*1024+1,File.ReadAllBytes(path).Length);
            byte[] excessive=Wire(observations:Enumerable.Range(0,257).Select(i=>new Observation("e-"+i,"player","wave",i,"cafe")).ToArray());File.WriteAllBytes(path,excessive);
            var count=store.Restore(current,Receipt(excessive));Equal("invalid_snapshot",count.Code);Bytes(excessive,File.ReadAllBytes(path));
        });
        Test("malformed UTF8, field lengths, negative ticks and trailing payload are typed refusals",directory=>{
            string path=Path.Combine(directory,"npc.snapshot");var store=new FileInhabitantStore(path,"npc-1");var current=Fixture();
            var utf8=Wire();utf8[20]=0xff;Reseal(utf8);
            var hugeLength=Wire();hugeLength[18]=0xff;hugeLength[19]=0xff;Reseal(hugeLength);
            var noId=Wire();noId[18]=0;noId[19]=0;Reseal(noId);
            var zeroGeneration=Wire();for(int i=10;i<18;i++)zeroGeneration[i]=0;Reseal(zeroGeneration);
            var negativeTick=Wire(observations:new[]{new Observation("only","player","wave",1,"cafe")});
            // Independent field walk finds the sole tick: fixed header, ID, two doubles, task, count, then three text fields.
            int cursor=18;SkipText();cursor+=16;SkipText();cursor+=2;SkipText();SkipText();SkipText();for(int i=0;i<8;i++)negativeTick[cursor+i]=0xff;Reseal(negativeTick);
            var basic=Wire();var extra=basic.Take(basic.Length-32).Concat(new byte[]{0}).Concat(new byte[32]).ToArray();Reseal(extra);
            foreach(var bytes in new[]{utf8,hugeLength,noId,zeroGeneration,negativeTick,extra}) {
                File.WriteAllBytes(path,bytes);var refused=store.Restore(current,Receipt(bytes));Equal("invalid_snapshot",refused.Code);Check(ReferenceEquals(current,refused.State),"unchanged state");Bytes(bytes,File.ReadAllBytes(path));
            }
            void SkipText(){int count=(negativeTick[cursor]<<8)|negativeTick[cursor+1];cursor+=2+count;}
        });
        Test("generation exhaustion refuses overwrite instead of wrapping identity history",directory=>{
            string path=Path.Combine(directory,"npc.snapshot");var bytes=Wire();bytes[10]=0x7f;for(int i=11;i<18;i++)bytes[i]=0xff;Reseal(bytes);File.WriteAllBytes(path,bytes);
            var store=new FileInhabitantStore(path,"npc-1");var current=Fixture();var loaded=store.Restore(current,Receipt(bytes));Check(loaded.Succeeded,loaded.Code);Equal(long.MaxValue,loaded.Generation);
            var refused=store.Save(current,Receipt(bytes));Equal("generation_exhausted",refused.Code);Check(ReferenceEquals(current,refused.State),"no wrapped live actor");Bytes(bytes,File.ReadAllBytes(path));
        });
        Test("failed first publish cleans its temporary snapshot and preserves existing directory",directory=>{
            string path=Path.Combine(directory,"occupied.snapshot");Directory.CreateDirectory(path);File.WriteAllText(Path.Combine(path,"sentinel"),"preserve");
            var current=Fixture();var failed=new FileInhabitantStore(path,"npc-1").Save(current,FileInhabitantStore.Genesis);Equal("storage_failed",failed.Code);Check(ReferenceEquals(current,failed.State),"failed publish state");
            Equal("preserve",File.ReadAllText(Path.Combine(path,"sentinel")));Equal(0,Directory.GetFiles(directory,"*.tmp-*").Length);
        });
        Test("maximum existing 256-memory contract persists without loss",directory=>{
            var npc=new Inhabitant("npc-1",new Personality(.6,.4),"work");for(int i=0;i<256;i++)Check(npc.Observe(new Observation("e-"+i,"player","wave",i,"cafe"),"cafe"),"memory "+i);
            Check(!npc.Observe(new Observation("over","player","wave",256,"cafe"),"cafe"),"memory budget");
            var store=new FileInhabitantStore(Path.Combine(directory,"npc.snapshot"),"npc-1");var saved=store.Save(npc,FileInhabitantStore.Genesis);Check(saved.Succeeded,saved.Code);
            var restored=store.Restore(Fallback(),saved.Digest);Check(restored.Succeeded,restored.Code);Equal(256,restored.State.Memories.Count);Equal("e-255",restored.State.Memories[255].EventId);
        });
        Test("missing state and invalid receipts do not invent or mutate an inhabitant",directory=>{
            string path=Path.Combine(directory,"missing.snapshot");var store=new FileInhabitantStore(path,"npc-1");var current=Fixture();
            var missing=store.Restore(current,new string('a',64));Equal("missing_snapshot",missing.Code);Check(ReferenceEquals(current,missing.State),"no new seed");Check(!File.Exists(path),"load is read only");Equal(0,Directory.GetFiles(directory).Length);
            Equal("invalid_digest",store.Save(current,"not-a-checkpoint").Code);Equal("invalid_digest",store.Restore(current,"not-a-checkpoint").Code);Equal(0,Directory.GetFiles(directory).Length);
        });
        Test("writer lock refusal preserves live actor and original bytes",directory=>{
            string path=Path.Combine(directory,"npc.snapshot");var store=new FileInhabitantStore(path,"npc-1");var npc=Fixture();var saved=store.Save(npc,FileInhabitantStore.Genesis);Check(saved.Succeeded,saved.Code);byte[] before=File.ReadAllBytes(path);
            using(var held=new FileStream(path+".lock",FileMode.OpenOrCreate,FileAccess.ReadWrite,FileShare.None)) {
                var refused=store.Save(npc,saved.Digest);Equal("storage_failed",refused.Code);Check(ReferenceEquals(npc,refused.State),"lock refusal actor");Bytes(before,File.ReadAllBytes(path));
            }
            Equal(0,Directory.GetFiles(directory,"*.tmp-*").Length);
        });
        Test("snapshot receipts are deterministic for identical payload and generation",directory=>{
            var first=new FileInhabitantStore(Path.Combine(directory,"a.snapshot"),"npc-1").Save(Fixture(),FileInhabitantStore.Genesis);
            var second=new FileInhabitantStore(Path.Combine(directory,"b.snapshot"),"npc-1").Save(Fixture(),FileInhabitantStore.Genesis);
            Check(first.Succeeded && second.Succeeded,"save both");Equal(first.Digest,second.Digest);Bytes(File.ReadAllBytes(Path.Combine(directory,"a.snapshot")),File.ReadAllBytes(Path.Combine(directory,"b.snapshot")));
        });
        Console.WriteLine($"POPULATION: {passed} passed, {failed} failed");return failed==0?0:1;
    }
    static int Child(string[] args)
    {
        try {
            var store=new FileInhabitantStore(args[1],"npc-1");
            if(args[0]=="write") {var saved=store.Save(Fixture(),FileInhabitantStore.Genesis);Check(saved.Succeeded,saved.Code);Console.WriteLine(saved.Digest);return 0;}
            if(args[0]=="read") {var loaded=store.Restore(Fallback(),args[2]);Check(loaded.Succeeded,loaded.Code);Equal("npc-1",loaded.State.Id);Equal("leisure",loaded.State.Task);Equal(.9,loaded.State.Personality.Sociability);Equal("greet-1",loaded.State.Memories[0].EventId);Console.WriteLine($"restored {loaded.State.Id} {loaded.State.DecideRide("player",12).Action} {loaded.State.Memories.Count} memories");return 0;}
            throw new Exception("unknown child mode");
        }catch(Exception e){Console.Error.WriteLine(e);return 1;}
    }
    static string RunChild(params string[] args)
    {
        var start=new ProcessStartInfo(Environment.GetEnvironmentVariable("DARK_DOTNET")??"/tmp/homeless-dotnet/dotnet"){RedirectStandardOutput=true,RedirectStandardError=true,UseShellExecute=false};
        start.ArgumentList.Add(Assembly.GetExecutingAssembly().Location);foreach(string arg in args)start.ArgumentList.Add(arg);
        using var child=Process.Start(start)??throw new Exception("process failed");string output=child.StandardOutput.ReadToEnd(),error=child.StandardError.ReadToEnd();
        if(!child.WaitForExit(30000)){child.Kill();throw new Exception("child timeout");}if(child.ExitCode!=0)throw new Exception("child "+child.ExitCode+": "+error+output);return output;
    }
    static Inhabitant Fixture(string id="npc-1") {var npc=new Inhabitant(id,new Personality(.9,.1),"leisure");Check(npc.Observe(new Observation("greet-1","player","greeting",10,"cafe"),"cafe"),"fixture greeting");Check(npc.Observe(new Observation("arrival-1","driver","arrival",11,"cafe"),"cafe"),"fixture arrival");return npc;}
    static Inhabitant Fallback()=>new Inhabitant("npc-1",new Personality(.1,.9),"work");
    // Independent wire fixtures use documented big-endian fields and a standard SHA-256 checksum.
    static byte[] Wire(int version=1,string id="npc-1",double sociability=.9,double duty=.1,string task="leisure",Observation[]? observations=null)
    {
        using var stream=new MemoryStream();stream.Write(Encoding.ASCII.GetBytes("DARKNPC\0"));U16(version);U64(1);Text(id);U64(BitConverter.DoubleToInt64Bits(sociability));U64(BitConverter.DoubleToInt64Bits(duty));Text(task);
        var obs=observations??Array.Empty<Observation>();U16(obs.Length);foreach(var o in obs){Text(o.EventId);Text(o.ActorId);Text(o.Act);U64(o.Tick);Text(o.Cell);}
        byte[] payload=stream.ToArray();using var hash=SHA256.Create();return payload.Concat(hash.ComputeHash(payload)).ToArray();
        void U16(int n){stream.WriteByte((byte)(n>>8));stream.WriteByte((byte)n);}
        void U64(long n){for(int i=7;i>=0;i--)stream.WriteByte((byte)((ulong)n>>(i*8)));}
        void Text(string s){byte[] b=Encoding.UTF8.GetBytes(s);U16(b.Length);stream.Write(b);}
    }
    static void Reseal(byte[] bytes){using var hash=SHA256.Create();byte[] digest=hash.ComputeHash(bytes,0,bytes.Length-32);Array.Copy(digest,0,bytes,bytes.Length-32,32);}
    static string Receipt(byte[] bytes)=>BitConverter.ToString(bytes.Skip(bytes.Length-32).ToArray()).Replace("-","").ToLowerInvariant();
    static void Test(string name,Action<string> test){string directory=Path.Combine(Path.GetTempPath(),"dark-population-"+Guid.NewGuid().ToString("N"));Directory.CreateDirectory(directory);try{test(directory);passed++;Console.WriteLine("PASS "+name);}catch(Exception e){failed++;Console.WriteLine("FAIL "+name+": "+e);}finally{Directory.Delete(directory,true);}}
    static void Check(bool value,string message){if(!value)throw new Exception(message);}
    static void Equal<T>(T expected,T actual){if(!EqualityComparer<T>.Default.Equals(expected,actual))throw new Exception($"expected {expected}, got {actual}");}
    static void Bytes(byte[] expected,byte[] actual)=>Check(expected.SequenceEqual(actual),"bytes changed");
}
