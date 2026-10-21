using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;
using Dark.Core;

namespace Dark.History
{
    public sealed class JournalException : Exception { public JournalException(string message) : base(message) { } }
    public sealed class JournalEvent
    {
        public const string Genesis = "0000000000000000000000000000000000000000000000000000000000000000";
        public JournalEvent(long sequence, long tick, string requestId, long expectedRevision, string actorId,
            string targetId, string value, string policyDigest, string clause, string previousHash)
        {
            if(sequence<1 || tick<0 || expectedRevision!=sequence-1)throw new JournalException("Invalid sequence, tick or revision");
            Sequence=sequence;Tick=tick;RequestId=Canonical.RequireId(requestId,nameof(requestId));ExpectedRevision=expectedRevision;
            ActorId=Canonical.RequireId(actorId,nameof(actorId));TargetId=Canonical.RequireId(targetId,nameof(targetId));
            if(Canonical.Utf8.GetByteCount(value)>65536)throw new JournalException("Event value too large");
            if(!IsHash(policyDigest)||!IsHash(previousHash))throw new JournalException("Invalid hash");
            Value=value;PolicyDigest=policyDigest;Clause=Canonical.RequireId(clause,nameof(clause));PreviousHash=previousHash;
            Hash=Canonical.Hash(Fields);
        }
        public long Sequence{get;} public long Tick{get;} public string RequestId{get;} public long ExpectedRevision{get;}
        public string ActorId{get;} public string TargetId{get;} public string Value{get;} public string PolicyDigest{get;}
        public string Clause{get;} public string PreviousHash{get;} public string Hash{get;}
        string[] Fields=>new[]{"dark.event/1",Canonical.Number(Sequence),Canonical.Number(Tick),RequestId,Canonical.Number(ExpectedRevision),ActorId,"set_sign",TargetId,Value,PolicyDigest,Clause,PreviousHash};
        public string RequestDigest=>RequestHash(ActorId,RequestId,ExpectedRevision,Tick,TargetId,Value);
        public static string RequestHash(string actor,string request,long revision,long tick,string target,string value)
            =>Canonical.Hash("dark.request/1",actor,request,Canonical.Number(revision),Canonical.Number(tick),"set_sign",target,value);
        public string Encode()=>string.Join("\t",Fields.Select(f=>Convert.ToBase64String(Canonical.Utf8.GetBytes(f))))+"\t"+Hash;
        public static JournalEvent Decode(string line)
        {
            try
            {
                if(line==null||line.Length>100000)throw new JournalException("Line budget exceeded");
                var parts=line.Split('\t');if(parts.Length!=13)throw new JournalException("Invalid field count");
                var f=parts.Take(12).Select(s=>Canonical.Utf8.GetString(Convert.FromBase64String(s))).ToArray();
                if(f[0]!="dark.event/1" || f[6]!="set_sign")throw new JournalException("Unsupported event schema/operation");
                long Number(string s){if(!long.TryParse(s,NumberStyles.None,CultureInfo.InvariantCulture,out long n)||Canonical.Number(n)!=s)throw new JournalException("Noncanonical number");return n;}
                var e=new JournalEvent(Number(f[1]),Number(f[2]),f[3],Number(f[4]),f[5],f[7],f[8],f[9],f[10],f[11]);
                if(e.Hash!=parts[12] || e.Encode()!=line)throw new JournalException("Hash mismatch or noncanonical record");return e;
            }
            catch(Exception e) when(e is FormatException || e is ArgumentException || e is OverflowException)
            {throw new JournalException("Malformed event: "+e.GetType().Name);}
        }
        static bool IsHash(string s)=>s!=null&&s.Length==64&&s.All(c=>(c>='0'&&c<='9')||(c>='a'&&c<='f'));
    }
    public sealed class ReplayState
    {
        internal ReplayState(List<JournalEvent> events, Dictionary<string,string> signs)
        {Events=events.AsReadOnly();Signs=new ReadOnlyDictionary<string,string>(signs);}
        public IReadOnlyList<JournalEvent> Events{get;} public IReadOnlyDictionary<string,string> Signs{get;}
    }
    public static class EventJournal
    {
        // Tamper evidence requires a separately trusted head; this is not protection from the operator.
        public static ReplayState Verify(IEnumerable<string> lines,string trustedHead,string policyDigest)
        {
            var events=new List<JournalEvent>();var signs=new Dictionary<string,string>(StringComparer.Ordinal);
            var requests=new HashSet<string>(StringComparer.Ordinal);string head=JournalEvent.Genesis;long tick=0;
            foreach(string line in lines)
            {
                if(events.Count>=100000)throw new JournalException("Replay event budget exceeded");
                var e=JournalEvent.Decode(line);
                if(e.Sequence!=events.Count+1L||e.PreviousHash!=head||e.PolicyDigest!=policyDigest||e.Tick<tick||!requests.Add(Canonical.Hash(e.ActorId,e.RequestId)))
                    throw new JournalException("Broken order, version, policy or duplicate request");
                events.Add(e);signs[e.TargetId]=e.Value;head=e.Hash;tick=e.Tick;
            }
            if(head!=trustedHead)throw new JournalException("Untrusted head or truncated history");
            return new ReplayState(events,signs);
        }
    }
    public interface IEventSink { void Append(JournalEvent item); }
    public sealed class FileEventSink : IEventSink
    {
        readonly string path;
        public FileEventSink(string path){this.path=Path.GetFullPath(path);}
        public void Append(JournalEvent item)
        {
            using(var stream=new FileStream(path,FileMode.OpenOrCreate,FileAccess.ReadWrite,FileShare.Read))
            {
                long start=stream.Length;if(start>64*1024*1024)throw new IOException("Journal size budget exceeded");
                string? last=null;
                try
                {
                    using(var reader=new StreamReader(stream,Canonical.Utf8,false,4096,true))
                    {while(!reader.EndOfStream)last=reader.ReadLine();}
                }
                catch(DecoderFallbackException)
                {throw new JournalException("Malformed journal UTF-8");}
                string head=last==null?JournalEvent.Genesis:JournalEvent.Decode(last).Hash;
                if(head!=item.PreviousHash)throw new IOException("Stale journal writer");
                if(start>0){stream.Position=start-1;if(stream.ReadByte()!=10)throw new IOException("Incomplete journal tail");}
                stream.Position=start;
                byte[] bytes=Canonical.Utf8.GetBytes(item.Encode()+"\n");
                try{stream.Write(bytes,0,bytes.Length);stream.Flush(true);}
                catch{stream.SetLength(start);stream.Flush(true);throw;}
            }
        }
    }
}
